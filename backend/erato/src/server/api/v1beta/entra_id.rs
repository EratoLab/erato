//! Entra ID integration routes.
//!
//! These routes allow users to list organization users and groups
//! for sharing features.

use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use crate::state::AppState;
use axum::extract::{Query, State};
use axum::http::{HeaderName, HeaderValue, StatusCode};
use axum::{Extension, Json};
use graph_rs_sdk::{GraphClient, GraphClientConfiguration, ODataQuery};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

/// Query parameters for listing organization users
#[derive(Debug, Deserialize, ToSchema, IntoParams)]
pub struct ListUsersQuery {
    /// Filter to only show users the requesting user is "involved" with.
    /// When true, only returns users who share at least one group with the requesting user.
    #[serde(default)]
    pub is_involved: bool,

    /// Optional search query to filter users by displayName.
    /// Uses Microsoft Graph $search parameter with fuzzy, tokenized matching.
    /// When provided (even if empty), only the first page of results is returned for performance.
    /// This optimizes search field implementations where typing starts with an empty query.
    #[serde(default)]
    #[param(nullable = false)]
    pub query: Option<String>,
}

/// Query parameters for listing organization groups
#[derive(Debug, Deserialize, ToSchema, IntoParams)]
pub struct ListGroupsQuery {
    /// Filter to only show groups the requesting user is "involved" with.
    /// When true, only returns groups that the requesting user is a member of.
    #[serde(default)]
    pub is_involved: bool,

    /// Optional search query to filter groups by displayName.
    /// Uses Microsoft Graph $search parameter with fuzzy, tokenized matching.
    /// When provided (even if empty), only the first page of results is returned for performance.
    /// This optimizes search field implementations where typing starts with an empty query.
    #[serde(default)]
    #[param(nullable = false)]
    pub query: Option<String>,
}

