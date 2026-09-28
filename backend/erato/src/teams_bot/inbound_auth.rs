//! Verification of the Bot Connector's JWT on incoming activities.
//!
//! This route sits outside oauth2-proxy and the user profile middleware, so
//! unlike the rest of the API it must check the signature itself: issuer
//! `https://api.botframework.com`, audience = the bot's app ID, a signing key
//! from the Bot Framework key set endorsed for `msteams`, and the
//! `serviceurl` claim matching the activity (so a stolen token cannot be
//! replayed to redirect replies elsewhere).

use eyre::{Report, eyre};
use jsonwebtoken::{Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

const OPENID_CONFIGURATION_URL: &str =
    "https://login.botframework.com/v1/.well-known/openidconfiguration";
pub const BOT_FRAMEWORK_ISSUER: &str = "https://api.botframework.com";
const TEAMS_CHANNEL_ENDORSEMENT: &str = "msteams";
const KEY_CACHE_TTL: Duration = Duration::from_secs(24 * 60 * 60);
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

enum KeySource {
    Remote(reqwest::Client),
    #[cfg(test)]
    Static,
}

pub struct InboundAuth {
    app_id: String,
    source: KeySource,
    keys: RwLock<Option<(Instant, Vec<SigningKey>)>>,
}

impl InboundAuth {
    pub fn new(http: reqwest::Client, app_id: String) -> Self {
        let _ = jsonwebtoken::crypto::aws_lc::DEFAULT_PROVIDER.install_default();
        Self {
            app_id,
            source: KeySource::Remote(http),
            keys: RwLock::new(None),
        }
    }

    #[cfg(test)]
    pub fn with_static_keys(app_id: String, keys: Vec<SigningKey>) -> Self {
        let _ = jsonwebtoken::crypto::aws_lc::DEFAULT_PROVIDER.install_default();
        Self {
            app_id,
            source: KeySource::Static,
            keys: RwLock::new(Some((Instant::now(), keys))),
        }
    }

    /// Verify the `Authorization` header of an incoming activity.
    pub async fn verify(
        &self,
        authorization: Option<&str>,
        activity_service_url: &str,
    ) -> Result<(), Report> {
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
            .any(|endorsement| endorsement == TEAMS_CHANNEL_ENDORSEMENT)
        {
            return Err(eyre!("signing key is not endorsed for Teams"));
        }

        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_issuer(&[BOT_FRAMEWORK_ISSUER]);
        validation.set_audience(&[self.app_id.as_str()]);
        validation.leeway = CLOCK_SKEW_SECONDS;
        validation.set_required_spec_claims(&["exp", "iss", "aud"]);
        let decoding_key = DecodingKey::from_rsa_components(&key.n, &key.e)?;
        let claims = jsonwebtoken::decode::<ConnectorClaims>(token, &decoding_key, &validation)?;

        let claimed = claims.claims.serviceurl.unwrap_or_default();
        if normalize_service_url(&claimed) != normalize_service_url(activity_service_url) {
            return Err(eyre!("token service URL does not match the activity"));
        }
        Ok(())
    }

    async fn signing_key(&self, kid: &str) -> Result<SigningKey, Report> {
        {
            let cached = self.keys.read().await;
            if let Some((fetched_at, keys)) = cached.as_ref()
                && (fetched_at.elapsed() < KEY_CACHE_TTL || !self.can_refresh())
                && let Some(key) = keys.iter().find(|key| key.kid == kid)
            {
                return Ok(key.clone());
            }
        }
        // Unknown key or stale cache: Microsoft rotates keys, so refetch once.
        let keys = self.fetch_keys().await?;
        let key = keys.iter().find(|key| key.kid == kid).cloned();
        *self.keys.write().await = Some((Instant::now(), keys));
        key.ok_or_else(|| eyre!("unknown signing key"))
    }

    fn can_refresh(&self) -> bool {
        matches!(self.source, KeySource::Remote(_))
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
            KeySource::Static => Err(eyre!("static key set has no such key")),
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
mod tests {
    use super::*;
    use jsonwebtoken::{EncodingKey, Header};
    use serde_json::json;

    // A throwaway 2048-bit RSA key used only by these tests.
    const TEST_PRIVATE_KEY: &str = include_str!("testdata/connector_test_key.pem");
    const TEST_N: &str = include_str!("testdata/connector_test_key.n");
    const TEST_E: &str = "AQAB";
    const APP_ID: &str = "00000000-0000-0000-0000-00000000b07";
    const SERVICE_URL: &str = "https://smba.trafficmanager.net/emea/";

    fn auth(endorsements: &[&str]) -> InboundAuth {
        InboundAuth::with_static_keys(
            APP_ID.to_string(),
            vec![SigningKey {
                kid: "test-key".to_string(),
                n: TEST_N.trim().to_string(),
                e: TEST_E.to_string(),
                endorsements: endorsements.iter().map(|value| value.to_string()).collect(),
            }],
        )
    }

    fn token(claims: serde_json::Value) -> String {
        let mut header = Header::new(Algorithm::RS256);
        header.kid = Some("test-key".to_string());
        let key = EncodingKey::from_rsa_pem(TEST_PRIVATE_KEY.as_bytes()).expect("test key");
        jsonwebtoken::encode(&header, &claims, &key).expect("token encodes")
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

    #[tokio::test]
    async fn accepts_a_valid_connector_token() {
        let bearer = format!("Bearer {}", token(claims(json!({}))));
        auth(&["msteams"])
            .verify(Some(&bearer), "https://smba.trafficmanager.net/emea")
            .await
            .expect("valid token is accepted");
    }

    #[tokio::test]
    async fn rejects_wrong_audience_issuer_service_url_and_endorsement() {
        let cases = [
            (
                claims(json!({"aud": "someone-else"})),
                SERVICE_URL,
                "msteams",
            ),
            (
                claims(json!({"iss": "https://evil.example"})),
                SERVICE_URL,
                "msteams",
            ),
            (claims(json!({})), "https://evil.example/", "msteams"),
            (claims(json!({"exp": 1000})), SERVICE_URL, "msteams"),
            (claims(json!({})), SERVICE_URL, "webchat"),
        ];
        for (claims, service_url, endorsement) in cases {
            let bearer = format!("Bearer {}", token(claims.clone()));
            assert!(
                auth(&[endorsement])
                    .verify(Some(&bearer), service_url)
                    .await
                    .is_err(),
                "should reject {claims} for {service_url} with {endorsement}"
            );
        }
        assert!(auth(&["msteams"]).verify(None, SERVICE_URL).await.is_err());
    }
}
