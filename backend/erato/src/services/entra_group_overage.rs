//! Resolve Entra overage memberships using the forwarded delegated Graph token.

use crate::config::EntraIdGroupOverageConfig;
use crate::normalize_profile::has_groups_overage;
use eyre::{Report, eyre};
use moka::{Expiry, future::Cache};
use serde::{Deserialize, de::DeserializeOwned};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::sync::Arc;
use std::time::{Duration, Instant};
use url::Url;

const GRAPH_API_BASE_URL: &str = "https://graph.microsoft.com/v1.0";
const RESOLUTION_TIMEOUT: Duration = Duration::from_secs(3);
const SUCCESS_TTL: Duration = Duration::from_secs(600);
const FAILURE_TTL: Duration = Duration::from_secs(30);
const MAX_GRAPH_BYTES: usize = 4 * 1024 * 1024;
const CACHE_BYTES: u64 = 32 * 1024 * 1024;

// Deliberately not Debug: identities and token digests must not reach logs.
#[derive(Clone, PartialEq, Eq, Hash)]
struct CacheKey {
    issuer: String,
    object_id: String,
    token_digest: [u8; 32],
}

#[derive(Clone)]
enum CachedMemberships {
    Resolved(Arc<[String]>),
    Unavailable,
}

struct MembershipExpiry {
    success: Duration,
    failure: Duration,
}

impl Expiry<CacheKey, CachedMemberships> for MembershipExpiry {
    fn expire_after_create(
        &self,
        _key: &CacheKey,
        value: &CachedMemberships,
        _created_at: Instant,
    ) -> Option<Duration> {
        Some(match value {
            CachedMemberships::Resolved(_) => self.success,
            CachedMemberships::Unavailable => self.failure,
        })
    }
}

/// Per-process Graph client and cache. No raw access tokens are retained in entries.
pub struct EntraGroupOverageResolver {
    http: reqwest::Client,
    base_url: Url,
    cache: Cache<CacheKey, CachedMemberships>,
    timeout: Duration,
}

impl EntraGroupOverageResolver {
    pub fn from_config(config: &EntraIdGroupOverageConfig) -> Result<Option<Arc<Self>>, Report> {
        config
            .enabled
            .then(|| Self::with_graph_base_url(GRAPH_API_BASE_URL).map(Arc::new))
            .transpose()
    }

    /// Endpoint injection for local Graph fixtures; production uses the fixed Graph URL.
    pub fn with_graph_base_url(base_url: &str) -> Result<Self, Report> {
        let base_url = Url::parse(base_url)?;
        if !matches!(base_url.scheme(), "http" | "https")
            || !base_url.username().is_empty()
            || base_url.password().is_some()
            || base_url.query().is_some()
            || base_url.fragment().is_some()
        {
            return Err(eyre!("Invalid Graph base URL"));
        }
        Ok(Self {
            http: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            base_url,
            cache: membership_cache(SUCCESS_TTL, FAILURE_TTL),
            timeout: RESOLUTION_TIMEOUT,
        })
    }

    /// All prerequisites are checked before even reading the cache.
    pub async fn resolve_groups(&self, claims: &Value, access_token: Option<&str>) -> Vec<String> {
        let Some(issuer) = claims
            .get("iss")
            .and_then(Value::as_str)
            .filter(|iss| is_entra_issuer(iss))
        else {
            return Vec::new();
        };
        if !has_groups_overage(claims) {
            return Vec::new();
        }
        let Some(object_id) = claims
            .get("oid")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
        else {
            return Vec::new();
        };
        let Some(access_token) = access_token.filter(|token| !token.is_empty()) else {
            return Vec::new();
        };
        let key = CacheKey {
            issuer: issuer.to_owned(),
            object_id: object_id.to_ascii_lowercase(),
            token_digest: Sha256::digest(access_token.as_bytes()).into(),
        };
        let memberships = self
            .cache
            .get_with(key, async {
                let result = tokio::time::timeout(
                    self.timeout,
                    self.fetch_memberships(access_token, object_id),
                )
                .await
                .unwrap_or(Err(GraphError::Timeout));
                match result {
                    Ok(groups) => CachedMemberships::Resolved(groups.into()),
                    Err(error) => {
                        tracing::warn!(
                            reason = error.reason(),
                            http_status = error.status(),
                            "Failed to resolve Entra group overage"
                        );
                        CachedMemberships::Unavailable
                    }
                }
            })
            .await;
        match memberships {
            CachedMemberships::Resolved(groups) => groups.to_vec(),
            CachedMemberships::Unavailable => Vec::new(),
        }
    }

