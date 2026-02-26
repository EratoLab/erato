use crate::db::entity::chats;
use crate::db::entity::messages;
use crate::db::entity::prelude::*;
use crate::models::chat::get_chat_by_message_id;
use crate::models::message::{
    ContentPart, ContentPartText, GenerationInputMessages, MessageRole, MessageSchema,
};
use crate::policy::engine::{PolicyEngine, authorize};
use crate::policy::types::{Action, Resource};
use crate::server::api::v1beta::file_resolution::format_successful_file_content;
use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use crate::server::api::v1beta::message_streaming::{
    FileContent, MeProfileChatRequestInput, prepare_chat_request_with_adapters,
};
use crate::services::file_processing_cached;
use crate::services::file_storage::SharepointContext;
use crate::services::prompt_composition::traits::MessageRepository;
use crate::services::prompt_composition::{
    AppStateFileResolver, AppStatePromptProvider, DatabaseMessageRepository,
    PromptCompositionUserInput,
};
use crate::state::{AppState, ChatProviderConfigWithId};
use async_trait::async_trait;
use axum::extract::State;
use axum::{Extension, Json};
use chrono::Utc;
use eyre::Report;
use genai::chat::ChatRequest;
use sea_orm::prelude::Uuid;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tracing::instrument;
use utoipa::ToSchema;

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct TokenUsageRequest {
    #[schema(example = "00000000-0000-0000-0000-000000000000")]
    /// The previous message ID to anchor chat history context.
    /// Preferred over `previous_message_id` for new clients.
    chat_previous_message_id: Option<Uuid>,
    #[schema(example = "Hello, world!")]
    /// Content for the new message being composed.
    /// Preferred over `user_message` for new clients.
    new_message_content: Option<String>,
    /// Configuration for estimating a new chat context.
    new_chat: Option<TokenUsageNewChatInput>,
    /// File content inputs to include in the estimation.
    file: Option<TokenUsageFileInput>,
    #[schema(example = "You are a concise legal assistant.")]
    /// Additional system prompt content to include in the estimation.
    system_prompt: Option<String>,

    // Legacy fields kept for backwards compatibility.
    #[schema(example = "00000000-0000-0000-0000-000000000000")]
    /// The ID of the message that this message is a response to. If this is the first message in the chat, this should be empty.
    previous_message_id: Option<Uuid>,
    #[schema(example = "00000000-0000-0000-0000-000000000000")]
    /// The ID of an existing chat to use. If provided, the chat with this ID will be used instead of creating a new one.
    existing_chat_id: Option<Uuid>,
    #[schema(example = "Hello, world!")]
    /// The text of the message.
    #[serde(default)]
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

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct TokenUsageNewChatInput {
    #[schema(example = "00000000-0000-0000-0000-000000000000")]
    /// Optional assistant ID for new chat context.
    assistant_id: Option<Uuid>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct TokenUsageFileInput {
    #[schema(example = "[\"00000000-0000-0000-0000-000000000000\"]")]
    /// File upload IDs to include in estimation.
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

struct SyntheticMessageRepository<'a> {
    base: DatabaseMessageRepository<'a>,
    synthetic_message: messages::Model,
}

#[async_trait]
impl<'a> MessageRepository for SyntheticMessageRepository<'a> {
    async fn get_message_by_id(&self, message_id: &Uuid) -> Result<messages::Model, Report> {
        if *message_id == self.synthetic_message.id {
            Ok(self.synthetic_message.clone())
        } else {
            self.base.get_message_by_id(message_id).await
        }
    }

    async fn get_generation_input_messages(
        &self,
        previous_message_id: &Uuid,
        num_messages: usize,
    ) -> Result<Vec<messages::Model>, Report> {
        let mut messages_vec = Vec::new();
        let mut current_message_id = Some(*previous_message_id);
        let mut count = 0;

        while let Some(msg_id) = current_message_id {
            if count >= num_messages {
                break;
            }

            let message = if msg_id == self.synthetic_message.id {
                self.synthetic_message.clone()
            } else {
                self.base.get_message_by_id(&msg_id).await?
            };
            current_message_id = message.previous_message_id;
            messages_vec.push(message);
            count += 1;
        }

        messages_vec.reverse();
        Ok(messages_vec)
    }
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
    let subject = me_user.to_subject();
    let previous_message_id = request
        .chat_previous_message_id
        .or(request.previous_message_id);
    let mut new_message_content = request.new_message_content.clone().unwrap_or_default();
    if !request.user_message.is_empty() {
        if !new_message_content.is_empty() {
            new_message_content.push('\n');
        }
        new_message_content.push_str(&request.user_message);
    }

    let mut file_id_set = HashSet::new();
    let mut input_file_ids = Vec::new();
    let mut push_file_id = |file_id: Uuid| {
        if file_id_set.insert(file_id) {
            input_file_ids.push(file_id);
        }
    };
    for file_id in &request.input_files_ids {
        push_file_id(*file_id);
    }
    if let Some(file_input) = request.file.as_ref() {
        for file_id in &file_input.input_files_ids {
            push_file_id(*file_id);
        }
    }

    let mut chat = None;
    let mut assistant_config = None;

    if let Some(prev_msg_id) = previous_message_id {
        let resolved_chat = get_chat_by_message_id(&app_state.db, &policy, &subject, &prev_msg_id)
            .await
            .map_err(|err| {
                (
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to resolve chat from previous_message_id: {}", err),
                )
            })?;
        let resolved_assistant_config = crate::models::chat::get_chat_assistant_configuration(
            &app_state.db,
            &policy,
            &subject,
            &resolved_chat,
        )
        .await
        .map_err(|err| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to load assistant configuration: {}", err),
            )
        })?;
        chat = Some(resolved_chat);
        assistant_config = resolved_assistant_config;
    } else if let Some(existing_chat_id) = request.existing_chat_id {
        let resolved_chat = match Chats::find_by_id(existing_chat_id).one(&app_state.db).await {
            Ok(Some(chat)) => {
                if let Err(err) = authorize!(
                    &policy,
                    &subject,
                    &Resource::Chat(chat.id.to_string()),
                    Action::Read
                ) {
                    return Err((axum::http::StatusCode::UNAUTHORIZED, err.to_string()));
                }
                chat
            }
            Ok(None) => {
                return Err((
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Chat with ID {} not found", existing_chat_id),
                ));
            }
            Err(err) => {
                return Err((
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to load chat: {}", err),
                ));
            }
        };
        let resolved_assistant_config = crate::models::chat::get_chat_assistant_configuration(
            &app_state.db,
            &policy,
            &subject,
            &resolved_chat,
        )
        .await
        .map_err(|err| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to load assistant configuration: {}", err),
            )
        })?;
        chat = Some(resolved_chat);
        assistant_config = resolved_assistant_config;
    } else if let Some(new_chat) = request.new_chat.as_ref() {
        if let Some(assistant_id) = new_chat.assistant_id {
            let resolved_assistant_config = crate::models::assistant::get_assistant_with_files(
                &app_state.db,
                &policy,
                &subject,
                assistant_id,
                true,
            )
            .await
            .map_err(|err| {
                (
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to load assistant for new_chat: {}", err),
                )
            })?;
            assistant_config = Some(resolved_assistant_config);
        }

        let assistant_configuration = new_chat
            .assistant_id
            .map(|assistant_id| serde_json::json!({ "assistant_id": assistant_id }));
        let now = Utc::now().into();
        let synthetic_chat = chats::Model {
            id: Uuid::new_v4(),
            owner_user_id: me_user.id.clone(),
            created_at: now,
            updated_at: now,
            title_by_summary: None,
            archived_at: None,
            title_by_user_provided: None,
            assistant_configuration,
            assistant_id: new_chat.assistant_id,
        };
        chat = Some(synthetic_chat);
    }

    let history_message_id = if previous_message_id.is_some() {
        previous_message_id
    } else if let Some(chat) = chat.as_ref() {
        find_latest_message_id(&app_state.db, chat.id)
            .await
            .map_err(|err| {
                (
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to determine latest message for chat: {}", err),
                )
            })?
    } else {
        None
    };

    let user_message_tokens = if new_message_content.is_empty() {
        0
    } else {
        let span = tracing::info_span!(
            "count_user_message_tokens",
            message_length = new_message_content.len(),
            token_count = tracing::field::Empty,
        );
        let _enter = span.enter();
        file_processing_cached::get_token_count_cached(&app_state, &new_message_content)
            .await
            .inspect(|count| {
                span.record("token_count", count);
                tracing::debug!(token_count = count, "User message tokens counted");
            })
            .map_err(|err| {
                (
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to count tokens for user message: {}", err),
                )
            })?
    };

    let files_for_generation = file_processing_cached::process_files_parallel_cached(
        &app_state,
        &policy,
        &me_user,
        &input_file_ids,
        me_user
            .access_token
            .as_ref()
            .map(|token| SharepointContext {
                access_token: token,
            }),
    )
    .await
    .map_err(|err| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to process input files: {}", err),
        )
    })?;

    let (file_details, total_file_tokens) = {
        let span = tracing::info_span!(
            "count_file_tokens_parallel",
            num_files = files_for_generation.len(),
            total_tokens = tracing::field::Empty,
        );
        let _enter = span.enter();

        let app_state_ref = &app_state;
        let file_token_futures = files_for_generation.iter().filter_map(|file| {
            if let FileContent::Text(ref text) = file.content {
                let file_id = file.id;
                let filename = file.filename.clone();
                let formatted = format_successful_file_content(&filename, file_id, text);
                Some(async move {
                    let token_count =
                        file_processing_cached::get_token_count_cached(app_state_ref, &formatted)
                            .await
                            .map_err(|err| {
                                format!("Failed to count tokens for file {}: {}", filename, err)
                            })?;
                    Ok::<_, String>(TokenUsageResponseFileItem {
                        id: file_id.to_string(),
                        filename,
                        token_count,
                    })
                })
            } else {
                None
            }
        });

        let file_details_results = futures::future::join_all(file_token_futures).await;
        let mut file_details = Vec::new();
        let mut total_file_tokens = 0;
        for result in file_details_results {
            match result {
                Ok(item) => {
                    total_file_tokens += item.token_count;
                    file_details.push(item);
                }
                Err(err) => {
                    return Err((axum::http::StatusCode::INTERNAL_SERVER_ERROR, err));
                }
            }
        }

        span.record("total_tokens", total_file_tokens);
        (file_details, total_file_tokens)
    };

    let chat_request = if let Some(chat) = chat.as_ref() {
        let synthetic_message_id = Uuid::new_v4();
        let raw_message = MessageSchema {
            role: MessageRole::User,
            content: vec![ContentPart::Text(ContentPartText {
                text: new_message_content.clone(),
            })],
            name: None,
            additional_fields: Default::default(),
        }
        .to_json()
        .map_err(|err| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to serialize synthetic message: {}", err),
            )
        })?;

        let now = Utc::now().into();
        let synthetic_message = messages::Model {
            id: synthetic_message_id,
            chat_id: chat.id,
            raw_message,
            created_at: now,
            updated_at: now,
            previous_message_id: history_message_id,
            sibling_message_id: None,
            is_message_in_active_thread: true,
            generation_input_messages: None,
            input_file_uploads: None,
            generation_parameters: None,
            generation_metadata: None,
        };

        let base_repo = DatabaseMessageRepository {
            conn: &app_state.db,
            policy: &policy,
            subject: &subject,
        };
        let message_repo = SyntheticMessageRepository {
            base: base_repo,
            synthetic_message,
        };
        let file_resolver = AppStateFileResolver {
            app_state: &app_state,
            access_token: me_user.access_token.as_deref(),
        };
        let prompt_provider = AppStatePromptProvider {
            app_state: &app_state,
            policy: &policy,
            subject: &subject,
            access_token: me_user.access_token.as_deref(),
        };
        let user_input = PromptCompositionUserInput {
            just_submitted_user_message_id: synthetic_message_id,
            requested_chat_provider_id: request.chat_provider_id.clone(),
            new_input_file_ids: input_file_ids.clone(),
            selected_facet_ids: vec![],
        };
        let me_profile_input = MeProfileChatRequestInput::from_me_profile(&me_user);

        prepare_chat_request_with_adapters(
            &app_state,
            chat,
            user_input,
            &me_profile_input,
            assistant_config.clone(),
            &message_repo,
            &file_resolver,
            &prompt_provider,
        )
        .await
        .map_err(|err| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to prepare chat request: {}", err),
            )
        })?
        .chat_request()
        .clone()
    } else {
        let mut messages = GenerationInputMessages { messages: vec![] };
        if !new_message_content.is_empty() {
            messages
                .messages
                .push(crate::models::message::InputMessage {
                    role: MessageRole::User,
                    content: ContentPart::Text(ContentPartText {
                        text: new_message_content.clone(),
                    }),
                });
        }
        for file in &files_for_generation {
            if let FileContent::Text(ref text) = file.content {
                let formatted = format_successful_file_content(&file.filename, file.id, text);
                messages
                    .messages
                    .push(crate::models::message::InputMessage {
                        role: MessageRole::User,
                        content: ContentPart::Text(ContentPartText { text: formatted }),
                    });
            }
        }
        messages.into_chat_request()
    };

    let mut chat_request = chat_request;
    if let Some(system_prompt) = request.system_prompt.as_ref()
        && !system_prompt.is_empty()
    {
        chat_request.system = Some(match chat_request.system {
            Some(existing) if !existing.is_empty() => format!("{}\n{}", existing, system_prompt),
            _ => system_prompt.clone(),
        });
    }

    let total_tokens = count_tokens_for_chat_request(&app_state, &chat_request)
        .await
        .map_err(|err| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, err))?;

    let history_tokens_without_user = total_tokens
        .saturating_sub(user_message_tokens)
        .saturating_sub(total_file_tokens);

    let requested_chat_provider_id = request.chat_provider_id.as_deref();
    let effective_chat_provider_id = requested_chat_provider_id.or_else(|| {
        assistant_config
            .as_ref()
            .and_then(|a| a.default_chat_provider.as_deref())
    });

    let ChatProviderConfigWithId {
        chat_provider_config,
        chat_provider_id,
    } = app_state
        .chat_provider_for_chatcompletion(effective_chat_provider_id, &me_user.groups)
        .map_err(|err| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get chat provider configuration: {}", err),
            )
        })?;
    let max_context_tokens = chat_provider_config.model_capabilities.context_size_tokens as u32;
    let remaining_tokens = max_context_tokens.saturating_sub(total_tokens as u32);

    Ok(Json(TokenUsageResponse {
        stats: TokenUsageStats {
            total_tokens,
            user_message_tokens,
            history_tokens: history_tokens_without_user,
            file_tokens: total_file_tokens,
            max_tokens: max_context_tokens,
            remaining_tokens,
            chat_provider_id,
        },
        file_details,
    }))
}

