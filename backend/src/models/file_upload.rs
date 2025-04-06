use crate::db::entity::file_uploads;
use crate::db::entity::prelude::*;
use crate::policy::prelude::*;
use eyre::{ContextCompat, Report};
use sea_orm::prelude::*;
use sea_orm::{ActiveValue, DatabaseConnection};
use sqlx::types::Uuid;

impl From<&file_uploads::Model> for Resource {
    fn from(val: &file_uploads::Model) -> Self {
        Resource::Chat(val.chat_id.as_hyphenated().to_string())
    }
}

/// Create a new file upload record in the database
pub async fn create_file_upload(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    chat_id: &Uuid,
    filename: String,
    file_storage_provider_id: String,
    file_storage_path: String,
) -> Result<file_uploads::Model, Report> {
    // Authorize that the subject can access the chat
    authorize!(
        policy,
        subject,
        &Resource::Chat(chat_id.to_string()),
        Action::Update
    )?;

    // Create the file upload record
    let new_file_upload = file_uploads::ActiveModel {
        id: ActiveValue::Set(Uuid::new_v4()),
        chat_id: ActiveValue::Set(*chat_id),
        filename: ActiveValue::Set(filename),
        file_storage_provider_id: ActiveValue::Set(file_storage_provider_id),
        file_storage_path: ActiveValue::Set(file_storage_path),
        ..Default::default()
    };

    let created_file_upload = file_uploads::Entity::insert(new_file_upload)
        .exec_with_returning(conn)
        .await?;

    Ok(created_file_upload)
}

/// Get all file uploads for a chat
pub async fn get_chat_file_uploads(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    chat_id: &Uuid,
) -> Result<Vec<file_uploads::Model>, Report> {
    // Authorize that the subject can access the chat
    authorize!(
        policy,
        subject,
        &Resource::Chat(chat_id.to_string()),
        Action::Read
    )?;

    // Query all file uploads for the chat
    let file_uploads = FileUploads::find()
        .filter(file_uploads::Column::ChatId.eq(*chat_id))
        .all(conn)
        .await?;

    Ok(file_uploads)
}

/// Get a specific file upload by ID
pub async fn get_file_upload_by_id(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    file_upload_id: &Uuid,
) -> Result<file_uploads::Model, Report> {
    // Find the file upload
    let file_upload = FileUploads::find_by_id(*file_upload_id)
        .one(conn)
        .await?
        .wrap_err("File upload not found")?;

    // Authorize that the subject can access the chat that the file belongs to
    authorize!(
        policy,
        subject,
        &Resource::Chat(file_upload.chat_id.to_string()),
        Action::Read
    )?;

    Ok(file_upload)
}
