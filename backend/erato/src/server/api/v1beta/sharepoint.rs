//! Sharepoint/OneDrive integration routes.
//!
//! These routes allow users to browse their OneDrive and Sharepoint files
//! and attach them to chats.

use crate::config::SharepointAllDrivesSource;
use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::{Extension, Json};
use chrono::{DateTime, FixedOffset};
use futures::future::join_all;
use graph_rs_sdk::{GraphClient, GraphClientConfiguration};
use serde::{Deserialize, Serialize};
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

#[derive(Debug, Deserialize)]
pub(crate) struct AllDrivesQuery {
    query: Option<String>,
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
    discovery_order: usize,
    discovery_position: usize,
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

#[derive(Debug, Default)]
struct DriveDiscoveryResult {
    drives: Vec<serde_json::Value>,
    discovered_drive_ids: HashSet<String>,
    discovered_group_ids: HashSet<String>,
    discovered_site_ids: HashSet<String>,
    site_metadata_by_id: HashMap<String, SiteMetadata>,
}

fn collect_discovered_drive_site_id(result: &mut DriveDiscoveryResult, drive: &serde_json::Value) {
    if let Some(site_id) = extract_site_id(drive) {
        result.discovered_site_ids.insert(site_id);
    }
}

fn apply_drive_discovery_result(
    drive_candidates_by_id: &mut HashMap<String, DriveCandidate>,
    enrichment: &mut DriveEnrichmentContext,
    discovered_targets: (
        &mut HashSet<String>,
        &mut HashSet<String>,
        &mut HashSet<String>,
    ),
    discovery_order: usize,
    result: DriveDiscoveryResult,
    discovery_source: &str,
) {
    let (discovered_drive_ids, discovered_site_ids, discovered_group_ids) = discovered_targets;

    for (position, drive) in result.drives.into_iter().enumerate() {
        add_drive(
            drive_candidates_by_id,
            enrichment,
            discovered_site_ids,
            discovery_order,
            position,
            discovery_source,
            &drive,
        );
    }

    discovered_drive_ids.extend(result.discovered_drive_ids);
    discovered_site_ids.extend(result.discovered_site_ids);
    discovered_group_ids.extend(result.discovered_group_ids);
    for (site_id, site_metadata) in result.site_metadata_by_id {
        enrichment
            .site_metadata_by_id
            .entry(site_id)
            .or_insert(site_metadata);
    }
}

fn discovery_source_label(source: SharepointAllDrivesSource) -> &'static str {
    match source {
        SharepointAllDrivesSource::MeDrive => "me/drive",
        SharepointAllDrivesSource::MeDrives => "me/drives",
        SharepointAllDrivesSource::JoinedTeams => "joined_teams",
        SharepointAllDrivesSource::GroupDrives => "groups/{id}/drives",
        SharepointAllDrivesSource::SiteSearch => "site_search",
        SharepointAllDrivesSource::SiteDrives => "sites/{id}/drives",
        SharepointAllDrivesSource::SharedWithMe => "shared_with_me",
        SharepointAllDrivesSource::SharedDriveDetails => "sharedWithMe -> drives/{id}",
    }
}

fn should_filter_drive_name(name: &str) -> bool {
    FILTERED_DRIVE_NAMES
        .iter()
        .any(|filtered| filtered == &name)
}

fn drive_matches_search_query(drive: &Drive, query: &str) -> bool {
    let normalized_query = query.to_lowercase();
    if drive.name.to_lowercase().contains(&normalized_query) {
        return true;
    }

    drive
        .site_name
        .as_deref()
        .is_some_and(|site_name| site_name.to_lowercase().contains(&normalized_query))
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
    discovery_order: usize,
    discovery_position: usize,
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
                discovery_order,
                discovery_position,
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

#[tracing::instrument(
    name = "sharepoint.all_drives.fetch_me_drive",
    skip(client),
    fields(
        discovery_source = "me/drive",
        drive_count = tracing::field::Empty
    )
)]
async fn fetch_me_drive(client: &GraphClient) -> DriveDiscoveryResult {
    let mut result = DriveDiscoveryResult::default();

    match client.me().drive().get_drive().send().await {
        Ok(response) => {
            if let Ok(drive_json) = response.json::<serde_json::Value>().await {
                collect_discovered_drive_site_id(&mut result, &drive_json);
                result.drives.push(drive_json);
            }
        }
        Err(e) => {
            tracing::warn!(discovery_source = "me/drive", error = ?e, "Failed to get personal OneDrive");
        }
    }

    tracing::Span::current().record("drive_count", result.drives.len());
    tracing::trace!(
        discovery_source = "me/drive",
        "Finished processing me/drive source"
    );

    result
}

