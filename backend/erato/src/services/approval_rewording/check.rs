//! The rule check a natural wording passes before it is spoken. What is heard
//! is what gets approved, so a wording passes only when the check can show it
//! says every fact of the precise piece, in the same order, and nothing else:
//! every word it uses is a word of the precise piece or one the language
//! allows, and every number, negation and word for a quantity, a day or a
//! time is said exactly as often as in the precise piece.

use std::collections::{BTreeMap, BTreeSet};

use crate::config::is_invisible_format_char;

/// Why a wording was not used; also the counts the offline check reports.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum Rejection {
    Empty,
    TooLong,
    /// A character outside the allowed set: markup, a control or an
    /// invisible character.
    Character(char),
    /// A fact of the precise piece is not in the wording.
    FactMissing(String),
    /// Two facts are said in another order than in the precise piece.
    FactOrder,
    /// A word that is neither in the precise piece nor allowed.
    NewWord(String),
    /// More or fewer negations than the precise piece.
    Negation,
    /// A number, a quantity or a time word of the precise piece said more
    /// or fewer times.
    Guarded(String),
}

impl Rejection {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Empty => "empty",
            Self::TooLong => "too_long",
            Self::Character(_) => "character",
            Self::FactMissing(_) => "fact_missing",
            Self::FactOrder => "fact_order",
            Self::NewWord(_) => "new_word",
            Self::Negation => "negation",
            Self::Guarded(_) => "guarded_word",
        }
    }
}

/// Punctuation a spoken sentence may have besides letters and digits.
const PUNCTUATION: &str = ".,:;!?'\"’‘“”„«»–—-()/%€$&+…@";
/// A wording may be this much longer than the precise piece, in characters.
const MAX_GROWTH_CHARS: usize = 80;

/// Words in lowercase, apostrophes inside a word kept ("can't"), anything
/// else a separator: "E-Mail" is "e" and "mail" in both texts alike.
pub fn tokens(text: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut word = String::new();
    for c in text.chars() {
        let c = if c == '’' || c == '‘' { '\'' } else { c };
        if c.is_alphanumeric() || (c == '\'' && !word.is_empty()) {
            word.extend(c.to_lowercase());
        } else if !word.is_empty() {
            words.push(std::mem::take(&mut word).trim_end_matches('\'').to_string());
        }
    }
    if !word.is_empty() {
        words.push(word.trim_end_matches('\'').to_string());
    }
    words.retain(|word| !word.is_empty());
    words
}

fn occurrences(haystack: &[String], needle: &[String]) -> usize {
    if needle.is_empty() || needle.len() > haystack.len() {
        return 0;
    }
    haystack
        .windows(needle.len())
        .filter(|window| *window == needle)
        .count()
}

fn find(haystack: &[String], needle: &[String]) -> Option<usize> {
    if needle.is_empty() || needle.len() > haystack.len() {
        return None;
    }
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

/// Words a language never lets a wording add or drop: numbers, quantities,
/// words for days, months and times, and the words that say whose claim a
/// value is or that something is not known ("laut Aufruf", "ob"). They may
/// only come from the precise piece, exactly as often.
fn guarded(language: &str) -> &'static [&'static str] {
    match primary(language) {
        "de" => GUARD_DE,
        "en" => GUARD_EN,
        _ => &[],
    }
}

fn negations(language: &str) -> &'static [&'static str] {
    match primary(language) {
        "de" => NEGATIONS_DE,
        "en" => NEGATIONS_EN,
        _ => &[],
    }
}

pub fn primary(language: &str) -> &str {
    language.split(['-', '_']).next().unwrap_or(language)
}

