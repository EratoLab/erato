use crate::db::entity::messages;
use crate::db::entity_ext::chats;
use crate::db::entity_ext::chats_latest_message;
use crate::db::entity_ext::prelude::*;
use crate::models::message::GenerationParameters;
use crate::models::pagination;
use crate::policy::prelude::*;
use eyre::{Report, eyre};
use sea_orm::prelude::*;
use sea_orm::{
    ActiveValue, DatabaseConnection, EntityTrait, FromQueryResult, QueryOrder, QuerySelect,
};
use serde::{Deserialize, Serialize};
use sqlx::types::chrono::Utc;
use tracing::instrument;

/// Configuration for a chat that is based on an assistant
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AssistantConfiguration {
    /// The ID of the assistant this chat is based on
    pub assistant_id: Uuid,
}

impl AssistantConfiguration {
    /// Create a new assistant configuration
    pub fn new(assistant_id: Uuid) -> Self {
        Self { assistant_id }
    }

    /// Parse assistant configuration from a JSONB value
    pub fn from_json(json: &serde_json::Value) -> Result<Self, Report> {
        serde_json::from_value(json.clone())
            .map_err(|e| eyre!("Failed to parse assistant configuration: {}", e))
    }

    /// Convert to a JSONB value for storage
    pub fn to_json(&self) -> Result<serde_json::Value, Report> {
        serde_json::to_value(self)
            .map_err(|e| eyre!("Failed to serialize assistant configuration: {}", e))
    }
}

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
/// If `assistant_id` is provided when creating a new chat, the assistant configuration will be stored.
///
/// Returns a tuple of (chat model, creation status) where the status indicates whether
/// the chat was newly created or already existed.
pub async fn get_or_create_chat(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    existing_chat_id: Option<&Uuid>,
    owner_user_id: &str,
    assistant_id: Option<&Uuid>,
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

        // Build assistant_configuration JSON if assistant_id is provided
        let assistant_configuration = if let Some(aid) = assistant_id {
            Some(AssistantConfiguration::new(*aid).to_json()?)
        } else {
            None
        };

        let new_chat = chats::ActiveModel {
            owner_user_id: ActiveValue::Set(owner_user_id.to_owned()),
            assistant_configuration: ActiveValue::Set(assistant_configuration),
            ..Default::default()
        };
        let created_chat = chats::Entity::insert(new_chat)
            .exec_with_returning(conn)
            .await?;
        Ok((created_chat, ChatCreationStatus::Created))
    }
}

/// Get all chats from the database.
pub async fn get_all_chats(conn: &DatabaseConnection) -> Result<Vec<chats::Model>, Report> {
    Ok(Chats::find().all(conn).await?)
}

/// Convenience method to get or create a chat based on a previous message ID.
///
/// If the message ID is provided, it will find the chat that the message belongs to.
/// If the message ID is not provided, it will create a new chat.
///
/// Returns a tuple of (chat model, creation status) where the status indicates whether
/// the chat was newly created or already existed.
pub async fn get_or_create_chat_by_previous_message_id(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    previous_message_id: Option<&Uuid>,
    owner_user_id: &str,
    assistant_id: Option<&Uuid>,
) -> Result<(chats::Model, ChatCreationStatus), Report> {
    if let Some(message_id) = previous_message_id {
        // Find the message to get its chat_id
        let message = Messages::find_by_id(*message_id)
            .one(conn)
            .await?
            .ok_or_else(|| eyre!("Message with ID {} not found", message_id))?;

        // Use the chat_id from the message with get_or_create_chat
        // Note: We pass None for assistant_id here because we're referencing an existing chat
        // by its chat_id. The existing chat already has its assistant_configuration stored,
        // and get_or_create_chat will return that existing chat without using the assistant_id
        // parameter (which is only used when creating a NEW chat).
        get_or_create_chat(
            conn,
            policy,
            subject,
            Some(&message.chat_id),
            owner_user_id,
            None, // assistant_id is ignored when existing_chat_id is provided
        )
        .await
    } else {
        // No previous message ID, so create a new chat using get_or_create_chat
        // Pass assistant_id here so it gets stored in the new chat's assistant_configuration
        get_or_create_chat(conn, policy, subject, None, owner_user_id, assistant_id).await
    }
}

#[derive(Debug, FromQueryResult)]
pub struct RecentChat {
    pub id: String,
    /// Title of the chat, as generated by a summary of the chat.
    pub title_by_summary: String,
    /// Time of the last message in the chat.
    pub last_message_at: DateTimeWithTimeZone,
    pub archived_at: Option<DateTimeWithTimeZone>,
    /// Owner of the chat (for permission checks at the API boundary)
    pub owner_user_id: String,
    /// The chat provider ID used for the most recent message
    pub last_chat_provider_id: Option<String>,
    /// The assistant ID if this chat is based on an assistant
    pub assistant_id: Option<Uuid>,
    /// The name of the assistant if this chat is based on an assistant
    pub assistant_name: Option<String>,
}

