use crate::db::entity::prelude::FileUploads;
use crate::policy::engine::PolicyEngine;
use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use crate::server::api::v1beta::message_streaming::{
    FileContent, FileContentsForGeneration, remove_null_characters,
};
use crate::services::file_parsing::parse_file;
use crate::services::file_storage::{FileStorage, SharepointContext};
use crate::state::AppState;
use eyre::{ContextCompat, OptionExt, Report, WrapErr};
use sea_orm::EntityTrait;
use sea_orm::prelude::Uuid;
use std::sync::Arc;
use tiktoken_rs::o200k_base;
use tracing::{Instrument, instrument};

/// Helper function to determine if a file is an image based on extension
fn is_image_file(filename: &str) -> bool {
    if let Some(extension) = filename.rsplit('.').next() {
        matches!(
            extension.to_lowercase().as_str(),
            "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "svg" | "tiff" | "tif" | "ico"
        )
    } else {
        false
    }
}

/// Helper function to get MIME type from file extension
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

/// Get raw file bytes from cache or storage
#[instrument(
    skip_all,
    fields(
        file_id = %file_id,
        file_bytes_length = tracing::field::Empty,
    )
)]
async fn get_file_bytes_cached<'a>(
    app_state: &AppState,
    file_id: &Uuid,
    file_storage: &FileStorage,
    file_storage_path: &str,
    sharepoint_ctx: Option<&SharepointContext<'a>>,
) -> Result<Vec<u8>, Report> {
    let span = tracing::Span::current();

    let result = app_state
        .file_bytes_cache
        .try_get_with_by_ref(file_id, async {
            tracing::debug!(file_id = %file_id, "File bytes cache miss - fetching");

            let file_bytes = file_storage
                .read_file_to_bytes_with_context(file_storage_path, sharepoint_ctx)
                .await
                .wrap_err(format!(
                    "Failed to read file from storage: {}",
                    file_storage_path
                ))?;

            span.record("file_bytes_length", file_bytes.len());
            tracing::debug!(
                file_id = %file_id,
                bytes_len = file_bytes.len(),
                "File bytes read from storage and cached"
            );

            Ok::<_, Report>(file_bytes)
        })
        .await
        .map_err(|arc_err| Arc::try_unwrap(arc_err).unwrap_or_else(|arc| eyre::eyre!("{}", arc)))?;

    span.record("file_bytes_length", result.len());
    Ok(result)
}

/// Get parsed text file contents from cache or fetch/parse
///
/// This function now operates in two tiers:
/// 1. Check file_contents_cache for parsed text
/// 2. If miss, check file_bytes_cache for raw bytes, then parse
/// 3. If miss, fetch from storage, cache bytes, then parse
#[instrument(
    skip_all,
    fields(
        file_id = tracing::field::Empty,
        file_storage_path = tracing::field::Empty,
        content_length = tracing::field::Empty,
        file_bytes_length = tracing::field::Empty,
    )
)]
pub async fn get_file_contents_cached<'a>(
    app_state: &AppState,
    file_id: &Uuid,
    file_storage: &FileStorage,
    file_storage_path: &str,
    sharepoint_ctx: Option<&SharepointContext<'a>>,
) -> Result<String, Report> {
    let file_id_str = file_id.to_string();
    let span = tracing::Span::current();
    span.record("file_id", &file_id_str);
    span.record("file_storage_path", file_storage_path);

    // First check the parsed content cache
    let result = app_state
        .file_contents_cache
        .try_get_with_by_ref(file_id, async {
            tracing::debug!(file_id = %file_id, "Parsed content cache miss");

            // Get raw bytes (might be cached at byte level)
            let file_bytes = get_file_bytes_cached(
                app_state,
                file_id,
                file_storage,
                file_storage_path,
                sharepoint_ctx,
            )
            .await?;

            span.record("file_bytes_length", file_bytes.len());

            // Parse the file using the configured file processor
            let parsed_content = parse_file(app_state.file_processor.as_ref(), file_bytes).await?;
            let content = remove_null_characters(&parsed_content);

            tracing::debug!(
                file_id = %file_id,
                content_len = content.len(),
                "File parsed and cached"
            );

            Ok::<_, Report>(content)
        })
        .await
        .map_err(|arc_err| Arc::try_unwrap(arc_err).unwrap_or_else(|arc| eyre::eyre!("{}", arc)))?;

    span.record("content_length", result.len());
    Ok(result)
}