/// The words a wording in `language` may add, from the configured list (or
/// the built-in one), without the guarded words.
pub fn allowed_words(language: &str, configured: &[String]) -> BTreeSet<String> {
    let guard = guarded(language);
    let negation = negations(language);
    let built_in: &[&str] = match primary(language) {
        "de" => super::words::WORDS_DE,
        "en" => super::words::WORDS_EN,
        _ => &[],
    };
    let listed: Vec<String> = if configured.is_empty() {
        built_in.iter().map(|word| (*word).to_string()).collect()
    } else {
        configured.to_vec()
    };
    listed
        .iter()
        .flat_map(|word| tokens(word))
        .filter(|word| {
            !guard.contains(&word.as_str())
                && !negation.contains(&word.as_str())
                && !word.chars().any(|c| c.is_numeric())
        })
        .collect()
}

/// One precise piece and what it must keep.
pub struct Precise<'a> {
    pub text: &'a str,
    /// The words the precise piece says for each of its values, in the order
    /// the card gives them.
    pub facts: &'a [String],
}

/// Whether `wording` may be spoken in place of `precise`.
pub fn check(
    precise: &Precise<'_>,
    wording: &str,
    language: &str,
    allowed: &BTreeSet<String>,
) -> Result<(), Rejection> {
    let wording = wording.trim();
    if wording.is_empty() {
        return Err(Rejection::Empty);
    }
    let precise_chars = precise.text.chars().count();
    let wording_chars = wording.chars().count();
    if wording_chars > super::MAX_PIECE_CHARS || wording_chars > precise_chars + MAX_GROWTH_CHARS {
        return Err(Rejection::TooLong);
    }
    if let Some(c) = wording.chars().find(|c| {
        !(c.is_alphanumeric() || *c == ' ' || PUNCTUATION.contains(*c))
            || c.is_control()
            || is_invisible_format_char(*c)
    }) && !precise.text.contains(c)
    {
        return Err(Rejection::Character(c));
    }

    let said = tokens(precise.text);
    let new = tokens(wording);

    // Every fact, where the precise piece says it and where the wording does.
    let mut places = Vec::new();
    for fact in precise.facts {
        let words = tokens(fact);
        if words.is_empty() {
            continue;
        }
        let Some(in_precise) = find(&said, &words) else {
            // The caller only sends facts the piece says.
            return Err(Rejection::FactMissing(fact.clone()));
        };
        // A fact inside another one ("Word" in "word comment") counts only
        // when it is there as often as in the precise piece.
        let Some(in_wording) =
            find(&new, &words).filter(|_| occurrences(&new, &words) >= occurrences(&said, &words))
        else {
            return Err(Rejection::FactMissing(fact.clone()));
        };
        places.push((in_precise, in_wording));
    }
    for (index, (precise_a, wording_a)) in places.iter().enumerate() {
        for (precise_b, wording_b) in &places[index + 1..] {
            if precise_a != precise_b && (precise_a < precise_b) != (wording_a < wording_b) {
                return Err(Rejection::FactOrder);
            }
        }
    }

    let precise_words: BTreeSet<&str> = said.iter().map(String::as_str).collect();
    if let Some(word) = new
        .iter()
        .find(|word| !precise_words.contains(word.as_str()) && !allowed.contains(word.as_str()))
    {
        return Err(Rejection::NewWord(word.clone()));
    }

    let negation = negations(language);
    let negations_in = |words: &[String]| {
        words
            .iter()
            .filter(|word| negation.contains(&word.as_str()))
            .count()
    };
    if negations_in(&said) != negations_in(&new) {
        return Err(Rejection::Negation);
    }
    // Facts a piece says without a value behind them, such as "und ein
    // weiterer Eintrag", are kept by keeping these words.
    let guard = guarded(language);
    let guarded_in = |words: &[String]| -> BTreeMap<String, usize> {
        let mut counts = BTreeMap::new();
        for word in words
            .iter()
            .filter(|word| guard.contains(&word.as_str()) || word.chars().any(char::is_numeric))
        {
            *counts.entry(word.clone()).or_default() += 1;
        }
        counts
    };
    let (before, after) = (guarded_in(&said), guarded_in(&new));
    if let Some(word) = before
        .iter()
        .chain(&after)
        .map(|(word, _)| word)
        .find(|word| before.get(*word) != after.get(*word))
    {
        return Err(Rejection::Guarded(word.clone()));
    }
    Ok(())
}

