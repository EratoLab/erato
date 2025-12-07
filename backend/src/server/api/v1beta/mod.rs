#![allow(deprecated)]
pub mod assistants;
pub mod budget;
pub mod me_profile_middleware;
pub mod message_streaming;
pub mod policy_engine_middleware;
pub mod sharepoint;
pub mod token_usage;

use crate::db::entity_ext::messages;
use crate::models;
use crate::models::assistant::create_standalone_file_upload;
use crate::models::chat::{
    archive_chat, get_frequent_assistants, get_or_create_chat, get_recent_chats,
};
use crate::models::message::{ContentPart, MessageSchema};
use crate::models::permissions;
use crate::policy::engine::PolicyEngine;
use crate::policy::types::Subject;
use crate::server::api::v1beta::assistants::{
    ArchiveAssistantResponse, Assistant, AssistantFile, AssistantWithFiles, CreateAssistantRequest,
    CreateAssistantResponse, UpdateAssistantRequest, UpdateAssistantResponse, archive_assistant,
    create_assistant, get_assistant, list_assistants, update_assistant,
};
use crate::server::api::v1beta::me_profile_middleware::{MeProfile, UserProfile};
use crate::server::api::v1beta::message_streaming::{
    __path_edit_message_sse, __path_message_submit_sse, __path_regenerate_message_sse,
    __path_resume_message_sse, EditMessageRequest, EditMessageStreamingResponseMessage,
    MessageSubmitRequest, MessageSubmitStreamingResponseMessage, ResumeStreamRequest,
    edit_message_sse, message_submit_sse, regenerate_message_sse, resume_message_sse,
};
use crate::services::file_storage::FileStorage;
use crate::services::sentry::log_internal_server_error;
use crate::state::AppState;
use axum::extract::{DefaultBodyLimit, Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post, put};
use axum::{Extension, Json, Router, middleware};
use axum_extra::extract::Multipart;
use chrono::{DateTime, FixedOffset};
use eyre::{Report, WrapErr};
use serde::{Deserialize, Serialize};
use sqlx::types::{Uuid, chrono};
use tower_http::limit::RequestBodyLimitLayer;
use tracing::instrument;
use utoipa::{OpenApi, ToSchema};
use utoipa_axum::router::OpenApiRouter;

const DEFAULT_MAX_BODY_LIMIT_BYTES: usize = 20 * 1024 * 1024; // 20MB

pub fn router(app_state: AppState) -> OpenApiRouter<AppState> {
    let max_upload_size = app_state
        .config
        .max_upload_size_bytes()
        .map(|v| v as usize)
        .unwrap_or(DEFAULT_MAX_BODY_LIMIT_BYTES);

    tracing::debug!(
        "Configured max file size: {}KB",
        max_upload_size as u64 / 1024
    );

    // build our application with a route
    let me_routes = Router::new()
        .route("/profile", get(profile))
        .route("/messages/submitstream", post(message_submit_sse))
        .route("/messages/regeneratestream", post(regenerate_message_sse))
        .route("/messages/editstream", post(edit_message_sse))
        .route("/messages/resumestream", post(resume_message_sse))
        .route("/recent_chats", get(recent_chats))
        .route("/frequent_assistants", get(frequent_assistants))
        .route("/chats", post(create_chat))
        .route("/files", post(upload_file))
        .route("/files/link", post(link_file))
        .route("/models", get(available_models))
        .route("/budget", get(budget::budget_status))
        .route_layer(middleware::from_fn_with_state(
            app_state.clone(),
            policy_engine_middleware::policy_engine_middleware,
        ))
        .route_layer(middleware::from_fn_with_state(
            app_state.clone(),
            me_profile_middleware::user_profile_middleware,
        ))
        // RequestBodyLimitLayer is used in addition to DefaultBodyLimit,
        // so we can already return a 413 error if we see a Content-Length that is too large.
        .layer(RequestBodyLimitLayer::new(max_upload_size))
        .layer(DefaultBodyLimit::max(max_upload_size));

    // authenticated routes that are not nested under /me
    // Should at a later time use a more generic middleware that can use a non-me profile as a Subject
    let authenticated_routes = Router::new()
        .route("/chats/{chat_id}/messages", get(chat_messages))
        .route("/chats/{chat_id}/archive", post(archive_chat_endpoint))
        .route("/files/{file_id}", get(get_file))
        .route(
            "/token_usage/estimate",
            post(token_usage::token_usage_estimate),
        )
        // Assistants routes - manually registered for clarity and consistency
        .route("/assistants", post(create_assistant))
        .route("/assistants", get(list_assistants))
        .route("/assistants/{assistant_id}", get(get_assistant))
        .route("/assistants/{assistant_id}", put(update_assistant))
        .route(
            "/assistants/{assistant_id}/archive",
            post(archive_assistant),
        )
        // Sharepoint/OneDrive integration routes
        .route(
            "/integrations/sharepoint/all-drives",
            get(sharepoint::all_drives),
        )
        .route(
            "/integrations/sharepoint/drives/{drive_id}",
            get(sharepoint::get_drive_root),
        )
        .route(
            "/integrations/sharepoint/drives/{drive_id}/items/{item_id}",
            get(sharepoint::get_drive_item),
        )
        .route(
            "/integrations/sharepoint/drives/{drive_id}/items/{item_id}/children",
            get(sharepoint::get_drive_item_children),
        )
        .route_layer(middleware::from_fn_with_state(
            app_state.clone(),
            policy_engine_middleware::policy_engine_middleware,
        ))
        .route_layer(middleware::from_fn_with_state(
            app_state.clone(),
            me_profile_middleware::user_profile_middleware,
        ));

    let app = Router::new()
        .route("/messages", get(messages))
        .route("/chats", get(chats))
        .nest("/me", me_routes)
        .merge(authenticated_routes)
        .fallback(fallback);
    app.into()
}

