use super::spoken::{SpeechLanguage, read};

/// Upper bound for one piece of spoken text, below the providers' input limits.
const MAX_CHARS: usize = 2000;
/// A block without blank lines that grows past this is read again only after it grew by an
/// eighth, so a huge block costs linear rather than quadratic time on the text stream.
const FREELY_REREAD_BYTES: usize = 4096;

/// Turns streamed markdown into spoken sentences.
///
/// Markdown is read block by block (blocks end at a blank line outside a code fence), so a
/// table or code block is never cut in half. The block still being written is read again as it
/// grows, and a sentence from it is handed out once the word after its end is complete: a
/// German date such as "am 14. November" only stays together once "November" is known.
#[derive(Default)]
pub struct Sentences {
    language: SpeechLanguage,
    block: String,
    scan: BlockScan,
    /// Spoken text of `block` already handed out.
    said: String,
    /// Spoken text of finished blocks not yet handed out.
    queued: String,
    read_at: usize,
}

impl Sentences {
    pub fn new(language: SpeechLanguage) -> Self {
        Self {
            language,
            ..Self::default()
        }
    }

    pub fn push(&mut self, markdown: &str) -> Vec<String> {
        self.block.push_str(markdown);
        while let Some(end) = self.scan.boundary(&self.block) {
            let rest = self.block.split_off(end);
            let block = std::mem::replace(&mut self.block, rest);
            self.close(&block);
        }
        let open = self.read_open_block();
        self.take(open.as_deref().unwrap_or_default(), false)
    }

    pub fn finish(&mut self) -> Vec<String> {
        let block = std::mem::take(&mut self.block);
        self.close(&block);
        self.take("", true)
    }

    fn close(&mut self, block: &str) {
        let spoken = read(block, &self.language, false);
        let from = continue_at(&spoken, &self.said);
        self.queued.push_str(&spoken[from..]);
        self.said.clear();
        self.read_at = 0;
        self.scan = BlockScan::default();
    }

    /// The not yet handed out spoken text of the block being written, if worth reading now.
    fn read_open_block(&mut self) -> Option<String> {
        let length = self.block.len();
        let wait = length.saturating_sub(FREELY_REREAD_BYTES) / 8;
        if self.scan.fence.is_some() || length < self.read_at + wait {
            return None;
        }
        self.read_at = length;
        let mut spoken = read(&self.block, &self.language, true);
        if self.block.ends_with(char::is_whitespace) && spoken.ends_with(char::is_alphanumeric) {
            spoken.push(' ');
        }
        let from = continue_at(&spoken, &self.said);
        Some(spoken.split_off(from))
    }

    fn take(&mut self, open: &str, complete: bool) -> Vec<String> {
        let split = self.queued.len();
        let text = format!("{}{open}", self.queued);
        let mut sentences = Vec::new();
        let mut at = 0;
        while let Some(length) = next_sentence(&text[at..], self.language.code(), complete) {
            let sentence = &text[at..at + length];
            if !sentence.trim().is_empty() {
                sentences.push(sentence.to_string());
            }
            at += length;
        }
        if at <= split {
            self.queued.drain(..at);
        } else {
            self.said.push_str(&text[split..at]);
            self.queued.clear();
        }
        sentences
    }
}

/// Byte length of the first sentence of `text`, once it is certain. Without `complete` the
/// text may still grow, so a boundary counts only when the next word is complete.
fn next_sentence(text: &str, language: &str, complete: bool) -> Option<usize> {
    if text.is_empty() {
        return None;
    }
    // Enough to find a sentence end within MAX_CHARS, without rereading a huge unpunctuated text.
    let window = text
        .char_indices()
        .nth(4 * MAX_CHARS)
        .map_or(text.len(), |(i, _)| i);
    let mut end = 0;
    let mut seen = false;
    for span in sentencex::segment(language, &text[..window]) {
        let blank = span.trim().is_empty();
        if seen && !blank {
            break;
        }
        end += span.len();
        seen |= !blank;
    }
    let found = if end < window {
        complete || next_word_complete(&text[end..])
    } else {
        complete && window == text.len()
    };
    let too_long = |length: usize| text[..length].chars().count() > MAX_CHARS;
    match found.then_some(end) {
        Some(end) if !too_long(end) => Some(end),
        _ if too_long(text.len()) => Some(
            text.char_indices()
                .take(MAX_CHARS)
                .filter(|(_, c)| c.is_whitespace())
                .map(|(i, c)| i + c.len_utf8())
                .last()
                .or_else(|| text.char_indices().nth(MAX_CHARS).map(|(i, _)| i))
                .unwrap_or(text.len()),
        ),
        found => found,
    }
}

