use eyre::Report;
use tracing::{Instrument, instrument};

#[instrument(skip_all)]
pub async fn parse_file(file_bytes: Vec<u8>) -> Result<String, Report> {
    Ok(tokio::task::spawn_blocking(move || {
        // Check if the file is an image using magic number detection
        if infer::is_image(&file_bytes) {
            tracing::debug!("Skipping OCR/text extraction for image file");
            return Ok(String::new());
        }

        // Parse non-image files
        parser_core::parse(&file_bytes)
    })
    .in_current_span()
    .await??)
}
