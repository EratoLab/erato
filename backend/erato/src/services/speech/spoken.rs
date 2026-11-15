//! The text a voice reads: markdown turned into plain sentences a listener can follow.
//! Only the copy sent to the voice is changed; the chat keeps the text as written.

use super::readings::Readings;
use linkify::{LinkFinder, LinkKind};
use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use regex::Regex;
use std::borrow::Cow;
use std::sync::LazyLock;

/// The user's language as a bare two-letter code, the form the sentence splitter recognises.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpeechLanguage(String);

impl SpeechLanguage {
    /// Accepts "de", "de-DE" or "de_DE". Anything unusable becomes German: most of our users
    /// speak it, and the German splitter made no wrong splits on English text.
    pub fn new(language: &str) -> Self {
        let code = language
            .split(['-', '_'])
            .next()
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase();
        let usable = (2..=3).contains(&code.len()) && code.bytes().all(|b| b.is_ascii_lowercase());
        Self(if usable { code } else { "de".into() })
    }

    pub fn code(&self) -> &str {
        &self.0
    }

    fn table_sentence(&self) -> &'static str {
        match self.code() {
            "de" => "Die Tabelle steht im Chat.",
            "fr" => "Le tableau est dans le chat.",
            "es" => "La tabla está en el chat.",
            "pl" => "Tabela jest w czacie.",
            _ => "The table is in the chat.",
        }
    }

    fn code_sentence(&self) -> &'static str {
        match self.code() {
            "de" => "Der Code steht im Chat.",
            "fr" => "Le code est dans le chat.",
            "es" => "El código está en el chat.",
            "pl" => "Kod jest w czacie.",
            _ => "The code is in the chat.",
        }
    }
}

impl Default for SpeechLanguage {
    fn default() -> Self {
        Self::new("")
    }
}

/// Spoken text for complete markdown. Code blocks and tables are replaced by one short
/// sentence each; images, footnotes, struck-through text and task-list boxes are left out;
/// link targets are dropped and bare web addresses are read as their site name.
pub fn speakable(markdown: &str, language: &SpeechLanguage) -> String {
    read(markdown, language, false)
}

/// `open` marks markdown that is still being written: its last piece may continue, so it gets
/// no closing full stop and no trailing space yet.
pub(super) fn read(markdown: &str, language: &SpeechLanguage, open: bool) -> String {
    let options = Options::ENABLE_TABLES
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS;
    let mut pieces = Vec::new();
    let mut piece = String::new();
    let mut hidden = 0usize;
    for event in Parser::new_ext(markdown, options) {
        match event {
            Event::Start(Tag::CodeBlock(_) | Tag::Table(_) | Tag::FootnoteDefinition(_)) => {
                end_piece(&mut pieces, &mut piece);
                if hidden == 0 {
                    match event {
                        Event::Start(Tag::CodeBlock(_)) => {
                            pieces.push(Cow::Borrowed(language.code_sentence()))
                        }
                        Event::Start(Tag::Table(_)) => {
                            pieces.push(Cow::Borrowed(language.table_sentence()))
                        }
                        _ => {}
                    }
                }
                hidden += 1;
            }
            Event::Start(Tag::Image { .. } | Tag::Strikethrough) => hidden += 1,
            Event::End(
                TagEnd::CodeBlock
                | TagEnd::Table
                | TagEnd::FootnoteDefinition
                | TagEnd::Image
                | TagEnd::Strikethrough,
            ) => hidden -= 1,
            Event::Text(text) | Event::Code(text) if hidden == 0 => piece.push_str(&text),
            Event::SoftBreak | Event::HardBreak => piece.push(' '),
            Event::Start(Tag::Emphasis | Tag::Strong | Tag::Link { .. })
            | Event::End(TagEnd::Emphasis | TagEnd::Strong | TagEnd::Link) => {}
            Event::Start(_) | Event::End(_) | Event::Rule => end_piece(&mut pieces, &mut piece),
            _ => {}
        }
    }
    end_piece(&mut pieces, &mut piece);

    let readings = Readings::for_language(language);
    let last = pieces.len().saturating_sub(1);
    let mut spoken = String::new();
    for (index, piece) in pieces.into_iter().enumerate() {
        let unfinished = open && index == last;
        let mut piece = piece.into_owned();
        if !unfinished {
            close_sentence(&mut piece);
        }
        if let Some(readings) = readings {
            piece = readings.apply(&piece, !unfinished);
        }
        spoken.push_str(&piece);
        if !unfinished {
            spoken.push(' ');
        }
    }
    spoken
}

