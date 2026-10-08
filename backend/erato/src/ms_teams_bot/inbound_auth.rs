//! Verification of the Bot Connector's JWT on incoming activities.
//!
//! This route sits outside oauth2-proxy and the user profile middleware, so
//! unlike the rest of the API it must check the signature itself: issuer
//! `https://api.botframework.com`, audience = the bot's app ID, validity
//! window, and a signing key from the Bot Framework key set endorsed for
//! `msteams`. The token is checked before the request body is read; the
//! parsed activity is then bound to it: the `serviceurl` claim must match (so
//! a stolen token cannot be replayed to redirect replies elsewhere) and the
//! channel must be Teams (Web Chat and Direct Line clients write activity
//! fields themselves).

use crate::ms_teams_bot::activity::Activity;
use eyre::{Report, eyre};
use jsonwebtoken::{Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, RwLock};

const OPENID_CONFIGURATION_URL: &str =
    "https://login.botframework.com/v1/.well-known/openidconfiguration";
pub const BOT_FRAMEWORK_ISSUER: &str = "https://api.botframework.com";
const TEAMS_CHANNEL: &str = "msteams";
const KEY_CACHE_TTL: Duration = Duration::from_secs(24 * 60 * 60);
/// At most one remote key refresh per interval. Tokens with an unknown key ID
/// need no valid signature, so without this every forged request would make
/// Erato call Microsoft.
const MIN_KEY_REFRESH_INTERVAL: Duration = Duration::from_secs(60);
/// The Bot Framework protocol allows five minutes of clock skew.
const CLOCK_SKEW_SECONDS: u64 = 300;

#[derive(Debug, Clone, Deserialize)]
pub struct SigningKey {
    pub kid: String,
    pub n: String,
    pub e: String,
    #[serde(default)]
    pub endorsements: Vec<String>,
}

#[derive(Deserialize)]
struct KeySet {
    keys: Vec<SigningKey>,
}

#[derive(Deserialize)]
struct OpenIdConfiguration {
    jwks_uri: String,
}

#[derive(Deserialize)]
struct ConnectorClaims {
    #[serde(default)]
    serviceurl: Option<String>,
}

/// Why an activity was refused, mapped to the status code Teams receives.
#[derive(Debug)]
pub enum Rejection {
    /// No, malformed or invalid token: `401`.
    Unauthenticated(Report),
    /// A valid token that does not belong to this activity or channel: `403`.
    Forbidden(Report),
}

impl std::fmt::Display for Rejection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Rejection::Unauthenticated(error) | Rejection::Forbidden(error) => error.fmt(f),
        }
    }
}

/// A Connector token whose signature and claims passed; the activity it came
/// with still has to be bound to it with [`VerifiedToken::check_activity`].
#[derive(Debug)]
pub struct VerifiedToken {
    service_url: String,
}

impl VerifiedToken {
    pub fn check_activity(&self, activity: &Activity) -> Result<(), Rejection> {
        let activity_service_url = activity.service_url.as_deref().unwrap_or_default();
        if normalize_service_url(&self.service_url) != normalize_service_url(activity_service_url) {
            return Err(Rejection::Unauthenticated(eyre!(
                "token service URL does not match the activity"
            )));
        }
        if activity.channel_id.as_deref() != Some(TEAMS_CHANNEL) {
            return Err(Rejection::Forbidden(eyre!(
                "activity is not from the Teams channel"
            )));
        }
        Ok(())
    }
}

enum KeySource {
    Remote(reqwest::Client),
    #[cfg(test)]
    Fixed(test_support::FixedKeys),
}

struct KeyCache {
    refresh_after: Instant,
    keys: Vec<SigningKey>,
}

pub struct InboundAuth {
    app_id: String,
    source: KeySource,
    keys: RwLock<Option<KeyCache>>,
    /// Serializes refreshes; holds when the next one may start, set by every
    /// attempt, successful or not.
    next_refresh: Mutex<Option<Instant>>,
}

impl InboundAuth {
    pub fn new(http: reqwest::Client, app_id: String) -> Self {
        Self::with_source(app_id, KeySource::Remote(http))
    }

