//! Transformation functions for the three-phase prompt composition pipeline.
//!
//! This module contains the core logic for transforming chat data through the
//! three phases: Abstract → Resolved → Concrete

use super::traits::{FileResolver, MessageRepository, PromptProvider};
use super::types::{
    AbstractChatSequence, AbstractChatSequencePart, ConcreteChatRequest, PromptSpec,
    ResolvedChatSequence,
};
use crate::config::ChatProviderConfig;
use crate::db::entity::chats;
use crate::models::message::{
    ContentPart, ContentPartImageFilePointer, ContentPartText, ContentPartTextFilePointer,
    GenerationInputMessages, InputMessage, MessageRole, MessageSchema,
};
use eyre::Report;
use sea_orm::prelude::Uuid;

/// Phase 1: Build the abstract sequence of chat messages.
/// This phase determines the logical structure and ordering without performing any I/O.
///
/// This function handles all the decision logic:
/// - Determines if this is the first message in the chat
/// - Decides whether to include assistant files (only on first message)
/// - Decides whether to include system and assistant prompts
/// - Determines message ordering
pub async fn build_abstract_sequence(
    message_repo: &impl MessageRepository,
    prompt_provider: &impl PromptProvider,
    chat: &chats::Model,
    previous_message_id: &Uuid,
    new_input_file_ids: Vec<Uuid>,
    chat_provider_config: &ChatProviderConfig,
    preferred_language: Option<&str>,
) -> Result<AbstractChatSequence, Report> {
    let mut sequence = AbstractChatSequence::new();

    // 1. Check if this is the first message
    let previous_message = message_repo.get_message_by_id(previous_message_id).await?;
    let is_first_message = previous_message.previous_message_id.is_none();

    // 2. Get assistant configuration if available
    let assistant_config = prompt_provider.get_assistant_config(chat).await?;

    // 3. Get the previous messages for the conversation history
    // We need these early to check if we should add system prompts
    let previous_messages = message_repo
        .get_generation_input_messages(previous_message_id, 10)
        .await?;

    // 4. Find the most recent message with generation_input_messages
    let most_recent_with_gen_input = previous_messages
        .iter()
        .rev()
        .find(|msg| msg.generation_input_messages.is_some());

    // Prefer the most recent assistant message with generation_input_messages
    let most_recent_assistant_with_gen_input = previous_messages.iter().rev().find(|msg| {
        msg.generation_input_messages.is_some()
            && msg
                .raw_message
                .get("role")
                .and_then(|v| v.as_str())
                .map(|role| role == "assistant")
                .unwrap_or(false)
    });

    let most_recent_history_message =
        most_recent_assistant_with_gen_input.or(most_recent_with_gen_input);
    dbg!(&sequence);

    // 5. Check if we should add system prompts
    // System prompts should only be added if:
    // - This is the first message, OR
    // - We didn't find any message with generation_input_messages
    let should_add_system_prompts = is_first_message || most_recent_history_message.is_none();

    // 6. Get system prompt and add it, ONLY if first message
    if should_add_system_prompts {
        let system_prompt = prompt_provider
            .get_system_prompt(chat_provider_config, preferred_language)
            .await?;
        if let Some(prompt) = system_prompt {
            sequence.push(AbstractChatSequencePart::SystemPrompt {
                spec: PromptSpec::Static { content: prompt },
            });
        }
    };
    // 8. Add assistant prompt if it exists, ONLY if first message
    if should_add_system_prompts && let Some(ref assistant) = assistant_config {
        sequence.push(AbstractChatSequencePart::AssistantPrompt {
            spec: PromptSpec::Static {
                content: assistant.prompt.clone(),
            },
        });
    }
    // 9. Add assistant files if this is the first message
    // This encapsulates the logic that was previously in prepare_chat_request
    if is_first_message
        && let Some(ref assistant) = assistant_config
        && !assistant.files.is_empty()
    {
        tracing::debug!(
            "Adding {} assistant files to first message in chat",
            assistant.files.len()
        );

        // Get the file IDs to add as assistant files
        for file_info in &assistant.files {
            sequence.push(AbstractChatSequencePart::AssistantFile {
                file_id: file_info.id,
            });
        }
    }
    dbg!(&sequence);

    // 10. Add previous messages to the sequence
    // If we found an assistant message with generation_input_messages,
    // we skip messages BEFORE it (since its generation_input_messages
    // already contains everything up to and including the assistant response)
    // But we still ADD the assistant message itself so resolve_sequence can use its generation_input_messages
    let found_history_id = most_recent_history_message.map(|m| m.id);
    let mut passed_assistant = found_history_id.is_none(); // Start as true if no history found

    for prev_msg in &previous_messages {
        // Check if we've reached the assistant message
        if let Some(history_id) = found_history_id
            && prev_msg.id == history_id
        {
            passed_assistant = true;
            sequence.push(
                AbstractChatSequencePart::HistoricMessagesFromGenerationInputMessages {
                    message_id: prev_msg.id,
                },
            );
            if prev_msg
                .raw_message
                .get("role")
                .and_then(|v| v.as_str())
                .map(|role| role == "assistant")
                .unwrap_or(false)
            {
                let mut include_raw_assistant = true;
                if let Some(gen_input_json) = &prev_msg.generation_input_messages
                    && let Ok(gen_input) =
                        serde_json::from_value::<GenerationInputMessages>(gen_input_json.clone())
                {
                    let parsed = MessageSchema::validate(&prev_msg.raw_message)?;
                    let raw_text = parsed.content.iter().find_map(|part| match part {
                        ContentPart::Text(ContentPartText { text }) => Some(text.as_str()),
                        _ => None,
                    });
                    if let Some(raw_text) = raw_text {
                        let has_matching_assistant = gen_input.messages.iter().any(|msg| {
                            if !matches!(msg.role, MessageRole::Assistant) {
                                return false;
                            }
                            match &msg.content {
                                ContentPart::Text(ContentPartText { text }) => text == raw_text,
                                _ => false,
                            }
                        });
                        if has_matching_assistant {
                            include_raw_assistant = false;
                        }
                    }
                }

                if include_raw_assistant {
                    sequence.push(AbstractChatSequencePart::PreviousAssistantMessage {
                        message_id: prev_msg.id,
                    });
                }
            }
            continue;
        }

        // Only add messages if we've passed the assistant (or there is no assistant)
        if passed_assistant {
            // Parse the raw message to determine role
            let parsed = MessageSchema::validate(&prev_msg.raw_message)?;

            match parsed.role {
                MessageRole::User => {
                    if prev_msg.id == *previous_message_id {
                        for part in parsed.content {
                            if let ContentPart::Text(ContentPartText { text }) = part
                                && !text.is_empty()
                            {
                                sequence.push(AbstractChatSequencePart::CurrentUserContent {
                                    content: text,
                                });
                            }
                        }
                    }
                }
                MessageRole::Assistant => {
                    sequence.push(AbstractChatSequencePart::PreviousAssistantMessage {
                        message_id: prev_msg.id,
                    });
                }
                // System and Tool messages are embedded in the content, not tracked separately here
                _ => {}
            }
        }
    }
    dbg!(&sequence);

    // 11. Add current user input files (as file references)
    let _ = is_first_message;
    for file_id in new_input_file_ids {
        sequence.push(AbstractChatSequencePart::UserFile { file_id });
    }
    dbg!(&sequence);

    Ok(sequence)
}

