use crate::db::entity::messages;
use crate::db::entity_ext::chats;
use crate::db::entity_ext::prelude::*;
use crate::metrics_constants::{
    POSTGRES_QUERY_ARCHIVE_DELEGATED_DESCENDANTS, POSTGRES_QUERY_ARCHIVE_STALE_DELEGATED_RUNS,
    POSTGRES_QUERY_CHAT_GENERATION_IS_RUNNING, POSTGRES_QUERY_COUNT_RECENT_CHATS,
    POSTGRES_QUERY_FREQUENT_ASSISTANTS, POSTGRES_QUERY_LIST_GENERATING_CHATS,
    POSTGRES_QUERY_LIST_RECENT_CHATS,
};
use crate::models::message::GenerationParameters;
use crate::models::pagination;
use crate::policy::prelude::*;
use crate::query_metrics::named_statement_from_sql_and_values;
use eyre::{Report, eyre};
use sea_orm::prelude::*;
use sea_orm::{
    ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, FromQueryResult, QueryFilter,
    QueryOrder,
};
use serde::{Deserialize, Serialize};
use sqlx::types::chrono::Utc;
use tracing::instrument;
use utoipa::ToSchema;

/// Configuration for a chat that is based on an assistant
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AssistantConfiguration {
    /// The ID of the assistant this chat is based on
    pub assistant_id: Uuid,
    /// How this chat came to exist relative to another chat, when it was
    /// spawned from one (delegation, handoff). Absent for chats the user
    /// started directly.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provenance: Option<ChatProvenance>,
}

/// The relationship kind between a spawned chat and its origin chat.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatProvenanceKind {
    HandoffBranch,
    HandoffMove,
    Delegation,
}

/// Provenance envelope stored inside `assistant_configuration` for chats
/// spawned from another chat. One envelope serves every kind; the ids are
/// plain values, never foreign keys — the origin chat may be deleted
/// independently and dangling ids are tolerated.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChatProvenance {
    pub kind: ChatProvenanceKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin_chat_id: Option<Uuid>,
    /// The message in the origin chat this chat was spawned from (for
    /// delegation: the turn's user message the tool call belongs to).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin_message_id: Option<Uuid>,
    /// The assistant bound to the origin chat at spawn time, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin_assistant_id: Option<Uuid>,
    /// History before this instant belongs to a different assistant context:
    /// when the replay anchor predates it, prompt composition re-injects the
    /// current assistant's head and strips the replayed system plane.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rebase_cutoff: Option<DateTimeWithTimeZone>,
    /// Spawn depth relative to a user-started chat (which has depth 0).
    #[serde(default)]
    pub depth: u32,
    /// When the owner first wrote into the chat themselves. A run they took
    /// over is more than the artifact of the dispatch that created it, so the
    /// automatic retention pass leaves it alone from then on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adopted_at: Option<DateTimeWithTimeZone>,
}

impl AssistantConfiguration {
    /// Create a new assistant configuration
    pub fn new(assistant_id: Uuid) -> Self {
        Self {
            assistant_id,
            provenance: None,
        }
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
    title_by_user_provided: Option<String>,
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
            title_by_user_provided: ActiveValue::Set(title_by_user_provided),
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
    title_by_user_provided: Option<String>,
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
            None, // title_by_user_provided is ignored when existing_chat_id is provided
        )
        .await
    } else {
        // No previous message ID, so create a new chat using get_or_create_chat
        // Pass assistant_id here so it gets stored in the new chat's assistant_configuration
        get_or_create_chat(
            conn,
            policy,
            subject,
            None,
            owner_user_id,
            assistant_id,
            title_by_user_provided,
        )
        .await
    }
}

/// True when the chat is a delegated run (provenance kind `delegation`).
/// Unparseable configurations count as not delegated; they fail loudly on the
/// paths that need the assistant itself.
pub fn chat_is_delegated_run(chat: &chats::Model) -> bool {
    parse_assistant_configuration(chat)
        .ok()
        .flatten()
        .and_then(|configuration| configuration.provenance)
        .is_some_and(|provenance| provenance.kind == ChatProvenanceKind::Delegation)
}

/// Create a chat owned by `owner_user_id`, bound to `assistant_id`, carrying a
/// provenance envelope. The caller must have access-checked the assistant (the
/// `POST /me/chats` pattern) — this function only authorizes chat creation.
pub async fn create_delegated_chat(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    owner_user_id: &str,
    assistant_id: Uuid,
    provenance: ChatProvenance,
    title: String,
) -> Result<chats::Model, Report> {
    authorize!(policy, subject, &Resource::ChatSingleton, Action::Create)?;

    let configuration = AssistantConfiguration {
        assistant_id,
        provenance: Some(provenance),
    };
    let new_chat = chats::ActiveModel {
        owner_user_id: ActiveValue::Set(owner_user_id.to_owned()),
        assistant_configuration: ActiveValue::Set(Some(configuration.to_json()?)),
        title_by_user_provided: ActiveValue::Set(Some(title)),
        ..Default::default()
    };
    Ok(chats::Entity::insert(new_chat)
        .exec_with_returning(conn)
        .await?)
}

