use crate::db::entity::share_grants;
use crate::models::share_grant;
use crate::policy::engine::PolicyEngine;
use crate::server::api::v1beta::entra_id::{OrganizationGroup, OrganizationUser};
use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use crate::services::sentry::log_internal_server_error;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::{Extension, Json};
use chrono::{DateTime, FixedOffset};
use graph_rs_sdk::{GraphClient, GraphClientConfiguration, ODataQuery};
use serde::{Deserialize, Serialize};
use sqlx::types::Uuid;
use std::collections::{HashMap, HashSet};
use utoipa::ToSchema;

#[derive(Debug, Deserialize)]
struct GraphUserItem {
    id: String,
    #[serde(rename = "displayName")]
    display_name: Option<String>,
    #[serde(rename = "jobTitle")]
    job_title: Option<String>,
    mail: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GraphGroupItem {
    id: String,
    #[serde(rename = "displayName")]
    display_name: Option<String>,
}

/// A share grant model
#[derive(Debug, Serialize, ToSchema)]
pub struct ShareGrant {
    /// The unique ID of the share grant
    pub id: String,
    /// The type of resource being shared (e.g., "assistant")
    pub resource_type: String,
    /// The ID of the resource being shared
    pub resource_id: String,
    /// The type of subject being granted access (e.g., "user")
    pub subject_type: String,
    /// The type of subject ID (e.g., "id" or "oidc_issuer_and_subject")
    pub subject_id_type: String,
    /// The ID of the subject being granted access
    pub subject_id: String,
    /// The role being granted (e.g., "viewer")
    pub role: String,
    /// When this share grant was created
    pub created_at: DateTime<FixedOffset>,
    /// When this share grant was last updated
    pub updated_at: DateTime<FixedOffset>,
    /// The user profile for organization user share grants.
    pub user_profile: Option<OrganizationUser>,
    /// The group profile for organization group share grants.
    pub group_profile: Option<OrganizationGroup>,
}

/// Request to create a new share grant
#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateShareGrantRequest {
    /// The type of resource to share (e.g., "assistant")
    pub resource_type: String,
    /// The ID of the resource to share
    pub resource_id: String,
    /// The type of subject to grant access to (e.g., "user")
    pub subject_type: String,
    /// The type of subject ID (e.g., "id" or "oidc_issuer_and_subject")
    pub subject_id_type: String,
    /// The ID of the subject to grant access to
    pub subject_id: String,
    /// The role to grant (e.g., "viewer")
    pub role: String,
}

/// Response when creating a share grant
#[derive(Debug, Serialize, ToSchema)]
pub struct CreateShareGrantResponse {
    /// The created share grant
    #[serde(flatten)]
    pub share_grant: ShareGrant,
}

/// Query parameters for listing share grants
#[derive(Debug, Deserialize, ToSchema)]
pub struct ListShareGrantsQuery {
    /// Filter by resource type
    pub resource_type: String,
    /// Filter by resource ID
    pub resource_id: String,
}

/// Response when listing share grants
#[derive(Debug, Serialize, ToSchema)]
pub struct ListShareGrantsResponse {
    /// The list of share grants
    pub grants: Vec<ShareGrant>,
}

fn entra_id_enabled(app_state: &AppState) -> bool {
    app_state.config.integrations.experimental_entra_id.enabled
}

fn create_graph_client(access_token: &str) -> GraphClient {
    GraphClient::from(
        GraphClientConfiguration::new()
            .access_token(access_token)
            .connection_verbose(true),
    )
}

async fn fetch_user_profiles(
    client: &GraphClient,
    user_ids: &[String],
) -> HashMap<String, OrganizationUser> {
    let mut profiles = HashMap::new();

    for user_id in user_ids {
        let response = match client
            .user(user_id)
            .get_user()
            .select(&["id", "displayName", "jobTitle", "mail"])
            .send()
            .await
        {
            Ok(response) => response,
            Err(e) => {
                tracing::warn!(
                    "Failed to fetch user profile {} from Graph API: {:?}",
                    user_id,
                    e
                );
                continue;
            }
        };

        let user_item = match response.json::<GraphUserItem>().await {
            Ok(user_item) => user_item,
            Err(e) => {
                tracing::warn!(
                    "Failed to parse user profile {} from Graph API: {:?}",
                    user_id,
                    e
                );
                continue;
            }
        };

        profiles.insert(
            user_item.id.clone(),
            OrganizationUser {
                id: user_item.id,
                display_name: user_item.display_name.unwrap_or_default(),
                job_title: user_item.job_title,
                mail: user_item.mail,
                subject_type_id: "organization_user_id".to_string(),
            },
        );
    }

    profiles
}