fn end_piece(pieces: &mut Vec<Cow<'static, str>>, piece: &mut String) {
    let text = clean(&std::mem::take(piece));
    if !text.is_empty() {
        pieces.push(Cow::Owned(text));
    }
}

static FOOTNOTE_MARK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[\^[^\]\s]+\]").expect("valid footnote pattern"));

// Whole emoji sequences as Unicode TS #51 describes them: keycaps, flags, and pictographs with
// their presentation selector, skin tone, tag sequence and joined parts. `Extended_Pictographic`
// rather than `Emoji`, which would also take digits, "#" and "*".
static EMOJI: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(concat!(
        r"[0-9#*]\x{FE0F}?\x{20E3}",
        r"|\p{Regional_Indicator}+",
        r"|(?:\p{Extended_Pictographic}|\p{Emoji_Modifier})[\x{FE0E}\x{FE0F}]?\p{Emoji_Modifier}?",
        r"(?:[\x{E0020}-\x{E007E}]+\x{E007F})?",
        r"(?:\x{200D}(?:\p{Extended_Pictographic}|\p{Emoji_Modifier})[\x{FE0E}\x{FE0F}]?\p{Emoji_Modifier}?)*",
        r"|[\x{FE0F}\x{20E3}\x{E0020}-\x{E007F}]",
    ))
    .expect("valid emoji pattern")
});

