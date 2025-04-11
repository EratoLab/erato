use crate::db::entity::file_uploads;
use crate::db::entity::prelude::*;
use crate::policy::prelude::*;
use crate::services::file_storage::FileStorage;
use eyre::{ContextCompat, OptionExt, Report};
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

/// Information about a file upload, including its download URL
#[derive(Debug)]
pub struct FileUploadWithUrl {
    pub id: Uuid,
    pub chat_id: Uuid,
    pub filename: String,
    pub file_storage_provider_id: String,
    pub file_storage_path: String,
    pub download_url: String,
}

/// Get a specific file upload by ID, including a pre-signed download URL
pub async fn get_file_upload_with_url(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    file_upload_id: &Uuid,
    file_storage_providers: &std::collections::HashMap<String, FileStorage>,
) -> Result<FileUploadWithUrl, Report> {
    // Find the file upload
    let file_upload = get_file_upload_by_id(conn, policy, subject, file_upload_id).await?;

    // Get the file storage provider
    let file_storage = file_storage_providers
        .get(&file_upload.file_storage_provider_id)
        .ok_or_eyre(format!(
            "File storage provider not found: {}",
            file_upload.file_storage_provider_id
        ))?;

    // Generate a pre-signed download URL
    let download_url = file_storage
        .generate_presigned_download_url(&file_upload.file_storage_path, None)
        .await?;

    Ok(FileUploadWithUrl {
        id: file_upload.id,
        chat_id: file_upload.chat_id,
        filename: file_upload.filename,
        file_storage_provider_id: file_upload.file_storage_provider_id,
        file_storage_path: file_upload.file_storage_path,
        download_url,
    })
}

/// Get all file uploads for a chat, with pre-signed download URLs
pub async fn get_chat_file_uploads_with_urls(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    chat_id: &Uuid,
    file_storage_providers: &std::collections::HashMap<String, FileStorage>,
) -> Result<Vec<FileUploadWithUrl>, Report> {
    // Get all file uploads for the chat
    let file_uploads = get_chat_file_uploads(conn, policy, subject, chat_id).await?;

    // For each file upload, generate a pre-signed download URL
    let mut result = Vec::with_capacity(file_uploads.len());

    for upload in file_uploads {
        // Get the file storage provider
        let file_storage = file_storage_providers
            .get(&upload.file_storage_provider_id)
            .ok_or_eyre(format!(
                "File storage provider not found: {}",
                upload.file_storage_provider_id
            ))?;

        // Generate a pre-signed download URL
        let download_url = file_storage
            .generate_presigned_download_url(&upload.file_storage_path, None)
            .await?;

        result.push(FileUploadWithUrl {
            id: upload.id,
            chat_id: upload.chat_id,
            filename: upload.filename,
            file_storage_provider_id: upload.file_storage_provider_id,
            file_storage_path: upload.file_storage_path,
            download_url,
        });
    }

    Ok(result)
}
