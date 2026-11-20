//! The phrase that approves a waiting card by voice. Only the whole
//! utterance counts, compared word for word, so the person and an auditor
//! know in advance what approves; no model's judgement ever does.

use super::rules::words_of;
use super::words::CommandWords;
use erato_config::confirmation_phrases::{BUILT_IN_PHRASES, ConfirmationPhraseConfig};
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;
use unicode_normalization::UnicodeNormalization;
use utoipa::ToSchema;

/// One language's phrase, in folded words (`fold`: lower case, umlauts as
/// "ae"), with the words it may be said with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfirmationPhrase {
    /// The language and the phrase's words: "de.ich_bestaetige".
    pub id: String,
    pub language: String,
    /// As the card shows it and the voice names it: "Ich bestätige".
    pub shown: String,
    pub words: Vec<String>,
    /// At most one of these may come first.
    pub leading: Vec<String>,
    /// At most one of these may come last.
    pub trailing: Vec<String>,
}

impl ConfirmationPhrase {
    fn new(language: &str, config: &ConfirmationPhraseConfig) -> Self {
        let words = words_of(&config.phrase);
        let single = |entries: &[String]| -> Vec<String> {
            entries
                .iter()
                .map(|entry| words_of(entry))
                .filter(|words| words.len() == 1)
                .flatten()
                .collect()
        };
        Self {
            id: format!("{language}.{}", words.join("_")),
            language: language.to_string(),
            shown: config.phrase.clone(),
            words,
            leading: single(&config.leading),
            trailing: single(&config.trailing),
        }
    }

    /// The phrase `config` configures for `language`, checked with the
    /// lists of that language's cards; `None` when it could be heard by
    /// mistake. Each problem is noted; a leading or trailing word that
    /// cannot be used is dropped on its own.
    pub(super) fn checked(
        language: &str,
        config: &ConfirmationPhraseConfig,
        lists: &CommandWords,
        notes: &mut Vec<String>,
    ) -> Option<Self> {
        let place = format!("approval_voice_decisions.phrases.{language}");
        let words = words_of(&config.phrase);
        let shown = &config.phrase;
        let refused = |problem: &str| format!("{place}: '{shown}' is ignored: {problem}");
        let quiet = |word: &String| {
            lists.noise_words.contains(word)
                || lists.fillers.contains(word)
                || lists.backchannels.contains(word)
                || lists.yes_particles.contains(word)
        };
        let joined = words.join(" ");
        let problem = if words.is_empty() {
            Some("it holds no word")
        } else if config.phrase.chars().any(char::is_numeric) {
            Some("it holds a digit, which transcribers write in many ways")
        } else if words.iter().any(|word| lists.decides_meaning(word)) {
            Some("it holds a negation, condition or question word")
        } else if words.iter().all(quiet) {
            Some("it is only noise or hesitation words, which are said without meaning to approve")
        } else if lists
            .reject
            .iter()
            .any(|entry| *entry == joined || entry.starts_with(&format!("{joined} ")))
        {
            Some("a refusal starts with it")
        } else {
            None
        };
        if let Some(problem) = problem {
            notes.push(refused(problem));
            return None;
        }
        let syllables = words.iter().map(|word| word_syllables(word)).sum::<u32>();
        if syllables < MIN_SYLLABLES {
            notes.push(refused(&format!(
                "it has {syllables} syllables; at least {MIN_SYLLABLES} keep a short sound from approving"
            )));
            return None;
        }
        if syllables == MIN_SYLLABLES {
            notes.push(format!(
                "{place}: '{shown}' has only {MIN_SYLLABLES} syllables; a longer phrase is heard by mistake less often"
            ));
        }
        let mut usable = |kind: &str, entries: &[String]| -> Vec<String> {
            entries
                .iter()
                .filter(|entry| {
                    let entry_words = words_of(entry);
                    let problem = if entry_words.len() != 1 {
                        Some("it must be one word")
                    } else if entry.chars().any(char::is_numeric) {
                        Some("it holds a digit")
                    } else if lists.decides_meaning(&entry_words[0]) {
                        Some("it is a negation, condition or question word")
                    } else {
                        None
                    };
                    if let Some(problem) = problem {
                        notes.push(format!("{place}.{kind}: '{entry}' is ignored: {problem}"));
                    }
                    problem.is_none()
                })
                .cloned()
                .collect()
        };
        let config = ConfirmationPhraseConfig {
            phrase: config.phrase.clone(),
            leading: usable("leading", &config.leading),
            trailing: usable("trailing", &config.trailing),
        };
        Some(Self::new(language, &config))
    }
}

/// Fewer syllables than this are too easily heard in other speech.
const MIN_SYLLABLES: u32 = 3;

