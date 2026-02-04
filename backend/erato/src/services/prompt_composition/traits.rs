use crate::config::{ChatProviderConfig, PromptSourceSpecification};
use crate::db::entity::chats;
use crate::db::entity::messages;
use crate::models::assistant::AssistantWithFiles;
use crate::models::message::ContentPartImage;
use crate::server::api::v1beta::message_streaming::FileContentsForGeneration;
use async_trait::async_trait;
use eyre::Report;
use sea_orm::prelude::Uuid;

/// Trait for accessing message data from the repository.
/// This abstraction allows for easy mocking in tests and separation of concerns.
#[async_trait]
pub trait MessageRepository: Send + Sync {
    /// Retrieve a single message by its ID
    async fn get_message_by_id(&self, message_id: &Uuid) -> Result<messages::Model, Report>;

    /// Retrieve the generation input messages for a given previous message ID.
    /// This traverses the message history backward from the given message.
    async fn get_generation_input_messages(
        &self,
        previous_message_id: &Uuid,
        num_messages: usize,
    ) -> Result<Vec<messages::Model>, Report>;
}

/// Trait for resolving file references to their actual content.
/// This abstraction allows for different file storage backends and easy testing.
#[async_trait]
pub trait FileResolver: Send + Sync {
    /// Resolve a text file pointer to its text content.
    /// Returns formatted text ready to be included in a message.
    async fn resolve_text_file(&self, file_id: Uuid) -> Result<String, Report>;

    /// Resolve an image file pointer to its image content part.
    /// Returns the image as a base64-encoded content part.
    async fn resolve_image_file(&self, file_id: Uuid) -> Result<ContentPartImage, Report>;

    /// Get files attached to an assistant, formatted for generation.
    async fn get_assistant_files(
        &self,
        file_ids: &[Uuid],
        access_token: Option<&str>,
    ) -> Result<Vec<FileContentsForGeneration>, Report>;

    /// Determine if a file is an image based on its extension
    async fn is_image_file(&self, file_id: Uuid) -> Result<bool, Report>;
}

/// Trait for providing system prompts and assistant configurations.
/// This abstraction allows for different prompt sources (static, Langfuse, etc.)
#[async_trait]
pub trait PromptProvider: Send + Sync {
    /// Get the system prompt for a given chat provider configuration.
    /// This may fetch from static config or from Langfuse.
    async fn get_system_prompt(
        &self,
        chat_provider_config: &ChatProviderConfig,
        preferred_language: Option<&str>,
    ) -> Result<Option<String>, Report>;

    /// Resolve a prompt source specification into a concrete prompt string.
    async fn resolve_prompt_source(
        &self,
        spec: &PromptSourceSpecification,
    ) -> Result<String, Report>;

    /// Get the assistant configuration for a chat, if any.
    async fn get_assistant_config(
        &self,
        chat: &chats::Model,
    ) -> Result<Option<AssistantWithFiles>, Report>;
}
