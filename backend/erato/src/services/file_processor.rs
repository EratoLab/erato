use async_trait::async_trait;
use eyre::{Context, Report};
use kreuzberg::detect_mime_type_from_bytes;
use std::sync::Arc;
use tracing::Instrument;

/// Trait for file processors that extract text content from file bytes
#[async_trait]
pub trait FileProcessor: Send + Sync {
    async fn parse_file(
        &self,
        file_bytes: Vec<u8>,
        filename: Option<&str>,
    ) -> Result<String, Report>;
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

fn mime_type_override_for_filename(filename: &str) -> Option<&'static str> {
    match filename
        .rsplit('.')
        .next()
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("eml") => Some("message/rfc822"),
        _ => None,
    }
}

#[async_trait]
impl FileProcessor for KreuzbergProcessor {
    async fn parse_file(
        &self,
        file_bytes: Vec<u8>,
        filename: Option<&str>,
    ) -> Result<String, Report> {
        let filename = filename.map(str::to_owned);
        Ok(
            tokio::task::spawn_blocking(move || -> Result<String, Report> {
                // Check if the file is an image using magic number detection
                if infer::is_image(&file_bytes) {
                    tracing::debug!("Skipping OCR/text extraction for image file");
                    return Ok(String::new());
                }

                let mut mime_type = if let Some(filename) = filename.as_deref() {
                    if let Some(mime_type) = mime_type_override_for_filename(filename) {
                        tracing::debug!(
                            filename = %filename,
                            mime_type = %mime_type,
                            "Overriding MIME type from filename"
                        );
                        mime_type.to_string()
                    } else {
                        let mut mime_type = detect_mime_type_from_bytes(&file_bytes)?;
                        tracing::debug!("Detected MIME type from bytes: {:?}", &mime_type);
                        if matches!(
                            mime_type.as_str(),
                            "application/zip" | "application/x-zip-compressed"
                        ) && looks_like_docx(&file_bytes)
                        {
                            mime_type = kreuzberg::DOCX_MIME_TYPE.to_string();
                        }
                        mime_type
                    }
                } else {
                    let mut mime_type = detect_mime_type_from_bytes(&file_bytes)?;
                    tracing::debug!("Detected MIME type from bytes: {:?}", &mime_type);
                    if matches!(
                        mime_type.as_str(),
                        "application/zip" | "application/x-zip-compressed"
                    ) && looks_like_docx(&file_bytes)
                    {
                        mime_type = kreuzberg::DOCX_MIME_TYPE.to_string();
                    }
                    mime_type
                };

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
    use std::fs;
    use std::path::PathBuf;

    fn read_test_fixture(filename: &str) -> Vec<u8> {
        let fixture_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/integration_tests/test_files")
            .join(filename);

        fs::read(&fixture_path).unwrap_or_else(|_| panic!("Failed to read fixture {}", filename))
    }

    #[test]
    fn test_create_file_processor() {
        let processor = create_file_processor("kreuzberg");
        assert!(processor.is_ok());
    }

    #[tokio::test]
    async fn test_kreuzberg_extracts_page_markers_from_compressed_pdf() {
        let fixture_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/integration_tests/test_files/sample-report-compressed.pdf");
        let pdf_bytes = fs::read(&fixture_path).expect("Failed to read PDF fixture");

        let processor = KreuzbergProcessor;
        let extracted = processor
            .parse_file(pdf_bytes, Some("sample-report-compressed.pdf"))
            .await
            .expect("Failed to extract text from PDF");

        assert!(
            extracted.contains("<page number=\""),
            "Expected page marker in extracted text, but none was found"
        );
    }

    #[tokio::test]
    async fn test_kreuzberg_extracts_structured_content_from_eml_with_attachment() {
        let eml_bytes = read_test_fixture("please_review_attached_draft.eml");

        let processor = KreuzbergProcessor;
        let extracted = processor
            .parse_file(eml_bytes, Some("please_review_attached_draft.eml"))
            .await
            .expect("Failed to extract text from EML fixture");

        assert!(extracted.contains("Subject: Please review attached draft"));
        assert!(extracted.contains("From: daniel@eratolabs.com"));
        assert!(extracted.contains("To: testuser@maxgoisser.onmicrosoft.com"));
        assert!(extracted.contains(
            "could you please take a quick look at the attached draft document and let me know whether it looks fine from your side."
        ));
        assert!(extracted.contains("Attachments: internal_review_test_attachment.pdf"));
    }

    #[tokio::test]
    async fn test_kreuzberg_extracts_structured_content_from_eml_reply_thread() {
        let eml_bytes = read_test_fixture("re_another_doc_you_have_to_check.eml");

        let processor = KreuzbergProcessor;
        let extracted = processor
            .parse_file(eml_bytes, Some("re_another_doc_you_have_to_check.eml"))
            .await
            .expect("Failed to extract text from EML reply fixture");

        assert!(extracted.contains("Subject: Re: Another doc you have to check"));
        assert!(extracted.contains("From: daniel@eratolabs.com"));
        assert!(extracted.contains("To: testuser@maxgoisser.onmicrosoft.com"));
        assert!(
            extracted.contains("I am referring to the PDF draft I attached to my previous email.")
        );
        assert!(extracted.contains(
            "Please let me know if you have any specific questions or if you cannot see the attachment."
        ));
    }
}