/// What [`seed_chat_lineage`] wrote.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SeedStats {
    pub messages_copied: usize,
    pub files_linked: usize,
    /// Last copy written, i.e. the head the target chat's own turns continue
    /// from. `None` when the lineage was empty.
    pub lineage_tip_id: Option<Uuid>,
}

/// Copies the message lineage from `source_message_id` back to its root into
/// an existing chat, as that chat's linear history.
///
/// The copies get fresh ids, are rewired to each other via
/// `previous_message_id`, form no sibling groups, and are all part of the
/// active thread. Payload columns (`raw_message`, snapshots, parameters,
/// metadata, file-upload ids) are copied verbatim and timestamps are
/// preserved, so the copied history reads identically to the original. Each
/// distinct file id referenced by the copied messages gets a
/// `chat_file_uploads` row on the target chat so file resolution works there.
///
/// Deliberately narrow: does not create the target chat, does not check
/// authorization, and does not write provenance — those are the caller's
/// responsibilities.
pub async fn seed_chat_lineage(
    conn: &impl sea_orm::ConnectionTrait,
    target_chat_id: &Uuid,
    source_message_id: &Uuid,
) -> Result<SeedStats, Report> {
    // Walk source -> root, guarding against cycles.
    let mut lineage: Vec<messages::Model> = Vec::new();
    let mut visited: std::collections::HashSet<Uuid> = std::collections::HashSet::new();
    let mut current_id = Some(*source_message_id);
    while let Some(message_id) = current_id {
        if !visited.insert(message_id) {
            break;
        }
        let message = Messages::find_by_id(message_id)
            .one(conn)
            .await?
            .ok_or_else(|| eyre!("Message with ID {} not found", message_id))?;
        current_id = message.previous_message_id;
        lineage.push(message);
    }
    lineage.reverse();

    let mut file_ids: std::collections::BTreeSet<Uuid> = std::collections::BTreeSet::new();
    let mut previous_new_id: Option<Uuid> = None;
    for message in &lineage {
        let copy = messages::ActiveModel {
            chat_id: ActiveValue::Set(*target_chat_id),
            raw_message: ActiveValue::Set(message.raw_message.clone()),
            created_at: ActiveValue::Set(message.created_at),
            updated_at: ActiveValue::Set(message.updated_at),
            previous_message_id: ActiveValue::Set(previous_new_id),
            sibling_message_id: ActiveValue::Set(None),
            is_message_in_active_thread: ActiveValue::Set(true),
            generation_input_messages: ActiveValue::Set(message.generation_input_messages.clone()),
            input_file_uploads: ActiveValue::Set(message.input_file_uploads.clone()),
            generation_parameters: ActiveValue::Set(message.generation_parameters.clone()),
            generation_metadata: ActiveValue::Set(message.generation_metadata.clone()),
            input_parameters: ActiveValue::Set(message.input_parameters.clone()),
            ..Default::default()
        };
        let inserted = messages::Entity::insert(copy)
            .exec_with_returning(conn)
            .await?;
        previous_new_id = Some(inserted.id);

        if let Some(ids) = &message.input_file_uploads {
            file_ids.extend(ids.iter().copied());
        }
    }

    let mut files_linked = 0;
    for file_id in &file_ids {
        let existing =
            crate::db::entity::chat_file_uploads::Entity::find_by_id((*target_chat_id, *file_id))
                .one(conn)
                .await?;
        if existing.is_some() {
            continue;
        }
        let join_row = crate::db::entity::chat_file_uploads::ActiveModel {
            chat_id: ActiveValue::Set(*target_chat_id),
            file_upload_id: ActiveValue::Set(*file_id),
            ..Default::default()
        };
        crate::db::entity::chat_file_uploads::Entity::insert(join_row)
            .exec(conn)
            .await?;
        files_linked += 1;
    }

    Ok(SeedStats {
        messages_copied: lineage.len(),
        files_linked,
        lineage_tip_id: previous_new_id,
    })
}

pub fn resolve_chat_display_name(
    title_by_user_provided: Option<&str>,
    title_by_summary: Option<&str>,
) -> String {
    title_by_user_provided
        .filter(|name| !name.trim().is_empty())
        .or(title_by_summary.filter(|name| !name.trim().is_empty()))
        .unwrap_or("Untitled Chat")
        .to_string()
}

