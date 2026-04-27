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
        mime_type: Option<&str>,
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

fn normalize_mime_type(mime_type: &str) -> String {
    mime_type
        .split(';')
        .next()
        .unwrap_or(mime_type)
        .trim()
        .to_ascii_lowercase()
}

fn detect_mime_type(file_bytes: &[u8]) -> Result<String, Report> {
    let mut mime_type = detect_mime_type_from_bytes(file_bytes)?;
    tracing::debug!("Detected MIME type from bytes: {:?}", &mime_type);
    if matches!(
        mime_type.as_str(),
        "application/zip" | "application/x-zip-compressed"
    ) && looks_like_docx(file_bytes)
    {
        mime_type = kreuzberg::DOCX_MIME_TYPE.to_string();
    }
    Ok(mime_type)
}

fn append_extraction_children(
    content: &mut String,
    children: Option<Vec<kreuzberg::ArchiveEntry>>,
) {
    let Some(children) = children else {
        return;
    };

    for child in children {
        if !content.trim_end().is_empty() {
            content.push_str("\n\n");
        }

        content.push_str(&format!(
            "## Attachment: {}\n\nMIME type: {}\n\n",
            child.path, child.mime_type
        ));
        content.push_str(child.result.content.trim());

        append_extraction_children(content, child.result.children);
    }
}

fn content_with_page_markers(
    content: String,
    pages: Option<Vec<kreuzberg::PageContent>>,
    marker_format: &str,
) -> String {
    if marker_format.contains("{page_num}") {
        let marker_probe = marker_format.replace("{page_num}", "1");
        if content.contains(&marker_probe) {
            return content;
        }

        let escaped_marker_probe = marker_probe.replace('<', "\\<").replace('>', "\\>");
        if content.contains(&escaped_marker_probe) {
            return content;
        }
    }

    let marker_placeholder = marker_format.replace("{page_num}", "");
    if marker_placeholder.is_empty() || content.contains(&marker_placeholder) {
        return content;
    }

    let Some(pages) = pages else {
        return content;
    };

    if pages.is_empty() {
        return content;
    }

    let page_marked_content = pages
        .into_iter()
        .filter(|page| !page.content.trim().is_empty())
        .map(|page| {
            format!(
                "{}\n{}",
                marker_format.replace("{page_num}", &page.page_number.to_string()),
                page.content.trim()
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    if page_marked_content.is_empty() {
        content
    } else {
        page_marked_content
    }
}

#[async_trait]
impl FileProcessor for KreuzbergProcessor {
    async fn parse_file(
        &self,
        file_bytes: Vec<u8>,
        mime_type: Option<&str>,
    ) -> Result<String, Report> {
        let mime_type = mime_type.map(str::to_owned);
        Ok(
            tokio::task::spawn_blocking(move || -> Result<String, Report> {
                // Check if the file is an image using magic number detection
                if infer::is_image(&file_bytes) {
                    tracing::debug!("Skipping OCR/text extraction for image file");
                    return Ok(String::new());
                }

                let mut mime_type = if let Some(mime_type) = mime_type.as_deref() {
                    tracing::debug!(mime_type = %mime_type, "Using provided MIME type");
                    normalize_mime_type(mime_type)
                } else {
                    detect_mime_type(&file_bytes)?
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
                let marker_format = page_config.marker_format.clone();

                let config = kreuzberg::ExtractionConfig {
                    output_format: kreuzberg::OutputFormat::Markdown,
                    pages: Some(page_config),
                    ..Default::default()
                };

                // Extract content using kreuzberg
                let result = kreuzberg::extract_bytes_sync(&file_bytes, &mime_type, &config)
                    .wrap_err("Kreuzberg extraction failed")?;

                let mut content =
                    content_with_page_markers(result.content, result.pages, &marker_format);
                append_extraction_children(&mut content, result.children);

                Ok(content)
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
            .parse_file(pdf_bytes, None)
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
            .parse_file(eml_bytes, Some("message/rfc822"))
            .await
            .expect("Failed to extract text from EML fixture");

        assert!(extracted.contains("Please review attached draft"));
        assert!(extracted.contains("daniel@eratolabs.com"));
        assert!(extracted.contains("testuser@maxgoisser.onmicrosoft.com"));
        assert!(extracted.contains(
            "could you please take a quick look at the attached draft document and let me know whether it looks fine from your side."
        ));
    }

    #[tokio::test]
    async fn test_kreuzberg_extracts_content_from_eml_pdf_attachment() {
        let eml_bytes = read_test_fixture("email-with-sample-compressed-pdf.eml");

        let processor = KreuzbergProcessor;
        let extracted = processor
            .parse_file(eml_bytes, Some("message/rfc822"))
            .await
            .expect("Failed to extract text from EML fixture with PDF attachment");

        let expected_text = "This sample PDF file is provided by Sample-Files.com";
        if !extracted.contains(expected_text) {
            eprintln!(
                "Expected extracted EML content to contain {:?}, but it did not.\nExtracted content:\n{}",
                expected_text, extracted
            );
        }
        assert!(extracted.contains("## Attachment: sample_compressed.pdf"));
        assert!(extracted.contains(expected_text));
    }

    #[tokio::test]
    async fn test_kreuzberg_extracts_structured_content_from_eml_reply_thread() {
        let eml_bytes = read_test_fixture("re_another_doc_you_have_to_check.eml");

        let processor = KreuzbergProcessor;
        let extracted = processor
            .parse_file(eml_bytes, Some("message/rfc822"))
            .await
            .expect("Failed to extract text from EML reply fixture");

        assert!(extracted.contains("Re: Another doc you have to check"));
        assert!(extracted.contains("daniel@eratolabs.com"));
        assert!(extracted.contains("testuser@maxgoisser.onmicrosoft.com"));
        assert!(
            extracted.contains("I am referring to the PDF draft I attached to my previous email.")
        );
        assert!(extracted.contains(
            "Please let me know if you have any specific questions or if you cannot see the attachment."
        ));
    }

    #[tokio::test]
    async fn test_kreuzberg_extracts_structured_content_from_company_overview_pptx() {
        let pptx_bytes = read_test_fixture("Acme_Inc_Company_Overview.pptx");

        let processor = KreuzbergProcessor;
        let extracted = processor
            .parse_file(
                pptx_bytes,
                Some("application/vnd.openxmlformats-officedocument.presentationml.presentation"),
            )
            .await
            .expect("Failed to extract text from PPTX fixture");

        if !extracted.contains("Alice") || !extracted.contains("Johnson") {
            eprintln!(
                "Expected extracted PPTX content to contain both 'Alice' and 'Johnson', but it did not.\nExtracted content:\n{extracted}",
            );
        }

        assert!(extracted.contains("Alice"));
        assert!(extracted.contains("Johnson"));
    }
}