async fn fetch_group_profiles(
    client: &GraphClient,
    group_ids: &[String],
) -> HashMap<String, OrganizationGroup> {
    let mut profiles = HashMap::new();

    for group_id in group_ids {
        let response = match client
            .group(group_id)
            .get_group()
            .select(&["id", "displayName"])
            .send()
            .await
        {
            Ok(response) => response,
            Err(e) => {
                tracing::warn!(
                    "Failed to fetch group profile {} from Graph API: {:?}",
                    group_id,
                    e
                );
                continue;
            }
        };

        let group_item = match response.json::<GraphGroupItem>().await {
            Ok(group_item) => group_item,
            Err(e) => {
                tracing::warn!(
                    "Failed to parse group profile {} from Graph API: {:?}",
                    group_id,
                    e
                );
                continue;
            }
        };

        profiles.insert(
            group_item.id.clone(),
            OrganizationGroup {
                id: group_item.id,
                display_name: group_item.display_name.unwrap_or_default(),
                subject_type_id: "organization_group_id".to_string(),
            },
        );
    }

    profiles
}

async fn fetch_profiles_for_grants(
    app_state: &AppState,
    me_user: &MeProfile,
    grants: &[share_grants::Model],
) -> (
    HashMap<String, OrganizationUser>,
    HashMap<String, OrganizationGroup>,
) {
    if !entra_id_enabled(app_state) {
        return (HashMap::new(), HashMap::new());
    }

    let mut user_ids = HashSet::new();
    let mut group_ids = HashSet::new();

    for grant in grants {
        if grant.subject_type == "user" && grant.subject_id_type == "organization_user_id" {
            user_ids.insert(grant.subject_id.clone());
        }

        if grant.subject_type == "organization_group"
            && grant.subject_id_type == "organization_group_id"
        {
            group_ids.insert(grant.subject_id.clone());
        }
    }

    if user_ids.is_empty() && group_ids.is_empty() {
        return (HashMap::new(), HashMap::new());
    }

    let access_token = match me_user.access_token.as_deref() {
        Some(token) => token,
        None => {
            tracing::warn!("No access token available for share grant profile lookup");
            return (HashMap::new(), HashMap::new());
        }
    };

    let client = create_graph_client(access_token);
    let user_ids: Vec<String> = user_ids.into_iter().collect();
    let group_ids: Vec<String> = group_ids.into_iter().collect();

    let (user_profiles, group_profiles) = tokio::join!(
        fetch_user_profiles(&client, &user_ids),
        fetch_group_profiles(&client, &group_ids)
    );

    (user_profiles, group_profiles)
}

