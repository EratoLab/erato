use super::traits::{FileResolver, MessageRepository, PromptProvider};
use crate::config::ChatProviderConfig;
use crate::db::entity::prelude::*;
use crate::db::entity::{chats, messages};
use crate::models::assistant::AssistantWithFiles;
use crate::models::message::ContentPartImage;
use crate::policy::prelude::*;
use crate::server::api::v1beta::message_streaming::FileContentsForGeneration;
use crate::services::file_processing_cached;
use crate::services::file_storage::SharepointContext;
use crate::state::AppState;
use async_trait::async_trait;
use eyre::{Context, ContextCompat, OptionExt, Report};
use sea_orm::prelude::Uuid;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};

/// Database-backed implementation of the MessageRepository trait.
/// Wraps existing functions from the models::message module.
pub struct DatabaseMessageRepository<'a> {
    pub conn: &'a sea_orm::DatabaseConnection,
    pub policy: &'a PolicyEngine,
    pub subject: &'a Subject,
}

#[async_trait]
impl<'a> MessageRepository for DatabaseMessageRepository<'a> {
    async fn get_message_by_id(&self, message_id: &Uuid) -> Result<messages::Model, Report> {
        crate::models::message::get_message_by_id(self.conn, self.policy, self.subject, message_id)
            .await
    }

    async fn get_generation_input_messages(
        &self,
        previous_message_id: &Uuid,
        num_messages: usize,
    ) -> Result<Vec<messages::Model>, Report> {
        // Traverse messages backward from previous_message_id
        let mut messages_vec = Vec::new();
        let mut current_message_id = Some(*previous_message_id);
        let mut count = 0;

        while let Some(msg_id) = current_message_id {
            if count >= num_messages {
                break;
            }

            let message = self.get_message_by_id(&msg_id).await?;
            current_message_id = message.previous_message_id;
            messages_vec.push(message);
            count += 1;
        }

        // Reverse to get chronological order
        messages_vec.reverse();
        Ok(messages_vec)
    }
}

/// AppState-backed implementation of the FileResolver trait.
/// Wraps the file resolution logic from message_streaming.rs
pub struct AppStateFileResolver<'a> {
    pub app_state: &'a AppState,
    pub access_token: Option<&'a str>,
}

impl<'a> AppStateFileResolver<'a> {
    fn get_sharepoint_context(&self) -> Option<SharepointContext<'_>> {
        self.access_token.map(|token| SharepointContext {
            access_token: token,
        })
    }
}

#[async_trait]
impl<'a> FileResolver for AppStateFileResolver<'a> {
    async fn resolve_text_file(&self, file_id: Uuid) -> Result<String, Report> {
        let sharepoint_ctx = self.get_sharepoint_context();

        // Get the file upload record
        let file = FileUploads::find_by_id(file_id)
            .one(&self.app_state.db)
            .await?
            .wrap_err("File upload not found")?;

        // Get the file storage provider
        let file_storage = self
            .app_state
            .file_storage_providers
            .get(&file.file_storage_provider_id)
            .wrap_err("File storage provider not found")?;

        // Read the file content
        let file_bytes = file_storage
            .read_file_to_bytes_with_context(&file.file_storage_path, sharepoint_ctx.as_ref())
            .await
            .wrap_err("Failed to read file from storage")?;

        // Parse the file to extract text
        let text = self
            .app_state
            .file_processor
            .parse_file(file_bytes)
            .await
            .wrap_err("Failed to parse file")?;

        // Remove null characters (for Postgres compatibility)
        let text = remove_null_characters(&text);

        // Format the content
        let content = format_successful_file_content(&file.filename, file_id, &text);

        Ok(content)
    }

    async fn resolve_image_file(&self, file_id: Uuid) -> Result<ContentPartImage, Report> {
        let sharepoint_ctx = self.get_sharepoint_context();

        // Get the file upload record
        let file = FileUploads::find_by_id(file_id)
            .one(&self.app_state.db)
            .await?
            .wrap_err("File upload not found")?;

        // Get the file storage provider
        let file_storage = self
            .app_state
            .file_storage_providers
            .get(&file.file_storage_provider_id)
            .wrap_err("File storage provider not found")?;

        // Read the file content
        let file_bytes = file_storage
            .read_file_to_bytes_with_context(&file.file_storage_path, sharepoint_ctx.as_ref())
            .await
            .map_err(|e| eyre::eyre!("Failed to read image file from storage: {}", e))?;

        // Encode to base64
        use base64::{Engine as _, engine::general_purpose};
        let base64_data = general_purpose::STANDARD.encode(&file_bytes);

        // Determine MIME type from extension
        let content_type = get_mime_type_from_extension(&file.filename);

        tracing::debug!(
            "Successfully encoded image from file pointer {}: {} (size: {} bytes, content_type: {})",
            file.filename,
            file_id,
            file_bytes.len(),
            content_type
        );

        Ok(ContentPartImage {
            content_type,
            base64_data,
        })
    }