#[derive(Debug, FromQueryResult)]
pub struct RecentChat {
    pub id: String,
    /// Title of the chat as generated by summary automation.
    pub title_by_summary: Option<String>,
    /// Title of the chat as explicitly provided by the user.
    pub title_by_user_provided: Option<String>,
    /// Resolved chat title where user-provided title takes precedence over summary title.
    pub title_resolved: String,
    /// Time of the last message in the chat.
    pub last_message_at: DateTimeWithTimeZone,
    pub archived_at: Option<DateTimeWithTimeZone>,
    /// Whether the chat is pinned by its owner.
    pub is_pinned: bool,
    /// Owner of the chat (for permission checks at the API boundary)
    pub owner_user_id: String,
    /// The chat provider ID used for the most recent message
    pub last_chat_provider_id: Option<String>,
    /// The facets selected for the most recent message
    pub last_selected_facets: Option<Vec<String>>,
    /// The assistant ID if this chat is based on an assistant
    pub assistant_id: Option<Uuid>,
    /// The name of the assistant if this chat is based on an assistant
    pub assistant_name: Option<String>,
    /// Start time of the chat's generation, present only while it is running
    /// with a fresh heartbeat.
    pub active_generation_started_at: Option<DateTimeWithTimeZone>,
    /// Present while the chat's generation is stopped on an MCP tool approval
    /// awaiting the user's decision.
    pub pending_tool_approval_at: Option<DateTimeWithTimeZone>,
    /// Provenance kind when the chat was spawned from another chat
    /// (`delegation`, handoff kinds).
    pub provenance_kind: Option<String>,
    /// The origin chat this chat was spawned from, if any. Dangling after the
    /// origin is deleted.
    pub origin_chat_id: Option<Uuid>,
    /// Resolved display title of the origin chat; None when the origin no
    /// longer exists.
    pub origin_chat_title: Option<String>,
    /// The assistant bound to the origin chat at spawn time, if any.
    pub origin_assistant_id: Option<Uuid>,
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

/// Helper struct for the LATERAL join query result
#[derive(Debug, FromQueryResult)]
struct ChatWithLatestMessage {
    // Chat fields
    id: Uuid,
    owner_user_id: String,
    title_by_summary: Option<String>,
    title_by_user_provided: Option<String>,
    archived_at: Option<DateTimeWithTimeZone>,
    is_pinned: bool,
    assistant_id: Option<Uuid>,
    active_generation_started_at: Option<DateTimeWithTimeZone>,
    pending_tool_approval_at: Option<DateTimeWithTimeZone>,
    provenance_kind: Option<String>,
    origin_chat_id: Option<Uuid>,
    origin_assistant_id: Option<Uuid>,
    // Latest message fields
    latest_message_at: DateTimeWithTimeZone,
}

/// Kind of chat to restrict a recent chat listing to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum RecentChatTypeFilter {
    /// Chats that are not based on an assistant.
    Chat,
    /// Chats that are based on an assistant.
    Assistant,
}

