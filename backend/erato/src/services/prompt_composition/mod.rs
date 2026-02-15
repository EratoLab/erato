//! Prompt composition service for building chat requests.
//!
//! This module provides a type-safe, testable way to compose chat prompts
//! using a three-phase state machine pattern:
//!
//! 1. **Abstract Phase**: Determine message structure and ordering (no I/O)
//! 2. **Resolved Phase**: Fetch external resources (files, prompts, messages)
//! 3. **Concrete Phase**: Convert to final LLM request format (e.g. prompt rendering)
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
//! // Create user input struct with file references (IDs only, not resolved content)
//! let user_input = PromptCompositionUserInput {
//!     just_submitted_user_message_id: saved_message_id,
//!     requested_chat_provider_id: Some("gpt-4".to_string()),
//!     new_input_file_ids: vec![file_id_1, file_id_2],
//! };
//!
//! // Use the convenience function
//! let unresolved_messages = compose_prompt_messages(
//!     &message_repo,
//!     &file_resolver,
//!     &prompt_provider,
//!     &chat,
//!     &user_input,
//!     &chat_provider_config,
//!     &ExperimentalFacetsConfig::default(),
//!     preferred_language,
//!     None,
//! ).await?;
//! ```

use crate::config::ChatProviderConfig;
use crate::db::entity::chats;
use crate::models::message::GenerationInputMessages;
use eyre::Report;
use std::collections::HashMap;

pub mod adapters;
pub mod allowlist;
pub mod model_settings;
pub mod traits;
pub mod transforms;
pub mod types;

#[cfg(test)]
mod tests;

// Re-export commonly used types
pub use adapters::{AppStateFileResolver, AppStatePromptProvider, DatabaseMessageRepository};
pub use allowlist::build_mcp_tool_allowlist;
pub use model_settings::build_model_settings_for_facets;
pub use traits::{FileResolver, MessageRepository, PromptProvider};
pub use transforms::{build_abstract_sequence, resolve_sequence, to_concrete_request};
pub use types::{
    AbstractChatSequence, AbstractChatSequencePart, ConcreteChatRequest,
    PromptCompositionUserInput, PromptSpec, ResolvedChatSequence,
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
#[allow(clippy::too_many_arguments)]
pub async fn compose_prompt_messages(
    message_repo: &impl MessageRepository,
    file_resolver: &impl FileResolver,
    prompt_provider: &impl PromptProvider,
    chat: &chats::Model,
    user_input: &PromptCompositionUserInput,
    chat_provider_config: &ChatProviderConfig,
    experimental_facets: &crate::config::ExperimentalFacetsConfig,
    preferred_language: Option<&str>,
    facet_tool_expansions: Option<&HashMap<String, Vec<String>>>,
) -> Result<GenerationInputMessages, Report> {
    // Phase 1: Build abstract sequence
    let abstract_seq = transforms::build_abstract_sequence_with_facet_tool_expansions(
        message_repo,
        prompt_provider,
        chat,
        &user_input.just_submitted_user_message_id,
        user_input.new_input_file_ids.clone(),
        chat_provider_config,
        experimental_facets,
        &user_input.selected_facet_ids,
        preferred_language,
        facet_tool_expansions,
    )
    .await?;

    // Phase 2: Resolve to input messages (with file pointers, not resolved content)
    let (_resolved_seq, unresolved_messages) =
        resolve_sequence(abstract_seq, message_repo, file_resolver).await?;

    // Return the unresolved version for DB storage
    // File resolution will happen later via resolve_file_pointers_in_generation_input
    Ok(unresolved_messages)
}
