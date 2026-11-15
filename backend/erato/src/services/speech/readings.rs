//! Written forms a voice may not say well, each with one fixed reading. Applied only to the text
//! sent to the voice. The built-in rows are German abbreviations whose reading never depends on
//! the context; other rows (product names, English terms) can be added through `Readings::new`.

use super::spoken::SpeechLanguage;
use regex::{Captures, Regex};
use std::collections::HashMap;
use std::sync::LazyLock;

#[derive(Clone, Debug)]
pub struct Reading {
    pub written: String,
    pub spoken: String,
    /// The written form usually ends its sentence ("usw."): when a capital letter follows, its
    /// full stop is kept so the sentence still ends there.
    pub sentence_final: bool,
}

impl Reading {
    pub fn new(written: &str, spoken: &str, sentence_final: bool) -> Self {
        Self {
            written: written.into(),
            spoken: spoken.into(),
            sentence_final,
        }
    }
}

const GERMAN: &[(&str, &str, bool)] = &[
    ("z. B.", "zum Beispiel", false),
    ("bzw.", "beziehungsweise", false),
    ("ca.", "circa", false),
    ("Nr.", "Nummer", false),
    ("d. h.", "das heißt", false),
    ("u. a.", "unter anderem", false),
    ("ggf.", "gegebenenfalls", false),
    ("usw.", "und so weiter", true),
    ("etc.", "et cetera", true),
    ("u. v. m.", "und vieles mehr", true),
    ("evtl.", "eventuell", false),
    ("inkl.", "inklusive", false),
    ("zzgl.", "zuzüglich", false),
    ("vgl.", "vergleiche", false),
    ("bspw.", "beispielsweise", false),
    ("bzgl.", "bezüglich", false),
    ("insb.", "insbesondere", false),
    ("z. T.", "zum Teil", false),
    ("u. U.", "unter Umständen", false),
    ("i. d. R.", "in der Regel", false),
    ("MwSt.", "Mehrwertsteuer", true),
    ("Fa.", "Firma", false),
];

pub struct Readings {
    pattern: Option<Regex>,
    by_key: HashMap<String, Reading>,
}

impl Readings {
    /// A space after a full stop in a written form is optional, so "z. B." also matches "z.B.".
    /// A form that starts in lower case also matches with a capital, and is then read with one.
    pub fn new(rows: impl IntoIterator<Item = Reading>) -> Self {
        let mut by_key = HashMap::new();
        for row in rows {
            let capitalised = capitalise(&row.written).map(|written| Reading {
                written,
                spoken: capitalise(&row.spoken).unwrap_or_else(|| row.spoken.clone()),
                sentence_final: row.sentence_final,
            });
            for reading in std::iter::once(row).chain(capitalised) {
                by_key.entry(key(&reading.written)).or_insert(reading);
            }
        }
        let mut written: Vec<&str> = by_key.values().map(|r| r.written.as_str()).collect();
        written.sort_by(|a, b| key(b).len().cmp(&key(a).len()).then(a.cmp(b)));
        let alternatives: Vec<String> = written.into_iter().map(pattern).collect();
        // Whole words: not inside a word, an address or a file name.
        let pattern = (!alternatives.is_empty()).then(|| {
            Regex::new(&format!(
                r"(^|[^\p{{L}}\p{{N}}.@/_])({})",
                alternatives.join("|")
            ))
            .expect("escaped written forms form a valid pattern")
        });
        Self { pattern, by_key }
    }

    pub fn for_language(language: &SpeechLanguage) -> Option<&'static Readings> {
        static GERMAN_READINGS: LazyLock<Readings> = LazyLock::new(|| {
            Readings::new(GERMAN.iter().map(|&(written, spoken, sentence_final)| {
                Reading::new(written, spoken, sentence_final)
            }))
        });
        (language.code() == "de").then(|| &*GERMAN_READINGS)
    }

    /// One pass, longest written form first; replaced text is not read again. `piece_ends`: the
    /// text is a whole heading, list item or paragraph, so a form at its end keeps its full stop.
    pub fn apply(&self, text: &str, piece_ends: bool) -> String {
        let Some(pattern) = &self.pattern else {
            return text.to_string();
        };
        pattern
            .replace_all(text, |captures: &Captures| {
                let form = &captures[2];
                let reading = &self.by_key[&key(form)];
                let mut spoken = format!("{}{}", &captures[1], reading.spoken);
                let end = captures.get(2).map_or(text.len(), |m| m.end());
                if form.ends_with('.') && keeps_full_stop(&text[end..], reading, piece_ends) {
                    spoken.push('.');
                }
                spoken
            })
            .into_owned()
    }
}