fn clean(text: &str) -> String {
    let text = FOOTNOTE_MARK.replace_all(text, "");
    let text = speak_links(&text);
    let text = EMOJI.replace_all(&text, "");
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

const CLOSING_QUOTES: &[char] = &['"', '\'', '“', '”', '‘', '’', '»', '«', '›', '‹', '„', '‚'];

/// A heading, list item or paragraph without closing punctuation would run into the next one.
fn close_sentence(text: &mut String) {
    let end = text
        .trim_end_matches(|c: char| CLOSING_QUOTES.contains(&c) || matches!(c, ')' | ']' | '}'));
    if !end.ends_with(['.', '!', '?', '…', ':', ';', ',', '。', '！', '？']) {
        text.push('.');
    }
}

// linkify needs "https://" or similar; without it, it also takes "bericht.pdf" for a link.
static WWW: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\bwww\.[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+(?:[/?#][^\s<>]*)?")
        .expect("valid address pattern")
});

/// Bare web addresses are read as their site name; mail addresses stay as they are.
pub(super) fn speak_links(text: &str) -> Cow<'_, str> {
    let mut finder = LinkFinder::new();
    finder.kinds(&[LinkKind::Url]);
    let mut links: Vec<(usize, &str)> = finder
        .links(text)
        .map(|link| (link.start(), link.as_str().trim_end_matches(CLOSING_QUOTES)))
        .collect();
    for found in WWW.find_iter(text) {
        let after_dot_or_at = matches!(
            text[..found.start()].chars().next_back(),
            Some('.' | '@' | '/')
        );
        let inside_link = links
            .iter()
            .any(|&(start, link)| found.start() < start + link.len() && start < found.end());
        if !after_dot_or_at && !inside_link {
            let address = found
                .as_str()
                .trim_end_matches(|c: char| CLOSING_QUOTES.contains(&c) || ".,;:!?)]}".contains(c));
            links.push((found.start(), address));
        }
    }
    if links.is_empty() {
        return Cow::Borrowed(text);
    }
    links.sort_unstable();
    let mut spoken = String::with_capacity(text.len());
    let mut at = 0;
    for (start, address) in links {
        if let Some(site) = site_name(address) {
            spoken.push_str(&text[at..start]);
            spoken.push_str(site);
            at = start + address.len();
        }
    }
    spoken.push_str(&text[at..]);
    Cow::Owned(spoken)
}

fn site_name(address: &str) -> Option<&str> {
    let rest = match address.split_once("://") {
        Some((_, rest)) => rest,
        None => strip_www(address).map(|_| address)?,
    };
    let host = rest.split(['/', '?', '#']).next()?;
    let host = host.rsplit_once('@').map_or(host, |(_, host)| host);
    let host = match host.rsplit_once(':') {
        Some((name, port)) if port.bytes().all(|b| b.is_ascii_digit()) => name,
        _ => host,
    };
    let host = strip_www(host).unwrap_or(host);
    (!host.is_empty()).then_some(host)
}

fn strip_www(host: &str) -> Option<&str> {
    host.get(..4)
        .filter(|prefix| prefix.eq_ignore_ascii_case("www."))
        .map(|_| &host[4..])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn de(markdown: &str) -> String {
        speakable(markdown, &SpeechLanguage::new("de"))
    }

    fn en(markdown: &str) -> String {
        speakable(markdown, &SpeechLanguage::new("en"))
    }

    #[test]
    fn languages_are_reduced_to_a_bare_code_with_german_as_fallback() {
        for (given, code) in [
            ("de", "de"),
            ("de-DE", "de"),
            ("en_US", "en"),
            ("EN", "en"),
            ("", "de"),
            ("*", "de"),
        ] {
            assert_eq!(SpeechLanguage::new(given).code(), code, "{given}");
        }
    }

    #[test]
    fn speaks_visible_prose_but_omits_code_and_images() {
        assert_eq!(
            en(
                "Hello [world](https://example.com).\n\n```rs\nlet secret = 1;\n```\n\n![image](x.png)"
            ),
            "Hello world. The code is in the chat. "
        );
    }

    #[test]
    fn each_table_is_replaced_by_one_sentence_in_the_users_language() {
        let markdown = "Hier die Zahlen:\n\n| Ort | Anzahl |\n|---|---|\n| Berlin | 12 |\n\nUnd noch eine:\n| A |\n|---|\n| 7 |\n\nEnde";
        assert_eq!(
            de(markdown),
            "Hier die Zahlen: Die Tabelle steht im Chat. Und noch eine: Die Tabelle steht im Chat. Ende. "
        );
        assert_eq!(en("| a |\n|---|\n| 1 |"), "The table is in the chat. ");
        assert_eq!(de("```\ncode\n```"), "Der Code steht im Chat. ");
    }

    #[test]
    fn footnotes_struck_text_and_task_boxes_are_not_spoken() {
        assert_eq!(
            de("Das steht in der Studie[^1]. Mehr nicht.\n\n[^1]: Müller, Seite 4."),
            "Das steht in der Studie. Mehr nicht. "
        );
        assert_eq!(
            de("Das steht in der Studie[^quelle]."),
            "Das steht in der Studie. "
        );
        assert_eq!(
            de("Wir treffen uns ~~Montag~~ Dienstag."),
            "Wir treffen uns Dienstag. "
        );
        assert_eq!(
            de("- [ ] Milch kaufen\n- [x] Brot holen"),
            "Milch kaufen. Brot holen. "
        );
        assert_eq!(de("Es dauert ~5 Minuten."), "Es dauert ~5 Minuten. ");
    }

    #[test]
    fn emoji_sequences_are_removed_whole() {
        assert_eq!(
            en(
                "Done 👍🏽 family 👨‍👩‍👧 flag 🇩🇪 key 1️⃣ #️⃣ pride 🏳️‍🌈 scotland 🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F} heart ❤️ ok ✅"
            ),
            "Done family flag key pride scotland heart ok. "
        );
        assert_eq!(
            en("Room #3: 2 * 4 = 8, call 0800 123 *21#"),
            "Room #3: 2 * 4 = 8, call 0800 123 *21#. "
        );
        assert_eq!(en("🚀"), "");
    }

    #[test]
    fn bare_addresses_are_read_as_their_site_name() {
        assert_eq!(
            en(
                "See https://www.example.com/path?x=1, „https://example.org/a“ and www.beispiel.de/seite."
            ),
            "See example.com, „example.org“ and beispiel.de. "
        );
        assert_eq!(
            en(
                "Docs: https://user@docs.example.net:8443/x#y (mirror: <https://mirror.example.com/>)"
            ),
            "Docs: docs.example.net (mirror: mirror.example.com). "
        );
        for untouched in [
            "z.B. am 14.11.2026 steht es in bericht.pdf, Mail an max.muster@example.com",
            "Version 2.1.3, 14.30 Uhr, 31.12.2026",
        ] {
            assert_eq!(speak_links(untouched), untouched);
        }
    }

    #[test]
    fn headings_list_items_and_paragraphs_end_with_a_full_stop() {
        assert_eq!(
            de(
                "## Ergebnis\n\n- Erster Punkt\n- Zweiter Punkt!\n  - Unterpunkt\n\n1. Schritt: öffnen\n2. (siehe oben)\n\nFazit"
            ),
            "Ergebnis. Erster Punkt. Zweiter Punkt! Unterpunkt. Schritt: öffnen. (siehe oben). Fazit. "
        );
        assert_eq!(de("Er sagte „Ja.“"), "Er sagte „Ja.“ ");
    }

    #[test]
    fn open_markdown_leaves_its_last_piece_unfinished() {
        let language = SpeechLanguage::new("de");
        assert_eq!(
            read("# Titel\n\nDas ist", &language, true),
            "Titel. Das ist"
        );
        assert_eq!(
            read("# Titel\n\nDas ist", &language, false),
            "Titel. Das ist. "
        );
    }
}