/// Phase 2: Resolve the abstract sequence into actual input messages.
///
/// This follows the pattern from get_generation_input_messages_by_previous_message_id,
/// building up the actual message content.
pub async fn resolve_sequence(
    abstract_seq: AbstractChatSequence,
    message_repo: &impl MessageRepository,
    file_resolver: &impl FileResolver,
) -> Result<(ResolvedChatSequence, GenerationInputMessages), Report> {
    let mut input_messages = Vec::new();
    let mut has_system_message = false;

    for part in abstract_seq.parts {
        match part {
            AbstractChatSequencePart::SystemPrompt { spec } => {
                let content = match spec {
                    PromptSpec::Static { content } => content,
                    PromptSpec::Langfuse { prompt_name: _ } => {
                        // Langfuse prompts should already be resolved in the PromptProvider
                        return Err(eyre::eyre!(
                            "Langfuse prompt should have been resolved earlier"
                        ));
                    }
                };

                input_messages.push(InputMessage {
                    role: MessageRole::System,
                    content: ContentPart::Text(ContentPartText { text: content }),
                });
                has_system_message = true;
            }

            AbstractChatSequencePart::AssistantPrompt { spec } => {
                let content = match spec {
                    PromptSpec::Static { content } => content,
                    PromptSpec::Langfuse { prompt_name: _ } => {
                        return Err(eyre::eyre!(
                            "Langfuse prompt should have been resolved earlier"
                        ));
                    }
                };

                // Only add if we haven't added system messages yet
                // (following the logic from get_generation_input_messages_by_previous_message_id)
                if !has_system_message {
                    input_messages.push(InputMessage {
                        role: MessageRole::System,
                        content: ContentPart::Text(ContentPartText { text: content }),
                    });
                    has_system_message = true;
                } else {
                    // If system message exists, add assistant prompt as second system message
                    input_messages.insert(
                        1,
                        InputMessage {
                            role: MessageRole::System,
                            content: ContentPart::Text(ContentPartText { text: content }),
                        },
                    );
                }
            }

            AbstractChatSequencePart::HistoricMessagesFromGenerationInputMessages {
                message_id,
            } => {
                let message = message_repo.get_message_by_id(&message_id).await?;

                if let Some(gen_input_json) = &message.generation_input_messages {
                    match serde_json::from_value::<GenerationInputMessages>(gen_input_json.clone())
                    {
                        Ok(gen_input) => {
                            let include_system = !has_system_message;
                            for input_msg in gen_input.messages {
                                if include_system || !matches!(input_msg.role, MessageRole::System)
                                {
                                    input_messages.push(input_msg);
                                }
                            }

                            has_system_message = true;
                        }
                        Err(_e) => {
                            tracing::warn!(
                                "Failed to parse generation_input_messages for message {:?}",
                                message_id
                            );
                        }
                    }
                } else {
                    tracing::warn!(
                        "Failed to retrieve generation_input_messages for message {:?}",
                        message_id
                    );
                }
            }

            AbstractChatSequencePart::PreviousAssistantMessage { message_id } => {
                let message = message_repo.get_message_by_id(&message_id).await?;
                let parsed = MessageSchema::validate(&message.raw_message)?;
                for content_part in parsed.content {
                    input_messages.push(InputMessage {
                        role: parsed.role.clone(),
                        content: content_part,
                    });
                }
            }

            AbstractChatSequencePart::CurrentUserContent { content } => {
                if !content.is_empty() {
                    input_messages.push(InputMessage {
                        role: MessageRole::User,
                        content: ContentPart::Text(ContentPartText { text: content }),
                    });
                }
            }

            AbstractChatSequencePart::UserFile { file_id }
            | AbstractChatSequencePart::AssistantFile { file_id } => {
                // Determine if it's an image file
                let is_image = file_resolver.is_image_file(file_id).await?;

                let content = if is_image {
                    ContentPart::ImageFilePointer(ContentPartImageFilePointer {
                        file_upload_id: file_id,
                        download_url: String::new(),
                    })
                } else {
                    ContentPart::TextFilePointer(ContentPartTextFilePointer {
                        file_upload_id: file_id,
                    })
                };

                input_messages.push(InputMessage {
                    role: MessageRole::User,
                    content,
                });
            }
        }
    }

    // Create the unresolved version (with file pointers) for DB storage
    let unresolved = GenerationInputMessages {
        messages: input_messages.clone(),
    };

    // Create the resolved sequence
    let resolved = ResolvedChatSequence::new(input_messages);

    Ok((resolved, unresolved))
}

/// Phase 3: Convert the resolved sequence to a concrete chat request.
/// This is the final step before sending to the LLM.
pub fn to_concrete_request(
    resolved_seq: ResolvedChatSequence,
    unresolved_messages: GenerationInputMessages,
) -> Result<ConcreteChatRequest, Report> {
    // Convert to genai ChatRequest using existing logic
    let generation_input = GenerationInputMessages {
        messages: resolved_seq.messages,
    };

    let request = generation_input.into_chat_request();

    Ok(ConcreteChatRequest {
        request,
        unresolved: unresolved_messages,
    })
}
