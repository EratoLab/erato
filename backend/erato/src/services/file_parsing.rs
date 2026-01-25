use crate::services::file_processor::FileProcessor;
use eyre::Report;
use tracing::instrument;

#[instrument(skip_all)]
pub async fn parse_file(
    file_processor: &dyn FileProcessor,
    file_bytes: Vec<u8>,
) -> Result<String, Report> {
    file_processor.parse_file(file_bytes).await
}