/// Statistics for a list of chats
#[derive(Debug, Clone)]
pub struct ChatListStats {
    /// Total number of chats available
    pub total_count: i64,
    /// Current offset in the list
    pub current_offset: u64,
    /// Number of chats in the current response
    pub returned_count: usize,
    /// Whether there are more chats available
    pub has_more: bool,
}

/// Represents an assistant with usage frequency statistics
#[derive(Debug, Clone)]
pub struct FrequentAssistant {
    /// The assistant details
    pub assistant: crate::models::assistant::AssistantWithFiles,
    /// Number of chats created with this assistant
    pub usage_count: i64,
}

/// Get the most recent chats for a user.
///
/// Returns a tuple of (chats, stats) where:
/// - chats: Vec<RecentChat> - The list of recent chats
/// - stats: ChatListStats - Statistics about the chat list
#[instrument(skip_all)]
pub async fn get_recent_chats(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    owner_user_id: &str,
    limit: u64,
    offset: u64,
    include_archived: bool,
) -> Result<(Vec<RecentChat>, ChatListStats), Report> {
    use crate::db::entity::assistants;
    use crate::db::entity::prelude::Assistants;
    use std::collections::HashMap;

    // Query the most recent chats for the user.
    // Query the chats belonging to a user, and join with the chats_latest_message view.
    let mut query = Chats::find()
        .filter(chats::Column::OwnerUserId.eq(owner_user_id))
        .find_also_related(chats_latest_message::Entity)
        .filter(chats_latest_message::Column::LatestMessageId.is_not_null());

    // Filter out archived chats if include_archived is false
    if !include_archived {
        query = query.filter(chats::Column::ArchivedAt.is_null());
    }

    let chats: Vec<(chats::Model, Option<chats_latest_message::Model>)> = query
        .order_by_desc(chats_latest_message::Column::LatestMessageAt)
        .limit(limit)
        .offset(offset)
        .all(conn)
        .await?;

    // Use our pagination utility to efficiently calculate the total count
    let (total_count, has_more) =
        pagination::calculate_total_count(offset, limit, chats.len(), || async {
            let mut count_query = Chats::find()
                .filter(chats::Column::OwnerUserId.eq(owner_user_id))
                .find_also_related(chats_latest_message::Entity)
                .filter(chats_latest_message::Column::LatestMessageId.is_not_null());

            // Apply same archived filter to count query
            if !include_archived {
                count_query = count_query.filter(chats::Column::ArchivedAt.is_null());
            }

            count_query.count(conn).await
        })
        .await?;

    // Should already be filtered to the correct user, but make sure to authorize.
    let mut authorized_chats = Vec::new();
    for (chat, latest_message) in chats.iter() {
        if authorize!(
            policy,
            subject,
            &Resource::Chat(chat.id.to_string()),
            Action::Read
        )
        .is_ok()
        {
            authorized_chats.push((chat, latest_message));
        }
    }

    // Collect all chat IDs for batch queries
    let chat_ids: Vec<Uuid> = authorized_chats.iter().map(|(chat, _)| chat.id).collect();

    // Collect all assistant IDs that need to be fetched
    let assistant_ids: Vec<Uuid> = authorized_chats
        .iter()
        .filter_map(|(chat, _)| chat.assistant_id)
        .collect();

    // Batch query: Get all assistants in a single query
    let assistants_map: HashMap<Uuid, String> = if !assistant_ids.is_empty() {
        Assistants::find()
            .filter(assistants::Column::Id.is_in(assistant_ids))
            .all(conn)
            .await?
            .into_iter()
            .map(|a| (a.id, a.name))
            .collect()
    } else {
        HashMap::new()
    };

    // Batch query: Get the most recent message with generation_parameters for each chat
    // We query all messages that could be the "last" one, then pick the latest per chat in memory
    let last_provider_ids_map: HashMap<Uuid, Option<String>> = if !chat_ids.is_empty() {
        let messages_with_params: Vec<messages::Model> = Messages::find()
            .filter(messages::Column::ChatId.is_in(chat_ids.clone()))
            .filter(messages::Column::IsMessageInActiveThread.eq(true))
            .filter(messages::Column::GenerationParameters.is_not_null())
            .order_by_desc(messages::Column::CreatedAt)
            .all(conn)
            .await?;

        // Group by chat_id and take the first (most recent) for each
        let mut map: HashMap<Uuid, Option<String>> = HashMap::new();
        for msg in messages_with_params {
            // Only insert if we haven't seen this chat_id yet (first = most recent due to ORDER BY)
            if let std::collections::hash_map::Entry::Vacant(e) = map.entry(msg.chat_id) {
                let provider_id = msg.generation_parameters.and_then(|params| {
                    serde_json::from_value::<GenerationParameters>(params)
                        .ok()
                        .and_then(|gp| gp.generation_chat_provider_id)
                });
                e.insert(provider_id);
            }
        }
        map
    } else {
        HashMap::new()
    };

    // Assemble the final results using the pre-fetched data
    let recent_chats: Vec<RecentChat> = authorized_chats
        .iter()
        .map(|(chat, latest_message)| {
            let latest_message = latest_message
                .as_ref()
                .expect("Latest message should never be None");

            let last_chat_provider_id = last_provider_ids_map.get(&chat.id).cloned().flatten();

            let assistant_name = chat
                .assistant_id
                .and_then(|aid| assistants_map.get(&aid).cloned());

            RecentChat {
                id: chat.id.to_string(),
                title_by_summary: chat
                    .title_by_summary
                    .clone()
                    .unwrap_or_else(|| "Untitled Chat".to_string()),
                last_message_at: latest_message.latest_message_at,
                archived_at: chat.archived_at,
                owner_user_id: chat.owner_user_id.clone(),
                last_chat_provider_id,
                assistant_id: chat.assistant_id,
                assistant_name,
            }
        })
        .collect();

    // Create the statistics object
    let stats = ChatListStats {
        total_count: pagination::u64_to_i64_count(total_count),
        current_offset: offset,
        returned_count: recent_chats.len(),
        has_more,
    };

    Ok((recent_chats, stats))
}

