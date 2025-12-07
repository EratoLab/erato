//! Entra ID integration routes.
//!
//! These routes allow users to list organization users and groups
//! for sharing features.

use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use crate::state::AppState;
use axum::extract::State;
use axum::http::StatusCode;
use axum::{Extension, Json};
use graph_rs_sdk::{GraphClient, GraphClientConfiguration, ODataQuery};
use serde::Serialize;
use utoipa::ToSchema;

/// An organization user
#[derive(Debug, Serialize, ToSchema)]
pub struct OrganizationUser {
    /// The unique ID of the user
    pub id: String,
    /// The display name of the user
    pub display_name: String,
    /// The subject type ID to use when creating a share grant (always "organization_user_id")
    pub subject_type_id: String,
}

/// Response for the organization users endpoint
#[derive(Debug, Serialize, ToSchema)]
pub struct OrganizationUsersResponse {
    /// List of users in the organization
    pub users: Vec<OrganizationUser>,
}

/// An organization group
#[derive(Debug, Serialize, ToSchema)]
pub struct OrganizationGroup {
    /// The unique ID of the group
    pub id: String,
    /// The display name of the group
    pub display_name: String,
    /// The subject type ID to use when creating a share grant (always "organization_group_id")
    pub subject_type_id: String,
}

/// Response for the organization groups endpoint
#[derive(Debug, Serialize, ToSchema)]
pub struct OrganizationGroupsResponse {
    /// List of groups in the organization
    pub groups: Vec<OrganizationGroup>,
}

/// Helper to extract access token from the user profile.
///
/// In the current implementation, we expect the access token to be available
/// via the authentication flow that authenticated the user.
fn get_access_token(me_user: &MeProfile) -> Result<&str, StatusCode> {
    me_user.access_token.as_deref().ok_or_else(|| {
        tracing::error!("No access token available for Entra ID integration");
        StatusCode::UNAUTHORIZED
    })
}

/// Check if Entra ID integration is enabled in the config.
/// Returns true if enabled, false otherwise (no error thrown).
fn check_entra_id_enabled(app_state: &AppState) -> bool {
    app_state.config.integrations.experimental_entra_id.enabled
}

/// Create a GraphClient with the user's access token.
fn create_graph_client(access_token: &str) -> GraphClient {
    GraphClient::from(
        GraphClientConfiguration::new()
            .access_token(access_token)
            .connection_verbose(true),
    )
}

/// Helper struct for deserializing users from MS Graph API.
#[derive(Debug, serde::Deserialize)]
struct UsersResponse {
    value: Vec<UserItem>,
}

#[derive(Debug, serde::Deserialize)]
struct UserItem {
    id: String,
    #[serde(rename = "displayName")]
    display_name: Option<String>,
}

/// Helper struct for deserializing groups from MS Graph API.
#[derive(Debug, serde::Deserialize)]
struct GroupsResponse {
    value: Vec<GroupItem>,
}

#[derive(Debug, serde::Deserialize)]
struct GroupItem {
    id: String,
    #[serde(rename = "displayName")]
    display_name: Option<String>,
}

/// List all users in the organization.
///
/// If the Entra ID integration is not enabled, returns an empty list.
/// If enabled, fetches all users from the MS Graph API with full pagination.
#[utoipa::path(
    get,
    path = "/me/organization/users",
    tag = "entra_id",
    responses(
        (status = OK, body = OrganizationUsersResponse, description = "List of organization users"),
        (status = UNAUTHORIZED, description = "No access token available"),
        (status = INTERNAL_SERVER_ERROR, description = "Failed to retrieve users")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn list_organization_users(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
) -> Result<Json<OrganizationUsersResponse>, StatusCode> {
    // If Entra ID is not enabled, return empty list
    if !check_entra_id_enabled(&app_state) {
        tracing::warn!("Entra ID integration is not enabled, returning empty users list");
        return Ok(Json(OrganizationUsersResponse { users: Vec::new() }));
    }

    let access_token = get_access_token(&me_user)?;
    let client = create_graph_client(access_token);

    // Use the graph-rs-sdk's built-in pagination support
    // This automatically handles all @odata.nextLink pages
    let response_deque = client
        .users()
        .list_user()
        .select(&["id", "displayName"])
        .paging()
        .json::<UsersResponse>()
        .await
        .map_err(|e| {
            tracing::error!("Failed to fetch users from Graph API: {:?}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // Collect all users from all pages
    let mut users = Vec::new();
    for response in response_deque {
        let users_response = response.into_body().map_err(|e| {
            tracing::error!("Failed to parse users response: {:?}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

        for user_item in &users_response.value {
            users.push(OrganizationUser {
                id: user_item.id.clone(),
                display_name: user_item.display_name.clone().unwrap_or_default(),
                subject_type_id: "organization_user_id".to_string(),
            });
        }
    }

    tracing::info!("Fetched {} users from organization", users.len());
    Ok(Json(OrganizationUsersResponse { users }))
}

/// List all groups in the organization.
///
/// If the Entra ID integration is not enabled, returns an empty list.
/// If enabled, fetches all groups from the MS Graph API with full pagination.
#[utoipa::path(
    get,
    path = "/me/organization/groups",
    tag = "entra_id",
    responses(
        (status = OK, body = OrganizationGroupsResponse, description = "List of organization groups"),
        (status = UNAUTHORIZED, description = "No access token available"),
        (status = INTERNAL_SERVER_ERROR, description = "Failed to retrieve groups")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn list_organization_groups(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
) -> Result<Json<OrganizationGroupsResponse>, StatusCode> {
    // If Entra ID is not enabled, return empty list
    if !check_entra_id_enabled(&app_state) {
        tracing::warn!("Entra ID integration is not enabled, returning empty groups list");
        return Ok(Json(OrganizationGroupsResponse { groups: Vec::new() }));
    }

    let access_token = get_access_token(&me_user)?;
    let client = create_graph_client(access_token);

    // Use the graph-rs-sdk's built-in pagination support
    // This automatically handles all @odata.nextLink pages
    let response_deque = client
        .groups()
        .list_group()
        .select(&["id", "displayName"])
        .paging()
        .json::<GroupsResponse>()
        .await
        .map_err(|e| {
            tracing::error!("Failed to fetch groups from Graph API: {:?}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // Collect all groups from all pages
    let mut groups = Vec::new();
    for response in response_deque {
        let groups_response = response.into_body().map_err(|e| {
            tracing::error!("Failed to parse groups response: {:?}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

        for group_item in &groups_response.value {
            groups.push(OrganizationGroup {
                id: group_item.id.clone(),
                display_name: group_item.display_name.clone().unwrap_or_default(),
                subject_type_id: "organization_group_id".to_string(),
            });
        }
    }

    tracing::info!("Fetched {} groups from organization", groups.len());
    Ok(Json(OrganizationGroupsResponse { groups }))
}
