use crate::db::entity::prelude::*;
use crate::db::entity::{assistant_file_uploads, assistants, file_uploads};
use crate::policy::prelude::*;
use crate::services::file_storage::FileStorage;
use chrono::Utc;
use eyre::{ContextCompat, Report, WrapErr};
use sea_orm::prelude::*;
use sea_orm::{
    ColumnTrait, Condition, DatabaseConnection, EntityTrait, IntoActiveModel, JoinType,
    QueryFilter, QueryOrder, QuerySelect, Set,
};
use serde::Serialize;
use sqlx::types::Uuid;

/// Serializable file information for API responses
#[derive(Debug, Clone, Serialize)]
pub struct FileInfo {
    pub id: Uuid,
    pub filename: String,
    pub file_storage_provider_id: String,
    pub file_storage_path: String,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: DateTimeWithTimeZone,
}

impl From<file_uploads::Model> for FileInfo {
    fn from(file: file_uploads::Model) -> Self {
        Self {
            id: file.id,
            filename: file.filename,
            file_storage_provider_id: file.file_storage_provider_id,
            file_storage_path: file.file_storage_path,
            created_at: file.created_at,
            updated_at: file.updated_at,
        }
    }
}

/// Information about an assistant, including associated files
#[derive(Debug, Clone, Serialize)]
pub struct AssistantWithFiles {
    pub id: Uuid,
    pub owner_user_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub prompt: String,
    pub mcp_server_ids: Option<Vec<String>>,
    pub default_chat_provider: Option<String>,
    pub archived_at: Option<DateTimeWithTimeZone>,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: DateTimeWithTimeZone,
    pub files: Vec<FileInfo>,
}

/// Create a new assistant
#[allow(clippy::too_many_arguments)]
pub async fn create_assistant(
    conn: &DatabaseConnection,
    _policy: &PolicyEngine,
    subject: &Subject,
    name: String,
    description: Option<String>,
    prompt: String,
    mcp_server_ids: Option<Vec<String>>,
    default_chat_provider: Option<String>,
) -> Result<assistants::Model, Report> {
    // Get the user ID from subject (subject contains the user UUID)
    let crate::policy::types::Subject::User(user_id_str) = &subject;
    let user_uuid = Uuid::parse_str(user_id_str).wrap_err("Invalid user ID format")?;
    let user = Users::find_by_id(user_uuid)
        .one(conn)
        .await?
        .wrap_err("User not found")?;

    // Create the assistant record
    let new_assistant = assistants::ActiveModel {
        id: Set(Uuid::new_v4()),
        owner_user_id: Set(user.id),
        name: Set(name),
        description: Set(description),
        prompt: Set(prompt),
        mcp_server_ids: Set(mcp_server_ids),
        default_chat_provider: Set(default_chat_provider),
        archived_at: Set(None),
        created_at: Set(Utc::now().into()),
        updated_at: Set(Utc::now().into()),
    };

    let created_assistant = Assistants::insert(new_assistant)
        .exec_with_returning(conn)
        .await?;

    Ok(created_assistant)
}

/// Get all assistants available to the user (owner's assistants)
pub async fn get_user_assistants(
    conn: &DatabaseConnection,
    _policy: &PolicyEngine,
    subject: &Subject,
) -> Result<Vec<assistants::Model>, Report> {
    // Get the user ID from subject (subject contains the user UUID)
    let crate::policy::types::Subject::User(user_id_str) = &subject;
    let user_uuid = Uuid::parse_str(user_id_str).wrap_err("Invalid user ID format")?;
    let user = Users::find_by_id(user_uuid)
        .one(conn)
        .await?
        .wrap_err("User not found")?;

    // Query all non-archived assistants for the user, sorted by updated_at desc
    let user_assistants = Assistants::find()
        .filter(
            Condition::all()
                .add(assistants::Column::OwnerUserId.eq(user.id))
                .add(assistants::Column::ArchivedAt.is_null()),
        )
        .order_by_desc(assistants::Column::UpdatedAt)
        .all(conn)
        .await?;

    Ok(user_assistants)
}

