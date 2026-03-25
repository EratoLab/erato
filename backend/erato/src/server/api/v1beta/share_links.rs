use crate::db::entity::prelude::{Chats, Users};
use crate::models::chat::resolve_chat_display_name;
use crate::models::share_link;
use crate::policy::engine::PolicyEngine;
use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::{Extension, Json};
use chrono::{DateTime, FixedOffset};
use eyre::WrapErr;
use sea_orm::EntityTrait;
use serde::{Deserialize, Serialize};
use sqlx::types::Uuid;
use utoipa::ToSchema;

#[derive(Debug, Serialize, ToSchema)]
pub struct ShareLink {
    pub id: String,
    pub resource_type: String,
    pub resource_id: String,
    pub enabled: bool,
    pub created_at: DateTime<FixedOffset>,
    pub updated_at: DateTime<FixedOffset>,
}

impl From<crate::models::share_link::ShareLinkInfo> for ShareLink {
    fn from(value: crate::models::share_link::ShareLinkInfo) -> Self {
        Self {
            id: value.id.to_string(),
            resource_type: value.resource_type,
            resource_id: value.resource_id,
            enabled: value.enabled,
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ShareLinkQuery {
    pub resource_type: String,
    pub resource_id: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ShareLinkForResourceResponse {
    pub share_link: Option<ShareLink>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SetShareLinkRequest {
    pub resource_type: String,
    pub resource_id: String,
    pub enabled: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SetShareLinkResponse {
    pub share_link: ShareLink,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ResolveShareLinkResponse {
    pub share_link: ShareLink,
    pub title_resolved: Option<String>,
    pub owner_display_name: Option<String>,
}

#[utoipa::path(
    get,
    path = "/share-links",
    params(
        ("resource_type" = String, Query, description = "The shared resource type"),
        ("resource_id" = String, Query, description = "The shared resource ID")
    ),
    responses(
        (status = OK, body = ShareLinkForResourceResponse),
        (status = FORBIDDEN, description = "Access denied"),
        (status = INTERNAL_SERVER_ERROR, description = "Server error")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn get_share_link_for_resource(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    Query(query): Query<ShareLinkQuery>,
) -> Result<Json<ShareLinkForResourceResponse>, StatusCode> {
    policy
        .rebuild_data_if_needed_req(&app_state.db, &app_state.config)
        .await?;

    let share_link = share_link::get_share_link_for_resource(
        &app_state.db,
        &policy,
        &me_user.to_subject(),
        &query.resource_type,
        &query.resource_id,
    )
    .await
    .map_err(|_| StatusCode::FORBIDDEN)?
    .map(|link| ShareLink::from(crate::models::share_link::ShareLinkInfo::from(link)));

    Ok(Json(ShareLinkForResourceResponse { share_link }))
}

#[utoipa::path(
    put,
    path = "/share-links",
    request_body = SetShareLinkRequest,
    responses(
        (status = OK, body = SetShareLinkResponse),
        (status = FORBIDDEN, description = "Access denied or feature disabled"),
        (status = INTERNAL_SERVER_ERROR, description = "Server error")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn set_share_link(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    Json(request): Json<SetShareLinkRequest>,
) -> Result<Json<SetShareLinkResponse>, StatusCode> {
    let share_link = share_link::set_share_link_enabled(
        &app_state.db,
        &policy,
        &me_user.to_subject(),
        &app_state.config,
        request.resource_type,
        request.resource_id,
        request.enabled,
    )
    .await
    .wrap_err("Failed to set share link")
    .map_err(|_| StatusCode::FORBIDDEN)?;

    app_state.global_policy_engine.invalidate_data().await;

    Ok(Json(SetShareLinkResponse {
        share_link: ShareLink::from(crate::models::share_link::ShareLinkInfo::from(share_link)),
    }))
}

#[utoipa::path(
    get,
    path = "/share-links/{share_link_id}",
    params(
        ("share_link_id" = String, Path, description = "The share link ID")
    ),
    responses(
        (status = OK, body = ResolveShareLinkResponse),
        (status = BAD_REQUEST, description = "Invalid share link ID"),
        (status = NOT_FOUND, description = "Share link not found, disabled, or unavailable"),
        (status = INTERNAL_SERVER_ERROR, description = "Server error")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn resolve_share_link(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Path(share_link_id): Path<String>,
) -> Result<Json<ResolveShareLinkResponse>, StatusCode> {
    let share_link_id = Uuid::parse_str(&share_link_id).map_err(|_| StatusCode::BAD_REQUEST)?;
    let share_link =
        share_link::get_active_share_link_by_id(&app_state.db, &app_state.config, &share_link_id)
            .await
            .map_err(|_| StatusCode::NOT_FOUND)?;
    let (title_resolved, owner_display_name) = if share_link.resource_type == "chat" {
        let chat_id =
            Uuid::parse_str(&share_link.resource_id).map_err(|_| StatusCode::NOT_FOUND)?;
        let chat = Chats::find_by_id(chat_id)
            .one(&app_state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .ok_or(StatusCode::NOT_FOUND)?;

        let owner_display_name = if chat.owner_user_id == me_user.id {
            me_user.name.clone()
        } else if let Ok(owner_user_id) = Uuid::parse_str(&chat.owner_user_id) {
            Users::find_by_id(owner_user_id)
                .one(&app_state.db)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
                .and_then(|user| user.email)
        } else {
            None
        };

        (
            Some(resolve_chat_display_name(
                chat.title_by_user_provided.as_deref(),
                chat.title_by_summary.as_deref(),
            )),
            owner_display_name,
        )
    } else {
        (None, None)
    };

    Ok(Json(ResolveShareLinkResponse {
        share_link: ShareLink::from(crate::models::share_link::ShareLinkInfo::from(share_link)),
        title_resolved,
        owner_display_name,
    }))
}
