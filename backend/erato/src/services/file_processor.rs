use async_trait::async_trait;
use eyre::{Context, Report};
use kreuzberg::detect_mime_type_from_bytes;
use std::sync::Arc;
use tracing::Instrument;

/// Trait for file processors that extract text content from file bytes
#[async_trait]
pub trait FileProcessor: Send + Sync {
    async fn parse_file(&self, file_bytes: Vec<u8>) -> Result<String, Report>;
}

/// Kreuzberg-based file processor with page-aware markdown extraction
pub struct KreuzbergProcessor;

fn looks_like_docx(file_bytes: &[u8]) -> bool {
    const ZIP_HEADER: [u8; 4] = [0x50, 0x4b, 0x03, 0x04];
    if !file_bytes.starts_with(&ZIP_HEADER) {
        return false;
    }

    let needle = b"word/document.xml";
    file_bytes
        .windows(needle.len())
        .any(|window| window == needle)
}

#[async_trait]
impl FileProcessor for KreuzbergProcessor {
    async fn parse_file(&self, file_bytes: Vec<u8>) -> Result<String, Report> {
        Ok(
            tokio::task::spawn_blocking(move || -> Result<String, Report> {
                // Check if the file is an image using magic number detection
                if infer::is_image(&file_bytes) {
                    tracing::debug!("Skipping OCR/text extraction for image file");
                    return Ok(String::new());
                }

                let mut mime_type = detect_mime_type_from_bytes(&file_bytes)?;
                tracing::debug!("Detected MIME type from bytes: {:?}", &mime_type);
                if matches!(
                    mime_type.as_str(),
                    "application/zip" | "application/x-zip-compressed"
                ) && looks_like_docx(&file_bytes)
                {
                    mime_type = kreuzberg::DOCX_MIME_TYPE.to_string();
                }
                tracing::debug!("Final decided MIME type: {:?}", &mime_type);
                // Configure kreuzberg for page-aware markdown extraction
                let page_config = kreuzberg::PageConfig {
                    extract_pages: true,
                    insert_page_markers: true,
                    marker_format: "<page number=\"{page_num}\">".to_string(),
                };

                let config = kreuzberg::ExtractionConfig {
                    output_format: kreuzberg::OutputFormat::Markdown,
                    pages: Some(page_config),
                    ..Default::default()
                };

                // Extract content using kreuzberg
                // Note: mime_type is auto-detected, so we pass an empty string
                let result = kreuzberg::extract_bytes_sync(&file_bytes, &mime_type, &config)
                    .wrap_err("Kreuzberg extraction failed")?;

                Ok(result.content)
            })
            .in_current_span()
            .await??,
        )
    }
}

/// Factory function to create the file processor
/// Now only supports Kreuzberg as parser-core has been deprecated
pub fn create_file_processor(_processor_type: &str) -> Result<Arc<dyn FileProcessor>, Report> {
    tracing::info!("Using kreuzberg file processor");
    Ok(Arc::new(KreuzbergProcessor))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_file_processor() {
        let processor = create_file_processor("kreuzberg");
        assert!(processor.is_ok());
    }
}
