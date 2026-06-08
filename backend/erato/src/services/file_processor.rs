use async_trait::async_trait;
use base64::{Engine as _, engine::general_purpose};
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

fn is_message_rfc822_mime_type(mime_type: &str) -> bool {
    mime_type.eq_ignore_ascii_case("message/rfc822")
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

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn split_mime_headers_body(entity: &[u8]) -> (&[u8], &[u8]) {
    if let Some(index) = find_subslice(entity, b"\r\n\r\n") {
        return (&entity[..index], &entity[index + 4..]);
    }

    if let Some(index) = find_subslice(entity, b"\n\n") {
        return (&entity[..index], &entity[index + 2..]);
    }

    (entity, &[])
}

fn parse_mime_headers(headers: &[u8]) -> Vec<(String, String)> {
    let header_text = String::from_utf8_lossy(headers);
    let mut unfolded = Vec::new();
    let mut current = String::new();

    for line in header_text.replace("\r\n", "\n").split('\n') {
        if line.starts_with(' ') || line.starts_with('\t') {
            if !current.is_empty() {
                current.push(' ');
            }
            current.push_str(line.trim());
            continue;
        }

        if !current.is_empty() {
            unfolded.push(current);
        }
        current = line.trim_end_matches('\r').to_string();
    }

    if !current.is_empty() {
        unfolded.push(current);
    }

    unfolded
        .into_iter()
        .filter_map(|line| {
            let (name, value) = line.split_once(':')?;
            Some((name.trim().to_ascii_lowercase(), value.trim().to_string()))
        })
        .collect()
}

fn header_value<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|(header_name, _)| header_name.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.as_str())
}

fn content_type_essence_and_param(
    content_type: &str,
    param_name: &str,
) -> (String, Option<String>) {
    let mut parts = content_type.split(';');
    let essence = parts
        .next()
        .unwrap_or(content_type)
        .trim()
        .to_ascii_lowercase();

    let param_name = param_name.to_ascii_lowercase();
    let param_value = parts.find_map(|part| {
        let (name, value) = part.split_once('=')?;
        if !name.trim().eq_ignore_ascii_case(&param_name) {
            return None;
        }

        Some(value.trim().trim_matches('"').to_string())
    });

    (essence, param_value)
}

fn content_disposition_essence(content_disposition: Option<&str>) -> String {
    content_disposition
        .and_then(|value| value.split(';').next())
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
}

fn decode_hex_digit(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn decode_quoted_printable(input: &[u8]) -> Vec<u8> {
    let mut output = Vec::with_capacity(input.len());
    let mut index = 0;

    while index < input.len() {
        if input[index] != b'=' {
            output.push(input[index]);
            index += 1;
            continue;
        }

        if input.get(index + 1) == Some(&b'\r') && input.get(index + 2) == Some(&b'\n') {
            index += 3;
            continue;
        }

        if input.get(index + 1) == Some(&b'\n') {
            index += 2;
            continue;
        }

        if let (Some(high), Some(low)) = (input.get(index + 1), input.get(index + 2))
            && let (Some(high), Some(low)) = (decode_hex_digit(*high), decode_hex_digit(*low))
        {
            output.push((high << 4) | low);
            index += 3;
            continue;
        }

        output.push(input[index]);
        index += 1;
    }

    output
}

fn decode_mime_body(body: &[u8], transfer_encoding: Option<&str>) -> Vec<u8> {
    match transfer_encoding
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "base64" => {
            let compact = body
                .iter()
                .copied()
                .filter(|byte| !byte.is_ascii_whitespace())
                .collect::<Vec<_>>();
            general_purpose::STANDARD
                .decode(compact)
                .unwrap_or_else(|_| body.to_vec())
        }
        "quoted-printable" => decode_quoted_printable(body),
        _ => body.to_vec(),
    }
}

fn normalize_plain_text(text: &str) -> String {
    text.replace("\r\n", "\n")
        .replace('\r', "\n")
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
}

fn split_multipart_body<'a>(body: &'a [u8], boundary: &str) -> Vec<&'a [u8]> {
    let delimiter = format!("--{boundary}");
    let delimiter_bytes = delimiter.as_bytes();
    let closing_delimiter = format!("{delimiter}--");
    let closing_delimiter_bytes = closing_delimiter.as_bytes();
    let mut parts = Vec::new();
    let mut current_part_start = None;
    let mut line_start = 0;

    while line_start <= body.len() {
        let line_end_with_newline = body[line_start..]
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(body.len(), |offset| line_start + offset + 1);
        let mut line_end = line_end_with_newline;
        if line_end > line_start && body[line_end - 1] == b'\n' {
            line_end -= 1;
        }
        if line_end > line_start && body[line_end - 1] == b'\r' {
            line_end -= 1;
        }

        let line = &body[line_start..line_end];
        if line == delimiter_bytes || line == closing_delimiter_bytes {
            if let Some(part_start) = current_part_start.take() {
                parts.push(&body[part_start..line_start]);
            }

            if line == closing_delimiter_bytes {
                break;
            }

            current_part_start = Some(line_end_with_newline);
        }

        if line_end_with_newline == body.len() {
            break;
        }
        line_start = line_end_with_newline;
    }

    parts
}

