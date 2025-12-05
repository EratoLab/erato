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
use utoipa::ToSchema;

/// A drive accessible to the user (OneDrive, Sharepoint, etc.)
#[derive(Debug, Serialize, ToSchema)]
pub struct Drive {
    /// The unique ID of the drive
    pub id: String,
    /// The display name of the drive
    pub name: String,
    /// The type of drive (e.g., "personal", "documentLibrary")
    pub drive_type: String,
    /// The owner of the drive, if available
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub owner_name: Option<String>,
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

/// Parse a drive from the MS Graph API response.
fn parse_drive(drive: &serde_json::Value) -> Option<Drive> {
    let id = drive.get("id")?.as_str()?.to_string();
    let name = drive.get("name")?.as_str()?.to_string();
    let drive_type = drive
        .get("driveType")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();

    let owner_name = drive
        .get("owner")
        .and_then(|o| o.get("user"))
        .and_then(|u| u.get("displayName"))
        .and_then(|v| v.as_str())
        .map(String::from);

    Some(Drive {
        id,
        name,
        drive_type,
        owner_name,
    })
}

/// Get all drives accessible to the user.
///
/// This includes:
/// - The user's personal OneDrive
/// - Drives shared with the user
/// - Recent items (as a pseudo-drive)
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

    let mut drives = Vec::new();

    // Get the user's personal OneDrive
    match client.me().drive().get_drive().send().await {
        Ok(response) => {
            if let Ok(drive_json) = response.json::<serde_json::Value>().await
                && let Some(drive) = parse_drive(&drive_json)
            {
                drives.push(drive);
            }
        }
        Err(e) => {
            tracing::warn!("Failed to get personal OneDrive: {:?}", e);
        }
    }

    // Note: To list all drives accessible to the user including shared Sharepoint sites,
    // a more complex implementation would be needed. For now, we just return the personal drive.
    // In the future, this could be extended to query Sharepoint sites the user has access to.

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
