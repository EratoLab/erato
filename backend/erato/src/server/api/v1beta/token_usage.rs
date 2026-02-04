use crate::models::message::{ContentPart, GenerationInputMessages, MessageRole};
use crate::policy::engine::PolicyEngine;
use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use crate::server::api::v1beta::message_streaming::{FileContent, FileContentsForGeneration};
use crate::services::file_processing_cached;
use crate::state::{AppState, ChatProviderConfigWithId};
use axum::extract::State;
use axum::{Extension, Json};
use eyre::Report;
use sea_orm::prelude::Uuid;
use serde::{Deserialize, Serialize};
use tracing::instrument;
use utoipa::ToSchema;

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
    #[schema(example = "gpt-4o")]
    /// Optional chat provider ID to use for token estimation. If not provided, uses the default provider.
    #[schema(nullable = false)]
    chat_provider_id: Option<String>,
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
    /// The chat provider ID that was used for this estimation
    chat_provider_id: String,
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
    Extension(policy): Extension<PolicyEngine>,
    Json(request): Json<TokenUsageRequest>,
) -> Result<Json<TokenUsageResponse>, (axum::http::StatusCode, String)> {
    // Process files to get their text content using cached version
    // Note: token_usage endpoint doesn't need SharePoint context as files should already be uploaded
    let files_for_generation = match file_processing_cached::process_files_parallel_cached(
        &app_state,
        &policy,
        &me_user,
        &request.input_files_ids,
        None, // No SharePoint context for token usage endpoint
    )
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
        match prepare_input_messages(
            &app_state,
            &prev_msg_id,
            files_for_generation.clone(),
            &me_user.groups,
            request.chat_provider_id.as_deref(),
            Some(me_user.preferred_language.as_str()),
        )
        .await
        {
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
            // Only process text files for token usage estimation
            if let FileContent::Text(ref text) = file.content {
                let content = format!("File: {}\n{}", file.filename, text);
                messages
                    .messages
                    .push(crate::models::message::InputMessage {
                        role: MessageRole::User,
                        content: ContentPart::Text(content.into()),
                    });
            }
        }
        messages
    } else {
        // If no previous message ID or existing chat ID, just create a new generation with the files
        let mut messages = GenerationInputMessages { messages: vec![] };
        for file in files_for_generation.clone() {
            // Only process text files for token usage estimation
            if let FileContent::Text(ref text) = file.content {
                let content = format!("File: {}\n{}", file.filename, text);
                messages
                    .messages
                    .push(crate::models::message::InputMessage {
                        role: MessageRole::User,
                        content: ContentPart::Text(content.into()),
                    });
            }
        }
        messages
    };

    // Add the current user message to input messages
    let mut messages_with_user_message = input_messages.clone();
    messages_with_user_message
        .messages
        .push(crate::models::message::InputMessage {
            role: MessageRole::User,
            content: ContentPart::Text(request.user_message.clone().into()),
        });

    // Calculate token counts using tiktoken with caching
    // Count tokens for the user message
    let user_message_tokens = async {
        let span = tracing::info_span!(
            "count_user_message_tokens",
            message_length = request.user_message.len(),
            token_count = tracing::field::Empty,
        );
        let _enter = span.enter();

        let result =
            file_processing_cached::get_token_count_cached(&app_state, &request.user_message).await;

        match result {
            Ok(count) => {
                span.record("token_count", count);
                tracing::debug!(token_count = count, "User message tokens counted");
                Ok(count)
            }
            Err(err) => Err(err),
        }
    }
    .await;

    let user_message_tokens = match user_message_tokens {
        Ok(count) => count,
        Err(err) => {
            return Err((
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to count tokens for user message: {}", err),
            ));
        }
    };

    // Count tokens for files in parallel using the cache
    let file_token_result = async {
        let span = tracing::info_span!(
            "count_file_tokens_parallel",
            num_files = files_for_generation.len(),
            total_tokens = tracing::field::Empty,
        );
        let _enter = span.enter();

        tracing::debug!(
            num_files = files_for_generation.len(),
            "Starting parallel file token counting"
        );

        let app_state_ref = &app_state;
        let file_token_futures = files_for_generation.iter().filter_map(|file| {
            // Only count tokens for text files
            if let FileContent::Text(ref text) = file.content {
                let file_id = file.id.to_string();
                let filename = file.filename.clone();
                let content = text.clone();
                Some(async move {
                    let token_count =
                        file_processing_cached::get_token_count_cached(app_state_ref, &content)
                            .await
                            .map_err(|err| {
                                format!("Failed to count tokens for file {}: {}", filename, err)
                            })?;
                    Ok::<_, String>(TokenUsageResponseFileItem {
                        id: file_id,
                        filename,
                        token_count,
                    })
                })
            } else {
                // Skip image files for token counting
                None
            }
        });

        let file_details_results = futures::future::join_all(file_token_futures).await;

        // Collect file details and calculate total
        let mut file_details = Vec::new();
        let mut total_file_tokens = 0;
        for result in file_details_results {
            match result {
                Ok(item) => {
                    total_file_tokens += item.token_count;
                    file_details.push(item);
                }
                Err(err) => {
                    return Err(err);
                }
            }
        }

        span.record("total_tokens", total_file_tokens);
        tracing::debug!(
            num_files = file_details.len(),
            total_tokens = total_file_tokens,
            "File token counting completed"
        );

        Ok::<_, String>((file_details, total_file_tokens))
    }
    .await;

    let (file_details, total_file_tokens) = match file_token_result {
        Ok(result) => result,
        Err(err) => {
            return Err((axum::http::StatusCode::INTERNAL_SERVER_ERROR, err));
        }
    };

    // Count tokens for previous messages (history) in parallel
    let history_tokens = async {
        let span = tracing::info_span!(
            "count_history_tokens_parallel",
            num_messages = messages_with_user_message.messages.len(),
            total_tokens = tracing::field::Empty,
        );
        let _enter = span.enter();

        tracing::debug!(
            num_messages = messages_with_user_message.messages.len(),
            "Starting parallel message token counting"
        );

        let app_state_ref = &app_state;
        let message_token_futures = messages_with_user_message.messages.iter().map(|msg| {
            let text = msg.full_text();
            async move {
                file_processing_cached::get_token_count_cached(app_state_ref, &text)
                    .await
                    .map_err(|err| format!("Failed to count tokens for message: {}", err))
            }
        });

        let message_token_results = futures::future::join_all(message_token_futures).await;

        let mut history_tokens = 0;
        for result in message_token_results {
            match result {
                Ok(count) => history_tokens += count,
                Err(err) => {
                    return Err(err);
                }
            }
        }

        span.record("total_tokens", history_tokens);
        tracing::debug!(
            num_messages = messages_with_user_message.messages.len(),
            total_tokens = history_tokens,
            "Message token counting completed"
        );

        Ok::<_, String>(history_tokens)
    }
    .await;

    let history_tokens = match history_tokens {
        Ok(count) => count,
        Err(err) => {
            return Err((axum::http::StatusCode::INTERNAL_SERVER_ERROR, err));
        }
    };

    // Calculate the history tokens without the user message
    let history_tokens_without_user = history_tokens.saturating_sub(user_message_tokens);

    // Get the chat provider configuration to determine max context tokens
    let chat_provider_config = match app_state
        .chat_provider_for_chatcompletion(request.chat_provider_id.as_deref(), &me_user.groups)
    {
        Ok(ChatProviderConfigWithId {
            chat_provider_config,
            ..
        }) => chat_provider_config,
        Err(err) => {
            return Err((
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get chat provider configuration: {}", err),
            ));
        }
    };

    // Determine which chat provider ID was actually used
    let chat_provider_allowlist =
        app_state.determine_chat_provider_allowlist_for_user(&me_user.groups);
    let allowlist_refs: Option<Vec<&str>> = chat_provider_allowlist
        .as_ref()
        .map(|list| list.iter().map(|s| s.as_str()).collect());

    let resolved_chat_provider_id = match app_state.config.determine_chat_provider(
        allowlist_refs.as_deref(),
        request.chat_provider_id.as_deref(),
    ) {
        Ok(id) => id.to_string(),
        Err(err) => {
            return Err((
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to determine chat provider: {}", err),
            ));
        }
    };

    let max_context_tokens = chat_provider_config.model_capabilities.context_size_tokens as u32;

    // Calculate total and remaining tokens
    let total_tokens = history_tokens;
    let remaining_tokens = max_context_tokens.saturating_sub(total_tokens as u32);

    let stats = TokenUsageStats {
        total_tokens,
        user_message_tokens,
        history_tokens: history_tokens_without_user,
        file_tokens: total_file_tokens,
        max_tokens: max_context_tokens,
        remaining_tokens,
        chat_provider_id: resolved_chat_provider_id,
    };

    Ok(Json(TokenUsageResponse {
        stats,
        file_details,
    }))
}

#[instrument(skip_all)]
async fn prepare_input_messages(
    app_state: &AppState,
    previous_message_id: &Uuid,
    files_for_generation: Vec<FileContentsForGeneration>,
    user_groups: &[String],
    requested_chat_provider_id: Option<&str>,
    preferred_language: Option<&str>,
) -> Result<GenerationInputMessages, Report> {
    // Resolve system prompt dynamically based on chat provider configuration
    let ChatProviderConfigWithId {
        chat_provider_config,
        ..
    } = app_state.chat_provider_for_chatcompletion(requested_chat_provider_id, user_groups)?;
    let system_prompt = app_state
        .get_system_prompt(&chat_provider_config, preferred_language)
        .await?;

    crate::models::message::get_generation_input_messages_by_previous_message_id(
        &app_state.db,
        system_prompt,
        None, // No assistant prompt for token estimation
        previous_message_id,
        Some(10),
        files_for_generation,
    )
    .await
}
