use crate::db::entity::prelude::*;
use crate::db::entity::{chat_file_uploads, file_uploads};
use crate::policy::prelude::*;
use crate::services::file_storage::{FileStorage, SHAREPOINT_PROVIDER_ID, SharepointContext};
use eyre::{ContextCompat, OptionExt, Report, WrapErr};
use sea_orm::prelude::*;
use sea_orm::{ActiveValue, DatabaseConnection, JoinType, QuerySelect};
use serde::{Deserialize, Serialize};
use serde_json::to_string;
use sqlx::types::Uuid;
use std::collections::HashMap;
use tracing::instrument;
use utoipa::ToSchema;

fn subject_user_id(subject: &Subject) -> String {
    subject.user_id().to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct AudioTranscriptionChunk {
    /// Stable zero-based chunk index.
    #[serde(default)]
    pub index: usize,
    /// Optional start offset in milliseconds for the chunk.
    #[serde(default)]
    pub start_ms: Option<u64>,
    /// Optional end offset in milliseconds for the chunk.
    #[serde(default)]
    pub end_ms: Option<u64>,
    /// Optional byte range start in the stored canonical audio object.
    #[serde(default)]
    pub byte_start: Option<u64>,
    /// Optional byte range end in the stored canonical audio object.
    #[serde(default)]
    pub byte_end: Option<u64>,
    /// Per-chunk transcription status.
    #[serde(default)]
    pub status: String,
    /// Per-chunk transcript text.
    #[serde(default)]
    pub transcript: Option<String>,
    /// Number of attempts made for this chunk.
    #[serde(default)]
    pub attempts: usize,
    /// Optional sanitized error for this chunk.
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct AudioTranscriptSegment {
    /// Zero-based chunk index for this segment.
    #[serde(default)]
    pub chunk_index: usize,
    /// Segment start offset in milliseconds.
    #[serde(default)]
    pub start_ms: u64,
    /// Segment end offset in milliseconds.
    #[serde(default)]
    pub end_ms: u64,
    /// Transcribed text for this segment.
    #[serde(default)]
    pub text: String,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize, ToSchema)]
pub struct AudioTranscriptionMetadata {
    /// Current transcription state.
    #[serde(default)]
    pub status: String,
    /// Optional transcript text once transcription completes.
    #[serde(default)]
    pub transcript: Option<String>,
    /// Optional error message if status indicates failure.
    #[serde(default)]
    pub error: Option<String>,
    /// Optional aggregate progress value in `[0, 1]`.
    #[serde(default)]
    pub progress: Option<f64>,
    /// Per-chunk progress and state for future timeline alignment.
    #[serde(default)]
    pub chunks: Option<Vec<AudioTranscriptionChunk>>,
    /// Transcript segments derived from completed chunks for timeline-aware UI surfaces.
    #[serde(default)]
    pub transcript_segments: Option<Vec<AudioTranscriptSegment>>,
}

impl AudioTranscriptionMetadata {
    pub fn is_completed(&self) -> bool {
        self.status.eq_ignore_ascii_case("completed")
    }

    pub fn aggregate_transcript(&self) -> Option<String> {
        if let Some(transcript) = self.transcript.as_ref() {
            let trimmed = transcript.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }

        let segments = self.transcript_segments.as_ref()?;
        let text = segments
            .iter()
            .filter_map(|segment| {
                let chunk_text = segment.text.trim();
                if chunk_text.is_empty() {
                    None
                } else {
                    Some(chunk_text.to_string())
                }
            })
            .collect::<Vec<_>>()
            .join(" ");

        if text.is_empty() { None } else { Some(text) }
    }
}

fn parse_audio_transcription_metadata(
    audio_transcription: &Option<String>,
) -> Option<AudioTranscriptionMetadata> {
    let raw = audio_transcription.as_deref()?;
    serde_json::from_str::<AudioTranscriptionMetadata>(raw).ok()
}

pub fn initial_audio_transcription_metadata() -> AudioTranscriptionMetadata {
    AudioTranscriptionMetadata {
        status: "processing".to_string(),
        transcript: None,
        error: None,
        progress: Some(0.0),
        chunks: None,
        transcript_segments: None,
    }
}

pub async fn set_audio_transcription_metadata(
    conn: &DatabaseConnection,
    file_upload_id: &Uuid,
    audio_transcription: Option<AudioTranscriptionMetadata>,
) -> Result<(), Report> {
    let audio_transcription = audio_transcription
        .as_ref()
        .map(to_string)
        .transpose()
        .wrap_err("Failed to serialize audio transcription metadata")?;

    file_uploads::ActiveModel {
        id: ActiveValue::Set(*file_upload_id),
        audio_transcription: ActiveValue::Set(audio_transcription),
        ..Default::default()
    }
    .update(conn)
    .await
    .wrap_err("Failed to update audio transcription metadata")?;

    Ok(())
}

pub async fn get_audio_transcription_upload_for_mutation(
    conn: &DatabaseConnection,
    subject: &Subject,
    file_upload_id: &Uuid,
) -> Result<file_uploads::Model, Report> {
    let file_upload = FileUploads::find_by_id(*file_upload_id)
        .one(conn)
        .await?
        .wrap_err("File upload not found")?;

    if file_upload.owner_user_id != subject.user_id() {
        return Err(eyre::eyre!(
            "File upload mutation access denied: subject does not own file upload"
        ));
    }

    Ok(file_upload)
}

pub fn get_audio_transcription_metadata(
    file_upload: &file_uploads::Model,
) -> Option<AudioTranscriptionMetadata> {
    parse_audio_transcription_metadata(&file_upload.audio_transcription)
}

pub fn get_audio_transcription_blocking_reason(
    file_upload: &file_uploads::Model,
) -> Option<String> {
    let metadata = get_audio_transcription_metadata(file_upload)?;
    if metadata.is_completed() {
        return None;
    }

    if let Some(error) = metadata.error {
        Some(format!(
            "Audio transcription for file {} is incomplete: {}",
            metadata_error_label(file_upload),
            error
        ))
    } else {
        Some(format!(
            "Audio transcription for file {} is incomplete (status = {})",
            metadata_error_label(file_upload),
            metadata.status
        ))
    }
}

fn metadata_error_label(file_upload: &file_uploads::Model) -> String {
    format!("{} ({})", file_upload.filename, file_upload.id)
}

pub fn get_audio_transcript_if_ready(file_upload: &file_uploads::Model) -> Option<String> {
    parse_audio_transcription_metadata(&file_upload.audio_transcription)
        .filter(AudioTranscriptionMetadata::is_completed)
        .and_then(|metadata| metadata.aggregate_transcript())
}

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
    let owner_user_id = subject_user_id(subject);

    // Create the file upload record (independent of chat)
    let new_file_upload = file_uploads::ActiveModel {
        id: ActiveValue::Set(file_upload_id),
        owner_user_id: ActiveValue::Set(owner_user_id),
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
    let owner_user_id = subject_user_id(subject);

    // Create the file upload record with Sharepoint provider
    let new_file_upload = file_uploads::ActiveModel {
        id: ActiveValue::Set(file_upload_id),
        owner_user_id: ActiveValue::Set(owner_user_id),
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

    policy
        .rebuild_data_if_needed(conn, &crate::config::AppConfig::default())
        .await?;

    authorize!(
        policy,
        subject,
        &Resource::FileUpload(file_upload.id.to_string()),
        Action::Read
    )
    .wrap_err("File upload access denied")?;

    Ok(file_upload)
}

/// Information about a file upload, including its download URL
#[derive(Debug)]
pub struct FileUploadWithUrl {
    pub id: Uuid,
    pub filename: String,
    pub file_storage_provider_id: String,
    pub file_storage_path: String,
    pub download_url: String,
    pub preview_url: Option<String>,
    pub file_contents_unavailable_missing_permissions: bool,
    pub audio_transcription: Option<AudioTranscriptionMetadata>,
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

    let file_storage_path = file_upload.file_storage_path.clone();
    let file_storage_provider_id = file_upload.file_storage_provider_id.clone();
    let filename = file_upload.filename.clone();
    let audio_transcription = get_audio_transcription_metadata(&file_upload);

    let (download_url, preview_url, file_contents_unavailable_missing_permissions) = if file_storage
        .is_sharepoint()
    {
        match file_storage
            .get_sharepoint_file_metadata_with_context(&file_storage_path, sharepoint_ctx.as_ref())
            .await
        {
            Ok(metadata) => (
                metadata.download_url,
                Some(format!("/api/v1beta/files/{}/preview", file_upload.id)),
                false,
            ),
            Err(err) => {
                tracing::warn!(
                    file_id = %file_upload.id,
                    provider = %file_storage_provider_id,
                    error = %err,
                    "Failed to generate Sharepoint file metadata, returning placeholder"
                );
                (format!("/api/v1beta/files/{}", file_upload.id), None, true)
            }
        }
    } else {
        let download_url = match file_storage
            .generate_presigned_download_url_with_context(
                &file_storage_path,
                None,
                Some(&filename),
                sharepoint_ctx.as_ref(),
            )
            .await
        {
            Ok(url) => url,
            Err(err) => {
                tracing::warn!(
                    file_id = %file_upload.id,
                    provider = %file_storage_provider_id,
                    error = %err,
                    "Failed to generate download URL, returning placeholder"
                );
                format!("/api/v1beta/files/{}", file_upload.id)
            }
        };

        let preview_url = file_storage
            .generate_presigned_preview_url_with_context(
                &file_storage_path,
                None,
                Some(&filename),
                sharepoint_ctx.as_ref(),
            )
            .await
            .ok();

        (download_url, preview_url, false)
    };

    Ok(FileUploadWithUrl {
        id: file_upload.id,
        filename,
        file_storage_provider_id,
        file_storage_path,
        download_url,
        preview_url,
        file_contents_unavailable_missing_permissions,
        audio_transcription,
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
        let file_storage_path = upload.file_storage_path.clone();
        let filename = upload.filename.clone();
        let file_storage_provider_id = upload.file_storage_provider_id.clone();
        let audio_transcription = get_audio_transcription_metadata(&upload);

        // Get the file storage provider
        let file_storage = file_storage_providers
            .get(&file_storage_provider_id)
            .ok_or_eyre(format!(
                "File storage provider not found: {}",
                file_storage_provider_id
            ))?;

        let (download_url, preview_url, file_contents_unavailable_missing_permissions) =
            if file_storage.is_sharepoint() {
                match file_storage
                    .get_sharepoint_file_metadata_with_context(
                        &file_storage_path,
                        sharepoint_ctx.as_ref(),
                    )
                    .await
                {
                    Ok(metadata) => (
                        metadata.download_url,
                        Some(format!("/api/v1beta/files/{}/preview", upload.id)),
                        false,
                    ),
                    Err(err) => {
                        tracing::warn!(
                            file_id = %upload.id,
                            provider = %file_storage_provider_id,
                            error = %err,
                            "Failed to generate Sharepoint file metadata, returning placeholder"
                        );
                        (format!("/api/v1beta/files/{}", upload.id), None, true)
                    }
                }
            } else {
                let download_url = match file_storage
                    .generate_presigned_download_url_with_context(
                        &file_storage_path,
                        None,
                        Some(&filename),
                        sharepoint_ctx.as_ref(),
                    )
                    .await
                {
                    Ok(url) => url,
                    Err(err) => {
                        tracing::warn!(
                            file_id = %upload.id,
                            provider = %file_storage_provider_id,
                            error = %err,
                            "Failed to generate download URL, returning placeholder"
                        );
                        format!("/api/v1beta/files/{}", upload.id)
                    }
                };

                let preview_url = file_storage
                    .generate_presigned_preview_url_with_context(
                        &file_storage_path,
                        None,
                        Some(&filename),
                        sharepoint_ctx.as_ref(),
                    )
                    .await
                    .ok();

                (download_url, preview_url, false)
            };

        result.push(FileUploadWithUrl {
            id: upload.id,
            filename,
            file_storage_provider_id,
            file_storage_path,
            download_url,
            preview_url,
            file_contents_unavailable_missing_permissions,
            audio_transcription,
        });
    }

    Ok(result)
}