/// Get the most frequently used assistants for a user over a specified time period.
///
/// Returns a list of assistants ordered by how many times they were used to create chats,
/// filtered to chats created within the last `days` days.
///
/// # Arguments
/// * `conn` - Database connection
/// * `policy` - Policy engine for authorization
/// * `subject` - Subject performing the query
/// * `owner_user_id` - The user ID to query for
/// * `limit` - Maximum number of assistants to return
/// * `days` - Number of days to look back (e.g., 30 for last 30 days)
pub async fn get_frequent_assistants(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    owner_user_id: &str,
    limit: u64,
    days: u32,
) -> Result<Vec<FrequentAssistant>, Report> {
    // Use raw SQL to efficiently query and group by assistant_id
    // This query:
    // 1. Filters chats by owner and date range
    // 2. Extracts assistant_id from the JSONB assistant_configuration column
    // 3. Groups by assistant_id and counts occurrences
    // 4. Orders by count descending
    // 5. Limits to the requested number
    #[derive(Debug, FromQueryResult)]
    struct AssistantUsageCount {
        assistant_id: Uuid,
        usage_count: i64,
    }

    let cutoff_date = Utc::now() - chrono::Duration::days(days as i64);

    let usage_counts: Vec<AssistantUsageCount> =
        AssistantUsageCount::find_by_statement(sea_orm::Statement::from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            r#"
                SELECT 
                    (assistant_configuration->>'assistant_id')::uuid as assistant_id,
                    COUNT(*) as usage_count
                FROM chats
                WHERE owner_user_id = $1
                    AND assistant_configuration IS NOT NULL
                    AND assistant_configuration->>'assistant_id' IS NOT NULL
                    AND created_at >= $2
                GROUP BY assistant_configuration->>'assistant_id'
                ORDER BY usage_count DESC
                LIMIT $3
            "#,
            vec![
                owner_user_id.into(),
                cutoff_date.into(),
                sea_orm::Value::BigInt(Some(limit as i64)),
            ],
        ))
        .all(conn)
        .await?;

    // For each assistant_id, fetch the full assistant details
    let mut frequent_assistants = Vec::new();
    for usage in usage_counts {
        // Get the full assistant details with files
        // Pass allow_archived=false to exclude archived assistants from the list
        match crate::models::assistant::get_assistant_with_files(
            conn,
            policy,
            subject,
            usage.assistant_id,
            false, // Don't include archived assistants in frequent list
        )
        .await
        {
            Ok(assistant) => {
                frequent_assistants.push(FrequentAssistant {
                    assistant,
                    usage_count: usage.usage_count,
                });
            }
            Err(e) => {
                // Log the error but continue - the assistant might be archived, deleted, or user lost access
                tracing::debug!(
                    "Skipping assistant {} from frequent assistants (likely archived or inaccessible): {}",
                    usage.assistant_id,
                    e
                );
            }
        }
    }

    Ok(frequent_assistants)
}

