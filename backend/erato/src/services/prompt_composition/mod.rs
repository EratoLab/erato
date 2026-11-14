//! Prompt composition service for building chat requests.
//!
//! This module provides a type-safe, testable way to compose chat prompts
//! using a three-phase state machine pattern:
//!
//! 1. **Abstract Phase**: Determine message structure and ordering (no I/O)
//! 2. **Resolved Phase**: Fetch external resources (files, prompts, messages)
//! 3. **Concrete Phase**: Convert to final LLM request format (e.g. prompt rendering)
//!
//! ## Facet placement contract (ERMAIN-1101)
//!
//! Hidden facets belong to the baseline system head, injected once at chat
//! start (or by the existing deliberate context rebase), then replayed.
//! Newly activated normal facets and the current request's action facet belong
//! AFTER selected branch history and BEFORE current user content and files:
//!
//! ```text
//! base / assistant / hidden baseline
//! U1 -> R1 -> U2 -> R2
//! normal facet template -> normal facet additional prompt -> action directive
//! U3 + associated content
//! ```
//!
//! Turn instructions (`turn_instructions.<type>`, ERMAIN-1190) follow the
//! action directive in a fixed type order, with the action's lifetime.
//!
//! Normal facets are emitted in facet-ID order, template before additional
//! prompt; the action follows them. Both use User-role reminders so adapters
//! that collect System messages into a head cannot hoist these new directives.
//! Role, chronological placement, and lifetime are separate: normal directives
//! retain their activation/replay lifetime, while action markers are per-request
//! and stripped from prior-turn replay. Hidden instructions stay System-role.
//!
//! This additive placement preserves the baseline and extends history toward
//! its tip instead of rewriting the prefix preceding already generated replies.
//! It supports provider prefix-cache stability and chronological history hygiene;
//! it does not guarantee cache hits or thinking preservation, since tool/settings
//! changes and replay filters can independently change provider context.
//!
//! This is an explicit developer decision. Changing these placement rules
//! requires explicit developer approval. Legacy snapshots are replayed in their
//! stored order, subject to existing filters; no migration or retroactive
//! reordering is required. Hidden-facet platform lifecycle is deferred to
//! ERMAIN-1102; this contract does not redefine deactivation semantics.
//!
//! See `site/content/docs/architecture/prompt_composition.mdx` for the durable
//! architecture decision and compatibility/continuation checks.
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
//!     &FacetsConfig::default(),
//!     preferred_language,
//!     None,
//! ).await?;
//! ```

use crate::config::{
    ActionFacetConfig, ChatProviderConfig, TurnInstructionKind, TurnInstructionsConfig,
};
use crate::db::entity::chats;
use crate::models::message::GenerationInputMessages;
use eyre::Report;
use std::collections::{BTreeSet, HashMap};

pub mod adapters;
pub mod allowlist;
pub mod model_settings;
pub mod replay_policy;
pub mod traits;
pub mod transforms;
pub mod types;

#[cfg(test)]
mod tests;

// Re-export commonly used types
pub use adapters::{AppStateFileResolver, AppStatePromptProvider, DatabaseMessageRepository};
pub use allowlist::build_mcp_tool_allowlist;
pub use model_settings::build_model_settings_for_facets;
pub use replay_policy::ToolReplayPolicy;
pub use traits::{FileResolver, MessageRepository, PromptProvider};
pub use transforms::{build_abstract_sequence, resolve_sequence, to_concrete_request};
pub use types::{
    AbstractChatSequence, AbstractChatSequencePart, ConcreteChatRequest,
    PromptCompositionUserInput, PromptSpec, ResolvedChatSequence,
};

/// The turn instruction types that apply to a turn and have text configured.
/// Each type says here when it applies.
pub fn turn_instructions_for_turn(
    config: &TurnInstructionsConfig,
    reply_is_read_back: bool,
) -> BTreeSet<TurnInstructionKind> {
    [(TurnInstructionKind::SpokenReply, reply_is_read_back)]
        .into_iter()
        .filter(|&(kind, applies)| applies && config.prompt(kind).is_some())
        .map(|(kind, _)| kind)
        .collect()
}

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
    facets: &crate::config::FacetsConfig,
    preferred_language: Option<&str>,
    user_preference_nickname: Option<&str>,
    user_preference_job_title: Option<&str>,
    user_preference_assistant_custom_instructions: Option<&str>,
    user_preference_assistant_additional_information: Option<&str>,
    facet_tool_expansions: Option<&HashMap<String, Vec<String>>>,
    action_facet_configs: &HashMap<String, ActionFacetConfig>,
    platform: Option<&str>,
) -> Result<GenerationInputMessages, Report> {
    // Phase 1: Build abstract sequence
    let abstract_seq = transforms::build_abstract_sequence_with_facet_tool_expansions(
        message_repo,
        prompt_provider,
        chat,
        &user_input.just_submitted_user_message_id,
        user_input.new_input_file_ids.clone(),
        chat_provider_config,
        facets,
        &user_input.selected_facet_ids,
        preferred_language,
        user_preference_nickname,
        user_preference_job_title,
        user_preference_assistant_custom_instructions,
        user_preference_assistant_additional_information,
        facet_tool_expansions,
        user_input.action_facet.as_ref(),
        action_facet_configs,
        platform,
        &user_input.turn_instructions,
    )
    .await?;

    // Phase 2: Resolve to input messages (with file pointers, not resolved content)
    let (_resolved_seq, unresolved_messages) =
        resolve_sequence(abstract_seq, message_repo, file_resolver).await?;

    // Return the unresolved version for DB storage
    // File resolution will happen later via resolve_file_pointers_in_generation_input
    Ok(unresolved_messages)
}