fn next_word_complete(rest: &str) -> bool {
    let rest = rest.trim_start_matches(|c: char| !c.is_alphanumeric());
    rest.find(|c: char| !c.is_alphanumeric())
        .is_some_and(|end| end > 0)
}

/// Where a new reading of a block continues after the text already handed out from it. A later
/// reading can differ slightly from an earlier one (an emphasis closed later turns "*" into
/// nothing), so the fallback counts letters and digits.
fn continue_at(spoken: &str, said: &str) -> usize {
    if spoken.starts_with(said) {
        return said.len();
    }
    let mut left = said.chars().filter(|c| c.is_alphanumeric()).count();
    for (index, c) in spoken.char_indices() {
        if left == 0 && (c.is_alphanumeric() || !(c.is_whitespace() || c.is_ascii_punctuation())) {
            return index;
        }
        if c.is_alphanumeric() {
            left = left.saturating_sub(1);
        }
    }
    spoken.len()
}

/// Finds where the next top-level markdown block starts: after a blank line, at a line that is
/// not indented (an indented one still belongs to a list item), outside a code fence.
#[derive(Default)]
struct BlockScan {
    at: usize,
    /// How far the unfinished line was already searched for its end.
    searched: usize,
    fence: Option<(char, usize)>,
    after_blank: bool,
}

impl BlockScan {
    fn boundary(&mut self, markdown: &str) -> Option<usize> {
        loop {
            let from = self.searched.max(self.at);
            let line_end = markdown[from..].find('\n').map(|i| from + i + 1);
            let line = &markdown[self.at..line_end.unwrap_or(markdown.len())];
            if self.fence.is_none()
                && self.after_blank
                && line.starts_with(|c: char| !c.is_whitespace())
            {
                return Some(self.at);
            }
            let Some(line_end) = line_end else {
                self.searched = markdown.len();
                return None;
            };
            self.fence = match self.fence {
                Some(fence) if closes_fence(line, fence) => None,
                Some(fence) => Some(fence),
                None => opens_fence(line),
            };
            self.after_blank = line.trim().is_empty();
            self.at = line_end;
        }
    }
}

fn opens_fence(line: &str) -> Option<(char, usize)> {
    let line = line.trim_start();
    let mark = line.chars().next().filter(|c| matches!(c, '`' | '~'))?;
    let length = line.chars().take_while(|&c| c == mark).count();
    let info = &line[length..];
    (length >= 3 && !(mark == '`' && info.contains('`'))).then_some((mark, length))
}

fn closes_fence(line: &str, (mark, length): (char, usize)) -> bool {
    let line = line.trim();
    line.chars().count() >= length && line.chars().all(|c| c == mark)
}

#[cfg(test)]
mod tests {
    use super::super::spoken::speakable;
    use super::*;

    fn sentences(text: &str, language: &str) -> Vec<String> {
        let mut s = Sentences::new(SpeechLanguage::new(language));
        let mut out = s.push(text);
        out.extend(s.finish());
        out
    }

    fn in_pieces(text: &str, language: &str, size: usize) -> Vec<String> {
        let mut s = Sentences::new(SpeechLanguage::new(language));
        let chars: Vec<char> = text.chars().collect();
        let mut out = Vec::new();
        for piece in chars.chunks(size) {
            out.extend(s.push(&piece.iter().collect::<String>()));
        }
        out.extend(s.finish());
        out
    }

    const GERMAN: &[&str] = &[
        "Wir treffen uns am 14. November in Berlin. Danach fahren wir.",
        "Das war am 3. Mai. Dann kam der Sommer.",
        "Es kostet ca. 1.250,50 € pro Jahr. Mehr nicht.",
        "Das gilt z. B. für Äpfel und z.B. für Birnen. Gut.",
        "Wir nehmen Bus bzw. Bahn. Gut.",
        "Siehe Nr. 5 der Liste. Gut.",
        "Frau Dr. Müller kommt. Gut.",
        "Wir starten um 14.30 Uhr. Gut.",
        "Die Frist endet am 31.12.2026. Gut.",
        "Öffne bericht.pdf im Ordner. Gut.",
        "Schreib an max.muster@example.com bitte. Gut.",
        "Wir nutzen Version 2.1.3 jetzt. Gut.",
    ];

