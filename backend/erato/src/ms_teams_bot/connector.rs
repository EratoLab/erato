//! Outgoing calls to the Bot Connector (sending, updating and replying to
//! activities) and to the Bot Framework token service, both authenticated
//! with the bot's own app token.

use eyre::{Report, WrapErr, eyre};
use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, utf8_percent_encode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::sync::atomic::{AtomicU8, Ordering};
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

const BOT_FRAMEWORK_SCOPE: &str = "https://api.botframework.com/.default";
/// Refresh the app token this long before it expires.
const TOKEN_REFRESH_MARGIN: Duration = Duration::from_secs(300);
/// Hosts that serve Teams attachment content and expect the bot's token.
/// Anything else (for example SharePoint download URLs) never sees it.
/// A leading dot matches the domain and its subdomains; anything else only
/// that exact host.
const BOT_TOKEN_DOWNLOAD_HOSTS: [&str; 4] = [
    "smba.trafficmanager.net",
    ".botframework.com",
    ".skype.com",
    ".teams.microsoft.com",
];
/// Hosts attachment content may be downloaded from at all, including every
/// redirect hop: the Teams hosts above plus SharePoint/OneDrive, where files
/// uploaded in personal chats live. Attachment URLs arrive in the activity
/// body, so nothing else (internal hosts in particular) is ever fetched.
const ATTACHMENT_DOWNLOAD_HOSTS: [&str; 5] = [
    "smba.trafficmanager.net",
    ".botframework.com",
    ".skype.com",
    ".teams.microsoft.com",
    ".sharepoint.com",
];
const MAX_DOWNLOAD_REDIRECTS: usize = 5;
/// The setup status checks the credential on demand from a public route, so
/// at most one token request per interval.
const CREDENTIAL_CHECK_INTERVAL: Duration = Duration::from_secs(60);
/// Conversation and activity IDs carry `:`, `;`, `@` and `=`.
const PATH_SEGMENT: &AsciiSet = &NON_ALPHANUMERIC.remove(b'-').remove(b'.').remove(b'_');

/// Preserve Connector errors so a user stopping a stream is not mistaken for
/// a delivery failure, and throttled progress can honor Retry-After.
#[derive(Debug)]
pub struct ActivityError {
    pub status: reqwest::StatusCode,
    pub code: Option<String>,
    pub message: String,
    pub retry_after: Option<Duration>,
}

impl ActivityError {
    pub fn stream_cancelled(&self) -> bool {
        // The documentation uses US spelling; the live Teams service also
        // returns "cancelled". Both mean Stop, never a delivery fallback.
        let message = self.message.to_ascii_lowercase();
        self.status == reqwest::StatusCode::FORBIDDEN
            && self.code.as_deref() == Some("ContentStreamNotAllowed")
            && (message.contains("canceled by user") || message.contains("cancelled by user"))
    }

    async fn from_response(response: reqwest::Response) -> Self {
        let status = response.status();
        let retry_after = response
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u64>().ok())
            .map(Duration::from_secs);
        let bytes = response.bytes().await.unwrap_or_default();
        let body: Value = serde_json::from_slice(&bytes).unwrap_or_default();
        let error = body.get("error").unwrap_or(&body);
        Self {
            status,
            code: error.get("code").and_then(Value::as_str).map(str::to_owned),
            message: error
                .get("message")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .unwrap_or_else(|| String::from_utf8_lossy(&bytes).chars().take(300).collect()),
            retry_after,
        }
    }
}

impl std::fmt::Display for ActivityError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Bot Connector call failed with {}: {}",
            self.status, self.message
        )
    }
}

impl std::error::Error for ActivityError {}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
}

#[derive(Deserialize)]
struct ResourceResponse {
    #[serde(default)]
    id: Option<String>,
}

/// Whether Entra last accepted the bot's credential, shown on the setup page.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CredentialState {
    /// No token was requested yet.
    Unknown,
    Accepted,
    /// Wrong or expired secret.
    Rejected,
    /// Entra does not know the app in this tenant: wrong app or tenant ID,
    /// or the app registration has no service principal yet.
    AppNotInTenant,
}

impl CredentialState {
    /// Classify a failed token response by Entra's `error_codes`.
    fn from_token_error(body: &[u8]) -> Self {
        let codes = serde_json::from_slice::<Value>(body)
            .ok()
            .and_then(|body| body.get("error_codes").cloned())
            .and_then(|codes| serde_json::from_value::<Vec<u64>>(codes).ok())
            .unwrap_or_default();
        // AADSTS7000229: no service principal; AADSTS700016: app not found.
        if codes.iter().any(|code| matches!(code, 7_000_229 | 700_016)) {
            Self::AppNotInTenant
        } else {
            Self::Rejected
        }
    }
}