/// Get file contents (text or image) with auto-detection and unified caching.
///
/// This is the new unified entry point that:
/// - Auto-detects file type from filename
/// - Routes to appropriate caching strategy
/// - Returns unified FileContentsForGeneration
///
/// This function is boxed to reduce stack usage.
#[instrument(
    skip_all,
    fields(
        file_id = %file_id,
        filename = tracing::field::Empty,
        file_type = tracing::field::Empty,
    )
)]
pub fn get_file_cached<'a>(
    app_state: &'a AppState,
    file_id: &'a Uuid,
    file_storage: &'a FileStorage,
    file_storage_path: &'a str,
    filename: &'a str,
    sharepoint_ctx: Option<&'a SharepointContext<'a>>,
) -> std::pin::Pin<
    Box<dyn std::future::Future<Output = Result<FileContentsForGeneration, Report>> + Send + 'a>,
> {
    Box::pin(async move {
        let span = tracing::Span::current();
        span.record("filename", filename);

        let is_image = is_image_file(filename);
        span.record("file_type", if is_image { "image" } else { "text" });

        if is_image {
            // Image path: cache raw bytes only
            tracing::debug!(
                file_id = %file_id,
                filename = %filename,
                "Processing as image file"
            );

            let raw_bytes = get_file_bytes_cached(
                app_state,
                file_id,
                file_storage,
                file_storage_path,
                sharepoint_ctx,
            )
            .await?;

            let mime_type = get_mime_type_from_extension(filename);

            tracing::debug!(
                file_id = %file_id,
                filename = %filename,
                bytes_len = raw_bytes.len(),
                mime_type = %mime_type,
                "Image file loaded (cached as raw bytes)"
            );

            Ok(FileContentsForGeneration {
                id: *file_id,
                filename: filename.to_string(),
                content: FileContent::Image {
                    raw_bytes,
                    mime_type,
                },
            })
        } else {
            // Text path: cache both bytes and parsed content
            tracing::debug!(
                file_id = %file_id,
                filename = %filename,
                "Processing as text file"
            );

            let text = get_file_contents_cached(
                app_state,
                file_id,
                file_storage,
                file_storage_path,
                sharepoint_ctx,
            )
            .await?;

            tracing::debug!(
                file_id = %file_id,
                filename = %filename,
                text_len = text.len(),
                "Text file loaded and parsed"
            );

            Ok(FileContentsForGeneration {
                id: *file_id,
                filename: filename.to_string(),
                content: FileContent::Text(text),
            })
        }
    })
}

/// Get token count from cache or calculate
#[instrument(
    skip_all,
    fields(
        content_length = tracing::field::Empty,
        token_count = tracing::field::Empty,
    )
)]
pub async fn get_token_count_cached(app_state: &AppState, content: &str) -> Result<usize, Report> {
    let span = tracing::Span::current();
    let content_len = content.len();
    span.record("content_length", content_len);

    // Use try_get_with_by_ref to ensure concurrent requests for the same content
    // are deduplicated into a single tokenization operation
    let token_count = app_state
        .token_count_cache
        .try_get_with_by_ref(content, async move {
            tracing::debug!(
                content_len = content_len,
                "Token count cache miss - calculating"
            );

            // Calculate token count
            let content_owned = content.to_string();
            let token_count = tokio::task::spawn_blocking(move || {
                let bpe = o200k_base()
                    .map_err(|err| eyre::eyre!("Failed to initialize tokenizer: {}", err))?;
                Ok::<_, Report>(bpe.encode_with_special_tokens(&content_owned).len())
            })
            .instrument(tracing::trace_span!("tokenize_content"))
            .await
            .wrap_err("Tokenization task panicked")??;

            tracing::debug!(
                content_len = content_len,
                token_count = token_count,
                "Token count calculated and cached"
            );

            Ok::<_, Report>(token_count)
        })
        .await
        .map_err(|arc_err| {
            // Try to unwrap the Arc, or create a new error with the same message
            Arc::try_unwrap(arc_err).unwrap_or_else(|arc| eyre::eyre!("{}", arc))
        })?;

    span.record("token_count", token_count);
    Ok(token_count)
}

/// Process a single file and return its contents (with caching).
///
/// Now uses the unified get_file_cached function.
/// This function is boxed to reduce stack usage.
#[instrument(
    skip_all,
    fields(
        file_id = tracing::field::Empty,
        filename = tracing::field::Empty,
        file_storage_provider_id = tracing::field::Empty,
        file_type = tracing::field::Empty,
        error = tracing::field::Empty,
    )
)]
pub fn process_single_file_cached<'a>(
    app_state: &'a AppState,
    _policy: &'a PolicyEngine,
    me_user: &'a MeProfile,
    file_id: &'a Uuid,
    sharepoint_ctx: Option<&'a SharepointContext<'a>>,
) -> std::pin::Pin<
    Box<
        dyn std::future::Future<Output = Result<Option<FileContentsForGeneration>, Report>>
            + Send
            + 'a,
    >,
