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

/// A byte that legitimately follows an HTML tag name (so `<style` is a `<style>` open tag and not
/// the start of a custom element like `<styled-list>`).
fn is_tag_name_boundary(byte: Option<u8>) -> bool {
    matches!(
        byte,
        None | Some(b' ' | b'\t' | b'\r' | b'\n' | b'>' | b'/')
    )
}

/// Find the next `tag` (e.g. `"<style"`) at or after `from` whose tag name actually ends there —
/// i.e. the following byte is a tag-name boundary. Avoids matching `<styled-...>`/`<scripture>`.
fn find_tag_open(lower: &str, from: usize, tag: &str) -> Option<usize> {
    let bytes = lower.as_bytes();
    let mut search = from;
    while let Some(rel) = lower[search..].find(tag) {
        let start = search + rel;
        if is_tag_name_boundary(bytes.get(start + tag.len()).copied()) {
            return Some(start);
        }
        search = start + tag.len();
    }
    None
}

/// Remove `<style>`/`<script>` blocks and HTML comments (which may wrap MSO CSS) from an HTML
/// fragment. kreuzberg's email extractor renders `<style>` block *contents* as text (it drops
/// inline `style=` attributes but keeps style blocks), so a CSS-heavy newsletter leaks tens of
/// thousands of tokens of CSS. Stripping these blocks removes the leak without touching real text.
fn strip_html_style_and_script(html: &str) -> String {
    // `to_ascii_lowercase` preserves byte length and only changes ASCII bytes, so byte offsets
    // found in `lower` map onto valid char boundaries in `html` (the markers are all ASCII).
    let lower = html.to_ascii_lowercase();
    let mut out = String::with_capacity(html.len());
    let mut pos = 0;

    while pos < html.len() {
        let next = [
            find_tag_open(&lower, pos, "<style").map(|start| (start, "</style>")),
            find_tag_open(&lower, pos, "<script").map(|start| (start, "</script>")),
            lower[pos..].find("<!--").map(|rel| (pos + rel, "-->")),
        ]
        .into_iter()
        .flatten()
        .min_by_key(|(start, _)| *start);

        match next {
            None => {
                out.push_str(&html[pos..]);
                break;
            }
            Some((start, close)) => {
                out.push_str(&html[pos..start]);
                match lower[start..].find(close) {
                    // Skip past the close tag. The block (CSS/JS/comment body) is dropped.
                    Some(rel) => pos = start + rel + close.len(),
                    // Unterminated tag: keep the original text from here so we never lose content.
                    None => {
                        out.push_str(&html[start..]);
                        break;
                    }
                }
            }
        }
    }

    out
}

/// Drop `data:` URI payloads from HTML attribute values, keeping the surrounding markup and text.
///
/// kreuzberg's standalone HTML extractor renders `<img src="data:image/png;base64,...">` as the
/// markdown `![alt](data:...)`, so a single inline image (50 KB–500 KB of base64) lands in the
/// extracted text and tokenizes at ~2 chars/token — a token bomb. (The email extractor happens to
/// drop these today, but this guarantees the payload never reaches kreuzberg regardless of which
/// renderer runs, and shrinks the bytes we hand it.) Data URIs in email bodies are never
/// content-bearing text, so removing every `data:` payload is safe.
///
/// Each `data:` occurrence (in `src=`/`background=`/`srcset=`/CSS `url(data:...)`, quoted or not)
/// is truncated to the bare scheme `data:` up to its closing delimiter — the enclosing quote, or
/// whitespace/`)`/`>` when unquoted — so the tag stays structurally valid and no surrounding text
/// is lost.
fn strip_html_data_uris(html: &str) -> String {
    // `to_ascii_lowercase` preserves byte length and only changes ASCII bytes, so byte offsets
    // found in `lower` map onto valid char boundaries in `html` (`data:` and the delimiters are
    // all ASCII).
    let lower = html.to_ascii_lowercase();
    let bytes = html.as_bytes();
    let mut out = String::with_capacity(html.len());
    let mut pos = 0;

    while pos < html.len() {
        let Some(rel) = lower[pos..].find("data:") else {
            out.push_str(&html[pos..]);
            break;
        };
        let scheme_start = pos + rel;
        let payload_start = scheme_start + "data:".len();

        // Keep everything up to and including the bare `data:` scheme, then skip the payload.
        out.push_str(&html[pos..payload_start]);

        // The delimiter that closes the URI depends on how it is embedded. If the byte preceding
        // `data:` is a quote, the payload runs to the matching quote; otherwise it is unquoted and
        // ends at the first whitespace or a `)`/`>` (CSS `url(...)` close, or tag close).
        let opening_quote = bytes[..scheme_start]
            .iter()
            .rev()
            .find(|&&b| b != b' ' && b != b'\t')
            .copied()
            .filter(|&b| b == b'"' || b == b'\'');

        let payload_end = match opening_quote {
            Some(quote) => bytes[payload_start..]
                .iter()
                .position(|&b| b == quote)
                .map(|i| payload_start + i),
            None => bytes[payload_start..]
                .iter()
                .position(|&b| matches!(b, b' ' | b'\t' | b'\r' | b'\n' | b')' | b'>'))
                .map(|i| payload_start + i),
        };

        match payload_end {
            Some(end) => pos = end,
            // No delimiter found: the payload runs to end-of-input. Drop the rest entirely (it is
            // base64, not text) rather than re-emitting the blob.
            None => break,
        }
    }

    out
}

