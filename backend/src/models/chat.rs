use crate::db::entity::chats;
use crate::db::entity::prelude::*;
use crate::policy::prelude::*;
use eyre::{eyre, Report};
use sea_orm::prelude::*;
use sea_orm::{ActiveValue, DatabaseConnection, EntityTrait};

/// Indicates whether a chat was newly created or already existed
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChatCreationStatus {
    /// The chat was newly created
    Created,
    /// The chat already existed
    Existing,
}

impl From<&chats::Model> for Resource {
    fn from(val: &chats::Model) -> Self {
        Resource::Chat(val.id.as_hyphenated().to_string())
    }
}

/// If `existing_chat_id` is provided, try to load the chat from the database.
/// If the chat is not found, an error is returned.
/// If `existing_chat_id` is not provided, create a new chat, with `owner_user_id` as the owner.
///
/// Returns a tuple of (chat model, creation status) where the status indicates whether
/// the chat was newly created or already existed.
pub async fn get_or_create_chat(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    existing_chat_id: Option<&Uuid>,
    owner_user_id: &str,
) -> Result<(chats::Model, ChatCreationStatus), Report> {
    if let Some(existing_chat_id) = existing_chat_id {
        let existing_chat: Option<chats::Model> =
            Chats::find_by_id(*existing_chat_id).one(conn).await?;
        // Return with error if the chat is not found
        let existing_chat = existing_chat.ok_or(eyre!("Chat {existing_chat_id} not found"))?;
        // Authorize the user to access the chat
        authorize!(policy, subject, &existing_chat, Action::Read)?;
        Ok((existing_chat, ChatCreationStatus::Existing))
    } else {
        // Authorize that user is allowed to create a chat
        authorize!(policy, subject, &Resource::ChatSingleton, Action::Create)?;
        let new_chat = chats::ActiveModel {
            owner_user_id: ActiveValue::Set(owner_user_id.to_owned()),
            ..Default::default()
        };
        let created_chat = chats::Entity::insert(new_chat)
            .exec_with_returning(conn)
            .await?;
        Ok((created_chat, ChatCreationStatus::Created))
    }
}
