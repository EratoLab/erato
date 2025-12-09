use crate::db::entity::prelude::*;
use crate::db::entity::{assistant_file_uploads, chat_file_uploads, file_uploads};
use crate::models::share_grant;
use crate::policy::prelude::*;
use crate::services::file_storage::{FileStorage, SHAREPOINT_PROVIDER_ID, SharepointContext};
use eyre::{ContextCompat, OptionExt, Report};
use sea_orm::prelude::*;
use sea_orm::{ActiveValue, DatabaseConnection, JoinType, QuerySelect};
use sqlx::types::Uuid;
use std::collections::HashMap;
use tracing::instrument;

/// Create a new file upload record in the database and associate it with a chat
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

    let file_upload_id = Uuid::new_v4();

    // Create the file upload record (independent of chat)
    let new_file_upload = file_uploads::ActiveModel {
        id: ActiveValue::Set(file_upload_id),
        filename: ActiveValue::Set(filename),
        file_storage_provider_id: ActiveValue::Set(file_storage_provider_id),
        file_storage_path: ActiveValue::Set(file_storage_path),
        ..Default::default()
    };

    let created_file_upload = file_uploads::Entity::insert(new_file_upload)
        .exec_with_returning(conn)
        .await?;

    // Create the relation in the join table
    let new_chat_file_upload = chat_file_uploads::ActiveModel {
        chat_id: ActiveValue::Set(*chat_id),
        file_upload_id: ActiveValue::Set(file_upload_id),
        ..Default::default()
    };

    chat_file_uploads::Entity::insert(new_chat_file_upload)
        .exec(conn)
        .await?;

    Ok(created_file_upload)
}

/// Create a new file upload record for a Sharepoint/OneDrive file.
///
/// The file is referenced by its drive ID and item ID, which are stored as the file path
/// in the format `{driveId} | {itemId}`.
///
/// If `chat_id` is provided, the file is associated with that chat. Otherwise, it's created
/// as a standalone upload that can be linked to assistants later.
pub async fn create_sharepoint_file_upload(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    chat_id: Option<&Uuid>,
    filename: String,
    drive_id: String,
    item_id: String,
) -> Result<file_uploads::Model, Report> {
    // If chat_id provided, authorize that the subject can access the chat
    if let Some(chat_id) = chat_id {
        authorize!(
            policy,
            subject,
            &Resource::Chat(chat_id.to_string()),
            Action::Update
        )?;
    }

    let file_upload_id = Uuid::new_v4();
    let file_storage_path = format!("{} | {}", drive_id, item_id);

    // Create the file upload record with Sharepoint provider
    let new_file_upload = file_uploads::ActiveModel {
        id: ActiveValue::Set(file_upload_id),
        filename: ActiveValue::Set(filename),
        file_storage_provider_id: ActiveValue::Set(SHAREPOINT_PROVIDER_ID.to_string()),
        file_storage_path: ActiveValue::Set(file_storage_path),
        ..Default::default()
    };

    let created_file_upload = file_uploads::Entity::insert(new_file_upload)
        .exec_with_returning(conn)
        .await?;

    // If chat_id provided, create the relation in the join table
    if let Some(chat_id) = chat_id {
        let new_chat_file_upload = chat_file_uploads::ActiveModel {
            chat_id: ActiveValue::Set(*chat_id),
            file_upload_id: ActiveValue::Set(file_upload_id),
            ..Default::default()
        };

        chat_file_uploads::Entity::insert(new_chat_file_upload)
            .exec(conn)
            .await?;
    }

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

    // Query all file uploads for the chat via the join table
    let file_uploads = FileUploads::find()
        .join(
            JoinType::InnerJoin,
            file_uploads::Relation::ChatFileUploads.def(),
        )
        .filter(chat_file_uploads::Column::ChatId.eq(*chat_id))
        .all(conn)
        .await?;

    Ok(file_uploads)
}

/// Get a specific file upload by ID
#[instrument(skip_all)]
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

    // Find associated chat(s) through the join table
    let chat_relations = ChatFileUploads::find()
        .filter(chat_file_uploads::Column::FileUploadId.eq(*file_upload_id))
        .all(conn)
        .await?;

    // Try to authorize via chat access
    if !chat_relations.is_empty() {
        // Check access to the first associated chat (could be extended to check all)
        let chat_id = &chat_relations[0].chat_id;
        let chat_auth_result = authorize!(
            policy,
            subject,
            &Resource::Chat(chat_id.to_string()),
            Action::Read
        );

        if chat_auth_result.is_ok() {
            return Ok(file_upload);
        }
    }

    // If no chat access, check if file is associated with an assistant that's shared with the user
    let assistant_relations = AssistantFileUploads::find()
        .filter(assistant_file_uploads::Column::FileUploadId.eq(*file_upload_id))
        .all(conn)
        .await?;

    if !assistant_relations.is_empty() {
        // Get the user ID from subject
        let user_id_str = subject.user_id();

        // Get all assistants shared with this user (including organization group grants)
        let share_grants = share_grant::get_resources_shared_with_subject_and_groups(
            conn,
            user_id_str,
            "assistant",
            subject.organization_group_ids(),
        )
        .await?;

        // Check if any of the assistants associated with this file are shared with the user
        for assistant_relation in &assistant_relations {
            let assistant_id_str = assistant_relation.assistant_id.to_string();

            // Check if this assistant is shared with the user
            let has_viewer_access = share_grants
                .iter()
                .any(|grant| grant.resource_id == assistant_id_str && grant.role == "viewer");

            if has_viewer_access {
                return Ok(file_upload);
            }

            // Also check if user owns the assistant via authorization
            let assistant_auth_result = authorize!(
                policy,
                subject,
                &Resource::Assistant(assistant_id_str),
                Action::Read
            );

            if assistant_auth_result.is_ok() {
                return Ok(file_upload);
            }
        }
    }

    // No access via chat or assistant
    Err(eyre::eyre!(
        "File upload access denied: not associated with any accessible chat or assistant"
    ))
}

