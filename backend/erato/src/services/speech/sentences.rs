use super::spoken::{BREAK, Replaced, SpeechLanguage, read};

/// Upper bound for one piece of spoken text, below the providers' input limits.
const MAX_CHARS: usize = 2000;
/// A block without blank lines that grows past this is read again only after it grew by an
/// eighth, so a huge block costs linear rather than quadratic time on the text stream.
const FREELY_REREAD_BYTES: usize = 4096;

/// Turns streamed markdown into spoken sentences.
///
/// Markdown is read block by block (blocks end at a blank line outside a code fence), so a
/// table or code block is never cut in half, and a finished block ends a passage. The block
/// still being written is read again as it grows, but only as far as its meaning is settled:
/// a line that may still become a table or a code fence waits for the next line. A sentence
/// from it is handed out once the word after its end is complete: a German date such as "am 14.
/// November" only stays together once "November" is known. A replacement sentence ("Der Code
/// steht im Chat.") is a sentence of its own and is handed out as soon as the block is known.
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
    replaced: Replaced,
    /// `block` was read while its code fence was open; until the fence closes, a new reading
    /// cannot say more.
    read_in_fence: bool,
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
        let reading = read(block, &self.language, false, self.replaced);
        let from = continue_at(&reading.text, &self.said);
        self.queued.push_str(&reading.text[from..]);
        self.queued.push(BREAK);
        self.replaced = reading.replaced;
        self.said.clear();
        self.read_at = 0;
        self.read_in_fence = false;
        self.scan = BlockScan::default();
    }

    /// The not yet handed out spoken text of the block being written, if worth reading now.
    fn read_open_block(&mut self) -> Option<String> {
        let length = self.block.len();
        let wait = length.saturating_sub(FREELY_REREAD_BYTES) / 8;
        let in_fence = self.scan.fence.is_some();
        if length < self.read_at + wait || (in_fence && self.read_in_fence) {
            return None;
        }
        self.read_at = length;
        self.read_in_fence = in_fence;
        let settled = &self.block[..settled_end(&self.block)];
        let mut spoken = read(settled, &self.language, true, self.replaced).text;
        if settled.ends_with(char::is_whitespace) && spoken.ends_with(char::is_alphanumeric) {
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
        loop {
            // Text before a break is final, so its last sentence needs no next word.
            let (end, settled) = match text[at..].find(BREAK) {
                Some(index) => (at + index, true),
                None => (text.len(), complete),
            };
            while let Some(length) =
                next_sentence(&text[at..end], self.language.splitter(), settled)
            {
                let sentence = &text[at..at + length];
                if !sentence.trim().is_empty() {
                    sentences.push(sentence.to_string());
                }
                at += length;
            }
            if at < end || end == text.len() {
                break;
            }
            at += BREAK.len_utf8();
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

/// How far the markdown of the block being written has a settled meaning. The line being
/// written may still open a code fence or be a table row, and the line before it may be a table
/// header while the line being written may still become the row under it that makes the table.
fn settled_end(block: &str) -> usize {
    let line_start = block.rfind('\n').map_or(0, |index| index + 1);
    let line = &block[line_start..];
    let mut end = if may_change(line) {
        line_start
    } else {
        block.len()
    };
    if line_start > 0 && line.chars().all(is_delimiter_char) {
        let previous_start = block[..line_start - 1]
            .rfind('\n')
            .map_or(0, |index| index + 1);
        let previous = &block[previous_start..line_start];
        if previous.contains('|') && !is_delimiter_row(previous) {
            end = previous_start;
        }
    }
    end
}

fn may_change(line: &str) -> bool {
    let line = line.trim_start();
    line.contains('|')
        || ["```", "~~~"]
            .iter()
            .any(|fence| line.starts_with(fence) || (!line.is_empty() && fence.starts_with(line)))
}

fn is_delimiter_char(c: char) -> bool {
    matches!(c, '|' | '-' | ':' | ' ' | '\t')
}

fn is_delimiter_row(line: &str) -> bool {
    let line = line.trim();
    line.contains('-') && line.chars().all(is_delimiter_char)
}

/// The months sentencex keeps after a number ("am 14. November").
const MONTHS: [&str; 12] = [
    "Januar",
    "Februar",
    "März",
    "April",
    "Mai",
    "Juni",
    "Juli",
    "August",
    "September",
    "Oktober",
    "November",
    "Dezember",
];

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
        // Never directly after a full stop: "1.º" is one word.
        let glued = text[..end].ends_with('.');
        if seen && !blank && !glued && !(language == "de" && month_after_number(&text[..end], span))
        {
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

/// sentencex 0.1.35 recognises the month only when a space or full stop follows it, so it
/// splits "am 14. November, danach" and "Am 3. Mai: Treffen".
fn month_after_number(before: &str, after: &str) -> bool {
    let mut end = before.trim_end().chars().rev();
    end.next() == Some('.')
        && end.next().is_some_and(|c| c.is_ascii_digit())
        && after.split_whitespace().next().is_some_and(|word| {
            MONTHS.contains(&word.trim_end_matches(|c: char| !c.is_alphanumeric()))
        })
}

fn next_word_complete(rest: &str) -> bool {
    let rest = rest.trim_start_matches(|c: char| !c.is_alphanumeric());
    rest.find(|c: char| !c.is_alphanumeric())
        .is_some_and(|end| end > 0)
}

/// Where a new reading of a block continues after the text already handed out from it. Text is
/// handed out only once its meaning is settled, so a new reading starts with it; should it
/// still differ, the fallback counts letters and digits and resumes at a word start.
fn continue_at(spoken: &str, said: &str) -> usize {
    if spoken.starts_with(said) {
        return said.len();
    }
    let mut left = said.chars().filter(|c| c.is_alphanumeric()).count();
    let mut previous = None;
    for (index, c) in spoken.char_indices() {
        let word_start = !previous.is_some_and(char::is_alphanumeric);
        if left == 0
            && word_start
            && (c.is_alphanumeric() || !(c.is_whitespace() || c.is_ascii_punctuation()))
        {
            return index;
        }
        if c.is_alphanumeric() {
            left = left.saturating_sub(1);
        }
        previous = Some(c);
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

pub(crate) fn opens_fence(line: &str) -> Option<(char, usize)> {
    let line = line.trim_start();
    let mark = line.chars().next().filter(|c| matches!(c, '`' | '~'))?;
    let length = line.chars().take_while(|&c| c == mark).count();
    let info = &line[length..];
    (length >= 3 && !(mark == '`' && info.contains('`'))).then_some((mark, length))
}

pub(crate) fn closes_fence(line: &str, (mark, length): (char, usize)) -> bool {
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
    fn a_month_after_a_number_stays_in_its_sentence_before_any_punctuation() {
        for (text, expected) in [
            (
                "Das Treffen ist am 14. November, danach fahren wir.",
                &["Das Treffen ist am 14. November, danach fahren wir. "][..],
            ),
            ("Am 3. Mai: Treffen.", &["Am 3. Mai: Treffen. "]),
            (
                "Bis zum 1. Juni; dann Pause. Gut.",
                &["Bis zum 1. Juni; dann Pause. ", "Gut. "],
            ),
            (
                "Ab heute (bis 31. März) offen. Gut.",
                &["Ab heute (bis 31. März) offen. ", "Gut. "],
            ),
            (
                "Das Treffen ist am 14. Danach Ruhe.",
                &["Das Treffen ist am 14. ", "Danach Ruhe. "],
            ),
        ] {
            assert_eq!(sentences(text, "de"), expected, "{text}");
            assert_eq!(sentences(text, "en"), expected, "{text}");
            for size in 1..=7 {
                assert_eq!(in_pieces(text, "de", size), expected, "{text} in {size}");
            }
        }
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

    /// English sentences with their true ends. German rules are used for English text too.
    const ENGLISH: &[&[&str]] = &[
        &[
            "We need fruit, e.g. apples and pears. ",
            "Then we go home. ",
        ],
        &["Use a tool, i.e. a hammer. ", "Then nail it. "],
        &["Dr. Smith will see you now. ", "Please wait. "],
        &["Mr. and Mrs. Jones arrived. ", "They sat down. "],
        &[
            "Ms. Lee called at 5 p.m. yesterday. ",
            "She left a message. ",
        ],
        &["The meeting starts at 9 a.m. sharp. ", "Be on time. "],
        &["The U.S. economy grew. ", "Europe stalled. "],
        &["He moved to the U.S. last year. ", "He likes it. "],
        &["The U.S.A. is large. ", "Canada is too. "],
        &["She has a Ph.D. in physics. ", "She teaches. "],
        &["The price is 3.14 dollars. ", "That is cheap. "],
        &["Growth was 2.5% in Q3. ", "Inflation fell. "],
        &["The total came to 1,250.50 dollars. ", "We paid. "],
        &["Version 2.1.3 is out. ", "Update now. "],
        &["The answer is 42. ", "The question is unknown. "],
        &["We finished in 2024. ", "The next project starts soon. "],
        &["I scored 3. ", "Then I stopped. "],
        &["We met on May 3. ", "It was sunny. "],
        &["It happened on Nov. 14, 2026. ", "Nobody forgot. "],
        &["See Fig. 3 for details. ", "It shows the trend. "],
        &["Read pp. 12-15 first. ", "Then answer. "],
        &["See No. 5 on the list. ", "It is the best. "],
        &["Apple Inc. reported earnings. ", "Shares rose. "],
        &["He lives on Main St. near the park. ", "It is quiet. "],
        &["Prof. Brown teaches math. ", "Students like him. "],
        &["John Smith Jr. arrived late. ", "Nobody noticed. "],
        &["It is cats vs. dogs today. ", "Who wins? "],
        &["Is it ready? ", "Yes! ", "Let's go. "],
        &["He said \"Stop.\" ", "Then he left. "],
        &["It was approx. 20 km away. ", "We walked. "],
        &["We need 2 lbs. of flour. ", "Then bake. "],
        &["It is 10 a.m. EST. ", "The call starts. "],
        &["Sen. Warren spoke. ", "Gov. Newsom listened. "],
        &["Dr. Smith paid 3.14 euros. ", "Next sentence! ", "Tail. "],
    ];

    #[test]
    fn english_text_is_split_with_german_rules_without_wrong_cuts() {
        for expected in ENGLISH {
            let text = expected.concat();
            assert_eq!(sentences(text.trim(), "en"), *expected, "{text}");
        }
        // Where German rules miss a sentence end, the two sentences become one passage; the
        // voice still hears the full stop. English rules cut "approx. 20", "2 lbs. of",
        // "a.m. EST" in the list above instead.
        for (text, passages) in [
            ("We meet at 3 p.m. Tomorrow we travel.", 1),
            ("Bring tools, paper, etc. We start at nine.", 1),
        ] {
            assert_eq!(sentences(text, "en").len(), passages, "{text}");
        }
    }

    #[test]
    fn pieces_give_the_same_sentences_as_the_whole_text_and_lose_nothing() {
        let markdown = [
            "## Termine\n\nDas Treffen ist am 14. November.\n\n- Erster Punkt\n- Zweiter Punkt, z. B. mit **fett gedrucktem\nText**. Danach mehr.\n\n| Ort | Zeit |\n|---|---|\n| Berlin | 14.30 Uhr |\n\nMehr unter https://www.example.com/termine. 👍🏽\n\n```rust\nlet x = 1;\n\nlet y = 2;\n```\n\nEnde am 31.12.2026",
            "Ein Satz[^1].\n\n[^1]: Die Quelle.\n\nNoch ~~alt~~ neu. Und\n\n1. eins\n\n   weiter eins\n2. zwei",
            "Inline ```code``` am Zeilenanfang:\n```nicht``` zu.\n\nDanach am 3. Mai. Gut.",
            TABLE_WITH_PUNCTUATION,
            "Intro.\n| Wer? | Was! |\n|:--|--:|\n| Ich. | Das. |\nEnde. Noch ein Satz.",
            "Kein | Tisch? Nein. Wirklich nicht!\nWeiter. So.",
            "**Wichtig. Bitte beachten.** Danach mehr. *Kursiv. Auch.* Und _so. Weiter._ Gut.",
            "Gerne. Hier ist das Skript:\n\n```python\nprint(1)\nprint(2)\n```\n\nUnd die Tabelle:\n| a | b |\n|---|---|\n| 1 | 2 |\n\nFertig.",
            "Drei Teile:\n\n```\na\n```\n\n```\nb\n```\n| x |\n|---|\n| 1 |\n\n```\nc\n```\n\nEnde.",
            "Am 3. Mai: Treffen. Das Treffen ist am 14. November, danach fahren wir (bis 1. Juni) heim.",
            "Siehe [Quelle][1], [Buch][] und [Heft]. Gut.\n\n[1]: https://example.com\n\nText<br>mit<br/>HTML. Es kostet ca.5 Euro.",
            "Fue el 1.º de mayo. Es la 2.ª edición del libro. Gut.",
        ];
        for text in GERMAN
            .iter()
            .copied()
            .chain(markdown)
            .chain(UNPAIRED_MARKS.iter().copied())
        {
            let whole = sentences(text, "de");
            assert_eq!(
                whole.concat(),
                speakable(text, &SpeechLanguage::new("de")),
                "{text}"
            );
            for size in 1..=20 {
                assert_eq!(
                    in_pieces(text, "de", size),
                    whole,
                    "{text} in pieces of {size}"
                );
            }
        }
    }

    const UNPAIRED_MARKS: &[&str] = &[
        "Der Preis* gilt ab heute. Danach kommt mehr Text in diesem Absatz. Und noch ein Satz folgt.\n\nNeuer Absatz.",
        "Gut. Das ist ~ungefähr richtig. Danach kommt noch etwas mehr Text. Und ein letzter Satz.",
        "Es dauert ~5 Minuten. Danach ist alles fertig und bereit. Dann geht es weiter.",
        "Gut. Das kostet 5 € *pro Monat. Danach kommt noch mehr Text. Und ein letzter Satz.",
        "Nutze `cargo run. Danach startet der Server sofort neu. Dann ist alles bereit.",
        "Siehe [1. Danach kommt noch mehr Text hier. Und noch ein letzter Satz.",
        "Das kostet 2 * 3 Euro. Danach kommt mehr. Nutze snake_case und mein_bericht_final.docx. Ende hier.",
    ];

    /// Streamed one character at a time, each passage goes out once the first word of the
    /// next one has arrived, as with any sentence end; a mark without a partner does not hold
    /// it back.
    #[test]
    fn a_mark_without_a_partner_does_not_hold_back_the_voice() {
        for text in UNPAIRED_MARKS {
            let mut s = Sentences::new(SpeechLanguage::new("de"));
            let mut released = Vec::new();
            for (count, c) in text.chars().enumerate() {
                released.extend(s.push(&c.to_string()).into_iter().map(|p| (count + 1, p)));
            }
            let whole = sentences(text, "de");
            assert!(released.len() >= whole.len() - 1, "{text}");
            let mut from = 0;
            for (index, (count, passage)) in released.iter().enumerate() {
                assert_eq!(passage, &whole[index]);
                let Some(next) = released.get(index + 1).map(|(_, next)| next) else {
                    break;
                };
                let word = next.split_whitespace().next().unwrap();
                let at = from + text[from..].find(word).unwrap() + word.len();
                assert!(
                    *count <= text[..at].chars().count() + 1,
                    "{passage} released at {count} in {text}"
                );
                from = at;
            }
        }
    }

    #[test]
    fn an_ordinal_is_never_cut_after_its_full_stop() {
        for language in ["es", "de"] {
            for (text, expected) in [
                (
                    "Fue el 1.º de mayo. Gut.",
                    ["Fue el 1.º de mayo. ", "Gut. "],
                ),
                (
                    "Es la 2.ª edición del libro. Gut.",
                    ["Es la 2.ª edición del libro. ", "Gut. "],
                ),
            ] {
                assert_eq!(sentences(text, language), expected, "{text} {language}");
                for size in 1..=20 {
                    assert_eq!(
                        in_pieces(text, language, size),
                        expected,
                        "{text} {language} in {size}"
                    );
                }
            }
        }
    }

    const TABLE_WITH_PUNCTUATION: &str =
        "Intro.\n\n| Frage? | Antwort. | Quelle |\n|---|---|---|\n| Was? | Das. | Buch |\n\nEnde.";

    #[test]
    fn a_streamed_table_is_never_read_as_text() {
        for size in 1..=20 {
            assert_eq!(
                in_pieces(TABLE_WITH_PUNCTUATION, "de", size),
                ["Intro. ", "Die Tabelle steht im Chat. ", "Ende. "],
                "pieces of {size}"
            );
        }
        // A line with a bar that turns out not to be a table is read once the next line shows it.
        let mut s = Sentences::new(SpeechLanguage::new("de"));
        assert!(s.push("Wahl: A | B? Ja. Gut\n").is_empty());
        assert_eq!(s.push("Weiter"), ["Wahl: A | B? ", "Ja. "]);
    }

    #[test]
    fn emphasis_across_a_sentence_end_leaves_no_marks() {
        for (text, expected) in [
            (
                "**Wichtig. Bitte beachten.** Danach mehr.",
                ["Wichtig. ", "Bitte beachten. ", "Danach mehr. "],
            ),
            (
                "*Wichtig. Bitte beachten.* Danach mehr.",
                ["Wichtig. ", "Bitte beachten. ", "Danach mehr. "],
            ),
            (
                "_Wichtig. Bitte beachten._ Danach mehr.",
                ["Wichtig. ", "Bitte beachten. ", "Danach mehr. "],
            ),
        ] {
            for size in 1..=20 {
                assert_eq!(in_pieces(text, "de", size), expected, "{text} in {size}");
            }
        }
    }

    /// How many characters had arrived when a passage starting with `start` was handed out.
    fn released_at(text: &str, start: &str) -> usize {
        let mut s = Sentences::new(SpeechLanguage::new("de"));
        for (count, c) in text.chars().enumerate() {
            if s.push(&c.to_string()).iter().any(|p| p.starts_with(start)) {
                return count + 1;
            }
        }
        panic!("{start} not handed out before the end of {text}");
    }

    #[test]
    fn text_before_a_code_block_or_table_is_spoken_when_the_block_starts() {
        let code = format!(
            "Gerne. Hier ist das Skript:\n\n```python\n{}```\n\nEnde.",
            "print(\"Hallo Welt\")\n".repeat(30)
        );
        let table = format!(
            "Gerne. Hier ist die Tabelle:\n\n| Ort | Anzahl |\n|---|---|\n{}\nEnde.",
            "| Berlin | 12 |\n".repeat(20)
        );
        let fence_end = code.find("```python\n").unwrap() + "```python\n".len();
        assert!(released_at(&code, "Hier ist das Skript:") <= 30);
        assert_eq!(released_at(&code, "Der Code steht im Chat."), fence_end);
        assert!(released_at(&table, "Hier ist die Tabelle:") <= 31);
        let delimiter_end = table.find("|---|---|\n").unwrap() + "|---|---|\n".len();
        assert_eq!(released_at(&table, "Die Tabelle steht"), delimiter_end);
        // Without a blank line the block is the same one; the text goes out with the fence.
        let tight = code.replacen(":\n\n```", ":\n```", 1);
        let tight_fence_end = tight.find("```python\n").unwrap() + "```python\n".len();
        assert_eq!(released_at(&tight, "Hier ist das Skript:"), tight_fence_end);
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
