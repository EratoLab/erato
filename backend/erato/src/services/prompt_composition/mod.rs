//! Prompt composition service for building chat requests.
//!
//! This module provides a type-safe, testable way to compose chat prompts
//! using a three-phase state machine pattern:
//!
//! 1. **Abstract Phase**: Determine message structure and ordering (no I/O)
//! 2. **Resolved Phase**: Fetch external resources (files, prompts, messages)
//! 3. **Concrete Phase**: Convert to final LLM request format
//!
//! ## Example Usage
//!
//! ```ignore
//! use crate::services::prompt_composition::*;
//!
//! // Create dependencies
//! let message_repo = DatabaseMessageRepository { conn, policy, subject };
//! let file_resolver = AppStateFileResolver { app_state, access_token };
//! let prompt_provider = AppStatePromptProvider { app_state, policy, subject };
//!
//! // Use the convenience function
//! let unresolved_messages = compose_prompt_messages(
//!     &message_repo,
//!     &file_resolver,
//!     &prompt_provider,
//!     &chat,
//!     &previous_message_id,
//!     new_input_files,
//!     &chat_provider_config,
//!     preferred_language,
//! ).await?;
//! ```

use crate::config::ChatProviderConfig;
use crate::db::entity::chats;
use crate::models::message::GenerationInputMessages;
use crate::server::api::v1beta::message_streaming::FileContentsForGeneration;
use eyre::Report;
use sea_orm::prelude::Uuid;

pub mod adapters;
pub mod traits;
pub mod transforms;
pub mod types;

#[cfg(test)]
mod tests;

// Re-export commonly used types
pub use adapters::{AppStateFileResolver, AppStatePromptProvider, DatabaseMessageRepository};
pub use traits::{FileResolver, MessageRepository, PromptProvider};
pub use transforms::{build_abstract_sequence, resolve_sequence, to_concrete_request};
pub use types::{
    AbstractChatSequence, AbstractChatSequencePart, ConcreteChatRequest, PromptSpec,
    ResolvedChatSequence,
};

/// Convenience function that orchestrates all three phases of prompt composition.
///
/// This function:
/// 1. Builds an abstract sequence (determining message structure)
/// 2. Resolves the sequence (fetching resources)
/// 3. Returns the unresolved GenerationInputMessages for DB storage
///
/// Note: File pointers are NOT resolved to actual content here. That happens
/// separately via `resolve_file_pointers_in_generation_input` before sending to LLM.
pub async fn compose_prompt_messages(
    message_repo: &impl MessageRepository,
    file_resolver: &impl FileResolver,
    prompt_provider: &impl PromptProvider,
    chat: &chats::Model,
    previous_message_id: &Uuid,
    new_input_files: Vec<FileContentsForGeneration>,
    chat_provider_config: &ChatProviderConfig,
    preferred_language: Option<&str>,
) -> Result<GenerationInputMessages, Report> {
    // Phase 1: Build abstract sequence
    let abstract_seq = build_abstract_sequence(
        message_repo,
        prompt_provider,
        chat,
        previous_message_id,
        new_input_files,
        chat_provider_config,
        preferred_language,
    )
    .await?;

    // Phase 2: Resolve to input messages (with file pointers, not resolved content)
    let (_resolved_seq, unresolved_messages) =
        resolve_sequence(abstract_seq, message_repo, file_resolver).await?;

    // Return the unresolved version for DB storage
    // File resolution will happen later via resolve_file_pointers_in_generation_input
    Ok(unresolved_messages)
}