    async fn fetch_memberships(
        &self,
        token: &str,
        expected_id: &str,
    ) -> Result<Vec<String>, GraphError> {
        let mut bytes_read = 0;
        let mut me = self.endpoint("me");
        me.set_query(Some("$select=id"));
        let identity: GraphIdentity = self.get_json(me, token, false, &mut bytes_read).await?;
        if !identity.id.eq_ignore_ascii_case(expected_id) {
            return Err(GraphError::IdentityMismatch);
        }

        // Match oauth2-proxy: no securityEnabled/type filter; retain roles and units too.
        let mut next = self.endpoint("me/transitiveMemberOf");
        next.set_query(Some("$select=id&$top=100"));
        let mut visited = HashSet::new();
        let mut seen_ids = HashSet::new();
        let mut groups = Vec::new();
        loop {
            if !self.is_membership_url(&next, expected_id) {
                return Err(GraphError::UnsafePagination);
            }
            if !visited.insert(next.to_string()) {
                return Err(GraphError::PaginationCycle);
            }
            let page: MembershipPage = self.get_json(next, token, true, &mut bytes_read).await?;
            for member in page.value {
                if member.id.is_empty() {
                    return Err(GraphError::InvalidResponse);
                }
                if seen_ids.insert(member.id.clone()) {
                    groups.push(member.id);
                }
            }
            let Some(link) = page.next_link.filter(|link| !link.is_empty()) else {
                return Ok(groups);
            };
            next = Url::parse(&link).map_err(|_| GraphError::UnsafePagination)?;
        }
    }

    fn endpoint(&self, path: &str) -> Url {
        let mut url = self.base_url.clone();
        url.set_path(&format!(
            "{}/{}",
            self.base_url.path().trim_end_matches('/'),
            path
        ));
        url
    }

    fn is_membership_url(&self, url: &Url, object_id: &str) -> bool {
        // Graph may canonicalize /me pagination to the verified /users/{id} path.
        let me = self.endpoint("me/transitiveMemberOf");
        let mut user = self.endpoint("users");
        if let Ok(mut path) = user.path_segments_mut() {
            path.push(object_id).push("transitiveMemberOf");
        }
        url.origin() == self.base_url.origin()
            && url.username().is_empty()
            && url.password().is_none()
            && url.fragment().is_none()
            && (url.path() == me.path() || url.path().eq_ignore_ascii_case(user.path()))
    }

    async fn get_json<T: DeserializeOwned>(
        &self,
        url: Url,
        token: &str,
        memberships: bool,
        bytes_read: &mut usize,
    ) -> Result<T, GraphError> {
        let mut request = self.http.get(url).bearer_auth(token);
        if memberships {
            request = request.header("ConsistencyLevel", "eventual");
        }
        let mut response = request.send().await.map_err(|_| GraphError::Transport)?;
        if !response.status().is_success() {
            return Err(GraphError::Http(response.status().as_u16()));
        }
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| GraphError::Transport)? {
            *bytes_read = bytes_read
                .checked_add(chunk.len())
                .ok_or(GraphError::ResponseTooLarge)?;
            if *bytes_read > MAX_GRAPH_BYTES {
                return Err(GraphError::ResponseTooLarge);
            }
            body.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&body).map_err(|_| GraphError::InvalidResponse)
    }
}

fn membership_cache(success: Duration, failure: Duration) -> Cache<CacheKey, CachedMemberships> {
    Cache::builder()
        .max_capacity(CACHE_BYTES)
        .weigher(|key: &CacheKey, value: &CachedMemberships| {
            let groups_bytes = match value {
                CachedMemberships::Resolved(groups) => groups
                    .iter()
                    .map(|group| group.capacity() + std::mem::size_of::<String>())
                    .sum(),
                CachedMemberships::Unavailable => 0,
            };
            (std::mem::size_of::<CacheKey>()
                + key.issuer.capacity()
                + key.object_id.capacity()
                + std::mem::size_of::<CachedMemberships>()
                + groups_bytes)
                .try_into()
                .unwrap_or(u32::MAX)
        })
        .expire_after(MembershipExpiry { success, failure })
        .build()
}

fn is_entra_issuer(issuer: &str) -> bool {
    let Ok(url) = Url::parse(issuer) else {
        return false;
    };
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port_or_known_default() != Some(443)
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return false;
    }
    let path = url.path().trim_matches('/').split('/').collect::<Vec<_>>();
    match url.host_str() {
        Some("login.microsoftonline.com") => {
            path.len() == 2 && !path[0].is_empty() && path[1] == "v2.0"
        }
        Some("sts.windows.net") => path.len() == 1 && !path[0].is_empty(),
        _ => false,
    }
}

#[derive(Deserialize)]
struct GraphIdentity {
    id: String,
}

#[derive(Deserialize)]
struct MembershipPage {
    value: Vec<GraphIdentity>,
    #[serde(rename = "@odata.nextLink")]
    next_link: Option<String>,
}

enum GraphError {
    Http(u16),
    Transport,
    IdentityMismatch,
    UnsafePagination,
    PaginationCycle,
    ResponseTooLarge,
    InvalidResponse,
    Timeout,
}

impl GraphError {
    fn reason(&self) -> &'static str {
        match self {
            Self::Http(_) => "http_status",
            Self::Transport => "transport",
            Self::IdentityMismatch => "identity_mismatch",
            Self::UnsafePagination => "unsafe_pagination",
            Self::PaginationCycle => "pagination_cycle",
            Self::ResponseTooLarge => "response_too_large",
            Self::InvalidResponse => "invalid_response",
            Self::Timeout => "timeout",
        }
    }
    fn status(&self) -> Option<u16> {
        match self {
            Self::Http(status) => Some(*status),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests;
