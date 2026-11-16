//! Operator-only Entra external-JWT exchange. Tokens never leave this MCP auth path.
use super::mcp_manager::McpRequestAuthContext;
use crate::config::{
    McpCustomTokenExchangeConfig, McpServerConfig, McpServerForwardedAuthenticationConfig,
    McpServerForwardedCredential,
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use eyre::{Report, eyre};
use moka::{Expiry, future::Cache};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const REFRESH_MARGIN: Duration = Duration::from_secs(15);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

// Intentionally no Debug: neither tokens nor token responses belong in diagnostics.
#[derive(Clone)]
pub(super) struct ExchangedToken {
    pub token: Arc<str>,
    pub generation: Uuid,
    pub usable_until: Instant,
}

struct TokenExpiry;
impl Expiry<[u8; 32], ExchangedToken> for TokenExpiry {
    fn expire_after_create(
        &self,
        _: &[u8; 32],
        value: &ExchangedToken,
        now: Instant,
    ) -> Option<Duration> {
        Some(value.usable_until.saturating_duration_since(now))
    }
}

static TOKENS: LazyLock<Cache<[u8; 32], ExchangedToken>> = LazyLock::new(|| {
    Cache::builder()
        .max_capacity(1024)
        .expire_after(TokenExpiry)
        .build()
});

/// Decoding exp is only a conservative freshness check, never signature validation.
/// Opaque access tokens are valid inputs; their issuer remains responsible for validation.
fn jwt_expiry(token: &str) -> Option<SystemTime> {
    let mut parts = token.split('.');
    parts.next()?;
    let payload = parts.next()?;
    parts.next()?;
    if parts.next().is_some() {
        return None;
    }
    let payload = URL_SAFE_NO_PAD.decode(payload).ok()?;
    let claims: serde_json::Value = serde_json::from_slice(&payload).ok()?;
    let exp = claims.get("exp")?.as_i64()?;
    UNIX_EPOCH.checked_add(Duration::from_secs(exp.max(0) as u64))
}

pub(super) fn enabled(forwarded: &McpServerForwardedAuthenticationConfig) -> bool {
    forwarded
        .custom_token_exchange
        .as_ref()
        .is_some_and(|exchange| exchange.enabled)
}

pub(super) async fn resolve(
    server_id: &str,
    server: &McpServerConfig,
    forwarded: &McpServerForwardedAuthenticationConfig,
    auth: &McpRequestAuthContext<'_>,
) -> Result<ExchangedToken, Report> {
    let exchange = forwarded
        .custom_token_exchange
        .as_ref()
        .filter(|exchange| exchange.enabled)
        .ok_or_else(|| eyre!("MCP token exchange is disabled"))?;
    exchange.validate(&forwarded.credential)?;
    let user = auth
        .user_id
        .ok_or_else(|| eyre!("MCP token exchange requires a user"))?;
    let (source, trusted_expiry) = match exchange.subject_credential {
        McpServerForwardedCredential::AccessToken => {
            (auth.access_token, auth.access_token_expires_at)
        }
        McpServerForwardedCredential::OidcIdToken => (auth.oidc_token, auth.oidc_token_expires_at),
    };
    let source = source
        .filter(|token| !token.trim().is_empty())
        .ok_or_else(|| eyre!("Missing selected MCP exchange subject credential"))?;
    let source_expiry = match (trusted_expiry, jwt_expiry(source)) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (a, b) => a.or(b),
    };
    if source_expiry.is_some_and(|expiry| expiry <= SystemTime::now()) {
        return Err(eyre!("Expired MCP exchange subject credential"));
    }
    // Length-prefix every component, including confidential configuration, before hashing.
    // The cache and session keys never retain the original subject or client secret.
    let mut digest = Sha256::new();
    for part in [
        user.to_string(),
        server_id.to_owned(),
        server.url.clone(),
        exchange.token_endpoint.clone(),
        exchange.client_id.clone(),
        exchange.client_secret.expose_secret().to_owned(),
        exchange.grant_type.clone(),
        exchange.scope.clone(),
        format!("{:?}", exchange.subject_credential),
        format!("{:?}", forwarded.credential),
        source.to_owned(),
        format!("{source_expiry:?}"),
    ] {
        digest.update((part.len() as u64).to_be_bytes());
        digest.update(part.as_bytes());
    }
    let key: [u8; 32] = digest.finalize().into();
    // Moka coalesces concurrent misses for this exact user/target/credential key.
    TOKENS
        .try_get_with(
            key,
            exchange_token(exchange, &forwarded.credential, source, source_expiry),
        )
        .await
        .map_err(|error: Arc<Report>| eyre!("{error}"))
}

