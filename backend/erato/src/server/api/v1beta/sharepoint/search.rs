//! Indexed filename search across SharePoint/OneDrive with the user's delegated token.
use super::*;
use crate::policy::engine::{PolicyEngine, authorize};
use crate::policy::types::{Action, Resource};
use percent_encoding::{NON_ALPHANUMERIC, percent_decode_str, utf8_percent_encode};
use std::time::Duration;
use tokio::time::{Instant, timeout, timeout_at};

const MAX_FILES: usize = 100;
const MAX_SEARCH_PAGES: usize = 10;
const PAGE_SIZE: usize = 100;

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
        (status = NOT_FOUND, description = "Integration or file search disabled"),
        (status = BAD_GATEWAY, description = "Graph search failed"),
        (status = GATEWAY_TIMEOUT, description = "Microsoft Search timed out")
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
    if !app_state.config.integrations.sharepoint.file_search_enabled {
        return Err(StatusCode::NOT_FOUND);
    }
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

    // Drive-name discovery and cross-drive file search are independent. In particular,
    // a slow/incomplete drive inventory must not prevent accessible files being found.
    let started = Instant::now();
    let deadline = started + Duration::from_secs(20);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let (discovered, file_results) = tokio::join!(
        timeout(
            Duration::from_secs(10),
            discover_drives(&app_state, token, Some(query), false),
        ),
        search_files(
            &client,
            token,
            GRAPH_API_BASE_URL,
            query,
            started + Duration::from_secs(15),
        ),
    );
    let mut results = file_results?;
    let drives = match discovered {
        Ok(discovered) => {
            results.partial |= discovered.partial;
            results.truncated |= discovered.truncated;
            discovered.drives
        }
        Err(_) => {
            tracing::warn!("SharePoint drive-name discovery timed out; retaining file results");
            results.partial = true;
            Vec::new()
        }
    };
    // Only look up metadata for libraries/sites represented in the bounded result set.
    // These optional lookups share the overall deadline and cannot discard file hits.
    enrich_file_hits(&client, token, GRAPH_API_BASE_URL, &mut results, deadline).await?;
    let mut files: Vec<_> = results
        .hits
        .into_iter()
        .map(|candidate| candidate.hit)
        .collect();
    files.sort_by(|a, b| {
        a.item
            .name
            .to_lowercase()
            .cmp(&b.item.name.to_lowercase())
            .then_with(|| a.drive_id.cmp(&b.drive_id))
            .then_with(|| a.item.id.cmp(&b.item.id))
    });
    tracing::info!(
        elapsed_ms = started.elapsed().as_millis() as u64,
        drive_count = drives.len(),
        file_count = files.len(),
        partial = results.partial,
        truncated = results.truncated,
        "Completed SharePoint cross-drive search"
    );
    Ok(Json(SharepointSearchResponse {
        drives,
        files,
        partial: results.partial,
        truncated: results.truncated,
    }))
}

struct FileCandidate {
    hit: SearchFileHit,
    site_id: Option<String>,
}

#[derive(Default)]
struct FileSearchResults {
    hits: Vec<FileCandidate>,
    partial: bool,
    truncated: bool,
}

// Keep input inside a KQL filename phrase. Quotes, wildcards and backslashes supplied
// by the user are separators, never KQL syntax. The final literal filename filter
// below still applies to the original query, including those characters.
fn filename_query(query: &str) -> String {
    let literal = query.replace(['"', '*', '\\'], " ");
    let literal = literal.split_whitespace().collect::<Vec<_>>().join(" ");
    format!("filename:\"{literal}*\" AND isDocument=true")
}

fn parse_search_hit(raw: &serde_json::Value, query: &str) -> Option<FileCandidate> {
    let raw = raw
        .get("remoteItem")
        .filter(|v| v.is_object())
        .unwrap_or(raw);
    if !raw.get("file").is_some_and(serde_json::Value::is_object)
        || raw.get("folder").is_some_and(serde_json::Value::is_object)
    {
        return None;
    }
    let mut item = parse_drive_item(raw)?;
    item.is_folder = false;
    if !item.name.to_lowercase().contains(&query.to_lowercase()) {
        return None;
    }
    let parent = raw.get("parentReference")?;
    let drive_id = parent.get("driveId")?.as_str()?.to_string();
    if drive_id.is_empty() || item.id.is_empty() {
        return None;
    }
    let parent_path = parent
        .get("path")
        .and_then(|v| v.as_str())
        .and_then(|path| path.split_once("root:").map(|(_, relative)| relative))
        .map(decode_parent_path);
    Some(FileCandidate {
        hit: SearchFileHit {
            item,
            drive_id,
            // Missing display metadata must not prevent selecting an accessible file.
            drive_name: String::new(),
            site_name: None,
            parent_path,
        },
        site_id: parent
            .get("siteId")
            .and_then(|v| v.as_str())
            .map(str::to_string),
    })
}

