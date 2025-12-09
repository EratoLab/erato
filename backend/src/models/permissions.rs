//! Permission helpers for chats and messages
//!
//! Keep this module small and focused. It should expose narrowly scoped
//! helpers that higher layers (API mappers/handlers) can call to decorate
//! DTOs with permission flags. Later, these helpers can be expanded to use
//! richer policy inputs without changing call sites.

/// Returns whether the current user can edit a given chat.
///
/// Current logic: only the chat owner can edit.
///
/// Future: Extend to collaborators/roles/policies as needed. Keep the
/// signature stable so API layers stay unchanged.
pub fn can_user_edit_chat(current_user_id: &str, owner_user_id: &str) -> bool {
    current_user_id == owner_user_id
}

/// Returns whether the current user can edit a given assistant.
///
/// Current logic: only the assistant owner can edit.
///
/// Future: Extend to collaborators/roles/policies as needed. Keep the
/// signature stable so API layers stay unchanged.
pub fn can_user_edit_assistant(current_user_id: &str, owner_user_id: &str) -> bool {
    current_user_id == owner_user_id
}

/// Placeholder for future, message-level permission checks.
///
/// NOTE: Do not use yet in handlers. We'll extend the message endpoints to
/// run explicit authorization checks when we ship message-level permissions.
#[allow(dead_code)]
pub fn can_user_edit_message(_current_user_id: &str, _message_role: &str) -> bool {
    // For now rely on chat-level can_edit surfaced on chat resources.
    // Intentionally conservative: return false until explicit logic is added.
    false
}