    fn with_source(app_id: String, source: KeySource) -> Self {
        let _ = jsonwebtoken::crypto::aws_lc::DEFAULT_PROVIDER.install_default();
        Self {
            app_id,
            source,
            keys: RwLock::new(None),
            next_refresh: Mutex::new(None),
        }
    }

    /// Verify the `Authorization` header of an incoming request, before its
    /// body is read.
    pub async fn verify_token(
        &self,
        authorization: Option<&str>,
    ) -> Result<VerifiedToken, Rejection> {
        self.verify(authorization)
            .await
            .map_err(Rejection::Unauthenticated)
    }

    async fn verify(&self, authorization: Option<&str>) -> Result<VerifiedToken, Report> {
        let token = authorization
            .and_then(|value| value.strip_prefix("Bearer "))
            .ok_or_else(|| eyre!("missing bearer token"))?;
        let header = jsonwebtoken::decode_header(token)?;
        if header.alg != Algorithm::RS256 {
            return Err(eyre!("unexpected token algorithm {:?}", header.alg));
        }
        let kid = header.kid.ok_or_else(|| eyre!("token has no key ID"))?;
        let key = self.signing_key(&kid).await?;
        if !key
            .endorsements
            .iter()
            .any(|endorsement| endorsement == TEAMS_CHANNEL)
        {
            return Err(eyre!("signing key is not endorsed for Teams"));
        }

        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_issuer(&[BOT_FRAMEWORK_ISSUER]);
        validation.set_audience(&[self.app_id.as_str()]);
        validation.leeway = CLOCK_SKEW_SECONDS;
        validation.validate_nbf = true;
        validation.set_required_spec_claims(&["exp", "iss", "aud"]);
        let decoding_key = DecodingKey::from_rsa_components(&key.n, &key.e)?;
        let claims = jsonwebtoken::decode::<ConnectorClaims>(token, &decoding_key, &validation)?;
        Ok(VerifiedToken {
            service_url: claims.claims.serviceurl.unwrap_or_default(),
        })
    }

    async fn signing_key(&self, kid: &str) -> Result<SigningKey, Report> {
        if let Some((key, fresh)) = self.cached_key(kid).await
            && fresh
        {
            return Ok(key);
        }
        // Unknown key or stale cache: Microsoft rotates keys, so refetch, but
        // only one request at a time and at most once per interval.
        self.refresh_keys().await;
        self.cached_key(kid)
            .await
            .map(|(key, _)| key)
            .ok_or_else(|| eyre!("unknown signing key"))
    }

    /// The cached key for `kid`, and whether the cache is still fresh.
    async fn cached_key(&self, kid: &str) -> Option<(SigningKey, bool)> {
        let cached = self.keys.read().await;
        let cache = cached.as_ref()?;
        let key = cache.keys.iter().find(|key| key.kid == kid)?.clone();
        Some((key, Instant::now() < cache.refresh_after))
    }

    /// Fetch the key set unless another request just did. A failed fetch
    /// keeps the previous keys, so an outage at Microsoft does not reject
    /// tokens signed with a key Erato already knows.
    async fn refresh_keys(&self) {
        let mut next_refresh = self.next_refresh.lock().await;
        if next_refresh.is_some_and(|at| Instant::now() < at) {
            return;
        }
        *next_refresh = Some(Instant::now() + MIN_KEY_REFRESH_INTERVAL);
        match self.fetch_keys().await {
            Ok(keys) => {
                *self.keys.write().await = Some(KeyCache {
                    refresh_after: Instant::now() + KEY_CACHE_TTL,
                    keys,
                });
            }
            Err(error) => {
                tracing::warn!(%error, "Could not refresh the Bot Framework signing keys");
            }
        }
    }

    async fn fetch_keys(&self) -> Result<Vec<SigningKey>, Report> {
        match &self.source {
            KeySource::Remote(http) => {
                let configuration: OpenIdConfiguration =
                    get_json(http, OPENID_CONFIGURATION_URL).await?;
                let key_set: KeySet = get_json(http, &configuration.jwks_uri).await?;
                Ok(key_set.keys)
            }
            #[cfg(test)]
            KeySource::Fixed(fixed) => fixed.fetch(),
        }
    }
}

async fn get_json<T: serde::de::DeserializeOwned>(
    http: &reqwest::Client,
    url: &str,
) -> Result<T, Report> {
    let response = http.get(url).send().await?.error_for_status()?;
    Ok(serde_json::from_slice(&response.bytes().await?)?)
}