fn collect_email_plain_text_parts(entity: &[u8], output: &mut Vec<String>) {
    let (headers, body) = split_mime_headers_body(entity);
    let headers = parse_mime_headers(headers);
    let content_type = header_value(&headers, "content-type").unwrap_or("text/plain");
    let (content_type_essence, boundary) = content_type_essence_and_param(content_type, "boundary");
    let transfer_encoding = header_value(&headers, "content-transfer-encoding");
    let content_disposition =
        content_disposition_essence(header_value(&headers, "content-disposition"));

    if content_type_essence.starts_with("multipart/") {
        if let Some(boundary) = boundary {
            for part in split_multipart_body(body, &boundary) {
                collect_email_plain_text_parts(part, output);
            }
        }
        return;
    }

    let decoded_body = decode_mime_body(body, transfer_encoding);

    if content_type_essence == "message/rfc822" {
        collect_email_plain_text_parts(&decoded_body, output);
        return;
    }

    if content_type_essence == "text/plain" && content_disposition != "attachment" {
        let text = normalize_plain_text(&String::from_utf8_lossy(&decoded_body));
        if !text.trim().is_empty() {
            output.push(text);
        }
    }
}

fn extract_email_plain_text(file_bytes: &[u8]) -> Option<String> {
    let mut parts = Vec::new();
    collect_email_plain_text_parts(file_bytes, &mut parts);

    let plain_text = parts
        .into_iter()
        .map(|part| part.trim().to_string())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");

    if plain_text.is_empty() {
        None
    } else {
        Some(plain_text)
    }
}

fn content_already_contains_plain_text(content: &str, plain_text: &str) -> bool {
    if content.contains(plain_text.trim()) {
        return true;
    }

    plain_text
        .lines()
        .map(str::trim)
        .filter(|line| line.chars().filter(|char| !char.is_whitespace()).count() >= 24)
        .any(|line| content.contains(line))
}

fn append_email_plain_text_if_missing(content: &mut String, plain_text: Option<String>) {
    let Some(plain_text) = plain_text else {
        return;
    };

    if content_already_contains_plain_text(content, &plain_text) {
        return;
    }

    if !content.trim_end().is_empty() {
        content.push_str("\n\n");
    }
    content.push_str("## Email plain text body\n\n");
    content.push_str(plain_text.trim());
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
                let email_plain_text = if is_message_rfc822_mime_type(&mime_type) {
                    extract_email_plain_text(&file_bytes)
                } else {
                    None
                };

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
                append_email_plain_text_if_missing(&mut content, email_plain_text);

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

    #[test]
    fn test_email_plain_text_supplement_decodes_quoted_printable_soft_breaks() {
        let eml_bytes = br#"From: Microsoft 365 Message center <o365mc@microsoft.com>
To: fms@maxgoisser.onmicrosoft.com
Subject: Weekly digest: Microsoft service updates
MIME-Version: 1.0
Content-Type: multipart/alternative; boundary="digest-boundary"

--digest-boundary
Content-Type: text/plain; charset=utf-8
Content-Transfer-Encoding: quoted-printable

(Updated) Microsoft Teams: AI meeting recap without transcript to meet comp=
liance policies

--digest-boundary
Content-Type: text/html; charset=utf-8

<html><body><h1>Weekly digest: Microsoft service updates</h1></body></html>

--digest-boundary--
"#;

        let plain_text =
            extract_email_plain_text(eml_bytes).expect("expected decoded plain-text body");
        assert!(plain_text.contains(
            "(Updated) Microsoft Teams: AI meeting recap without transcript to meet compliance policies"
        ));

        let mut kreuzberg_content =
            "Weekly digest: Microsoft service updates\n\nView a summary of the updates."
                .to_string();
        append_email_plain_text_if_missing(&mut kreuzberg_content, Some(plain_text));

        assert!(kreuzberg_content.contains("## Email plain text body"));
        assert!(kreuzberg_content.contains(
            "(Updated) Microsoft Teams: AI meeting recap without transcript to meet compliance policies"
        ));
    }

    #[tokio::test]
    async fn test_kreuzberg_extracts_nested_rfc822_thread_bundle() {
        let eml_bytes = read_test_fixture("synthesized_thread_bundle.eml");

        let processor = KreuzbergProcessor;
        let extracted = processor
            .parse_file(eml_bytes, Some("message/rfc822"))
            .await
            .expect("Failed to extract text from synthesized thread bundle");

        // Both nested message bodies should appear — proves kreuzberg recurses
        // into the message/rfc822 parts of a multipart/mixed wrapper. Mirrors
        // the shape `synthesizeThreadEml` emits in the office add-in.
        assert!(
            extracted.contains("FIRST_MESSAGE_UNIQUE_BODY_TOKEN_alpha"),
            "missing first nested-message body in:\n{extracted}"
        );
        assert!(
            extracted.contains("SECOND_MESSAGE_UNIQUE_BODY_TOKEN_beta"),
            "missing second nested-message body in:\n{extracted}"
        );

        // The attachment lives inside the second nested message; its content
        // and ## Attachment header should both appear. Confirms grandchild
        // attachments survive the double recursion.
        assert!(
            extracted.contains("INNER_ATTACHMENT_UNIQUE_TOKEN_gamma"),
            "missing inner-attachment content in:\n{extracted}"
        );
        assert!(
            extracted.contains("thread_notes.txt"),
            "missing inner-attachment filename in:\n{extracted}"
        );
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