#[derive(OpenApi)]
#[openapi(
    paths(
        messages,
        chats,
        profile,
        chat_messages,
        recent_chats,
        frequent_assistants,
        upload_file,
        link_file,
        message_submit_sse,
        regenerate_message_sse,
        edit_message_sse,
        resume_message_sse,
        create_chat,
        get_file,
        archive_chat_endpoint,
        token_usage::token_usage_estimate,
        available_models,
        budget::budget_status,
        assistants::create_assistant,
        assistants::list_assistants,
        assistants::get_assistant,
        assistants::update_assistant,
        assistants::archive_assistant,
        sharepoint::all_drives,
        sharepoint::get_drive_root,
        sharepoint::get_drive_item,
        sharepoint::get_drive_item_children
    ),
    components(schemas(
        Message,
        Chat,
        RecentChat,
        ChatMessage,
        ChatMessageStats,
        ChatMessagesResponse,
        RecentChatStats,
        RecentChatsResponse,
        FileUploadItem,
        FileUploadResponse,
        LinkFileRequest,
        SharepointProviderMetadata,
        MessageSubmitStreamingResponseMessage,
        UserProfile,
        MessageSubmitRequest,
        EditMessageRequest,
        EditMessageStreamingResponseMessage,
        ResumeStreamRequest,
        CreateChatRequest,
        CreateChatResponse,
        ArchiveChatRequest,
        ArchiveChatResponse,
        ChatModel,
        Assistant,
        AssistantWithFiles,
        AssistantFile,
        CreateAssistantRequest,
        CreateAssistantResponse,
        UpdateAssistantRequest,
        UpdateAssistantResponse,
        ArchiveAssistantResponse,
        token_usage::TokenUsageRequest,
        token_usage::TokenUsageStats,
        token_usage::TokenUsageResponseFileItem,
        token_usage::TokenUsageResponse,
        budget::BudgetStatusResponse,
        crate::config::BudgetCurrency,
        sharepoint::Drive,
        sharepoint::DriveItem,
        sharepoint::AllDrivesResponse,
        sharepoint::DriveItemsResponse,
        sharepoint::DriveItemResponse
    ))
)]
pub struct ApiV1ApiDoc;

#[derive(Serialize, ToSchema)]
struct NotFound {
    error: String,
}

/// A chat model available to the user
#[derive(Debug, Serialize, ToSchema)]
pub struct ChatModel {
    /// The unique ID of the chat provider
    chat_provider_id: String,
    /// The display name of the model shown to users
    model_display_name: String,
}

pub async fn fallback() -> impl IntoResponse {
    (
        StatusCode::NOT_FOUND,
        Json(NotFound {
            error:
                "There is no API route under the path (or path + method combination) you provided."
                    .to_string(),
        }),
    )
}

