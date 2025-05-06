use crate::models::message::{GenerationInputMessages, MessageContent, MessageRole};
use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use crate::server::api::v1beta::message_streaming::FileContentsForGeneration;
use crate::state::AppState;
use axum::extract::State;
use axum::{Extension, Json};
use eyre::{eyre, Report, WrapErr};
use sea_orm::prelude::Uuid;
use serde::{Deserialize, Serialize};
use tiktoken_rs::o200k_base;
use utoipa::ToSchema;

const MAX_TOKENS: u32 = 10000;

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct TokenUsageRequest {
    #[schema(example = "00000000-0000-0000-0000-000000000000")]
    /// The ID of the message that this message is a response to. If this is the first message in the chat, this should be empty.
    previous_message_id: Option<Uuid>,
    #[schema(example = "00000000-0000-0000-0000-000000000000")]
    /// The ID of an existing chat to use. If provided, the chat with this ID will be used instead of creating a new one.
    existing_chat_id: Option<Uuid>,
    #[schema(example = "Hello, world!")]
    /// The text of the message.
    user_message: String,
    #[schema(example = "[\"00000000-0000-0000-0000-000000000000\"]")]
    /// The IDs of any files attached to this message. These files must already be uploaded to the file_uploads table.
    #[serde(default)]
    input_files_ids: Vec<Uuid>,
}

/// Token usage statistics for the request
#[derive(Debug, ToSchema, Serialize)]
pub struct TokenUsageStats {
    /// Total number of tokens in the request
    total_tokens: usize,
    /// Number of tokens in the user message
    user_message_tokens: usize,
    /// Number of tokens in previous messages (chat history)
    history_tokens: usize,
    /// Number of tokens in file contents
    file_tokens: usize,
    /// The configured model's maximum token limit
    max_tokens: u32,
    /// Remaining tokens available for the model response
    remaining_tokens: u32,
}

/// Token usage details for an individual file
#[derive(Debug, ToSchema, Serialize)]
pub struct TokenUsageResponseFileItem {
    /// The unique ID of the file
    id: String,
    /// The original filename of the file
    filename: String,
    /// Number of tokens used for this file's content
    token_count: usize,
}

/// Response for the token_usage_estimate endpoint
#[derive(Debug, ToSchema, Serialize)]
pub struct TokenUsageResponse {
    /// Overall statistics about token usage
    stats: TokenUsageStats,
    /// Detailed token usage for each file
    file_details: Vec<TokenUsageResponseFileItem>,
}

