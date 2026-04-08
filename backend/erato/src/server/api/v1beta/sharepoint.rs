//! Sharepoint/OneDrive integration routes.
//!
//! These routes allow users to browse their OneDrive and Sharepoint files
//! and attach them to chats.

use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::{Extension, Json};
use chrono::{DateTime, FixedOffset};
use graph_rs_sdk::{GraphClient, GraphClientConfiguration};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use utoipa::ToSchema;

const GRAPH_API_BASE_URL: &str = "https://graph.microsoft.com/v1.0";
const FILTERED_DRIVE_NAMES: &[&str] = &["PersonalCacheLibrary"];

/// A drive accessible to the user (OneDrive, Sharepoint, etc.)
#[derive(Debug, Serialize, ToSchema)]
pub struct Drive {
    /// The unique ID of the drive
    pub id: String,
    /// The display name of the drive
    pub name: String,
    /// The type of drive (e.g., "personal", "documentLibrary")
    pub drive_type: String,
    /// Best-effort classification of the drive based on Graph drive, site, and group metadata
    pub kind: String,
    /// The owner of the drive, if available
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub owner_name: Option<String>,
    /// The SharePoint site name for document libraries, if available
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub site_name: Option<String>,
    /// The web URL to access this drive in OneDrive/SharePoint
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub web_url: Option<String>,
}

/// A drive item (file or folder)
#[derive(Debug, Serialize, ToSchema)]
pub struct DriveItem {
    /// The unique ID of the item
    pub id: String,
    /// The name of the item
    pub name: String,
    /// Whether this item is a folder
    pub is_folder: bool,
    /// The size in bytes (for files)
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub size: Option<i64>,
    /// The MIME type (for files)
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub mime_type: Option<String>,
    /// When the item was last modified
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub last_modified: Option<DateTime<FixedOffset>>,
    /// The web URL to access this item
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub web_url: Option<String>,
}

/// Response for the all-drives endpoint
#[derive(Debug, Serialize, ToSchema)]
pub struct AllDrivesResponse {
    /// List of drives accessible to the user
    pub drives: Vec<Drive>,
}

/// Response for drive items endpoints
#[derive(Debug, Serialize, ToSchema)]
pub struct DriveItemsResponse {
    /// List of items in the drive or folder
    pub items: Vec<DriveItem>,
}

/// Response for a single drive item
#[derive(Debug, Serialize, ToSchema)]
pub struct DriveItemResponse {
    /// The drive item details
    #[serde(flatten)]
    pub item: DriveItem,
    /// The drive ID this item belongs to
    pub drive_id: String,
}

/// Helper to extract access token from the user profile.
///
/// In the current implementation, we expect the access token to be available
/// via the authentication flow that authenticated the user.
fn get_access_token(me_user: &MeProfile) -> Result<&str, StatusCode> {
    me_user.access_token.as_deref().ok_or_else(|| {
        tracing::error!("No access token available for Sharepoint integration");
        StatusCode::UNAUTHORIZED
    })
}

/// Check if Sharepoint integration is enabled in the config.
fn check_sharepoint_enabled(app_state: &AppState) -> Result<(), StatusCode> {
    if !app_state
        .config
        .integrations
        .experimental_sharepoint
        .enabled
    {
        tracing::warn!("Sharepoint integration is not enabled");
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(())
}

/// Create a GraphClient with the user's access token.
fn create_graph_client(access_token: &str) -> GraphClient {
    GraphClient::from(
        GraphClientConfiguration::new()
            .access_token(access_token)
            .connection_verbose(true),
    )
}

/// Parse a drive item from the MS Graph API response.
fn parse_drive_item(item: &serde_json::Value) -> Option<DriveItem> {
    let id = item.get("id")?.as_str()?.to_string();
    let name = item.get("name")?.as_str()?.to_string();
    let is_folder = item.get("folder").is_some();

    let size = if !is_folder {
        item.get("size").and_then(|v| v.as_i64())
    } else {
        None
    };

    let mime_type = item
        .get("file")
        .and_then(|f| f.get("mimeType"))
        .and_then(|v| v.as_str())
        .map(String::from);

    let last_modified = item
        .get("lastModifiedDateTime")
        .and_then(|v| v.as_str())
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok());

    let web_url = item
        .get("webUrl")
        .and_then(|v| v.as_str())
        .map(String::from);

    Some(DriveItem {
        id,
        name,
        is_folder,
        size,
        mime_type,
        last_modified,
        web_url,
    })
}