    #[test]
    fn german_sentences_stay_together() {
        let expected = [
            [
                "Wir treffen uns am 14. November in Berlin. ",
                "Danach fahren wir. ",
            ],
            ["Das war am 3. Mai. ", "Dann kam der Sommer. "],
            ["Es kostet circa 1.250,50 € pro Jahr. ", "Mehr nicht. "],
            [
                "Das gilt zum Beispiel für Äpfel und zum Beispiel für Birnen. ",
                "Gut. ",
            ],
            ["Wir nehmen Bus beziehungsweise Bahn. ", "Gut. "],
            ["Siehe Nummer 5 der Liste. ", "Gut. "],
            ["Frau Dr. Müller kommt. ", "Gut. "],
            ["Wir starten um 14.30 Uhr. ", "Gut. "],
            ["Die Frist endet am 31.12.2026. ", "Gut. "],
            ["Öffne bericht.pdf im Ordner. ", "Gut. "],
            ["Schreib an max.muster@example.com bitte. ", "Gut. "],
            ["Wir nutzen Version 2.1.3 jetzt. ", "Gut. "],
        ];
        for (text, expected) in GERMAN.iter().zip(expected) {
            assert_eq!(sentences(text, "de"), expected, "{text}");
        }
        // The splitter alone, before the abbreviations are read in full.
        for text in [
            "Es kostet ca. 1.250,50 €. Gut.",
            "Zum Beispiel z. B. so. Gut.",
            "Bus bzw. Bahn. Gut.",
            "Siehe Nr. 5. Gut.",
        ] {
            let first = next_sentence(text, "de", true).unwrap();
            assert_eq!(&text[first..], "Gut.", "{text}");
        }
    }

    #[test]
    fn a_number_before_a_new_sentence_still_ends_it() {
        assert_eq!(
            sentences("Das Treffen ist am 14. Danach fahren wir zurück.", "de"),
            ["Das Treffen ist am 14. ", "Danach fahren wir zurück. "]
        );
    }

    #[test]
    fn a_boundary_waits_until_the_next_word_is_complete() {
        let mut s = Sentences::new(SpeechLanguage::new("de"));
        assert!(s.push("Das Treffen ist am 14. N").is_empty());
        assert!(s.push("ovember in Berlin. D").is_empty());
        assert_eq!(
            s.push("anach fahren"),
            ["Das Treffen ist am 14. November in Berlin. "]
        );
        assert_eq!(s.finish(), ["Danach fahren. "]);
    }

    // Number words before a noun that is not a month, and two abbreviations the splitter does
    // not know. The model is asked to write such numbers out; "Fa." and "Inkl." are read in full
    // before splitting, so only the numbers remain split for the listener.
    #[test]
    fn known_german_limits() {
        for (text, expected) in [
            (
                "Wir landen auf dem 2. Platz. Gut.",
                &["Wir landen auf dem 2. ", "Platz. ", "Gut. "][..],
            ),
            (
                "Das Büro ist im 3. Stock. Gut.",
                &["Das Büro ist im 3. ", "Stock. ", "Gut. "],
            ),
            (
                "Das war im 1. Quartal. Gut.",
                &["Das war im 1. ", "Quartal. ", "Gut. "],
            ),
            (
                "Bei der Fa. Beispiel GmbH. Gut.",
                &["Bei der Firma Beispiel GmbH. ", "Gut. "],
            ),
            (
                "Inkl. MwSt. kostet es mehr. Gut.",
                &["Inklusive Mehrwertsteuer kostet es mehr. ", "Gut. "],
            ),
        ] {
            assert_eq!(sentences(text, "de"), expected, "{text}");
        }
        for text in ["Bei der Fa. Beispiel GmbH.", "Inkl. MwSt. kostet es mehr."] {
            assert!(
                next_sentence(text, "de", true).unwrap() < text.len(),
                "{text}"
            );
        }
    }

