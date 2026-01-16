use crate::models::{assistant, permissions, share_grant};
use crate::policy::engine::PolicyEngine;
use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use crate::services::sentry::log_internal_server_error;
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::{Extension, Json};
use chrono::{DateTime, FixedOffset};
use serde::{Deserialize, Serialize};
use sqlx::types::Uuid;
use utoipa::ToSchema;

/// An assistant model
#[derive(Debug, Serialize, ToSchema)]
pub struct Assistant {
    /// The unique ID of the assistant
    pub id: String,
    /// The display name of the assistant
    pub name: String,
    /// Optional description of the assistant
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub description: Option<String>,
    /// The system prompt used by the assistant
    pub prompt: String,
    /// List of MCP server IDs available to this assistant
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub mcp_server_ids: Option<Vec<String>>,
    /// Default chat provider/model ID for this assistant
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub default_chat_provider: Option<String>,
    /// When this assistant was created
    pub created_at: DateTime<FixedOffset>,
    /// When this assistant was last updated
    pub updated_at: DateTime<FixedOffset>,
    /// When this assistant was archived
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub archived_at: Option<DateTime<FixedOffset>>,
    /// Whether the current user can edit this assistant
    ///
    /// NOTE: Currently this is true only for the assistant owner. In the future,
    /// this may include collaborators/roles/policy-based permissions.
    pub can_edit: bool,
}

/// An assistant with its associated files
#[derive(Debug, Serialize, ToSchema)]
pub struct AssistantWithFiles {
    /// The assistant information
    #[serde(flatten)]
    pub assistant: Assistant,
    /// Files associated with this assistant
    pub files: Vec<AssistantFile>,
}

/// A file associated with an assistant
#[derive(Debug, Serialize, ToSchema)]
pub struct AssistantFile {
    /// The unique ID of the file
    pub id: String,
    /// The original filename
    pub filename: String,
    /// Pre-signed URL for downloading the file
    pub download_url: String,
}

/// A share grant to create with the assistant
#[derive(Debug, Deserialize, ToSchema)]
pub struct ShareGrantInput {
    /// The type of subject to grant access to (e.g., "user")
    pub subject_type: String,
    /// The type of subject ID (e.g., "id" or "oidc_issuer_and_subject")
    pub subject_id_type: String,
    /// The ID of the subject to grant access to
    pub subject_id: String,
    /// The role to grant (e.g., "viewer")
    pub role: String,
}

/// Request to create a new assistant
#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateAssistantRequest {
    /// The name of the assistant
    pub name: String,
    /// Optional description of the assistant
    pub description: Option<String>,
    /// The system prompt for the assistant
    pub prompt: String,
    /// List of MCP server IDs available to this assistant
    pub mcp_server_ids: Option<Vec<String>>,
    /// Default chat provider/model ID for this assistant
    pub default_chat_provider: Option<String>,
    /// Optional list of file upload IDs to associate with this assistant
    pub file_ids: Option<Vec<String>>,
    /// Optional list of share grants to create with the assistant
    pub share_grants: Option<Vec<ShareGrantInput>>,
}

/// Response when creating an assistant
#[derive(Debug, Serialize, ToSchema)]
pub struct CreateAssistantResponse {
    /// The created assistant with files
    #[serde(flatten)]
    pub assistant: AssistantWithFiles,
}

/// Request to update an existing assistant
#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateAssistantRequest {
    /// Optional new name for the assistant
    pub name: Option<String>,
    /// Optional new description for the assistant
    pub description: Option<Option<String>>,
    /// Optional new prompt for the assistant
    pub prompt: Option<String>,
    /// Optional new list of MCP server IDs
    pub mcp_server_ids: Option<Option<Vec<String>>>,
    /// Optional new default chat provider
    pub default_chat_provider: Option<Option<String>>,
    /// Optional list of file upload IDs to associate with this assistant
    pub file_ids: Option<Option<Vec<String>>>,
}

