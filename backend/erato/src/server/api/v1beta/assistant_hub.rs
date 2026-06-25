use crate::models::assistant_hub;
use crate::models::assistant_hub::{HubAudienceGrantInput, HubSubmissionProfile, HubVersionRecord};
use crate::policy::engine::PolicyEngine;
use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use crate::services::sentry::log_internal_server_error;
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::{Extension, Json};
use chrono::{DateTime, FixedOffset};
use graph_rs_sdk::{GraphClient, GraphClientConfiguration, ODataQuery};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sqlx::types::Uuid;
use std::collections::HashMap;
use utoipa::ToSchema;

#[derive(Debug, Serialize, ToSchema)]
pub struct AssistantHubCategory {
    pub id: String,
    pub display_name: String,
    pub icon: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AssistantHubConfigResponse {
    pub enabled: bool,
    pub can_review: bool,
    pub categories: Vec<AssistantHubCategory>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AssistantHubAudienceGrantInput {
    pub subject_type: String,
    pub subject_id_type: String,
    pub subject_id: String,
    pub role: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AssistantHubSubmissionRequest {
    pub long_description: String,
    pub category_ids: Vec<String>,
    pub keywords: Vec<String>,
    pub version_number: String,
    pub version_comment: Option<String>,
    pub creator_review_comment: Option<String>,
    #[serde(default)]
    pub audience_grants: Vec<AssistantHubAudienceGrantInput>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AssistantHubSubmissionDiffResponse {
    #[schema(value_type = Object)]
    pub diff_summary: JsonValue,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AssistantHubAssistantSnapshot {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub prompt: String,
    pub mcp_server_ids: Option<Vec<String>>,
    pub facet_ids: Option<Vec<String>>,
    pub default_chat_provider: Option<String>,
    pub enforce_facet_settings: bool,
    pub created_at: DateTime<FixedOffset>,
    pub updated_at: DateTime<FixedOffset>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AssistantHubCreator {
    pub id: String,
    pub display_name: String,
    pub email: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AssistantHubVersion {
    pub hub_assistant_id: String,
    pub source_assistant_id: String,
    pub version_id: String,
    pub assistant_id: String,
    pub status: String,
    pub is_published: bool,
    pub is_current_published_version: bool,
    pub featured: bool,
    pub version_number: String,
    pub version_comment: Option<String>,
    pub creator_review_comment: Option<String>,
    pub reviewer_review_comment: Option<String>,
    pub long_description: String,
    pub category_ids: Vec<String>,
    pub keywords: Vec<String>,
    #[schema(value_type = Object)]
    pub diff_summary: JsonValue,
    pub submitted_at: DateTime<FixedOffset>,
    pub reviewed_at: Option<DateTime<FixedOffset>>,
    pub withdrawn_at: Option<DateTime<FixedOffset>>,
    pub published_at: Option<DateTime<FixedOffset>>,
    pub created_at: DateTime<FixedOffset>,
    pub updated_at: DateTime<FixedOffset>,
    pub assistant: AssistantHubAssistantSnapshot,
    pub creator: AssistantHubCreator,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AssistantHubVersionResponse {
    pub version: AssistantHubVersion,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AssistantHubVersionsResponse {
    pub versions: Vec<AssistantHubVersion>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AssistantHubReviewRequest {
    pub accepted: bool,
    pub reviewer_review_comment: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AssistantHubSetPublishedRequest {
    pub is_published: bool,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AssistantHubSetFeaturedRequest {
    pub featured: bool,
}

impl From<AssistantHubAudienceGrantInput> for HubAudienceGrantInput {
    fn from(input: AssistantHubAudienceGrantInput) -> Self {
        Self {
            subject_type: input.subject_type,
            subject_id_type: input.subject_id_type,
            subject_id: input.subject_id,
            role: input.role,
        }
    }
}

impl From<&AssistantHubSubmissionRequest> for HubSubmissionProfile {
    fn from(request: &AssistantHubSubmissionRequest) -> Self {
        Self {
            long_description: request.long_description.clone(),
            category_ids: request.category_ids.clone(),
            keywords: request.keywords.clone(),
            version_number: request.version_number.clone(),
            version_comment: request.version_comment.clone(),
            creator_review_comment: request.creator_review_comment.clone(),
        }
    }
}

#[derive(Debug, Deserialize)]
struct GraphCreatorUserItem {
    #[serde(rename = "displayName")]
    display_name: Option<String>,
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

async fn resolve_creator_display_names(
    app_state: &AppState,
    me_user: &MeProfile,
    records: &[HubVersionRecord],
) -> HashMap<String, String> {
    let mut display_names = HashMap::new();
    let mut lookup_keys = HashMap::new();

    for record in records {
        let creator_id = record.creator.id.to_string();
        if creator_id == me_user.id
            && let Some(display_name) = me_user
                .profile
                .name
                .clone()
                .filter(|display_name| !display_name.trim().is_empty())
        {
            display_names.insert(creator_id, display_name);
            continue;
        }

        if lookup_keys.contains_key(&creator_id) {
            continue;
        }

        let lookup_key = record
            .creator
            .email
            .clone()
            .unwrap_or_else(|| record.creator.subject.clone());
        lookup_keys.insert(creator_id, lookup_key);
    }

    if !entra_id_enabled(app_state) {
        return display_names;
    }

    let Some(access_token) = me_user.access_token.as_deref() else {
        return display_names;
    };

    let client = create_graph_client(access_token);

    for (creator_id, lookup_key) in lookup_keys {
        let response = match client
            .user(&lookup_key)
            .get_user()
            .select(&["displayName"])
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => {
                tracing::warn!(
                    "Failed to resolve assistant hub creator {} via Graph API: {:?}",
                    lookup_key,
                    error
                );
                continue;
            }
        };

        let user_item = match response.json::<GraphCreatorUserItem>().await {
            Ok(user_item) => user_item,
            Err(error) => {
                tracing::warn!(
                    "Failed to parse assistant hub creator {} from Graph API: {:?}",
                    lookup_key,
                    error
                );
                continue;
            }
        };

        if let Some(display_name) = user_item
            .display_name
            .filter(|display_name| !display_name.trim().is_empty())
        {
            display_names.insert(creator_id, display_name);
        }
    }

    display_names
}

async fn records_to_response(
    app_state: &AppState,
    me_user: &MeProfile,
    records: Vec<HubVersionRecord>,
) -> Vec<AssistantHubVersion> {
    let creator_display_names = resolve_creator_display_names(app_state, me_user, &records).await;

    records
        .into_iter()
        .map(|record| {
            let creator_display_name = creator_display_names
                .get(&record.creator.id.to_string())
                .cloned();
            record_to_response(record, creator_display_name)
        })
        .collect()
}

fn record_to_response(
    record: HubVersionRecord,
    creator_display_name: Option<String>,
) -> AssistantHubVersion {
    let creator_id = record.creator.id.to_string();
    let creator_email = record.creator.email.clone();
    let creator_fallback = creator_email.clone().unwrap_or_else(|| creator_id.clone());

    AssistantHubVersion {
        hub_assistant_id: record.hub_assistant.id.to_string(),
        source_assistant_id: record.hub_assistant.source_assistant_id.to_string(),
        version_id: record.version.id.to_string(),
        assistant_id: record.version.assistant_id.to_string(),
        status: record.version.status,
        is_published: record.version.is_published,
        is_current_published_version: record.version.is_current_published_version,
        featured: record.hub_assistant.featured,
        version_number: record.version.version_number,
        version_comment: record.version.version_comment,
        creator_review_comment: record.version.creator_review_comment,
        reviewer_review_comment: record.version.reviewer_review_comment,
        long_description: record.version.long_description,
        category_ids: record.version.category_ids.unwrap_or_default(),
        keywords: record.version.keywords.unwrap_or_default(),
        diff_summary: record.version.diff_summary,
        submitted_at: record.version.submitted_at,
        reviewed_at: record.version.reviewed_at,
        withdrawn_at: record.version.withdrawn_at,
        published_at: record.version.published_at,
        created_at: record.version.created_at,
        updated_at: record.version.updated_at,
        assistant: AssistantHubAssistantSnapshot {
            id: record.assistant.id.to_string(),
            name: record.assistant.name,
            description: record.assistant.description,
            prompt: record.assistant.prompt,
            mcp_server_ids: record.assistant.mcp_server_ids,
            facet_ids: record.assistant.facet_ids,
            default_chat_provider: record.assistant.default_chat_provider,
            enforce_facet_settings: record.assistant.enforce_facet_settings,
            created_at: record.assistant.created_at,
            updated_at: record.assistant.updated_at,
        },
        creator: AssistantHubCreator {
            id: creator_id,
            display_name: creator_display_name.unwrap_or(creator_fallback),
            email: creator_email,
        },
    }
}

fn model_error_to_status(error: eyre::Report) -> StatusCode {
    let message = error.to_string();
    if message.contains("not enabled") {
        StatusCode::NOT_FOUND
    } else if message.contains("Access denied") {
        StatusCode::FORBIDDEN
    } else if message.contains("not found") {
        StatusCode::NOT_FOUND
    } else if message.contains("Unknown")
        || message.contains("must not be empty")
        || message.contains("Only")
        || message.contains("cannot")
        || message.contains("Invalid")
        || message.contains("already")
    {
        StatusCode::BAD_REQUEST
    } else {
        log_internal_server_error(error)
    }
}

#[utoipa::path(
    get,
    path = "/assistant-hub/config",
    tag = "assistant_hub",
    responses(
        (status = OK, body = AssistantHubConfigResponse),
        (status = UNAUTHORIZED),
    ),
    security(("bearer_auth" = []))
)]
pub async fn assistant_hub_config(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
) -> Result<Json<AssistantHubConfigResponse>, StatusCode> {
    let mut categories: Vec<AssistantHubCategory> = app_state
        .config
        .assistant_hub
        .categories
        .iter()
        .map(|(id, category)| AssistantHubCategory {
            id: id.clone(),
            display_name: category.display_name.clone(),
            icon: category.icon.clone(),
        })
        .collect();
    categories.sort_by(|a, b| a.display_name.cmp(&b.display_name));

    Ok(Json(AssistantHubConfigResponse {
        enabled: app_state.config.assistant_hub.enabled,
        can_review: app_state.config.assistant_hub.can_review(&me_user.groups),
        categories,
    }))
}

#[utoipa::path(
    post,
    path = "/assistant-hub/assistants/{source_assistant_id}/submission-diff",
    tag = "assistant_hub",
    request_body = AssistantHubSubmissionRequest,
    responses(
        (status = OK, body = AssistantHubSubmissionDiffResponse),
        (status = BAD_REQUEST),
        (status = FORBIDDEN),
        (status = NOT_FOUND),
        (status = UNAUTHORIZED),
    ),
    security(("bearer_auth" = []))
)]
pub async fn preview_assistant_hub_submission_diff(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Path(source_assistant_id): Path<String>,
    Json(request): Json<AssistantHubSubmissionRequest>,
) -> Result<Json<AssistantHubSubmissionDiffResponse>, StatusCode> {
    let source_assistant_id =
        Uuid::parse_str(&source_assistant_id).map_err(|_| StatusCode::BAD_REQUEST)?;
    let profile = HubSubmissionProfile::from(&request);
    let diff_summary = assistant_hub::build_submission_diff(
        &app_state.db,
        &app_state.config.assistant_hub,
        &me_user.to_subject(),
        source_assistant_id,
        &profile,
    )
    .await
    .map_err(model_error_to_status)?;

    Ok(Json(AssistantHubSubmissionDiffResponse { diff_summary }))
}

#[utoipa::path(
    post,
    path = "/assistant-hub/assistants/{source_assistant_id}/versions",
    tag = "assistant_hub",
    request_body = AssistantHubSubmissionRequest,
    responses(
        (status = CREATED, body = AssistantHubVersionResponse),
        (status = BAD_REQUEST),
        (status = FORBIDDEN),
        (status = NOT_FOUND),
        (status = UNAUTHORIZED),
    ),
    security(("bearer_auth" = []))
)]
pub async fn submit_assistant_hub_version(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    Path(source_assistant_id): Path<String>,
    Json(request): Json<AssistantHubSubmissionRequest>,
) -> Result<(StatusCode, Json<AssistantHubVersionResponse>), StatusCode> {
    let source_assistant_id =
        Uuid::parse_str(&source_assistant_id).map_err(|_| StatusCode::BAD_REQUEST)?;
    let profile = HubSubmissionProfile::from(&request);
    let audience_grants = request
        .audience_grants
        .into_iter()
        .map(HubAudienceGrantInput::from)
        .collect();
    let record = assistant_hub::submit_version(
        &app_state.db,
        &policy,
        &app_state.config.assistant_hub,
        &me_user.to_subject(),
        source_assistant_id,
        profile,
        audience_grants,
    )
    .await
    .map_err(model_error_to_status)?;

    app_state.global_policy_engine.invalidate_data().await;

    Ok((
        StatusCode::CREATED,
        Json(AssistantHubVersionResponse {
            version: records_to_response(&app_state, &me_user, vec![record])
                .await
                .into_iter()
                .next()
                .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?,
        }),
    ))
}

#[utoipa::path(
    get,
    path = "/assistant-hub/assistants",
    tag = "assistant_hub",
    responses(
        (status = OK, body = AssistantHubVersionsResponse),
        (status = NOT_FOUND),
        (status = UNAUTHORIZED),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_assistant_hub_assistants(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
) -> Result<Json<AssistantHubVersionsResponse>, StatusCode> {
    let records = assistant_hub::list_published_current_versions(
        &app_state.db,
        &app_state.config.assistant_hub,
        &me_user.to_subject(),
    )
    .await
    .map_err(model_error_to_status)?;

    Ok(Json(AssistantHubVersionsResponse {
        versions: records_to_response(&app_state, &me_user, records).await,
    }))
}

#[utoipa::path(
    get,
    path = "/assistant-hub/assistants/{hub_assistant_id}",
    tag = "assistant_hub",
    responses(
        (status = OK, body = AssistantHubVersionResponse),
        (status = FORBIDDEN),
        (status = NOT_FOUND),
        (status = UNAUTHORIZED),
    ),
    security(("bearer_auth" = []))
)]
pub async fn get_assistant_hub_assistant(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Path(hub_assistant_id): Path<String>,
) -> Result<Json<AssistantHubVersionResponse>, StatusCode> {
    let hub_assistant_id =
        Uuid::parse_str(&hub_assistant_id).map_err(|_| StatusCode::BAD_REQUEST)?;
    let record = assistant_hub::get_published_current_version(
        &app_state.db,
        &app_state.config.assistant_hub,
        &me_user.to_subject(),
        hub_assistant_id,
    )
    .await
    .map_err(model_error_to_status)?;

    Ok(Json(AssistantHubVersionResponse {
        version: records_to_response(&app_state, &me_user, vec![record])
            .await
            .into_iter()
            .next()
            .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?,
    }))
}

#[utoipa::path(
    get,
    path = "/assistant-hub/my/versions",
    tag = "assistant_hub",
    responses(
        (status = OK, body = AssistantHubVersionsResponse),
        (status = NOT_FOUND),
        (status = UNAUTHORIZED),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_my_assistant_hub_versions(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
) -> Result<Json<AssistantHubVersionsResponse>, StatusCode> {
    let records = assistant_hub::list_my_hub_versions(
        &app_state.db,
        &app_state.config.assistant_hub,
        &me_user.to_subject(),
    )
    .await
    .map_err(model_error_to_status)?;

    Ok(Json(AssistantHubVersionsResponse {
        versions: records_to_response(&app_state, &me_user, records).await,
    }))
}

#[utoipa::path(
    get,
    path = "/assistant-hub/review/versions",
    tag = "assistant_hub",
    responses(
        (status = OK, body = AssistantHubVersionsResponse),
        (status = FORBIDDEN),
        (status = NOT_FOUND),
        (status = UNAUTHORIZED),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_review_assistant_hub_versions(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
) -> Result<Json<AssistantHubVersionsResponse>, StatusCode> {
    let records = assistant_hub::list_review_versions(
        &app_state.db,
        &app_state.config.assistant_hub,
        &me_user.groups,
    )
    .await
    .map_err(model_error_to_status)?;

    Ok(Json(AssistantHubVersionsResponse {
        versions: records_to_response(&app_state, &me_user, records).await,
    }))
}

#[utoipa::path(
    post,
    path = "/assistant-hub/versions/{version_id}/review",
    tag = "assistant_hub",
    request_body = AssistantHubReviewRequest,
    responses(
        (status = OK, body = AssistantHubVersionResponse),
        (status = BAD_REQUEST),
        (status = FORBIDDEN),
        (status = NOT_FOUND),
        (status = UNAUTHORIZED),
    ),
    security(("bearer_auth" = []))
)]
pub async fn review_assistant_hub_version(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Path(version_id): Path<String>,
    Json(request): Json<AssistantHubReviewRequest>,
) -> Result<Json<AssistantHubVersionResponse>, StatusCode> {
    let version_id = Uuid::parse_str(&version_id).map_err(|_| StatusCode::BAD_REQUEST)?;
    let record = assistant_hub::review_version(
        &app_state.db,
        &app_state.config.assistant_hub,
        &me_user.groups,
        version_id,
        request.accepted,
        request.reviewer_review_comment,
    )
    .await
    .map_err(model_error_to_status)?;

    app_state.global_policy_engine.invalidate_data().await;

    Ok(Json(AssistantHubVersionResponse {
        version: records_to_response(&app_state, &me_user, vec![record])
            .await
            .into_iter()
            .next()
            .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?,
    }))
}

#[utoipa::path(
    post,
    path = "/assistant-hub/versions/{version_id}/withdraw",
    tag = "assistant_hub",
    responses(
        (status = OK, body = AssistantHubVersionResponse),
        (status = BAD_REQUEST),
        (status = FORBIDDEN),
        (status = NOT_FOUND),
        (status = UNAUTHORIZED),
    ),
    security(("bearer_auth" = []))
)]
pub async fn withdraw_assistant_hub_version(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Path(version_id): Path<String>,
) -> Result<Json<AssistantHubVersionResponse>, StatusCode> {
    let version_id = Uuid::parse_str(&version_id).map_err(|_| StatusCode::BAD_REQUEST)?;
    let record = assistant_hub::withdraw_version(
        &app_state.db,
        &app_state.config.assistant_hub,
        &me_user.to_subject(),
        version_id,
    )
    .await
    .map_err(model_error_to_status)?;

    app_state.global_policy_engine.invalidate_data().await;

    Ok(Json(AssistantHubVersionResponse {
        version: records_to_response(&app_state, &me_user, vec![record])
            .await
            .into_iter()
            .next()
            .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?,
    }))
}

#[utoipa::path(
    put,
    path = "/assistant-hub/versions/{version_id}/published",
    tag = "assistant_hub",
    request_body = AssistantHubSetPublishedRequest,
    responses(
        (status = OK, body = AssistantHubVersionResponse),
        (status = BAD_REQUEST),
        (status = FORBIDDEN),
        (status = NOT_FOUND),
        (status = UNAUTHORIZED),
    ),
    security(("bearer_auth" = []))
)]
pub async fn set_assistant_hub_version_published(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Path(version_id): Path<String>,
    Json(request): Json<AssistantHubSetPublishedRequest>,
) -> Result<Json<AssistantHubVersionResponse>, StatusCode> {
    let version_id = Uuid::parse_str(&version_id).map_err(|_| StatusCode::BAD_REQUEST)?;
    let record = assistant_hub::set_published(
        &app_state.db,
        &app_state.config.assistant_hub,
        &me_user.to_subject(),
        &me_user.groups,
        version_id,
        request.is_published,
    )
    .await
    .map_err(model_error_to_status)?;

    app_state.global_policy_engine.invalidate_data().await;

    Ok(Json(AssistantHubVersionResponse {
        version: records_to_response(&app_state, &me_user, vec![record])
            .await
            .into_iter()
            .next()
            .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?,
    }))
}

#[utoipa::path(
    put,
    path = "/assistant-hub/versions/{version_id}/current",
    tag = "assistant_hub",
    responses(
        (status = OK, body = AssistantHubVersionResponse),
        (status = BAD_REQUEST),
        (status = FORBIDDEN),
        (status = NOT_FOUND),
        (status = UNAUTHORIZED),
    ),
    security(("bearer_auth" = []))
)]
pub async fn set_assistant_hub_version_current(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Path(version_id): Path<String>,
) -> Result<Json<AssistantHubVersionResponse>, StatusCode> {
    let version_id = Uuid::parse_str(&version_id).map_err(|_| StatusCode::BAD_REQUEST)?;
    let record = assistant_hub::set_current_published_version(
        &app_state.db,
        &app_state.config.assistant_hub,
        &me_user.to_subject(),
        &me_user.groups,
        version_id,
    )
    .await
    .map_err(model_error_to_status)?;

    app_state.global_policy_engine.invalidate_data().await;

    Ok(Json(AssistantHubVersionResponse {
        version: records_to_response(&app_state, &me_user, vec![record])
            .await
            .into_iter()
            .next()
            .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?,
    }))
}

#[utoipa::path(
    put,
    path = "/assistant-hub/versions/{version_id}/featured",
    tag = "assistant_hub",
    request_body = AssistantHubSetFeaturedRequest,
    responses(
        (status = OK, body = AssistantHubVersionResponse),
        (status = BAD_REQUEST),
        (status = FORBIDDEN),
        (status = NOT_FOUND),
        (status = UNAUTHORIZED),
    ),
    security(("bearer_auth" = []))
)]
pub async fn set_assistant_hub_version_featured(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Path(version_id): Path<String>,
    Json(request): Json<AssistantHubSetFeaturedRequest>,
) -> Result<Json<AssistantHubVersionResponse>, StatusCode> {
    let version_id = Uuid::parse_str(&version_id).map_err(|_| StatusCode::BAD_REQUEST)?;
    let record = assistant_hub::set_featured(
        &app_state.db,
        &app_state.config.assistant_hub,
        &me_user.groups,
        version_id,
        request.featured,
    )
    .await
    .map_err(model_error_to_status)?;

    Ok(Json(AssistantHubVersionResponse {
        version: records_to_response(&app_state, &me_user, vec![record])
            .await
            .into_iter()
            .next()
            .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?,
    }))
}
