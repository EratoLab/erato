use crate::db::entity::prelude::FileUploads;
use crate::models::message::{ContentPart, ContentPartText, GenerationInputMessages};
use crate::server::api::v1beta::message_streaming::FileContent;
use crate::services::file_processing_cached::get_file_cached;
use crate::services::file_storage::{SharepointContext, is_missing_permissions_error};
use crate::state::AppState;
use eyre::Report;
use sea_orm::EntityTrait;
use sea_orm::prelude::Uuid;

/// Format an error message for files that cannot be retrieved
pub(crate) fn format_file_error_message(
    filename: &str,
    file_id: Uuid,
    is_parsing_error: bool,
) -> String {
    let mut content = String::new();
    content.push_str("File:\n");
    content.push_str(&format!("file name: {}\n", filename));
    content.push_str(&format!("file_id: erato_file_id:{}\n", file_id));

    if is_parsing_error {
        content.push_str(
            "No file contents available as the file was not parseable. This info should be returned to the user."
        );
    } else {
        content.push_str(
            "Unable to retrieve file contents due to an unknown error. Please contact support if this issue persists."
        );
    }

    content
}

/// Format an error message for files that are inaccessible due to missing permissions.
pub(crate) fn format_file_permission_error_message(filename: &str, file_id: Uuid) -> String {
    let mut content = String::new();
    content.push_str("File:\n");
    content.push_str(&format!("file name: {}\n", filename));
    content.push_str(&format!("file_id: erato_file_id:{}\n", file_id));
    content.push_str(
        "Unable to retrieve file contents because the current user does not have permission to access this file.",
    );
    content
}

/// Format successful file content with metadata header
pub(crate) fn format_successful_file_content(filename: &str, file_id: Uuid, text: &str) -> String {
    let mut content = String::new();
    content.push_str("File:\n");
    content.push_str(&format!("file name: {}\n", filename));
    content.push_str(&format!("file_id: erato_file_id:{}\n", file_id));
    content.push_str("File contents\n");
    content.push_str("---\n");
    content.push_str(text);
    content.push_str("\n---");

    content
}

/// Resolve TextFilePointer and ImageFilePointer content parts in generation input messages by extracting file contents JIT.
/// This prevents storing duplicate file contents in the database.
pub(crate) async fn resolve_file_pointers_in_generation_input(
    app_state: &AppState,
    generation_input_messages: GenerationInputMessages,
    access_token: Option<&str>,
) -> Result<GenerationInputMessages, Report> {
    // Build the context for Sharepoint (will be ignored by other providers)
    let sharepoint_ctx = access_token.map(|token| SharepointContext {
        access_token: token,
    });

    let mut resolved_messages = Vec::new();

    for input_message in generation_input_messages.messages {
        let resolved_content = match input_message.content {
            ContentPart::TextFilePointer(ref file_pointer) => {
                let file_upload_id = file_pointer.file_upload_id;
                let is_image_pointer = false;

                resolve_file_pointer(
                    app_state,
                    file_upload_id,
                    is_image_pointer,
                    sharepoint_ctx.as_ref(),
                )
                .await
            }
            ContentPart::ImageFilePointer(ref file_pointer) => {
                let file_upload_id = file_pointer.file_upload_id;
                let is_image_pointer = true;

                resolve_file_pointer(
                    app_state,
                    file_upload_id,
                    is_image_pointer,
                    sharepoint_ctx.as_ref(),
                )
                .await
            }
            // Pass through other content parts unchanged
            other => other,
        };

        resolved_messages.push(crate::models::message::InputMessage {
            role: input_message.role,
            content: resolved_content,
        });
    }

    Ok(GenerationInputMessages {
        messages: resolved_messages,
    })
}

