//! The text a voice reads: markdown turned into plain sentences a listener can follow.
//! Only the copy sent to the voice is changed; the chat keeps the text as written.

use super::readings::{Readings, ReadingsByLanguage};
use linkify::{LinkFinder, LinkKind};
use pulldown_cmark::{BrokenLink, CowStr, Event, Options, Parser, Tag, TagEnd};
use regex::Regex;
use std::borrow::Cow;
use std::sync::{Arc, LazyLock};

/// The user's language as a bare two-letter code, the form the sentence splitter recognises,
/// with the readings the voice uses in it.
#[derive(Clone)]
pub struct SpeechLanguage {
    code: String,
    readings: Option<Arc<Readings>>,
}

impl SpeechLanguage {
    /// Reduces "de-DE" or "de_DE" to "de". Callers pass the language the screen shows when it is
    /// supported, else the profile's resolved language, as Explain does. Uses the built-in
    /// readings.
    pub fn new(language: &str) -> Self {
        Self::with_readings(language, ReadingsByLanguage::built_in())
    }

    /// Like [`SpeechLanguage::new`], with the readings the configuration built.
    pub fn with_readings(language: &str, readings: &ReadingsByLanguage) -> Self {
        let code = language
            .split(['-', '_'])
            .next()
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase();
        let readings = readings.get(language);
        Self { code, readings }
    }

    pub fn code(&self) -> &str {
        &self.code
    }

    #[cfg(test)]
    pub(super) fn readings(&self) -> Option<Arc<Readings>> {
        self.readings.clone()
    }

    /// The rules sentences are split with. English text is split with German rules too: on
    /// English text they cut no sentence in our tests (they only miss a few ends, e.g. after
    /// "p.m."), while English rules cut German dates and abbreviations, and a profile that
    /// says English does not mean the reply is English.
    pub(super) fn splitter(&self) -> &str {
        match self.code() {
            "en" => "de",
            code => code,
        }
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
        Self::new("en")
    }
}

/// Ends a passage inside the text `read` returns: a replacement sentence is a sentence of its
/// own, and a finished block ends its last sentence. Never sent to the voice.
pub(super) const BREAK: char = '\u{1E}';

/// Spoken text for complete markdown. Code blocks and tables are replaced by one short
/// sentence, once per run of them; images, footnotes, struck-through text and task-list boxes
/// are left out; link targets are dropped and bare web addresses are read as their site name.
pub fn speakable(markdown: &str, language: &SpeechLanguage) -> String {
    read(markdown, language, false, Replaced::default())
        .text
        .replace(BREAK, "")
}

/// Which replacement sentences were said since the last spoken text.
#[derive(Clone, Copy, Default, PartialEq, Eq, Debug)]
pub(super) struct Replaced {
    code: bool,
    table: bool,
}

pub(super) struct Reading {
    pub text: String,
    pub replaced: Replaced,
}

enum Piece {
    Text(String),
    Code,
    Table,
}

