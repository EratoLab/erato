//! Text that external software authored and a user interface will show.
//!
//! MCP servers own their tool names, titles and descriptions. Wherever the
//! API hands such text to a client it passes through here first, so a client
//! can render it as inert text of a known size without bidi or control
//! character tricks. Nothing is escaped: markup stays literal and the client
//! is responsible for not interpreting it.

use unicode_normalization::UnicodeNormalization;

/// Cap for a tool's name or title.
pub const MAX_DISPLAY_NAME_CHARS: usize = 200;
/// Cap for a tool's description.
pub const MAX_DISPLAY_DESCRIPTION_CHARS: usize = 4_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SanitizedDisplayText {
    pub text: String,
    /// Whether the cap cut the text short.
    pub truncated: bool,
}

/// Bidi overrides, embeddings, isolates and marks: any of them can make the
/// rendered order of a string differ from its logical order.
fn is_bidi_control(c: char) -> bool {
    matches!(
        c,
        '\u{200E}' | '\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}'
    )
}

fn is_dropped(c: char) -> bool {
    (c.is_control() && c != '\n' && c != '\t') || is_bidi_control(c)
}

/// Strip control and bidi characters, NFC-normalize, collapse runs of blank
/// lines, trim and cap at `max_chars` characters.
pub fn sanitize_display_text(text: &str, max_chars: usize) -> SanitizedDisplayText {
    let mut cleaned = String::with_capacity(text.len());
    let mut newline_run = 0usize;
    for c in text.chars().filter(|c| !is_dropped(*c)).nfc() {
        if c == '\n' {
            newline_run += 1;
            if newline_run > 2 {
                continue;
            }
        } else {
            newline_run = 0;
        }
        cleaned.push(c);
    }

    let trimmed = cleaned.trim();
    let mut chars = trimmed.chars();
    let text: String = chars.by_ref().take(max_chars).collect();
    let truncated = chars.next().is_some();
    SanitizedDisplayText {
        text: if truncated {
            text.trim_end().to_string()
        } else {
            text
        },
        truncated,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clean(text: &str) -> String {
        sanitize_display_text(text, MAX_DISPLAY_DESCRIPTION_CHARS).text
    }

    #[test]
    fn markup_stays_literal() {
        let payloads = [
            "<b>bold</b> and <i>italic</i>",
            "[x](y) and ![img](http://example.com/a.png)",
            "<script>alert('x')</script>",
            "# heading\n\n- item `code` **strong**",
            "&lt;already&gt; &amp; entities",
        ];
        for payload in payloads {
            assert_eq!(clean(payload), payload, "{payload}");
        }
    }

    #[test]
    fn bidi_and_control_characters_are_stripped() {
        assert_eq!(clean("safe\u{202E}txt.exe"), "safetxt.exe");
        assert_eq!(clean("\u{2066}a\u{2067}b\u{2068}c\u{2069}"), "abc");
        assert_eq!(clean("\u{200E}left\u{200F}right"), "leftright");
        assert_eq!(clean("\u{202A}a\u{202B}b\u{202C}c\u{202D}d"), "abcd");
        assert_eq!(clean("a\u{0}b\u{7}c\u{1B}[31md\u{7F}e"), "abc[31mde");
        assert_eq!(clean("line\r\nnext"), "line\nnext");
        assert_eq!(clean("tab\tkept"), "tab\tkept");
    }

    #[test]
    fn zero_width_joiners_survive() {
        let family = "👨\u{200D}👩\u{200D}👧";
        assert_eq!(clean(family), family);
    }

    #[test]
    fn text_is_nfc_normalized() {
        assert_eq!(clean("e\u{301}"), "\u{E9}");
    }

    #[test]
    fn blank_lines_collapse_and_ends_trim() {
        assert_eq!(clean("  a\n\n\n\n\nb\n\n"), "a\n\nb");
        assert_eq!(clean("a\n\nb\nc"), "a\n\nb\nc");
        assert_eq!(clean("\n\n\u{202E}\n\n"), "");
    }

    #[test]
    fn cap_counts_characters_not_bytes() {
        let body = "ä".repeat(10);
        let cut = sanitize_display_text(&body, 4);
        assert_eq!(cut.text, "ä".repeat(4));
        assert!(cut.truncated);

        let exact = sanitize_display_text(&body, 10);
        assert_eq!(exact.text, body);
        assert!(!exact.truncated);

        let spaced = sanitize_display_text("abc def", 4);
        assert_eq!(spaced.text, "abc");
        assert!(spaced.truncated);
    }

    #[test]
    fn caps_apply_after_cleaning() {
        let text = format!("{}\u{202E}", "x".repeat(MAX_DISPLAY_NAME_CHARS));
        let cut = sanitize_display_text(&text, MAX_DISPLAY_NAME_CHARS);
        assert_eq!(cut.text.chars().count(), MAX_DISPLAY_NAME_CHARS);
        assert!(!cut.truncated);
    }
}
