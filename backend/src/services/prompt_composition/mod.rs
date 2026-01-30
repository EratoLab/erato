//! Prompt composition service for building chat requests.
//!
//! This module provides a type-safe, testable way to compose chat prompts
//! using a three-phase state machine pattern:
//!
//! 1. **Abstract Phase**: Determine message structure and ordering (no I/O)
//! 2. **Resolved Phase**: Fetch external resources (files, prompts, messages)
//! 3. **Concrete Phase**: Convert to final LLM request format
//!
//! ## Example
//!
//! ```ignore
//! use prompt_composition::*;
//!
//! // Create dependencies
//! let message_repo = DatabaseMessageRepository { ... };
//! let file_resolver = AppStateFileResolver { ... };
//! let prompt_provider = AppStatePromptProvider { ... };
//!
//! // Build abstract sequence (Phase 1)
//! let abstract_seq = build_abstract_sequence(
//!     &message_repo,
//!     &prompt_provider,
//!     &chat,
//!     &previous_message_id,
//!     file_ids,
//!     &chat_provider_config,
//!     preferred_language,
//! ).await?;
//!
//! // Resolve external resources (Phase 2)
//! let resolved_seq = resolve_sequence(
//!     abstract_seq,
//!     &message_repo,
//!     &file_resolver,
//! ).await?;
//!
//! // Convert to concrete request (Phase 3)
//! let concrete_request = to_concrete_request(
//!     resolved_seq,
//!     unresolved_messages,
//! )?;
//! ```

pub mod adapters;
pub mod traits;
pub mod transforms;
pub mod types;

// Re-export commonly used types
pub use adapters::{AppStateFileResolver, AppStatePromptProvider, DatabaseMessageRepository};
pub use traits::{FileResolver, MessageRepository, PromptProvider};
pub use transforms::{build_abstract_sequence, resolve_sequence, to_concrete_request};
pub use types::{
    AbstractChatSequence, AbstractChatSequencePart, ConcreteChatRequest, PromptSpec,
    ResolvedChatSequence,
};