#[derive(Debug, Default)]
struct DriveEnrichmentContext {
    group_metadata_by_id: HashMap<String, GroupMetadata>,
    site_metadata_by_id: HashMap<String, SiteMetadata>,
    site_ids_by_drive_id: HashMap<String, String>,
}

#[derive(Debug, Clone)]
struct DriveCandidate {
    raw_drive: serde_json::Value,
}

#[derive(Debug, Clone)]
struct GroupMetadata {
    display_name: String,
    is_unified_group: bool,
    has_team: bool,
}

#[derive(Debug, Clone)]
struct SiteMetadata {
    display_name: String,
    is_personal_site: bool,
}

fn should_filter_drive_name(name: &str) -> bool {
    FILTERED_DRIVE_NAMES
        .iter()
        .any(|filtered| filtered == &name)
}

fn extract_drive_id(drive: &serde_json::Value) -> Option<String> {
    drive.get("id")?.as_str().map(String::from)
}

fn extract_drive_name(drive: &serde_json::Value) -> Option<String> {
    drive.get("name")?.as_str().map(String::from)
}

fn extract_group_id(drive: &serde_json::Value) -> Option<String> {
    drive
        .get("owner")
        .and_then(|o| o.get("group"))
        .and_then(|g| g.get("id"))
        .and_then(|v| v.as_str())
        .map(String::from)
}

fn extract_site_id(drive: &serde_json::Value) -> Option<String> {
    drive
        .get("sharePointIds")
        .and_then(|ids| ids.get("siteId"))
        .and_then(|v| v.as_str())
        .map(String::from)
}

fn set_sharepoint_site_id(drive: &mut serde_json::Value, site_id: &str) {
    if extract_site_id(drive).is_some() {
        return;
    }

    if drive.get("sharePointIds").is_none() {
        drive["sharePointIds"] = serde_json::json!({});
    }

    drive["sharePointIds"]["siteId"] = serde_json::Value::String(site_id.to_string());
}

fn classify_drive_kind(
    drive: &serde_json::Value,
    drive_type: &str,
    owner_user_name: Option<&str>,
    site_metadata: Option<&SiteMetadata>,
    group_metadata: Option<&GroupMetadata>,
) -> String {
    let web_url = drive
        .get("webUrl")
        .and_then(|v| v.as_str())
        .unwrap_or_default();

    if web_url.contains("/Lists/") {
        return "sharepoint_list".to_string();
    }

    if site_metadata.is_some_and(|site| site.is_personal_site)
        || web_url.contains("-my.sharepoint.com/personal/")
        || (drive_type == "business" && owner_user_name.is_some())
    {
        return "personal_onedrive".to_string();
    }

    if group_metadata.is_some_and(|group| group.has_team) {
        return "teams_group_library".to_string();
    }

    if group_metadata.is_some_and(|group| group.is_unified_group) {
        return "microsoft_365_group_library".to_string();
    }

    if drive_type == "documentLibrary" {
        return "sharepoint_site_library".to_string();
    }

    if drive_type == "business" {
        return "business_library".to_string();
    }

    "other".to_string()
}