/// Base64-encode bytes as a MIME body wrapped at 76 columns with CRLF line endings.
fn base64_mime_body(data: &[u8]) -> String {
    let encoded = general_purpose::STANDARD.encode(data);
    let mut out = String::with_capacity(encoded.len() + encoded.len() / 76 + 2);
    let mut index = 0;
    while index < encoded.len() {
        let end = (index + 76).min(encoded.len());
        out.push_str(&encoded[index..end]);
        out.push_str("\r\n");
        index = end;
    }
    out
}

/// Rebuild a leaf entity's header block, replacing any Content-Transfer-Encoding with `base64`
/// (the re-emitted body is always base64-encoded for safe, encoding-agnostic transport).
fn headers_with_base64_encoding(raw_headers: &[u8]) -> String {
    let header_text = String::from_utf8_lossy(raw_headers);
    let mut out = String::with_capacity(header_text.len() + 40);
    for line in header_text.replace("\r\n", "\n").split('\n') {
        if line.is_empty() {
            continue;
        }
        let is_transfer_encoding = line.split_once(':').is_some_and(|(name, _)| {
            name.trim()
                .eq_ignore_ascii_case("content-transfer-encoding")
        });
        if is_transfer_encoding {
            continue;
        }
        out.push_str(line.trim_end_matches('\r'));
        out.push_str("\r\n");
    }
    out.push_str("Content-Transfer-Encoding: base64\r\n");
    out
}