/// Internal function to get an assistant by ID with optional archived filter
///
/// This allows retrieving archived assistants for internal operations like
/// continuing chats that were created with an assistant that's now archived.
async fn get_assistant_by_id_internal(
    conn: &DatabaseConnection,
    subject: &Subject,
    assistant_id: Uuid,
    allow_archived: bool,
) -> Result<assistants::Model, Report> {
    // Build query
    let mut query = Assistants::find_by_id(assistant_id);

    // Only filter out archived assistants if not allowed
    if !allow_archived {
        query = query.filter(assistants::Column::ArchivedAt.is_null());
    }

    let assistant = query.one(conn).await?.wrap_err(if allow_archived {
        "Assistant not found"
    } else {
        "Assistant not found or archived"
    })?;

    // Get the user ID from subject (subject contains the user UUID)
    let crate::policy::types::Subject::User(user_id_str) = &subject;
    let user_uuid = Uuid::parse_str(user_id_str).wrap_err("Invalid user ID format")?;
    let user = Users::find_by_id(user_uuid)
        .one(conn)
        .await?
        .wrap_err("User not found")?;

    // Check if the user is the owner of the assistant
    if assistant.owner_user_id != user.id {
        return Err(eyre::eyre!(
            "Access denied: User is not the owner of this assistant"
        ));
    }

    Ok(assistant)
}

/// Get an assistant by ID (user must be the owner)
///
/// This function excludes archived assistants. For user-facing API endpoints only.
/// For internal operations that need to access archived assistants (e.g., continuing
/// a chat with an archived assistant), use get_assistant_by_id_internal.
pub async fn get_assistant_by_id(
    conn: &DatabaseConnection,
    _policy: &PolicyEngine,
    subject: &Subject,
    assistant_id: Uuid,
) -> Result<assistants::Model, Report> {
    get_assistant_by_id_internal(conn, subject, assistant_id, false).await
}

/// Get an assistant with its associated files
///
/// The `allow_archived` parameter controls whether archived assistants can be retrieved:
/// - `true`: For internal operations (e.g., loading assistant config for existing chats)
/// - `false`: For user-facing features (e.g., frequent assistants list)
pub async fn get_assistant_with_files(
    conn: &DatabaseConnection,
    _policy: &PolicyEngine,
    subject: &Subject,
    assistant_id: Uuid,
    allow_archived: bool,
) -> Result<AssistantWithFiles, Report> {
    // Get the assistant (includes ownership check)
    let assistant =
        get_assistant_by_id_internal(conn, subject, assistant_id, allow_archived).await?;

    // Get associated files through the join table
    let files = FileUploads::find()
        .join(
            JoinType::InnerJoin,
            file_uploads::Relation::AssistantFileUploads.def(),
        )
        .filter(assistant_file_uploads::Column::AssistantId.eq(assistant_id))
        .all(conn)
        .await?;

    Ok(AssistantWithFiles {
        id: assistant.id,
        owner_user_id: assistant.owner_user_id,
        name: assistant.name,
        description: assistant.description,
        prompt: assistant.prompt,
        mcp_server_ids: assistant.mcp_server_ids,
        default_chat_provider: assistant.default_chat_provider,
        archived_at: assistant.archived_at,
        created_at: assistant.created_at,
        updated_at: assistant.updated_at,
        files: files.into_iter().map(FileInfo::from).collect(),
    })
}

/// Update an existing assistant
#[allow(clippy::too_many_arguments)]
pub async fn update_assistant(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    assistant_id: Uuid,
    name: Option<String>,
    description: Option<Option<String>>,
    prompt: Option<String>,
    mcp_server_ids: Option<Option<Vec<String>>>,
    default_chat_provider: Option<Option<String>>,
) -> Result<assistants::Model, Report> {
    // Get the assistant (includes ownership check)
    let assistant = get_assistant_by_id(conn, policy, subject, assistant_id).await?;

    // Update the assistant record
    let mut active_assistant = assistant.into_active_model();

    if let Some(new_name) = name {
        active_assistant.name = Set(new_name);
    }

    if let Some(new_description) = description {
        active_assistant.description = Set(new_description);
    }

    if let Some(new_prompt) = prompt {
        active_assistant.prompt = Set(new_prompt);
    }

    if let Some(new_mcp_server_ids) = mcp_server_ids {
        active_assistant.mcp_server_ids = Set(new_mcp_server_ids);
    }

    if let Some(new_default_chat_provider) = default_chat_provider {
        active_assistant.default_chat_provider = Set(new_default_chat_provider);
    }

    active_assistant.updated_at = Set(Utc::now().into());

    let updated_assistant = active_assistant.update(conn).await?;

    Ok(updated_assistant)
}

