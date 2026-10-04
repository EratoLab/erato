//! Outgoing calls to the Bot Connector (sending, updating and replying to
//! activities) and to the Bot Framework token service, both authenticated
//! with the bot's own app token.

use eyre::{Report, WrapErr, eyre};
use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, utf8_percent_encode};
use serde::Deserialize;
use serde_json::{Value, json};
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

const BOT_FRAMEWORK_SCOPE: &str = "https://api.botframework.com/.default";
/// Refresh the app token this long before it expires.
const TOKEN_REFRESH_MARGIN: Duration = Duration::from_secs(300);
/// Hosts that serve Teams attachment content and expect the bot's token.
/// Anything else (for example SharePoint download URLs) never sees it.
const BOT_TOKEN_DOWNLOAD_HOSTS: [&str; 4] = [
    "smba.trafficmanager.net",
    ".botframework.com",
    ".skype.com",
    ".teams.microsoft.com",
];
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
        self.status == reqwest::StatusCode::FORBIDDEN
            && self.code.as_deref() == Some("ContentStreamNotAllowed")
            && self
                .message
                .to_ascii_lowercase()
                .contains("canceled by user")
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

pub struct Connector {
    http: reqwest::Client,
    app_id: String,
    app_password: String,
    tenant_id: String,
    token: Mutex<Option<(String, Instant)>>,
}

impl Connector {
    pub fn new(
        http: reqwest::Client,
        app_id: String,
        app_password: String,
        tenant_id: String,
    ) -> Self {
        Self {
            http,
            app_id,
            app_password,
            tenant_id,
            token: Mutex::new(None),
        }
    }

    pub fn http(&self) -> &reqwest::Client {
        &self.http
    }

    #[cfg(test)]
    pub(super) fn with_test_token(http: reqwest::Client) -> Self {
        let mut connector = Self::new(http, "bot".into(), "unused".into(), "tenant".into());
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
            // The body may echo request details; log the status only.
            return Err(eyre!("bot token request failed with {status}"));
        }
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
        let url = format!(
            "{}/v3/conversations/{}/activities/{}",
            service_url.trim_end_matches('/'),
            encode(conversation_id),
            encode(reply_to_id)
        );
        self.post_activity(url, activity).await
    }

    /// Replace an activity the bot sent earlier (used for decided approval cards).
    pub async fn update(
        &self,
        service_url: &str,
        conversation_id: &str,
        activity_id: &str,
        activity: &Value,
    ) -> Result<(), Report> {
        let url = format!(
            "{}/v3/conversations/{}/activities/{}",
            service_url.trim_end_matches('/'),
            encode(conversation_id),
            encode(activity_id)
        );
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
        if parsed.scheme() != "https" {
            return Err(eyre!("attachment URL must use https"));
        }
        let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
        let mut request = self.http.get(parsed);
        if BOT_TOKEN_DOWNLOAD_HOSTS
            .iter()
            .any(|allowed| host == allowed.trim_start_matches('.') || host.ends_with(allowed))
        {
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

fn encode(segment: &str) -> String {
    utf8_percent_encode(segment, PATH_SEGMENT).to_string()
}

#[cfg(test)]
mod tests {
    use super::encode;

    #[test]
    fn encodes_teams_conversation_ids_as_one_path_segment() {
        assert_eq!(
            encode("19:abc@thread.tacv2;messageid=42"),
            "19%3Aabc%40thread.tacv2%3Bmessageid%3D42"
        );
        assert_eq!(encode("a:1-B_c.d"), "a%3A1-B_c.d");
    }
}