    #[test]
    fn english_splits_with_english_and_with_the_german_default() {
        let text =
            "Meet me at 3 p.m. today. Does that work? Mr. Smith agreed. The U.S. economy grew.";
        let expected = [
            "Meet me at 3 p.m. today. ",
            "Does that work? ",
            "Mr. Smith agreed. ",
            "The U.S. economy grew. ",
        ];
        assert_eq!(sentences(text, "en"), expected);
        assert_eq!(sentences(text, ""), expected);
        assert_eq!(
            sentences("Dr. Smith paid 3.14 euros. Next sentence! Tail", "en"),
            ["Dr. Smith paid 3.14 euros. ", "Next sentence! ", "Tail. "]
        );
    }

    #[test]
    fn pieces_give_the_same_sentences_as_the_whole_text_and_lose_nothing() {
        let markdown = [
            "## Termine\n\nDas Treffen ist am 14. November.\n\n- Erster Punkt\n- Zweiter Punkt, z. B. mit **fett gedrucktem\nText**. Danach mehr.\n\n| Ort | Zeit |\n|---|---|\n| Berlin | 14.30 Uhr |\n\nMehr unter https://www.example.com/termine. 👍🏽\n\n```rust\nlet x = 1;\n\nlet y = 2;\n```\n\nEnde am 31.12.2026",
            "Ein Satz[^1].\n\n[^1]: Die Quelle.\n\nNoch ~~alt~~ neu. Und\n\n1. eins\n\n   weiter eins\n2. zwei",
            "Inline ```code``` am Zeilenanfang:\n```nicht``` zu.\n\nDanach am 3. Mai. Gut.",
        ];
        for text in GERMAN.iter().copied().chain(markdown) {
            let whole = sentences(text, "de");
            assert_eq!(
                whole.concat(),
                speakable(text, &SpeechLanguage::new("de")),
                "{text}"
            );
            for size in 1..=7 {
                assert_eq!(
                    in_pieces(text, "de", size),
                    whole,
                    "{text} in pieces of {size}"
                );
            }
        }
    }

    #[test]
    fn a_code_block_is_never_cut_open() {
        let mut s = Sentences::new(SpeechLanguage::new("en"));
        let mut out = s.push("Intro text. Then\n\n```\nlet a = 1.\n\n");
        out.extend(s.push("Fake sentence. Here\n```\n\nAfter it. Done "));
        out.extend(s.finish());
        assert_eq!(
            out,
            [
                "Intro text. ",
                "Then. ",
                "The code is in the chat. ",
                "After it. ",
                "Done. "
            ]
        );
    }

    #[test]
    fn line_wraps_stay_with_the_surrounding_sentence() {
        let mut s = Sentences::new(SpeechLanguage::new("en"));
        assert!(s.push("A wrapped\nline without punctuation").is_empty());
        assert_eq!(
            s.push(" ends here. Next "),
            ["A wrapped line without punctuation ends here. "]
        );
    }

    #[test]
    fn long_unicode_input_is_bounded_without_losing_text() {
        let input = "文".repeat(4500);
        let mut s = Sentences::default();
        let mut segments = s.push(&input);
        segments.extend(s.finish());
        assert!(
            segments
                .iter()
                .all(|part| part.chars().count() <= MAX_CHARS)
        );
        // The paragraph had no closing punctuation, so it gets a full stop.
        assert_eq!(segments.concat(), input + ". ");
    }

    #[test]
    fn a_huge_block_is_bounded_and_streams_like_the_whole_text() {
        let text = "Wort ".repeat(8000) + "Ende. Danach";
        let whole = sentences(&text, "de");
        assert!(whole.iter().all(|part| part.chars().count() <= MAX_CHARS));
        assert_eq!(whole.concat(), speakable(&text, &SpeechLanguage::new("de")));
        assert_eq!(in_pieces(&text, "de", 13), whole);
    }

    #[test]
    fn a_reading_that_changed_continues_after_what_was_said() {
        assert_eq!(continue_at("Das ist gut. Weiter", "Das ist gut. "), 13);
        assert_eq!(continue_at("Das ist gut. Weiter", "Das ist *gut. "), 13);
        assert_eq!(continue_at("Kurz", "Das war länger. "), 4);
    }
}