#[tracing::instrument(
    name = "sharepoint.all_drives.fetch_me_drives",
    skip(http_client, access_token),
    fields(
        discovery_source = "me/drives",
        drive_count = tracing::field::Empty
    )
)]
async fn fetch_me_drives(
    http_client: &reqwest_012::Client,
    access_token: &str,
) -> DriveDiscoveryResult {
    let mut result = DriveDiscoveryResult::default();

    match fetch_graph_collection(http_client, access_token, "/me/drives").await {
        Ok(drives) => {
            for drive in drives {
                collect_discovered_drive_site_id(&mut result, &drive);
                result.drives.push(drive);
            }
        }
        Err(e) => {
            tracing::warn!(discovery_source = "me/drives", error = ?e, "Failed to list /me/drives");
        }
    }

    tracing::Span::current().record("drive_count", result.drives.len());
    tracing::trace!(
        discovery_source = "me/drives",
        "Finished processing me/drives source"
    );

    result
}

#[tracing::instrument(
    name = "sharepoint.all_drives.fetch_joined_teams",
    skip(http_client, access_token),
    fields(
        discovery_source = "joined_teams",
        drive_count = tracing::field::Empty
    )
)]
async fn fetch_joined_teams(
    http_client: &reqwest_012::Client,
    access_token: &str,
) -> DriveDiscoveryResult {
    let mut result = DriveDiscoveryResult::default();

    match fetch_graph_collection(http_client, access_token, "/me/joinedTeams?$select=id").await {
        Ok(joined_teams) => {
            for team in joined_teams {
                if let Some(group_id) = team.get("id").and_then(|value| value.as_str()) {
                    result.discovered_group_ids.insert(group_id.to_string());
                }
            }
        }
        Err(e) => {
            tracing::warn!(discovery_source = "joined_teams", error = ?e, "Failed to list /me/joinedTeams");
        }
    }

    let discovered_groups = result.discovered_group_ids.len();
    tracing::Span::current().record("drive_count", 0usize);
    tracing::trace!(
        discovery_source = "joined_teams",
        group_count = discovered_groups,
        "Finished processing joined_teams source"
    );

    result
}

#[tracing::instrument(
    name = "sharepoint.all_drives.fetch_group_drives",
    skip(http_client, access_token, discovered_group_ids),
    fields(
        discovery_source = "group_drives",
        drive_count = tracing::field::Empty
    )
)]
async fn fetch_group_drives(
    http_client: &reqwest_012::Client,
    access_token: &str,
    discovered_group_ids: &HashSet<String>,
) -> DriveDiscoveryResult {
    let mut result = DriveDiscoveryResult::default();
    if discovered_group_ids.is_empty() {
        tracing::Span::current().record("drive_count", 0usize);
        return result;
    }

    let group_drive_futures = discovered_group_ids
        .iter()
        .cloned()
        .map(|group_id| async move {
            let path = format!("/groups/{group_id}/drives");
            let drives = fetch_graph_collection(http_client, access_token, &path).await;
            (group_id, drives)
        });

    for (group_id, group_drives) in join_all(group_drive_futures).await {
        match group_drives {
            Ok(group_drives) => {
                for drive in group_drives {
                    collect_discovered_drive_site_id(&mut result, &drive);
                    result.drives.push(drive);
                }
            }
            Err(e) => {
                tracing::warn!(
                    discovery_source = "group_drives",
                    error = ?e,
                    group_id = %group_id,
                    "Failed to list group drives"
                );
            }
        }
    }

    tracing::Span::current().record("drive_count", result.drives.len());
    tracing::trace!(
        discovery_source = "group_drives",
        "Finished processing group_drives source"
    );

    result
}

