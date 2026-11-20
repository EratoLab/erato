//! The phrase that approves a waiting card by voice. Only the whole
//! utterance counts, compared word for word, so the person and an auditor
//! know in advance what approves; no model's judgement ever does.

use super::rules::{drop_fillers, words_of};
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
        notes: &mut Vec<PhraseNote>,
    ) -> Option<Self> {
        let place = format!("approval_voice_decisions.phrases.{language}");
        let words = words_of(&config.phrase);
        let shown = &config.phrase;
        let quiet = |word: &String| {
            lists.noise_words.contains(word)
                || lists.fillers.contains(word)
                || lists.backchannels.contains(word)
                || lists.yes_particles.contains(word)
                || lists.agreement_words.contains(word)
                || lists.leading.contains(word)
        };
        // Compared as the lists are: without fillers.
        let core = drop_fillers(&words, &lists.fillers, &lists.again);
        let joined = core.join(" ");
        let holds = |entry: &String| {
            let entry: Vec<&str> = entry.split(' ').filter(|part| !part.is_empty()).collect();
            !entry.is_empty()
                && core
                    .windows(entry.len())
                    .any(|window| window.iter().zip(&entry).all(|(word, part)| word == part))
        };
        let syllables = phrase_syllables(&words, language);
        let problem = if words.is_empty() {
            Some("it holds no word".to_string())
        } else if config.phrase.chars().any(char::is_numeric) {
            Some("it holds a digit, which transcribers write in many ways".to_string())
        } else if words.iter().any(|word| lists.decides_meaning(word)) {
            Some("it holds a negation, condition or question word".to_string())
        } else if words.iter().all(quiet) {
            Some(
                "it is only noise or hesitation words or words of agreement, which are said without meaning to approve"
                    .to_string(),
            )
        } else if lists.noise_phrases.contains(&joined) || lists.casual_approvals.contains(&joined)
        {
            Some("it is said in passing, without meaning to approve".to_string())
        } else if lists
            .reject
            .iter()
            .any(|entry| *entry == joined || entry.starts_with(&format!("{joined} ")))
        {
            Some("a refusal starts with it".to_string())
        } else if lists.reject.iter().any(holds) || core.iter().any(|word| lists.refuses(word)) {
            Some("it holds a refusal".to_string())
        } else {
            match syllables {
                None => Some("cannot count syllables for this script".to_string()),
                Some(count) if count < MIN_SYLLABLES => Some(format!(
                    "it has {}; at least {MIN_SYLLABLES} keep a short sound from approving",
                    syllables_shown(count)
                )),
                Some(_) => None,
            }
        };
        if let Some(problem) = problem {
            notes.push(PhraseNote::Dropped(format!(
                "{place}: '{shown}' is ignored: {problem}"
            )));
            return None;
        }
        if syllables == Some(MIN_SYLLABLES) {
            notes.push(PhraseNote::Kept(format!(
                "{place}: '{shown}' has only {MIN_SYLLABLES} syllables; a longer phrase is heard by mistake less often"
            )));
        }
        let first = words.first();
        let last = words.last();
        let mut usable = |kind: &str, entries: &[String]| -> Vec<String> {
            entries
                .iter()
                .filter(|entry| {
                    let entry_words = words_of(entry);
                    let problem = if entry_words.len() != 1 {
                        Some("it must be one word")
                    } else if entry.chars().any(char::is_numeric) {
                        Some("it holds a digit")
                    } else if lists.decides_meaning(&entry_words[0])
                        || lists.is_guard_word(&entry_words[0])
                    {
                        Some("it is a negation, condition or question word")
                    } else if lists.stops(&entry_words[0]) {
                        Some("it stops the voice")
                    } else if lists.refuses(&entry_words[0]) {
                        Some("it refuses")
                    } else if Some(&entry_words[0]) == first || Some(&entry_words[0]) == last {
                        Some("it is the phrase's own first or last word")
                    } else {
                        None
                    };
                    if let Some(problem) = problem {
                        notes.push(PhraseNote::Kept(format!(
                            "{place}.{kind}: '{entry}' is ignored: {problem}"
                        )));
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

/// A startup note on a configured phrase.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum PhraseNote {
    /// The phrase is not used.
    Dropped(String),
    /// The phrase is used, with a warning or without a leading or trailing
    /// word.
    Kept(String),
}

impl PhraseNote {
    pub(super) fn text(&self) -> &str {
        match self {
            Self::Dropped(text) | Self::Kept(text) => text,
        }
    }

    /// The line the startup log shows.
    pub(super) fn log_line(&self) -> String {
        match self {
            Self::Dropped(text) => format!("Confirmation phrase dropped: {text}."),
            Self::Kept(text) => format!("Confirmation phrase kept with a warning: {text}."),
        }
    }
}

fn syllables_shown(count: u32) -> String {
    if count == 1 {
        "1 syllable".to_string()
    } else {
        format!("{count} syllables")
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

/// Question marks of any script (the Greek one, U+037E, is not the ASCII
/// semicolon), quotation marks (a phrase in quotes was quoted, not said)
/// and ellipses.
const NEVER_IN_PHRASE: &[char] = &[
    '?', '？', '¿', '‽', '⸮', '؟', '\u{37e}', '՞', '፧', '"', '„', '“', '”', '«', '»', '‹', '›',
    '‚', '‘', '「', '」', '『', '』', '…', '⋯',
];

/// Which phrase the whole utterance is, if any. People mix languages, so
/// the German and English phrases are tried, and the card language's. A question, a quotation, a negation or a
/// condition anywhere is never a match, and neither is a phrase inside a
/// longer sentence.
///
/// `hesitations` are the deployment's own besides the built-in ones, as the
/// web app drops them from a turn. `lists` are those of the card's
/// language; a word the guards or decisions rely on is never trimmed as a
/// hesitation.
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
        .filter(|word| !lists.is_guard_word(word) && !lists.relied_on.contains(word))
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

/// Syllables of the phrase, for how much speech it needs at least. A
/// phrase in use always has a count: the check drops the others.
pub fn syllables(phrase: &ConfirmationPhrase) -> u32 {
    phrase_syllables(&phrase.words, &phrase.language).unwrap_or(MIN_SYLLABLES)
}

fn phrase_syllables(words: &[String], language: &str) -> Option<u32> {
    words
        .iter()
        .map(|word| word_syllables(word, language))
        .sum()
}

/// Syllables of a folded word in `language`: groups of vowels, accented
/// ones included, for Latin letters; one per character for Chinese,
/// Japanese and Korean. `None` for any other script, whose syllables are
/// not counted.
pub fn word_syllables(word: &str, language: &str) -> Option<u32> {
    let letters: Vec<char> = word.chars().filter(|c| c.is_alphabetic()).collect();
    if letters.is_empty() {
        return None;
    }
    if letters.iter().all(|c| is_syllable_per_character(*c)) {
        return Some(letters.len() as u32);
    }
    if !letters.iter().all(|c| is_latin_letter(*c)) {
        return None;
    }
    let mut count: u32 = 0;
    let mut in_vowel = false;
    for c in word.chars() {
        let vowel = is_vowel(c);
        if vowel && !in_vowel {
            count += 1;
        }
        in_vowel = vowel;
    }
    let primary = language.split(['-', '_']).next().unwrap_or_default();
    if matches!(primary, "fr" | "en") && silent_ending(word, primary) {
        count = count.saturating_sub(1);
    }
    Some(count.max(1))
}

/// A final "e" or "es" after a consonant ("sure", "confirme", "approves"),
/// and in English a final "ed" after a consonant other than "t" or "d"
/// ("confirmed"), is not said as a syllable of its own.
fn silent_ending(word: &str, language: &str) -> bool {
    let chars: Vec<char> = word.chars().collect();
    let consonant = |c: Option<&char>| c.is_some_and(|c| is_latin_letter(*c) && !is_vowel(*c));
    match chars.as_slice() {
        [.., before, 'e'] => consonant(Some(before)),
        [.., before, 'e', 's'] => consonant(Some(before)),
        [.., before, 'e', 'd'] if language == "en" => {
            consonant(Some(before)) && !matches!(before, 't' | 'd')
        }
        _ => false,
    }
}

/// Han, Hiragana, Katakana and Hangul: one syllable per character.
fn is_syllable_per_character(c: char) -> bool {
    matches!(
        u32::from(c),
        0x1100..=0x11FF
            | 0x3040..=0x30FF
            | 0x3130..=0x318F
            | 0x31F0..=0x31FF
            | 0x3400..=0x4DBF
            | 0x4E00..=0x9FFF
            | 0xA960..=0xA97F
            | 0xAC00..=0xD7AF
            | 0xD7B0..=0xD7FF
            | 0xF900..=0xFAFF
            | 0xFF66..=0xFF9F
            | 0xFFA0..=0xFFDC
            | 0x20000..=0x323AF
    )
}

fn is_latin_letter(c: char) -> bool {
    c.is_alphabetic()
        && matches!(u32::from(c), 0x41..=0x24F | 0x1E00..=0x1EFF | 0x2C60..=0x2C7F | 0xA720..=0xA7FF)
}

fn is_vowel(c: char) -> bool {
    let base = c.nfd().next().unwrap_or(c);
    matches!(base, 'a' | 'e' | 'i' | 'o' | 'u' | 'y') || matches!(c, 'æ' | 'ø' | 'œ' | 'ı')
}