/// Parse a drive from the MS Graph API response.
fn parse_drive(drive: &serde_json::Value, enrichment: &DriveEnrichmentContext) -> Option<Drive> {
    let id = drive.get("id")?.as_str()?.to_string();
    let name = drive.get("name")?.as_str()?.to_string();
    let drive_type = drive
        .get("driveType")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();

    let owner_user_name = drive
        .get("owner")
        .and_then(|o| o.get("user"))
        .and_then(|u| u.get("displayName"))
        .and_then(|v| v.as_str())
        .map(String::from);

    let group_metadata =
        extract_group_id(drive).and_then(|group_id| enrichment.group_metadata_by_id.get(&group_id));

    let owner_name = owner_user_name
        .clone()
        .or_else(|| group_metadata.map(|group_metadata| group_metadata.display_name.clone()))
        .or_else(|| {
            drive
                .get("owner")
                .and_then(|o| o.get("group"))
                .and_then(|g| g.get("displayName"))
                .and_then(|v| v.as_str())
                .map(String::from)
        });

    let site_metadata = enrichment
        .site_ids_by_drive_id
        .get(&id)
        .and_then(|site_id| enrichment.site_metadata_by_id.get(site_id))
        .or_else(|| {
            extract_site_id(drive).and_then(|site_id| enrichment.site_metadata_by_id.get(&site_id))
        });

    let site_name = site_metadata.map(|site_metadata| site_metadata.display_name.clone());

    let web_url = drive
        .get("webUrl")
        .and_then(|v| v.as_str())
        .map(String::from);
    let kind = classify_drive_kind(
        drive,
        &drive_type,
        owner_user_name.as_deref(),
        site_metadata,
        group_metadata,
    );

    Some(Drive {
        id,
        name,
        drive_type,
        kind,
        owner_name,
        site_name,
        web_url,
    })
}

fn add_drive(
    drive_candidates_by_id: &mut HashMap<String, DriveCandidate>,
    enrichment: &mut DriveEnrichmentContext,
    discovered_site_ids: &mut HashSet<String>,
    discovery_source: &str,
    drive: &serde_json::Value,
) {
    let drive_name = extract_drive_name(drive);

    tracing::trace!(
        discovery_source,
        drive_id = drive.get("id").and_then(|v| v.as_str()),
        drive_name = drive_name.as_deref(),
        drive_type = drive.get("driveType").and_then(|v| v.as_str()),
        owner_user = drive
            .get("owner")
            .and_then(|owner| owner.get("user"))
            .and_then(|user| user.get("displayName"))
            .and_then(|v| v.as_str()),
        owner_group = drive
            .get("owner")
            .and_then(|owner| owner.get("group"))
            .and_then(|group| group.get("displayName"))
            .and_then(|v| v.as_str()),
        site_id = drive
            .get("sharePointIds")
            .and_then(|ids| ids.get("siteId"))
            .and_then(|v| v.as_str()),
        list_id = drive
            .get("sharePointIds")
            .and_then(|ids| ids.get("listId"))
            .and_then(|v| v.as_str()),
        web_url = drive.get("webUrl").and_then(|v| v.as_str()),
        quota_state = drive
            .get("quota")
            .and_then(|quota| quota.get("state"))
            .and_then(|v| v.as_str()),
        raw_drive = %drive,
        "Discovered Microsoft Graph drive candidate"
    );

    if let Some(name) = drive_name.as_deref()
        && should_filter_drive_name(name)
    {
        tracing::trace!(
            discovery_source,
            filtered_drive_name = name,
            drive_id = drive.get("id").and_then(|v| v.as_str()),
            "Filtered Microsoft Graph drive candidate by name"
        );
        return;
    }

    if let Some(site_id) = extract_site_id(drive) {
        discovered_site_ids.insert(site_id.clone());
        if let Some(drive_id) = extract_drive_id(drive) {
            enrichment.site_ids_by_drive_id.insert(drive_id, site_id);
        }
    }

    if let Some(drive_id) = extract_drive_id(drive) {
        drive_candidates_by_id
            .entry(drive_id)
            .or_insert_with(|| DriveCandidate {
                raw_drive: drive.clone(),
            });
    }
}