/// Create a new share grant
#[utoipa::path(
    post,
    path = "/share-grants",
    tag = "share_grants",
    request_body = CreateShareGrantRequest,
    responses(
        (status = CREATED, body = CreateShareGrantResponse, description = "Successfully created the share grant"),
        (status = BAD_REQUEST, description = "Invalid request data"),
        (status = FORBIDDEN, description = "User does not own the resource"),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided"),
        (status = INTERNAL_SERVER_ERROR, description = "Server error")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn create_share_grant(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    Json(request): Json<CreateShareGrantRequest>,
) -> Result<(StatusCode, Json<CreateShareGrantResponse>), StatusCode> {
    // Create the share grant
    let created_grant = share_grant::create_share_grant(
        &app_state.db,
        &policy,
        &me_user.to_subject(),
        request.resource_type,
        request.resource_id,
        request.subject_type,
        request.subject_id_type,
        request.subject_id,
        request.role,
    )
    .await
    .map_err(|e| {
        if e.to_string().contains("Access denied") || e.to_string().contains("does not own") {
            tracing::warn!(
                "User {} attempted to share a resource they don't own: {}",
                me_user.id,
                e
            );
            StatusCode::FORBIDDEN
        } else if e.to_string().contains("not found") {
            tracing::warn!(
                "User {} attempted to share a non-existent resource: {}",
                me_user.id,
                e
            );
            StatusCode::NOT_FOUND
        } else if e.to_string().contains("Invalid") || e.to_string().contains("Unsupported") {
            tracing::warn!(
                "Invalid share grant request from user {}: {}",
                me_user.id,
                e
            );
            StatusCode::BAD_REQUEST
        } else {
            log_internal_server_error(e)
        }
    })?;

    tracing::info!(
        "User {} created share grant {} for resource {}:{}",
        me_user.id,
        created_grant.id,
        created_grant.resource_type,
        created_grant.resource_id
    );

    let (user_profiles, group_profiles) =
        fetch_profiles_for_grants(&app_state, &me_user, std::slice::from_ref(&created_grant)).await;
    let user_profile = if created_grant.subject_type == "user"
        && created_grant.subject_id_type == "organization_user_id"
    {
        user_profiles.get(&created_grant.subject_id).cloned()
    } else {
        None
    };
    let group_profile = if created_grant.subject_type == "organization_group"
        && created_grant.subject_id_type == "organization_group_id"
    {
        group_profiles.get(&created_grant.subject_id).cloned()
    } else {
        None
    };

    Ok((
        StatusCode::CREATED,
        Json(CreateShareGrantResponse {
            share_grant: ShareGrant {
                id: created_grant.id.to_string(),
                resource_type: created_grant.resource_type,
                resource_id: created_grant.resource_id,
                subject_type: created_grant.subject_type,
                subject_id_type: created_grant.subject_id_type,
                subject_id: created_grant.subject_id,
                role: created_grant.role,
                created_at: created_grant.created_at,
                updated_at: created_grant.updated_at,
                user_profile,
                group_profile,
            },
        }),
    ))
}

/// List share grants for a resource
#[utoipa::path(
    get,
    path = "/share-grants",
    tag = "share_grants",
    params(
        ("resource_type" = String, Query, description = "The type of resource (e.g., 'assistant')"),
        ("resource_id" = String, Query, description = "The ID of the resource")
    ),
    responses(
        (status = OK, body = ListShareGrantsResponse, description = "Successfully retrieved share grants"),
        (status = BAD_REQUEST, description = "Invalid query parameters"),
        (status = FORBIDDEN, description = "User does not own the resource"),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided"),
        (status = INTERNAL_SERVER_ERROR, description = "Server error")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn list_share_grants(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    Query(query): Query<ListShareGrantsQuery>,
) -> Result<Json<ListShareGrantsResponse>, StatusCode> {
    // List share grants for the resource
    let grants = share_grant::list_share_grants_for_resource(
        &app_state.db,
        &policy,
        &me_user.to_subject(),
        query.resource_type,
        query.resource_id,
    )
    .await
    .map_err(|e| {
        if e.to_string().contains("Access denied") || e.to_string().contains("does not own") {
            tracing::warn!(
                "User {} attempted to list share grants for a resource they don't own: {}",
                me_user.id,
                e
            );
            StatusCode::FORBIDDEN
        } else if e.to_string().contains("not found") {
            StatusCode::NOT_FOUND
        } else {
            log_internal_server_error(e)
        }
    })?;

    let (user_profiles, group_profiles) =
        fetch_profiles_for_grants(&app_state, &me_user, &grants).await;
    let api_grants = grants
        .into_iter()
        .map(|grant| {
            let user_profile = if grant.subject_type == "user"
                && grant.subject_id_type == "organization_user_id"
            {
                user_profiles.get(&grant.subject_id).cloned()
            } else {
                None
            };
            let group_profile = if grant.subject_type == "organization_group"
                && grant.subject_id_type == "organization_group_id"
            {
                group_profiles.get(&grant.subject_id).cloned()
            } else {
                None
            };

            ShareGrant {
                id: grant.id.to_string(),
                resource_type: grant.resource_type,
                resource_id: grant.resource_id,
                subject_type: grant.subject_type,
                subject_id_type: grant.subject_id_type,
                subject_id: grant.subject_id,
                role: grant.role,
                created_at: grant.created_at,
                updated_at: grant.updated_at,
                user_profile,
                group_profile,
            }
        })
        .collect();

    Ok(Json(ListShareGrantsResponse { grants: api_grants }))
}

/// Delete a share grant
#[utoipa::path(
    delete,
    path = "/share-grants/{grant_id}",
    tag = "share_grants",
    params(
        ("grant_id" = String, Path, description = "The ID of the share grant to delete")
    ),
    responses(
        (status = NO_CONTENT, description = "Successfully deleted the share grant"),
        (status = BAD_REQUEST, description = "Invalid grant ID format"),
        (status = NOT_FOUND, description = "Share grant not found"),
        (status = FORBIDDEN, description = "User does not own the resource"),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided"),
        (status = INTERNAL_SERVER_ERROR, description = "Server error")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn delete_share_grant(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    Path(grant_id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    // Parse the grant ID
    let grant_id = Uuid::parse_str(&grant_id).map_err(|_| StatusCode::BAD_REQUEST)?;

    // Delete the share grant
    share_grant::delete_share_grant(&app_state.db, &policy, &me_user.to_subject(), grant_id)
        .await
        .map_err(|e| {
            if e.to_string().contains("Access denied") || e.to_string().contains("does not own") {
                tracing::warn!(
                    "User {} attempted to delete a share grant for a resource they don't own: {}",
                    me_user.id,
                    e
                );
                StatusCode::FORBIDDEN
            } else if e.to_string().contains("not found") {
                StatusCode::NOT_FOUND
            } else {
                log_internal_server_error(e)
            }
        })?;

    tracing::info!("User {} deleted share grant {}", me_user.id, grant_id);

    Ok(StatusCode::NO_CONTENT)
}