const NEGATIONS_DE: &[&str] = &[
    "nicht", "kein", "keine", "keinen", "keinem", "keiner", "keines", "nie", "niemals", "nichts",
    "ohne", "weder", "nirgends", "niemand", "nein",
];

const NEGATIONS_EN: &[&str] = &[
    "not",
    "no",
    "never",
    "none",
    "nothing",
    "without",
    "neither",
    "nor",
    "nobody",
    "nowhere",
    "cannot",
    "can't",
    "don't",
    "doesn't",
    "won't",
    "isn't",
    "aren't",
    "wasn't",
    "weren't",
    "shouldn't",
    "wouldn't",
    "couldn't",
    "didn't",
    "hasn't",
    "haven't",
    "n't",
];

const GUARD_DE: &[&str] = &[
    "null",
    "eins",
    "ein",
    "eine",
    "einen",
    "einem",
    "einer",
    "eines",
    "zwei",
    "drei",
    "vier",
    "fünf",
    "sechs",
    "sieben",
    "acht",
    "neun",
    "zehn",
    "elf",
    "zwölf",
    "zwanzig",
    "dreißig",
    "hundert",
    "tausend",
    "million",
    "millionen",
    "milliarde",
    "milliarden",
    "halb",
    "halbe",
    "viertel",
    "dutzend",
    "beide",
    "beiden",
    "alle",
    "allen",
    "jede",
    "jeden",
    "jedem",
    "jeder",
    "jedes",
    "erste",
    "ersten",
    "zweite",
    "dritte",
    "letzte",
    "letzten",
    "mehr",
    "weniger",
    "weitere",
    "weiteren",
    "weiterer",
    "heute",
    "morgen",
    "gestern",
    "übermorgen",
    "vorgestern",
    "montag",
    "dienstag",
    "mittwoch",
    "donnerstag",
    "freitag",
    "samstag",
    "sonntag",
    "januar",
    "februar",
    "märz",
    "april",
    "mai",
    "juni",
    "juli",
    "august",
    "september",
    "oktober",
    "november",
    "dezember",
    "uhr",
    "jahr",
    "monat",
    "woche",
    "tag",
    "tage",
    "prozent",
    "euro",
    "dollar",
    "früh",
    "spät",
    "später",
    "vorher",
    "nachher",
    "bald",
    "sofort",
    "immer",
    "nur",
    "auch",
    "noch",
    "wieder",
    "zurück",
    "gelöscht",
    "löschen",
    "endgültig",
    "laut",
    "ob",
    "bekannt",
    "unbekannt",
    "vermutlich",
    "angeblich",
    "eventuell",
    "vielleicht",
];

const GUARD_EN: &[&str] = &[
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "twenty",
    "thirty",
    "hundred",
    "thousand",
    "million",
    "billion",
    "half",
    "quarter",
    "dozen",
    "both",
    "all",
    "every",
    "each",
    "first",
    "second",
    "third",
    "last",
    "more",
    "less",
    "fewer",
    "other",
    "others",
    "another",
    "today",
    "tomorrow",
    "yesterday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
    "o'clock",
    "am",
    "pm",
    "year",
    "month",
    "week",
    "day",
    "days",
    "percent",
    "euro",
    "euros",
    "dollar",
    "dollars",
    "early",
    "late",
    "later",
    "before",
    "after",
    "soon",
    "now",
    "always",
    "only",
    "also",
    "again",
    "back",
    "deleted",
    "delete",
    "permanently",
    "according",
    "says",
    "say",
    "whether",
    "known",
    "unknown",
    "probably",
    "apparently",
    "maybe",
    "perhaps",
];

#[cfg(test)]
mod tests {
    use super::*;