/// Filtering and pagination options for recent chat listing.
#[derive(Debug, Clone, Copy)]
pub struct RecentChatsFilter<'a> {
    /// Maximum number of chats to return.
    pub limit: u64,
    /// Number of matching chats to skip.
    pub offset: u64,
    /// Whether archived chats should be included.
    pub include_archived: bool,
    /// If set, only chats with the matching pinned state are returned.
    pub pinned: Option<bool>,
    /// If set, only chats of the matching kind are returned.
    pub chat_type: Option<RecentChatTypeFilter>,
    /// Optional full-text search query for chat titles.
    pub search_query: Option<&'a str>,
    /// Whether delegated runs (provenance kind `delegation`) are included.
    /// They are hidden from listings by default.
    pub include_delegated: bool,
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
    filter: RecentChatsFilter<'_>,
    generation_stale_after_secs: u64,
) -> Result<(Vec<RecentChat>, ChatListStats), Report> {
    use crate::db::entity::assistants;
    use crate::db::entity::prelude::Assistants;
    use std::collections::HashMap;

    // Build the WHERE clause conditions
    let archived_condition = if !filter.include_archived {
        "AND \"chats\".\"archived_at\" IS NULL"
    } else {
        ""
    };
    let pinned_condition = match filter.pinned {
        Some(true) => "AND \"chats\".\"is_pinned\" = TRUE",
        Some(false) => "AND \"chats\".\"is_pinned\" = FALSE",
        None => "",
    };
    let chat_type_condition = match filter.chat_type {
        Some(RecentChatTypeFilter::Chat) => "AND \"chats\".\"assistant_id\" IS NULL",
        Some(RecentChatTypeFilter::Assistant) => "AND \"chats\".\"assistant_id\" IS NOT NULL",
        None => "",
    };
    let delegated_condition = if !filter.include_delegated {
        "AND (\"chats\".\"assistant_configuration\" #>> '{provenance,kind}') IS DISTINCT FROM 'delegation'"
    } else {
        ""
    };
    let resolved_title_search_vector = r#"to_tsvector(
                'simple'::regconfig,
                COALESCE(
                    NULLIF(BTRIM("chats"."title_by_user_provided"), ''),
                    NULLIF(BTRIM("chats"."title_by_summary"), ''),
                    'Untitled Chat'
                )
            )"#;
    let search_query = filter
        .search_query
        .map(str::trim)
        .filter(|query| !query.is_empty());
    let search_condition = |param_index: u8| {
        if search_query.is_some() {
            format!(
                "AND {resolved_title_search_vector} @@ websearch_to_tsquery('simple'::regconfig, ${param_index})"
            )
        } else {
            String::new()
        }
    };

    // Query using INNER JOIN LATERAL for better performance
    // This ensures the database does all filtering, sorting, and pagination
    let sql = format!(
        r#"
        SELECT
            "chats"."id",
            "chats"."owner_user_id",
            "chats"."title_by_summary",
            "chats"."title_by_user_provided",
            "chats"."archived_at",
            "chats"."is_pinned",
            "chats"."assistant_id",
            CASE
                WHEN "chats"."generation_state" = 'running'
                    AND "chats"."generation_heartbeat_at" > now() - make_interval(secs => {generation_stale_after_secs})
                THEN "chats"."generation_started_at"
            END AS "active_generation_started_at",
            CASE
                WHEN "chats"."generation_state" = 'awaiting_approval'
                THEN "chats"."generation_ended_at"
            END AS "pending_tool_approval_at",
            ("chats"."assistant_configuration" #>> '{{provenance,kind}}') AS "provenance_kind",
            "chats"."origin_chat_id",
            (("chats"."assistant_configuration" #>> '{{provenance,origin_assistant_id}}'))::uuid AS "origin_assistant_id",
            "latest_msg"."created_at" AS "latest_message_at"
        FROM "chats"
        INNER JOIN LATERAL (
            SELECT m.chat_id, m.id, m.created_at
            FROM messages m
            WHERE m.chat_id = chats.id
            ORDER BY m.created_at DESC
            LIMIT 1
        ) latest_msg ON true
        WHERE "chats"."owner_user_id" = $1
            {}
            {}
            {}
            {}
            {}
        ORDER BY latest_msg.created_at DESC
        LIMIT $2
        OFFSET $3
        "#,
        archived_condition,
        search_condition(4),
        pinned_condition,
        chat_type_condition,
        delegated_condition
    );

    let mut query_values = vec![
        owner_user_id.into(),
        sea_orm::Value::BigInt(Some(filter.limit as i64)),
        sea_orm::Value::BigInt(Some(filter.offset as i64)),
    ];
    if let Some(search_query) = search_query {
        query_values.push(search_query.into());
    }

    let chats_with_messages: Vec<ChatWithLatestMessage> =
        ChatWithLatestMessage::find_by_statement(named_statement_from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            POSTGRES_QUERY_LIST_RECENT_CHATS,
            sql,
            query_values,
        ))
        .all(conn)
        .await?;

    // Use our pagination utility to efficiently calculate the total count
    let (total_count, has_more) = pagination::calculate_total_count(
        filter.offset,
        filter.limit,
        chats_with_messages.len(),
        || async {
            let count_sql = format!(
                r#"
                SELECT COUNT(*) AS num_items
                FROM (
                    SELECT "chats"."id"
                    FROM "chats"
                    INNER JOIN LATERAL (
                        SELECT m.chat_id, m.id, m.created_at
                        FROM messages m
                        WHERE m.chat_id = chats.id
                        ORDER BY m.created_at DESC
                        LIMIT 1
                    ) latest_msg ON true
                    WHERE "chats"."owner_user_id" = $1
                        {}
                        {}
                        {}
                        {}
                        {}
                ) AS sub_query
                "#,
                archived_condition,
                search_condition(2),
                pinned_condition,
                chat_type_condition,
                delegated_condition
            );

            #[derive(Debug, FromQueryResult)]
            struct CountResult {
                num_items: i64,
            }

            let mut count_values = vec![owner_user_id.into()];
            if let Some(search_query) = search_query {
                count_values.push(search_query.into());
            }

            let count_result: CountResult =
                CountResult::find_by_statement(named_statement_from_sql_and_values(
                    sea_orm::DatabaseBackend::Postgres,
                    POSTGRES_QUERY_COUNT_RECENT_CHATS,
                    count_sql,
                    count_values,
                ))
                .one(conn)
                .await
                .map_err(|e| eyre::eyre!("Failed to execute count query: {}", e))?
                .ok_or_else(|| eyre!("Count query returned no results"))?;

            Ok::<u64, Report>(count_result.num_items as u64)
        },
    )
    .await?;

    // Should already be filtered to the correct user, but make sure to authorize.
    let mut authorized_chats = Vec::new();
    for chat_with_msg in chats_with_messages.iter() {
        if authorize!(
            policy,
            subject,
            &Resource::Chat(chat_with_msg.id.to_string()),
            Action::Read
        )
        .is_ok()
        {
            authorized_chats.push(chat_with_msg);
        }
    }

    // Collect all chat IDs for batch queries
    let authorized_chat_ids: Vec<Uuid> = authorized_chats.iter().map(|c| c.id).collect();

    // Collect all assistant IDs that need to be fetched
    let assistant_ids: Vec<Uuid> = authorized_chats
        .iter()
        .filter_map(|c| c.assistant_id)
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

    // Batch query: resolved display titles of origin chats. Provenance ids are
    // not foreign keys, so a deleted origin simply yields no title. The owner
    // filter is a guard for future provenance kinds: delegation guarantees
    // child owner == origin owner, but a cross-user handoff must not turn
    // this lookup into a title leak.
    let origin_chat_ids: Vec<Uuid> = authorized_chats
        .iter()
        .filter_map(|c| c.origin_chat_id)
        .collect();
    let origin_titles_map: HashMap<Uuid, String> = if !origin_chat_ids.is_empty() {
        Chats::find()
            .filter(chats::Column::Id.is_in(origin_chat_ids))
            .filter(chats::Column::OwnerUserId.eq(owner_user_id))
            .all(conn)
            .await?
            .into_iter()
            .map(|origin| {
                let title = resolve_chat_display_name(
                    origin.title_by_user_provided.as_deref(),
                    origin.title_by_summary.as_deref(),
                );
                (origin.id, title)
            })
            .collect()
    } else {
        HashMap::new()
    };

    #[derive(Debug, Clone)]
    struct LastGenerationInfo {
        provider_id: Option<String>,
        selected_facets: Option<Vec<String>>,
    }

    // Batch query: Get the most recent message with generation_parameters for each chat
    // We query all messages that could be the "last" one, then pick the latest per chat in memory
    let last_generation_info_map: HashMap<Uuid, LastGenerationInfo> = if !authorized_chat_ids
        .is_empty()
    {
        let messages_with_params: Vec<messages::Model> = Messages::find()
            .filter(messages::Column::ChatId.is_in(authorized_chat_ids.clone()))
            .filter(messages::Column::IsMessageInActiveThread.eq(true))
            .filter(messages::Column::GenerationParameters.is_not_null())
            .order_by_desc(messages::Column::CreatedAt)
            .all(conn)
            .await?;

        // Group by chat_id and take the first (most recent) for each
        let mut map: HashMap<Uuid, LastGenerationInfo> = HashMap::new();
        for msg in messages_with_params {
            // Only insert if we haven't seen this chat_id yet (first = most recent due to ORDER BY)
            if let std::collections::hash_map::Entry::Vacant(e) = map.entry(msg.chat_id) {
                let generation_info = msg
                    .generation_parameters
                    .and_then(|params| serde_json::from_value::<GenerationParameters>(params).ok())
                    .map(|gp| {
                        let selected_facets: Vec<String> = gp
                            .selected_facets
                            .into_iter()
                            .filter_map(|(id, enabled)| enabled.then_some(id))
                            .collect();
                        LastGenerationInfo {
                            provider_id: gp.generation_chat_provider_id,
                            selected_facets: Some(selected_facets),
                        }
                    })
                    .unwrap_or(LastGenerationInfo {
                        provider_id: None,
                        selected_facets: None,
                    });
                e.insert(generation_info);
            }
        }
        map
    } else {
        HashMap::new()
    };

    // Assemble the final results using the pre-fetched data
    let recent_chats: Vec<RecentChat> = authorized_chats
        .iter()
        .map(|chat_with_msg| {
            let last_generation_info = last_generation_info_map.get(&chat_with_msg.id);
            let last_chat_provider_id =
                last_generation_info.and_then(|info| info.provider_id.clone());
            let last_selected_facets =
                last_generation_info.and_then(|info| info.selected_facets.clone());

            let assistant_name = chat_with_msg
                .assistant_id
                .and_then(|aid| assistants_map.get(&aid).cloned());

            RecentChat {
                id: chat_with_msg.id.to_string(),
                title_by_summary: chat_with_msg.title_by_summary.clone(),
                title_by_user_provided: chat_with_msg.title_by_user_provided.clone(),
                title_resolved: resolve_chat_display_name(
                    chat_with_msg.title_by_user_provided.as_deref(),
                    chat_with_msg.title_by_summary.as_deref(),
                ),
                last_message_at: chat_with_msg.latest_message_at,
                archived_at: chat_with_msg.archived_at,
                is_pinned: chat_with_msg.is_pinned,
                owner_user_id: chat_with_msg.owner_user_id.clone(),
                last_chat_provider_id,
                last_selected_facets,
                assistant_id: chat_with_msg.assistant_id,
                assistant_name,
                active_generation_started_at: chat_with_msg.active_generation_started_at,
                pending_tool_approval_at: chat_with_msg.pending_tool_approval_at,
                provenance_kind: chat_with_msg.provenance_kind.clone(),
                origin_chat_id: chat_with_msg.origin_chat_id,
                origin_chat_title: chat_with_msg
                    .origin_chat_id
                    .and_then(|origin_id| origin_titles_map.get(&origin_id).cloned()),
                origin_assistant_id: chat_with_msg.origin_assistant_id,
            }
        })
        .collect();

    // Create the statistics object
    let stats = ChatListStats {
        total_count: pagination::u64_to_i64_count(total_count),
        current_offset: filter.offset,
        returned_count: recent_chats.len(),
        has_more,
    };

    Ok((recent_chats, stats))
}

/// A chat with a running or recently ended generation, or one stopped on a
/// pending tool approval.
///
/// Deliberately does NOT filter delegated runs: listings hide them by
/// default, but a delegated chat that is running or parked awaiting approval
/// must stay reachable through `/me/generating` — a stranded child would
/// otherwise be invisible everywhere.
#[derive(Debug, FromQueryResult)]
pub struct GeneratingChatRow {
    pub id: Uuid,
    pub generation_state: String,
    pub generation_started_at: DateTimeWithTimeZone,
    pub generation_ended_at: Option<DateTimeWithTimeZone>,
    pub title_by_user_provided: Option<String>,
    pub title_by_summary: Option<String>,
}

/// Get the chats of a user whose generation is currently running (with a
/// fresh heartbeat), reached a terminal state within the retention window, or
/// is stopped awaiting a tool approval (no heartbeat and no retention — the
/// stop is durable until a later generation takes over the state).
#[instrument(skip_all)]
pub async fn get_generating_chats(
    conn: &DatabaseConnection,
    owner_user_id: &str,
    stale_after_secs: u64,
    terminal_retention_secs: u64,
) -> Result<Vec<GeneratingChatRow>, Report> {
    let sql = r#"
        SELECT
            "chats"."id",
            "chats"."generation_state",
            "chats"."generation_started_at",
            "chats"."generation_ended_at",
            "chats"."title_by_user_provided",
            "chats"."title_by_summary"
        FROM "chats"
        WHERE "chats"."owner_user_id" = $1
            AND "chats"."archived_at" IS NULL
            AND "chats"."generation_started_at" IS NOT NULL
            AND (
                "chats"."generation_state" = 'awaiting_approval'
                OR (
                    "chats"."generation_state" = 'running'
                    AND "chats"."generation_heartbeat_at" > now() - make_interval(secs => $2::double precision)
                )
                OR (
                    "chats"."generation_state" IN ('completed', 'errored')
                    AND "chats"."generation_ended_at" > now() - make_interval(secs => $3::double precision)
                )
            )
        "#;

    let rows = GeneratingChatRow::find_by_statement(named_statement_from_sql_and_values(
        sea_orm::DatabaseBackend::Postgres,
        POSTGRES_QUERY_LIST_GENERATING_CHATS,
        sql,
        [
            owner_user_id.into(),
            (stale_after_secs as f64).into(),
            (terminal_retention_secs as f64).into(),
        ],
    ))
    .all(conn)
    .await?;

    Ok(rows)
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
        AssistantUsageCount::find_by_statement(named_statement_from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            POSTGRES_QUERY_FREQUENT_ASSISTANTS,
            r#"
                SELECT 
                    (assistant_configuration->>'assistant_id')::uuid as assistant_id,
                    COUNT(*) as usage_count
                FROM chats
                WHERE owner_user_id = $1
                    AND assistant_configuration IS NOT NULL
                    AND assistant_configuration->>'assistant_id' IS NOT NULL
                    AND (assistant_configuration #>> '{provenance,kind}') IS DISTINCT FROM 'delegation'
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

/// Update the title_by_user_provided field of a chat.
///
/// If `title_by_user_provided` is `None`, no field changes are applied and
/// the current chat is returned after authorization.
/// If it is `Some(value)`, the field is updated. `Some(None)` clears the title.
pub async fn update_chat_title_by_user_provided(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    chat_id: &Uuid,
    title_by_user_provided: Option<String>,
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
    let mut chat_active: chats::ActiveModel = chat.into();
    chat_active.title_by_user_provided = ActiveValue::Set(title_by_user_provided);

    let updated_chat = chat_active.update(conn).await?;
    Ok(updated_chat)
}

/// Update whether a chat is pinned by its owner.
pub async fn update_chat_is_pinned(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    chat_id: &Uuid,
    is_pinned: bool,
) -> Result<chats::Model, Report> {
    let chat = Chats::find_by_id(*chat_id)
        .one(conn)
        .await?
        .ok_or_else(|| eyre!("Chat with ID {} not found", chat_id))?;

    authorize!(
        policy,
        subject,
        &Resource::Chat(chat.id.to_string()),
        Action::Update
    )?;

    let mut chat_active: chats::ActiveModel = chat.into();
    chat_active.is_pinned = ActiveValue::Set(is_pinned);
    Ok(chat_active.update(conn).await?)
}

/// True while a generation is actively writing to the chat: state `running`
/// with a heartbeat inside the staleness window. A generation whose process
/// died leaves the state behind but stops heartbeating, so it does not count.
///
/// The window is evaluated in the database because the heartbeat is written
/// with the database clock: a pod clock running ahead of it by more than the
/// window would read every live generation as dead.
pub async fn chat_generation_is_running(
    conn: &DatabaseConnection,
    chat_id: &Uuid,
    stale_after_secs: u64,
) -> Result<bool, Report> {
    #[derive(Debug, FromQueryResult)]
    struct RunningRow {
        running: bool,
    }

    let row = RunningRow::find_by_statement(named_statement_from_sql_and_values(
        sea_orm::DatabaseBackend::Postgres,
        POSTGRES_QUERY_CHAT_GENERATION_IS_RUNNING,
        r#"
        SELECT COALESCE(
            "chats"."generation_state" = 'running'
                AND "chats"."generation_heartbeat_at" > now() - make_interval(secs => $2::double precision),
            FALSE
        ) AS "running"
        FROM "chats"
        WHERE "chats"."id" = $1
        "#,
        [(*chat_id).into(), (stale_after_secs as f64).into()],
    ))
    .one(conn)
    .await?;

    Ok(row.is_some_and(|row| row.running))
}

/// SQL predicate for a chat whose generation has not finished: running with a
/// fresh heartbeat, or stopped on a tool approval the user can still answer.
/// `param_index` binds the staleness window in seconds.
fn generation_unfinished_condition(alias: &str, param_index: u8) -> String {
    format!(
        r#"COALESCE(
            {alias}."generation_state" = 'awaiting_approval'
            OR (
                {alias}."generation_state" = 'running'
                AND {alias}."generation_heartbeat_at" > now() - make_interval(secs => ${param_index}::double precision)
            ),
            FALSE
        )"#
    )
}

/// Archive the delegated runs spawned from `chat_id`, and their delegated
/// descendants in turn. A delegated run is an artifact of the conversation
/// that spawned it, so hiding the conversation hides its artifacts — and the
/// age-based deletion of archived chats then reaches them too.
///
/// A run whose generation has not finished is left alone: completing into an
/// archived chat is a worse state than a late archive, because every write
/// path into an archived chat — including the tool-approval continuation —
/// then rejects. So is a run created within the staleness window that has no
/// lease at all: dispatch creates the chat a moment before claiming the lease,
/// and a run archived in between would complete into an archived chat too.
/// Skipping a run also stops the walk there, keeping its own descendants
/// reachable. [`auto_archive_stale_delegated_runs`] picks such runs up once
/// they go quiet.
///
/// Scoped to `owner_user_id`: delegation guarantees child owner == origin
/// owner, and a future provenance kind that crosses users must not let one
/// user's archive reach another user's chats.
///
/// Returns the number of runs archived.
pub async fn archive_delegated_descendants(
    conn: &DatabaseConnection,
    chat_id: &Uuid,
    owner_user_id: &str,
    generation_stale_after_secs: u64,
) -> Result<u64, Report> {
    use sea_orm::ConnectionTrait;

    let sql = format!(
        r#"
        WITH RECURSIVE descendants AS (
            SELECT $1::uuid AS id
            UNION
            SELECT "child"."id"
            FROM "chats" AS "child"
            JOIN descendants ON "child"."origin_chat_id" = descendants.id
            WHERE "child"."owner_user_id" = $2
                AND ("child"."assistant_configuration" #>> '{{provenance,kind}}') = 'delegation'
                AND "child"."archived_at" IS NULL
                AND NOT {unfinished}
                AND NOT (
                    "child"."generation_state" IS NULL
                    AND "child"."created_at" > now() - make_interval(secs => $3::double precision)
                )
        )
        UPDATE "chats"
        SET "archived_at" = now()
        WHERE "chats"."id" IN (SELECT id FROM descendants WHERE id <> $1::uuid)
        "#,
        unfinished = generation_unfinished_condition("\"child\"", 3)
    );

    let result = conn
        .execute_raw(named_statement_from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            POSTGRES_QUERY_ARCHIVE_DELEGATED_DESCENDANTS,
            sql,
            [
                (*chat_id).into(),
                owner_user_id.into(),
                (generation_stale_after_secs as f64).into(),
            ],
        ))
        .await?;

    Ok(result.rows_affected())
}

/// Archive delegated runs that have gone quiet, independently of whether the
/// chat that spawned them was ever archived. Without this they accumulate
/// forever: listings hide them, so no user ever archives one, so the age-based
/// deletion of archived chats never reaches them.
///
/// Quiet means no unfinished generation, and neither a message nor the chat
/// itself younger than `max_age_days` — continuing a delegated run pushes its
/// retention out, while a run that never got a message ages from its creation,
/// so a child stranded by a crashed dispatch is reached too. The chat's own age
/// is a floor because seeded context keeps the timestamps of the conversation
/// it was copied from, which are older than the run.
///
/// This path ends in deletion, so anything the user said about the run keeps
/// it: a pin, an enabled share link, or a turn they wrote into it themselves.
/// Those are the only signals available for a chat the listings hide.
///
/// `max_age_days` of 0 turns the pass off.
///
/// Returns the number of runs archived.
pub async fn auto_archive_stale_delegated_runs(
    conn: &DatabaseConnection,
    max_age_days: u32,
    generation_stale_after_secs: u64,
) -> Result<u64, Report> {
    use sea_orm::ConnectionTrait;

    if max_age_days == 0 {
        return Ok(0);
    }

    let sql = format!(
        r#"
        UPDATE "chats"
        SET "archived_at" = now()
        WHERE "chats"."archived_at" IS NULL
            AND NOT "chats"."is_pinned"
            AND ("chats"."assistant_configuration" #>> '{{provenance,kind}}') = 'delegation'
            AND ("chats"."assistant_configuration" #>> '{{provenance,adopted_at}}') IS NULL
            AND NOT {unfinished}
            AND NOT EXISTS (
                SELECT 1
                FROM "share_links"
                WHERE "share_links"."resource_type" = 'chat'
                    AND "share_links"."resource_id" = "chats"."id"::text
                    AND "share_links"."enabled"
            )
            AND GREATEST(
                "chats"."created_at",
                (
                    SELECT MAX("m"."created_at")
                    FROM "messages" AS "m"
                    WHERE "m"."chat_id" = "chats"."id"
                )
            ) < now() - make_interval(secs => $2::double precision)
        "#,
        unfinished = generation_unfinished_condition("\"chats\"", 1)
    );

    let result = conn
        .execute_raw(named_statement_from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            POSTGRES_QUERY_ARCHIVE_STALE_DELEGATED_RUNS,
            sql,
            [
                (generation_stale_after_secs as f64).into(),
                (max_age_days as f64 * 86_400.0).into(),
            ],
        ))
        .await?;

    Ok(result.rows_affected())
}

/// Record that the owner wrote into a delegated run themselves, which takes it
/// out of [`auto_archive_stale_delegated_runs`] for good.
///
/// The run's own turns never come through here: they are driven by the
/// dispatcher rather than by a request from the user.
pub async fn mark_delegated_run_adopted(
    conn: &DatabaseConnection,
    chat: &chats::Model,
) -> Result<(), Report> {
    let Some(mut configuration) = parse_assistant_configuration(chat)? else {
        return Ok(());
    };
    let Some(provenance) = configuration.provenance.as_mut() else {
        return Ok(());
    };
    if provenance.kind != ChatProvenanceKind::Delegation || provenance.adopted_at.is_some() {
        return Ok(());
    }
    provenance.adopted_at = Some(Utc::now().into());

    let mut chat_active: chats::ActiveModel = chat.clone().into();
    chat_active.assistant_configuration = ActiveValue::Set(Some(configuration.to_json()?));
    chat_active.update(conn).await?;

    Ok(())
}

/// Delete a delegated chat that was created but never got a run, along with
/// whatever dispatch already wrote for it (seeded lineage, file join rows).
///
/// Only for the pre-run failure path, and refuses anything that is not a
/// delegated run: an empty child that never ran is noise the user can neither
/// see nor act on, but nothing else may be reached from here.
pub async fn delete_unstarted_delegated_chat(
    conn: &DatabaseConnection,
    chat_id: &Uuid,
) -> Result<(), Report> {
    use sea_orm::TransactionTrait;

    let chat = Chats::find_by_id(*chat_id)
        .one(conn)
        .await?
        .ok_or_else(|| eyre!("Chat with ID {} not found", chat_id))?;
    if !chat_is_delegated_run(&chat) {
        return Err(eyre!("Chat {chat_id} is not a delegated run"));
    }

    let txn = conn.begin().await?;
    crate::db::entity::chat_file_uploads::Entity::delete_many()
        .filter(crate::db::entity::chat_file_uploads::Column::ChatId.eq(*chat_id))
        .exec(&txn)
        .await?;
    messages::Entity::delete_many()
        .filter(messages::Column::ChatId.eq(*chat_id))
        .exec(&txn)
        .await?;
    Chats::delete_by_id(*chat_id).exec(&txn).await?;
    txn.commit().await?;

    Ok(())
}

/// Archive a chat by setting its archived_at timestamp
pub async fn archive_chat(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    chat_id: &Uuid,
    generation_stale_after_secs: u64,
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

    archive_delegated_descendants(
        conn,
        &updated_chat.id,
        &updated_chat.owner_user_id,
        generation_stale_after_secs,
    )
    .await?;

    Ok(updated_chat)
}

/// Archive all non-archived chats for a specific owner user.
///
/// Returns the number of chats that were newly archived.
pub async fn archive_all_unarchived_chats_for_owner(
    conn: &DatabaseConnection,
    owner_user_id: &str,
) -> Result<u64, Report> {
    let now: DateTimeWithTimeZone = Utc::now().into();
    let result = Chats::update_many()
        .set(chats::ActiveModel {
            archived_at: ActiveValue::Set(Some(now)),
            ..Default::default()
        })
        .filter(chats::Column::OwnerUserId.eq(owner_user_id))
        .filter(chats::Column::ArchivedAt.is_null())
        .exec(conn)
        .await?;

    Ok(result.rows_affected)
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