pub async fn get_chat_by_message_id(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    message_id: &Uuid,
) -> Result<chats::Model, Report> {
    // Find the message to get its chat_id
    let message = Messages::find_by_id(*message_id)
        .one(conn)
        .await?
        .ok_or_else(|| eyre!("Message with ID {} not found", message_id))?;

    // Find the chat
    let chat = Chats::find_by_id(message.chat_id)
        .one(conn)
        .await?
        .ok_or_else(|| eyre!("Chat with ID {} not found", message.chat_id))?;

    // Authorize that the subject can read this chat
    authorize!(
        policy,
        subject,
        &Resource::Chat(chat.id.to_string()),
        Action::Read
    )?;

    Ok(chat)
}

/// Update the title_by_summary field of a chat
pub async fn update_chat_summary(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    chat_id: &Uuid,
    summary: String,
) -> Result<chats::Model, Report> {
    // Find the chat
    let chat = Chats::find_by_id(*chat_id)
        .one(conn)
        .await?
        .ok_or_else(|| eyre!("Chat with ID {} not found", chat_id))?;

    // Authorize the user to update the chat
    authorize!(
        policy,
        subject,
        &Resource::Chat(chat.id.to_string()),
        Action::Update
    )?;

    // Update the chat
    let mut chat_active: chats::ActiveModel = chat.clone().into();
    chat_active.title_by_summary = ActiveValue::Set(Some(summary));

    let updated_chat = chat_active.update(conn).await?;

    Ok(updated_chat)
}

/// Archive a chat by setting its archived_at timestamp
pub async fn archive_chat(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    chat_id: &Uuid,
) -> Result<chats::Model, Report> {
    // Find the chat
    let chat = Chats::find_by_id(*chat_id)
        .one(conn)
        .await?
        .ok_or_else(|| eyre!("Chat with ID {} not found", chat_id))?;

    // Authorize the user to update the chat
    authorize!(
        policy,
        subject,
        &Resource::Chat(chat.id.to_string()),
        Action::Update
    )?;

    // Update the chat
    let mut chat_active: chats::ActiveModel = chat.clone().into();
    chat_active.archived_at = ActiveValue::Set(Some(Utc::now().into()));

    let updated_chat = chat_active.update(conn).await?;

    Ok(updated_chat)
}

/// Get the chat provider ID from the most recent active message in a chat.
/// Returns None if no active messages found or if the message doesn't have generation parameters.
pub async fn get_last_chat_provider_id(
    conn: &DatabaseConnection,
    chat_id: &Uuid,
) -> Result<Option<String>, Report> {
    // Find the most recent active message in the chat that has generation_parameters
    let message = Messages::find()
        .filter(messages::Column::ChatId.eq(*chat_id))
        .filter(messages::Column::IsMessageInActiveThread.eq(true))
        .filter(messages::Column::GenerationParameters.is_not_null())
        .order_by_desc(messages::Column::CreatedAt)
        .one(conn)
        .await?;

    if let Some(message) = message
        && let Some(generation_params_json) = message.generation_parameters
    {
        // Parse the generation_parameters JSON
        let generation_params: GenerationParameters =
            serde_json::from_value(generation_params_json).map_err(|e| {
                eyre!(
                    "Failed to parse generation parameters for message {}: {}",
                    message.id,
                    e
                )
            })?;

        return Ok(generation_params.generation_chat_provider_id);
    }

    Ok(None)
}

/// Parse the assistant configuration from a chat model
///
/// Returns the parsed AssistantConfiguration if one is set, or None if not.
pub fn parse_assistant_configuration(
    chat: &chats::Model,
) -> Result<Option<AssistantConfiguration>, Report> {
    if let Some(ref config_json) = chat.assistant_configuration {
        Ok(Some(AssistantConfiguration::from_json(config_json)?))
    } else {
        Ok(None)
    }
}

/// Get the assistant configuration for a chat if one is associated
///
/// Returns the full assistant details with files if an assistant is configured for the chat.
/// Returns None if no assistant is configured.
pub async fn get_chat_assistant_configuration(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    chat: &chats::Model,
) -> Result<Option<crate::models::assistant::AssistantWithFiles>, Report> {
    // Parse assistant configuration from chat
    if let Some(config) = parse_assistant_configuration(chat)? {
        // Get the full assistant details including files
        // Pass allow_archived=true because we need to support existing chats
        // that were created with an assistant that's now archived
        let assistant_with_files = crate::models::assistant::get_assistant_with_files(
            conn,
            policy,
            subject,
            config.assistant_id,
            true, // Allow archived for existing chats
        )
        .await?;

        return Ok(Some(assistant_with_files));
    }

    Ok(None)
}
