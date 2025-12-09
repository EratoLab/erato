use eyre::Report;
use tracing::{Instrument, instrument};

#[instrument(skip_all)]
pub async fn parse_file(file_bytes: Vec<u8>) -> Result<String, Report> {
    Ok(
        tokio::task::spawn_blocking(move || parser_core::parse(&file_bytes))
            .in_current_span()
            .await??,
    )
}