> {
    Box::pin(async move {
        let file_id_str = file_id.to_string();
        let span = tracing::Span::current();
        span.record("file_id", &file_id_str);

        // NOTE: Intentionally skipping authorization checks for token estimation.
        // TODO: Re-introduce authorization once per-file ownership is implemented.
        let _ = me_user; // Keep parameter for API compatibility and future auth checks.
        let file_upload = FileUploads::find_by_id(*file_id)
            .one(&app_state.db)
            .await
            .wrap_err(format!("Failed to query file upload with ID {}", file_id))?
            .wrap_err(format!("File upload not found for ID {}", file_id))?;

        span.record("filename", &file_upload.filename);
        span.record(
            "file_storage_provider_id",
            &file_upload.file_storage_provider_id,
        );

        // Get the file storage provider
        let file_storage = app_state
            .file_storage_providers
            .get(&file_upload.file_storage_provider_id)
            .ok_or_eyre(format!(
                "File storage provider not found: {}",
                file_upload.file_storage_provider_id
            ))?;

        // Use unified caching function
        match get_file_cached(
            app_state,
            file_id,
            file_storage,
            &file_upload.file_storage_path,
            &file_upload.filename,
            sharepoint_ctx,
        )
        .await
        {
            Ok(file_contents) => {
                let file_type = match &file_contents.content {
                    FileContent::Text(t) => {
                        span.record("file_type", "text");
                        format!("text ({} chars)", t.len())
                    }
                    FileContent::Image {
                        raw_bytes,
                        mime_type,
                    } => {
                        span.record("file_type", "image");
                        format!("image ({} bytes, {})", raw_bytes.len(), mime_type)
                    }
                };

                tracing::debug!(
                    file_id = %file_id,
                    filename = %file_upload.filename,
                    file_type = %file_type,
                    "Successfully processed file"
                );

                Ok(Some(file_contents))
            }
            Err(err) => {
                tracing::warn!(
                    file_id = %file_id,
                    filename = %file_upload.filename,
                    error = %err,
                    "Failed to process file - returning None"
                );
                span.record("error", true);

                // On error, return None instead of placeholder
                // Caller decides how to handle missing files
                Ok(None)
            }
        }
    })
}

/// Process multiple files in parallel with caching.
///
/// This function is boxed to reduce stack usage, as it has a deep async call chain.
#[instrument(
    skip_all,
    fields(
        num_files = tracing::field::Empty,
        successful_files = tracing::field::Empty,
        failed_files = tracing::field::Empty,
        had_error = tracing::field::Empty,
    )
)]
pub fn process_files_parallel_cached<'a>(
    app_state: &'a AppState,
    policy: &'a PolicyEngine,
    me_user: &'a MeProfile,
    file_ids: &'a [Uuid],
    sharepoint_ctx: Option<SharepointContext<'a>>,
) -> std::pin::Pin<
    Box<
        dyn std::future::Future<Output = Result<Vec<FileContentsForGeneration>, Report>>
            + Send
            + 'a,
    >,
> {
    Box::pin(async move {
        let span = tracing::Span::current();
        span.record("num_files", file_ids.len());
        tracing::debug!(num_files = file_ids.len(), "Processing files in parallel");

        // Process all files in parallel
        let futures = file_ids.iter().map(|file_id| {
            let sharepoint_ctx_ref = sharepoint_ctx.as_ref();
            process_single_file_cached(app_state, policy, me_user, file_id, sharepoint_ctx_ref)
        });

        let results = futures::future::join_all(futures).await;

        // Collect all results (including files that had parsing errors)
        let mut converted_files = vec![];

        for result in results {
            match result {
                Ok(Some(file_contents)) => converted_files.push(file_contents),
                Ok(None) => {
                    // This should not happen anymore, but keep for safety
                    tracing::warn!("Unexpected None result from file processing");
                }
                Err(err) => {
                    span.record("successful_files", converted_files.len());
                    span.record("had_error", true);
                    tracing::error!(error = %err, "Error processing file");
                    return Err(err);
                }
            }
        }

        span.record("successful_files", converted_files.len());

        tracing::debug!(
            num_files = file_ids.len(),
            processed = converted_files.len(),
            "Completed parallel file processing"
        );

        Ok(converted_files)
    })
}