    fn facts(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_string()).collect()
    }

    fn run(precise: &str, values: &[&str], wording: &str, language: &str) -> Result<(), Rejection> {
        let facts = facts(values);
        check(
            &Precise {
                text: precise,
                facts: &facts,
            },
            wording,
            language,
            &allowed_words(language, &[]),
        )
    }

    #[test]
    fn tokens_ignore_case_and_punctuation() {
        assert_eq!(
            tokens("Fälligkeitsdatum: 15. Januar 2030."),
            vec!["fälligkeitsdatum", "15", "januar", "2030"]
        );
        assert_eq!(
            tokens("I can’t, it's E-Mail"),
            vec!["i", "can't", "it's", "e", "mail"]
        );
    }

    /// Each row: precise piece, its facts, a wording, and whether it passes.
    #[test]
    fn rule_check_table() {
        use Rejection as R;
        let de_change =
            "Das Feld Fälligkeitsdatum wird vom 1. Dezember auf den 15. Januar 2030 geändert.";
        let de_change_facts = ["Fälligkeitsdatum", "1. Dezember", "15. Januar 2030"];
        let too_long = "Status: aktiv, und so weiter. ".repeat(6);
        type Row<'a> = (
            &'a str,
            &'a [&'a str],
            &'a str,
            &'a str,
            Result<(), fn(&Rejection) -> bool>,
        );
        let rows: Vec<Row<'_>> = vec![
            // Faithful rewordings.
            (
                de_change,
                &de_change_facts,
                "Ich verschiebe das Fälligkeitsdatum vom 1. Dezember auf den 15. Januar 2030.",
                "de",
                Ok(()),
            ),
            (
                de_change,
                &de_change_facts,
                "Fälligkeitsdatum: vom 1. Dezember auf den 15. Januar 2030.",
                "de",
                Ok(()),
            ),
            (
                "Status: aktiv.",
                &["Status", "aktiv"],
                "Der Status wird aktiv.",
                "de",
                Ok(()),
            ),
            (
                "Priority: High.",
                &["Priority", "High"],
                "The priority is set to High.",
                "en",
                Ok(()),
            ),
            (
                "I'd like to create a task in Dynamics 365:",
                &["Dynamics 365"],
                "I'll create a task in Dynamics 365:",
                "en",
                Ok(()),
            ),
            // A fact dropped.
            (
                de_change,
                &de_change_facts,
                "Ich verschiebe das Fälligkeitsdatum auf den 15. Januar 2030.",
                "de",
                Err(|r| matches!(r, R::FactMissing(_))),
            ),
            (
                "Empfänger: Anna Müller.",
                &["Empfänger", "Anna Müller"],
                "Empfänger: Anna.",
                "de",
                Err(|r| matches!(r, R::FactMissing(_))),
            ),
            // A fact altered.
            (
                de_change,
                &de_change_facts,
                "Ich verschiebe das Fälligkeitsdatum vom 1. Dezember auf den 16. Januar 2030.",
                "de",
                Err(|r| matches!(r, R::FactMissing(_))),
            ),
            (
                "Probability: 70 percent.",
                &["Probability", "70 percent"],
                "Probability: 80 percent.",
                "en",
                Err(|r| matches!(r, R::FactMissing(_))),
            ),
            // Old and new swapped.
            (
                de_change,
                &de_change_facts,
                "Fälligkeitsdatum: vom 15. Januar 2030 auf den 1. Dezember.",
                "de",
                Err(|r| matches!(r, R::FactOrder)),
            ),
            // A negation dropped or added.
            (
                "Der Datensatz wird nicht gelöscht.",
                &["Datensatz"],
                "Der Datensatz wird gelöscht.",
                "de",
                Err(|r| matches!(r, R::Negation)),
            ),
            (
                "Status: aktiv.",
                &["Status", "aktiv"],
                "Status: nicht aktiv.",
                "de",
                Err(|r| matches!(r, R::NewWord(_))),
            ),
            (
                "The task is created.",
                &[],
                "The task is not created.",
                "en",
                Err(|r| matches!(r, R::NewWord(_))),
            ),
            // Whose claim a value is, or that something is not known, dropped.
            (
                "Title laut Aufruf: Kickoff Line 4.",
                &["Title", "Kickoff Line 4"],
                "Title lautet Kickoff Line 4.",
                "de",
                Err(|r| matches!(r, R::Guarded(_))),
            ),
            (
                "Labels: the tool says it adds Retrofit.",
                &["Labels", "Retrofit"],
                "Labels: it adds Retrofit.",
                "en",
                Err(|r| matches!(r, R::Guarded(_))),
            ),
            // A counted rest dropped, a number said twice.
            (
                "Tags: Retrofit, Service und ein weiterer Eintrag.",
                &["Tags", "Retrofit", "Service"],
                "Tags: Retrofit, Service.",
                "de",
                Err(|r| matches!(r, R::Guarded(_))),
            ),
            (
                "Dazu kommen vier weitere Felder.",
                &["vier"],
                "Dazu kommen vier Felder.",
                "de",
                Err(|r| matches!(r, R::Guarded(_))),
            ),
            (
                "Probability: 70 percent.",
                &["Probability", "70 percent"],
                "Probability: 70 percent, 70.",
                "en",
                Err(|r| matches!(r, R::Guarded(_))),
            ),
            // A new fact: a name, a number, a date word, an amount.
            (
                "Ich möchte eine Aufgabe anlegen:",
                &[],
                "Ich möchte für Anna eine Aufgabe anlegen:",
                "de",
                Err(|r| matches!(r, R::NewWord(_))),
            ),
            (
                "Status: aktiv.",
                &["Status", "aktiv"],
                "Status: aktiv, ab morgen.",
                "de",
                Err(|r| matches!(r, R::NewWord(_))),
            ),
            (
                "Priority: High.",
                &["Priority", "High"],
                "Priority: High, for 2 tasks.",
                "en",
                Err(|r| matches!(r, R::NewWord(_))),
            ),
            (
                "Priority: High.",
                &["Priority", "High"],
                "Priority: High for all tasks.",
                "en",
                Err(|r| matches!(r, R::NewWord(_))),
            ),
            // Markup, an invisible character, empty, too long.
            (
                "Status: aktiv.",
                &["Status", "aktiv"],
                "**Status**: aktiv.",
                "de",
                Err(|r| matches!(r, R::Character('*'))),
            ),
            (
                "Status: aktiv.",
                &["Status", "aktiv"],
                "Status:\u{200B} aktiv.",
                "de",
                Err(|r| matches!(r, R::Character(_))),
            ),
            (
                "Status: aktiv.",
                &["Status", "aktiv"],
                "  ",
                "de",
                Err(|r| matches!(r, R::Empty)),
            ),
            (
                "Status: aktiv.",
                &["Status", "aktiv"],
                &too_long,
                "de",
                Err(|r| matches!(r, R::TooLong)),
            ),
        ];
        for (precise, values, wording, language, expected) in rows {
            let got = run(precise, values, wording, language);
            match expected {
                Ok(()) => assert_eq!(got, Ok(()), "{wording}"),
                Err(is) => assert!(got.as_ref().is_err_and(is), "{wording}: {got:?}"),
            }
        }
    }

    #[test]
    fn guarded_words_cannot_be_allowed_by_configuration() {
        let allowed = allowed_words("de", &facts(&["nicht", "morgen", "zwei", "2", "ändern"]));
        assert_eq!(allowed, BTreeSet::from(["ändern".to_string()]));
    }

    #[test]
    fn a_language_without_words_only_reorders() {
        let allowed = allowed_words("fr", &[]);
        assert!(allowed.is_empty());
        assert_eq!(
            check(
                &Precise {
                    text: "Statut : actif.",
                    facts: &facts(&["Statut", "actif"])
                },
                "Statut actif.",
                "fr",
                &allowed
            ),
            Ok(())
        );
        assert!(
            check(
                &Precise {
                    text: "Statut : actif.",
                    facts: &facts(&["Statut", "actif"])
                },
                "Le statut : actif.",
                "fr",
                &allowed
            )
            .is_err()
        );
    }
}
