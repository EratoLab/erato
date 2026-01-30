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
use crate::server::api::v1beta::message_streaming::FileContentsForGeneration;
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
    new_input_files: Vec<FileContentsForGeneration>,
    chat_provider_config: &ChatProviderConfig,
    preferred_language: Option<&str>,
) -> Result<AbstractChatSequence, Report> {
    let mut sequence = AbstractChatSequence::new();

    // 1. Check if this is the first message
    let previous_message = message_repo.get_message_by_id(previous_message_id).await?;
    let is_first_message = previous_message.previous_message_id.is_none();

    // 2. Get assistant configuration if available
    let assistant_config = prompt_provider.get_assistant_config(chat).await?;

    // 3. Get system prompt
    let system_prompt = prompt_provider
        .get_system_prompt(chat_provider_config, preferred_language)
        .await?;

    // 4. Add system prompt if it exists
    if let Some(prompt) = system_prompt {
        sequence.push(AbstractChatSequencePart::SystemPrompt {
            spec: PromptSpec::Static { content: prompt },
        });
    }

    // 5. Add assistant prompt if it exists
    if let Some(ref assistant) = assistant_config {
        sequence.push(AbstractChatSequencePart::AssistantPrompt {
            spec: PromptSpec::Static {
                content: assistant.prompt.clone(),
            },
        });
    }

    // 6. Add assistant files if this is the first message
    // This encapsulates the logic that was previously in prepare_chat_request
    if is_first_message {
        if let Some(ref assistant) = assistant_config {
            if !assistant.files.is_empty() {
                tracing::debug!(
                    "Adding {} assistant files to first message in chat",
                    assistant.files.len()
                );

                // Get the file IDs to add as assistant files
                for file_info in &assistant.files {
                    sequence.push(AbstractChatSequencePart::AssistantFile {
                        file_id: file_info.id,
                        filename: file_info.filename.clone(),
                    });
                }
            }
        }
    }

    // 7. Traverse previous messages and add them to the sequence
    // We need to get up to 10 previous messages
    let previous_messages = message_repo
        .get_generation_input_messages(previous_message_id, 10)
        .await?;

    for prev_msg in previous_messages {
        // Parse the raw message to determine role
        let parsed = MessageSchema::validate(&prev_msg.raw_message)?;

        match parsed.role {
            MessageRole::User => {
                sequence.push(AbstractChatSequencePart::PreviousUserMessage {
                    message_id: prev_msg.id,
                });
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

    // 8. Add current user input files
    for file in new_input_files {
        sequence.push(AbstractChatSequencePart::CurrentUserInput {
            content: String::new(), // Files only, no text content in this part
            file_ids: vec![file.id],
            is_first_message,
        });
    }

    Ok(sequence)
}

/// Phase 2: Resolve the abstract sequence into actual input messages.
///
/// This follows the pattern from get_generation_input_messages_by_previous_message_id,
/// building up the actual message content.
pub async fn resolve_sequence(
    abstract_seq: AbstractChatSequence,
    message_repo: &impl MessageRepository,
    _file_resolver: &impl FileResolver,
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

            AbstractChatSequencePart::PreviousUserMessage { message_id }
            | AbstractChatSequencePart::PreviousAssistantMessage { message_id } => {
                // Fetch the message from the repository
                let message = message_repo.get_message_by_id(&message_id).await?;
                let parsed = MessageSchema::validate(&message.raw_message)?;

                // Add all content parts from this message
                for content_part in parsed.content {
                    input_messages.push(InputMessage {
                        role: parsed.role.clone(),
                        content: content_part,
                    });
                }
            }

            AbstractChatSequencePart::CurrentUserInput {
                content: _,
                file_ids,
                is_first_message: _,
            } => {
                // Add files as file pointers (will be resolved in the final step before LLM)
                for file_id in file_ids {
                    // For now, we'll determine file type by filename
                    // In the actual implementation, we'd fetch the file record
                    // but for the initial version, we'll create text file pointers
                    let content = ContentPart::TextFilePointer(ContentPartTextFilePointer {
                        file_upload_id: file_id,
                    });

                    input_messages.push(InputMessage {
                        role: MessageRole::User,
                        content,
                    });
                }
            }

            AbstractChatSequencePart::AssistantFile { file_id, filename } => {
                // Determine if it's an image file
                let is_image = is_image_file(&filename);

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

// Helper function
fn is_image_file(filename: &str) -> bool {
    if let Some(extension) = filename.rsplit('.').next() {
        matches!(
            extension.to_lowercase().as_str(),
            "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "svg" | "tiff" | "tif" | "ico"
        )
    } else {
        false
    }
}