pub struct Connector {
    http: reqwest::Client,
    /// Attachment downloads only; see [`download_client`].
    downloads: reqwest::Client,
    app_id: String,
    app_password: String,
    tenant_id: String,
    token: Mutex<Option<(String, Instant)>>,
    credential: AtomicU8,
    next_credential_check: Mutex<Option<Instant>>,
}

impl Connector {
    pub fn new(
        http: reqwest::Client,
        downloads: reqwest::Client,
        app_id: String,
        app_password: String,
        tenant_id: String,
    ) -> Self {
        Self {
            http,
            downloads,
            app_id,
            app_password,
            tenant_id,
            token: Mutex::new(None),
            credential: AtomicU8::new(CredentialState::Unknown as u8),
            next_credential_check: Mutex::new(None),
        }
    }

    /// Whether Entra accepts the bot's credential, requesting a token when
    /// none is cached, at most once per [`CREDENTIAL_CHECK_INTERVAL`]. Works
    /// before the Azure Bot exists: the token only needs the app registration.
    pub async fn check_credential(&self) -> CredentialState {
        {
            let mut next = self.next_credential_check.lock().await;
            if next.is_some_and(|at| Instant::now() < at) {
                return self.credential_state();
            }
            *next = Some(Instant::now() + CREDENTIAL_CHECK_INTERVAL);
        }
        if let Err(error) = self.app_token().await {
            tracing::warn!(%error, "Teams bot credential check failed");
        }
        self.credential_state()
    }

    pub fn credential_state(&self) -> CredentialState {
        match self.credential.load(Ordering::Relaxed) {
            value if value == CredentialState::Accepted as u8 => CredentialState::Accepted,
            value if value == CredentialState::Rejected as u8 => CredentialState::Rejected,
            value if value == CredentialState::AppNotInTenant as u8 => {
                CredentialState::AppNotInTenant
            }
            _ => CredentialState::Unknown,
        }
    }

    pub fn http(&self) -> &reqwest::Client {
        &self.http
    }

    #[cfg(test)]
    pub(super) fn with_test_token(http: reqwest::Client) -> Self {
        let mut connector = Self::new(
            http.clone(),
            http,
            "bot".into(),
            "unused".into(),
            "tenant".into(),
        );
        connector.token = Mutex::new(Some((
            "test-bot-token".into(),
            Instant::now() + Duration::from_secs(600),
        )));
        connector
    }

    /// The bot's app token for the Bot Connector and the token service,
    /// from the single-tenant authority.
    pub async fn app_token(&self) -> Result<String, Report> {
        let mut cached = self.token.lock().await;
        if let Some((token, valid_until)) = cached.as_ref()
            && Instant::now() < *valid_until
        {
            self.credential
                .store(CredentialState::Accepted as u8, Ordering::Relaxed);
            return Ok(token.clone());
        }
        let url = format!(
            "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
            self.tenant_id
        );
        let form = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("grant_type", "client_credentials")
            .append_pair("client_id", &self.app_id)
            .append_pair("client_secret", &self.app_password)
            .append_pair("scope", BOT_FRAMEWORK_SCOPE)
            .finish();
        let response = self
            .http
            .post(url)
            .header(
                reqwest::header::CONTENT_TYPE,
                "application/x-www-form-urlencoded",
            )
            .body(form)
            .send()
            .await?;
        let status = response.status();
        let body = response.bytes().await?;
        if !status.is_success() {
            if status.is_client_error() {
                let state = CredentialState::from_token_error(&body);
                self.credential.store(state as u8, Ordering::Relaxed);
            }
            // The body may echo request details; log the status only.
            return Err(eyre!("bot token request failed with {status}"));
        }
        self.credential
            .store(CredentialState::Accepted as u8, Ordering::Relaxed);
        let token: TokenResponse = serde_json::from_slice(&body)?;
        let valid_until = Instant::now()
            + Duration::from_secs(token.expires_in).saturating_sub(TOKEN_REFRESH_MARGIN);
        *cached = Some((token.access_token.clone(), valid_until));
        Ok(token.access_token)
    }

    /// Post a new activity into a conversation; returns the activity ID.
    pub async fn send(
        &self,
        service_url: &str,
        conversation_id: &str,
        activity: &Value,
    ) -> Result<Option<String>, Report> {
        let url = format!(
            "{}/v3/conversations/{}/activities",
            service_url.trim_end_matches('/'),
            encode(conversation_id)
        );
        self.post_activity(url, activity).await
    }

    /// Reply to an activity, which keeps channel answers inside the thread.
    pub async fn reply(
        &self,
        service_url: &str,
        conversation_id: &str,
        reply_to_id: &str,
        activity: &Value,
    ) -> Result<Option<String>, Report> {
        let url = activity_url(service_url, conversation_id, reply_to_id);
        self.post_activity(url, activity).await
    }

