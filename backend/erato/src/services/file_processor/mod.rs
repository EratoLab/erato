use async_trait::async_trait;
use base64::{Engine as _, engine::general_purpose};
use eyre::{Context, Report};
use kreuzberg::detect_mime_type_from_bytes;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tracing::Instrument;

mod calendar_vcard;
use self::calendar_vcard::register_calendar_vcard_extractor;

const DOCX_MIME_TYPE: &str =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const HTML_MIME_TYPE: &str = "text/html";
const PLAIN_TEXT_MIME_TYPE: &str = "text/plain";
const EMAIL_HTML_FALLBACK_MAX_TABLE_CELLS: usize = 1_000_000;

#[derive(Debug)]
struct StepTimer {
    step: &'static str,
    start: Instant,
}

impl StepTimer {
    fn start(step: &'static str) -> Self {
        tracing::trace!(step, "file processing step started");
        Self {
            step,
            start: Instant::now(),
        }
    }

    fn finish(self) -> Duration {
        let elapsed = self.start.elapsed();
        tracing::trace!(
            step = self.step,
            elapsed_ms = elapsed.as_millis(),
            "file processing step finished"
        );
        elapsed
    }
}

#[derive(Debug, Default)]
struct EmailSanitizationStats {
    entities_seen: usize,
    multipart_entities: usize,
    message_rfc822_entities: usize,
    html_entities: usize,
    html_entities_sanitized: usize,
    tnef_entities: usize,
    max_depth_seen: usize,
    decoded_html_bytes: usize,
    sanitized_html_bytes: usize,
    decoded_html_table_cell_tags: usize,
    sanitized_html_table_cell_tags: usize,
    decoded_message_bytes: usize,
    sanitized_message_bytes: usize,
}

#[derive(Debug, Default)]
struct EmailBodyStats {
    entities_seen: usize,
    multipart_entities: usize,
    message_rfc822_entities: usize,
    plain_text_entities: usize,
    html_entities: usize,
    extracted_parts: usize,
    decoded_bytes: usize,
    html_table_cell_tags: usize,
}

#[derive(Debug, Default)]
struct EmailHtmlFallbackExtractionStats {
    html_part_count: usize,
    extraction_attempts: usize,
    extraction_successes: usize,
    extraction_failures: usize,
    extraction_elapsed: Duration,
    normalization_elapsed: Duration,
}

#[derive(Debug, Default)]
struct EmailTnefStats {
    entities_seen: usize,
    multipart_entities: usize,
    message_rfc822_entities: usize,
    tnef_entities: usize,
    decoded_message_bytes: usize,
}

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
        mime_type = DOCX_MIME_TYPE.to_string();
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

fn is_calendar_mime(mime_type: &str) -> bool {
    mime_type == "text/calendar"
}

fn is_vcard_mime(mime_type: &str) -> bool {
    matches!(mime_type, "text/vcard" | "text/x-vcard")
}

fn normalize_kreuzberg_mime(mime_type: &str) -> String {
    let normalized = normalize_mime_type(mime_type);
    if is_calendar_mime(&normalized) || is_vcard_mime(&normalized) {
        PLAIN_TEXT_MIME_TYPE.to_string()
    } else {
        normalized
    }
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

/// Strip zero-width and invisible formatting characters that carry no readable meaning. These are
/// used to obfuscate keywords (`pass\u{200b}word`) — splitting a word so a naive filter misses it
/// while a human/LLM still reads it — and to pad the token count. We remove only true zero-width /
/// invisible-control characters; normal whitespace, legitimate non-ASCII letters, and emoji are
/// left untouched so we never corrupt real content.
///
/// Removed: U+200B ZERO WIDTH SPACE, U+200C ZERO WIDTH NON-JOINER, U+200D ZERO WIDTH JOINER,
/// U+2060 WORD JOINER, U+FEFF ZERO WIDTH NO-BREAK SPACE / BOM, U+00AD SOFT HYPHEN.
fn strip_zero_width_chars(text: &str) -> String {
    if !text.chars().any(is_zero_width_char) {
        return text.to_string();
    }
    text.chars().filter(|ch| !is_zero_width_char(*ch)).collect()
}

/// Whether `ch` is a zero-width / invisible formatting character we strip. See
/// [`strip_zero_width_chars`] for the rationale and the exact set.
fn is_zero_width_char(ch: char) -> bool {
    matches!(
        ch,
        '\u{200B}' | '\u{200C}' | '\u{200D}' | '\u{2060}' | '\u{FEFF}' | '\u{00AD}'
    )
}

/// Minimum number of base64-charset characters in a contiguous run before we elide it. Set high so
/// we never eat real prose, code, short hashes, or a single wrapped line: a 512-char base64 blob is
/// ~384 bytes of binary, far larger than any natural-language token, and tokenizes as pure noise.
const MIN_BASE64_RUN_CHARS: usize = 512;

/// Minimum length of an individual whitespace-separated segment for it to count as part of a base64
/// run. Real base64 is emitted either as one giant contiguous string or as long unbroken lines
/// (64–76 chars per RFC 2045/7468 wrapping); natural-language words are short (~5 chars). A run is
/// only extended across whitespace into the next segment when that segment is itself this long, so
/// a short prose word immediately ends the run — this is what stops a few prose words next to a
/// blob (or a whole paragraph of alphanumeric words) from being absorbed.
const MIN_BASE64_SEGMENT_LEN: usize = 24;

/// Whether `byte` is in the base64 alphabet (`A–Z a–z 0–9 + / =`). `=` is the padding char and is
/// only ever valid base64 trailing, but allowing it mid-run is harmless for detection.
fn is_base64_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'=')
}

/// Replace each PEM-delimited block and each long contiguous base64-ish run with a compact
/// `[base64 data omitted, N chars]` marker. Pasted certificates / keys / image dumps tokenize as
/// huge noise (~2 chars/token), so eliding them is a large token win that loses no readable text.
///
/// Two passes, conservative to avoid false positives on real prose, code, or short tokens:
///   1. PEM blocks: anything between a `-----BEGIN …-----` and the next `-----END …-----` line
///      (RFC 7468 textual encoding) is replaced wholesale — the delimiters mark it as non-prose.
///      Handled first because kreuzberg collapses newlines to spaces in the final content, so the
///      block can arrive either newline- or space-separated; matching on the literal delimiters
///      works for both.
///   2. Contiguous runs: a run is a sequence of *long* (>= [`MIN_BASE64_SEGMENT_LEN`]) base64
///      segments joined by whitespace — a short segment ends the run, so a prose word adjacent to a
///      blob never gets absorbed. The run is elided only when its total base64 chars reach
///      [`MIN_BASE64_RUN_CHARS`]. This matches both a single contiguous blob (one long segment) and
///      RFC-wrapped base64 (many long lines) while sparing ordinary text.
fn elide_base64_blobs(text: &str) -> String {
    let without_pem = elide_pem_blocks(text);
    elide_long_base64_runs(&without_pem)
}

/// Pass 1 of [`elide_base64_blobs`]: replace each `-----BEGIN …----- … -----END …-----` PEM block
/// with a marker. Matches on the literal ASCII delimiters so it works whether the block is newline-
/// or (post-kreuzberg) space-separated. An unterminated `-----BEGIN-----` (no matching END) is left
/// untouched so we never swallow trailing real text.
fn elide_pem_blocks(text: &str) -> String {
    const BEGIN: &str = "-----BEGIN ";
    const END_PREFIX: &str = "-----END ";
    const DELIM_SUFFIX: &str = "-----";

    let mut out = String::with_capacity(text.len());
    let mut rest = text;

    while let Some(begin_rel) = rest.find(BEGIN) {
        // Find the end of the `-----BEGIN …-----` opening delimiter line.
        let after_begin_kw = begin_rel + BEGIN.len();
        let Some(begin_close_rel) = rest[after_begin_kw..].find(DELIM_SUFFIX) else {
            break; // No closing `-----` for the BEGIN line: not a well-formed PEM header.
        };
        let header_end = after_begin_kw + begin_close_rel + DELIM_SUFFIX.len();

        // Find the matching `-----END …-----` and the end of its delimiter line.
        let Some(end_rel) = rest[header_end..].find(END_PREFIX) else {
            break; // Unterminated block: keep the original text from here untouched.
        };
        let end_start = header_end + end_rel;
        let after_end_kw = end_start + END_PREFIX.len();
        let Some(end_close_rel) = rest[after_end_kw..].find(DELIM_SUFFIX) else {
            break;
        };
        let block_end = after_end_kw + end_close_rel + DELIM_SUFFIX.len();

        let block_len = block_end - begin_rel;
        out.push_str(&rest[..begin_rel]);
        out.push_str(&format!("[base64 data omitted, {block_len} chars]"));
        rest = &rest[block_end..];
    }

    out.push_str(rest);
    out
}

/// Pass 2 of [`elide_base64_blobs`]: replace each long base64 run with a marker. A run is a chain of
/// long (>= [`MIN_BASE64_SEGMENT_LEN`]) base64 segments joined by whitespace; a short segment or any
/// non-base64/non-whitespace byte ends it. See [`elide_base64_blobs`] for the rationale.
fn elide_long_base64_runs(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut index = 0;

    while index < bytes.len() {
        // Measure a single maximal segment of base64 chars starting at `index`.
        let segment_len = base64_segment_len(bytes, index);
        if segment_len < MIN_BASE64_SEGMENT_LEN {
            // Not the start of a long base64 segment: emit one byte and move on. (Indexing by byte is
            // safe to re-emit verbatim because non-ASCII bytes are never base64 and are copied as-is.)
            out.push_str(&text[index..index + utf8_char_len(bytes[index])]);
            index += utf8_char_len(bytes[index]);
            continue;
        }

        // Extend the run across whitespace into each following *long* base64 segment. We track the
        // index just past the last base64 char so trailing whitespace is left for the normal path.
        let run_start = index;
        let mut run_end = index + segment_len;
        let mut base64_chars = segment_len;
        let mut cursor = run_end;

        loop {
            // Skip interior whitespace, then peek the next segment; only consume it if it is long.
            let mut probe = cursor;
            while probe < bytes.len() && bytes[probe].is_ascii_whitespace() {
                probe += 1;
            }
            let next_len = base64_segment_len(bytes, probe);
            if next_len < MIN_BASE64_SEGMENT_LEN {
                break;
            }
            base64_chars += next_len;
            run_end = probe + next_len;
            cursor = run_end;
        }

        if base64_chars >= MIN_BASE64_RUN_CHARS {
            out.push_str(&format!("[base64 data omitted, {base64_chars} chars]"));
        } else {
            out.push_str(&text[run_start..run_end]);
        }
        index = run_end;
    }

    out
}