fn collect_shared_item_references(
    item: &serde_json::Value,
    discovered_drive_ids: &mut HashSet<String>,
    discovered_site_ids: &mut HashSet<String>,
) {
    let remote_item = item.get("remoteItem").unwrap_or(item);

    if let Some(drive_id) = remote_item
        .get("parentReference")
        .and_then(|parent| parent.get("driveId"))
        .and_then(|v| v.as_str())
    {
        discovered_drive_ids.insert(drive_id.to_string());
    }

    if let Some(site_id) = remote_item
        .get("sharepointIds")
        .and_then(|ids| ids.get("siteId"))
        .and_then(|v| v.as_str())
        .or_else(|| {
            remote_item
                .get("parentReference")
                .and_then(|parent| parent.get("siteId"))
                .and_then(|v| v.as_str())
        })
    {
        discovered_site_ids.insert(site_id.to_string());
    }
}

async fn fetch_graph_json(
    http_client: &reqwest_012::Client,
    access_token: &str,
    url: &str,
) -> Result<serde_json::Value, reqwest_012::Error> {
    http_client
        .get(url)
        .bearer_auth(access_token)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await
}

async fn fetch_graph_collection(
    http_client: &reqwest_012::Client,
    access_token: &str,
    path_or_url: &str,
) -> Result<Vec<serde_json::Value>, reqwest_012::Error> {
    let mut next_url = if path_or_url.starts_with("https://") {
        path_or_url.to_string()
    } else {
        format!("{GRAPH_API_BASE_URL}{path_or_url}")
    };
    let mut values = Vec::new();

    loop {
        let body = fetch_graph_json(http_client, access_token, &next_url).await?;

        if let Some(items) = body.get("value").and_then(|value| value.as_array()) {
            values.extend(items.iter().cloned());
        }

        let Some(next_link) = body.get("@odata.nextLink").and_then(|value| value.as_str()) else {
            break;
        };

        next_url = next_link.to_string();
    }

    Ok(values)
}

async fn fetch_graph_drive(
    http_client: &reqwest_012::Client,
    access_token: &str,
    path_or_url: &str,
) -> Result<serde_json::Value, reqwest_012::Error> {
    let url = if path_or_url.starts_with("https://") {
        path_or_url.to_string()
    } else {
        format!("{GRAPH_API_BASE_URL}{path_or_url}")
    };

    fetch_graph_json(http_client, access_token, &url).await
}

async fn fetch_site_name(
    http_client: &reqwest_012::Client,
    access_token: &str,
    site_id: &str,
) -> Option<SiteMetadata> {
    let path = format!("/sites/{site_id}");
    match fetch_graph_drive(http_client, access_token, &path).await {
        Ok(site) => Some(SiteMetadata {
            display_name: site
                .get("displayName")
                .and_then(|value| value.as_str())
                .map(String::from)
                .unwrap_or_else(|| site_id.to_string()),
            is_personal_site: site
                .get("isPersonalSite")
                .and_then(|value| value.as_bool())
                .unwrap_or(false),
        }),
        Err(e) => {
            tracing::warn!("Failed to fetch site metadata for {}: {:?}", site_id, e);
            None
        }
    }
}

async fn fetch_group_name(
    http_client: &reqwest_012::Client,
    access_token: &str,
    group_id: &str,
) -> Option<GroupMetadata> {
    let path = format!("/groups/{group_id}");
    match fetch_graph_drive(http_client, access_token, &path).await {
        Ok(group) => {
            let group_types = group
                .get("groupTypes")
                .and_then(|value| value.as_array())
                .cloned()
                .unwrap_or_default();
            let resource_provisioning_options = group
                .get("resourceProvisioningOptions")
                .and_then(|value| value.as_array())
                .cloned()
                .unwrap_or_default();

            Some(GroupMetadata {
                display_name: group
                    .get("displayName")
                    .and_then(|value| value.as_str())
                    .map(String::from)
                    .unwrap_or_else(|| group_id.to_string()),
                is_unified_group: group_types
                    .iter()
                    .any(|value| value.as_str() == Some("Unified")),
                has_team: resource_provisioning_options
                    .iter()
                    .any(|value| value.as_str() == Some("Team")),
            })
        }
        Err(e) => {
            tracing::warn!("Failed to fetch group metadata for {}: {:?}", group_id, e);
            None
        }
    }
}