fn keeps_full_stop(after: &str, reading: &Reading, piece_ends: bool) -> bool {
    let after = after.trim_start_matches(['"', '“', '”', '’', '»', '«', ')', ']']);
    if after.trim().is_empty() {
        return piece_ends;
    }
    reading.sentence_final
        && after.starts_with(char::is_whitespace)
        && after.trim_start().starts_with(char::is_uppercase)
}

fn key(written: &str) -> String {
    written.chars().filter(|c| !c.is_whitespace()).collect()
}

fn capitalise(text: &str) -> Option<String> {
    let mut chars = text.chars();
    let first = chars.next().filter(|c| c.is_lowercase())?;
    Some(first.to_uppercase().chain(chars).collect())
}

fn pattern(written: &str) -> String {
    let mut pattern = String::new();
    let mut previous = None;
    for c in written.chars() {
        if c.is_whitespace() {
            pattern.push_str(if previous == Some('.') {
                r"\s*"
            } else {
                r"\s+"
            });
        } else {
            pattern.push_str(&regex::escape(c.encode_utf8(&mut [0; 4])));
        }
        previous = Some(c);
    }
    if written.ends_with(|c: char| c.is_alphanumeric()) {
        pattern.push_str(r"\b");
    }
    pattern
}

#[cfg(test)]
mod tests {
    use super::*;

    fn german(text: &str) -> String {
        Readings::for_language(&SpeechLanguage::new("de"))
            .unwrap()
            .apply(text, true)
    }

    #[test]
    fn german_abbreviations_are_read_in_full() {
        assert_eq!(
            german(
                "z. B. und z.B., bzw. ca. 1.250,50 € für Nr. 5, d. h. u. a. ggf. evtl. inkl. zzgl. vgl. S. 3"
            ),
            "zum Beispiel und zum Beispiel, beziehungsweise circa 1.250,50 € für Nummer 5, das heißt unter anderem gegebenenfalls eventuell inklusive zuzüglich vergleiche S. 3"
        );
        assert_eq!(
            german("Z. B. so, i.d.R. bei der Fa. Beispiel GmbH, Preis inkl. MwSt. Versand extra."),
            "Zum Beispiel so, in der Regel bei der Firma Beispiel GmbH, Preis inklusive Mehrwertsteuer. Versand extra."
        );
        assert_eq!(
            german("Mit\u{202F}z.\u{00A0}B. schmalen Leerzeichen"),
            "Mit\u{202F}zum Beispiel schmalen Leerzeichen"
        );
    }

    #[test]
    fn only_whole_words_are_replaced() {
        assert_eq!(
            german("Mallorca. Bestell-Nr. 7 in example.ca. und /etc. sowie ca.5 Liter"),
            "Mallorca. Bestell-Nummer 7 in example.ca. und /etc. sowie circa5 Liter"
        );
        assert!(Readings::for_language(&SpeechLanguage::new("en")).is_none());
    }

    #[test]
    fn a_full_stop_that_ends_the_sentence_is_kept() {
        assert_eq!(
            german("Äpfel, Birnen usw. Danach gibt es Kaffee etc. und mehr."),
            "Äpfel, Birnen und so weiter. Danach gibt es Kaffee et cetera und mehr."
        );
        assert_eq!(
            german("Das klären wir ggf."),
            "Das klären wir gegebenenfalls."
        );
        assert_eq!(
            german("Das sind z. B. Kosten"),
            "Das sind zum Beispiel Kosten"
        );
        let readings = Readings::for_language(&SpeechLanguage::new("de")).unwrap();
        assert_eq!(
            readings.apply("Das klären wir ggf.", false),
            "Das klären wir gegebenenfalls"
        );
    }

    #[test]
    fn longest_form_first_and_no_second_pass() {
        let readings = Readings::new([
            Reading::new("Nr.", "Nummer", false),
            Reading::new("Nr. 1", "Nummer eins", false),
            Reading::new("A.", "Nr. 1", false),
        ]);
        assert_eq!(
            readings.apply("Nr. 1, Nr. 12, Nr. 2 und A. hier", true),
            "Nummer eins, Nummer 12, Nummer 2 und Nr. 1 hier"
        );
    }
}