/// Information about a file upload, including its download URL
#[derive(Debug)]
pub struct FileUploadWithUrl {
    pub id: Uuid,
    pub filename: String,
    pub file_storage_provider_id: String,
    pub file_storage_path: String,
    pub download_url: String,
}

/// Get a specific file upload by ID, including a pre-signed download URL.
///
/// For Sharepoint files, an access token must be provided to generate the download URL.
/// If no access token is provided for a Sharepoint file, a placeholder URL is returned.
pub async fn get_file_upload_with_url(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    file_upload_id: &Uuid,
    file_storage_providers: &HashMap<String, FileStorage>,
) -> Result<FileUploadWithUrl, Report> {
    get_file_upload_with_url_and_token(
        conn,
        policy,
        subject,
        file_upload_id,
        file_storage_providers,
        None,
    )
    .await
}

/// Get a specific file upload by ID, including a pre-signed download URL.
///
/// For Sharepoint files, the access token is used to generate the download URL.
pub async fn get_file_upload_with_url_and_token(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    file_upload_id: &Uuid,
    file_storage_providers: &HashMap<String, FileStorage>,
    access_token: Option<&str>,
) -> Result<FileUploadWithUrl, Report> {
    // Find the file upload
    let file_upload = get_file_upload_by_id(conn, policy, subject, file_upload_id).await?;

    // Build the context for Sharepoint (will be ignored by other providers)
    let sharepoint_ctx = access_token.map(|token| SharepointContext {
        access_token: token,
    });

    // Get the file storage provider
    let file_storage = file_storage_providers
        .get(&file_upload.file_storage_provider_id)
        .ok_or_eyre(format!(
            "File storage provider not found: {}",
            file_upload.file_storage_provider_id
        ))?;

    // Generate a pre-signed download URL using the unified interface
    let download_url = match file_storage
        .generate_presigned_download_url_with_context(
            &file_upload.file_storage_path,
            None,
            sharepoint_ctx.as_ref(),
        )
        .await
    {
        Ok(url) => url,
        Err(err) => {
            // If URL generation fails (e.g., Sharepoint without token), return placeholder
            tracing::warn!(
                file_id = %file_upload.id,
                provider = %file_upload.file_storage_provider_id,
                error = %err,
                "Failed to generate download URL, returning placeholder"
            );
            format!("/api/v1beta/files/{}", file_upload.id)
        }
    };

    Ok(FileUploadWithUrl {
        id: file_upload.id,
        filename: file_upload.filename,
        file_storage_provider_id: file_upload.file_storage_provider_id,
        file_storage_path: file_upload.file_storage_path,
        download_url,
    })
}

/// Get all file uploads for a chat, with pre-signed download URLs.
///
/// For Sharepoint files, a placeholder URL is returned since no access token is provided.
#[instrument(skip_all)]
pub async fn get_chat_file_uploads_with_urls(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    chat_id: &Uuid,
    file_storage_providers: &HashMap<String, FileStorage>,
) -> Result<Vec<FileUploadWithUrl>, Report> {
    get_chat_file_uploads_with_urls_and_token(
        conn,
        policy,
        subject,
        chat_id,
        file_storage_providers,
        None,
    )
    .await
}

/// Get all file uploads for a chat, with pre-signed download URLs.
///
/// For Sharepoint files, the access token is used to generate the download URL.
#[instrument(skip_all)]
pub async fn get_chat_file_uploads_with_urls_and_token(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    chat_id: &Uuid,
    file_storage_providers: &HashMap<String, FileStorage>,
    access_token: Option<&str>,
) -> Result<Vec<FileUploadWithUrl>, Report> {
    // Get all file uploads for the chat
    let file_uploads = get_chat_file_uploads(conn, policy, subject, chat_id).await?;

    // Build the context for Sharepoint (will be ignored by other providers)
    let sharepoint_ctx = access_token.map(|token| SharepointContext {
        access_token: token,
    });

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

        // Generate a pre-signed download URL using the unified interface
        let download_url = match file_storage
            .generate_presigned_download_url_with_context(
                &upload.file_storage_path,
                None,
                sharepoint_ctx.as_ref(),
            )
            .await
        {
            Ok(url) => url,
            Err(err) => {
                // If URL generation fails (e.g., Sharepoint without token), return placeholder
                tracing::warn!(
                    file_id = %upload.id,
                    provider = %upload.file_storage_provider_id,
                    error = %err,
                    "Failed to generate download URL, returning placeholder"
                );
                format!("/api/v1beta/files/{}", upload.id)
            }
        };

        result.push(FileUploadWithUrl {
            id: upload.id,
            filename: upload.filename,
            file_storage_provider_id: upload.file_storage_provider_id,
            file_storage_path: upload.file_storage_path,
            download_url,
        });
    }

    Ok(result)
}
