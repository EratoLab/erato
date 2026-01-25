use crate::models::file_upload::get_file_upload_by_id;
use crate::policy::engine::PolicyEngine;
use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use crate::server::api::v1beta::message_streaming::{
    FileContentsForGeneration, remove_null_characters,
};
use crate::services::file_parsing::parse_file;
use crate::services::file_storage::{FileStorage, SharepointContext};
use crate::state::AppState;
use eyre::{OptionExt, Report, WrapErr};
use sea_orm::prelude::Uuid;
use std::sync::Arc;
use tiktoken_rs::o200k_base;
use tracing::{Instrument, instrument};

/// Get file contents from cache or fetch/parse
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

    // Use try_get_with_by_ref to ensure concurrent requests for the same file_id
    // are deduplicated into a single fetch/parse operation
    let result = app_state.file_contents_cache
        .try_get_with_by_ref(file_id, async {
            tracing::debug!(file_id = %file_id, "File contents cache miss - fetching");

            // Fetch and parse the file
            let file_bytes = file_storage
                .read_file_to_bytes_with_context(file_storage_path, sharepoint_ctx)
                .await
                .wrap_err(format!("Failed to read file from storage: {}", file_storage_path))?;

            span.record("file_bytes_length", file_bytes.len());
            tracing::debug!(file_id = %file_id, bytes_len = file_bytes.len(), "File bytes read from storage");

            // Parse the file using the configured file processor
            let parsed_content = parse_file(app_state.file_processor.as_ref(), file_bytes).await?;
            let content = remove_null_characters(&parsed_content);

            tracing::debug!(file_id = %file_id, content_len = content.len(), "File parsed and cached");

            Ok::<_, Report>(content)
        })
        .await
        .map_err(|arc_err| {
            // Try to unwrap the Arc, or create a new error with the same message
            Arc::try_unwrap(arc_err).unwrap_or_else(|arc| eyre::eyre!("{}", arc))
        })?;

    span.record("content_length", result.len());
    Ok(result)
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

/// Process a single file and return its contents (with caching)
#[instrument(
    skip_all,
    fields(
        file_id = tracing::field::Empty,
        filename = tracing::field::Empty,
        file_storage_provider_id = tracing::field::Empty,
        text_length = tracing::field::Empty,
        error = tracing::field::Empty,
    )
)]
pub async fn process_single_file_cached<'a>(
    app_state: &AppState,
    policy: &PolicyEngine,
    me_user: &MeProfile,
    file_id: &Uuid,
    sharepoint_ctx: Option<&SharepointContext<'a>>,
) -> Result<Option<FileContentsForGeneration>, Report> {
    let file_id_str = file_id.to_string();
    let span = tracing::Span::current();
    span.record("file_id", &file_id_str);

    // Get the file upload record
    let file_upload = get_file_upload_by_id(&app_state.db, policy, &me_user.to_subject(), file_id)
        .await
        .wrap_err(format!("Failed to get file upload with ID {}", file_id))?;

    span.record("filename", &file_upload.filename);
    span.record(
        "file_storage_provider_id",
        &file_upload.file_storage_provider_id,
    );
    tracing::debug!(
        file_id = %file_id,
        filename = %file_upload.filename,
        "Retrieved file upload record"
    );

    // Get the file storage provider
    let file_storage = app_state
        .file_storage_providers
        .get(&file_upload.file_storage_provider_id)
        .ok_or_eyre(format!(
            "File storage provider not found: {}",
            file_upload.file_storage_provider_id
        ))?;

    // Get file contents using cache
    match get_file_contents_cached(
        app_state,
        file_id,
        file_storage,
        &file_upload.file_storage_path,
        sharepoint_ctx,
    )
    .await
    {
        Ok(text) => {
            span.record("text_length", text.len());
            tracing::debug!(
                file_id = %file_id,
                filename = %file_upload.filename,
                text_len = text.len(),
                "Successfully processed file"
            );
            Ok(Some(FileContentsForGeneration {
                id: *file_id,
                filename: file_upload.filename,
                contents_as_text: text,
            }))
        }
        Err(err) => {
            tracing::warn!(
                file_id = %file_id,
                filename = %file_upload.filename,
                error = %err,
                "Failed to process file - returning placeholder"
            );
            span.record("error", true);
            // Return file info even on error so it gets added as a pointer
            // The actual error handling happens in resolve_file_pointers_in_generation_input
            Ok(Some(FileContentsForGeneration {
                id: *file_id,
                filename: file_upload.filename,
                contents_as_text: String::new(), // Empty content - won't be used for pointers
            }))
        }
    }
}

/// Process multiple files in parallel with caching
#[instrument(
    skip_all,
    fields(
        num_files = tracing::field::Empty,
        successful_files = tracing::field::Empty,
        failed_files = tracing::field::Empty,
        had_error = tracing::field::Empty,
    )
)]
pub async fn process_files_parallel_cached<'a>(
    app_state: &AppState,
    policy: &PolicyEngine,
    me_user: &MeProfile,
    file_ids: &[Uuid],
    sharepoint_ctx: Option<SharepointContext<'a>>,
) -> Result<Vec<FileContentsForGeneration>, Report> {
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
}