// Intentionally ignore unrelated envelope fields, including refresh_expires_in:
// its presence does not mean this grant issues or supports refresh tokens.
#[derive(Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    id_token: Option<String>,
    expires_in: Option<u64>,
}

async fn exchange_token(
    config: &McpCustomTokenExchangeConfig,
    output: &McpServerForwardedCredential,
    source: &str,
    source_expiry: Option<SystemTime>,
) -> Result<ExchangedToken, Report> {
    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .connect_timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| eyre!("Cannot build MCP exchange client"))?;
    let started = SystemTime::now();
    // RFC 6749 Basic credentials use form encoding before base64 encoding.
    let encode =
        |value: &str| url::form_urlencoded::byte_serialize(value.as_bytes()).collect::<String>();
    let mut response = client
        .post(&config.token_endpoint)
        .basic_auth(
            encode(&config.client_id),
            Some(encode(config.client_secret.expose_secret())),
        )
        .form(&[
            ("grant_type", config.grant_type.as_str()),
            ("subject_issuer", "entra"),
            ("subject_token", source),
            ("scope", config.scope.as_str()),
        ])
        .send()
        .await
        .map_err(|_| eyre!("MCP exchange request failed"))?;
    if !response.status().is_success() {
        return Err(eyre!(
            "MCP exchange rejected (HTTP {})",
            response.status().as_u16()
        ));
    }
    // Never propagate reqwest/JSON errors or response bodies, which can contain tokens.
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| eyre!("Invalid MCP exchange response"))?
    {
        if body.len() + chunk.len() > 128 * 1024 {
            return Err(eyre!("MCP exchange response too large"));
        }
        body.extend_from_slice(&chunk);
    }
    let response: TokenResponse =
        serde_json::from_slice(&body).map_err(|_| eyre!("Invalid MCP exchange response"))?;
    let (token, expiry) = match output {
        McpServerForwardedCredential::AccessToken => {
            let token = response
                .access_token
                .ok_or_else(|| eyre!("Missing STS access token"))?;
            let lifetime = response
                .expires_in
                .and_then(|seconds| started.checked_add(Duration::from_secs(seconds)));
            let expiry = match (lifetime, jwt_expiry(&token)) {
                (Some(a), Some(b)) => Some(a.min(b)),
                (a, b) => a.or(b),
            };
            (token, expiry)
        }
        McpServerForwardedCredential::OidcIdToken => {
            let token = response
                .id_token
                .ok_or_else(|| eyre!("Missing STS ID token"))?;
            let expiry = jwt_expiry(&token);
            (token, expiry)
        }
    };
    if token.is_empty()
        || token.bytes().any(|byte| byte.is_ascii_whitespace())
        || reqwest::header::HeaderValue::from_str(&token).is_err()
    {
        return Err(eyre!("Invalid selected STS credential"));
    }
    let expiry = expiry.ok_or_else(|| eyre!("Selected STS credential has no usable expiry"))?;
    let expiry = source_expiry.map_or(expiry, |source| expiry.min(source));
    let remaining = expiry
        .duration_since(SystemTime::now())
        .ok()
        .and_then(|duration| duration.checked_sub(REFRESH_MARGIN))
        .filter(|duration| !duration.is_zero())
        .ok_or_else(|| eyre!("Selected STS credential is expired or too close to expiry"))?;
    let usable_until = Instant::now()
        .checked_add(remaining)
        .ok_or_else(|| eyre!("Invalid STS credential lifetime"))?;
    Ok(ExchangedToken {
        token: token.into(),
        generation: Uuid::new_v4(),
        usable_until,
    })
}

#[cfg(test)]
mod tests;