    async fn get_assistant_files(
        &self,
        file_ids: &[Uuid],
        access_token: Option<&str>,
    ) -> Result<Vec<FileContentsForGeneration>, Report> {
        // First, get the file info from the database
        let files = FileUploads::find()
            .filter(crate::db::entity::file_uploads::Column::Id.is_in(file_ids.iter().copied()))
            .all(&self.app_state.db)
            .await?;

        // Use the provided access_token, or fall back to self.access_token
        let effective_token = access_token.or(self.access_token);
        let sharepoint_ctx = effective_token.map(|token| SharepointContext {
            access_token: token,
        });

        // Process all files in parallel (following the pattern from get_assistant_files_for_generation)
        let futures = files.into_iter().map(|file| {
            let file_id = file.id;
            let filename = file.filename.clone();
            let file_storage_path = file.file_storage_path.clone();
            let file_storage_provider_id = file.file_storage_provider_id.clone();
            let sharepoint_ctx_ref = sharepoint_ctx.as_ref();
            let app_state = self.app_state;

            async move {
                // Get the file storage provider
                let file_storage = app_state
                    .file_storage_providers
                    .get(&file_storage_provider_id)
                    .ok_or_eyre("File storage provider not found")?;

                // Use unified get_file_cached function
                file_processing_cached::get_file_cached(
                    app_state,
                    &file_id,
                    file_storage,
                    &file_storage_path,
                    &filename,
                    sharepoint_ctx_ref,
                )
                .await
            }
        });

        // Wait for all futures to complete
        let results: Vec<Result<FileContentsForGeneration, Report>> =
            futures::future::join_all(futures).await;

        // Collect results, propagating any errors
        results.into_iter().collect()
    }

    async fn is_image_file(&self, file_id: Uuid) -> Result<bool, Report> {
        let file = FileUploads::find_by_id(file_id)
            .one(&self.app_state.db)
            .await?
            .wrap_err("File upload not found")?;

        let filename = file.filename;
        let is_image = if let Some(extension) = filename.rsplit('.').next() {
            matches!(
                extension.to_lowercase().as_str(),
                "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "svg" | "tiff" | "tif" | "ico"
            )
        } else {
            false
        };

        Ok(is_image)
    }
}

/// AppState-backed implementation of the PromptProvider trait.
pub struct AppStatePromptProvider<'a> {
    pub app_state: &'a AppState,
    pub policy: &'a PolicyEngine,
    pub subject: &'a Subject,
}

#[async_trait]
impl<'a> PromptProvider for AppStatePromptProvider<'a> {
    async fn get_system_prompt(
        &self,
        chat_provider_config: &ChatProviderConfig,
        preferred_language: Option<&str>,
    ) -> Result<Option<String>, Report> {
        self.app_state
            .get_system_prompt(chat_provider_config, preferred_language)
            .await
    }

    async fn get_assistant_config(
        &self,
        chat: &chats::Model,
    ) -> Result<Option<AssistantWithFiles>, Report> {
        crate::models::chat::get_chat_assistant_configuration(
            &self.app_state.db,
            self.policy,
            self.subject,
            chat,
        )
        .await
    }
}

// Helper functions (copied from message_streaming.rs for encapsulation)

fn remove_null_characters(text: &str) -> String {
    text.replace('\0', "")
}

fn format_successful_file_content(filename: &str, file_id: Uuid, text: &str) -> String {
    let mut content = String::new();
    content.push_str("File:\n");
    content.push_str(&format!("file name: {}\n", filename));
    content.push_str(&format!("file_id: erato_file_id:{}\n", file_id));
    content.push_str("File contents\n");
    content.push_str(text);
    content
}

fn get_mime_type_from_extension(filename: &str) -> String {
    if let Some(extension) = filename.rsplit('.').next() {
        match extension.to_lowercase().as_str() {
            "jpg" | "jpeg" => "image/jpeg".to_string(),
            "png" => "image/png".to_string(),
            "gif" => "image/gif".to_string(),
            "webp" => "image/webp".to_string(),
            "bmp" => "image/bmp".to_string(),
            "svg" => "image/svg+xml".to_string(),
            "tiff" | "tif" => "image/tiff".to_string(),
            "ico" => "image/x-icon".to_string(),
            _ => "application/octet-stream".to_string(),
        }
    } else {
        "application/octet-stream".to_string()
    }
}