/// The built-in phrases, in German and English. They hold without a content
/// package.
pub fn built_in_phrases() -> &'static [ConfirmationPhrase] {
    static BUILT_IN: LazyLock<Vec<ConfirmationPhrase>> = LazyLock::new(|| {
        BUILT_IN_PHRASES
            .iter()
            .map(|phrase| ConfirmationPhrase::new(phrase.language, &phrase.config()))
            .collect()
    });
    &BUILT_IN
}

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
pub struct PhraseMatch<'a> {
    pub phrase: &'a ConfirmationPhrase,
    pub kind: PhraseMatchKind,
    /// The words as matched, folded.
    pub words: String,
}

/// The built-in phrase of `language` ("de", "de-DE", …), if it has one.
pub fn phrase_for(language: &str) -> Option<&'static ConfirmationPhrase> {
    let code = language.split(['-', '_']).next()?.to_ascii_lowercase();
    built_in_phrases()
        .iter()
        .find(|phrase| phrase.language == code)
}

/// Question marks of any script, quotation marks (a phrase in quotes was
/// quoted, not said) and ellipses.
const NEVER_IN_PHRASE: &[char] = &[
    '?', '？', '¿', '‽', '⸮', '"', '„', '“', '”', '«', '»', '‹', '›', '‚', '‘', '「', '」', '…',
    '⋯',
];

/// Which phrase the whole utterance is, if any. People mix languages, so
/// the German and English phrases are tried, and the card language's. A question, a quotation, a negation or a
/// condition anywhere is never a match, and neither is a phrase inside a
/// longer sentence.
///
/// `hesitations` are the deployment's own besides the built-in ones, as the
/// web app drops them from a turn. `lists` are those of the card's
/// language; a word the guards look for is never trimmed as a hesitation.
pub fn match_phrase<'a>(
    transcript: &str,
    hesitations: &[String],
    lists: &'a CommandWords,
) -> Option<PhraseMatch<'a>> {
    // An ellipsis means the transcriber heard the speaker trail or break off.
    if transcript.contains(NEVER_IN_PHRASE) || transcript.contains("..") {
        return None;
    }
    let words = words_of(transcript);
    // Before any word is trimmed: a hesitation word must never hide a
    // negation, a condition or a question.
    if words.iter().any(|word| lists.decides_meaning(word)) {
        return None;
    }
    let extra: Vec<String> = hesitations
        .iter()
        .flat_map(|word| words_of(word))
        .filter(|word| !lists.is_guard_word(word))
        .collect();
    let hesitation =
        |word: &String| lists.hesitations.contains(word.as_str()) || extra.contains(word);
    let start = words.iter().position(|word| !hesitation(word))?;
    let end = words.iter().rposition(|word| !hesitation(word))?;
    let words: Vec<&str> = words[start..=end].iter().map(String::as_str).collect();
    lists.phrases.iter().find_map(|phrase| {
        let kind = matches(phrase, &words)?;
        Some(PhraseMatch {
            phrase,
            kind,
            words: words.join(" "),
        })
    })
}

fn matches(phrase: &ConfirmationPhrase, words: &[&str]) -> Option<PhraseMatchKind> {
    let listed = |list: &[String], word: &str| list.iter().any(|entry| entry == word);
    let (rest, led) = match words.split_first() {
        Some((first, rest)) if listed(&phrase.leading, first) => (rest, true),
        _ => (words, false),
    };
    let (core, trailed) = match rest.split_last() {
        Some((last, core)) if listed(&phrase.trailing, last) => (core, true),
        _ => (rest, false),
    };
    let same = core.len() == phrase.words.len()
        && core
            .iter()
            .zip(&phrase.words)
            .all(|(said, word)| said == word);
    same.then_some(if led || trailed {
        PhraseMatchKind::Variant
    } else {
        PhraseMatchKind::Exact
    })
}

/// Syllables of the phrase, for how much speech it needs at least.
pub fn syllables(phrase: &ConfirmationPhrase) -> u32 {
    phrase.words.iter().map(|word| word_syllables(word)).sum()
}

/// Syllables of a folded word, counted as groups of vowels, accented ones
/// included; a word without Latin letters counts one per letter.
pub fn word_syllables(word: &str) -> u32 {
    if !word.chars().any(is_latin_letter) {
        return word.chars().filter(|c| c.is_alphanumeric()).count().max(1) as u32;
    }
    let mut count = 0;
    let mut in_vowel = false;
    for c in word.chars() {
        let vowel = is_vowel(c);
        if vowel && !in_vowel {
            count += 1;
        }
        in_vowel = vowel;
    }
    count.max(1)
}

fn is_latin_letter(c: char) -> bool {
    c.is_alphabetic()
        && matches!(u32::from(c), 0x41..=0x24F | 0x1E00..=0x1EFF | 0x2C60..=0x2C7F | 0xA720..=0xA7FF)
}

fn is_vowel(c: char) -> bool {
    let base = c.nfd().next().unwrap_or(c);
    matches!(base, 'a' | 'e' | 'i' | 'o' | 'u' | 'y') || matches!(c, 'æ' | 'ø' | 'œ' | 'ı')
}
