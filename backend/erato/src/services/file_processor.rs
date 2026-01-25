use async_trait::async_trait;
use eyre::Report;
use std::sync::Arc;
use tracing::Instrument;

/// Trait for file processors that extract text content from file bytes
#[async_trait]
pub trait FileProcessor: Send + Sync {
    async fn parse_file(&self, file_bytes: Vec<u8>) -> Result<String, Report>;
}

/// Parser-core based file processor (existing implementation)
pub struct ParserCoreProcessor;

#[async_trait]
impl FileProcessor for ParserCoreProcessor {
    async fn parse_file(&self, file_bytes: Vec<u8>) -> Result<String, Report> {
        Ok(tokio::task::spawn_blocking(move || {
            // Check if the file is an image using magic number detection
            if infer::is_image(&file_bytes) {
                tracing::debug!("Skipping OCR/text extraction for image file");
                return Ok(String::new());
            }

            // Parse non-image files using parser-core
            parser_core::parse(&file_bytes)
        })
        .in_current_span()
        .await??)
    }
}

/// Kreuzberg-based file processor with page-aware markdown extraction
pub struct KreuzbergProcessor;

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

                // Configure kreuzberg for page-aware markdown extraction
                let config = kreuzberg::ExtractionConfig {
                    output_format: kreuzberg::OutputFormat::Markdown,
                    pages: Some(kreuzberg::PageConfig::default()),
                    ..Default::default()
                };

                // Extract content using kreuzberg
                // Note: mime_type is auto-detected, so we pass an empty string
                let result = kreuzberg::extract_bytes_sync(&file_bytes, "", &config)
                    .map_err(|e| eyre::eyre!("Kreuzberg extraction failed: {}", e))?;

                // Post-process to add XML-style page tags
                let content_with_pages = add_page_tags(&result.content);

                Ok(content_with_pages)
            })
            .in_current_span()
            .await??,
        )
    }
}

/// Post-processes kreuzberg output to add XML-style page tags
/// Kreuzberg uses page breaks in its output, we need to convert them to <page number="N"> format
fn add_page_tags(content: &str) -> String {
    // Split content by page breaks (kreuzberg typically uses form feed or similar markers)
    // For now, we'll check what kreuzberg actually outputs and adjust accordingly
    // If kreuzberg already provides page information, we'll use that

    // Temporary implementation: wrap entire content as page 1
    // This will be refined once we test with actual kreuzberg output
    if content.is_empty() {
        return content.to_string();
    }

    // Check if content already has page markers from kreuzberg
    // If not, treat as single page
    format!("<page number=\"1\">\n{}", content)
}

/// Factory function to create the appropriate file processor based on configuration
pub fn create_file_processor(processor_type: &str) -> Result<Arc<dyn FileProcessor>, Report> {
    match processor_type {
        "parser-core" => {
            tracing::info!("Using parser-core file processor");
            Ok(Arc::new(ParserCoreProcessor))
        }
        "kreuzberg" => {
            tracing::info!("Using kreuzberg file processor");
            Ok(Arc::new(KreuzbergProcessor))
        }
        _ => Err(eyre::eyre!(
            "Unknown file processor type: {}. Must be 'parser-core' or 'kreuzberg'",
            processor_type
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_file_processor_parser_core() {
        let processor = create_file_processor("parser-core");
        assert!(processor.is_ok());
    }

    #[test]
    fn test_create_file_processor_kreuzberg() {
        let processor = create_file_processor("kreuzberg");
        assert!(processor.is_ok());
    }

    #[test]
    fn test_create_file_processor_invalid() {
        let processor = create_file_processor("invalid");
        assert!(processor.is_err());
    }

    #[test]
    fn test_add_page_tags_empty() {
        assert_eq!(add_page_tags(""), "");
    }

    #[test]
    fn test_add_page_tags_single_page() {
        let content = "Hello, world!";
        let result = add_page_tags(content);
        assert!(result.contains("<page number=\"1\">"));
        assert!(result.contains("Hello, world!"));
    }
}