#[tracing::instrument(
    name = "sharepoint.all_drives.fetch_site_search",
    skip(http_client, access_token),
    fields(
        discovery_source = "site_search",
        drive_count = tracing::field::Empty
    )
)]
async fn fetch_site_search(
    http_client: &reqwest_012::Client,
    access_token: &str,
    query: &str,
) -> DriveDiscoveryResult {
    let mut result = DriveDiscoveryResult::default();
    let sanitized_query = if query.trim().is_empty() { "*" } else { query };
    let encoded_query =
        url::form_urlencoded::byte_serialize(sanitized_query.as_bytes()).collect::<String>();
    let search_path = format!("/sites?search={encoded_query}&$top=20");

    match fetch_graph_collection(http_client, access_token, &search_path).await {
        Ok(sites) => {
            for site in sites {
                if let Some(site_id) = site.get("id").and_then(|value| value.as_str()) {
                    let site_id = site_id.to_string();
                    result.discovered_site_ids.insert(site_id.clone());
                    result.site_metadata_by_id.insert(
                        site_id.clone(),
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
            tracing::warn!(
                discovery_source = "site_search",
                error = ?e,
                search_path = %search_path,
                "Failed to search /sites"
            );
        }
    }

    let discovered_sites = result.discovered_site_ids.len();
    tracing::Span::current().record("drive_count", discovered_sites);
    tracing::trace!(
        discovery_source = "site_search",
        site_count = discovered_sites,
        "Finished processing site_search source"
    );

    result
}

#[tracing::instrument(
    name = "sharepoint.all_drives.fetch_shared_with_me",
    skip(http_client, access_token),
    fields(
        discovery_source = "shared_with_me",
        drive_count = tracing::field::Empty
    )
)]
async fn fetch_shared_with_me(
    http_client: &reqwest_012::Client,
    access_token: &str,
) -> DriveDiscoveryResult {
    let mut result = DriveDiscoveryResult::default();
    let mut shared_item_count = 0usize;

    match fetch_graph_collection(http_client, access_token, "/me/drive/sharedWithMe()").await {
        Ok(shared_items) => {
            shared_item_count = shared_items.len();
            for item in &shared_items {
                collect_shared_item_references(
                    item,
                    &mut result.discovered_drive_ids,
                    &mut result.discovered_site_ids,
                );
            }
        }
        Err(e) => {
            tracing::warn!(discovery_source = "shared_with_me", error = ?e, "Failed to list /me/drive/sharedWithMe()");
        }
    }

    tracing::Span::current().record("drive_count", result.discovered_drive_ids.len());
    let discovered_sites = result.discovered_site_ids.len();
    tracing::trace!(
        discovery_source = "shared_with_me",
        shared_item_count = shared_item_count,
        site_count = discovered_sites,
        "Finished processing sharedWithMe source"
    );

    result
}

#[tracing::instrument(
    name = "sharepoint.all_drives.fetch_site_drives",
    skip(
        http_client,
        access_token,
        discovered_site_ids,
        site_metadata_by_id
    ),
    fields(
        discovery_source = "site_drives",
        drive_count = tracing::field::Empty
    )
)]
async fn fetch_site_drives(
    http_client: &reqwest_012::Client,
    access_token: &str,
    discovered_site_ids: &HashSet<String>,
    site_metadata_by_id: &HashMap<String, SiteMetadata>,
) -> DriveDiscoveryResult {
    let mut result = DriveDiscoveryResult::default();
    if discovered_site_ids.is_empty() {
        tracing::Span::current().record("drive_count", 0usize);
        return result;
    }

    let site_drive_futures = discovered_site_ids.iter().cloned().map(|site_id| {
        let cached_site_metadata = site_metadata_by_id.get(&site_id).cloned();
        async move {
            let path = format!("/sites/{site_id}/drives");
            let drives = fetch_graph_collection(http_client, access_token, &path).await;
            let metadata = if let Some(site_metadata) = cached_site_metadata {
                Some(site_metadata)
            } else {
                fetch_site_name(http_client, access_token, &site_id).await
            };

            (site_id, metadata, drives)
        }
    });

    for (site_id, site_metadata, site_drives) in join_all(site_drive_futures).await {
        if let Some(site_metadata) = site_metadata {
            result
                .site_metadata_by_id
                .insert(site_id.clone(), site_metadata);
        }
        match site_drives {
            Ok(site_drives) => {
                for mut drive in site_drives {
                    set_sharepoint_site_id(&mut drive, &site_id);
                    collect_discovered_drive_site_id(&mut result, &drive);
                    result.drives.push(drive);
                }
            }
            Err(e) => {
                tracing::warn!(
                    discovery_source = "site_drives",
                    error = ?e,
                    site_id = %site_id,
                    "Failed to list site drives"
                );
            }
        }
    }
    tracing::Span::current().record("drive_count", result.drives.len());
    tracing::trace!(
        discovery_source = "site_drives",
        "Finished processing sites/<id>/drives source"
    );

    result
}

