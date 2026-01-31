use crate::models::message::{GenerationInputMessages, InputMessage};
use genai::chat::ChatRequest;
use sea_orm::prelude::Uuid;
use serde::{Deserialize, Serialize};

/// Contains the latest user input data for prompt composition.
///
/// This struct encapsulates the newly submitted user message and its associated
/// metadata to differentiate it from historical messages in the chat.
/// It serves as a clear boundary between new input and existing chat history.
#[derive(Debug, Clone)]
pub struct PromptCompositionUserInput {
    /// The ID of the user message that was just submitted.
    /// This identifies the latest message in the chat sequence.
    pub just_submitted_user_message_id: Uuid,

    /// The ID of the chat provider requested by the user for this generation.
    /// If None, the system will use the default provider based on configuration.
    pub requested_chat_provider_id: Option<String>,

    /// IDs of files attached to the newly submitted user message.
    /// These are file references that will be resolved to actual content
    /// via the centralized file resolution in `resolve_file_pointers_in_generation_input`.
    pub new_input_file_ids: Vec<Uuid>,
}

/// Represents the abstract sequence of chat messages before any I/O operations.
/// This phase determines the logical structure and ordering of messages without
/// fetching any external resources.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AbstractChatSequence {
    pub parts: Vec<AbstractChatSequencePart>,
}

/// Individual parts that make up an abstract chat sequence.
/// Each variant represents a different type of message or content that will
/// be included in the final chat request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AbstractChatSequencePart {
    /// Global system prompt from configuration or Langfuse
    SystemPrompt { spec: PromptSpec },

    /// Assistant-specific system prompt
    AssistantPrompt { spec: PromptSpec },

    /// File attached to the current user input
    UserFile { file_id: Uuid },

    /// The current user input content being submitted
    CurrentUserContent { content: String },

    /// Reference to a previous assistant message in the chat history
    PreviousAssistantMessage { message_id: Uuid },

    /// Reference point for reconstructing history from generation_input_messages
    HistoricMessagesFromGenerationInputMessages { message_id: Uuid },

    /// File attached to an assistant (added on first message only)
    AssistantFile { file_id: Uuid },
}

/// Specification for how to retrieve a prompt
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "source")]
pub enum PromptSpec {
    /// Static prompt string (from config or assistant)
    Static { content: String },

    /// Prompt to be fetched from Langfuse
    Langfuse { prompt_name: String },
}

/// Represents a chat sequence after all file pointers and prompts have been resolved.
/// All external resources have been fetched and the sequence is ready for
/// conversion to the final LLM request format.
#[derive(Debug, Clone)]
pub struct ResolvedChatSequence {
    pub messages: Vec<InputMessage>,
}

/// Final concrete chat request ready to be sent to the LLM provider.
/// Includes both the resolved request and an unresolved version for DB storage.
#[derive(Debug, Clone)]
pub struct ConcreteChatRequest {
    /// The fully resolved chat request ready for the LLM
    pub request: ChatRequest,

    /// Unresolved version with file pointers (for DB storage to avoid duplicating file contents)
    pub unresolved: GenerationInputMessages,
}

impl AbstractChatSequence {
    /// Create a new empty abstract sequence
    pub fn new() -> Self {
        Self { parts: Vec::new() }
    }

    /// Add a part to the sequence
    pub fn push(&mut self, part: AbstractChatSequencePart) {
        self.parts.push(part);
    }

    /// Get the number of parts in the sequence
    pub fn len(&self) -> usize {
        self.parts.len()
    }

    /// Check if the sequence is empty
    pub fn is_empty(&self) -> bool {
        self.parts.is_empty()
    }
}

impl Default for AbstractChatSequence {
    fn default() -> Self {
        Self::new()
    }
}

impl ResolvedChatSequence {
    /// Create a new resolved sequence from a list of input messages
    pub fn new(messages: Vec<InputMessage>) -> Self {
        Self { messages }
    }

    /// Get the number of messages in the sequence
    pub fn len(&self) -> usize {
        self.messages.len()
    }

    /// Check if the sequence is empty
    pub fn is_empty(&self) -> bool {
        self.messages.is_empty()
    }
}
