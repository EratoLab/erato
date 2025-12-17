use crate::models::share_grant;
use crate::policy::engine::PolicyEngine;
use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use crate::services::sentry::log_internal_server_error;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::{Extension, Json};
use chrono::{DateTime, FixedOffset};
use serde::{Deserialize, Serialize};
use sqlx::types::Uuid;
use utoipa::ToSchema;

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

    let api_grants = grants
        .into_iter()
        .map(|grant| ShareGrant {
            id: grant.id.to_string(),
            resource_type: grant.resource_type,
            resource_id: grant.resource_id,
            subject_type: grant.subject_type,
            subject_id_type: grant.subject_id_type,
            subject_id: grant.subject_id,
            role: grant.role,
            created_at: grant.created_at,
            updated_at: grant.updated_at,
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