fn decode_parent_path(path: &str) -> String {
    if path.is_empty() {
        "/".to_string()
    } else {
        percent_decode_str(path).decode_utf8_lossy().into_owned()
    }
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

/// One Microsoft Search request per page, regardless of the number of drives.
/// https://learn.microsoft.com/graph/search-concept-files
async fn search_files(
    client: &reqwest::Client,
    token: &str,
    graph_base_url: &str,
    query: &str,
    deadline: Instant,
) -> Result<FileSearchResults, StatusCode> {
    let started = Instant::now();
    let mut results = FileSearchResults::default();
    let mut seen = HashSet::new();
    for page in 0..MAX_SEARCH_PAGES {
        let body = serde_json::json!({"requests": [{
            "entityTypes": ["driveItem"],
            "query": {"queryString": filename_query(query)},
            "from": page * PAGE_SIZE, "size": PAGE_SIZE,
            "fields": ["id", "name", "size", "webUrl", "file", "folder",
                "parentReference", "lastModifiedDateTime", "remoteItem"]
        }]});
        let response = timeout_at(
            deadline,
            fetch_search_json(
                client,
                token,
                &format!("{graph_base_url}/search/query"),
                Some(&body),
            ),
        )
        .await
        .unwrap_or(Err(StatusCode::GATEWAY_TIMEOUT));
        let parsed = response.and_then(parse_search_page);
        let (resources, more) = match parsed {
            Ok(page) => page,
            Err(StatusCode::UNAUTHORIZED) => return Err(StatusCode::UNAUTHORIZED),
            Err(error) if page == 0 => return Err(error),
            Err(_) => {
                results.partial = true;
                results.truncated = true;
                break;
            }
        };
        for resource in resources {
            if let Some(candidate) = parse_search_hit(&resource, query)
                && seen.insert((
                    candidate.hit.drive_id.clone(),
                    candidate.hit.item.id.clone(),
                ))
            {
                results.hits.push(candidate);
            }
        }
        if results.hits.len() >= MAX_FILES {
            results.truncated = results.hits.len() > MAX_FILES || more;
            results.hits.truncate(MAX_FILES);
            break;
        }
        if !more {
            break;
        }
        results.truncated = page + 1 == MAX_SEARCH_PAGES;
    }
    tracing::info!(
        elapsed_ms = started.elapsed().as_millis() as u64,
        file_count = results.hits.len(),
        partial = results.partial,
        truncated = results.truncated,
        "Completed Microsoft Search file query"
    );
    Ok(results)
}

fn parse_search_page(
    body: serde_json::Value,
) -> Result<(Vec<serde_json::Value>, bool), StatusCode> {
    let responses = body
        .get("value")
        .and_then(|v| v.as_array())
        .ok_or(StatusCode::BAD_GATEWAY)?;
    if responses.len() != 1 {
        return Err(StatusCode::BAD_GATEWAY);
    }
    let containers = responses[0]
        .get("hitsContainers")
        .and_then(|v| v.as_array())
        .ok_or(StatusCode::BAD_GATEWAY)?;
    let mut resources = Vec::new();
    let mut more = false;
    for container in containers {
        more |= container
            .get("moreResultsAvailable")
            .and_then(|v| v.as_bool())
            .ok_or(StatusCode::BAD_GATEWAY)?;
        if let Some(hits) = container.get("hits").and_then(|v| v.as_array()) {
            for hit in hits {
                resources.push(hit.get("resource").ok_or(StatusCode::BAD_GATEWAY)?.clone());
            }
        } else if container.get("total").and_then(|v| v.as_u64()) != Some(0) {
            return Err(StatusCode::BAD_GATEWAY);
        }
    }
    Ok((resources, more))
}

async fn enrich_file_hits(
    client: &reqwest::Client,
    token: &str,
    graph_base_url: &str,
    results: &mut FileSearchResults,
    deadline: Instant,
) -> Result<(), StatusCode> {
    let drive_ids: HashSet<_> = results
        .hits
        .iter()
        .map(|c| c.hit.drive_id.clone())
        .collect();
    let site_ids: HashSet<_> = results
        .hits
        .iter()
        .filter_map(|c| c.site_id.clone())
        .collect();
    let requests = drive_ids
        .into_iter()
        .map(|id| (true, id))
        .chain(site_ids.into_iter().map(|id| (false, id)))
        .map(|(is_drive, id)| async move {
            let kind = if is_drive { "drives" } else { "sites" };
            let encoded = utf8_percent_encode(&id, NON_ALPHANUMERIC);
            let fields = if is_drive {
                "id,name,webUrl"
            } else {
                "id,displayName"
            };
            let url = format!("{graph_base_url}/{kind}/{encoded}?$select={fields}");
            let response = timeout_at(deadline, fetch_search_json(client, token, &url, None))
                .await
                .unwrap_or(Err(StatusCode::GATEWAY_TIMEOUT));
            (is_drive, id, response)
        });
    let mut pending = stream::iter(requests).buffer_unordered(5);
    let mut drives = HashMap::new();
    let mut sites = HashMap::new();
    while let Some((is_drive, id, response)) = pending.next().await {
        match response {
            Ok(metadata) if is_drive => {
                drives.insert(id, metadata);
            }
            Ok(metadata) => {
                sites.insert(id, metadata);
            }
            Err(StatusCode::UNAUTHORIZED) => return Err(StatusCode::UNAUTHORIZED),
            Err(_) => {
                results.partial = true;
            }
        }
    }
    results.hits.retain_mut(|candidate| {
        let hit = &mut candidate.hit;
        if let Some(drive) = drives.get(&hit.drive_id) {
            if let Some(name) = drive.get("name").and_then(|v| v.as_str()) {
                if should_filter_drive_name(name) {
                    return false;
                }
                hit.drive_name = name.to_string();
            }
            if hit.parent_path.is_none() {
                hit.parent_path = hit
                    .item
                    .web_url
                    .as_deref()
                    .zip(drive.get("webUrl").and_then(|v| v.as_str()))
                    .and_then(|(file, drive)| parent_path_from_web_url(file, drive))
                    .map(|path| decode_parent_path(&path));
            }
        }
        hit.site_name = candidate
            .site_id
            .as_ref()
            .and_then(|id| sites.get(id))
            .and_then(|site| site.get("displayName"))
            .and_then(|v| v.as_str())
            .map(str::to_string);
        true
    });
    Ok(())
}

async fn fetch_search_json(
    client: &reqwest::Client,
    token: &str,
    url: &str,
    body: Option<&serde_json::Value>,
) -> Result<serde_json::Value, StatusCode> {
    for attempt in 0..2 {
        let request = match body {
            Some(body) => client.post(url).json(body),
            None => client.get(url),
        };
        let response = request
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
            // Do not retry earlier than Graph requested; long waits fail this request.
            if delay > 5 {
                return Err(StatusCode::BAD_GATEWAY);
            }
            tokio::time::sleep(Duration::from_secs(delay)).await;
            continue;
        }
        if !status.is_success() {
            tracing::warn!(%status, "Microsoft Graph search or result metadata request failed");
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
    use axum::{Router, routing::post};
    use serde_json::{Value, json};
    use std::sync::{Arc, Mutex};

    fn file(drive: &str, name: &str) -> Value {
        json!({"id": "same-id", "name": name, "file": {"mimeType": "application/pdf"},
            "webUrl": "https://example.com/Documents/Annual%20reports/Budget.pdf",
            "parentReference": {"driveId": drive, "siteId": "site"}})
    }

    fn page(resources: Vec<Value>, more: bool) -> Value {
        json!({"value": [{"hitsContainers": [{"hits": resources.into_iter()
            .map(|resource| json!({"resource": resource})).collect::<Vec<_>>(),
            "moreResultsAvailable": more}]}]})
    }

    async fn serve(app: Router) -> (String, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (url, task)
    }

    async fn mock_search(
        responses: Vec<(StatusCode, Value)>,
    ) -> (String, tokio::task::JoinHandle<()>, Arc<Mutex<Vec<Value>>>) {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let recorded = calls.clone();
        let app = Router::new().route(
            "/search/query",
            post(
                move |headers: axum::http::HeaderMap, Json(body): Json<Value>| {
                    let recorded = recorded.clone();
                    let responses = responses.clone();
                    async move {
                        assert_eq!(headers["authorization"], "Bearer test");
                        let mut calls = recorded.lock().unwrap();
                        let index = calls.len();
                        calls.push(body);
                        let (status, body) = responses
                            .get(index)
                            .unwrap_or_else(|| responses.last().unwrap());
                        (*status, Json(body.clone()))
                    }
                },
            ),
        );
        let (url, task) = serve(app).await;
        (url, task, calls)
    }

    #[tokio::test]
    async fn one_request_searches_multiple_drives_and_preserves_canonical_ids() {
        let mut folder = file("finance", "Budget folder");
        folder["folder"] = json!({});
        let remote = json!({"id": "shortcut", "remoteItem": file("sales", "Budget.pdf")});
        let (url, task, calls) = mock_search(vec![(
            StatusCode::OK,
            page(
                vec![
                    file("finance", "Budget.pdf"),
                    file("finance", "Budget.pdf"),
                    remote,
                    folder,
                    file("sales", "Contents-only.pdf"),
                ],
                false,
            ),
        )])
        .await;
        let results = search_files(
            &reqwest::Client::new(),
            "test",
            &url,
            "Budget",
            Instant::now() + Duration::from_secs(5),
        )
        .await
        .unwrap();
        task.abort();
        assert_eq!(results.hits.len(), 2);
        assert_eq!(results.hits[0].hit.drive_id, "finance");
        assert_eq!(results.hits[1].hit.drive_id, "sales");
        assert_eq!(results.hits[1].hit.item.id, "same-id");
        assert!(!results.partial && !results.truncated);
        let calls = calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0]["requests"][0]["entityTypes"], json!(["driveItem"]));
        assert_eq!(
            calls[0]["requests"][0]["query"]["queryString"],
            "filename:\"Budget*\" AND isDocument=true"
        );
        assert_eq!(calls[0]["requests"][0]["size"], 100);
    }

    #[tokio::test]
    async fn follows_global_pages_even_when_first_page_has_no_filename_matches() {
        let (url, task, calls) = mock_search(vec![
            (
                StatusCode::OK,
                page(vec![file("finance", "Contents-only.pdf")], true),
            ),
            (
                StatusCode::OK,
                page(vec![file("sales", "Budget.pdf")], false),
            ),
        ])
        .await;
        let results = search_files(
            &reqwest::Client::new(),
            "test",
            &url,
            "Budget",
            Instant::now() + Duration::from_secs(5),
        )
        .await
        .unwrap();
        task.abort();
        assert_eq!(results.hits.len(), 1);
        assert!(!results.partial && !results.truncated);
        let calls = calls.lock().unwrap();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0]["requests"][0]["from"], 0);
        assert_eq!(calls[1]["requests"][0]["from"], 100);
    }

    #[tokio::test]
    async fn preserves_successful_pages_on_failure_but_propagates_auth_expiry() {
        for status in [StatusCode::FORBIDDEN, StatusCode::UNAUTHORIZED] {
            let (url, task, _) = mock_search(vec![
                (
                    StatusCode::OK,
                    page(vec![file("sales", "Budget.pdf")], true),
                ),
                (status, json!({})),
            ])
            .await;
            let result = search_files(
                &reqwest::Client::new(),
                "test",
                &url,
                "Budget",
                Instant::now() + Duration::from_secs(5),
            )
            .await;
            task.abort();
            if status == StatusCode::UNAUTHORIZED {
                assert!(matches!(result, Err(StatusCode::UNAUTHORIZED)));
            } else {
                let result = result.unwrap();
                assert_eq!(result.hits.len(), 1);
                assert!(result.partial && result.truncated);
            }
        }
    }

    #[tokio::test]
    async fn caps_global_results_and_pages() {
        let resources = (0..101)
            .map(|i| file(&format!("drive-{i}"), "Budget.pdf"))
            .collect();
        let (url, task, calls) = mock_search(vec![(StatusCode::OK, page(resources, true))]).await;
        let result = search_files(
            &reqwest::Client::new(),
            "test",
            &url,
            "Budget",
            Instant::now() + Duration::from_secs(5),
        )
        .await
        .unwrap();
        task.abort();
        assert_eq!(result.hits.len(), MAX_FILES);
        assert!(result.truncated);
        assert_eq!(calls.lock().unwrap().len(), 1);

        let (url, task, calls) = mock_search(vec![(StatusCode::OK, page(vec![], true))]).await;
        let result = search_files(
            &reqwest::Client::new(),
            "test",
            &url,
            "Budget",
            Instant::now() + Duration::from_secs(5),
        )
        .await
        .unwrap();
        task.abort();
        assert!(result.hits.is_empty() && result.truncated);
        assert_eq!(calls.lock().unwrap().len(), MAX_SEARCH_PAGES);
    }

    #[tokio::test]
    async fn metadata_is_fetched_once_per_result_drive_and_site_and_failures_keep_hits() {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let recorded = calls.clone();
        let app = Router::new().fallback(move |uri: axum::http::Uri| {
            let recorded = recorded.clone();
            async move {
                recorded.lock().unwrap().push(uri.path().to_string());
                match uri.path() {
                    "/drives/finance" => (
                        StatusCode::OK,
                        Json(
                            json!({"name": "Documents", "webUrl": "https://example.com/Documents"}),
                        ),
                    ),
                    "/sites/site" => (StatusCode::OK, Json(json!({"displayName": "Finance"}))),
                    _ => (StatusCode::FORBIDDEN, Json(json!({}))),
                }
            }
        });
        let (url, task) = serve(app).await;
        let mut results = FileSearchResults {
            hits: vec![
                parse_search_hit(&file("finance", "Budget.pdf"), "Budget").unwrap(),
                parse_search_hit(&file("finance", "Budget 2.pdf"), "Budget").unwrap(),
                parse_search_hit(&file("sales", "Budget.pdf"), "Budget").unwrap(),
            ],
            ..Default::default()
        };
        enrich_file_hits(
            &reqwest::Client::new(),
            "test",
            &url,
            &mut results,
            Instant::now() + Duration::from_secs(5),
        )
        .await
        .unwrap();
        task.abort();
        assert_eq!(calls.lock().unwrap().len(), 3);
        assert_eq!(results.hits.len(), 3);
        assert!(results.partial);
        assert_eq!(results.hits[0].hit.drive_name, "Documents");
        assert_eq!(results.hits[0].hit.site_name.as_deref(), Some("Finance"));
        assert_eq!(
            results.hits[0].hit.parent_path.as_deref(),
            Some("/Annual reports")
        );
    }

    #[tokio::test]
    async fn search_deadline_bounds_slow_graph_calls() {
        let app = Router::new().route(
            "/search/query",
            post(|| async {
                tokio::time::sleep(Duration::from_secs(5)).await;
                Json(page(vec![], false))
            }),
        );
        let (url, task) = serve(app).await;
        let started = Instant::now();
        let result = search_files(
            &reqwest::Client::new(),
            "test",
            &url,
            "Budget",
            started + Duration::from_millis(50),
        )
        .await;
        task.abort();
        assert!(matches!(result, Err(StatusCode::GATEWAY_TIMEOUT)));
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn kql_input_cannot_escape_the_filename_phrase() {
        assert_eq!(
            filename_query("O'Brien & 日本?#"),
            "filename:\"O'Brien & 日本?#*\" AND isDocument=true"
        );
        let query = filename_query("Budget\" OR path:* \\");
        assert_eq!(query.matches('"').count(), 2);
        assert_eq!(query, "filename:\"Budget OR path:*\" AND isDocument=true");
        assert!(
            parse_search_hit(&json!({"id":"id", "name":"Budget", "file":{}}), "Budget").is_none()
        );
    }

    #[test]
    fn malformed_search_response_is_not_an_empty_success() {
        assert!(parse_search_page(json!({})).is_err());
        assert!(parse_search_page(json!({"value":[{"error":{"code":"BadRequest"}}]})).is_err());
        assert!(
            parse_search_page(
                json!({"value":[{"hitsContainers":[{"total":0,"moreResultsAvailable":false}]}]})
            )
            .is_ok()
        );
    }

    #[test]
    fn root_paths_and_url_fallback_require_the_same_library() {
        let mut raw = file("finance", "Budget.pdf");
        raw["parentReference"]["path"] = json!("/drives/finance/root:");
        assert_eq!(
            parse_search_hit(&raw, "Budget")
                .unwrap()
                .hit
                .parent_path
                .as_deref(),
            Some("/")
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
                "https://other.com/docs/Budget.pdf",
                "https://example.com/docs"
            )
            .is_none()
        );
        assert!(
            parent_path_from_web_url(
                "https://example.com/docs-other/Budget.pdf",
                "https://example.com/docs"
            )
            .is_none()
        );
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
}