/// Walk the MIME tree and rewrite `text/html` parts with their `<style>`/`<script>` blocks removed,
/// leaving every other part byte-identical. Returns the original bytes for non-multipart,
/// non-HTML, or unparseable input. Nested `message/rfc822` parts are treated as opaque.
fn sanitize_email_html_blocks(entity: &[u8]) -> Vec<u8> {
    let (headers_raw, body) = split_mime_headers_body(entity);
    let headers = parse_mime_headers(headers_raw);
    let content_type = header_value(&headers, "content-type").unwrap_or("text/plain");
    let (content_type_essence, boundary) = content_type_essence_and_param(content_type, "boundary");

    if content_type_essence.starts_with("multipart/") {
        let Some(boundary) = boundary else {
            return entity.to_vec();
        };

        let mut rebuilt_body = Vec::new();
        for part in split_multipart_body(body, &boundary) {
            rebuilt_body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
            let mut sanitized_part = sanitize_email_html_blocks(part);
            if !sanitized_part.ends_with(b"\r\n") {
                sanitized_part.extend_from_slice(b"\r\n");
            }
            rebuilt_body.extend_from_slice(&sanitized_part);
        }
        rebuilt_body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());

        let mut out = Vec::with_capacity(headers_raw.len() + rebuilt_body.len() + 4);
        out.extend_from_slice(headers_raw);
        out.extend_from_slice(b"\r\n\r\n");
        out.extend_from_slice(&rebuilt_body);
        return out;
    }

    if content_type_essence == "text/html" {
        // Only rewrite UTF-8/ASCII HTML: decoding other charsets (UTF-16, Latin-1, …) through
        // `from_utf8_lossy` would corrupt the text, so leave those parts untouched. kreuzberg still
        // decodes them itself via the charset header; the CSS leak is overwhelmingly a UTF-8 case.
        let (_, charset) = content_type_essence_and_param(content_type, "charset");
        let is_utf8_or_ascii = charset.as_deref().is_none_or(|charset| {
            matches!(
                charset.to_ascii_lowercase().as_str(),
                "utf-8" | "utf8" | "us-ascii" | "ascii"
            )
        });
        if !is_utf8_or_ascii {
            return entity.to_vec();
        }

        let transfer_encoding = header_value(&headers, "content-transfer-encoding");
        let decoded = decode_mime_body(body, transfer_encoding);
        // Strip `<style>`/`<script>` blocks first, then neutralize any `data:` URI payloads (large
        // inline base64 images) — both are token bombs kreuzberg would otherwise render as text.
        let cleaned = strip_html_data_uris(&strip_html_style_and_script(
            &String::from_utf8_lossy(&decoded),
        ));

        let mut out = headers_with_base64_encoding(headers_raw).into_bytes();
        out.extend_from_slice(b"\r\n");
        out.extend_from_slice(base64_mime_body(cleaned.as_bytes()).as_bytes());
        return out;
    }

    entity.to_vec()
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

                // kreuzberg rejects bare `multipart/*` types ("Unsupported format"), but those are
                // the inner header of an RFC822 message (a `.eml` whose Content-Type is
                // `multipart/alternative`/`multipart/mixed`). Route them through the email
                // extractor instead of failing and falling back to a raw, hugely-inflated count.
                if mime_type.starts_with("multipart/") {
                    mime_type = "message/rfc822".to_string();
                }
                tracing::debug!("Final decided MIME type: {:?}", &mime_type);
                let email_plain_text = if is_message_rfc822_mime_type(&mime_type) {
                    extract_email_plain_text(&file_bytes)
                } else {
                    None
                };

                // For emails, strip `<style>`/`<script>` blocks from HTML parts before extraction:
                // kreuzberg renders style-block contents as text, which otherwise leaks a CSS-heavy
                // newsletter's stylesheet into the token count. Other parts are left untouched.
                let sanitized_email_bytes;
                let did_sanitize = is_message_rfc822_mime_type(&mime_type);
                let extraction_bytes: &[u8] = if did_sanitize {
                    sanitized_email_bytes = sanitize_email_html_blocks(&file_bytes);
                    &sanitized_email_bytes
                } else {
                    &file_bytes
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

                // Extract content using kreuzberg. If HTML sanitization rewrote the email and the
                // rewritten bytes somehow fail to parse, fall back to the original bytes so we never
                // regress a previously-extractable email into a silent drop (a higher token count is
                // strictly better than losing the file).
                let result = match kreuzberg::extract_bytes_sync(extraction_bytes, &mime_type, &config)
                {
                    Ok(result) => result,
                    Err(err) if did_sanitize => {
                        tracing::warn!(
                            error = %err,
                            "Email HTML sanitization produced unparseable output; retrying with original bytes"
                        );
                        kreuzberg::extract_bytes_sync(&file_bytes, &mime_type, &config)
                            .wrap_err("Kreuzberg extraction failed")?
                    }
                    Err(err) => return Err(err).wrap_err("Kreuzberg extraction failed"),
                };

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
    async fn test_kreuzberg_coerces_multipart_alternative_eml_and_strips_css() {
        // A styled newsletter is `multipart/alternative` in its own header, and its HTML body is
        // dominated by inline `style="..."` attributes (the real case: ~600 KB of inline CSS).
        // Clients sometimes forward that inner type verbatim; kreuzberg rejects it
        // ("Unsupported format") and the raw CSS-heavy bytes used to be counted (~600k tokens for
        // ~6k of real text). parse_file must coerce `multipart/*` to `message/rfc822` so the email
        // extractor runs and drops the inline CSS.
        let bloat_cell = "<td style=\"font-family:Helvetica;color:#ff0000;font-size:13px;\
             line-height:18px;padding:8px;border:1px solid #cccccc;CSSSENTINEL:1\"></td>"
            .repeat(400);
        let raw_len_marker = bloat_cell.len();
        let eml = format!(
            "From: News <news@example.com>\r\n\
             To: Recipient <recipient@example.com>\r\n\
             Subject: Weekly digest\r\n\
             MIME-Version: 1.0\r\n\
             Content-Type: multipart/alternative; boundary=\"BOUND\"\r\n\
             \r\n\
             --BOUND\r\n\
             Content-Type: text/plain; charset=utf-8\r\n\
             \r\n\
             Readable digest body marker.\r\n\
             --BOUND\r\n\
             Content-Type: text/html; charset=utf-8\r\n\
             \r\n\
             <html><body><p style=\"color:#ff0000;font-size:13px\">Readable digest body marker.</p>\
             <table>{bloat_cell}</table></body></html>\r\n\
             --BOUND--\r\n"
        );

        let processor = KreuzbergProcessor;
        let extracted = processor
            .parse_file(eml.into_bytes(), Some("multipart/alternative"))
            .await
            .expect("multipart/alternative .eml should be coerced to message/rfc822 and parse");

        assert!(
            extracted.contains("Readable digest body marker."),
            "readable body missing from extracted content:\n{extracted}"
        );
        assert!(
            !extracted.contains("CSSSENTINEL"),
            "inline CSS leaked into extracted content:\n{extracted}"
        );
        assert!(
            extracted.len() < raw_len_marker,
            "extracted content ({} bytes) not smaller than the inline-CSS payload ({} bytes) — \
             the email extractor did not run (raw passthrough)",
            extracted.len(),
            raw_len_marker
        );
    }

    #[tokio::test]
    async fn test_kreuzberg_strips_embedded_data_uri_image_from_eml() {
        // A heavily-embedded inline image — `<img src="data:image/png;base64,...">` with a large
        // base64 payload — is a token bomb: kreuzberg's HTML renderer turns it into `![](data:...)`
        // and the whole blob tokenizes at ~2 chars/token. The sanitizer must drop the payload while
        // keeping the readable body, so the extracted content stays tiny.
        let mut payload = String::new();
        while payload.len() < 200_000 {
            payload.push_str("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ");
        }
        let raw_payload_len = payload.len();
        let eml = format!(
            "From: Sender <sender@example.com>\r\n\
             To: Recipient <recipient@example.com>\r\n\
             Subject: Photo of the week\r\n\
             MIME-Version: 1.0\r\n\
             Content-Type: text/html; charset=utf-8\r\n\
             \r\n\
             <html><body><p>READABLE IMAGE CAPTION MARKER.</p>\
             <img src=\"data:image/png;base64,{payload}\" alt=\"chart\">\
             <p>Trailing readable text.</p></body></html>\r\n"
        );

        let processor = KreuzbergProcessor;
        let extracted = processor
            .parse_file(eml.into_bytes(), Some("message/rfc822"))
            .await
            .expect("email with embedded data-URI image should extract");

        assert!(
            extracted.contains("READABLE IMAGE CAPTION MARKER."),
            "readable body missing from extracted content:\n{extracted}"
        );
        assert!(
            extracted.contains("Trailing readable text."),
            "trailing readable text missing from extracted content:\n{extracted}"
        );
        // The base64 sentinel must be gone — no data-URI payload leaked.
        assert!(
            !extracted.contains("iVBORw0KGgo"),
            "embedded data-URI base64 leaked into extracted content:\n{extracted}"
        );

        // Token count must collapse to the real-content range, far below the raw base64 blob, which
        // alone would tokenize at ~2 chars/token (~100k tokens for this 200 KB payload).
        let bpe = tiktoken_rs::o200k_base().expect("o200k_base tokenizer");
        let tokens = bpe.encode_with_special_tokens(&extracted).len();
        assert!(
            tokens < 200,
            "expected the embedded-image email to reduce to real-content size, got {tokens} tokens \
             ({raw_payload_len} raw base64 bytes)"
        );
    }

    #[test]
    fn strip_html_style_and_script_removes_blocks_but_keeps_content() {
        let cleaned = strip_html_style_and_script(
            "<p>keep me</p><style>.a{color:red}</style><script>alert(1)</script>\
             <!-- comment --><p>also keep</p>",
        );
        assert_eq!(cleaned, "<p>keep me</p><p>also keep</p>");
    }

    #[test]
    fn strip_html_style_and_script_preserves_custom_elements_and_unterminated_tags() {
        // Custom elements that merely start with the tag name must not be treated as style/script.
        assert_eq!(
            strip_html_style_and_script("<styled-list>important</styled-list> tail"),
            "<styled-list>important</styled-list> tail"
        );
        assert_eq!(
            strip_html_style_and_script("before <scripture>verse</scripture> after"),
            "before <scripture>verse</scripture> after"
        );
        // An unterminated <style> must keep the remaining text rather than dropping it.
        assert_eq!(
            strip_html_style_and_script("head <style>.a{color:red} no close and important tail"),
            "head <style>.a{color:red} no close and important tail"
        );
    }

    #[test]
    fn strip_html_data_uris_removes_payload_but_keeps_markup_and_text() {
        // Quoted `src` data URI: the giant base64 goes, the tag structure and surrounding text stay.
        assert_eq!(
            strip_html_data_uris(
                "<p>keep me</p><img src=\"data:image/png;base64,AAAABBBBCCCC\" alt=\"x\"><p>tail</p>"
            ),
            "<p>keep me</p><img src=\"data:\" alt=\"x\"><p>tail</p>"
        );
        // CSS `url(data:...)` (unquoted): payload removed, the `)` and rest of the rule preserved.
        assert_eq!(
            strip_html_data_uris("<div style=\"background:url(data:image/png;base64,ZZZZ)\">hi</div>"),
            "<div style=\"background:url(data:)\">hi</div>"
        );
        // Single-quoted and multiple occurrences in one document.
        assert_eq!(
            strip_html_data_uris(
                "<img src='data:image/gif;base64,QQQQ'><img src='data:image/gif;base64,RRRR'>"
            ),
            "<img src='data:'><img src='data:'>"
        );
        // No data URI: input passes through untouched (and real text is never dropped).
        assert_eq!(
            strip_html_data_uris("<p>plain text, no data here</p>"),
            "<p>plain text, no data here</p>"
        );
    }

    #[tokio::test]
    async fn test_kreuzberg_leaves_non_utf8_html_email_untouched() {
        // A UTF-16 HTML part must not be run through the lossy UTF-8 sanitizer (it would corrupt
        // the text); the sanitizer should leave it for kreuzberg to decode via the charset header.
        let mut body = Vec::new();
        for unit in "<html><body><p>UTF16 body marker works</p></body></html>".encode_utf16() {
            body.extend_from_slice(&unit.to_le_bytes());
        }
        let mut eml = b"From: a@example.com\r\nTo: b@example.com\r\nSubject: utf16\r\n\
            MIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-16\r\n\r\n"
            .to_vec();
        eml.extend_from_slice(&body);

        let processor = KreuzbergProcessor;
        let extracted = processor
            .parse_file(eml, Some("message/rfc822"))
            .await
            .expect("UTF-16 html email should still extract");
        assert!(
            extracted.contains("UTF16 body marker works"),
            "UTF-16 content was corrupted or dropped:\n{extracted}"
        );
    }

    #[tokio::test]
    async fn test_kreuzberg_reduces_production_scale_styled_newsletter_without_leaking() {
        // Production-scale regression: a ~950 KB synthetic Microsoft-style weekly digest
        // (`multipart/alternative`, quoted-printable HTML, a large `<style>` block, hundreds of
        // inline-styled nested tables, MSO conditionals, tracking URLs). The CSS carries a
        // `ZZCSSLEAKZZ` sentinel; the clean text/plain twin carries readable markers. Before the
        // fix this estimated at ~628k tokens (raw passthrough) or errored; with MIME coercion alone
        // it still leaked the `<style>` block (~27.5k tokens, 451 CSS fragments). The HTML
        // sanitizer must drop the CSS while preserving the readable content.
        let eml_bytes = read_test_fixture("styled_newsletter_multipart_alternative.eml");
        let raw_len = eml_bytes.len();
        assert!(
            raw_len > 800_000,
            "fixture unexpectedly small ({raw_len} bytes)"
        );

        let processor = KreuzbergProcessor;
        // The bug case: a client forwards the `.eml`'s own inner `multipart/alternative` type.
        let extracted = processor
            .parse_file(eml_bytes, Some("multipart/alternative"))
            .await
            .expect("styled newsletter should be coerced, sanitized, and parsed");

        // Readable content survives (the text/plain twin is appended when the HTML lacks it).
        for marker in [
            "readable item ONE",
            "readable item TWO",
            "readable item THREE",
        ] {
            assert!(
                extracted.contains(marker),
                "readable marker {marker:?} missing from extracted content"
            );
        }
        // The CSS sentinel must not appear anywhere — no `<style>` leak.
        assert_eq!(
            extracted.matches("ZZCSSLEAKZZ").count(),
            0,
            "CSS leaked from the <style> block into extracted content"
        );

        // Token count must collapse to the real-content range, far below the pre-fix ~27.5k leak.
        let bpe = tiktoken_rs::o200k_base().expect("o200k_base tokenizer");
        let tokens = bpe.encode_with_special_tokens(&extracted).len();
        assert!(
            tokens < 15_000,
            "expected the styled newsletter to reduce to real-content size, got {tokens} tokens \
             ({raw_len} raw bytes)"
        );
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