/// Archive an assistant (soft delete)
pub async fn archive_assistant(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    assistant_id: Uuid,
) -> Result<assistants::Model, Report> {
    // Get the assistant (includes ownership check)
    let assistant = get_assistant_by_id(conn, policy, subject, assistant_id).await?;

    // Archive the assistant
    let mut active_assistant = assistant.into_active_model();
    active_assistant.archived_at = Set(Some(Utc::now().into()));
    active_assistant.updated_at = Set(Utc::now().into());

    let archived_assistant = active_assistant.update(conn).await?;

    Ok(archived_assistant)
}

/// Associate a file upload with an assistant
pub async fn add_file_to_assistant(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    assistant_id: Uuid,
    file_upload_id: Uuid,
) -> Result<(), Report> {
    // Get the assistant (includes ownership check)
    let _assistant = get_assistant_by_id(conn, policy, subject, assistant_id).await?;

    // Verify the file upload exists
    let _file_upload = FileUploads::find_by_id(file_upload_id)
        .one(conn)
        .await?
        .wrap_err("File upload not found")?;

    // Create the association in the join table
    let new_assistant_file_upload = assistant_file_uploads::ActiveModel {
        assistant_id: Set(assistant_id),
        file_upload_id: Set(file_upload_id),
        created_at: Set(Utc::now().into()),
        updated_at: Set(Utc::now().into()),
    };

    assistant_file_uploads::Entity::insert(new_assistant_file_upload)
        .exec(conn)
        .await?;

    Ok(())
}

/// Remove a file association from an assistant
pub async fn remove_file_from_assistant(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    assistant_id: Uuid,
    file_upload_id: Uuid,
) -> Result<(), Report> {
    // Get the assistant (includes ownership check)
    let _assistant = get_assistant_by_id(conn, policy, subject, assistant_id).await?;

    // Remove the association from the join table
    assistant_file_uploads::Entity::delete_many()
        .filter(
            Condition::all()
                .add(assistant_file_uploads::Column::AssistantId.eq(assistant_id))
                .add(assistant_file_uploads::Column::FileUploadId.eq(file_upload_id)),
        )
        .exec(conn)
        .await?;

    Ok(())
}

/// Create a file upload record directly (not associated with chat)
pub async fn create_standalone_file_upload(
    conn: &DatabaseConnection,
    _policy: &PolicyEngine,
    _subject: &Subject,
    filename: String,
    file_storage_provider_id: String,
    file_storage_path: String,
) -> Result<file_uploads::Model, Report> {
    // Create the file upload record (independent of chat)
    let new_file_upload = file_uploads::ActiveModel {
        id: Set(Uuid::new_v4()),
        filename: Set(filename),
        file_storage_provider_id: Set(file_storage_provider_id),
        file_storage_path: Set(file_storage_path),
        created_at: Set(Utc::now().into()),
        updated_at: Set(Utc::now().into()),
    };

    let created_file_upload = file_uploads::Entity::insert(new_file_upload)
        .exec_with_returning(conn)
        .await?;

    Ok(created_file_upload)
}

/// Upload a file and associate it with an assistant
#[allow(clippy::too_many_arguments)]
pub async fn upload_file_to_assistant(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    assistant_id: Uuid,
    filename: String,
    file_storage_provider_id: String,
    file_storage_path: String,
    _file_storage_providers: &std::collections::HashMap<String, FileStorage>,
) -> Result<file_uploads::Model, Report> {
    // Get the assistant (includes ownership check)
    let _assistant = get_assistant_by_id(conn, policy, subject, assistant_id).await?;

    // Create the file upload record (independent of chat)
    let file_upload = create_standalone_file_upload(
        conn,
        policy,
        subject,
        filename,
        file_storage_provider_id,
        file_storage_path,
    )
    .await;

    // Associate the file with the assistant
    if let Ok(upload) = file_upload {
        add_file_to_assistant(conn, policy, subject, assistant_id, upload.id).await?;
        Ok(upload)
    } else {
        file_upload
    }
}