#[instrument(skip_all)]
async fn find_latest_message_id(
    db: &sea_orm::DatabaseConnection,
    chat_id: Uuid,
) -> Result<Option<Uuid>, Report> {
    let message = messages::Entity::find()
        .filter(messages::Column::ChatId.eq(chat_id))
        .filter(messages::Column::IsMessageInActiveThread.eq(true))
        .order_by_desc(messages::Column::CreatedAt)
        .one(db)
        .await?;

    Ok(message.map(|m| m.id))
}

async fn count_tokens_for_chat_request(
    app_state: &AppState,
    chat_request: &ChatRequest,
) -> Result<usize, String> {
    let span = tracing::info_span!(
        "count_chat_request_tokens",
        num_messages = chat_request.messages.len(),
        total_tokens = tracing::field::Empty,
    );
    let _enter = span.enter();

    let mut text_chunks: Vec<String> = Vec::new();

    if let Some(system) = &chat_request.system
        && !system.is_empty()
    {
        text_chunks.push(system.clone());
    }

    for msg in &chat_request.messages {
        let mut parts = Vec::new();
        if msg.content.is_text_only() {
            if let Some(text) = msg.content.first_text()
                && !text.is_empty()
            {
                parts.push(text.to_string());
            }
        } else {
            for part in msg.content.parts() {
                if let genai::chat::ContentPart::Text(text) = part
                    && !text.is_empty()
                {
                    parts.push(text.to_string());
                }
            }
        }

        if !parts.is_empty() {
            text_chunks.push(parts.join(" "));
        }
    }

    let app_state_ref = app_state;
    let futures = text_chunks.iter().map(|text| async move {
        file_processing_cached::get_token_count_cached(app_state_ref, text)
            .await
            .map_err(|err| format!("Failed to count tokens for chat request: {}", err))
    });

    let results = futures::future::join_all(futures).await;
    let mut total_tokens = 0;
    for result in results {
        match result {
            Ok(count) => total_tokens += count,
            Err(err) => return Err(err),
        }
    }

    span.record("total_tokens", total_tokens);
    Ok(total_tokens)
}