#[utoipa::path(
    post,
    path = "/token_usage/estimate",
    request_body = TokenUsageRequest,
    responses(
        (status = OK, body = TokenUsageResponse),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided"),
        (status = INTERNAL_SERVER_ERROR, description = "When an internal server error occurs")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn token_usage_estimate(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Json(request): Json<TokenUsageRequest>,
) -> Result<Json<TokenUsageResponse>, (axum::http::StatusCode, String)> {
    // Process files to get their text content
    let files_for_generation =
        match process_input_files_for_token_count(&app_state, &me_user, &request.input_files_ids)
            .await
        {
            Ok(files) => files,
            Err(err) => {
                return Err((
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to process input files: {}", err),
                ));
            }
        };

    // Get the input messages based on the previous message ID
    let input_messages = if let Some(prev_msg_id) = request.previous_message_id {
        match prepare_input_messages(&app_state, &prev_msg_id, files_for_generation.clone()).await {
            Ok(messages) => messages,
            Err(err) => {
                return Err((
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to prepare input messages: {}", err),
                ));
            }
        }
    } else if let Some(existing_chat_id) = request.existing_chat_id {
        // If existing_chat_id is provided, use it to get the chat history
        // For now, we just create an empty generation with the files
        // In a production implementation, we might fetch recent messages from the chat
        tracing::info!(
            "Using existing chat ID: {} for token usage estimation",
            existing_chat_id
        );
        let mut messages = GenerationInputMessages { messages: vec![] };
        for file in files_for_generation.clone() {
            let content = format!("File: {}\n{}", file.filename, file.contents_as_text);
            messages
                .messages
                .push(crate::models::message::InputMessage {
                    role: MessageRole::User,
                    content: MessageContent::String(content),
                });
        }
        messages
    } else {
        // If no previous message ID or existing chat ID, just create a new generation with the files
        let mut messages = GenerationInputMessages { messages: vec![] };
        for file in files_for_generation.clone() {
            let content = format!("File: {}\n{}", file.filename, file.contents_as_text);
            messages
                .messages
                .push(crate::models::message::InputMessage {
                    role: MessageRole::User,
                    content: MessageContent::String(content),
                });
        }
        messages
    };

    // Add the current user message to input messages
    let mut messages_with_user_message = input_messages.clone();
    messages_with_user_message
        .messages
        .push(crate::models::message::InputMessage {
            role: MessageRole::User,
            content: MessageContent::String(request.user_message.clone()),
        });

    // Calculate token counts using tiktoken
    let bpe = match o200k_base() {
        Ok(bpe) => bpe,
        Err(err) => {
            return Err((
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to initialize tokenizer: {}", err),
            ));
        }
    };

    // Count tokens for the user message
    let user_message_tokens = bpe.encode_with_special_tokens(&request.user_message).len();

    // Count tokens for files
    let mut file_details = Vec::new();
    let mut total_file_tokens = 0;
    for file in &files_for_generation {
        let token_count = bpe.encode_with_special_tokens(&file.contents_as_text).len();
        total_file_tokens += token_count;
        file_details.push(TokenUsageResponseFileItem {
            id: file.id.to_string(),
            filename: file.filename.clone(),
            token_count,
        });
    }

    // Count tokens for previous messages (history)
    let history_tokens: usize = messages_with_user_message
        .messages
        .iter()
        .map(|msg| bpe.encode_with_special_tokens(&msg.full_text()).len())
        .sum();

    // Calculate the history tokens without the user message
    let history_tokens_without_user = history_tokens.saturating_sub(user_message_tokens);

    // Calculate total and remaining tokens
    let total_tokens = history_tokens;
    let remaining_tokens = MAX_TOKENS.saturating_sub(total_tokens as u32);

    let stats = TokenUsageStats {
        total_tokens,
        user_message_tokens,
        history_tokens: history_tokens_without_user,
        file_tokens: total_file_tokens,
        max_tokens: MAX_TOKENS,
        remaining_tokens,
    };

    Ok(Json(TokenUsageResponse {
        stats,
        file_details,
    }))
}

async fn prepare_input_messages(
    app_state: &AppState,
    previous_message_id: &Uuid,
    files_for_generation: Vec<FileContentsForGeneration>,
) -> Result<GenerationInputMessages, Report> {
    crate::models::message::get_generation_input_messages_by_previous_message_id(
        &app_state.db,
        app_state.system_prompt.clone(),
        previous_message_id,
        Some(10),
        files_for_generation,
    )
    .await
}

async fn process_input_files_for_token_count(
    app_state: &AppState,
    me_user: &MeProfile,
    input_files_ids: &[Uuid],
) -> Result<Vec<FileContentsForGeneration>, Report> {
    let mut converted_files = vec![];
    for file_id in input_files_ids {
        // Get the file upload record
        let file_upload = crate::models::file_upload::get_file_upload_by_id(
            &app_state.db,
            app_state.policy(),
            &me_user.to_subject(),
            file_id,
        )
        .await
        .wrap_err(format!("Failed to get file upload with ID {}", file_id))?;

        // Get the file storage provider
        let file_storage = app_state
            .file_storage_providers
            .get(&file_upload.file_storage_provider_id)
            .ok_or_else(|| {
                eyre!(
                    "File storage provider not found: {}",
                    file_upload.file_storage_provider_id
                )
            })?;

        // Read the file content
        let file_bytes = file_storage
            .read_file_to_bytes(&file_upload.file_storage_path)
            .await
            .wrap_err(format!(
                "Failed to read file from storage: {}",
                file_upload.file_storage_path
            ))?;

        // Use parser_core to extract text from the file
        match parser_core::parse(&file_bytes) {
            Ok(text) => {
                converted_files.push(FileContentsForGeneration {
                    id: *file_id,
                    filename: file_upload.filename,
                    contents_as_text: text,
                });
            }
            Err(err) => {
                tracing::warn!(
                    "Failed to parse file {}: {} - Error: {}",
                    file_upload.filename,
                    file_id,
                    err
                );
            }
        }
    }
    Ok(converted_files)
}