/// Get all drives accessible to the user.
///
/// This exhaustively walks the Microsoft Graph drive discovery surfaces that are
/// relevant for the current user:
/// - `GET /me/drive`: https://learn.microsoft.com/graph/api/drive-get
/// - `GET /me/drives`, `GET /groups/{id}/drives`, `GET /sites/{id}/drives`:
///   https://learn.microsoft.com/graph/api/drive-list
/// - `GET /me/drive/sharedWithMe()`: https://learn.microsoft.com/graph/api/drive-sharedwithme
/// - `GET /me/joinedTeams`: https://learn.microsoft.com/graph/api/user-list-joinedteams
/// - `GET /sites?search=*`: https://learn.microsoft.com/graph/api/site-search
#[utoipa::path(
    get,
    path = "/integrations/sharepoint/all-drives",
    tag = "sharepoint",
    responses(
        (status = OK, body = AllDrivesResponse, description = "List of accessible drives"),
        (status = UNAUTHORIZED, description = "No access token available"),
        (status = NOT_FOUND, description = "Sharepoint integration is not enabled"),
        (status = INTERNAL_SERVER_ERROR, description = "Failed to retrieve drives")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn all_drives(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
) -> Result<Json<AllDrivesResponse>, StatusCode> {
    check_sharepoint_enabled(&app_state)?;
    let access_token = get_access_token(&me_user)?;
    let client = create_graph_client(access_token);
    let http_client = reqwest_012::Client::new();
    let mut drive_candidates_by_id = HashMap::new();
    let mut enrichment = DriveEnrichmentContext::default();
    let mut discovered_drive_ids = HashSet::new();
    let mut discovered_site_ids = HashSet::new();
    let mut discovered_group_ids = HashSet::new();

    // Get the user's personal OneDrive
    match client.me().drive().get_drive().send().await {
        Ok(response) => {
            if let Ok(drive_json) = response.json::<serde_json::Value>().await {
                add_drive(
                    &mut drive_candidates_by_id,
                    &mut enrichment,
                    &mut discovered_site_ids,
                    "me/drive",
                    &drive_json,
                );
            }
        }
        Err(e) => {
            tracing::warn!("Failed to get personal OneDrive: {:?}", e);
        }
    }

    match fetch_graph_collection(&http_client, access_token, "/me/drives").await {
        Ok(drives) => {
            for drive in drives {
                add_drive(
                    &mut drive_candidates_by_id,
                    &mut enrichment,
                    &mut discovered_site_ids,
                    "me/drives",
                    &drive,
                );
            }
        }
        Err(e) => {
            tracing::warn!("Failed to list /me/drives: {:?}", e);
        }
    }

    match fetch_graph_collection(&http_client, access_token, "/me/joinedTeams?$select=id").await {
        Ok(joined_teams) => {
            for team in joined_teams {
                if let Some(group_id) = team.get("id").and_then(|value| value.as_str()) {
                    discovered_group_ids.insert(group_id.to_string());
                }
            }
        }
        Err(e) => {
            tracing::warn!("Failed to list /me/joinedTeams: {:?}", e);
        }
    }

    for group_id in discovered_group_ids {
        let path = format!("/groups/{group_id}/drives");
        match fetch_graph_collection(&http_client, access_token, &path).await {
            Ok(group_drives) => {
                for drive in group_drives {
                    add_drive(
                        &mut drive_candidates_by_id,
                        &mut enrichment,
                        &mut discovered_site_ids,
                        "groups/{id}/drives",
                        &drive,
                    );
                }
            }
            Err(e) => {
                tracing::warn!("Failed to list group drives for {}: {:?}", group_id, e);
            }
        }
    }

    match fetch_graph_collection(&http_client, access_token, "/sites?search=*").await {
        Ok(sites) => {
            for site in sites {
                if let Some(site_id) = site.get("id").and_then(|value| value.as_str()) {
                    discovered_site_ids.insert(site_id.to_string());
                    enrichment.site_metadata_by_id.insert(
                        site_id.to_string(),
                        SiteMetadata {
                            display_name: site
                                .get("displayName")
                                .and_then(|value| value.as_str())
                                .map(String::from)
                                .unwrap_or_else(|| site_id.to_string()),
                            is_personal_site: site
                                .get("isPersonalSite")
                                .and_then(|value| value.as_bool())
                                .unwrap_or(false),
                        },
                    );
                }
            }
        }
        Err(e) => {
            tracing::warn!("Failed to search /sites?search=*: {:?}", e);
        }
    }

    match fetch_graph_collection(&http_client, access_token, "/me/drive/sharedWithMe()").await {
        Ok(shared_items) => {
            for item in &shared_items {
                collect_shared_item_references(
                    item,
                    &mut discovered_drive_ids,
                    &mut discovered_site_ids,
                );
            }
        }
        Err(e) => {
            tracing::warn!("Failed to list /me/drive/sharedWithMe(): {:?}", e);
        }
    }

    for site_id in discovered_site_ids {
        if !enrichment.site_metadata_by_id.contains_key(&site_id)
            && let Some(site_metadata) = fetch_site_name(&http_client, access_token, &site_id).await
        {
            enrichment
                .site_metadata_by_id
                .insert(site_id.clone(), site_metadata);
        }

        let path = format!("/sites/{site_id}/drives");
        match fetch_graph_collection(&http_client, access_token, &path).await {
            Ok(site_drives) => {
                let mut ignored_site_ids = HashSet::new();
                for drive in site_drives {
                    let mut drive = drive;
                    set_sharepoint_site_id(&mut drive, &site_id);
                    add_drive(
                        &mut drive_candidates_by_id,
                        &mut enrichment,
                        &mut ignored_site_ids,
                        "sites/{id}/drives",
                        &drive,
                    );
                }
            }
            Err(e) => {
                tracing::warn!("Failed to list site drives for {}: {:?}", site_id, e);
            }
        }
    }

    for drive_id in discovered_drive_ids {
        let path = format!("/drives/{drive_id}");
        match fetch_graph_drive(&http_client, access_token, &path).await {
            Ok(drive) => {
                let mut ignored_site_ids = HashSet::new();
                add_drive(
                    &mut drive_candidates_by_id,
                    &mut enrichment,
                    &mut ignored_site_ids,
                    "sharedWithMe -> drives/{id}",
                    &drive,
                );
            }
            Err(e) => {
                tracing::warn!("Failed to fetch shared drive {}: {:?}", drive_id, e);
            }
        }
    }

    let group_ids: HashSet<_> = drive_candidates_by_id
        .values()
        .filter_map(|candidate| extract_group_id(&candidate.raw_drive))
        .collect();

    for group_id in group_ids {
        if let Some(group_metadata) = fetch_group_name(&http_client, access_token, &group_id).await
        {
            enrichment
                .group_metadata_by_id
                .insert(group_id, group_metadata);
        }
    }

    let mut drives: Vec<_> = drive_candidates_by_id
        .into_values()
        .filter_map(|candidate| parse_drive(&candidate.raw_drive, &enrichment))
        .collect();
    drives.sort_by(|left, right| left.name.cmp(&right.name).then(left.id.cmp(&right.id)));

    tracing::trace!(
        drive_count = drives.len(),
        drives = ?drives,
        "Returning deduplicated SharePoint drives"
    );

    Ok(Json(AllDrivesResponse { drives }))
}

/// Get the root items of a specific drive.
#[utoipa::path(
    get,
    path = "/integrations/sharepoint/drives/{drive_id}",
    tag = "sharepoint",
    params(
        ("drive_id" = String, Path, description = "The ID of the drive")
    ),
    responses(
        (status = OK, body = DriveItemsResponse, description = "List of items in the drive root"),
        (status = UNAUTHORIZED, description = "No access token available"),
        (status = NOT_FOUND, description = "Drive not found or Sharepoint integration is not enabled"),
        (status = INTERNAL_SERVER_ERROR, description = "Failed to retrieve drive items")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn get_drive_root(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Path(drive_id): Path<String>,
) -> Result<Json<DriveItemsResponse>, StatusCode> {
    check_sharepoint_enabled(&app_state)?;
    let access_token = get_access_token(&me_user)?;
    let client = create_graph_client(access_token);

    let response = client
        .drive(&drive_id)
        .item("root")
        .list_children()
        .send()
        .await
        .map_err(|e| {
            tracing::error!("Failed to get drive root items: {:?}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let items_json: serde_json::Value = response.json().await.map_err(|e| {
        tracing::error!("Failed to parse drive items response: {:?}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let items = items_json
        .get("value")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(parse_drive_item).collect())
        .unwrap_or_default();

    Ok(Json(DriveItemsResponse { items }))
}

/// Get details of a specific drive item.
#[utoipa::path(
    get,
    path = "/integrations/sharepoint/drives/{drive_id}/items/{item_id}",
    tag = "sharepoint",
    params(
        ("drive_id" = String, Path, description = "The ID of the drive"),
        ("item_id" = String, Path, description = "The ID of the item")
    ),
    responses(
        (status = OK, body = DriveItemResponse, description = "Drive item details"),
        (status = UNAUTHORIZED, description = "No access token available"),
        (status = NOT_FOUND, description = "Item not found or Sharepoint integration is not enabled"),
        (status = INTERNAL_SERVER_ERROR, description = "Failed to retrieve item")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn get_drive_item(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Path((drive_id, item_id)): Path<(String, String)>,
) -> Result<Json<DriveItemResponse>, StatusCode> {
    check_sharepoint_enabled(&app_state)?;
    let access_token = get_access_token(&me_user)?;
    let client = create_graph_client(access_token);

    let response = client
        .drive(&drive_id)
        .item(&item_id)
        .get_items()
        .send()
        .await
        .map_err(|e| {
            tracing::error!("Failed to get drive item: {:?}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let item_json: serde_json::Value = response.json().await.map_err(|e| {
        tracing::error!("Failed to parse drive item response: {:?}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let item = parse_drive_item(&item_json).ok_or_else(|| {
        tracing::error!("Failed to parse drive item from response");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(DriveItemResponse {
        item,
        drive_id: drive_id.clone(),
    }))
}

/// Get the children of a folder in a drive.
#[utoipa::path(
    get,
    path = "/integrations/sharepoint/drives/{drive_id}/items/{item_id}/children",
    tag = "sharepoint",
    params(
        ("drive_id" = String, Path, description = "The ID of the drive"),
        ("item_id" = String, Path, description = "The ID of the folder")
    ),
    responses(
        (status = OK, body = DriveItemsResponse, description = "List of items in the folder"),
        (status = UNAUTHORIZED, description = "No access token available"),
        (status = NOT_FOUND, description = "Folder not found or Sharepoint integration is not enabled"),
        (status = INTERNAL_SERVER_ERROR, description = "Failed to retrieve folder children")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn get_drive_item_children(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Path((drive_id, item_id)): Path<(String, String)>,
) -> Result<Json<DriveItemsResponse>, StatusCode> {
    check_sharepoint_enabled(&app_state)?;
    let access_token = get_access_token(&me_user)?;
    let client = create_graph_client(access_token);

    let response = client
        .drive(&drive_id)
        .item(&item_id)
        .list_children()
        .send()
        .await
        .map_err(|e| {
            tracing::error!("Failed to get folder children: {:?}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let items_json: serde_json::Value = response.json().await.map_err(|e| {
        tracing::error!("Failed to parse folder children response: {:?}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let items = items_json
        .get("value")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(parse_drive_item).collect())
        .unwrap_or_default();

    Ok(Json(DriveItemsResponse { items }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn collect_shared_item_references_extracts_remote_drive_and_site_ids() {
        let mut drive_ids = HashSet::new();
        let mut site_ids = HashSet::new();

        collect_shared_item_references(
            &json!({
                "remoteItem": {
                    "parentReference": {
                        "driveId": "shared-drive-id"
                    },
                    "sharepointIds": {
                        "siteId": "shared-site-id"
                    }
                }
            }),
            &mut drive_ids,
            &mut site_ids,
        );

        assert!(drive_ids.contains("shared-drive-id"));
        assert!(site_ids.contains("shared-site-id"));
    }

    #[test]
    fn add_drive_deduplicates_by_drive_id() {
        let mut drives_by_id = HashMap::new();
        let mut enrichment = DriveEnrichmentContext::default();
        let mut site_ids = HashSet::new();
        let drive = json!({
            "id": "drive-1",
            "name": "Team Documents",
            "driveType": "documentLibrary",
            "webUrl": "https://example.com/sites/team/Shared%20Documents",
            "sharePointIds": {
                "siteId": "site-1"
            }
        });

        add_drive(
            &mut drives_by_id,
            &mut enrichment,
            &mut site_ids,
            "test",
            &drive,
        );
        add_drive(
            &mut drives_by_id,
            &mut enrichment,
            &mut site_ids,
            "test",
            &drive,
        );

        assert_eq!(drives_by_id.len(), 1);
        assert!(site_ids.contains("site-1"));
    }

    #[test]
    fn parse_drive_uses_enriched_group_and_site_names_and_web_url() {
        let drive = json!({
            "id": "drive-1",
            "name": "Dokumente",
            "driveType": "documentLibrary",
            "webUrl": "https://example.com/sites/team/Shared%20Documents",
            "owner": {
                "group": {
                    "id": "group-1",
                    "displayName": "Owners of Team"
                }
            },
            "sharePointIds": {
                "siteId": "site-1"
            }
        });

        let mut enrichment = DriveEnrichmentContext::default();
        enrichment.group_metadata_by_id.insert(
            "group-1".into(),
            GroupMetadata {
                display_name: "Team".into(),
                is_unified_group: true,
                has_team: true,
            },
        );
        enrichment.site_metadata_by_id.insert(
            "site-1".into(),
            SiteMetadata {
                display_name: "Team Site".into(),
                is_personal_site: false,
            },
        );
        enrichment
            .site_ids_by_drive_id
            .insert("drive-1".into(), "site-1".into());

        let parsed = parse_drive(&drive, &enrichment).expect("drive should parse");

        assert_eq!(parsed.owner_name.as_deref(), Some("Team"));
        assert_eq!(parsed.site_name.as_deref(), Some("Team Site"));
        assert_eq!(parsed.kind, "teams_group_library");
        assert_eq!(
            parsed.web_url.as_deref(),
            Some("https://example.com/sites/team/Shared%20Documents")
        );
    }

    #[test]
    fn add_drive_filters_known_noise_drive_names() {
        let mut drives_by_id = HashMap::new();
        let mut enrichment = DriveEnrichmentContext::default();
        let mut site_ids = HashSet::new();
        let drive = json!({
            "id": "drive-1",
            "name": "PersonalCacheLibrary",
            "driveType": "business"
        });

        add_drive(
            &mut drives_by_id,
            &mut enrichment,
            &mut site_ids,
            "test",
            &drive,
        );

        assert!(drives_by_id.is_empty());
    }
}