/// Helper function to resolve a file pointer (text or image) to its actual content
async fn resolve_file_pointer(
    app_state: &AppState,
    file_upload_id: Uuid,
    is_image_pointer: bool,
    sharepoint_ctx: Option<&SharepointContext<'_>>,
) -> ContentPart {
    let file_upload_result = FileUploads::find_by_id(file_upload_id)
        .one(&app_state.db)
        .await;

    match file_upload_result {
        Ok(Some(file)) => {
            let file_storage = app_state
                .file_storage_providers
                .get(&file.file_storage_provider_id);

            if let Some(file_storage) = file_storage {
                match get_file_cached(
                    app_state,
                    &file_upload_id,
                    file_storage,
                    &file.file_storage_path,
                    &file.filename,
                    sharepoint_ctx,
                )
                .await
                {
                    Ok(file_contents) => match (&file_contents.content, is_image_pointer) {
                        (FileContent::Text(text), false) => {
                            tracing::debug!(
                                "Successfully extracted text from file pointer {}: {} (text length: {})",
                                file.filename,
                                file_upload_id,
                                text.len()
                            );

                            let content = format_successful_file_content(
                                &file.filename,
                                file_upload_id,
                                text,
                            );
                            ContentPart::Text(ContentPartText { text: content })
                        }
                        (FileContent::Image { .. }, true) => {
                            if let Some(image) = file_contents.as_base64_image() {
                                tracing::debug!(
                                    "Successfully encoded image: {} ({} bytes, {})",
                                    file.filename,
                                    image.base64_data.len(),
                                    image.content_type
                                );
                                ContentPart::Image(image)
                            } else {
                                unreachable!(
                                    "as_base64_image should always succeed for Image variant"
                                )
                            }
                        }
                        (FileContent::Text(_), true) => {
                            tracing::warn!(
                                "ImageFilePointer resolved to text file: {}",
                                file_upload_id
                            );
                            let content =
                                format_file_error_message(&file.filename, file_upload_id, false);
                            ContentPart::Text(ContentPartText { text: content })
                        }
                        (FileContent::Image { .. }, false) => {
                            tracing::warn!(
                                "TextFilePointer resolved to image file: {}",
                                file_upload_id
                            );
                            let content =
                                format_file_error_message(&file.filename, file_upload_id, false);
                            ContentPart::Text(ContentPartText { text: content })
                        }
                    },
                    Err(err) => {
                        if is_missing_permissions_error(&err) {
                            tracing::warn!(
                                "Failed to get file contents for {}: {} - missing permissions: {}, using permission placeholder text",
                                file.filename,
                                file_upload_id,
                                err
                            );
                            let content = format_file_permission_error_message(
                                &file.filename,
                                file_upload_id,
                            );
                            return ContentPart::Text(ContentPartText { text: content });
                        }

                        let is_parsing_error =
                            err.to_string().contains("parse") || err.to_string().contains("Parse");

                        tracing::warn!(
                            "Failed to get file contents for {}: {} - Error: {}, using placeholder text",
                            file.filename,
                            file_upload_id,
                            err
                        );
                        let content = format_file_error_message(
                            &file.filename,
                            file_upload_id,
                            is_parsing_error,
                        );
                        ContentPart::Text(ContentPartText { text: content })
                    }
                }
            } else {
                tracing::warn!(
                    "File storage provider {} not found for file {}, using placeholder text",
                    file.file_storage_provider_id,
                    file_upload_id
                );
                let content = format_file_error_message(&file.filename, file_upload_id, false);
                ContentPart::Text(ContentPartText { text: content })
            }
        }
        Ok(None) => {
            tracing::warn!(
                "File upload {} referenced in file pointer not found, using placeholder text",
                file_upload_id
            );
            let content = format_file_error_message("Unknown", file_upload_id, false);
            ContentPart::Text(ContentPartText { text: content })
        }
        Err(err) => {
            tracing::error!(
                "Database error fetching file upload {}: {}, using placeholder text",
                file_upload_id,
                err
            );
            let content = format_file_error_message("Unknown", file_upload_id, false);
            ContentPart::Text(ContentPartText { text: content })
        }
    }
}
