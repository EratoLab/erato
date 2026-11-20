//! The phrase that approves a waiting card by voice. Only the whole
//! utterance counts, compared word for word, so the person and an auditor
//! know in advance what approves; no model's judgement ever does.

use super::rules::{CONDITIONS, HESITATIONS, NEGATIONS, words_of};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// One language's phrase, in folded words (`fold`: lower case, umlauts as
/// "ae"), with the words it may be said with.
#[derive(Debug, PartialEq, Eq)]
pub struct ConfirmationPhrase {
    pub id: &'static str,
    pub language: &'static str,
    pub words: &'static [&'static str],
    /// At most one of these may come first.
    pub leading: &'static [&'static str],
    /// At most one of these may come last.
    pub trailing: &'static [&'static str],
}

/// The defaults, in German and English. They hold without a content package.
pub const BUILT_IN_PHRASES: &[ConfirmationPhrase] = &[
    ConfirmationPhrase {
        id: "de.ich_bestaetige",
        language: "de",
        words: &["ich", "bestaetige"],
        leading: &["ja"],
        trailing: &["das", "bitte"],
    },
    ConfirmationPhrase {
        id: "en.i_confirm",
        language: "en",
        words: &["i", "confirm"],
        leading: &["yes"],
        trailing: &["this", "please"],
    },
];

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, erato_memory::HeapSize,
)]
#[serde(rename_all = "snake_case")]
pub enum PhraseMatchKind {
    /// The phrase alone.
    Exact,
    /// The phrase with an allowed word before or after it.
    Variant,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PhraseMatch {
    pub phrase: &'static ConfirmationPhrase,
    pub kind: PhraseMatchKind,
    /// The words as matched, folded.
    pub words: String,
}

/// The built-in phrase of `language` ("de", "de-DE", …), if it has one.
pub fn phrase_for(language: &str) -> Option<&'static ConfirmationPhrase> {
    let code = language.split(['-', '_']).next()?.to_ascii_lowercase();
    BUILT_IN_PHRASES
        .iter()
        .find(|phrase| phrase.language == code)
}

/// Which phrase the whole utterance is, if any. People mix languages, so
/// every built-in phrase is tried. A question, a negation or a condition
/// anywhere is never a match, and neither is a phrase inside a longer
/// sentence.
pub fn match_phrase(transcript: &str) -> Option<PhraseMatch> {
    if transcript.contains('?') {
        return None;
    }
    let words = words_of(transcript);
    let start = words
        .iter()
        .position(|word| !HESITATIONS.contains(&word.as_str()))?;
    let end = words
        .iter()
        .rposition(|word| !HESITATIONS.contains(&word.as_str()))?;
    let words: Vec<&str> = words[start..=end].iter().map(String::as_str).collect();
    if words
        .iter()
        .any(|word| NEGATIONS.contains(word) || CONDITIONS.contains(word))
    {
        return None;
    }
    BUILT_IN_PHRASES.iter().find_map(|phrase| {
        let kind = matches(phrase, &words)?;
        Some(PhraseMatch {
            phrase,
            kind,
            words: words.join(" "),
        })
    })
}

fn matches(phrase: &ConfirmationPhrase, words: &[&str]) -> Option<PhraseMatchKind> {
    let (rest, led) = match words.split_first() {
        Some((first, rest)) if phrase.leading.contains(first) => (rest, true),
        _ => (words, false),
    };
    let (core, trailed) = match rest.split_last() {
        Some((last, core)) if phrase.trailing.contains(last) => (core, true),
        _ => (rest, false),
    };
    (core == phrase.words).then_some(if led || trailed {
        PhraseMatchKind::Variant
    } else {
        PhraseMatchKind::Exact
    })
}

/// Syllables of the phrase, counted as groups of vowels, for how much speech
/// it needs at least.
pub fn syllables(phrase: &ConfirmationPhrase) -> u32 {
    phrase
        .words
        .iter()
        .map(|word| {
            let mut count = 0;
            let mut in_vowel = false;
            for c in word.chars() {
                let vowel = matches!(c, 'a' | 'e' | 'i' | 'o' | 'u' | 'y');
                if vowel && !in_vowel {
                    count += 1;
                }
                in_vowel = vowel;
            }
            count.max(1)
        })
        .sum()
}