/// An organization user
#[derive(Debug, Serialize, ToSchema, Clone)]
pub struct OrganizationUser {
    /// The unique ID of the user
    pub id: String,
    /// The display name of the user
    pub display_name: String,
    /// The job title of the user
    pub job_title: Option<String>,
    /// The email address of the user
    pub mail: Option<String>,
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
#[derive(Debug, Serialize, ToSchema, Clone)]
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

/// Fetch all groups the current user belongs to using transitive_member_of.
/// Returns a Vec of group IDs.
async fn fetch_user_groups(client: &GraphClient) -> Result<Vec<String>, StatusCode> {
    let response_deque = client
        .me()
        .transitive_member_of()
        .as_group()
        .select(&["id"])
        .paging()
        .json::<GroupsResponse>()
        .await
        .map_err(|e| {
            tracing::error!("Failed to fetch user's groups from Graph API: {:?}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let mut group_ids = Vec::new();
    for response in response_deque {
        let groups_response = response.into_body().map_err(|e| {
            tracing::error!("Failed to parse groups response: {:?}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

        for group_item in &groups_response.value {
            group_ids.push(group_item.id.clone());
        }
    }

    Ok(group_ids)
}

/// Fetch all user IDs that are members of the given groups.
/// Returns a HashSet of user IDs.
async fn fetch_users_in_groups(
    client: &GraphClient,
    group_ids: &[String],
) -> Result<std::collections::HashSet<String>, StatusCode> {
    use std::collections::HashSet;

    let mut user_ids = HashSet::new();

    for group_id in group_ids {
        // Fetch members of this group
        // Note: Some groups may not exist or be inaccessible (e.g., deleted groups, special directory objects)
        // We skip these groups with a warning instead of failing the entire request
        let response_deque = match client
            .groups()
            .id(group_id)
            .list_members()
            .select(&["id"])
            .paging()
            .json::<GroupMembersResponse>()
            .await
        {
            Ok(deque) => deque,
            Err(e) => {
                tracing::warn!(
                    "Skipping group {} - unable to fetch members (group may not exist or be inaccessible): {:?}",
                    group_id,
                    e
                );
                continue;
            }
        };

        for response in response_deque {
            let members_response = match response.into_body() {
                Ok(resp) => resp,
                Err(e) => {
                    tracing::warn!(
                        "Skipping group {} - failed to parse members response: {:?}",
                        group_id,
                        e
                    );
                    continue;
                }
            };

            for member_item in &members_response.value {
                user_ids.insert(member_item.id.clone());
            }
        }
    }

    Ok(user_ids)
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
    #[serde(rename = "jobTitle")]
    job_title: Option<String>,
    mail: Option<String>,
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

/// Helper struct for deserializing group members from MS Graph API.
#[derive(Debug, serde::Deserialize)]
struct GroupMembersResponse {
    value: Vec<GroupMemberItem>,
}

#[derive(Debug, serde::Deserialize)]
struct GroupMemberItem {
    id: String,
}

/// List all users in the organization.
///
/// If the Entra ID integration is not enabled, returns an empty list.
/// If enabled, fetches users from the MS Graph API.
/// When is_involved=true, only returns users who share at least one group with the requesting user.
/// When query parameter is provided (even if empty), returns only the first page for performance.
/// Non-empty queries use $search for fuzzy matching.
#[utoipa::path(
    get,
    path = "/me/organization/users",
    tag = "entra_id",
    params(
        ListUsersQuery
    ),
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
    Query(query): Query<ListUsersQuery>,
) -> Result<Json<OrganizationUsersResponse>, StatusCode> {
    // If Entra ID is not enabled, return empty list
    if !check_entra_id_enabled(&app_state) {
        tracing::warn!("Entra ID integration is not enabled, returning empty users list");
        return Ok(Json(OrganizationUsersResponse { users: Vec::new() }));
    }

    let access_token = get_access_token(&me_user)?;
    let client = create_graph_client(access_token);

    // If is_involved filter is enabled, first fetch the user's groups using transitive_member_of,
    // then fetch all users in those groups
    let involved_user_ids = if query.is_involved {
        let user_group_ids = fetch_user_groups(&client).await?;
        if user_group_ids.is_empty() {
            // User is not in any groups, return empty list
            tracing::info!("User is not in any groups, returning empty users list");
            return Ok(Json(OrganizationUsersResponse { users: Vec::new() }));
        }
        Some(fetch_users_in_groups(&client, &user_group_ids).await?)
    } else {
        None
    };

    // Use the graph-rs-sdk's built-in pagination support
    // This automatically handles all @odata.nextLink pages
    // When search query is provided, only fetch the first page for performance
    let mut users = Vec::new();

    if let Some(ref search_query) = query.query {
        // Validate and sanitize query
        let trimmed = search_query.trim();
        if trimmed.len() > 100 {
            tracing::warn!("Query too long: {} chars (max 100)", trimmed.len());
            return Err(StatusCode::BAD_REQUEST);
        }

        // When query parameter is provided (even if empty), only fetch first page for performance
        // This is useful for search field implementations where typing starts with an empty query
        let users_response = if trimmed.is_empty() {
            // Empty query - fetch first page without search
            tracing::info!("Fetching first page of users (empty query)");
            client
                .users()
                .list_user()
                .select(&["id", "displayName", "jobTitle", "mail"])
                .top("999")
                .send()
                .await
                .map_err(|e| {
                    tracing::error!("Failed to fetch users from Graph API: {:?}", e);
                    StatusCode::INTERNAL_SERVER_ERROR
                })?
                .json::<UsersResponse>()
                .await
                .map_err(|e| {
                    tracing::error!("Failed to parse users response: {:?}", e);
                    StatusCode::INTERNAL_SERVER_ERROR
                })?
        } else {
            // Non-empty query - use $search and fetch only first page
            tracing::info!("Searching users with query: {}", trimmed);
            client
                .users()
                .list_user()
                .select(&["id", "displayName", "jobTitle", "mail"])
                .header(
                    HeaderName::from_static("consistencylevel"),
                    HeaderValue::from_static("eventual"),
                ) // Required for $search
                .search(format!("\"displayName:{}\"", trimmed))
                // See https://learn.microsoft.com/en-us/graph/api/user-list?view=graph-rest-1.0&tabs=http#optional-query-parameters
                // > The default and maximum page sizes are 100 and 999 user objects respectively
                .top("999")
                .send()
                .await
                .map_err(|e| {
                    tracing::error!("Failed to search users from Graph API: {:?}", e);
                    StatusCode::INTERNAL_SERVER_ERROR
                })?
                .json::<UsersResponse>()
                .await
                .map_err(|e| {
                    tracing::error!("Failed to parse users search response: {:?}", e);
                    StatusCode::INTERNAL_SERVER_ERROR
                })?
        };

        // Process the results
        for user_item in &users_response.value {
            // Filter out the current user (no need to share with ourselves)
            if let Some(ref current_user_id) = me_user.profile.organization_user_id
                && &user_item.id == current_user_id
            {
                continue;
            }

            // If is_involved filter is enabled, only include users that are in the involved_user_ids set
            if let Some(ref involved_ids) = involved_user_ids
                && !involved_ids.contains(&user_item.id)
            {
                continue;
            }

            users.push(OrganizationUser {
                id: user_item.id.clone(),
                display_name: user_item.display_name.clone().unwrap_or_default(),
                job_title: user_item.job_title.clone(),
                mail: user_item.mail.clone(),
                subject_type_id: "organization_user_id".to_string(),
            });
        }

        // Early return with results
        tracing::info!("Found {} users (first page only)", users.len());
        return Ok(Json(OrganizationUsersResponse { users }));
    }

    // No search query (or empty query) - use existing pagination to fetch all pages
    let response_deque = client
        .users()
        .list_user()
        .select(&["id", "displayName", "jobTitle", "mail"])
        .paging()
        .json::<UsersResponse>()
        .await
        .map_err(|e| {
            tracing::error!("Failed to fetch users from Graph API: {:?}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // Collect all users from all pages
    for response in response_deque {
        let users_response = response.into_body().map_err(|e| {
            tracing::error!("Failed to parse users response: {:?}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

        for user_item in &users_response.value {
            // Filter out the current user (no need to share with ourselves)
            if let Some(ref current_user_id) = me_user.profile.organization_user_id
                && &user_item.id == current_user_id
            {
                continue;
            }

            // If is_involved filter is enabled, only include users that are in the involved_user_ids set
            if let Some(ref involved_ids) = involved_user_ids
                && !involved_ids.contains(&user_item.id)
            {
                continue;
            }

            users.push(OrganizationUser {
                id: user_item.id.clone(),
                display_name: user_item.display_name.clone().unwrap_or_default(),
                job_title: user_item.job_title.clone(),
                mail: user_item.mail.clone(),
                subject_type_id: "organization_user_id".to_string(),
            });
        }
    }

    if query.is_involved {
        tracing::info!(
            "Filtered to {} users (sharing groups with requesting user) from organization",
            users.len()
        );
    } else {
        tracing::info!("Fetched {} users from organization", users.len());
    }

    Ok(Json(OrganizationUsersResponse { users }))
}

/// List all groups in the organization.
///
/// If the Entra ID integration is not enabled, returns an empty list.
/// If enabled, fetches groups from the MS Graph API.
/// When is_involved=true, only returns groups the user is a member of.
/// When query parameter is provided (even if empty), returns only the first page for performance.
/// Non-empty queries use $search for fuzzy matching.
#[utoipa::path(
    get,
    path = "/me/organization/groups",
    tag = "entra_id",
    params(
        ListGroupsQuery
    ),
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
    Query(query): Query<ListGroupsQuery>,
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
    // When query parameter is provided (even if empty), only fetch the first page for performance
    let mut groups = Vec::new();

    if let Some(ref q) = query.query {
        // Validate query length
        let trimmed = q.trim();
        if trimmed.len() > 100 {
            tracing::warn!("Query too long: {} chars (max 100)", trimmed.len());
            return Err(StatusCode::BAD_REQUEST);
        }

        // When query parameter is provided (even if empty), only fetch first page for performance
        // This is useful for search field implementations where typing starts with an empty query
        let groups_response = if trimmed.is_empty() {
            // Empty query - fetch first page without search
            if query.is_involved {
                tracing::info!("Fetching first page of user's groups (empty query)");
                client
                    .me()
                    .transitive_member_of()
                    .as_group()
                    .select(&["id", "displayName"])
                    .top("999")
                    .send()
                    .await
                    .map_err(|e| {
                        tracing::error!("Failed to fetch user's groups from Graph API: {:?}", e);
                        StatusCode::INTERNAL_SERVER_ERROR
                    })?
                    .json::<GroupsResponse>()
                    .await
                    .map_err(|e| {
                        tracing::error!("Failed to parse groups response: {:?}", e);
                        StatusCode::INTERNAL_SERVER_ERROR
                    })?
            } else {
                tracing::info!("Fetching first page of organization groups (empty query)");
                client
                    .groups()
                    .list_group()
                    .select(&["id", "displayName"])
                    .top("999")
                    .send()
                    .await
                    .map_err(|e| {
                        tracing::error!("Failed to fetch groups from Graph API: {:?}", e);
                        StatusCode::INTERNAL_SERVER_ERROR
                    })?
                    .json::<GroupsResponse>()
                    .await
                    .map_err(|e| {
                        tracing::error!("Failed to parse groups response: {:?}", e);
                        StatusCode::INTERNAL_SERVER_ERROR
                    })?
            }
        } else {
            // Non-empty query - use $search and fetch only first page
            if query.is_involved {
                tracing::info!("Searching user's groups with query: {}", trimmed);
                client
                    .me()
                    .transitive_member_of()
                    .as_group()
                    .select(&["id", "displayName"])
                    .header(
                        HeaderName::from_static("consistencylevel"),
                        HeaderValue::from_static("eventual"),
                    ) // Required for $search
                    .search(format!("\"displayName:{}\"", trimmed))
                    // See https://learn.microsoft.com/en-us/graph/api/group-list?view=graph-rest-1.0&tabs=http#optional-query-parameters
                    // > The default and maximum page sizes are 100 and 999 group objects respectively
                    .top("999")
                    .send()
                    .await
                    .map_err(|e| {
                        tracing::error!("Failed to search user's groups from Graph API: {:?}", e);
                        StatusCode::INTERNAL_SERVER_ERROR
                    })?
                    .json::<GroupsResponse>()
                    .await
                    .map_err(|e| {
                        tracing::error!("Failed to parse groups search response: {:?}", e);
                        StatusCode::INTERNAL_SERVER_ERROR
                    })?
            } else {
                tracing::info!("Searching organization groups with query: {}", trimmed);
                client
                    .groups()
                    .list_group()
                    .select(&["id", "displayName"])
                    .header(
                        HeaderName::from_static("consistencylevel"),
                        HeaderValue::from_static("eventual"),
                    ) // Required for $search
                    .search(format!("\"displayName:{}\"", trimmed))
                    // See https://learn.microsoft.com/en-us/graph/api/group-list?view=graph-rest-1.0&tabs=http#optional-query-parameters
                    // > The default and maximum page sizes are 100 and 999 group objects respectively
                    .top("999")
                    .send()
                    .await
                    .map_err(|e| {
                        tracing::error!("Failed to search groups from Graph API: {:?}", e);
                        StatusCode::INTERNAL_SERVER_ERROR
                    })?
                    .json::<GroupsResponse>()
                    .await
                    .map_err(|e| {
                        tracing::error!("Failed to parse groups search response: {:?}", e);
                        StatusCode::INTERNAL_SERVER_ERROR
                    })?
            }
        };

        // Process the results
        for group_item in &groups_response.value {
            groups.push(OrganizationGroup {
                id: group_item.id.clone(),
                display_name: group_item.display_name.clone().unwrap_or_default(),
                subject_type_id: "organization_group_id".to_string(),
            });
        }

        // Early return with results
        tracing::info!("Found {} groups (first page only)", groups.len());
        return Ok(Json(OrganizationGroupsResponse { groups }));
    }

    // No search query - use existing pagination to fetch all pages
    let response_deque = if query.is_involved {
        // When is_involved=true, use me().transitive_member_of() to get only groups the user belongs to
        client
            .me()
            .transitive_member_of()
            .as_group()
            .select(&["id", "displayName"])
            .paging()
            .json::<GroupsResponse>()
            .await
            .map_err(|e| {
                tracing::error!("Failed to fetch user's groups from Graph API: {:?}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            })?
    } else {
        // When is_involved=false, fetch all groups in the organization
        client
            .groups()
            .list_group()
            .select(&["id", "displayName"])
            .paging()
            .json::<GroupsResponse>()
            .await
            .map_err(|e| {
                tracing::error!("Failed to fetch groups from Graph API: {:?}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            })?
    };

    // Collect all groups from all pages
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

    if query.is_involved {
        tracing::info!(
            "Fetched {} groups (user is member of) from organization",
            groups.len()
        );
    } else {
        tracing::info!("Fetched {} groups from organization", groups.len());
    }

    Ok(Json(OrganizationGroupsResponse { groups }))
}