fn normalize_service_url(url: &str) -> String {
    url.trim_end_matches('/').to_ascii_lowercase()
}

#[cfg(test)]
mod test_support {
    use super::{InboundAuth, KeyCache, KeySource, SigningKey};
    use eyre::{Report, eyre};
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::time::Instant;
    use tokio::sync::RwLock;

    /// A key set served from memory that counts fetches and can fail.
    pub(super) struct FixedKeys {
        keys: Vec<SigningKey>,
        pub(super) fetches: Arc<AtomicUsize>,
        pub(super) fail: Arc<AtomicBool>,
    }

    impl FixedKeys {
        pub(super) fn fetch(&self) -> Result<Vec<SigningKey>, Report> {
            self.fetches.fetch_add(1, Ordering::SeqCst);
            if self.fail.load(Ordering::SeqCst) {
                return Err(eyre!("key endpoint unavailable"));
            }
            Ok(self.keys.clone())
        }
    }

    impl InboundAuth {
        /// Pre-loaded with `keys`; refreshes return the same set.
        pub fn with_static_keys(app_id: String, keys: Vec<SigningKey>) -> Self {
            Self::with_fixed_keys(app_id, keys).0
        }

        pub(super) fn with_fixed_keys(
            app_id: String,
            keys: Vec<SigningKey>,
        ) -> (Self, Arc<AtomicUsize>, Arc<AtomicBool>) {
            let fetches = Arc::new(AtomicUsize::new(0));
            let fail = Arc::new(AtomicBool::new(false));
            let mut auth = Self::with_source(
                app_id,
                KeySource::Fixed(FixedKeys {
                    keys: keys.clone(),
                    fetches: fetches.clone(),
                    fail: fail.clone(),
                }),
            );
            auth.keys = RwLock::new(Some(KeyCache {
                refresh_after: Instant::now() + super::KEY_CACHE_TTL,
                keys,
            }));
            (auth, fetches, fail)
        }

