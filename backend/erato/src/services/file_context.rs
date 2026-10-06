//! Request-scoped attachment planning. Extraction artifacts and original bytes are immutable.
use crate::models::message::{ContentPart, ContentPartText};
use erato_config::config::FileContextConfig;
use eyre::{Report, bail};
use serde::Serialize;
use std::sync::LazyLock;
use utoipa::ToSchema;

static TOKENIZER: LazyLock<tiktoken_rs::CoreBPE> =
    LazyLock::new(|| tiktoken_rs::o200k_base().expect("o200k tokenizer"));

pub fn tokens(text: &str) -> usize {
    TOKENIZER.encode_ordinary(text).len()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum InclusionMode {
    Full,
    Preview,
    ReferenceOnly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Coverage {
    Complete,
    Partial,
    Unavailable,
}

#[derive(Debug, Clone)]
pub struct Attachment {
    pub id: String,
    pub filename: String,
    /// None for transient virtual files; never invent a usable URI.
    pub uri: Option<String>,
    pub text: Option<String>,
    pub csv_source: Option<String>,
    pub image: Option<ContentPart>,
    pub image_tokens: usize,
    pub coverage: Coverage,
    pub reason: String,
}

#[derive(Debug, Clone)]
pub struct PlannedAttachment {
    pub id: String,
    pub filename: String,
    pub inclusion_mode: InclusionMode,
    pub reason: String,
    pub token_count: usize,
    pub full_token_count: Option<usize>,
    pub coverage: Coverage,
    pub native_image_tokens: usize,
    pub parts: Vec<ContentPart>,
}

impl PlannedAttachment {
    /// Budget exemptions do not change the token estimates reported for the request.
    pub(crate) fn budget_token_count(&self, config: &FileContextConfig) -> usize {
        if config.native_file_formats_bypass_limit
            && self
                .parts
                .iter()
                .any(|part| matches!(part, ContentPart::Image(_)))
        {
            0
        } else {
            self.token_count
        }
    }
}

impl Attachment {
    fn bypasses_limits(&self, config: &FileContextConfig) -> bool {
        config.native_file_formats_bypass_limit
            && self.coverage == Coverage::Complete
            && self.image.is_some()
    }

    fn header(&self) -> String {
        match &self.uri {
            Some(uri) => format!(
                "File:\nfile name: {}\nfile reference: {uri}\nfile_id: erato_file_id:{}\n",
                self.filename, self.id
            ),
            None => format!("Virtual inline file:\nfile name: {}\n", self.filename),
        }
    }

    pub(crate) fn render(&self, text: &str, preview: bool) -> String {
        format!(
            "{}{}\n---\n{text}\n---",
            self.header(),
            if preview {
                "Preview included. Content is omitted; this excerpt is not the complete file."
            } else {
                "File contents"
            }
        )
    }

    fn reference(&self) -> String {
        let notice = if self.coverage == Coverage::Unavailable {
            self.reason.as_str()
        } else {
            "File contents omitted from model context."
        };
        format!("{}Reference only. {notice}", self.header())
    }

    fn plan(
        &self,
        mode: InclusionMode,
        reason: &str,
        rendered: String,
        full: Option<usize>,
    ) -> PlannedAttachment {
        let mut cost = tokens(&rendered);
        let mut parts = vec![ContentPart::Text(ContentPartText { text: rendered })];
        if mode == InclusionMode::Full
            && let Some(image) = &self.image
        {
            cost += self.image_tokens;
            parts.push(image.clone());
        }
        PlannedAttachment {
            id: self.id.clone(),
            filename: self.filename.clone(),
            inclusion_mode: mode,
            reason: reason.into(),
            token_count: cost,
            full_token_count: full,
            coverage: self.coverage,
            native_image_tokens: if mode == InclusionMode::Full {
                self.image_tokens
            } else {
                0
            },
            parts,
        }
    }

    fn preview(
        &self,
        config: &FileContextConfig,
        full: Option<usize>,
        reason: &str,
    ) -> PlannedAttachment {
        let image_metadata;
        let text = if let Some(text) = self.csv_source.as_deref().or(self.text.as_deref()) {
            text
        } else if self.image.is_some() {
            image_metadata =
                "Native image content omitted; only file metadata is included.".to_string();
            &image_metadata
        } else {
            return self.plan(InclusionMode::ReferenceOnly, reason, self.reference(), full);
        };
        let fits = |excerpt: &str| {
            config.max_preview_tokens_per_file == 0
                || tokens(&self.render(excerpt, true)) <= config.max_preview_tokens_per_file
        };
        if !fits("") {
            return self.plan(
                InclusionMode::ReferenceOnly,
                "preview_metadata_exceeds_limit",
                self.reference(),
                full,
            );
        }
        let excerpt = if self.filename.to_lowercase().ends_with(".csv") {
            csv_preview(text, config, &fits)
        } else {
            let max_chars = config.preview.text_max_chars;
            let candidate: String = text
                .chars()
                .take(if max_chars == 0 {
                    usize::MAX
                } else {
                    max_chars
                })
                .collect();
            // Search only the per-file preview limit. Never shrink to pack an aggregate budget.
            if fits(&candidate) {
                candidate
            } else {
                let boundaries: Vec<usize> = candidate
                    .char_indices()
                    .map(|(i, _)| i)
                    .chain(std::iter::once(candidate.len()))
                    .collect();
                let (mut lo, mut hi) = (0, boundaries.len() - 1);
                while lo < hi {
                    let mid = lo + (hi - lo).div_ceil(2);
                    if fits(&candidate[..boundaries[mid]]) {
                        lo = mid;
                    } else {
                        hi = mid - 1;
                    }
                }
                candidate[..boundaries[lo]].to_string()
            }
        };
        self.plan(
            InclusionMode::Preview,
            reason,
            self.render(&excerpt, true),
            full,
        )
    }
}

fn csv_preview(text: &str, config: &FileContextConfig, fits: &impl Fn(&str) -> bool) -> String {
    let p = &config.preview;
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_reader(text.as_bytes());
    let mut excerpt = String::new();
    for (index, record) in reader.records().enumerate() {
        if p.csv_max_sample_rows != 0 && index > p.csv_max_sample_rows {
            break;
        }
        let Ok(record) = record else {
            break;
        };
        let columns = if p.csv_max_columns == 0 {
            record.len()
        } else {
            record.len().min(p.csv_max_columns)
        };
        let fields: Vec<String> = record
            .iter()
            .take(columns)
            .map(|field| {
                if p.csv_max_field_chars == 0 {
                    field.to_string()
                } else {
                    let mut s: String = field.chars().take(p.csv_max_field_chars).collect();
                    if s.len() < field.len() {
                        s.push_str("…[field omitted]");
                    }
                    s
                }
            })
            .collect();
        let mut writer = csv::Writer::from_writer(Vec::new());
        if writer.write_record(&fields).is_err() {
            break;
        }
        let Ok(bytes) = writer.into_inner() else {
            break;
        };
        let mut next = excerpt.clone();
        next.push_str(&String::from_utf8_lossy(&bytes));
        if columns < record.len() {
            next.push_str(&format!("[{} columns omitted]\n", record.len() - columns));
        }
        if !fits(&next) {
            break;
        }
        excerpt = next;
    }
    excerpt
}

/// Apply independent full-inclusion gates, then one collective fallback at each level.
pub fn plan_attachments(
    files: &[Attachment],
    config: &FileContextConfig,
    context_size: usize,
) -> Result<Vec<PlannedAttachment>, Report> {
    config.validate()?;
    let mut plans = Vec::with_capacity(files.len());
    for file in files {
        let full = if file.coverage == Coverage::Complete {
            Some(file.plan(
                InclusionMode::Full,
                "complete",
                file.render(file.text.as_deref().unwrap_or(""), false),
                None,
            ))
        } else {
            None
        };
        let cost = full.as_ref().map(|p| p.token_count);
        let eligible = cost.is_some_and(|cost| {
            file.bypasses_limits(config)
                || config.max_inline_tokens_per_file == 0
                || cost <= config.max_inline_tokens_per_file
        });
        let plan = if eligible {
            let mut p = full.unwrap();
            p.full_token_count = cost;
            p
        } else {
            file.preview(
                config,
                cost,
                if file.coverage == Coverage::Complete {
                    "per_file_limit"
                } else {
                    &file.reason
                },
            )
        };
        plans.push(plan);
    }
    let fits = |plans: &[PlannedAttachment]| {
        config.attachment_budget(context_size).is_none_or(|budget| {
            plans
                .iter()
                .map(|p| p.budget_token_count(config))
                .sum::<usize>()
                <= budget
        })
    };
    if !fits(&plans) {
        plans = files
            .iter()
            .zip(&plans)
            .map(|(f, p)| {
                if f.bypasses_limits(config) {
                    p.clone()
                } else {
                    f.preview(config, p.full_token_count, "aggregate_budget")
                }
            })
            .collect();
        if !fits(&plans) {
            plans = files
                .iter()
                .zip(&plans)
                .map(|(f, p)| {
                    if f.bypasses_limits(config) {
                        return p.clone();
                    }
                    f.plan(
                        InclusionMode::ReferenceOnly,
                        "aggregate_budget",
                        f.reference(),
                        p.full_token_count,
                    )
                })
                .collect();
            if !fits(&plans) {
                bail!(
                    "Attachment budget exceeded: file references alone exceed the configured attachment budget"
                );
            }
        }
    }
    for plan in &plans {
        tracing::debug!(file_id = %plan.id, mode = ?plan.inclusion_mode, reason = %plan.reason, included_tokens = plan.token_count, full_tokens = ?plan.full_token_count, coverage = ?plan.coverage, "Planned attachment context");
    }
    Ok(plans)
}

/// Retention limit, not a parser peak-memory limit. Does not alter original bytes.
pub(crate) fn limit_extracted_text(attachment: &mut Attachment, max_chars: usize) {
    if max_chars == 0 {
        return;
    }
    let mut truncated = false;
    if let Some(text) = &mut attachment.text {
        let end = text
            .char_indices()
            .nth(max_chars)
            .map(|(i, _)| i)
            .unwrap_or(text.len());
        truncated |= end < text.len();
        text.truncate(end);
    }
    if let Some(source) = &mut attachment.csv_source {
        let end = source
            .char_indices()
            .nth(max_chars)
            .map(|(i, _)| i)
            .unwrap_or(source.len());
        if end < source.len() {
            // Only retain complete CSV records, including quoted multiline cells.
            let mut reader = csv::ReaderBuilder::new()
                .has_headers(false)
                .flexible(true)
                .from_reader(source.as_bytes());
            let mut record = csv::StringRecord::new();
            let mut complete_end = 0;
            while let Ok(true) = reader.read_record(&mut record) {
                let next = reader.position().byte() as usize;
                if next > end {
                    break;
                }
                complete_end = next;
            }
            source.truncate(complete_end);
            truncated = true;
        }
    }
    if truncated {
        attachment.coverage = Coverage::Partial;
        attachment.reason = "extracted_character_limit".into();
    }
}

/// Shared eager-extraction decisions for persisted and transient inputs.
/// Returns true when the request can use this partial/reference artifact directly.
pub(crate) fn prepare_eager_attachment(
    attachment: &mut Attachment,
    bytes: &[u8],
    config: &FileContextConfig,
    limits: &erato_config::config::FileExtractionLimits,
) -> bool {
    if limits.max_input_bytes > 0 && bytes.len() > limits.max_input_bytes {
        attachment.reason = "extraction_input_limit: content was not extracted".into();
        return true;
    }
    let extension = attachment
        .filename
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    let Ok(raw_text) = std::str::from_utf8(bytes) else {
        return false;
    };
    if extension == "csv" {
        attachment.csv_source = Some(raw_text.to_string());
    }
    // Raw CSV tokenization is not an inclusion test: extraction can remove large
    // amounts of quoting/whitespace. Use a conservative lower bound derived from
    // the tokenizer vocabulary and bytes that survive text/table rendering.
    if ((limits.bounded_text_preview && config.max_inline_tokens_per_file > 0)
        || limits.max_extracted_chars > 0)
        && matches!(extension.as_str(), "csv" | "txt")
        && !raw_text.contains("erato:teams-transcript")
    {
        static MAX_TOKEN_BYTES: LazyLock<usize> = LazyLock::new(|| {
            (0..)
                .map_while(|rank| TOKENIZER.decode_bytes(&[rank]).ok())
                .map(|bytes| bytes.len())
                .max()
                .unwrap_or(1)
        });
        let retained_bytes = |text: &str| {
            text.chars()
                .filter(|c| !c.is_whitespace() && *c != '\0')
                .map(char::len_utf8)
                .sum::<usize>()
        };
        let token_bound = if limits.bounded_text_preview && config.max_inline_tokens_per_file > 0 {
            config
                .max_inline_tokens_per_file
                .saturating_mul(*MAX_TOKEN_BYTES)
        } else {
            usize::MAX
        };
        // UTF-8 needs at most four bytes per scalar; this lower bound also
        // permits producer-side stopping under an independent character limit.
        let character_bound = if limits.max_extracted_chars > 0 {
            limits.max_extracted_chars.saturating_mul(4)
        } else {
            usize::MAX
        };
        let impossible_after = token_bound.min(character_bound);
        let mut count = 0usize;
        let mut end = 0;
        if extension == "csv" {
            let mut reader = csv::ReaderBuilder::new()
                .has_headers(false)
                .flexible(true)
                .from_reader(raw_text.as_bytes());
            let mut record = csv::StringRecord::new();
            while let Ok(true) = reader.read_record(&mut record) {
                count = count.saturating_add(record.iter().map(retained_bytes).sum::<usize>());
                end = reader.position().byte() as usize;
                if count > impossible_after {
                    break;
                }
            }
        } else {
            for line in raw_text.split_inclusive('\n') {
                count = count.saturating_add(retained_bytes(line));
                end += line.len();
                if count > impossible_after {
                    break;
                }
            }
        }
        if count > impossible_after {
            attachment.text = Some(raw_text[..end].to_string());
            attachment.coverage = Coverage::Partial;
            attachment.reason = "bounded_text_extraction".into();
            limit_extracted_text(attachment, limits.max_extracted_chars);
            return true;
        }
    }
    false
}

/// Provider image estimates are separate from inclusion limits. Decode only the
/// image header (never rasterize it) and do not tokenize the Base64 payload.
pub(crate) fn estimate_native_images(
    files: &mut [Attachment],
    provider: &crate::config::ChatProviderConfig,
) {
    use base64::Engine;
    for file in files {
        let Some(ContentPart::Image(image)) = &file.image else {
            continue;
        };
        let dimensions = base64::engine::general_purpose::STANDARD
            .decode(&image.base64_data)
            .ok()
            .and_then(|bytes| {
                image::ImageReader::new(std::io::Cursor::new(bytes))
                    .with_guessed_format()
                    .ok()?
                    .into_dimensions()
                    .ok()
            });
        file.image_tokens =
            image_token_estimate(dimensions, &provider.provider_kind, &provider.model_name);
    }
}

fn image_token_estimate(dimensions: Option<(u32, u32)>, provider: &str, model: &str) -> usize {
    // Unknown dimensions use a provider-sized square estimate, not zero cost.
    let (w, h) = dimensions.unwrap_or((1536, 1536));
    let (w, h) = (f64::from(w.max(1)), f64::from(h.max(1)));
    if provider.contains("anthropic") || model.contains("claude") {
        // https://platform.claude.com/docs/en/build-with-claude/vision
        let scale = (1568.0 / w.max(h))
            .min((1_150_000.0 / (w * h)).sqrt())
            .min(1.0);
        return (w * h * scale * scale / 750.0).ceil() as usize;
    }
    if provider.contains("gemini") || provider.contains("vertex") || model.contains("gemini") {
        // https://ai.google.dev/gemini-api/docs/tokens
        return if w <= 384.0 && h <= 384.0 {
            258
        } else {
            (w / 768.0).ceil() as usize * (h / 768.0).ceil() as usize * 258
        };
    }
    // https://developers.openai.com/api/docs/guides/images-vision
    if model.contains("4.1-mini") || model.contains("4.1-nano") || model.contains("o4-mini") {
        let patches = (w / 32.0).ceil() * (h / 32.0).ceil();
        let multiplier = if model.contains("nano") {
            2.46
        } else if model.contains("o4-mini") {
            1.72
        } else {
            1.62
        };
        return (patches.min(1536.0) * multiplier).ceil() as usize;
    }
    let scale = (2048.0 / w.max(h)).min(1.0);
    let (w, h) = (w * scale, h * scale);
    // High/auto detail scales large images down, but never enlarges small ones.
    let scale = (768.0 / w.min(h)).min(1.0);
    let tiles = (w * scale / 512.0).ceil() as usize * (h * scale / 512.0).ceil() as usize;
    let (base, tile) = if model.contains("4o-mini") {
        (2833, 5667)
    } else if model.starts_with("o1") || model.starts_with("o3") {
        (75, 150)
    } else {
        (85, 170)
    };
    base + tiles * tile
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(id: &str, text: &str) -> Attachment {
        Attachment {
            id: id.into(),
            filename: format!("{id}.txt"),
            uri: Some(format!("erato-file://{id}")),
            text: Some(text.into()),
            csv_source: None,
            image: None,
            image_tokens: 0,
            coverage: Coverage::Complete,
            reason: "complete".into(),
        }
    }
    fn unlimited() -> FileContextConfig {
        FileContextConfig {
            max_inline_tokens_per_file: 0,
            max_total_attachment_tokens: 0,
            max_context_fraction: 0.0,
            max_preview_tokens_per_file: 0,
            ..Default::default()
        }
    }
    #[test]
    fn extraction_input_and_character_limits_are_independent() {
        use erato_config::config::FileExtractionLimits;
        for (limit, stopped) in [(0, false), (2, true), (3, false), (4, false)] {
            let mut f = file("a", "abc");
            f.text = None;
            let limits = FileExtractionLimits {
                max_input_bytes: limit,
                bounded_text_preview: false,
                ..Default::default()
            };
            assert_eq!(
                prepare_eager_attachment(&mut f, b"abc", &unlimited(), &limits),
                stopped
            );
        }
        for (limit, expected, coverage) in [
            (0, "🙂äb", Coverage::Complete),
            (2, "🙂ä", Coverage::Partial),
            (3, "🙂äb", Coverage::Complete),
            (4, "🙂äb", Coverage::Complete),
        ] {
            let mut f = file("a", "🙂äb");
            limit_extracted_text(&mut f, limit);
            assert_eq!(f.text.as_deref(), Some(expected));
            assert_eq!(f.coverage, coverage);
        }
    }
    #[test]
    fn csv_retention_never_exposes_an_incomplete_record() {
        let mut f = file("data", "a,b\n1,2\n");
        f.csv_source = Some("a,b\n1,2\n".into());
        limit_extracted_text(&mut f, 6);
        assert_eq!(f.csv_source.as_deref(), Some("a,b\n"));
        assert_eq!(f.coverage, Coverage::Partial);
    }
    #[test]
    fn bounded_csv_does_not_confuse_discarded_whitespace_with_extracted_content() {
        let c = FileContextConfig {
            max_inline_tokens_per_file: 1,
            ..unlimited()
        };
        let mut f = file("data", "");
        f.filename = "data.csv".into();
        assert!(!prepare_eager_attachment(
            &mut f,
            format!("a,b\n{}, \n", " ".repeat(10000)).as_bytes(),
            &c,
            &Default::default()
        ));
        let original = format!("a,b\n{},value\n", "x".repeat(10000));
        assert!(prepare_eager_attachment(
            &mut f,
            original.as_bytes(),
            &c,
            &Default::default()
        ));
        assert_eq!(f.coverage, Coverage::Partial);
        assert_eq!(f.csv_source.as_deref(), Some(original.as_str()));
    }
    #[test]
    fn bounded_extraction_cannot_override_disabled_inclusion_limits() {
        let mut f = file("a", "");
        assert!(!prepare_eager_attachment(
            &mut f,
            &"word ".repeat(1000).into_bytes(),
            &unlimited(),
            &Default::default()
        ));
    }
    #[test]
    fn text_preview_character_cap_zero_and_boundary() {
        for (limit, expected) in [(0, "🙂äb"), (1, "🙂"), (3, "🙂äb")] {
            let mut c = unlimited();
            c.max_inline_tokens_per_file = 1;
            c.preview.text_max_chars = limit;
            let plans = plan_attachments(&[file("a", "🙂äb")], &c, 1).unwrap();
            let ContentPart::Text(t) = &plans[0].parts[0] else {
                panic!()
            };
            assert!(t.text.ends_with(&format!("---\n{expected}\n---")));
        }
    }
    #[test]
    fn small_native_image_survives_default_budgets() {
        use base64::Engine;

        // Match the dimensions and provider used by the image-upload E2E case.
        let mut png = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(500, 500)
            .write_to(&mut png, image::ImageFormat::Png)
            .unwrap();
        let image = crate::models::message::ContentPartImage {
            content_type: "image/png".into(),
            base64_data: base64::engine::general_purpose::STANDARD.encode(png.into_inner()),
        };
        let mut attachment = file("image", "");
        attachment.filename = "image_1.png".into();
        attachment.text = None;
        attachment.image = Some(ContentPart::Image(image.clone()));
        let mut files = [attachment];
        let provider = crate::config::ChatProviderConfig {
            provider_kind: "openai".into(),
            model_name: "gpt-4o-mini".into(),
            ..Default::default()
        };
        estimate_native_images(&mut files, &provider);
        let plans = plan_attachments(
            &files,
            &FileContextConfig {
                native_file_formats_bypass_limit: false,
                ..Default::default()
            },
            provider.model_capabilities.context_size_tokens,
        )
        .unwrap();
        assert_eq!(plans[0].inclusion_mode, InclusionMode::Full);
        assert_eq!(plans[0].native_image_tokens, 8_500);
        let ContentPart::Image(included) = &plans[0].parts[1] else {
            panic!("native image must be passed to the LLM")
        };
        assert_eq!(included.content_type, image.content_type);
        assert_eq!(included.base64_data, image.base64_data);
    }

    #[test]
    fn tile_image_estimates_do_not_enlarge_small_images() {
        for (dimensions, tiles) in [
            ((500, 500), 1),
            ((512, 512), 1),
            ((513, 512), 2),
            ((512, 513), 2),
            ((1024, 1024), 4),
            ((4096, 8192), 6),
        ] {
            assert_eq!(
                image_token_estimate(Some(dimensions), "openai", "gpt-4o-mini"),
                2833 + tiles * 5667,
                "dimensions: {dimensions:?}"
            );
        }
    }

    #[test]
    fn image_estimates_and_metadata_fallback() {
        assert_eq!(
            image_token_estimate(Some((1024, 1024)), "openai", "gpt-4o"),
            765
        );
        assert_eq!(
            image_token_estimate(Some((384, 384)), "gemini", "gemini-2.5-pro"),
            258
        );
        let mut f = file("image", "");
        f.text = None;
        f.image = Some(ContentPart::Image(
            crate::models::message::ContentPartImage {
                content_type: "image/png".into(),
                base64_data: "".into(),
            },
        ));
        f.image_tokens = 765;
        let full = plan_attachments(&[f.clone()], &unlimited(), 1).unwrap();
        assert_eq!(full[0].native_image_tokens, 765);
        let c = FileContextConfig {
            native_file_formats_bypass_limit: false,
            max_inline_tokens_per_file: 100,
            ..unlimited()
        };
        let preview = plan_attachments(&[f], &c, 1).unwrap();
        assert_eq!(preview[0].inclusion_mode, InclusionMode::Preview);
        assert_eq!(preview[0].native_image_tokens, 0);
    }

    #[test]
    fn native_files_bypass_limits_without_consuming_the_text_budget() {
        let mut native = file("image", "");
        native.text = None;
        native.image = Some(ContentPart::Image(
            crate::models::message::ContentPartImage {
                content_type: "image/png".into(),
                base64_data: "original image".into(),
            },
        ));
        native.image_tokens = 100_000;
        let mut config = FileContextConfig {
            max_inline_tokens_per_file: 1,
            max_total_attachment_tokens: 1,
            max_context_fraction: 0.01,
            ..Default::default()
        };
        let full = plan_attachments(std::slice::from_ref(&native), &config, 100).unwrap();
        assert_eq!(full[0].inclusion_mode, InclusionMode::Full);
        assert_eq!(full[0].native_image_tokens, 100_000);
        assert!(full[0].token_count > 100_000);
        assert_eq!(full[0].budget_token_count(&config), 0);
        config.native_file_formats_bypass_limit = false;
        assert!(plan_attachments(std::slice::from_ref(&native), &config, 100).is_err());

        let text = file("text", &"word ".repeat(500));
        let text_cost =
            plan_attachments(std::slice::from_ref(&text), &unlimited(), 1).unwrap()[0].token_count;
        let reference_cost = tokens(&text.reference());
        let files = [native, text];
        for (budget, mode) in [
            (text_cost, InclusionMode::Full),
            (80, InclusionMode::Preview),
            (reference_cost, InclusionMode::ReferenceOnly),
        ] {
            let config = FileContextConfig {
                max_total_attachment_tokens: budget,
                max_preview_tokens_per_file: 80,
                ..unlimited()
            };
            let plans = plan_attachments(&files, &config, 1).unwrap();
            assert_eq!(plans[0].inclusion_mode, InclusionMode::Full);
            assert_eq!(plans[0].native_image_tokens, 100_000);
            assert_eq!(plans[0].token_count, full[0].token_count);
            let ContentPart::Image(image) = &plans[0].parts[1] else {
                panic!("native image must survive collective fallback")
            };
            assert_eq!(image.base64_data, "original image");
            assert_eq!(plans[1].inclusion_mode, mode);
            assert_eq!(plans[1].budget_token_count(&config), plans[1].token_count);
        }
        let config = FileContextConfig {
            max_total_attachment_tokens: reference_cost - 1,
            ..unlimited()
        };
        assert!(plan_attachments(&files, &config, 1).is_err());
    }
    #[test]
    fn per_file_boundary_and_independent_zero() {
        let files = [file("a", &"word ".repeat(100))];
        let cost = plan_attachments(&files, &unlimited(), 1).unwrap()[0].token_count;
        for (limit, mode) in [
            (cost - 1, InclusionMode::Preview),
            (cost, InclusionMode::Full),
            (cost + 1, InclusionMode::Full),
            (0, InclusionMode::Full),
        ] {
            let c = FileContextConfig {
                max_inline_tokens_per_file: limit,
                ..unlimited()
            };
            assert_eq!(
                plan_attachments(&files, &c, 1).unwrap()[0].inclusion_mode,
                mode
            );
        }
    }
    #[test]
    fn oversized_file_does_not_demote_small_file() {
        let files = [file("big", &"word ".repeat(1000)), file("small", "hello")];
        let c = FileContextConfig {
            max_inline_tokens_per_file: 100,
            max_preview_tokens_per_file: 90,
            max_total_attachment_tokens: 200,
            ..unlimited()
        };
        let plans = plan_attachments(&files, &c, 1000).unwrap();
        assert_eq!(plans[0].inclusion_mode, InclusionMode::Preview);
        assert_eq!(plans[1].inclusion_mode, InclusionMode::Full);
        let reversed = plan_attachments(&[files[1].clone(), files[0].clone()], &c, 1000).unwrap();
        assert_eq!(reversed[0].inclusion_mode, plans[1].inclusion_mode);
        assert_eq!(reversed[1].token_count, plans[0].token_count);
    }
    #[test]
    fn collective_fallback_and_exact_aggregate_boundary() {
        let files = [
            file("a", &"word ".repeat(500)),
            file("b", &"word ".repeat(500)),
        ];
        let total: usize = plan_attachments(&files, &unlimited(), 1)
            .unwrap()
            .iter()
            .map(|p| p.token_count)
            .sum();
        let mut c = FileContextConfig {
            max_total_attachment_tokens: total,
            max_preview_tokens_per_file: 80,
            ..unlimited()
        };
        assert!(
            plan_attachments(&files, &c, 1)
                .unwrap()
                .iter()
                .all(|p| p.inclusion_mode == InclusionMode::Full)
        );
        c.max_total_attachment_tokens -= 1;
        assert!(
            plan_attachments(&files, &c, 1)
                .unwrap()
                .iter()
                .all(|p| p.inclusion_mode == InclusionMode::Preview)
        );
        c.max_total_attachment_tokens = files.iter().map(|f| tokens(&f.reference())).sum();
        assert!(
            plan_attachments(&files, &c, 1)
                .unwrap()
                .iter()
                .all(|p| p.inclusion_mode == InclusionMode::ReferenceOnly)
        );
        c.max_total_attachment_tokens -= 1;
        assert!(plan_attachments(&files, &c, 1).is_err());
    }
    #[test]
    fn fraction_changes_with_model_only_and_does_not_replace_absolute_limit() {
        let files = [file("a", &"word ".repeat(500))];
        let c = FileContextConfig {
            max_context_fraction: 0.5,
            max_preview_tokens_per_file: 80,
            ..unlimited()
        };
        assert_eq!(
            plan_attachments(&files, &c, 2000).unwrap()[0].inclusion_mode,
            InclusionMode::Full
        );
        assert_eq!(
            plan_attachments(&files, &c, 200).unwrap()[0].inclusion_mode,
            InclusionMode::Preview
        );
    }
    #[test]
    fn partial_extraction_never_full_and_virtual_has_no_uri() {
        let mut f = file("virtual", "hello");
        f.uri = None;
        f.coverage = Coverage::Partial;
        f.reason = "extraction_limit".into();
        let p = plan_attachments(&[f], &unlimited(), 1).unwrap().remove(0);
        assert_eq!(p.inclusion_mode, InclusionMode::Preview);
        assert_eq!(p.full_token_count, None);
        let ContentPart::Text(t) = &p.parts[0] else {
            panic!()
        };
        assert!(!t.text.contains("erato-file://"));
        assert!(t.text.contains("omitted"));
    }
    #[test]
    fn csv_complete_multiline_records_unicode_and_caps() {
        let mut f = file(
            "data",
            "a,b,c\n\"hello\nworld\",🙂🙂🙂,tail\nsecond,value,end\n",
        );
        f.filename = "data.csv".into();
        let mut c = FileContextConfig {
            max_inline_tokens_per_file: 1,
            ..unlimited()
        };
        c.preview.csv_max_sample_rows = 1;
        c.preview.csv_max_columns = 2;
        c.preview.csv_max_field_chars = 2;
        let p = plan_attachments(&[f.clone()], &c, 1).unwrap();
        let ContentPart::Text(t) = &p[0].parts[0] else {
            panic!()
        };
        assert!(t.text.contains("🙂🙂…[field omitted]"));
        assert!(t.text.contains("1 columns omitted"));
        assert!(!t.text.contains("second"));
        c.preview.csv_max_sample_rows = 0;
        c.preview.csv_max_columns = 0;
        c.preview.csv_max_field_chars = 0;
        let p = plan_attachments(&[f], &c, 1).unwrap();
        let ContentPart::Text(t) = &p[0].parts[0] else {
            panic!()
        };
        assert!(t.text.contains("\"hello\nworld\""));
        assert!(t.text.contains("second,value,end"));
    }
    #[test]
    fn metadata_is_counted_and_tiny_preview_allowance_uses_reference() {
        let f = file("a", &"🙂 ".repeat(200));
        let c = FileContextConfig {
            max_inline_tokens_per_file: 1,
            max_preview_tokens_per_file: 1,
            ..unlimited()
        };
        let plans = plan_attachments(&[f], &c, 1).unwrap();
        assert_eq!(plans[0].inclusion_mode, InclusionMode::ReferenceOnly);
        let ContentPart::Text(t) = &plans[0].parts[0] else {
            panic!()
        };
        assert_eq!(plans[0].token_count, tokens(&t.text));
    }
    #[test]
    fn full_path_ignores_preview_caps_and_retains_original() {
        let f = file("a", &"🙂 ".repeat(200));
        let original = f.text.clone().unwrap();
        let mut c = unlimited();
        c.max_preview_tokens_per_file = 1;
        c.preview.text_max_chars = 1;
        let plans = plan_attachments(std::slice::from_ref(&f), &c, 1).unwrap();
        assert_eq!(plans[0].inclusion_mode, InclusionMode::Full);
        let ContentPart::Text(t) = &plans[0].parts[0] else {
            panic!()
        };
        assert!(t.text.contains(&original));
        assert_eq!(f.text.unwrap(), original);
    }
}