#[tracing::instrument(
    name = "sharepoint.all_drives.fetch_shared_drive_details",
    skip(http_client, access_token, discovered_drive_ids),
    fields(
        discovery_source = "shared_drive_details",
        drive_count = tracing::field::Empty
    )
)]
async fn fetch_shared_drive_details(
    http_client: &reqwest_012::Client,
    access_token: &str,
    discovered_drive_ids: &HashSet<String>,
) -> DriveDiscoveryResult {
    let mut result = DriveDiscoveryResult::default();
    if discovered_drive_ids.is_empty() {
        tracing::Span::current().record("drive_count", 0usize);
        return result;
    }

    let drive_detail_futures = discovered_drive_ids
        .iter()
        .cloned()
        .map(|drive_id| async move {
            let path = format!("/drives/{drive_id}");
            let drive = fetch_graph_drive(http_client, access_token, &path).await;
            (drive_id, drive)
        });

    for (drive_id, drive) in join_all(drive_detail_futures).await {
        match drive {
            Ok(drive) => {
                collect_discovered_drive_site_id(&mut result, &drive);
                result.drives.push(drive);
            }
            Err(e) => {
                tracing::warn!(
                    discovery_source = "shared_drive_details",
                    error = ?e,
                    drive_id = %drive_id,
                    "Failed to fetch shared drive details"
                );
            }
        }
    }

    tracing::Span::current().record("drive_count", result.drives.len());
    tracing::trace!(
        discovery_source = "shared_drive_details",
        "Finished processing shared drive details source"
    );

    result
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
    params(
        ("query" = Option<String>, Query, description = "Optional Drive/site search query used to filter the returned drives by drive title or site name. If empty or omitted, wildcard search is used for site discovery and no filtering is applied.")
    ),
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
    Query(query): Query<AllDrivesQuery>,
) -> Result<Json<AllDrivesResponse>, StatusCode> {
    check_sharepoint_enabled(&app_state)?;
    let enabled_sources: Vec<_> = app_state
        .config
        .integrations
        .experimental_sharepoint
        .resolved_all_drives_sources()
        .into_iter()
        .collect();
    let access_token = get_access_token(&me_user)?;
    let client = create_graph_client(access_token);
    let http_client = reqwest_012::Client::new();
    let normalized_query = query
        .query
        .as_deref()
        .map(str::trim)
        .filter(|query| !query.is_empty())
        .map(str::to_string)
        .unwrap_or_default();
    let has_search_query = !normalized_query.is_empty();
    let site_search_query = if has_search_query {
        normalized_query.clone()
    } else {
        "*".to_string()
    };
    let mut drive_candidates_by_id = HashMap::new();
    let mut enrichment = DriveEnrichmentContext::default();
    let mut discovered_drive_ids = HashSet::new();
    let mut discovered_site_ids = HashSet::new();
    let mut discovered_group_ids = HashSet::new();

    let (
        me_drive_result,
        me_drives_result,
        joined_teams_result,
        site_search_result,
        shared_with_me_result,
    ) = tokio::join!(
        async {
            if enabled_sources.contains(&SharepointAllDrivesSource::MeDrive) {
                fetch_me_drive(&client).await
            } else {
                DriveDiscoveryResult::default()
            }
        },
        async {
            if enabled_sources.contains(&SharepointAllDrivesSource::MeDrives) {
                fetch_me_drives(&http_client, access_token).await
            } else {
                DriveDiscoveryResult::default()
            }
        },
        async {
            if enabled_sources.contains(&SharepointAllDrivesSource::JoinedTeams) {
                fetch_joined_teams(&http_client, access_token).await
            } else {
                DriveDiscoveryResult::default()
            }
        },
        async {
            if enabled_sources.contains(&SharepointAllDrivesSource::SiteSearch) {
                fetch_site_search(&http_client, access_token, &site_search_query).await
            } else {
                DriveDiscoveryResult::default()
            }
        },
        async {
            if enabled_sources.contains(&SharepointAllDrivesSource::SharedWithMe) {
                fetch_shared_with_me(&http_client, access_token).await
            } else {
                DriveDiscoveryResult::default()
            }
        },
    );

    let mut discovered_group_ids_for_group_drives = HashSet::new();
    let mut discovered_site_ids_for_site_drives = HashSet::new();
    let mut discovered_drive_ids_for_shared_details = HashSet::new();
    let mut cached_site_metadata_by_id = HashMap::new();

    for result in [
        &me_drive_result,
        &me_drives_result,
        &joined_teams_result,
        &site_search_result,
        &shared_with_me_result,
    ] {
        discovered_group_ids_for_group_drives.extend(result.discovered_group_ids.iter().cloned());
        discovered_site_ids_for_site_drives.extend(result.discovered_site_ids.iter().cloned());
        discovered_drive_ids_for_shared_details.extend(result.discovered_drive_ids.iter().cloned());
        cached_site_metadata_by_id.extend(result.site_metadata_by_id.clone());
    }

    let mut discovery_results = HashMap::new();
    discovery_results.insert(SharepointAllDrivesSource::MeDrive, me_drive_result);
    discovery_results.insert(SharepointAllDrivesSource::MeDrives, me_drives_result);
    discovery_results.insert(SharepointAllDrivesSource::JoinedTeams, joined_teams_result);
    discovery_results.insert(SharepointAllDrivesSource::SiteSearch, site_search_result);
    discovery_results.insert(
        SharepointAllDrivesSource::SharedWithMe,
        shared_with_me_result,
    );

    let (group_drives_result, site_drives_result, shared_drive_details_result) = tokio::join!(
        async {
            if enabled_sources.contains(&SharepointAllDrivesSource::GroupDrives) {
                fetch_group_drives(
                    &http_client,
                    access_token,
                    &discovered_group_ids_for_group_drives,
                )
                .await
            } else {
                DriveDiscoveryResult::default()
            }
        },
        async {
            if enabled_sources.contains(&SharepointAllDrivesSource::SiteDrives) {
                fetch_site_drives(
                    &http_client,
                    access_token,
                    &discovered_site_ids_for_site_drives,
                    &cached_site_metadata_by_id,
                )
                .await
            } else {
                DriveDiscoveryResult::default()
            }
        },
        async {
            if enabled_sources.contains(&SharepointAllDrivesSource::SharedDriveDetails) {
                fetch_shared_drive_details(
                    &http_client,
                    access_token,
                    &discovered_drive_ids_for_shared_details,
                )
                .await
            } else {
                DriveDiscoveryResult::default()
            }
        },
    );

    discovery_results.insert(SharepointAllDrivesSource::GroupDrives, group_drives_result);
    discovery_results.insert(SharepointAllDrivesSource::SiteDrives, site_drives_result);
    discovery_results.insert(
        SharepointAllDrivesSource::SharedDriveDetails,
        shared_drive_details_result,
    );

    for (discovery_order, source) in enabled_sources.iter().enumerate() {
        if let Some(result) = discovery_results.remove(source) {
            apply_drive_discovery_result(
                &mut drive_candidates_by_id,
                &mut enrichment,
                (
                    &mut discovered_drive_ids,
                    &mut discovered_site_ids,
                    &mut discovered_group_ids,
                ),
                discovery_order,
                result,
                discovery_source_label(*source),
            );
        }
    }

    let group_ids: HashSet<_> = drive_candidates_by_id
        .values()
        .filter_map(|candidate| extract_group_id(&candidate.raw_drive))
        .collect();

    let group_metadata_futures = group_ids.into_iter().map(|group_id| {
        let group_id = group_id.clone();
        let http_client = http_client.clone();
        async move {
            let group_metadata = fetch_group_name(&http_client, access_token, &group_id).await;
            (group_id, group_metadata)
        }
    });

    for (group_id, group_metadata) in join_all(group_metadata_futures).await {
        if let Some(group_metadata) = group_metadata {
            enrichment
                .group_metadata_by_id
                .insert(group_id, group_metadata);
        }
    }

    let mut drives: Vec<_> = drive_candidates_by_id
        .into_values()
        .filter_map(|candidate| {
            parse_drive(&candidate.raw_drive, &enrichment).map(|drive| (drive, candidate))
        })
        .collect();
    if has_search_query {
        drives.retain(|(drive, _)| drive_matches_search_query(drive, &normalized_query));
    }
    drives.sort_by(
        |(left_drive, left_candidate), (right_drive, right_candidate)| {
            left_candidate
                .discovery_order
                .cmp(&right_candidate.discovery_order)
                .then_with(|| {
                    left_candidate
                        .discovery_position
                        .cmp(&right_candidate.discovery_position)
                })
                .then_with(|| left_drive.name.cmp(&right_drive.name))
                .then_with(|| left_drive.id.cmp(&right_drive.id))
        },
    );
    let drives = drives
        .into_iter()
        .map(|(drive, _)| drive)
        .collect::<Vec<_>>();

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
            0,
            0,
            "test",
            &drive,
        );
        add_drive(
            &mut drives_by_id,
            &mut enrichment,
            &mut site_ids,
            0,
            0,
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
            0,
            0,
            "test",
            &drive,
        );

        assert!(drives_by_id.is_empty());
    }
}