        /// Make the cache due for a refresh, with no refresh pending.
        pub(super) async fn age_cache(&self) {
            if let Some(cache) = self.keys.write().await.as_mut() {
                cache.refresh_after = Instant::now();
            }
            *self.next_refresh.lock().await = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::{EncodingKey, Header};
    use serde_json::json;
    use std::sync::atomic::Ordering;

    // A throwaway 2048-bit RSA key used only by these tests.
    const TEST_PRIVATE_KEY: &str = include_str!("testdata/connector_test_key.pem");
    const TEST_N: &str = include_str!("testdata/connector_test_key.n");
    const TEST_E: &str = "AQAB";
    const APP_ID: &str = "00000000-0000-0000-0000-00000000b07";
    const SERVICE_URL: &str = "https://smba.trafficmanager.net/emea/";

    fn signing_key(endorsements: &[&str]) -> SigningKey {
        SigningKey {
            kid: "test-key".to_string(),
            n: TEST_N.trim().to_string(),
            e: TEST_E.to_string(),
            endorsements: endorsements.iter().map(|value| value.to_string()).collect(),
        }
    }

    fn auth(endorsements: &[&str]) -> InboundAuth {
        InboundAuth::with_static_keys(APP_ID.to_string(), vec![signing_key(endorsements)])
    }

    fn token_with_kid(claims: serde_json::Value, kid: &str) -> String {
        let mut header = Header::new(Algorithm::RS256);
        header.kid = Some(kid.to_string());
        let key = EncodingKey::from_rsa_pem(TEST_PRIVATE_KEY.as_bytes()).expect("test key");
        jsonwebtoken::encode(&header, &claims, &key).expect("token encodes")
    }

    fn token(claims: serde_json::Value) -> String {
        token_with_kid(claims, "test-key")
    }

    fn claims(overrides: serde_json::Value) -> serde_json::Value {
        let mut claims = json!({
            "iss": BOT_FRAMEWORK_ISSUER,
            "aud": APP_ID,
            "exp": chrono::Utc::now().timestamp() + 600,
            "serviceurl": SERVICE_URL,
        });
        for (key, value) in overrides.as_object().unwrap() {
            claims[key] = value.clone();
        }
        claims
    }

    fn activity(service_url: &str, channel_id: Option<&str>) -> Activity {
        Activity {
            kind: "message".into(),
            service_url: Some(service_url.into()),
            channel_id: channel_id.map(Into::into),
            ..Activity::default()
        }
    }

    async fn verify(
        auth: &InboundAuth,
        bearer: Option<&str>,
        activity: &Activity,
    ) -> Result<(), Rejection> {
        auth.verify_token(bearer).await?.check_activity(activity)
    }

    #[tokio::test]
    async fn accepts_a_valid_connector_token() {
        let bearer = format!("Bearer {}", token(claims(json!({}))));
        verify(
            &auth(&["msteams"]),
            Some(&bearer),
            &activity("https://smba.trafficmanager.net/emea", Some("msteams")),
        )
        .await
        .expect("valid token is accepted");
    }

    #[tokio::test]
    async fn rejects_wrong_audience_issuer_validity_and_endorsement() {
        let now = chrono::Utc::now().timestamp();
        let cases = [
            (claims(json!({"aud": "someone-else"})), "msteams"),
            (claims(json!({"iss": "https://evil.example"})), "msteams"),
            (claims(json!({"exp": 1000})), "msteams"),
            (claims(json!({"nbf": now + 3600})), "msteams"),
            (claims(json!({})), "webchat"),
        ];
        for (claims, endorsement) in cases {
            let bearer = format!("Bearer {}", token(claims.clone()));
            assert!(
                matches!(
                    auth(&[endorsement]).verify_token(Some(&bearer)).await,
                    Err(Rejection::Unauthenticated(_))
                ),
                "should reject {claims} with {endorsement}"
            );
        }
        assert!(auth(&["msteams"]).verify_token(None).await.is_err());
    }

    #[tokio::test]
    async fn accepts_not_before_within_the_clock_skew() {
        let bearer = format!(
            "Bearer {}",
            token(claims(json!({"nbf": chrono::Utc::now().timestamp() + 200})))
        );
        auth(&["msteams"])
            .verify_token(Some(&bearer))
            .await
            .expect("nbf inside the skew is accepted");
    }

    #[tokio::test]
    async fn binds_the_token_to_the_activity_service_url_and_teams_channel() {
        let bearer = format!("Bearer {}", token(claims(json!({}))));
        let auth = auth(&["msteams", "webchat", "directline"]);
        assert!(matches!(
            verify(
                &auth,
                Some(&bearer),
                &activity("https://evil.example/", Some("msteams"))
            )
            .await,
            Err(Rejection::Unauthenticated(_))
        ));
        for channel in [Some("webchat"), Some("directline"), None] {
            assert!(
                matches!(
                    verify(&auth, Some(&bearer), &activity(SERVICE_URL, channel)).await,
                    Err(Rejection::Forbidden(_))
                ),
                "should reject channel {channel:?}"
            );
        }
    }

    #[tokio::test]
    async fn unknown_key_ids_refresh_at_most_once_per_interval() {
        let (auth, fetches, _) =
            InboundAuth::with_fixed_keys(APP_ID.into(), vec![signing_key(&["msteams"])]);
        auth.age_cache().await;
        for attempt in 0..20 {
            let bearer = format!(
                "Bearer {}",
                token_with_kid(claims(json!({})), &format!("forged-{attempt}"))
            );
            assert!(auth.verify_token(Some(&bearer)).await.is_err());
        }
        assert_eq!(fetches.load(Ordering::SeqCst), 1);

        // The refreshed cache still serves the known key without fetching.
        let bearer = format!("Bearer {}", token(claims(json!({}))));
        auth.verify_token(Some(&bearer))
            .await
            .expect("known key still verifies");
        assert_eq!(fetches.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn keeps_stale_keys_when_a_refresh_fails() {
        let (auth, fetches, fail) =
            InboundAuth::with_fixed_keys(APP_ID.into(), vec![signing_key(&["msteams"])]);
        auth.age_cache().await;
        fail.store(true, Ordering::SeqCst);
        let bearer = format!("Bearer {}", token(claims(json!({}))));
        auth.verify_token(Some(&bearer))
            .await
            .expect("stale but known key verifies while Microsoft is unreachable");
        assert_eq!(fetches.load(Ordering::SeqCst), 1);
    }
}