    /// Replace an activity the bot sent earlier.
    pub async fn update(
        &self,
        service_url: &str,
        conversation_id: &str,
        activity_id: &str,
        activity: &Value,
    ) -> Result<(), Report> {
        let url = activity_url(service_url, conversation_id, activity_id);
        let token = self.app_token().await?;
        let response = self
            .http
            .put(url)
            .bearer_auth(token)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(serde_json::to_vec(activity)?)
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(ActivityError::from_response(response).await.into());
        }
        Ok(())
    }

    /// Remove a temporary control activity which the bot sent.
    pub async fn delete(
        &self,
        service_url: &str,
        conversation_id: &str,
        activity_id: &str,
    ) -> Result<(), Report> {
        let url = activity_url(service_url, conversation_id, activity_id);
        let response = self
            .http
            .delete(url)
            .bearer_auth(self.app_token().await?)
            .send()
            .await?;
        if !response.status().is_success() && response.status() != reqwest::StatusCode::NOT_FOUND {
            return Err(ActivityError::from_response(response).await.into());
        }
        Ok(())
    }

    /// Open (or reuse) the personal chat between the bot and a user; returns
    /// its conversation ID. Used to move sign-in out of group conversations.
    pub async fn create_personal_conversation(
        &self,
        service_url: &str,
        bot_id: &str,
        user_id: &str,
        tenant_id: &str,
    ) -> Result<String, Report> {
        let url = format!("{}/v3/conversations", service_url.trim_end_matches('/'));
        let body = json!({
            "bot": {"id": bot_id},
            "members": [{"id": user_id}],
            "channelData": {"tenant": {"id": tenant_id}},
            "tenantId": tenant_id,
            "isGroup": false,
        });
        self.post_activity(url, &body)
            .await?
            .ok_or_else(|| eyre!("conversation creation returned no ID"))
    }

    async fn post_activity(&self, url: String, body: &Value) -> Result<Option<String>, Report> {
        let token = self.app_token().await?;
        let response = self
            .http
            .post(url)
            .bearer_auth(token)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(serde_json::to_vec(body)?)
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(ActivityError::from_response(response).await.into());
        }
        let bytes = response.bytes().await?;
        if bytes.is_empty() {
            return Ok(None);
        }
        Ok(serde_json::from_slice::<ResourceResponse>(&bytes)
            .ok()
            .and_then(|resource| resource.id))
    }

    /// Download attachment bytes. The bot's token is attached only for Teams
    /// content hosts; pre-authenticated URLs are fetched without it.
    pub async fn download(&self, url: &str, max_bytes: usize) -> Result<Vec<u8>, Report> {
        let parsed = url::Url::parse(url).wrap_err("invalid attachment URL")?;
        if !download_url_allowed(&parsed) {
            return Err(eyre!(
                "attachment URL is not an https URL on a Teams or SharePoint host"
            ));
        }
        let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
        let mut request = self.downloads.get(parsed);
        if host_in(&host, &BOT_TOKEN_DOWNLOAD_HOSTS) {
            // reqwest drops the header if a redirect leaves this host.
            request = request.bearer_auth(self.app_token().await?);
        }
        let response = request.send().await?;
        if !response.status().is_success() {
            return Err(eyre!(
                "attachment download failed with {}",
                response.status()
            ));
        }
        read_limited(response, max_bytes).await
    }
}

/// The client for attachment content: https only, and every redirect hop must
/// stay on [`ATTACHMENT_DOWNLOAD_HOSTS`].
pub fn download_client(timeout: Duration) -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(timeout)
        .https_only(true)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() > MAX_DOWNLOAD_REDIRECTS {
                attempt.error("too many redirects")
            } else if download_url_allowed(attempt.url()) {
                attempt.follow()
            } else {
                attempt.error("attachment redirect left the allowed hosts")
            }
        }))
        .build()
}

fn download_url_allowed(url: &url::Url) -> bool {
    url.scheme() == "https"
        && url
            .host_str()
            .is_some_and(|host| host_in(&host.to_ascii_lowercase(), &ATTACHMENT_DOWNLOAD_HOSTS))
}

/// `.example.com` matches `example.com` and its subdomains; `example.com`
/// matches only itself.
fn host_in(host: &str, patterns: &[&str]) -> bool {
    patterns
        .iter()
        .any(|pattern| match pattern.strip_prefix('.') {
            Some(domain) => host == domain || host.ends_with(pattern),
            None => host == *pattern,
        })
}