/// Length (in bytes/chars — base64 chars are all ASCII) of the maximal run of base64-alphabet chars
/// starting at `start`. Returns 0 if `start` is not a base64 char.
fn base64_segment_len(bytes: &[u8], start: usize) -> usize {
    let mut end = start;
    while end < bytes.len() && is_base64_byte(bytes[end]) {
        end += 1;
    }
    end - start
}

/// Byte length of the UTF-8 sequence whose lead byte is `byte`. Used so the non-base64 fall-through
/// copies whole multi-byte characters (base64 chars are ASCII, so this only matters for the bytes we
/// pass through untouched).
fn utf8_char_len(byte: u8) -> usize {
    match byte {
        0x00..=0x7F => 1,
        0xC0..=0xDF => 2,
        0xE0..=0xEF => 3,
        0xF0..=0xF7 => 4,
        // Continuation/invalid lead byte: advance one byte to guarantee progress.
        _ => 1,
    }
}

fn normalize_plain_text(text: &str) -> String {
    let text = strip_zero_width_chars(text);
    let text = elide_base64_blobs(&text);
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

fn collect_email_plain_text_parts(
    entity: &[u8],
    output: &mut Vec<String>,
    stats: &mut EmailBodyStats,
) {
    stats.entities_seen += 1;
    let (headers, body) = split_mime_headers_body(entity);
    let headers = parse_mime_headers(headers);
    let content_type = header_value(&headers, "content-type").unwrap_or("text/plain");
    let (content_type_essence, boundary) = content_type_essence_and_param(content_type, "boundary");
    let transfer_encoding = header_value(&headers, "content-transfer-encoding");
    let content_disposition =
        content_disposition_essence(header_value(&headers, "content-disposition"));

    if content_type_essence.starts_with("multipart/") {
        stats.multipart_entities += 1;
        if let Some(boundary) = boundary {
            for part in split_multipart_body(body, &boundary) {
                collect_email_plain_text_parts(part, output, stats);
            }
        }
        return;
    }

    let decoded_body = decode_mime_body(body, transfer_encoding);
    stats.decoded_bytes += decoded_body.len();

    if content_type_essence == "message/rfc822" {
        stats.message_rfc822_entities += 1;
        collect_email_plain_text_parts(&decoded_body, output, stats);
        return;
    }

    if content_type_essence == "text/plain" && content_disposition != "attachment" {
        stats.plain_text_entities += 1;
        let text = normalize_plain_text(&String::from_utf8_lossy(&decoded_body));
        if !text.trim().is_empty() {
            stats.extracted_parts += 1;
            output.push(text);
        }
    }
}

fn extract_email_plain_text(file_bytes: &[u8]) -> (Option<String>, EmailBodyStats) {
    let mut parts = Vec::new();
    let mut stats = EmailBodyStats::default();
    collect_email_plain_text_parts(file_bytes, &mut parts, &mut stats);

    let plain_text = parts
        .into_iter()
        .map(|part| part.trim().to_string())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");

    if plain_text.is_empty() {
        (None, stats)
    } else {
        (Some(plain_text), stats)
    }
}

fn has_utf8_or_ascii_charset(content_type: &str) -> bool {
    let (_, charset) = content_type_essence_and_param(content_type, "charset");
    charset.as_deref().is_none_or(|charset| {
        matches!(
            charset.to_ascii_lowercase().as_str(),
            "utf-8" | "utf8" | "us-ascii" | "ascii"
        )
    })
}

fn sanitized_html_body(decoded_body: &[u8]) -> String {
    strip_html_data_uris(&strip_html_style_and_script(&String::from_utf8_lossy(
        decoded_body,
    )))
}

fn count_html_table_cell_tags(html: &str) -> usize {
    let lower = html.to_ascii_lowercase();
    count_ascii_substring(&lower, "<td") + count_ascii_substring(&lower, "<th")
}

fn count_ascii_substring(haystack: &str, needle: &str) -> usize {
    haystack.match_indices(needle).count()
}

fn collect_email_html_body_parts(
    entity: &[u8],
    output: &mut Vec<String>,
    stats: &mut EmailBodyStats,
) {
    stats.entities_seen += 1;
    let (headers, body) = split_mime_headers_body(entity);
    let headers = parse_mime_headers(headers);
    let content_type = header_value(&headers, "content-type").unwrap_or("text/plain");
    let (content_type_essence, boundary) = content_type_essence_and_param(content_type, "boundary");
    let transfer_encoding = header_value(&headers, "content-transfer-encoding");
    let content_disposition =
        content_disposition_essence(header_value(&headers, "content-disposition"));

    if content_type_essence.starts_with("multipart/") {
        stats.multipart_entities += 1;
        if let Some(boundary) = boundary {
            for part in split_multipart_body(body, &boundary) {
                collect_email_html_body_parts(part, output, stats);
            }
        }
        return;
    }

    let decoded_body = decode_mime_body(body, transfer_encoding);
    stats.decoded_bytes += decoded_body.len();

    if content_type_essence == "message/rfc822" {
        stats.message_rfc822_entities += 1;
        collect_email_html_body_parts(&decoded_body, output, stats);
        return;
    }

    if content_type_essence == "text/html"
        && content_disposition != "attachment"
        && has_utf8_or_ascii_charset(content_type)
    {
        stats.html_entities += 1;
        let html = sanitized_html_body(&decoded_body);
        stats.html_table_cell_tags += count_html_table_cell_tags(&html);
        if !html.trim().is_empty() {
            stats.extracted_parts += 1;
            output.push(html);
        }
    }
}

fn extract_email_html_body_fallback(
    file_bytes: &[u8],
    config: &kreuzberg::ExtractionConfig,
    marker_format: &str,
) -> (
    Option<String>,
    EmailBodyStats,
    EmailHtmlFallbackExtractionStats,
) {
    let mut html_parts = Vec::new();
    let mut stats = EmailBodyStats::default();
    collect_email_html_body_parts(file_bytes, &mut html_parts, &mut stats);
    let mut extraction_stats = EmailHtmlFallbackExtractionStats {
        html_part_count: html_parts.len(),
        ..Default::default()
    };

    let mut fallback_config = config.clone();
    let mut security_limits = fallback_config.security_limits.clone().unwrap_or_default();
    security_limits.max_table_cells = security_limits
        .max_table_cells
        .max(EMAIL_HTML_FALLBACK_MAX_TABLE_CELLS);
    fallback_config.security_limits = Some(security_limits);

    let mut extracted_parts = Vec::new();
    for (html_part_index, html) in html_parts.into_iter().enumerate() {
        extraction_stats.extraction_attempts += 1;
        let extraction_started = Instant::now();
        let result =
            kreuzberg::extract_bytes_sync(html.as_bytes(), HTML_MIME_TYPE, &fallback_config);
        let extraction_elapsed = extraction_started.elapsed();
        extraction_stats.extraction_elapsed += extraction_elapsed;

        match result {
            Ok(result) => {
                extraction_stats.extraction_successes += 1;
                tracing::trace!(
                    html_part_index,
                    html_bytes = html.len(),
                    elapsed_ms = extraction_elapsed.as_millis(),
                    result_content_len = result.content.len(),
                    page_count = result.pages.as_ref().map_or(0, Vec::len),
                    top_level_child_count = result.children.as_ref().map_or(0, Vec::len),
                    "Email HTML fallback kreuzberg extraction finished"
                );

                let normalization_started = Instant::now();
                let mut content =
                    content_with_page_markers(result.content, result.pages, marker_format);
                append_extraction_children(&mut content, result.children);
                let content = normalize_email_html_fallback_markdown(&content);
                let normalization_elapsed = normalization_started.elapsed();
                extraction_stats.normalization_elapsed += normalization_elapsed;
                tracing::trace!(
                    html_part_index,
                    elapsed_ms = normalization_elapsed.as_millis(),
                    normalized_content_len = content.len(),
                    is_empty = content.trim().is_empty(),
                    "Email HTML fallback post-processing finished"
                );

                if !content.trim().is_empty() {
                    extracted_parts.push(content);
                }
            }
            Err(err) => {
                extraction_stats.extraction_failures += 1;
                tracing::trace!(
                    html_part_index,
                    html_bytes = html.len(),
                    elapsed_ms = extraction_elapsed.as_millis(),
                    error = %err,
                    "Email HTML fallback kreuzberg extraction failed"
                );
                tracing::debug!(error = %err, "Skipping email HTML body fallback extraction");
            }
        }
    }

    let extracted = extracted_parts.join("\n\n");

    if extracted.trim().is_empty() {
        (None, stats, extraction_stats)
    } else {
        (Some(extracted), stats, extraction_stats)
    }
}

fn normalize_email_html_fallback_markdown(markdown: &str) -> String {
    let markdown = replace_markdown_links_and_images(markdown);
    let markdown = markdown
        .replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n")
        .replace("\\|", "|");

    let mut lines = Vec::new();
    for raw_line in markdown.lines() {
        let line = raw_line.trim();
        if line.matches('|').count() >= 2 {
            for cell in line.split('|') {
                push_clean_email_html_fallback_line(cell, &mut lines);
            }
        } else {
            push_clean_email_html_fallback_line(line, &mut lines);
        }
    }

    deduplicate_repeated_lines(&normalize_plain_text(&lines.join("\n")))
}

fn push_clean_email_html_fallback_line(line: &str, output: &mut Vec<String>) {
    let line = line.trim();
    if line.is_empty() {
        return;
    }

    let line = line.trim_start_matches('#').trim();
    if line.is_empty()
        || line == "---"
        || line.chars().all(|char| matches!(char, '-' | ':' | ' '))
        || line.starts_with("meta-")
    {
        return;
    }

    output.push(line.split_whitespace().collect::<Vec<_>>().join(" "));
}

fn replace_markdown_links_and_images(markdown: &str) -> String {
    let mut output = String::with_capacity(markdown.len());
    let mut position = 0;

    while position < markdown.len() {
        let rest = &markdown[position..];
        let Some(relative_start) = rest.find('[').or_else(|| rest.find("![")) else {
            output.push_str(rest);
            break;
        };

        let start = position + relative_start;
        let is_image = start > 0 && markdown.as_bytes().get(start - 1) == Some(&b'!');
        let token_start = if is_image { start - 1 } else { start };
        output.push_str(&markdown[position..token_start]);

        let label_start = start + 1;
        let Some(relative_label_end) = markdown[label_start..].find("](") else {
            output.push_str(&markdown[token_start..]);
            break;
        };
        let label_end = label_start + relative_label_end;
        let url_start = label_end + 2;
        let Some(relative_url_end) = markdown[url_start..].find(')') else {
            output.push_str(&markdown[token_start..]);
            break;
        };
        let url_end = url_start + relative_url_end;
        let label = markdown[label_start..label_end].trim();

        if !is_image || !label.is_empty() {
            output.push_str(label);
        }
        position = url_end + 1;
    }

    output
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

/// Rebuild a leaf entity's header block, replacing any Content-Transfer-Encoding with
/// base64.
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
/// non-HTML, or unparseable input. Nested `message/rfc822` parts are recursed into so a CSS-heavy
/// email forwarded *inside* a thread is sanitized too.
fn sanitize_email_html_blocks(entity: &[u8]) -> (Vec<u8>, EmailSanitizationStats) {
    let mut stats = EmailSanitizationStats::default();
    let sanitized = sanitize_email_html_blocks_inner(entity, 0, &mut stats);
    (sanitized, stats)
}

/// Maximum MIME nesting depth we recurse through. The recursion is naturally bounded by the
/// structure of a well-formed email, but a maliciously crafted message could nest
/// `multipart`/`message/rfc822` parts arbitrarily deep; this guard stops us from blowing the stack
/// on such input. Beyond the limit we return the entity untouched (a higher token count for that
/// sub-tree is strictly better than a crash).
const MAX_SANITIZE_DEPTH: usize = 20;

/// Recursive core of [`sanitize_email_html_blocks`]. `depth` tracks how many MIME levels deep we
/// are so pathologically nested emails can't recurse without bound.
fn sanitize_email_html_blocks_inner(
    entity: &[u8],
    depth: usize,
    stats: &mut EmailSanitizationStats,
) -> Vec<u8> {
    stats.entities_seen += 1;
    stats.max_depth_seen = stats.max_depth_seen.max(depth);

    if depth >= MAX_SANITIZE_DEPTH {
        return entity.to_vec();
    }

    let (headers_raw, body) = split_mime_headers_body(entity);
    let headers = parse_mime_headers(headers_raw);
    let content_type = header_value(&headers, "content-type").unwrap_or("text/plain");
    let (content_type_essence, boundary) = content_type_essence_and_param(content_type, "boundary");

    if content_type_essence.starts_with("multipart/") {
        stats.multipart_entities += 1;
        let Some(boundary) = boundary else {
            return entity.to_vec();
        };

        // Defensive: if a `multipart/*` declares a boundary that never actually appears in the body
        // (malformed/truncated email), `split_multipart_body` yields zero parts. Rebuilding from zero
        // parts would emit only `--boundary--` and silently DROP the original body bytes (which may
        // hold real, readable content a lenient parser would still surface). Returning the entity
        // untouched guarantees the sanitizer can never make a previously-extractable email lose
        // content; a marginally higher token count is strictly better than dropping the body.
        let parts = split_multipart_body(body, &boundary);
        if parts.is_empty() {
            return entity.to_vec();
        }

        let mut rebuilt_body = Vec::new();
        for part in parts {
            rebuilt_body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
            let mut sanitized_part = sanitize_email_html_blocks_inner(part, depth + 1, stats);
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

    if content_type_essence == "message/rfc822" {
        stats.message_rfc822_entities += 1;
        // A forwarded/attached email carried as `message/rfc822` is itself a full MIME message, so
        // its `text/html` parts can leak `<style>`/`<script>` blocks just like a top-level email.
        // Decode the part (it may be base64/quoted-printable), recurse to sanitize the inner
        // message, then re-emit.
        //
        // CTE re-emit choice: we always re-emit the recursed inner message as base64. The recursed
        // bytes are ascii-safe (any inner html became base64), but their internal structure
        // contains its own MIME boundaries and CRLFs; re-emitting verbatim under the original CTE
        // (e.g. `7bit`) risks a boundary/line-length/encoding mismatch against the inner message we
        // just rebuilt. Base64-wrapping the whole inner message sidesteps every such pitfall and is
        // transparent to kreuzberg, which decodes the CTE before recursing into the nested message
        // — confirmed by `test_kreuzberg_extracts_nested_rfc822_thread_bundle` (the nested bodies,
        // grandchild attachment, and filename all still extract).
        let transfer_encoding = header_value(&headers, "content-transfer-encoding");
        let decoded = decode_mime_body(body, transfer_encoding);
        stats.decoded_message_bytes += decoded.len();
        let sanitized_inner = sanitize_email_html_blocks_inner(&decoded, depth + 1, stats);
        stats.sanitized_message_bytes += sanitized_inner.len();

        let mut out = headers_with_base64_encoding(headers_raw).into_bytes();
        out.extend_from_slice(b"\r\n");
        out.extend_from_slice(base64_mime_body(&sanitized_inner).as_bytes());
        return out;
    }

    if content_type_essence == "text/html" {
        stats.html_entities += 1;
        // Only rewrite UTF-8/ASCII HTML: decoding other charsets (UTF-16, Latin-1, …) through
        // `from_utf8_lossy` would corrupt the text, so leave those parts untouched. kreuzberg still
        // decodes them itself via the charset header; the CSS leak is overwhelmingly a UTF-8 case.
        if !has_utf8_or_ascii_charset(content_type) {
            return entity.to_vec();
        }

        let transfer_encoding = header_value(&headers, "content-transfer-encoding");
        let decoded = decode_mime_body(body, transfer_encoding);
        stats.decoded_html_bytes += decoded.len();
        let decoded_html = String::from_utf8_lossy(&decoded);
        stats.decoded_html_table_cell_tags += count_html_table_cell_tags(&decoded_html);
        // Strip `<style>`/`<script>` blocks first, then neutralize any `data:` URI payloads (large
        // inline base64 images) — both are token bombs kreuzberg would otherwise render as text.
        let cleaned = sanitized_html_body(&decoded);
        stats.sanitized_html_bytes += cleaned.len();
        stats.sanitized_html_table_cell_tags += count_html_table_cell_tags(&cleaned);
        stats.html_entities_sanitized += 1;

        let mut out = headers_with_base64_encoding(headers_raw).into_bytes();
        out.extend_from_slice(b"\r\n");
        out.extend_from_slice(base64_mime_body(cleaned.as_bytes()).as_bytes());
        return out;
    }

    let content_disposition = header_value(&headers, "content-disposition");
    if is_tnef_part(&content_type_essence, content_type, content_disposition) {
        stats.tnef_entities += 1;
        // A `winmail.dat` / TNEF part is an opaque Outlook blob we deliberately do not decode.
        // BLANK its body (re-emit empty base64) so its base64 can never reach the token count,
        // regardless of how a given kreuzberg version chooses to render an unknown attachment.
        // A short `[winmail.dat (TNEF) attachment omitted]` marker is appended separately by
        // `parse_file` so the reader still knows an attachment was present.
        let mut out = headers_with_base64_encoding(headers_raw).into_bytes();
        out.extend_from_slice(b"\r\n");
        out.extend_from_slice(base64_mime_body(b"").as_bytes());
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

fn content_contains_meaningful_body_portion(content: &str, body: &str) -> bool {
    if content.contains(body.trim()) {
        return true;
    }

    let significant_lines = body
        .lines()
        .map(str::trim)
        .filter(|line| line.chars().filter(|char| !char.is_whitespace()).count() >= 24)
        .collect::<Vec<_>>();

    if significant_lines.is_empty() {
        return false;
    }

    let contained_lines = significant_lines
        .iter()
        .filter(|line| content.contains(**line))
        .count();

    if significant_lines.len() <= 3 {
        contained_lines > 0
    } else {
        contained_lines * 100 / significant_lines.len() >= 25
    }
}

fn deduplicate_repeated_lines(text: &str) -> String {
    let mut seen = std::collections::HashSet::new();
    let mut output = Vec::new();
    let mut previous_was_blank = false;

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            if !previous_was_blank {
                output.push(String::new());
            }
            previous_was_blank = true;
            continue;
        }

        previous_was_blank = false;
        let meaningful_chars = trimmed
            .chars()
            .filter(|char| char.is_alphanumeric())
            .count();
        let should_dedupe = meaningful_chars >= 4 && !trimmed.starts_with('|');

        if !should_dedupe || seen.insert(trimmed.to_string()) {
            output.push(line.to_string());
        }
    }

    output.join("\n")
}

fn is_empty_markdown_table_line(line: &str) -> bool {
    let line = line.trim();
    if !line.starts_with('|') || !line.ends_with('|') {
        return false;
    }

    line.trim_matches('|').split('|').all(|cell| {
        cell.trim()
            .chars()
            .all(|char| matches!(char, '-' | ':' | ' '))
    })
}

fn strip_empty_markdown_table_rows(text: &str) -> String {
    let mut output = Vec::new();
    let mut previous_was_blank = false;

    for line in text.lines() {
        if is_empty_markdown_table_line(line) {
            continue;
        }

        if line.trim().is_empty() {
            if !previous_was_blank {
                output.push(String::new());
            }
            previous_was_blank = true;
            continue;
        }

        previous_was_blank = false;
        output.push(line.to_string());
    }

    output.join("\n")
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

fn append_email_html_body_if_missing(content: &mut String, html_body: Option<String>) {
    let Some(html_body) = html_body else {
        return;
    };

    let content_chars = content.chars().filter(|char| !char.is_whitespace()).count();
    let html_body_chars = html_body
        .chars()
        .filter(|char| !char.is_whitespace())
        .count();
    if html_body_chars > 0 && content_chars * 100 / html_body_chars >= 40 {
        return;
    }

    if content_contains_meaningful_body_portion(content, &html_body) {
        return;
    }

    if !content.trim_end().is_empty() {
        content.push_str("\n\n");
    }
    content.push_str("## Email HTML body\n\n");
    content.push_str(html_body.trim());
}

/// Whether a MIME part is a TNEF (Transport Neutral Encapsulation Format) blob — the proprietary
/// `winmail.dat` attachment Outlook emits when "Rich Text" is on. We do NOT decode TNEF (out of
/// scope); we only need to recognize it so the sanitizer can blank its base64 (otherwise a few KB
/// of opaque blob can tokenize as noise, and even if a given extractor drops it today, blanking
/// guarantees the bytes never reach kreuzberg). Detection is by content-type essence
/// (`application/ms-tnef`, `application/vnd.ms-tnef`) OR by a `winmail.dat` filename in the
/// content-type `name=` / content-disposition `filename=` parameter — Outlook sets all of these,
/// but third-party relays sometimes mangle the content-type to `application/octet-stream` while
/// keeping the canonical filename.
fn is_tnef_part(
    content_type_essence: &str,
    content_type: &str,
    content_disposition: Option<&str>,
) -> bool {
    if matches!(
        content_type_essence,
        "application/ms-tnef" | "application/vnd.ms-tnef"
    ) {
        return true;
    }

    let name = content_type_essence_and_param(content_type, "name").1;
    let filename =
        content_disposition.and_then(|cd| content_type_essence_and_param(cd, "filename").1);
    [name, filename]
        .into_iter()
        .flatten()
        .any(|value| value.trim().eq_ignore_ascii_case("winmail.dat"))
}

fn append_tnef_attachment_marker(content: &mut String) {
    if !content.trim_end().is_empty() {
        content.push_str("\n\n");
    }

    content.push_str("## Attachment\n\n");
    content.push_str("[winmail.dat (TNEF) attachment omitted]");
}

fn extract_tnef_attachment_count(file_bytes: &[u8]) -> (usize, EmailTnefStats) {
    let mut tnef_attachments = 0;
    let mut stats = EmailTnefStats::default();
    collect_tnef_attachments(file_bytes, &mut tnef_attachments, &mut stats);
    (tnef_attachments, stats)
}

fn collect_tnef_attachments(
    entity: &[u8],
    tnef_attachments: &mut usize,
    stats: &mut EmailTnefStats,
) {
    stats.entities_seen += 1;
    let (headers, body) = split_mime_headers_body(entity);
    let headers = parse_mime_headers(headers);
    let content_type = header_value(&headers, "content-type").unwrap_or("text/plain");
    let (content_type_essence, boundary) = content_type_essence_and_param(content_type, "boundary");
    let transfer_encoding = header_value(&headers, "content-transfer-encoding");
    let content_disposition = header_value(&headers, "content-disposition");

    if content_type_essence.starts_with("multipart/") {
        stats.multipart_entities += 1;
        if let Some(boundary) = boundary {
            for part in split_multipart_body(body, &boundary) {
                collect_tnef_attachments(part, tnef_attachments, stats);
            }
        }
        return;
    }

    if is_tnef_part(&content_type_essence, content_type, content_disposition) {
        *tnef_attachments += 1;
        stats.tnef_entities += 1;
        return;
    }

    let decoded_body = decode_mime_body(body, transfer_encoding);

    if content_type_essence == "message/rfc822" {
        stats.message_rfc822_entities += 1;
        stats.decoded_message_bytes += decoded_body.len();
        collect_tnef_attachments(&decoded_body, tnef_attachments, stats);
    }
}

fn append_extraction_children(
    content: &mut String,
    children: Option<Vec<kreuzberg::ArchiveEntry>>,
) -> usize {
    let Some(children) = children else {
        return 0;
    };
    let mut appended_children = 0;

    let has_parsed_nested_message = children
        .iter()
        .any(|child| child.mime_type.eq_ignore_ascii_case("message/rfc822"));

    for child in children {
        if has_parsed_nested_message && is_raw_nested_message_attachment_duplicate(&child) {
            continue;
        }
        appended_children += 1;

        if !content.trim_end().is_empty() {
            content.push_str("\n\n");
        }

        content.push_str(&format!(
            "## Attachment: {}\n\nMIME type: {}\n\n",
            child.path, child.mime_type
        ));
        content.push_str(child.result.content.trim());

        appended_children += append_extraction_children(content, child.result.children);
    }

    appended_children
}

fn is_raw_nested_message_attachment_duplicate(child: &kreuzberg::ArchiveEntry) -> bool {
    child.path.to_ascii_lowercase().ends_with(".eml")
        && child.mime_type.eq_ignore_ascii_case("text/plain")
        && child.result.content.contains("Content-Type:")
        && child.result.content.contains("Content-Transfer-Encoding:")
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
                let total_timer = StepTimer::start("file_processor.parse_file.total");
                let input_len = file_bytes.len();
                let provided_mime_type = mime_type.as_deref().map(str::to_string);
                tracing::debug!(
                    file_bytes_len = input_len,
                    provided_mime_type = provided_mime_type.as_deref().unwrap_or("<none>"),
                    "file processing started"
                );

                // Check if the file is an image using magic number detection
                if infer::is_image(&file_bytes) {
                    let total_elapsed = total_timer.finish();
                    tracing::debug!(
                        elapsed_ms = total_elapsed.as_millis(),
                        "Skipping OCR/text extraction for image file"
                    );
                    return Ok(String::new());
                }

                let mut mime_type = if let Some(mime_type) = mime_type.as_deref() {
                    tracing::debug!(mime_type = %mime_type, "Using provided MIME type");
                    normalize_kreuzberg_mime(mime_type)
                } else {
                    let timer = StepTimer::start("file_processor.detect_mime");
                    let detected = detect_mime_type(&file_bytes)?;
                    timer.finish();
                    normalize_kreuzberg_mime(&detected)
                };

                if matches!(
                    mime_type.as_str(),
                    "application/zip" | "application/x-zip-compressed"
                ) && looks_like_docx(&file_bytes)
                {
                    mime_type = DOCX_MIME_TYPE.to_string();
                }

                let timer = StepTimer::start("file_processor.register_extractors");
                register_calendar_vcard_extractor()
                    .wrap_err("Failed to register calendar/vcard extractor")?;
                timer.finish();

                // kreuzberg rejects bare `multipart/*` types ("Unsupported format"), but those are
                // the inner header of an RFC822 message (a `.eml` whose Content-Type is
                // `multipart/alternative`/`multipart/mixed`). Route them through the email
                // extractor instead of failing and falling back to a raw, hugely-inflated count.
                if mime_type.starts_with("multipart/") {
                    mime_type = "message/rfc822".to_string();
                }
                tracing::debug!(
                    final_mime_type = %mime_type,
                    "Final decided MIME type"
                );

                let is_email = is_message_rfc822_mime_type(&mime_type);

                let email_plain_text = if is_email {
                    let timer = StepTimer::start("file_processor.email.extract_plain_text");
                    let (plain_text, stats) = extract_email_plain_text(&file_bytes);
                    let elapsed = timer.finish();
                    tracing::debug!(
                        elapsed_ms = elapsed.as_millis(),
                        plain_text_len = plain_text.as_ref().map_or(0, String::len),
                        entities_seen = stats.entities_seen,
                        multipart_entities = stats.multipart_entities,
                        message_rfc822_entities = stats.message_rfc822_entities,
                        plain_text_entities = stats.plain_text_entities,
                        extracted_parts = stats.extracted_parts,
                        decoded_bytes = stats.decoded_bytes,
                        "Email plain-text extraction stats"
                    );
                    plain_text
                } else {
                    None
                };

                let tnef_attachment_count = if is_email {
                    let timer = StepTimer::start("file_processor.email.count_tnef");
                    let (count, stats) = extract_tnef_attachment_count(&file_bytes);
                    let elapsed = timer.finish();
                    tracing::debug!(
                        elapsed_ms = elapsed.as_millis(),
                        tnef_attachment_count = count,
                        entities_seen = stats.entities_seen,
                        multipart_entities = stats.multipart_entities,
                        message_rfc822_entities = stats.message_rfc822_entities,
                        decoded_message_bytes = stats.decoded_message_bytes,
                        "Email TNEF scan stats"
                    );
                    count
                } else {
                    0
                };

                // For emails, strip `<style>`/`<script>` blocks from HTML parts before extraction:
                // kreuzberg renders style-block contents as text, which otherwise leaks a CSS-heavy
                // newsletter's stylesheet into the token count. Other parts are left untouched.
                let sanitized_email_bytes;
                let did_sanitize = is_email;
                let extraction_bytes: &[u8] = if did_sanitize {
                    let timer = StepTimer::start("file_processor.email.sanitize_html_blocks");
                    let (sanitized, stats) = sanitize_email_html_blocks(&file_bytes);
                    let elapsed = timer.finish();
                    tracing::debug!(
                        elapsed_ms = elapsed.as_millis(),
                        input_bytes = file_bytes.len(),
                        sanitized_bytes = sanitized.len(),
                        entities_seen = stats.entities_seen,
                        multipart_entities = stats.multipart_entities,
                        message_rfc822_entities = stats.message_rfc822_entities,
                        html_entities = stats.html_entities,
                        html_entities_sanitized = stats.html_entities_sanitized,
                        tnef_entities = stats.tnef_entities,
                        max_depth_seen = stats.max_depth_seen,
                        decoded_html_bytes = stats.decoded_html_bytes,
                        sanitized_html_bytes = stats.sanitized_html_bytes,
                        decoded_html_table_cell_tags = stats.decoded_html_table_cell_tags,
                        sanitized_html_table_cell_tags = stats.sanitized_html_table_cell_tags,
                        decoded_message_bytes = stats.decoded_message_bytes,
                        sanitized_message_bytes = stats.sanitized_message_bytes,
                        "Email HTML sanitization stats"
                    );
                    sanitized_email_bytes = sanitized;
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

                let mut config = kreuzberg::ExtractionConfig {
                    use_cache: false,
                    output_format: kreuzberg::OutputFormat::Markdown,
                    pages: Some(page_config),
                    html_options: Some(html_to_markdown_rs::ConversionOptions {
                        compact_tables: true,
                        ..Default::default()
                    }),
                    ..Default::default()
                };
                let mut security_limits = config.security_limits.clone().unwrap_or_default();
                security_limits.max_table_cells = security_limits
                    .max_table_cells
                    .max(EMAIL_HTML_FALLBACK_MAX_TABLE_CELLS);
                config.security_limits = Some(security_limits);

                // Extract content using kreuzberg. If HTML sanitization rewrote the email and the
                // rewritten bytes somehow fail to parse, fall back to the original bytes so we never
                // regress a previously-extractable email into a silent drop (a higher token count is
                // strictly better than losing the file).
                let timer = StepTimer::start("file_processor.kreuzberg.extract_bytes_sync");
                let primary_extraction_started = Instant::now();
                let result = match kreuzberg::extract_bytes_sync(extraction_bytes, &mime_type, &config)
                {
                    Ok(result) => {
                        let primary_extraction_elapsed = primary_extraction_started.elapsed();
                        tracing::trace!(
                            elapsed_ms = primary_extraction_elapsed.as_millis(),
                            extraction_bytes_len = extraction_bytes.len(),
                            result_content_len = result.content.len(),
                            page_count = result.pages.as_ref().map_or(0, Vec::len),
                            top_level_child_count = result.children.as_ref().map_or(0, Vec::len),
                            did_sanitize,
                            "Normal kreuzberg extraction finished"
                        );
                        result
                    }
                    Err(err) if did_sanitize => {
                        let primary_extraction_elapsed = primary_extraction_started.elapsed();
                        tracing::trace!(
                            elapsed_ms = primary_extraction_elapsed.as_millis(),
                            extraction_bytes_len = extraction_bytes.len(),
                            error = %err,
                            "Normal kreuzberg extraction failed after email sanitization"
                        );
                        tracing::warn!(
                            error = %err,
                            "Email HTML sanitization produced unparseable output; retrying with original bytes"
                        );
                        let retry_started = Instant::now();
                        let retry_result = kreuzberg::extract_bytes_sync(&file_bytes, &mime_type, &config)
                            .wrap_err("Kreuzberg extraction failed")?;
                        let retry_elapsed = retry_started.elapsed();
                        tracing::trace!(
                            elapsed_ms = retry_elapsed.as_millis(),
                            extraction_bytes_len = file_bytes.len(),
                            result_content_len = retry_result.content.len(),
                            page_count = retry_result.pages.as_ref().map_or(0, Vec::len),
                            top_level_child_count =
                                retry_result.children.as_ref().map_or(0, Vec::len),
                            "Normal kreuzberg extraction retry with original bytes finished"
                        );
                        retry_result
                    }
                    Err(err) => {
                        let primary_extraction_elapsed = primary_extraction_started.elapsed();
                        tracing::trace!(
                            elapsed_ms = primary_extraction_elapsed.as_millis(),
                            extraction_bytes_len = extraction_bytes.len(),
                            error = %err,
                            "Normal kreuzberg extraction failed"
                        );
                        return Err(err).wrap_err("Kreuzberg extraction failed");
                    }
                };
                let elapsed = timer.finish();
                tracing::debug!(
                    elapsed_ms = elapsed.as_millis(),
                    extraction_bytes_len = extraction_bytes.len(),
                    result_content_len = result.content.len(),
                    page_count = result.pages.as_ref().map_or(0, Vec::len),
                    top_level_child_count = result.children.as_ref().map_or(0, Vec::len),
                    "Kreuzberg extraction stats"
                );

                let timer = StepTimer::start("file_processor.postprocess.page_markers");
                let mut content =
                    content_with_page_markers(result.content, result.pages, &marker_format);
                let elapsed = timer.finish();
                tracing::debug!(
                    elapsed_ms = elapsed.as_millis(),
                    content_len = content.len(),
                    "Page marker post-processing stats"
                );

                let timer = StepTimer::start("file_processor.postprocess.append_children");
                let appended_children = append_extraction_children(&mut content, result.children);
                let elapsed = timer.finish();
                tracing::debug!(
                    elapsed_ms = elapsed.as_millis(),
                    appended_children,
                    content_len = content.len(),
                    "Nested child append stats"
                );

                let email_html_body_fallback = if did_sanitize && email_plain_text.is_none() {
                    let timer = StepTimer::start("file_processor.email.html_body_fallback");
                    let (html_body, stats, extraction_stats) =
                        extract_email_html_body_fallback(&file_bytes, &config, &marker_format);
                    let elapsed = timer.finish();
                    tracing::trace!(
                        elapsed_ms = elapsed.as_millis(),
                        html_body_len = html_body.as_ref().map_or(0, String::len),
                        html_part_count = extraction_stats.html_part_count,
                        extraction_attempts = extraction_stats.extraction_attempts,
                        extraction_successes = extraction_stats.extraction_successes,
                        extraction_failures = extraction_stats.extraction_failures,
                        extraction_elapsed_ms = extraction_stats.extraction_elapsed.as_millis(),
                        normalization_elapsed_ms =
                            extraction_stats.normalization_elapsed.as_millis(),
                        "Email HTML fallback extraction timing summary"
                    );
                    tracing::debug!(
                        elapsed_ms = elapsed.as_millis(),
                        html_body_len = html_body.as_ref().map_or(0, String::len),
                        html_part_count = extraction_stats.html_part_count,
                        extraction_attempts = extraction_stats.extraction_attempts,
                        extraction_successes = extraction_stats.extraction_successes,
                        extraction_failures = extraction_stats.extraction_failures,
                        extraction_elapsed_ms = extraction_stats.extraction_elapsed.as_millis(),
                        normalization_elapsed_ms =
                            extraction_stats.normalization_elapsed.as_millis(),
                        entities_seen = stats.entities_seen,
                        multipart_entities = stats.multipart_entities,
                        message_rfc822_entities = stats.message_rfc822_entities,
                        html_entities = stats.html_entities,
                        extracted_parts = stats.extracted_parts,
                        decoded_bytes = stats.decoded_bytes,
                        html_table_cell_tags = stats.html_table_cell_tags,
                        "Email HTML fallback stats"
                    );
                    html_body
                } else {
                    None
                };
                let timer = StepTimer::start("file_processor.email.append_body_fallbacks");
                append_email_plain_text_if_missing(&mut content, email_plain_text);
                append_email_html_body_if_missing(&mut content, email_html_body_fallback);
                if tnef_attachment_count > 0 {
                    append_tnef_attachment_marker(&mut content);
                }
                let elapsed = timer.finish();
                tracing::debug!(
                    elapsed_ms = elapsed.as_millis(),
                    content_len = content.len(),
                    "Email fallback append stats"
                );

                // Final post-extraction pass for emails: kreuzberg renders the email body directly
                // (so a PEM block / pasted blob in a `text/plain` body, or zero-width-obfuscated
                // keywords, land in `content` even though the plain-text supplement is deduped away).
                // Elide long base64 blobs and strip zero-width characters here so the cleanup applies
                // to the rendered body regardless of which part it came from. Both helpers are
                // no-ops when there is nothing to remove, so this never alters clean content.
                if did_sanitize {
                    let timer = StepTimer::start("file_processor.email.final_cleanup");
                    let before_len = content.len();
                    content =
                        strip_empty_markdown_table_rows(&strip_zero_width_chars(&elide_base64_blobs(
                            &content,
                        )));
                    let elapsed = timer.finish();
                    tracing::debug!(
                        elapsed_ms = elapsed.as_millis(),
                        before_len,
                        after_len = content.len(),
                        "Email final cleanup stats"
                    );
                }

                let total_elapsed = total_timer.finish();
                tracing::debug!(
                    elapsed_ms = total_elapsed.as_millis(),
                    output_len = content.len(),
                    final_mime_type = %mime_type,
                    "file processing finished"
                );
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

    fn token_count(text: &str) -> usize {
        let bpe = tiktoken_rs::o200k_base().expect("o200k_base tokenizer");
        bpe.encode_with_special_tokens(text).len()
    }

    fn read_test_fixture(filename: &str) -> Vec<u8> {
        let fixture_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/integration_tests/test_files")
            .join(filename);

        fs::read(&fixture_path).unwrap_or_else(|_| panic!("Failed to read fixture {}", filename))
    }

    fn init_test_tracing() {
        let _ = tracing_subscriber::fmt()
            .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
            .with_test_writer()
            .try_init();
    }

    #[test]
    fn test_create_file_processor() {
        let processor = create_file_processor("kreuzberg");
        assert!(processor.is_ok());
    }

    #[tokio::test]
    #[ignore]
    async fn debug_weekly_digest_extraction_timings() {
        init_test_tracing();

        let processor = KreuzbergProcessor;
        let only_fixture = std::env::var("ERATO_FILE_PROCESSOR_DEBUG_FIXTURE").ok();
        for fixture in [
            "styled_newsletter_multipart_alternative.eml",
            "weekly_digest_microsoft.eml",
            "weekly_digest_microsoft_via_erato.eml",
            "long_thread_via_erato.eml",
        ] {
            if only_fixture.as_deref().is_some_and(|only| only != fixture) {
                continue;
            }

            let bytes = read_test_fixture(fixture);
            let started = Instant::now();
            let extracted = processor
                .parse_file(bytes, Some("message/rfc822"))
                .await
                .unwrap_or_else(|err| panic!("failed to parse {fixture}: {err}"));
            eprintln!(
                "fixture={fixture} elapsed_ms={} output_len={}",
                started.elapsed().as_millis(),
                extracted.len()
            );
        }
    }

    #[test]
    #[ignore]
    fn debug_weekly_digest_kreuzberg_stage_timings() {
        init_test_tracing();

        let fixture = std::env::var("ERATO_FILE_PROCESSOR_DEBUG_FIXTURE")
            .unwrap_or_else(|_| "weekly_digest_microsoft.eml".to_string());
        let only_stage = std::env::var("ERATO_FILE_PROCESSOR_DEBUG_STAGE").ok();
        let eml_bytes = read_test_fixture(&fixture);

        let (plain_text, plain_stats) = extract_email_plain_text(&eml_bytes);
        let mut html_parts = Vec::new();
        let mut html_stats = EmailBodyStats::default();
        collect_email_html_body_parts(&eml_bytes, &mut html_parts, &mut html_stats);
        let (sanitized_email, sanitize_stats) = sanitize_email_html_blocks(&eml_bytes);

        eprintln!(
            "fixture={fixture} raw_len={} plain_len={} html_parts={} first_html_len={} sanitized_email_len={} plain_stats={plain_stats:?} html_stats={html_stats:?} sanitize_stats={sanitize_stats:?}",
            eml_bytes.len(),
            plain_text.as_ref().map_or(0, String::len),
            html_parts.len(),
            html_parts.first().map_or(0, String::len),
            sanitized_email.len(),
        );

        let marker_format = "<page number=\"{page_num}\">".to_string();
        let config = kreuzberg::ExtractionConfig {
            output_format: kreuzberg::OutputFormat::Markdown,
            pages: Some(kreuzberg::PageConfig {
                extract_pages: true,
                insert_page_markers: true,
                marker_format,
            }),
            ..Default::default()
        };

        let mut stages: Vec<(&str, Vec<u8>, &str)> = Vec::new();
        if let Some(plain_text) = plain_text {
            stages.push((
                "plain_only_eml",
                minimal_single_part_eml("text/plain; charset=utf-8", plain_text.as_bytes()),
                "message/rfc822",
            ));
        }
        if let Some(html) = html_parts.first() {
            stages.push((
                "html_only_eml",
                minimal_single_part_eml("text/html; charset=utf-8", html.as_bytes()),
                "message/rfc822",
            ));
            stages.push(("html_fragment", html.as_bytes().to_vec(), HTML_MIME_TYPE));
        }
        stages.push(("sanitized_full_eml", sanitized_email, "message/rfc822"));

        for (stage, bytes, mime_type) in stages {
            if only_stage.as_deref().is_some_and(|only| only != stage) {
                continue;
            }

            let started = Instant::now();
            let result = kreuzberg::extract_bytes_sync(&bytes, mime_type, &config)
                .unwrap_or_else(|err| panic!("{stage} failed for {fixture}: {err}"));
            eprintln!(
                "fixture={fixture} stage={stage} mime_type={mime_type} input_len={} elapsed_ms={} content_len={} child_count={} page_count={}",
                bytes.len(),
                started.elapsed().as_millis(),
                result.content.len(),
                result.children.as_ref().map_or(0, Vec::len),
                result.pages.as_ref().map_or(0, Vec::len),
            );
        }
    }

    fn minimal_single_part_eml(content_type: &str, body: &[u8]) -> Vec<u8> {
        let mut out = format!(
            "From: sender@example.com\r\n\
             To: recipient@example.com\r\n\
             Subject: Diagnostic single part\r\n\
             MIME-Version: 1.0\r\n\
             Content-Type: {content_type}\r\n\
             Content-Transfer-Encoding: 8bit\r\n\
             \r\n"
        )
        .into_bytes();
        out.extend_from_slice(body);
        out
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
            strip_html_data_uris(
                "<div style=\"background:url(data:image/png;base64,ZZZZ)\">hi</div>"
            ),
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

        let (plain_text, _stats) = extract_email_plain_text(eml_bytes);
        let plain_text = plain_text.expect("expected decoded plain-text body");
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
    async fn test_kreuzberg_strips_style_in_nested_forwarded_email() {
        // A CSS-heavy email forwarded *inside* a thread (as a `message/rfc822` attachment) must be
        // sanitized too: before the sanitizer recursed into `message/rfc822` parts, the inner
        // `<style>` block was treated as opaque and leaked into the token count. Build a
        // `multipart/mixed` wrapper whose only attachment is a forwarded `text/html` email carrying
        // a `ZZNESTEDCSSZZ` CSS sentinel plus a readable marker.
        let inner_email = b"From: Inner Sender <inner@example.com>\r\n\
            To: Outer Recipient <outer@example.com>\r\n\
            Subject: Forwarded styled email\r\n\
            MIME-Version: 1.0\r\n\
            Content-Type: text/html; charset=utf-8\r\n\r\n\
            <html><head><style>.brand{color:#ZZNESTEDCSSZZ;font-size:42px}</style></head>\
            <body><p>NESTED_READABLE_MARKER_delta survives sanitization.</p></body></html>\r\n";

        let mut eml = b"From: thread-wrapper@example.com\r\n\
            To: reader@example.com\r\n\
            Subject: Thread with forwarded styled email\r\n\
            MIME-Version: 1.0\r\n\
            Content-Type: multipart/mixed; boundary=\"OUTER\"\r\n\r\n\
            --OUTER\r\n\
            Content-Type: message/rfc822\r\n\
            Content-Disposition: attachment; filename=\"forwarded.eml\"\r\n\r\n"
            .to_vec();
        eml.extend_from_slice(inner_email);
        eml.extend_from_slice(b"\r\n--OUTER--\r\n");

        let processor = KreuzbergProcessor;
        let extracted = processor
            .parse_file(eml, Some("message/rfc822"))
            .await
            .expect("nested forwarded styled email should extract");

        // The readable body of the forwarded message survives the double recursion.
        assert!(
            extracted.contains("NESTED_READABLE_MARKER_delta"),
            "readable marker from the nested forwarded email was dropped:\n{extracted}"
        );
        // The CSS sentinel must not appear — proving the nested `<style>` block was stripped.
        assert_eq!(
            extracted.matches("ZZNESTEDCSSZZ").count(),
            0,
            "nested <style> block leaked from the forwarded message/rfc822 part:\n{extracted}"
        );
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
    async fn test_kreuzberg_extracts_deep_html_body_from_erato_wrapped_nested_message() {
        let eml_bytes = read_test_fixture("weekly_digest_microsoft_via_erato.eml");
        let mut html_parts = Vec::new();
        let mut html_stats = EmailBodyStats::default();
        collect_email_html_body_parts(&eml_bytes, &mut html_parts, &mut html_stats);
        assert_eq!(
            html_parts.len(),
            1,
            "expected one nested HTML body part in Erato-wrapped fixture"
        );
        assert!(
            html_parts[0].contains("Security Detection Report in Teams Admin Center"),
            "sanitized nested HTML body did not contain expected content"
        );
        assert!(
            extract_email_plain_text(&eml_bytes).0.is_none(),
            "HTML-only nested email should not be treated as having a text/plain body"
        );
        let marker_format = "<page number=\"{page_num}\">".to_string();
        let config = kreuzberg::ExtractionConfig {
            output_format: kreuzberg::OutputFormat::Markdown,
            pages: Some(kreuzberg::PageConfig {
                extract_pages: true,
                insert_page_markers: true,
                marker_format: marker_format.clone(),
            }),
            ..Default::default()
        };
        let fallback_bytes = eml_bytes.clone();
        let fallback_marker_format = marker_format.clone();
        let html_fallback = tokio::task::spawn_blocking(move || {
            extract_email_html_body_fallback(&fallback_bytes, &config, &fallback_marker_format)
        })
        .await
        .expect("HTML fallback task should complete")
        .0
        .expect("expected nested HTML fallback extraction");
        assert!(
            html_fallback.contains("Security Detection Report in Teams Admin Center"),
            "HTML fallback extraction did not contain expected content:\n{html_fallback}"
        );

        let processor = KreuzbergProcessor;
        let extracted = processor
            .parse_file(eml_bytes, Some("message/rfc822"))
            .await
            .expect("Failed to extract Erato-wrapped weekly digest");

        assert!(
            extracted.contains("Security Detection Report in Teams Admin Center"),
            "deep HTML body content from the nested email was not extracted:\n{extracted}"
        );
        assert!(
            extracted.contains(
                "HTML formatting now supported for Message center posts synced to Planner"
            ),
            "later body content from the nested email was not extracted:\n{extracted}"
        );
        assert!(
            !extracted.contains("## Attachment: message-1.eml"),
            "raw nested-message attachment duplicate should not be appended when parsed nested message exists:\n{extracted}"
        );
        assert!(
            !extracted.contains("@media only screen"),
            "sanitized HTML fallback leaked CSS media queries:\n{extracted}"
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

    /// Token ceiling for the malformed/adversarial MIME cases below. The real content in each is a
    /// short marker line; a sane extraction stays well under this. The point of the bound is to fail
    /// loudly if a sanitizer bug ever re-emits a raw multi-hundred-K byte blob as text.
    const ADVERSARIAL_TOKEN_CEILING: usize = 500;

    fn adversarial_token_count(text: &str) -> usize {
        let bpe = tiktoken_rs::o200k_base().expect("o200k_base tokenizer");
        bpe.encode_with_special_tokens(text).len()
    }

    #[tokio::test]
    async fn test_kreuzberg_handles_multipart_missing_closing_boundary() {
        // Adversarial MIME: declares `multipart/alternative; boundary="X"` but the message is
        // truncated mid-part — there is no closing `--X--` and the final HTML part is cut off
        // mid-tag. The sanitizer's MIME rebuild (`split_multipart_body` + boundary reconstruction)
        // must survive this without panicking or producing a raw-bytes explosion, and the readable
        // text/plain part must still be recoverable.
        let eml = "From: a@example.com\r\nTo: b@example.com\r\nSubject: trunc\r\nMIME-Version: 1.0\r\n\
            Content-Type: multipart/alternative; boundary=\"X\"\r\n\r\n\
            --X\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nADV_MARKER_A readable.\r\n\
            --X\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<html><body><p>trunc";

        let processor = KreuzbergProcessor;
        let extracted = processor
            .parse_file(eml.as_bytes().to_vec(), Some("message/rfc822"))
            .await
            .expect("truncated multipart email must degrade gracefully, not panic");

        assert!(
            extracted.contains("ADV_MARKER_A"),
            "readable part lost from truncated multipart:\n{extracted}"
        );
        let tokens = adversarial_token_count(&extracted);
        assert!(
            tokens < ADVERSARIAL_TOKEN_CEILING,
            "truncated multipart produced a token blob ({tokens} tokens):\n{extracted}"
        );
    }

    #[tokio::test]
    async fn test_kreuzberg_handles_multipart_boundary_absent_from_body() {
        // Adversarial MIME: declares a boundary (`NOPE`) that never appears anywhere in the body, so
        // `split_multipart_body` yields ZERO parts. Before the defensive guard in
        // `sanitize_email_html_blocks_inner`, rebuilding from zero parts emitted only `--NOPE--` and
        // silently DROPPED the body bytes — a real content-loss bug. The guard now returns the entity
        // untouched when a multipart yields no parts, so the body survives.
        let eml = "From: a@example.com\r\nTo: b@example.com\r\nSubject: noboundary\r\nMIME-Version: 1.0\r\n\
            Content-Type: multipart/alternative; boundary=\"NOPE\"\r\n\r\n\
            ADV_MARKER_B body that has no boundary delimiter at all.\r\n";

        let processor = KreuzbergProcessor;
        let extracted = processor
            .parse_file(eml.as_bytes().to_vec(), Some("message/rfc822"))
            .await
            .expect("multipart with an absent boundary must degrade gracefully, not panic");

        assert!(
            extracted.contains("ADV_MARKER_B"),
            "body dropped when the declared boundary never appears:\n{extracted}"
        );
        let tokens = adversarial_token_count(&extracted);
        assert!(
            tokens < ADVERSARIAL_TOKEN_CEILING,
            "absent-boundary multipart produced a token blob ({tokens} tokens):\n{extracted}"
        );
    }

    #[tokio::test]
    async fn test_kreuzberg_handles_invalid_base64_part() {
        // Adversarial MIME: a part declares `Content-Transfer-Encoding: base64` but the body is not
        // valid base64. `decode_mime_body` must not panic — it falls back to the raw bytes on a
        // decode error — and the readable text/plain sibling must still extract.
        let eml = "From: a@example.com\r\nTo: b@example.com\r\nSubject: badb64\r\nMIME-Version: 1.0\r\n\
            Content-Type: multipart/mixed; boundary=\"Y\"\r\n\r\n\
            --Y\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nADV_MARKER_C readable.\r\n\
            --Y\r\nContent-Type: application/octet-stream\r\nContent-Transfer-Encoding: base64\r\n\r\n\
            !!!not-valid-base64@@@truncated\r\n--Y--\r\n";

        let processor = KreuzbergProcessor;
        let extracted = processor
            .parse_file(eml.as_bytes().to_vec(), Some("message/rfc822"))
            .await
            .expect("invalid base64 part must degrade gracefully, not panic");

        assert!(
            extracted.contains("ADV_MARKER_C"),
            "readable part lost alongside an invalid-base64 sibling:\n{extracted}"
        );
        let tokens = adversarial_token_count(&extracted);
        assert!(
            tokens < ADVERSARIAL_TOKEN_CEILING,
            "invalid-base64 email produced a token blob ({tokens} tokens):\n{extracted}"
        );
    }

    #[tokio::test]
    async fn test_kreuzberg_does_not_leak_inline_cid_image_base64() {
        // A `multipart/related` email with an inline image referenced by CID: a `text/html` part with
        // `<img src="cid:logo123">` plus a readable marker, and a sibling `image/png` part carrying a
        // few KB of base64 (`Content-ID: <logo123>`). The readable marker must survive, and the
        // image's base64 must NOT be tokenized as a raw blob — kreuzberg's email extractor skips
        // image parts, so this just locks that behavior in.
        let mut image_base64 = String::new();
        while image_base64.len() < 4_000 {
            // A tiny valid GIF, repeated — content doesn't matter, only that it's a sizable blob.
            image_base64.push_str("R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=");
        }
        let eml = format!(
            "From: a@example.com\r\nTo: b@example.com\r\nSubject: cid image\r\nMIME-Version: 1.0\r\n\
             Content-Type: multipart/related; boundary=\"R\"\r\n\r\n\
             --R\r\nContent-Type: text/html; charset=utf-8\r\n\r\n\
             <html><body><p>CID_READABLE_MARKER text.</p><img src=\"cid:logo123\"></body></html>\r\n\
             --R\r\nContent-Type: image/png\r\nContent-ID: <logo123>\r\n\
             Content-Transfer-Encoding: base64\r\n\r\n\
             {image_base64}\r\n--R--\r\n"
        );

        let processor = KreuzbergProcessor;
        let extracted = processor
            .parse_file(eml.into_bytes(), Some("message/rfc822"))
            .await
            .expect("multipart/related with an inline CID image should extract");

        assert!(
            extracted.contains("CID_READABLE_MARKER"),
            "readable body missing from CID-image email:\n{extracted}"
        );
        assert!(
            !extracted.contains("R0lGODlhAQABA"),
            "inline CID image base64 leaked into extracted content:\n{extracted}"
        );
        let tokens = adversarial_token_count(&extracted);
        assert!(
            tokens < ADVERSARIAL_TOKEN_CEILING,
            "CID-image email tokenized the image blob ({tokens} tokens):\n{extracted}"
        );
    }

    #[tokio::test]
    async fn test_kreuzberg_preserves_latin1_html_email_content() {
        // Charset edge: an `iso-8859-1` (Latin-1) `text/html` part with a high byte (é = 0xE9) and a
        // `<style>` block. Like the UTF-16 case, the sanitizer's charset guard leaves non-UTF-8 parts
        // untouched (running them through `from_utf8_lossy` would corrupt the high bytes), so
        // kreuzberg decodes the part itself via the charset header and the accented text survives.
        //
        // KNOWN LIMITATION: because we skip sanitizing non-UTF-8 parts, the `<style>` block is NOT
        // stripped for Latin-1 emails and its CSS can leak. We assert content *correctness* here
        // (the accented text is preserved, not mojibake), not zero-leak — the CSS leak for non-UTF-8
        // parts is the accepted trade-off for not corrupting the text.
        let mut eml =
            b"From: a@example.com\r\nTo: b@example.com\r\nSubject: latin1\r\nMIME-Version: 1.0\r\n\
              Content-Type: text/html; charset=iso-8859-1\r\n\r\n"
                .to_vec();
        eml.extend_from_slice(
            b"<html><head><style>.x{color:red;LATIN1CSSLEAK:1}</style></head><body><p>caf",
        );
        eml.push(0xE9); // é in Latin-1
        eml.extend_from_slice(b" LATIN1_MARKER works</p></body></html>\r\n");

        let processor = KreuzbergProcessor;
        let extracted = processor
            .parse_file(eml, Some("message/rfc822"))
            .await
            .expect("Latin-1 html email should still extract");

        assert!(
            extracted.contains("LATIN1_MARKER works"),
            "Latin-1 content was dropped:\n{extracted}"
        );
        assert!(
            extracted.contains("café"),
            "Latin-1 high byte (é) was corrupted rather than decoded:\n{extracted}"
        );
    }

    #[tokio::test]
    async fn test_kreuzberg_handles_mixed_transfer_encodings_in_one_email() {
        // A `multipart/mixed` with two differently-encoded parts: a quoted-printable `text/html` part
        // carrying a `<style>` block (which must be stripped) and a base64 `text/plain` part (which
        // must decode and survive). Exercises both transfer-encoding paths in `decode_mime_body`
        // within a single email and confirms the HTML sanitizer still strips the style block after QP
        // decoding.
        let plain_base64 =
            general_purpose::STANDARD.encode("BASE64_PLAIN_MARKER survives decoding.");
        let eml = format!(
            "From: a@example.com\r\nTo: b@example.com\r\nSubject: multienc\r\nMIME-Version: 1.0\r\n\
             Content-Type: multipart/mixed; boundary=\"M\"\r\n\r\n\
             --M\r\nContent-Type: text/html; charset=utf-8\r\n\
             Content-Transfer-Encoding: quoted-printable\r\n\r\n\
             <html><head><style>.y{{color:blue;QPCSSLEAK:1}}</style></head>\
             <body><p>QP_HTML_MARKER=20works</p></body></html>\r\n\
             --M\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n\
             {plain_base64}\r\n--M--\r\n"
        );

        let processor = KreuzbergProcessor;
        let extracted = processor
            .parse_file(eml.into_bytes(), Some("message/rfc822"))
            .await
            .expect("mixed-transfer-encoding email should extract");

        assert!(
            extracted.contains("QP_HTML_MARKER works"),
            "quoted-printable HTML body missing (soft break not decoded?):\n{extracted}"
        );
        assert!(
            !extracted.contains("QPCSSLEAK"),
            "<style> leaked from the quoted-printable HTML part:\n{extracted}"
        );
        assert!(
            extracted.contains("BASE64_PLAIN_MARKER survives decoding."),
            "base64 text/plain part did not survive decoding:\n{extracted}"
        );
    }

    // --- TNEF / winmail.dat, base64-in-text, and zero-width noise filtering -----------------

    #[test]
    fn is_tnef_part_detects_content_type_and_filename() {
        // Canonical Outlook content-types.
        assert!(is_tnef_part(
            "application/ms-tnef",
            "application/ms-tnef; name=\"winmail.dat\"",
            Some("attachment; filename=\"winmail.dat\"")
        ));
        assert!(is_tnef_part(
            "application/vnd.ms-tnef",
            "application/vnd.ms-tnef",
            None
        ));
        // Mangled content-type but canonical filename (relay rewrote the type to octet-stream).
        assert!(is_tnef_part(
            "application/octet-stream",
            "application/octet-stream; name=\"WINMAIL.DAT\"",
            Some("attachment; filename=\"WinMail.Dat\"")
        ));
        // A normal attachment is not TNEF.
        assert!(!is_tnef_part(
            "application/pdf",
            "application/pdf; name=\"report.pdf\"",
            Some("attachment; filename=\"report.pdf\"")
        ));
    }

    #[tokio::test]
    async fn test_kreuzberg_blanks_tnef_winmail_dat_and_marks_attachment() {
        // An Outlook email whose Rich Text produced a `winmail.dat` (TNEF) attachment, a few KB of
        // base64, alongside a readable text/plain body. Modeled on the real Outlook TNEF MIME shape
        // (`application/ms-tnef; name="winmail.dat"` + `Content-Disposition: attachment;
        // filename="winmail.dat"`). The body must survive, the TNEF base64 must never reach the
        // token count, the omission marker must be present, and output must be tiny.
        let mut blob = String::new();
        while blob.len() < 4_000 {
            // Realistic TNEF byte signature start (0x78 0x9F …) base64-ish, repeated; content is
            // irrelevant, only that it is a sizable opaque blob carrying a sentinel.
            blob.push_str("eJzNVk1vTNEFSENTINEL2zAMvfdXED0VWGw7ztIm4ABCDEFGH");
        }
        let raw_blob_len = blob.len();
        let eml = format!(
            "From: Sender <sender@example.com>\r\n\
             To: Recipient <recipient@example.com>\r\n\
             Subject: Quarterly numbers\r\n\
             MIME-Version: 1.0\r\n\
             Content-Type: multipart/mixed; boundary=\"TNEFBOUND\"\r\n\r\n\
             --TNEFBOUND\r\n\
             Content-Type: text/plain; charset=utf-8\r\n\r\n\
             Please see the attached spreadsheet. TNEF_BODY_MARKER readable.\r\n\
             --TNEFBOUND\r\n\
             Content-Type: application/ms-tnef; name=\"winmail.dat\"\r\n\
             Content-Transfer-Encoding: base64\r\n\
             Content-Disposition: attachment; filename=\"winmail.dat\"\r\n\r\n\
             {blob}\r\n--TNEFBOUND--\r\n"
        );

        let processor = KreuzbergProcessor;
        let extracted = processor
            .parse_file(eml.into_bytes(), Some("message/rfc822"))
            .await
            .expect("TNEF email should extract");

        assert!(
            extracted.contains("TNEF_BODY_MARKER readable."),
            "readable body lost:\n{extracted}"
        );
        assert!(
            !extracted.contains("TNEFSENTINEL"),
            "TNEF base64 leaked into extracted content:\n{extracted}"
        );
        assert!(
            extracted.contains("[winmail.dat (TNEF) attachment omitted]"),
            "TNEF omission marker missing:\n{extracted}"
        );
        let tokens = token_count(&extracted);
        assert!(
            tokens < 100,
            "TNEF email output too large: {tokens} tokens (raw blob {raw_blob_len} bytes):\n{extracted}"
        );
    }

    #[tokio::test]
    async fn test_kreuzberg_elides_pem_block_in_plain_text_body() {
        // A `text/plain` body containing a PEM CERTIFICATE block (~1.5 KB of base64) wrapped in
        // ordinary sentences. The sentences must survive, the base64 must be elided behind a marker,
        // and the token count must collapse. Modeled on RFC 7468 PEM textual encoding.
        let mut blob = String::new();
        while blob.len() < 1_500 {
            blob.push_str("MIIDXTCCAkWgAwIBAgIJAKL0UG+mRkSPMA0GCSqGSIb3DQEBCwUAMEUxCzAJBgNV\r\n");
        }
        let raw_blob_len = blob.len();
        let body = format!(
            "Dear team, please find our signing certificate below for verification.\r\n\r\n\
             -----BEGIN CERTIFICATE-----\r\n{blob}-----END CERTIFICATE-----\r\n\r\n\
             Let me know if you need anything else. Regards, Alice"
        );
        let eml = format!(
            "From: Alice <alice@example.com>\r\n\
             To: Bob <bob@example.com>\r\n\
             Subject: Our certificate\r\n\
             MIME-Version: 1.0\r\n\
             Content-Type: text/plain; charset=utf-8\r\n\r\n{body}\r\n"
        );

        let processor = KreuzbergProcessor;
        let extracted = processor
            .parse_file(eml.into_bytes(), Some("message/rfc822"))
            .await
            .expect("PEM-in-body email should extract");

        assert!(
            extracted.contains("please find our signing certificate below"),
            "leading sentence lost:\n{extracted}"
        );
        assert!(
            extracted.contains("Let me know if you need anything else."),
            "trailing sentence lost:\n{extracted}"
        );
        assert!(
            !extracted.contains("MIIDXTCCAkW"),
            "PEM base64 leaked into extracted content:\n{extracted}"
        );
        assert!(
            extracted.contains("[base64 data omitted"),
            "PEM omission marker missing:\n{extracted}"
        );
        let tokens = token_count(&extracted);
        assert!(
            tokens < 100,
            "PEM email output too large: {tokens} tokens (raw blob {raw_blob_len} bytes):\n{extracted}"
        );
    }

    #[test]
    fn elide_base64_blobs_elides_pem_block_keeps_surrounding_prose() {
        let mut blob = String::new();
        while blob.len() < 1_000 {
            blob.push_str("AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH");
        }
        let input = format!(
            "before text -----BEGIN PRIVATE KEY-----\n{blob}\n-----END PRIVATE KEY----- after text"
        );
        let out = elide_base64_blobs(&input);
        assert!(out.starts_with("before text "), "leading prose lost: {out}");
        assert!(out.ends_with(" after text"), "trailing prose lost: {out}");
        assert!(
            out.contains("[base64 data omitted"),
            "marker missing: {out}"
        );
        assert!(!out.contains("AAAABBBB"), "PEM body leaked: {out}");
    }

    #[test]
    fn elide_base64_blobs_elides_long_contiguous_run() {
        // A pasted blob: one contiguous 800-char base64 string with no natural-language spacing.
        let blob = "QWxhZGRpbjpvcGVuIHNlc2FtZQ".repeat(40); // ~1040 chars, no spaces
        let input = format!("Here is the dump: {blob} -- end of dump");
        let out = elide_base64_blobs(&input);
        assert!(
            out.starts_with("Here is the dump: "),
            "prose before run lost: {out}"
        );
        assert!(
            out.contains("-- end of dump"),
            "prose after run lost: {out}"
        );
        assert!(
            out.contains("[base64 data omitted"),
            "marker missing: {out}"
        );
        assert!(!out.contains("QWxhZGRpbg"), "blob leaked: {out}");
    }

    #[test]
    fn elide_base64_blobs_keeps_short_tokens_and_prose() {
        // A short base64-looking token (a word, a short hash) in prose must NOT be elided.
        let inputs = [
            "The build hash is a1b2c3d4e5f6 and the deploy succeeded.",
            "Send the invoice to accounting before Friday please.",
            "Run base64 QWxhZGRpbg== to decode the example value.",
            // A whole sentence of alphanumeric words separated by single spaces: long total base64
            // chars but short average segment length, so the segment-average guard must spare it.
            "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike \
             november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee \
             zulu alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike",
        ];
        for input in inputs {
            let out = elide_base64_blobs(input);
            assert_eq!(out, input, "false-positive elision of prose/token: {out}");
        }
    }

    #[test]
    fn strip_zero_width_chars_joins_obfuscated_keywords() {
        // Zero-width chars inside keywords (a classic phishing obfuscation) must be removed so the
        // joined word is readable, while legitimate text/emoji are untouched.
        let input = "Your in\u{200b}voice and pass\u{200d}word were re\u{2060}set \u{feff}now. \
                     Soft\u{00ad}hyphen café 🚀";
        let out = strip_zero_width_chars(input);
        assert!(out.contains("invoice"), "zero-width not joined: {out}");
        assert!(out.contains("password"), "zero-width not joined: {out}");
        assert!(out.contains("reset"), "word joiner not removed: {out}");
        assert!(out.contains("Softhyphen"), "soft hyphen not removed: {out}");
        assert!(
            out.contains("café"),
            "legitimate non-ASCII letter dropped: {out}"
        );
        assert!(out.contains('🚀'), "emoji dropped: {out}");
        // No invisible chars remain.
        assert!(
            !out.chars().any(is_zero_width_char),
            "zero-width chars remained: {out:?}"
        );
    }

    #[tokio::test]
    async fn test_kreuzberg_strips_zero_width_obfuscation_in_email_body() {
        // End-to-end: a phishing-style body that splits keywords with zero-width spaces must come
        // out with the keywords joined so a downstream filter/LLM reads the real word.
        let eml = "From: a@example.com\r\nTo: b@example.com\r\nSubject: alert\r\nMIME-Version: 1.0\r\n\
            Content-Type: text/plain; charset=utf-8\r\n\r\n\
            Please confirm your pass\u{200b}word and in\u{200b}voice details immediately.\r\n";

        let processor = KreuzbergProcessor;
        let extracted = processor
            .parse_file(eml.as_bytes().to_vec(), Some("message/rfc822"))
            .await
            .expect("zero-width email should extract");

        assert!(
            extracted.contains("password") && extracted.contains("invoice"),
            "zero-width obfuscation not removed from final content:\n{extracted:?}"
        );
    }

    #[tokio::test]
    async fn test_kreuzberg_elides_pasted_base64_blob_in_email_body() {
        // A pasted contiguous base64 blob (e.g. someone pasted a log/image) in a text/plain body.
        let blob = "R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs".repeat(30);
        let eml = format!(
            "From: a@example.com\r\nTo: b@example.com\r\nSubject: dump\r\nMIME-Version: 1.0\r\n\
             Content-Type: text/plain; charset=utf-8\r\n\r\n\
             PASTE_BODY_MARKER here is the blob {blob} and PASTE_TAIL_MARKER after.\r\n"
        );
        let processor = KreuzbergProcessor;
        let extracted = processor
            .parse_file(eml.into_bytes(), Some("message/rfc822"))
            .await
            .expect("pasted-blob email should extract");
        assert!(
            extracted.contains("PASTE_BODY_MARKER") && extracted.contains("PASTE_TAIL_MARKER"),
            "surrounding prose lost:\n{extracted}"
        );
        assert!(
            extracted.contains("[base64 data omitted"),
            "blob marker missing:\n{extracted}"
        );
        assert!(
            !extracted.contains("R0lGODlhAQABA"),
            "pasted base64 blob leaked:\n{extracted}"
        );
    }
}
