//! Filename search across configured, delegated-access drive discovery sources.
use super::*;
use crate::policy::engine::{PolicyEngine, authorize};
use crate::policy::types::{Action, Resource};
use percent_encoding::{NON_ALPHANUMERIC, percent_decode_str, utf8_percent_encode};
use std::time::Duration;
use tokio::time::{Instant, timeout, timeout_at};

const MAX_FILES: usize = 100;
const MAX_PAGES_PER_DRIVE: usize = 10;

#[derive(Debug, Serialize, ToSchema)]
pub struct SearchFileHit {
    #[serde(flatten)]
    pub item: DriveItem,
    pub drive_id: String,
    pub drive_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub site_name: Option<String>,
    /// Parent folder path relative to the drive. None means Graph did not supply a usable path.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub parent_path: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SharepointSearchResponse {
    pub drives: Vec<Drive>,
    pub files: Vec<SearchFileHit>,
    /// Some discovery/search calls failed or timed out; successful hits are still usable.
    pub partial: bool,
    /// A discovery, pagination, or result budget was reached. Refine the query.
    pub truncated: bool,
}

#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    query: String,
}

#[utoipa::path(
    get,
    path = "/integrations/sharepoint/search",
    tag = "sharepoint",
    params(("query" = String, Query, description = "Filename or drive/site name (1–200 characters)")),
    responses(
        (status = OK, body = SharepointSearchResponse),
        (status = BAD_REQUEST, description = "Invalid query"),
        (status = UNAUTHORIZED, description = "Missing or expired Graph token"),
        (status = FORBIDDEN, description = "Search is not authorized"),
        (status = NOT_FOUND, description = "Integration disabled"),
        (status = BAD_GATEWAY, description = "Graph search failed"),
        (status = GATEWAY_TIMEOUT, description = "Drive discovery timed out")
    ),
    security(("bearer_auth" = []))
)]
pub async fn search_sharepoint(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    Query(request): Query<SearchQuery>,
) -> Result<Json<SharepointSearchResponse>, StatusCode> {
    check_sharepoint_enabled(&app_state)?;
    let token = get_access_token(&me_user)?;
    let query = request.query.trim();
    if query.is_empty() || query.chars().count() > 200 || query.chars().any(char::is_control) {
        return Err(StatusCode::BAD_REQUEST);
    }
    policy
        .rebuild_data_if_needed_req(&app_state.db, &app_state.config)
        .await?;
    authorize!(
        policy,
        &me_user.to_subject(),
        &Resource::SharepointSearchSingleton,
        Action::Read
    )
    .map_err(|_| StatusCode::FORBIDDEN)?;

    // File discovery must not be filtered by the filename query or the default
    // browse view's public-library filter. Retain query-specific drive discovery
    // too, so existing drive/site search continues to find matching libraries.
    let discovered = timeout(
        Duration::from_secs(30),
        discover_drives(&app_state, token, Some(query), true),
    )
    .await
    .map_err(|_| StatusCode::GATEWAY_TIMEOUT)?;
    let mut partial = discovered.partial;
    let mut truncated = discovered.truncated;
    let mut drives = discovered.drives;
    if drives.is_empty() && partial {
        return Err(StatusCode::BAD_GATEWAY);
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let deadline = Instant::now() + Duration::from_secs(20);
    let mut files = Vec::new();
    let mut seen = HashSet::new();
    let mut succeeded = 0;
    {
        let requests = drives
            .iter()
            .map(|drive| search_drive(&client, token, drive, &drives, query, deadline))
            .collect::<Vec<_>>();
        let mut pending = stream::iter(requests).buffer_unordered(5);
        while let Some(result) = pending.next().await {
            match result {
                Ok((hits, capped, incomplete)) => {
                    partial |= incomplete;
                    succeeded += 1;
                    truncated |= capped;
                    for hit in hits {
                        if seen.insert((hit.drive_id.clone(), hit.item.id.clone())) {
                            files.push(hit);
                        }
                    }
                    if files.len() > MAX_FILES {
                        files.truncate(MAX_FILES);
                        truncated = true;
                        break;
                    }
                }
                Err(StatusCode::UNAUTHORIZED) => return Err(StatusCode::UNAUTHORIZED),
                Err(_) => partial = true,
            }
        }
    }
    if !drives.is_empty() && succeeded == 0 {
        return Err(StatusCode::BAD_GATEWAY);
    }
    files.sort_by(|a, b| {
        a.item
            .name
            .to_lowercase()
            .cmp(&b.item.name.to_lowercase())
            .then_with(|| a.drive_id.cmp(&b.drive_id))
            .then_with(|| a.item.id.cmp(&b.item.id))
    });
    drives.retain(|drive| drive_matches_search_query(drive, query));
    Ok(Json(SharepointSearchResponse {
        drives,
        files,
        partial,
        truncated,
    }))
}

fn search_url(drive_id: &str, query: &str) -> String {
    let drive_id = utf8_percent_encode(drive_id, NON_ALPHANUMERIC);
    let escaped = query.replace('\'', "''");
    let query = utf8_percent_encode(&escaped, NON_ALPHANUMERIC);
    format!("{GRAPH_API_BASE_URL}/drives/{drive_id}/root/search(q='{query}')?$top=100")
}

/// Graph's search also matches content and metadata. Only filename hits belong
/// in this picker. Use canonical remote identities and only known scoped drives.
fn parse_search_hit(
    raw: &serde_json::Value,
    drive: &Drive,
    drives: &[Drive],
    query: &str,
) -> Option<SearchFileHit> {
    let remote = raw.get("remoteItem");
    let raw = remote.unwrap_or(raw);
    if !raw.get("file").is_some_and(serde_json::Value::is_object) || raw.get("folder").is_some() {
        return None;
    }
    let item = parse_drive_item(raw)?;
    if !item.name.to_lowercase().contains(&query.to_lowercase()) {
        return None;
    }
    let parent = raw.get("parentReference");
    let drive_id = parent
        .and_then(|p| p.get("driveId"))
        .and_then(|v| v.as_str())
        .or_else(|| remote.is_none().then_some(drive.id.as_str()))?;
    let drive = drives.iter().find(|d| d.id == drive_id)?;
    let parent_path = parent
        .and_then(|p| p.get("path"))
        .and_then(|v| v.as_str())
        .and_then(|path| path.split_once("root:").map(|(_, relative)| relative))
        .map(str::to_string)
        .or_else(|| parent_path_from_web_url(item.web_url.as_deref()?, drive.web_url.as_deref()?))
        .map(|path| percent_decode_str(&path).decode_utf8_lossy().into_owned())
        .map(|path| {
            if path.is_empty() {
                "/".to_string()
            } else {
                path
            }
        });
    Some(SearchFileHit {
        item,
        drive_id: drive.id.clone(),
        drive_name: drive.name.clone(),
        site_name: drive.site_name.clone(),
        parent_path,
    })
}

// Search results do not always include parentReference.path. A file URL inside
// the library URL still gives a useful relative folder path without extra Graph calls.
fn parent_path_from_web_url(file_url: &str, drive_url: &str) -> Option<String> {
    let file = url::Url::parse(file_url).ok()?;
    let drive = url::Url::parse(drive_url).ok()?;
    if file.origin() != drive.origin() {
        return None;
    }
    let prefix = format!("{}/", drive.path().trim_end_matches('/'));
    let relative = file.path().strip_prefix(&prefix)?;
    let (parent, _) = relative.rsplit_once('/').unwrap_or(("", relative));
    Some(format!("/{parent}"))
}

async fn search_drive(
    client: &reqwest::Client,
    token: &str,
    drive: &Drive,
    drives: &[Drive],
    query: &str,
    deadline: Instant,
) -> Result<(Vec<SearchFileHit>, bool, bool), StatusCode> {
    search_drive_pages(
        client,
        token,
        drive,
        drives,
        query,
        search_url(&drive.id, query),
        deadline,
    )
    .await
}

async fn search_drive_pages(
    client: &reqwest::Client,
    token: &str,
    drive: &Drive,
    drives: &[Drive],
    query: &str,
    mut url: String,
    deadline: Instant,
) -> Result<(Vec<SearchFileHit>, bool, bool), StatusCode> {
    let origin = url::Url::parse(&url)
        .map_err(|_| StatusCode::BAD_GATEWAY)?
        .origin();
    let mut hits = Vec::new();
    for _ in 0..MAX_PAGES_PER_DRIVE {
        let page = timeout_at(deadline, fetch_search_page(client, token, &url))
            .await
            .unwrap_or(Err(StatusCode::GATEWAY_TIMEOUT));
        let body = match page {
            Ok(body) => body,
            Err(StatusCode::UNAUTHORIZED) => return Err(StatusCode::UNAUTHORIZED),
            Err(_) if !hits.is_empty() => return Ok((hits, false, true)),
            Err(error) => return Err(error),
        };
        let values = body
            .get("value")
            .and_then(|v| v.as_array())
            .ok_or(StatusCode::BAD_GATEWAY)?;
        hits.extend(
            values
                .iter()
                .filter_map(|raw| parse_search_hit(raw, drive, drives, query)),
        );
        if hits.len() > MAX_FILES {
            return Ok((hits, true, false));
        }
        match body.get("@odata.nextLink").and_then(|v| v.as_str()) {
            Some(next) if url::Url::parse(next).is_ok_and(|next| next.origin() == origin) => {
                url = next.to_string()
            }
            Some(_) => return Err(StatusCode::BAD_GATEWAY),
            None => return Ok((hits, false, false)),
        }
    }
    Ok((hits, true, false))
}

async fn fetch_search_page(
    client: &reqwest::Client,
    token: &str,
    url: &str,
) -> Result<serde_json::Value, StatusCode> {
    for attempt in 0..2 {
        let response = client
            .get(url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|_| StatusCode::BAD_GATEWAY)?;
        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(StatusCode::UNAUTHORIZED);
        }
        if attempt == 0
            && (status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error())
        {
            let delay = retry_delay_seconds(response.headers().get(reqwest::header::RETRY_AFTER))
                .ok_or(StatusCode::BAD_GATEWAY)?;
            // Do not retry earlier than Graph requested; long waits fail this drive.
            if delay > 5 {
                return Err(StatusCode::BAD_GATEWAY);
            }
            tokio::time::sleep(Duration::from_secs(delay)).await;
            continue;
        }
        if !status.is_success() {
            return Err(StatusCode::BAD_GATEWAY);
        }
        return response.json().await.map_err(|_| StatusCode::BAD_GATEWAY);
    }
    Err(StatusCode::BAD_GATEWAY)
}