/// Read a response body, refusing anything larger than `max_bytes`.
pub async fn read_limited(
    mut response: reqwest::Response,
    max_bytes: usize,
) -> Result<Vec<u8>, Report> {
    if response
        .content_length()
        .is_some_and(|length| length as usize > max_bytes)
    {
        return Err(eyre!("file exceeds the upload size limit"));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if bytes.len() + chunk.len() > max_bytes {
            return Err(eyre!("file exceeds the upload size limit"));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn activity_url(service_url: &str, conversation_id: &str, activity_id: &str) -> String {
    format!(
        "{}/v3/conversations/{}/activities/{}",
        service_url.trim_end_matches('/'),
        encode(conversation_id),
        encode(activity_id)
    )
}

fn encode(segment: &str) -> String {
    utf8_percent_encode(segment, PATH_SEGMENT).to_string()
}

#[cfg(test)]
mod tests {
    use super::{
        ATTACHMENT_DOWNLOAD_HOSTS, ActivityError, BOT_TOKEN_DOWNLOAD_HOSTS, download_url_allowed,
        encode, host_in,
    };

    #[test]
    fn classifies_token_errors_by_entra_code() {
        use super::CredentialState;
        let error = |codes: &str| {
            CredentialState::from_token_error(
                format!(r#"{{"error":"invalid_client","error_codes":{codes}}}"#).as_bytes(),
            )
        };
        assert_eq!(error("[7000215]"), CredentialState::Rejected);
        assert_eq!(error("[7000222]"), CredentialState::Rejected);
        assert_eq!(error("[7000229]"), CredentialState::AppNotInTenant);
        assert_eq!(error("[700016]"), CredentialState::AppNotInTenant);
        assert_eq!(
            CredentialState::from_token_error(b"not json"),
            CredentialState::Rejected
        );
    }

    #[tokio::test]
    async fn credential_check_uses_the_cached_token_without_a_request() {
        let connector = super::Connector::with_test_token(reqwest::Client::new());
        assert_eq!(
            connector.check_credential().await,
            super::CredentialState::Accepted
        );
    }

    #[test]
    fn matches_exact_hosts_exactly_and_dotted_entries_as_domains() {
        assert!(host_in(
            "smba.trafficmanager.net",
            &BOT_TOKEN_DOWNLOAD_HOSTS
        ));
        assert!(!host_in(
            "attackersmba.trafficmanager.net",
            &BOT_TOKEN_DOWNLOAD_HOSTS
        ));
        assert!(host_in("us-api.asm.skype.com", &BOT_TOKEN_DOWNLOAD_HOSTS));
        assert!(host_in("skype.com", &BOT_TOKEN_DOWNLOAD_HOSTS));
        assert!(!host_in("evilskype.com", &BOT_TOKEN_DOWNLOAD_HOSTS));
        assert!(!host_in(
            "contoso-my.sharepoint.com",
            &BOT_TOKEN_DOWNLOAD_HOSTS
        ));
        assert!(host_in(
            "contoso-my.sharepoint.com",
            &ATTACHMENT_DOWNLOAD_HOSTS
        ));
    }

    #[test]
    fn downloads_only_https_urls_on_teams_and_sharepoint_hosts() {
        let allowed = |url: &str| download_url_allowed(&url::Url::parse(url).unwrap());
        assert!(allowed(
            "https://contoso-my.sharepoint.com/personal/a/_layouts/15/download.aspx?UniqueId=1"
        ));
        assert!(allowed(
            "https://smba.trafficmanager.net/emea/v3/attachments/1/views/original"
        ));
        for url in [
            "http://contoso-my.sharepoint.com/file",
            "https://localhost/file",
            "https://127.0.0.1/file",
            "https://169.254.169.254/metadata",
            "https://erato.internal.example/api",
            "https://sharepoint.com.evil.example/file",
            "https://attackersmba.trafficmanager.net/file",
        ] {
            assert!(!allowed(url), "{url} must not be fetched");
        }
    }

    #[test]
    fn recognizes_both_live_stop_spellings_without_treating_other_stream_errors_as_stop() {
        let mut error = ActivityError {
            status: reqwest::StatusCode::FORBIDDEN,
            code: Some("ContentStreamNotAllowed".into()),
            message: String::new(),
            retry_after: None,
        };
        for message in [
            "Content stream was canceled by user.",
            "Content stream was cancelled by user.",
        ] {
            error.message = message.into();
            assert!(error.stream_cancelled());
        }
        error.message = "Content stream finished due to exceeded streaming time.".into();
        assert!(!error.stream_cancelled());
        error.message = "Content stream was cancelled by user.".into();
        error.status = reqwest::StatusCode::BAD_REQUEST;
        assert!(!error.stream_cancelled());
    }

    #[test]
    fn encodes_teams_conversation_ids_as_one_path_segment() {
        assert_eq!(
            encode("19:abc@thread.tacv2;messageid=42"),
            "19%3Aabc%40thread.tacv2%3Bmessageid%3D42"
        );
        assert_eq!(encode("a:1-B_c.d"), "a%3A1-B_c.d");
    }
}