/// `open` marks markdown that is still being written: its last piece may continue, so it gets
/// no closing full stop and no trailing space yet. A mark without a partner ("**", "_", "~",
/// "`", "[") is not spoken, whether its partner is still to come or never comes, so a reading
/// before the partner arrived starts like the one after. `replaced` carries a run of code
/// blocks and tables over from the markdown before.
pub(super) fn read(
    markdown: &str,
    language: &SpeechLanguage,
    open: bool,
    mut replaced: Replaced,
) -> Reading {
    let options = Options::ENABLE_TABLES
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS;
    // A reference whose definition is in a later block ("[Quelle][1]") is read as a link.
    let mut unresolved = |_: BrokenLink| Some((CowStr::Borrowed(""), CowStr::Borrowed("")));
    let parser = Parser::new_with_broken_link_callback(markdown, options, Some(&mut unresolved));
    let mut pieces = Vec::new();
    let mut piece = String::new();
    let mut hidden = 0usize;
    for (event, range) in parser.into_offset_iter() {
        match event {
            Event::Start(Tag::CodeBlock(_) | Tag::Table(_) | Tag::FootnoteDefinition(_)) => {
                end_piece(&mut pieces, &mut piece);
                if hidden == 0 {
                    match event {
                        Event::Start(Tag::CodeBlock(_)) => pieces.push(Piece::Code),
                        Event::Start(Tag::Table(_)) => pieces.push(Piece::Table),
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
            Event::Text(text) if hidden == 0 => {
                if !without_partner(&text, &markdown[range.end..]) {
                    piece.push_str(&text);
                }
            }
            Event::Code(text) if hidden == 0 => piece.push_str(&text),
            Event::InlineHtml(html) if hidden == 0 && is_line_break(&html) => piece.push(' '),
            Event::SoftBreak | Event::HardBreak => piece.push(' '),
            Event::Start(Tag::Emphasis | Tag::Strong | Tag::Link { .. })
            | Event::End(TagEnd::Emphasis | TagEnd::Strong | TagEnd::Link) => {}
            Event::Start(_) | Event::End(_) | Event::Rule => end_piece(&mut pieces, &mut piece),
            _ => {}
        }
    }
    end_piece(&mut pieces, &mut piece);
    pieces.retain_mut(|piece| match piece {
        Piece::Text(text) => {
            *text = clean(text);
            !text.is_empty()
        }
        _ => true,
    });

    let readings = language.readings.as_deref();
    let last = pieces.len().saturating_sub(1);
    let mut spoken = String::new();
    for (index, piece) in pieces.into_iter().enumerate() {
        let (sentence, said) = match piece {
            Piece::Text(mut text) => {
                let unfinished = open && index == last;
                if !unfinished {
                    close_sentence(&mut text);
                }
                if let Some(readings) = readings {
                    text = readings.apply(&text, !unfinished);
                }
                spoken.push_str(&text);
                if !unfinished {
                    spoken.push(' ');
                }
                replaced = Replaced::default();
                continue;
            }
            Piece::Code => (language.code_sentence(), &mut replaced.code),
            Piece::Table => (language.table_sentence(), &mut replaced.table),
        };
        if !std::mem::replace(said, true) {
            spoken.push(BREAK);
            spoken.push_str(sentence);
            spoken.push(' ');
            spoken.push(BREAK);
        }
    }
    Reading {
        text: spoken,
        replaced,
    }
}

fn end_piece(pieces: &mut Vec<Piece>, piece: &mut String) {
    if !piece.is_empty() {
        pieces.push(Piece::Text(std::mem::take(piece)));
    }
}

/// A mark the parser left as text because it has no partner. A "[" whose "]" is already there
/// stays text (`[^1]` without a definition).
fn without_partner(text: &str, after: &str) -> bool {
    match text {
        "[" => !after.contains(']'),
        _ => !text.is_empty() && text.chars().all(|c| matches!(c, '*' | '_' | '~' | '`')),
    }
}

fn is_line_break(html: &str) -> bool {
    let tag = html.trim_start_matches('<').trim_end_matches('>');
    tag.trim_end_matches('/').trim().eq_ignore_ascii_case("br")
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
    text.split(|c: char| c.is_whitespace() || c == BREAK)
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
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
    fn languages_are_reduced_to_a_bare_code() {
        for (given, code) in [("de", "de"), ("de-DE", "de"), ("en_US", "en"), ("EN", "en")] {
            assert_eq!(SpeechLanguage::new(given).code(), code, "{given}");
        }
        assert_eq!(SpeechLanguage::new("en").splitter(), "de");
        assert_eq!(SpeechLanguage::new("fr").splitter(), "fr");
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
            en("Room #3: 2 * 4 = 8, call 0800 123 #21#"),
            "Room #3: 2 * 4 = 8, call 0800 123 #21#. "
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
        let open = |markdown| read(markdown, &language, true, Replaced::default()).text;
        assert_eq!(open("# Titel\n\nDas ist"), "Titel. Das ist");
        assert_eq!(de("# Titel\n\nDas ist"), "Titel. Das ist. ");
        // A mark whose partner has not arrived is not spoken; the text after it is.
        assert_eq!(open("Gut. **Wichtig. Bitte"), "Gut. Wichtig. Bitte");
        assert_eq!(open("Gut. _Wichtig. Bitte"), "Gut. Wichtig. Bitte");
        assert_eq!(open("Gut. Noch ~~alt. Neu"), "Gut. Noch alt. Neu");
        assert_eq!(open("Gut. Siehe `code. Mehr"), "Gut. Siehe code. Mehr");
        assert_eq!(open("Gut. Siehe [Quelle. Mehr"), "Gut. Siehe Quelle. Mehr");
        assert_eq!(open("**Wichtig.** Bitte"), "Wichtig. Bitte");
        assert_eq!(open("Studie[^1]. Mehr"), "Studie. Mehr");
    }

    #[test]
    fn a_mark_without_a_partner_is_not_spoken() {
        assert_eq!(
            de("Der Preis* gilt ab heute. Es dauert ~5 Minuten. Nutze `cargo run. Siehe [1. Gut."),
            "Der Preis gilt ab heute. Es dauert 5 Minuten. Nutze cargo run. Siehe 1. Gut. "
        );
        assert_eq!(de("- **Erster.\n- Zweiter"), "Erster. Zweiter. ");
        // Not marks: a lone "*" between spaces, "_" inside a word.
        assert_eq!(
            de("Das kostet 2 * 3 Euro in snake_case und mein_bericht_final.docx."),
            "Das kostet 2 * 3 Euro in snake_case und mein_bericht_final.docx. "
        );
        // The price of the rule: a star code loses its star.
        assert_eq!(en("Dial *21# now."), "Dial 21# now. ");
    }

    #[test]
    fn a_run_of_code_blocks_and_tables_gets_one_sentence_each() {
        assert_eq!(
            de("Drei Skripte:\n\n```\na\n```\n\n```\nb\n```\n```\nc\n```\n\nFertig."),
            "Drei Skripte: Der Code steht im Chat. Fertig. "
        );
        assert_eq!(
            de("| a |\n|---|\n| 1 |\n\n![Bild](x.png)\n\n| b |\n|---|\n| 2 |\n\n```\nc\n```"),
            "Die Tabelle steht im Chat. Der Code steht im Chat. "
        );
        assert_eq!(
            de("```\na\n```\n\nErster Schritt.\n\n```\nb\n```"),
            "Der Code steht im Chat. Erster Schritt. Der Code steht im Chat. "
        );
    }

    #[test]
    fn reference_links_are_read_by_their_text() {
        assert_eq!(
            de("Siehe [Quelle][1], [Buch][] und [Heft].\n\n[1]: https://example.com"),
            "Siehe Quelle, Buch und Heft. "
        );
        assert_eq!(
            read(
                "Siehe [Quelle][1]. Gut.",
                &SpeechLanguage::new("de"),
                false,
                Replaced::default()
            )
            .text,
            "Siehe Quelle. Gut. "
        );
    }

    #[test]
    fn an_html_line_break_is_a_space() {
        assert_eq!(
            de("Text<br>mit<br/>HTML<br />und <BR> mehr.\n\n- eins<br>zwei"),
            "Text mit HTML und mehr. eins zwei. "
        );
        assert_eq!(de("Ein <b>fettes</b> Wort."), "Ein fettes Wort. ");
    }
}