// Retry-After can be either seconds or an HTTP date. Never shorten a server's delay.
fn retry_delay_seconds(header: Option<&reqwest::header::HeaderValue>) -> Option<u64> {
    let Some(header) = header else {
        return Some(1);
    };
    let value = header.to_str().ok()?;
    if let Ok(seconds) = value.parse() {
        return Some(seconds);
    }
    let date = DateTime::parse_from_rfc2822(value).ok()?;
    let remaining = date.signed_duration_since(chrono::Utc::now());
    Some(remaining.num_seconds().saturating_add(1).max(0) as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{Router, routing::get};
    use serde_json::json;
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    fn drives() -> Vec<Drive> {
        ["finance", "sales"]
            .into_iter()
            .map(|id| Drive {
                id: id.into(),
                name: id.into(),
                drive_type: "documentLibrary".into(),
                kind: "sharepoint_site_library".into(),
                owner_name: None,
                group_visibility: Some("Public".into()),
                site_name: Some("Unrelated site".into()),
                web_url: None,
            })
            .collect()
    }
    fn file() -> serde_json::Value {
        json!({"id": "same-id", "name": "Budget 2026.pdf", "file": {"mimeType": "application/pdf"}, "parentReference": {"driveId": "finance", "path": "/drives/finance/root:/Reports%20and%20plans"}})
    }

    #[test]
    fn filenames_only_with_paths_and_canonical_remote_identity() {
        let drives = drives();
        let hit = parse_search_hit(&file(), &drives[0], &drives, "BUDGET").unwrap();
        assert_eq!(hit.parent_path.as_deref(), Some("/Reports and plans"));
        assert_eq!(hit.drive_id, "finance");
        assert!(parse_search_hit(&file(), &drives[0], &drives, "contents-only").is_none());
        let mut folder = file();
        folder["folder"] = json!({});
        assert!(parse_search_hit(&folder, &drives[0], &drives, "Budget").is_none());
        let remote = json!({"id": "shortcut", "remoteItem": file()});
        let hit = parse_search_hit(&remote, &drives[1], &drives, "Budget").unwrap();
        assert_eq!(hit.item.id, "same-id");
        assert_eq!(hit.drive_id, "finance");
        let mut missing_remote_drive = remote.clone();
        missing_remote_drive["remoteItem"]["parentReference"] = json!({});
        assert!(parse_search_hit(&missing_remote_drive, &drives[0], &drives, "Budget").is_none());
        let mut inaccessible = file();
        inaccessible["parentReference"]["driveId"] = json!("outside-scope");
        assert!(parse_search_hit(&inaccessible, &drives[0], &drives, "Budget").is_none());
    }

    #[test]
    fn retry_after_preserves_long_delays_and_http_dates() {
        assert_eq!(retry_delay_seconds(None), Some(1));
        assert_eq!(
            retry_delay_seconds(Some(&reqwest::header::HeaderValue::from_static("30"))),
            Some(30)
        );
        assert!(
            retry_delay_seconds(Some(
                &reqwest::header::HeaderValue::from_str(
                    &(chrono::Utc::now() + chrono::Duration::seconds(60)).to_rfc2822()
                )
                .unwrap()
            ))
            .is_some_and(|delay| delay > 5)
        );
        assert_eq!(
            retry_delay_seconds(Some(&reqwest::header::HeaderValue::from_static("invalid"))),
            None
        );
    }

    #[test]
    fn search_query_escapes_quotes_and_url_delimiters() {
        let url = search_url("drive/id", "O'Brien & 日本?#");
        assert!(url.contains("drive%2Fid"));
        assert!(url.contains("O%27%27Brien%20%26%20"));
        assert!(!url.contains("日本"));
        assert_eq!(url.matches('?').count(), 1);
    }

    async fn mock_pages(
        fail_second: bool,
        first_matches: bool,
    ) -> (String, tokio::task::JoinHandle<()>, Arc<AtomicUsize>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/pages", listener.local_addr().unwrap());
        let next_url = url.clone();
        let calls = Arc::new(AtomicUsize::new(0));
        let count = calls.clone();
        let app = Router::new().route(
            "/pages",
            get(move || {
                let next = next_url.clone();
                let count = count.clone();
                async move {
                    let n = count.fetch_add(1, Ordering::SeqCst);
                    if n > 0 && fail_second {
                        return (StatusCode::FORBIDDEN, Json(json!({})));
                    }
                    let mut item = file();
                    if n == 0 && !first_matches {
                        item["name"] = json!("Content-only.pdf");
                    }
                    let body = if n == 0 {
                        json!({"value": [item], "@odata.nextLink": next})
                    } else {
                        json!({"value": [item]})
                    };
                    (StatusCode::OK, Json(body))
                }
            }),
        );
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (url, task, calls)
    }

    #[test]
    fn web_url_fallback_requires_the_same_library() {
        assert_eq!(
            parent_path_from_web_url(
                "https://example.com/sites/Finance/Documents/Annual%20reports/Budget.pdf",
                "https://example.com/sites/Finance/Documents"
            )
            .as_deref(),
            Some("/Annual%20reports")
        );
        assert_eq!(
            parent_path_from_web_url(
                "https://example.com/docs/Budget.pdf",
                "https://example.com/docs"
            )
            .as_deref(),
            Some("/")
        );
        assert!(
            parent_path_from_web_url(
                "https://elsewhere.com/docs/file.pdf",
                "https://example.com/docs"
            )
            .is_none()
        );
        assert!(
            parent_path_from_web_url(
                "https://example.com/docs-other/file.pdf",
                "https://example.com/docs"
            )
            .is_none()
        );
    }

    #[tokio::test]
    async fn search_follows_pages_even_when_first_page_has_no_filename_matches() {
        let (url, task, calls) = mock_pages(false, false).await;
        let drives = drives();
        let (hits, truncated, partial) = search_drive_pages(
            &reqwest::Client::new(),
            "test",
            &drives[0],
            &drives,
            "Budget",
            url,
            Instant::now() + Duration::from_secs(5),
        )
        .await
        .unwrap();
        task.abort();
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert_eq!(hits.len(), 1);
        assert!(!truncated && !partial);
    }

    #[tokio::test]
    async fn search_keeps_hits_when_a_later_page_fails() {
        let (url, task, _) = mock_pages(true, true).await;
        let drives = drives();
        let (hits, truncated, partial) = search_drive_pages(
            &reqwest::Client::new(),
            "test",
            &drives[0],
            &drives,
            "Budget",
            url,
            Instant::now() + Duration::from_secs(5),
        )
        .await
        .unwrap();
        task.abort();
        assert_eq!(hits.len(), 1);
        assert!(!truncated && partial);
    }
}