/// Response when updating an assistant
#[derive(Debug, Serialize, ToSchema)]
pub struct UpdateAssistantResponse {
    /// The updated assistant with files
    #[serde(flatten)]
    pub assistant: AssistantWithFiles,
}

/// Request to archive an assistant
#[derive(Debug, Deserialize, ToSchema)]
pub struct ArchiveAssistantRequest {
    // Empty for now - using path parameter for assistant_id
}

/// Response when archiving an assistant
#[derive(Debug, Serialize, ToSchema)]
pub struct ArchiveAssistantResponse {
    /// The ID of the archived assistant
    pub id: String,
    /// When the assistant was archived
    pub archived_at: DateTime<FixedOffset>,
}

/// Create a new assistant
#[utoipa::path(
    post,
    path = "/assistants",
    tag = "assistants",
    request_body = CreateAssistantRequest,
    responses(
        (status = CREATED, body = AssistantWithFiles, description = "Successfully created the assistant"),
        (status = BAD_REQUEST, description = "Invalid request data"),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided"),
        (status = INTERNAL_SERVER_ERROR, description = "Server error")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn create_assistant(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    Json(request): Json<CreateAssistantRequest>,
) -> Result<(StatusCode, Json<CreateAssistantResponse>), StatusCode> {
    // Create the assistant
    let created_assistant = assistant::create_assistant(
        &app_state.db,
        &policy,
        &me_user.to_subject(),
        request.name,
        request.description,
        request.prompt,
        request.mcp_server_ids,
        request.default_chat_provider,
    )
    .await
    .map_err(log_internal_server_error)?;

    // Invalidate policy data so the new assistant is available for sharing
    app_state.global_policy_engine.invalidate_data().await;

    // Process file associations if provided
    if let Some(file_ids) = request.file_ids {
        for file_id_str in file_ids {
            let file_id = Uuid::parse_str(&file_id_str).map_err(|e| {
                tracing::error!("Invalid file ID format '{}': {}", file_id_str, e);
                StatusCode::BAD_REQUEST
            })?;

            // Associate the file with the assistant
            assistant::add_file_to_assistant(
                &app_state.db,
                &policy,
                &me_user.to_subject(),
                created_assistant.id,
                file_id,
            )
            .await
            .map_err(|e| {
                tracing::error!(
                    "Failed to associate file {} with assistant {}: {}",
                    file_id,
                    created_assistant.id,
                    e
                );
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
        }
    }

    // Process share grants if provided
    if let Some(share_grants_input) = request.share_grants {
        for grant_input in share_grants_input {
            share_grant::create_share_grant(
                &app_state.db,
                &policy,
                &me_user.to_subject(),
                "assistant".to_string(),
                created_assistant.id.to_string(),
                grant_input.subject_type,
                grant_input.subject_id_type,
                grant_input.subject_id,
                grant_input.role,
            )
            .await
            .map_err(|e| {
                tracing::error!(
                    "Failed to create share grant for assistant {}: {}",
                    created_assistant.id,
                    e
                );
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
        }
    }

    tracing::info!(
        "User {} created assistant '{}' with ID: {}",
        me_user.id,
        created_assistant.name,
        created_assistant.id
    );

    // Fetch the created assistant with files to return in the response
    let assistant_with_files = assistant::get_assistant_with_files(
        &app_state.db,
        &policy,
        &me_user.to_subject(),
        created_assistant.id,
        false, // Exclude archived
    )
    .await
    .map_err(log_internal_server_error)?;

    // Convert files to API format
    let api_files = assistant_with_files
        .files
        .into_iter()
        .map(|file| AssistantFile {
            id: file.id.to_string(),
            filename: file.filename,
            download_url: format!("/api/v1beta/files/{}", file.id),
        })
        .collect();

    Ok((
        StatusCode::CREATED,
        Json(CreateAssistantResponse {
            assistant: AssistantWithFiles {
                assistant: Assistant {
                    id: assistant_with_files.id.to_string(),
                    name: assistant_with_files.name,
                    description: assistant_with_files.description,
                    prompt: assistant_with_files.prompt,
                    mcp_server_ids: assistant_with_files.mcp_server_ids,
                    default_chat_provider: assistant_with_files.default_chat_provider,
                    created_at: assistant_with_files.created_at,
                    updated_at: assistant_with_files.updated_at,
                    archived_at: assistant_with_files.archived_at,
                    can_edit: permissions::can_user_edit_assistant(
                        &me_user.id,
                        &assistant_with_files.owner_user_id.to_string(),
                    ),
                },
                files: api_files,
            },
        }),
    ))
}

/// List all assistants available to the user
#[utoipa::path(
    get,
    path = "/assistants",
    tag = "assistants",
    responses(
        (status = OK, body = Vec<Assistant>, description = "Successfully retrieved user's assistants"),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided"),
        (status = INTERNAL_SERVER_ERROR, description = "Server error")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn list_assistants(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
) -> Result<Json<Vec<Assistant>>, StatusCode> {
    // Get all assistants for the user
    let assistants = assistant::get_user_assistants(&app_state.db, &policy, &me_user.to_subject())
        .await
        .map_err(log_internal_server_error)?;

    // Convert to API format
    let current_user_id = &me_user.id;
    let api_assistants = assistants
        .into_iter()
        .map(|assistant| Assistant {
            id: assistant.id.to_string(),
            name: assistant.name,
            description: assistant.description,
            prompt: assistant.prompt,
            mcp_server_ids: assistant.mcp_server_ids,
            default_chat_provider: assistant.default_chat_provider,
            created_at: assistant.created_at,
            updated_at: assistant.updated_at,
            archived_at: assistant.archived_at,
            can_edit: permissions::can_user_edit_assistant(
                current_user_id,
                &assistant.owner_user_id.to_string(),
            ),
        })
        .collect();

    Ok(Json(api_assistants))
}

/// Get a specific assistant with its files
#[utoipa::path(
    get,
    path = "/assistants/{assistant_id}",
    tag = "assistants",
    params(
        ("assistant_id" = String, Path, description = "The ID of the assistant to retrieve")
    ),
    responses(
        (status = OK, body = AssistantWithFiles, description = "Successfully retrieved the assistant"),
        (status = BAD_REQUEST, description = "Invalid assistant ID format"),
        (status = NOT_FOUND, description = "Assistant not found or access denied"),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided"),
        (status = INTERNAL_SERVER_ERROR, description = "Server error")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn get_assistant(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    Path(assistant_id): Path<String>,
) -> Result<Json<AssistantWithFiles>, StatusCode> {
    // Parse the assistant ID
    let assistant_id = Uuid::parse_str(&assistant_id).map_err(|_| StatusCode::BAD_REQUEST)?;

    // Get the assistant with files
    // Allow archived assistants to support viewing chats for archived assistants
    let assistant_with_files = assistant::get_assistant_with_files(
        &app_state.db,
        &policy,
        &me_user.to_subject(),
        assistant_id,
        true, // Allow archived assistants
    )
    .await
    .map_err(|e| {
        if e.to_string().contains("not found") || e.to_string().contains("Access denied") {
            StatusCode::NOT_FOUND
        } else {
            log_internal_server_error(e)
        }
    })?;

    // Convert files to API format
    let api_files = assistant_with_files
        .files
        .into_iter()
        .map(|file| AssistantFile {
            id: file.id.to_string(),
            filename: file.filename,
            download_url: format!("/api/v1beta/files/{}", file.id),
        })
        .collect();

    Ok(Json(AssistantWithFiles {
        assistant: Assistant {
            id: assistant_with_files.id.to_string(),
            name: assistant_with_files.name,
            description: assistant_with_files.description,
            prompt: assistant_with_files.prompt,
            mcp_server_ids: assistant_with_files.mcp_server_ids,
            default_chat_provider: assistant_with_files.default_chat_provider,
            created_at: assistant_with_files.created_at,
            updated_at: assistant_with_files.updated_at,
            archived_at: assistant_with_files.archived_at,
            can_edit: permissions::can_user_edit_assistant(
                &me_user.id,
                &assistant_with_files.owner_user_id.to_string(),
            ),
        },
        files: api_files,
    }))
}

/// Update an existing assistant
#[utoipa::path(
    put,
    path = "/assistants/{assistant_id}",
    tag = "assistants",
    params(
        ("assistant_id" = String, Path, description = "The ID of the assistant to update")
    ),
    request_body = UpdateAssistantRequest,
    responses(
        (status = OK, body = AssistantWithFiles, description = "Successfully updated the assistant"),
        (status = BAD_REQUEST, description = "Invalid assistant ID format or request data"),
        (status = NOT_FOUND, description = "Assistant not found or access denied"),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided"),
        (status = INTERNAL_SERVER_ERROR, description = "Server error")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn update_assistant(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    Path(assistant_id): Path<String>,
    Json(request): Json<UpdateAssistantRequest>,
) -> Result<Json<UpdateAssistantResponse>, StatusCode> {
    // Parse the assistant ID
    let assistant_id = Uuid::parse_str(&assistant_id).map_err(|_| StatusCode::BAD_REQUEST)?;

    // Update the assistant
    let updated_assistant = assistant::update_assistant(
        &app_state.db,
        &policy,
        &me_user.to_subject(),
        assistant_id,
        request.name,
        request.description,
        request.prompt,
        request.mcp_server_ids,
        request.default_chat_provider,
    )
    .await
    .map_err(|e| {
        if e.to_string().contains("not found") || e.to_string().contains("Access denied") {
            StatusCode::NOT_FOUND
        } else {
            log_internal_server_error(e)
        }
    })?;

    // Invalidate policy data to reflect the updated assistant
    app_state.global_policy_engine.invalidate_data().await;

    // Process file associations if provided
    if let Some(new_file_ids_opt) = request.file_ids {
        // Get the current files for this assistant
        // Exclude archived when updating (user can't update archived assistants)
        let assistant_with_files = assistant::get_assistant_with_files(
            &app_state.db,
            &policy,
            &me_user.to_subject(),
            assistant_id,
            false, // User is updating, must be non-archived
        )
        .await
        .map_err(log_internal_server_error)?;

        let current_file_ids: Vec<Uuid> = assistant_with_files.files.iter().map(|f| f.id).collect();

        // Parse the new file IDs
        let new_file_ids = if let Some(new_file_ids_vec) = new_file_ids_opt {
            let mut parsed_ids = Vec::new();
            for file_id_str in new_file_ids_vec {
                let file_id = Uuid::parse_str(&file_id_str).map_err(|e| {
                    tracing::error!("Invalid file ID format '{}': {}", file_id_str, e);
                    StatusCode::BAD_REQUEST
                })?;
                parsed_ids.push(file_id);
            }
            parsed_ids
        } else {
            // If None, clear all file associations
            Vec::new()
        };

        // Remove files that are no longer in the list
        for current_file_id in &current_file_ids {
            if !new_file_ids.contains(current_file_id) {
                assistant::remove_file_from_assistant(
                    &app_state.db,
                    &policy,
                    &me_user.to_subject(),
                    assistant_id,
                    *current_file_id,
                )
                .await
                .map_err(|e| {
                    tracing::error!(
                        "Failed to remove file {} from assistant {}: {}",
                        current_file_id,
                        assistant_id,
                        e
                    );
                    StatusCode::INTERNAL_SERVER_ERROR
                })?;
            }
        }

        // Add new files that aren't already associated
        for new_file_id in &new_file_ids {
            if !current_file_ids.contains(new_file_id) {
                assistant::add_file_to_assistant(
                    &app_state.db,
                    &policy,
                    &me_user.to_subject(),
                    assistant_id,
                    *new_file_id,
                )
                .await
                .map_err(|e| {
                    tracing::error!(
                        "Failed to associate file {} with assistant {}: {}",
                        new_file_id,
                        assistant_id,
                        e
                    );
                    StatusCode::INTERNAL_SERVER_ERROR
                })?;
            }
        }
    }

    tracing::info!(
        "User {} updated assistant '{}' with ID: {}",
        me_user.id,
        updated_assistant.name,
        updated_assistant.id
    );

    // Fetch the updated assistant with files to return in the response
    let assistant_with_files = assistant::get_assistant_with_files(
        &app_state.db,
        &policy,
        &me_user.to_subject(),
        assistant_id,
        false, // Exclude archived
    )
    .await
    .map_err(log_internal_server_error)?;

    // Convert files to API format
    let api_files = assistant_with_files
        .files
        .into_iter()
        .map(|file| AssistantFile {
            id: file.id.to_string(),
            filename: file.filename,
            download_url: format!("/api/v1beta/files/{}", file.id),
        })
        .collect();

    Ok(Json(UpdateAssistantResponse {
        assistant: AssistantWithFiles {
            assistant: Assistant {
                id: assistant_with_files.id.to_string(),
                name: assistant_with_files.name,
                description: assistant_with_files.description,
                prompt: assistant_with_files.prompt,
                mcp_server_ids: assistant_with_files.mcp_server_ids,
                default_chat_provider: assistant_with_files.default_chat_provider,
                created_at: assistant_with_files.created_at,
                updated_at: assistant_with_files.updated_at,
                archived_at: assistant_with_files.archived_at,
                can_edit: permissions::can_user_edit_assistant(
                    &me_user.id,
                    &assistant_with_files.owner_user_id.to_string(),
                ),
            },
            files: api_files,
        },
    }))
}

/// Archive an assistant
#[utoipa::path(
    post,
    path = "/assistants/{assistant_id}/archive",
    tag = "assistants",
    params(
        ("assistant_id" = String, Path, description = "The ID of the assistant to archive")
    ),
    request_body = ArchiveAssistantRequest,
    responses(
        (status = OK, body = ArchiveAssistantResponse, description = "Successfully archived the assistant"),
        (status = BAD_REQUEST, description = "Invalid assistant ID format"),
        (status = NOT_FOUND, description = "Assistant not found or access denied"),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided"),
        (status = INTERNAL_SERVER_ERROR, description = "Server error")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn archive_assistant(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    Path(assistant_id): Path<String>,
    Json(_request): Json<ArchiveAssistantRequest>,
) -> Result<Json<ArchiveAssistantResponse>, StatusCode> {
    // Parse the assistant ID
    let assistant_id = Uuid::parse_str(&assistant_id).map_err(|_| StatusCode::BAD_REQUEST)?;

    // Archive the assistant
    let archived_assistant =
        assistant::archive_assistant(&app_state.db, &policy, &me_user.to_subject(), assistant_id)
            .await
            .map_err(|e| {
                if e.to_string().contains("not found") || e.to_string().contains("Access denied") {
                    StatusCode::NOT_FOUND
                } else {
                    log_internal_server_error(e)
                }
            })?;

    // Invalidate policy data to reflect the archived assistant
    app_state.global_policy_engine.invalidate_data().await;

    tracing::info!(
        "User {} archived assistant '{}' with ID: {}",
        me_user.id,
        archived_assistant.name,
        archived_assistant.id
    );

    Ok(Json(ArchiveAssistantResponse {
        id: archived_assistant.id.to_string(),
        archived_at: archived_assistant.archived_at.unwrap(),
    }))
}