#[utoipa::path(
    get,
    path = "/me/profile",
    responses(
        (status = OK, body = UserProfile),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn profile(
    State(_app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
) -> Result<Json<UserProfile>, StatusCode> {
    Ok(Json(me_user.profile.clone()))
}

#[derive(Serialize, ToSchema)]
pub struct Message {
    id: String,
}

#[deprecated = "Use RecentChat with /me/recent_chats instead"]
#[derive(Serialize, ToSchema)]
pub struct Chat {
    id: String,
}

#[derive(Debug, ToSchema, Serialize)]
pub struct RecentChat {
    id: String,
    /// Title of the chat, as generated by a summary of the chat.
    title_by_summary: String,
    /// Time of the last message in the chat.
    last_message_at: DateTime<FixedOffset>,
    /// Files uploaded to this chat
    file_uploads: Vec<FileUploadItem>,
    /// When this chat was archived by the user.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    archived_at: Option<DateTime<FixedOffset>>,
    /// The chat provider ID used for the most recent message
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    last_chat_provider_id: Option<String>,
    /// The model information for the most recent message, if available
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    last_model: Option<ChatModel>,
    /// Whether the current user can edit this chat (e.g., edit messages)
    ///
    /// NOTE: Currently this is true only for the chat owner. In the future,
    /// this may include collaborators/roles/policy-based permissions.
    can_edit: bool,
    /// The assistant ID if this chat is based on an assistant
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    assistant_id: Option<String>,
    /// The name of the assistant if this chat is based on an assistant
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    assistant_name: Option<String>,
}

/// A message in a chat
#[derive(Debug, Clone, ToSchema, Serialize, Deserialize)]
pub struct ChatMessage {
    /// The unique ID of the message
    id: String,
    /// The ID of the chat this message belongs to
    chat_id: String,
    /// Role of the message sender. May be on of "user", "assistant", "system"
    role: String,
    /// The text content of the message
    content: Vec<ContentPart>,
    /// When the message was created
    created_at: DateTime<FixedOffset>,
    /// When the message was last updated
    updated_at: DateTime<FixedOffset>,
    /// The ID of the previous message in the thread, if any
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    previous_message_id: Option<String>,
    /// The unique ID of the sibling message, if any
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    sibling_message_id: Option<String>,
    /// Whether this message is in the active thread
    is_message_in_active_thread: bool,
    /// The IDs of the files that were used to generate this message
    input_files_ids: Vec<String>,
}

/// Statistics for a list of chat messages
#[derive(Debug, ToSchema, Serialize)]
pub struct ChatMessageStats {
    /// Total number of messages in the chat
    total_count: i64,
    /// Current offset in the list
    current_offset: u64,
    /// Number of messages in the current response
    returned_count: usize,
    /// Whether there are more messages available
    has_more: bool,
}

/// Response for the chat_messages endpoint
#[derive(Debug, ToSchema, Serialize)]
pub struct ChatMessagesResponse {
    /// The list of messages
    messages: Vec<ChatMessage>,
    /// Statistics about the message list
    stats: ChatMessageStats,
}

/// Statistics for a list of recent chats
#[derive(Debug, ToSchema, Serialize)]
pub struct RecentChatStats {
    /// Total number of chats available
    total_count: i64,
    /// Current offset in the list
    current_offset: u64,
    /// Number of chats in the current response
    returned_count: usize,
    /// Whether there are more chats available
    has_more: bool,
}

/// Response for the recent_chats endpoint
#[derive(Debug, ToSchema, Serialize)]
pub struct RecentChatsResponse {
    /// The list of recent chats
    chats: Vec<RecentChat>,
    /// Statistics about the chat list
    stats: RecentChatStats,
}

/// A frequently used assistant with usage statistics
#[derive(Debug, ToSchema, Serialize)]
pub struct FrequentAssistantItem {
    /// The assistant details
    #[serde(flatten)]
    assistant: AssistantWithFiles,
    /// Number of times this assistant was used to create chats
    usage_count: i64,
}

/// Response for the frequent_assistants endpoint
#[derive(Debug, ToSchema, Serialize)]
pub struct FrequentAssistantsResponse {
    /// The list of frequently used assistants
    assistants: Vec<FrequentAssistantItem>,
}

#[derive(Deserialize, ToSchema)]
#[allow(unused)]
struct MultipartFormFile {
    name: String,
    #[schema(format = Binary, content_media_type = "application/octet-stream")]
    file: String,
}

/// Response for file upload
#[derive(Serialize, ToSchema, Debug)]
pub struct FileUploadItem {
    /// The unique ID of the uploaded file
    id: String,
    /// The original filename of the uploaded file
    filename: String,
    /// Pre-signed URL for downloading the file directly from storage
    download_url: String,
}

/// Response for file upload
#[derive(Serialize, ToSchema)]
pub struct FileUploadResponse {
    /// The list of uploaded files with their IDs and filenames
    files: Vec<FileUploadItem>,
}

/// SharePoint-specific metadata for linking files
#[derive(Debug, Deserialize, ToSchema)]
pub struct SharepointProviderMetadata {
    /// The ID of the drive containing the file
    pub drive_id: String,
    /// The ID of the file item
    pub item_id: String,
}

/// Request to link an external file (SharePoint, Google Drive, etc.)
#[derive(Debug, Deserialize, ToSchema)]
pub struct LinkFileRequest {
    /// The source/provider type: "sharepoint" (future: "google_drive", etc.)
    pub source: String,
    /// Optional chat ID to associate the file with. If not provided, creates standalone files.
    pub chat_id: Option<String>,
    /// Provider-specific metadata (e.g., drive_id, item_id for SharePoint)
    #[schema(value_type = SharepointProviderMetadata)]
    pub provider_metadata: serde_json::Value,
}

/// Upload files and return UUIDs for each
///
/// This endpoint accepts a multipart form with one or more files and returns UUIDs for each.
/// If chat_id is provided, files are associated with that chat. If not provided, files are created
/// as standalone uploads that can be linked to assistants later.
#[utoipa::path(
    post,
    path = "/me/files",
    tag = "files",
    params(
        ("chat_id" = Option<String>, Query, description = "Optional chat ID to associate the file with. If not provided, creates standalone files."),
    ),
    request_body(content = Vec<MultipartFormFile>, description = "Files to upload", content_type = "multipart/form-data"),
    responses(
        (status = OK, body = FileUploadResponse),
        (status = BAD_REQUEST, description = "Invalid file upload"),
        (status = INTERNAL_SERVER_ERROR, description = "Server error"),
    )
)]
pub async fn upload_file(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
    mut multipart: Multipart,
) -> Result<Json<FileUploadResponse>, StatusCode> {
    // Parse the optional chat ID parameter
    let chat_id = if let Some(chat_id_str) = params.get("chat_id") {
        Some(Uuid::parse_str(chat_id_str).map_err(|e| {
            tracing::error!("Invalid chat ID format: {}", e);
            StatusCode::BAD_REQUEST
        })?)
    } else {
        None
    };

    let mut uploaded_files = Vec::new();

    // Process the multipart form
    while let Some(field) = multipart.next_field().await.map_err(|e| {
        tracing::error!("Failed to process multipart form: {}", e);
        StatusCode::BAD_REQUEST
    })? {
        // Read the field's contents
        let filename = field
            .file_name()
            .map(|s| s.to_string())
            .unwrap_or_else(|| "unnamed_file".to_string());
        let content_type = field.content_type().map(|s| s.to_string());

        let mut data = field.bytes().await.map_err(|e| {
            tracing::error!("Failed to read file data: {} - {}", e, e.status());
            e.status()
        })?;
        let size_bytes = data.len();

        // Generate a random UUID for the file
        let file_id = Uuid::new_v4();
        let file_path = file_id.to_string();

        let file_storage_provider = app_state.default_file_storage_provider();

        // Upload the file to the storage provider
        let mut writer = file_storage_provider
            .upload_file_writer(file_path.as_str(), content_type.as_deref())
            .await
            .map_err(|e| {
                tracing::error!("Failed to write file data: {}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
        writer.write_from(&mut data).await.map_err(|e| {
            tracing::error!("Failed to write file data: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
        writer.close().await.map_err(|e| {
            tracing::error!("Failed to write file data: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

        // Store the file metadata in the database
        let file_upload = if let Some(ref chat_id) = chat_id {
            // Create file upload linked to chat
            models::file_upload::create_file_upload(
                &app_state.db,
                &policy,
                &me_user.to_subject(),
                chat_id,
                filename.clone(),
                app_state.default_file_storage_provider_id(),
                file_path,
            )
            .await
        } else {
            // Create standalone file upload
            create_standalone_file_upload(
                &app_state.db,
                &policy,
                &me_user.to_subject(),
                filename.clone(),
                app_state.default_file_storage_provider_id(),
                file_path,
            )
            .await
        }
        .map_err(|e| {
            tracing::error!("Failed to create file upload record: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

        // Generate a pre-signed download URL
        let download_url = file_storage_provider
            .generate_presigned_download_url(&file_upload.file_storage_path, None)
            .await
            .map_err(|e| {
                tracing::error!("Failed to generate download URL: {}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            })?;

        tracing::info!(
            "User {} uploaded file '{}' with size {} bytes, assigned ID: {}",
            me_user.id,
            filename,
            size_bytes,
            file_upload.id
        );

        // Add this file to our list of uploaded files
        uploaded_files.push(FileUploadItem {
            id: file_upload.id.to_string(),
            filename,
            download_url,
        });
    }

    // If no files were uploaded, return an error
    if uploaded_files.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    // Return the list of uploaded files
    Ok(Json(FileUploadResponse {
        files: uploaded_files,
    }))
}

/// Link an external file (SharePoint, Google Drive, etc.) and return a file upload record
///
/// This endpoint creates a file upload record that references an external file,
/// allowing it to be used in chat messages or attached to assistants.
/// If chat_id is provided, the file is associated with that chat. If not provided,
/// the file is created as a standalone upload.
#[utoipa::path(
    post,
    path = "/me/files/link",
    tag = "files",
    request_body = LinkFileRequest,
    responses(
        (status = OK, body = FileUploadResponse),
        (status = BAD_REQUEST, description = "Invalid request or unsupported source"),
        (status = UNAUTHORIZED, description = "No access token available for external provider"),
        (status = NOT_FOUND, description = "File not found or integration not enabled"),
        (status = INTERNAL_SERVER_ERROR, description = "Server error"),
    )
)]
pub async fn link_file(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    Json(request): Json<LinkFileRequest>,
) -> Result<Json<FileUploadResponse>, StatusCode> {
    match request.source.as_str() {
        "sharepoint" => link_sharepoint_file_impl(&app_state, &me_user, &policy, &request).await,
        _ => {
            tracing::error!("Unsupported file source: {}", request.source);
            Err(StatusCode::BAD_REQUEST)
        }
    }
}

/// Implementation for linking SharePoint files
async fn link_sharepoint_file_impl(
    app_state: &AppState,
    me_user: &MeProfile,
    policy: &PolicyEngine,
    request: &LinkFileRequest,
) -> Result<Json<FileUploadResponse>, StatusCode> {
    use graph_rs_sdk::{GraphClient, GraphClientConfiguration};

    // Check if SharePoint integration is enabled
    if !app_state
        .config
        .integrations
        .experimental_sharepoint
        .enabled
    {
        tracing::warn!("Sharepoint integration is not enabled");
        return Err(StatusCode::NOT_FOUND);
    }

    // Get access token from user profile
    let access_token = me_user.access_token.as_deref().ok_or_else(|| {
        tracing::error!("No access token available for Sharepoint integration");
        StatusCode::UNAUTHORIZED
    })?;

    // Parse the provider metadata for SharePoint
    let metadata: SharepointProviderMetadata =
        serde_json::from_value(request.provider_metadata.clone()).map_err(|e| {
            tracing::error!("Invalid SharePoint metadata: {}", e);
            StatusCode::BAD_REQUEST
        })?;

    // Parse the optional chat ID
    let chat_id = if let Some(chat_id_str) = &request.chat_id {
        Some(Uuid::parse_str(chat_id_str).map_err(|e| {
            tracing::error!("Invalid chat ID: {}", e);
            StatusCode::BAD_REQUEST
        })?)
    } else {
        None
    };

    // Create Graph client and get file info from MS Graph to retrieve the filename
    let client = GraphClient::from(GraphClientConfiguration::new().access_token(access_token));

    let response = client
        .drive(&metadata.drive_id)
        .item(&metadata.item_id)
        .get_items()
        .send()
        .await
        .map_err(|e| {
            tracing::error!("Failed to get file info from Sharepoint: {:?}", e);
            StatusCode::NOT_FOUND
        })?;

    let item_json: serde_json::Value = response.json().await.map_err(|e| {
        tracing::error!("Failed to parse file info response: {:?}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let filename = item_json
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            tracing::error!("No filename found in MS Graph response");
            StatusCode::INTERNAL_SERVER_ERROR
        })?
        .to_string();

    // Verify it's a file, not a folder
    if item_json.get("folder").is_some() {
        tracing::error!("Cannot link a folder as a file");
        return Err(StatusCode::BAD_REQUEST);
    }

    // Create the file upload record
    let file_upload = models::file_upload::create_sharepoint_file_upload(
        &app_state.db,
        policy,
        &me_user.to_subject(),
        chat_id.as_ref(),
        filename.clone(),
        metadata.drive_id,
        metadata.item_id,
    )
    .await
    .map_err(|e| {
        tracing::error!("Failed to create file upload record: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Generate a placeholder download URL (SharePoint URLs require access token at request time)
    let download_url = format!("/api/v1beta/files/{}", file_upload.id);

    tracing::info!(
        "User {} linked SharePoint file '{}', assigned ID: {}",
        me_user.id,
        filename,
        file_upload.id
    );

    app_state.global_policy_engine.invalidate_data().await;

    Ok(Json(FileUploadResponse {
        files: vec![FileUploadItem {
            id: file_upload.id.to_string(),
            filename,
            download_url,
        }],
    }))
}

impl ChatMessage {
    pub fn from_model(msg: messages::Model) -> Result<Self, Report> {
        let parsed_message = MessageSchema::validate(&msg.raw_message)?;
        Ok(ChatMessage {
            id: msg.id.to_string(),
            chat_id: msg.chat_id.to_string(),
            role: parsed_message.role.to_string(),
            content: parsed_message.content,
            created_at: msg.created_at,
            updated_at: msg.updated_at,
            previous_message_id: msg.previous_message_id.map(|id| id.to_string()),
            sibling_message_id: msg.sibling_message_id.map(|id| id.to_string()),
            is_message_in_active_thread: msg.is_message_in_active_thread,
            input_files_ids: msg
                .input_file_uploads
                .unwrap_or_default()
                .iter()
                .map(|id| id.to_string())
                .collect(),
        })
    }
}
#[utoipa::path(get, path = "/messages", responses((status = OK, body = Vec<Message>)))]
pub async fn messages() -> Json<Vec<Message>> {
    vec![].into()
}

#[deprecated = "Use /me/recent_chats instead"]
#[utoipa::path(get, path = "/chats", responses((status = OK, body = Vec<Chat>)))]
pub async fn chats() -> Json<Vec<Chat>> {
    Json(vec![Chat {
        id: "00000000-0000-0000-0000-000000000000".to_string(),
    }])
}

/// Get all messages for a specific chat
#[utoipa::path(
    get,
    path = "/chats/{chat_id}/messages", 
    params(
        ("chat_id" = String, Path, description = "The ID of the chat to get messages for"),
        ("limit" = Option<u64>, Query, description = "Maximum number of messages to return per page. Defaults to 100 if not provided. Larger values may impact performance."),
        ("offset" = Option<u64>, Query, description = "Number of messages to skip for pagination. Defaults to 0 if not provided.")
    ),
    responses(
        (status = OK, body = ChatMessagesResponse, description = "Successfully retrieved messages with pagination metadata"),
        (status = BAD_REQUEST, description = "Invalid chat ID format"),
        (status = INTERNAL_SERVER_ERROR, description = "Server error while retrieving messages")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn chat_messages(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    Path(chat_id): Path<String>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<Json<ChatMessagesResponse>, StatusCode> {
    // Parse the chat ID
    let chat_id = Uuid::parse_str(&chat_id).map_err(|_| StatusCode::BAD_REQUEST)?;

    policy.rebuild_data_if_needed_req(&app_state.db).await?;

    // Parse pagination parameters
    let limit = params.get("limit").and_then(|l| l.parse::<u64>().ok());

    let offset = params.get("offset").and_then(|o| o.parse::<u64>().ok());

    // Get the messages for this chat
    let (messages, stats) = models::message::get_chat_messages(
        &app_state.db,
        &policy,
        &me_user.to_subject(),
        &chat_id,
        limit,
        offset,
    )
    .await
    .wrap_err("Failed to get chat messages")
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Convert the messages to the API response format
    let converted_messages: Result<_, Report> =
        messages.into_iter().map(ChatMessage::from_model).collect();

    let response_messages = converted_messages
        .wrap_err("Failed to get chat messages")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Create the response with messages and stats
    let response = ChatMessagesResponse {
        messages: response_messages,
        stats: ChatMessageStats {
            total_count: stats.total_count,
            current_offset: stats.current_offset,
            returned_count: stats.returned_count,
            has_more: stats.has_more,
        },
    };

    Ok(Json(response))
}

#[utoipa::path(
    get,
    path = "/me/recent_chats", 
    params(
        ("limit" = Option<u64>, Query, description = "Maximum number of chats to return per page. Defaults to 30 if not provided. Larger values may impact performance."),
        ("offset" = Option<u64>, Query, description = "Number of chats to skip for pagination. Defaults to 0 if not provided."),
        ("include_archived" = Option<bool>, Query, description = "Whether to include archived chats in results. Defaults to false if not provided.")
    ),
    responses(
        (status = OK, body = RecentChatsResponse, description = "Successfully retrieved chats with pagination metadata"),
        (status = INTERNAL_SERVER_ERROR, description = "Server error while retrieving chats")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn recent_chats(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<Json<RecentChatsResponse>, StatusCode> {
    // Parse limit and offset from query parameters, with defaults
    let limit = params
        .get("limit")
        .and_then(|l| l.parse::<u64>().ok())
        .unwrap_or(30);
    let offset = params
        .get("offset")
        .and_then(|o| o.parse::<u64>().ok())
        .unwrap_or(0);
    let include_archived = params
        .get("include_archived")
        .and_then(|a| a.parse::<bool>().ok())
        .unwrap_or(false);

    policy
        .rebuild_data_if_needed(&app_state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to rebuild policy data: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // Get the user ID from the MeProfile
    let user_id = me_user.id.clone();

    // Call the get_recent_chats function
    let (model_chats, stats) = get_recent_chats(
        &app_state.db,
        &policy,
        &me_user.to_subject(),
        &user_id,
        limit,
        offset,
        include_archived,
    )
    .await
    .map_err(log_internal_server_error)?;

    // Convert from model RecentChat to API RecentChat
    let available_models = app_state.available_models(&me_user.groups);
    let api_chats = extend_recent_chats_to_api_model(
        model_chats,
        &app_state.db,
        &policy,
        &me_user.to_subject(),
        &me_user.id,
        &app_state.file_storage_providers,
        &available_models,
    )
    .await
    .map_err(|e| {
        tracing::error!("Failed to extend recent chats: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Create the response with chats and stats
    let response = RecentChatsResponse {
        chats: api_chats,
        stats: RecentChatStats {
            total_count: stats.total_count,
            current_offset: stats.current_offset,
            returned_count: stats.returned_count,
            has_more: stats.has_more,
        },
    };

    Ok(Json(response))
}

/// Extends model RecentChat objects to full API RecentChat objects.
/// Fetches file uploads for each chat in parallel.
#[instrument(skip_all)]
async fn extend_recent_chats_to_api_model(
    model_chats: Vec<models::chat::RecentChat>,
    db: &sea_orm::DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    current_user_id: &str,
    file_storage_providers: &std::collections::HashMap<String, FileStorage>,
    available_models: &[(String, String)],
) -> Result<Vec<RecentChat>, Report> {
    use futures::future::join_all;

    // Create futures for fetching file uploads for each chat in parallel
    let file_upload_futures: Vec<_> = model_chats
        .iter()
        .map(|chat| {
            let chat_id = chat.id.clone();
            async move {
                let chat_uuid = Uuid::parse_str(&chat_id)
                    .wrap_err_with(|| format!("Invalid chat UUID: {}", chat_id))?;
                let uploads = models::file_upload::get_chat_file_uploads_with_urls(
                    db,
                    policy,
                    subject,
                    &chat_uuid,
                    file_storage_providers,
                )
                .await
                .wrap_err_with(|| format!("Failed to get file uploads for chat {}", chat_id))?;
                Ok::<_, Report>(uploads)
            }
        })
        .collect();

    // Execute all file upload fetches in parallel
    let file_uploads_results = join_all(file_upload_futures).await;

    // Build the API RecentChat objects
    let mut api_chats = Vec::with_capacity(model_chats.len());
    for (chat, file_uploads_result) in model_chats.into_iter().zip(file_uploads_results) {
        let file_uploads = file_uploads_result?;

        // Convert file uploads to FileUploadItem
        let file_upload_items: Vec<FileUploadItem> = file_uploads
            .into_iter()
            .map(|upload| FileUploadItem {
                id: upload.id.to_string(),
                filename: upload.filename,
                download_url: upload.download_url,
            })
            .collect();

        // Get the last model information based on the last chat provider ID
        let last_model = if let Some(ref provider_id) = chat.last_chat_provider_id {
            available_models
                .iter()
                .find(|(id, _)| id == provider_id)
                .map(|(provider_id, display_name)| ChatModel {
                    chat_provider_id: provider_id.clone(),
                    model_display_name: display_name.clone(),
                })
        } else {
            None
        };

        let can_edit = permissions::can_user_edit_chat(current_user_id, &chat.owner_user_id);

        api_chats.push(RecentChat {
            id: chat.id,
            title_by_summary: chat.title_by_summary,
            last_message_at: chat.last_message_at,
            file_uploads: file_upload_items,
            archived_at: chat.archived_at,
            last_chat_provider_id: chat.last_chat_provider_id.clone(),
            last_model,
            can_edit,
            assistant_id: chat.assistant_id.map(|id| id.to_string()),
            assistant_name: chat.assistant_name,
        });
    }

    Ok(api_chats)
}

#[utoipa::path(
    get,
    path = "/me/frequent_assistants",
    params(
        ("limit" = Option<u64>, Query, description = "Maximum number of assistants to return. Defaults to 10 if not provided."),
        ("days" = Option<u32>, Query, description = "Number of days to look back for usage statistics. Defaults to 30 if not provided.")
    ),
    responses(
        (status = OK, body = FrequentAssistantsResponse, description = "Successfully retrieved frequently used assistants"),
        (status = INTERNAL_SERVER_ERROR, description = "Server error while retrieving assistants")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn frequent_assistants(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<Json<FrequentAssistantsResponse>, StatusCode> {
    // Parse limit and days from query parameters, with defaults
    let limit = params
        .get("limit")
        .and_then(|l| l.parse::<u64>().ok())
        .unwrap_or(10);
    let days = params
        .get("days")
        .and_then(|d| d.parse::<u32>().ok())
        .unwrap_or(30);

    policy
        .rebuild_data_if_needed(&app_state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to rebuild policy data: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // Get the user ID from the MeProfile
    let user_id = me_user.id.clone();

    // Call the get_frequent_assistants function
    let frequent = get_frequent_assistants(
        &app_state.db,
        &policy,
        &me_user.to_subject(),
        &user_id,
        limit,
        days,
    )
    .await
    .map_err(log_internal_server_error)?;

    // Convert from model FrequentAssistant to API FrequentAssistantItem
    let api_assistants: Vec<FrequentAssistantItem> = frequent
        .into_iter()
        .map(|fa| {
            // Convert files to API format with download URLs
            let api_files = fa
                .assistant
                .files
                .into_iter()
                .map(|file| AssistantFile {
                    id: file.id.to_string(),
                    filename: file.filename,
                    download_url: format!("/api/v1beta/files/{}", file.id),
                })
                .collect();

            // Convert the model assistant to the API AssistantWithFiles format
            let api_assistant = AssistantWithFiles {
                assistant: Assistant {
                    id: fa.assistant.id.to_string(),
                    name: fa.assistant.name,
                    description: fa.assistant.description,
                    prompt: fa.assistant.prompt,
                    mcp_server_ids: fa.assistant.mcp_server_ids,
                    default_chat_provider: fa.assistant.default_chat_provider,
                    created_at: fa.assistant.created_at,
                    updated_at: fa.assistant.updated_at,
                    archived_at: fa.assistant.archived_at,
                },
                files: api_files,
            };

            FrequentAssistantItem {
                assistant: api_assistant,
                usage_count: fa.usage_count,
            }
        })
        .collect();

    let response = FrequentAssistantsResponse {
        assistants: api_assistants,
    };

    Ok(Json(response))
}

/// Request to create a new chat without an initial message
#[derive(Deserialize, ToSchema, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct CreateChatRequest {
    /// Optional assistant ID to base this chat on
    #[serde(skip_serializing_if = "Option::is_none")]
    assistant_id: Option<String>,
}

/// Response for create_chat endpoint
#[derive(Deserialize, ToSchema, Serialize)]
pub struct CreateChatResponse {
    /// The ID of the newly created chat
    chat_id: String,
}

/// Create a new chat without an initial message
///
/// This endpoint allows creating a new chat without requiring an initial message.
/// This is useful for scenarios where you want to upload files before sending the first message.
#[utoipa::path(
    post,
    path = "/me/chats",
    request_body = CreateChatRequest,
    responses(
        (status = OK, body = CreateChatResponse, description = "Successfully created a new chat"),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided"),
        (status = INTERNAL_SERVER_ERROR, description = "Server error")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn create_chat(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    Json(request): Json<CreateChatRequest>,
) -> Result<Json<CreateChatResponse>, StatusCode> {
    // Parse and validate assistant_id if provided
    let assistant_id = if let Some(assistant_id_str) = request.assistant_id {
        let parsed_id = Uuid::parse_str(&assistant_id_str).map_err(|_| {
            tracing::error!("Invalid assistant ID format: {}", assistant_id_str);
            StatusCode::BAD_REQUEST
        })?;

        // Verify user has access to the assistant
        models::assistant::get_assistant_by_id(
            &app_state.db,
            &policy,
            &me_user.to_subject(),
            parsed_id,
        )
        .await
        .map_err(|e| {
            tracing::error!("Failed to get assistant: {}", e);
            if e.to_string().contains("not found") || e.to_string().contains("Access denied") {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })?;

        Some(parsed_id)
    } else {
        None
    };

    // Create a new chat
    let (chat, chat_status) = get_or_create_chat(
        &app_state.db,
        &policy,
        &me_user.to_subject(),
        None,
        &me_user.id,
        assistant_id.as_ref(),
    )
    .await
    .map_err(log_internal_server_error)?;

    // Invalidate policy engine if a new chat was created
    if chat_status == models::chat::ChatCreationStatus::Created {
        app_state.global_policy_engine.invalidate_data().await;
    }

    Ok(Json(CreateChatResponse {
        chat_id: chat.id.to_string(),
    }))
}

/// Get a single file by its ID
///
/// This endpoint retrieves information about a specific file by its ID.
#[utoipa::path(
    get,
    path = "/files/{file_id}",
    params(
        ("file_id" = String, Path, description = "The ID of the file to retrieve"),
    ),
    responses(
        (status = OK, body = FileUploadItem, description = "Successfully retrieved the file"),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided"),
        (status = NOT_FOUND, description = "When the file doesn't exist or doesn't belong to the user"),
        (status = INTERNAL_SERVER_ERROR, description = "Server error")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn get_file(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    Path(file_id): Path<String>,
) -> Result<Json<FileUploadItem>, StatusCode> {
    // Parse the file ID
    let file_id = Uuid::parse_str(&file_id).map_err(|_| StatusCode::BAD_REQUEST)?;

    // Get the file upload record with its download URL
    let file_upload = models::file_upload::get_file_upload_with_url(
        &app_state.db,
        &policy,
        &me_user.to_subject(),
        &file_id,
        &app_state.file_storage_providers,
    )
    .await
    .map_err(|e| {
        // If the error is about the file not being found, return 404
        if e.to_string().contains("not found") {
            StatusCode::NOT_FOUND
        } else {
            tracing::error!("Failed to get file upload by ID: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        }
    })?;

    // Convert to FileUploadItem and return
    Ok(Json(FileUploadItem {
        id: file_upload.id.to_string(),
        filename: file_upload.filename,
        download_url: file_upload.download_url,
    }))
}

/// Request to archive a chat
#[derive(Deserialize, ToSchema, Serialize)]
pub struct ArchiveChatRequest {
    // Empty for now - using path parameter for chat_id
}

/// Response from the archive chat endpoint
#[derive(Serialize, ToSchema)]
pub struct ArchiveChatResponse {
    /// The ID of the archived chat
    chat_id: String,
    /// The time when the chat was archived
    archived_at: DateTime<FixedOffset>,
}

/// Archive a chat
///
/// This endpoint marks a chat as archived by setting its archived_at timestamp.
/// Archived chats can be filtered out from the recent chats listing by default.
#[utoipa::path(
    post,
    path = "/chats/{chat_id}/archive",
    params(
        ("chat_id" = String, Path, description = "The ID of the chat to archive")
    ),
    request_body = ArchiveChatRequest,
    responses(
        (status = OK, body = ArchiveChatResponse, description = "Successfully archived the chat"),
        (status = BAD_REQUEST, description = "Invalid chat ID format"),
        (status = NOT_FOUND, description = "Chat not found"),
        (status = UNAUTHORIZED, description = "User not authorized to archive this chat"),
        (status = INTERNAL_SERVER_ERROR, description = "Server error")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn archive_chat_endpoint(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    Path(chat_id): Path<String>,
    Json(_request): Json<ArchiveChatRequest>,
) -> Result<Json<ArchiveChatResponse>, StatusCode> {
    // Parse the chat ID
    let chat_id = Uuid::parse_str(&chat_id).map_err(|_| StatusCode::BAD_REQUEST)?;

    policy
        .rebuild_data_if_needed(&app_state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to rebuild policy data: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // Archive the chat
    let updated_chat = archive_chat(&app_state.db, &policy, &me_user.to_subject(), &chat_id)
        .await
        .map_err(|e| {
            if e.to_string().contains("not found") {
                StatusCode::NOT_FOUND
            } else {
                log_internal_server_error(e)
            }
        })?;

    app_state.global_policy_engine.invalidate_data().await;

    // Check if archived_at is set (it should be)
    let archived_at = updated_chat.archived_at.ok_or_else(|| {
        tracing::error!("Failed to archive chat: archived_at is None after update");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Return the response
    Ok(Json(ArchiveChatResponse {
        chat_id: updated_chat.id.to_string(),
        archived_at,
    }))
}

/// Get available chat models for the user
///
/// This endpoint returns all available chat models (providers) that the user can use.
/// Each model includes the provider ID and display name.
#[utoipa::path(
    get,
    path = "/me/models",
    responses(
        (status = OK, body = Vec<ChatModel>, description = "Successfully retrieved available models"),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided"),
        (status = INTERNAL_SERVER_ERROR, description = "Server error")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn available_models(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
) -> Result<Json<Vec<ChatModel>>, StatusCode> {
    let models = app_state
        .available_models(&me_user.groups)
        .into_iter()
        .map(|(provider_id, display_name)| ChatModel {
            chat_provider_id: provider_id,
            model_display_name: display_name,
        })
        .collect();

    Ok(Json(models))
}
