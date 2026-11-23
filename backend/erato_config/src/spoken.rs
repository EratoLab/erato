//! The words a person says for a server's machine names, per language, for
//! approval cards spoken in conversational audio mode. Display only: they
//! never change what a call does or whether it asks.

use std::collections::HashMap;

use unicode_normalization::UnicodeNormalization;

use config::Config;
use erato_memory::HeapSize;
use facet::Facet;
use serde::{Deserialize, Deserializer, Serialize};
use utoipa::ToSchema;

use crate::config::has_hidden_chars;
use crate::config_facet_attrs as erato_config;

/// Words that decide what a sentence means, in German and English, folded
/// (lower case, umlauts as "ae", no apostrophes): an utterance with one of
/// them never approves a card by voice, and none of them is ever a
/// hesitation sound.
pub const NEGATIONS: &[&str] = &[
    "nicht",
    "nichts",
    "nix",
    "not",
    "dont",
    "kein",
    "keine",
    "keinen",
    "keinem",
    "keiner",
    "keines",
    "keinesfalls",
    "never",
    "nie",
    "niemals",
    "nimmer",
    "nein",
    "nee",
    "ne",
    "noe",
    "no",
    "nope",
    "nah",
    "nothing",
    "neither",
    "nor",
    "none",
    "shouldnt",
    "wont",
    "cant",
    "isnt",
    "arent",
    "wasnt",
    "werent",
    "doesnt",
    "didnt",
    "wouldnt",
    "couldnt",
    "hasnt",
    "havent",
    "hadnt",
    "mustnt",
    "neednt",
    "aint",
    "nobody",
    "niemand",
];
pub const CONDITIONS: &[&str] = &[
    "aber",
    "but",
    "wenn",
    "falls",
    "if",
    "unless",
    "sofern",
    "nur",
    "only",
    "ausser",
    "except",
    "though",
    "however",
    "jedoch",
    "allerdings",
    "vorausgesetzt",
    "provided",
    "oder",
    "or",
];
pub const WH_WORDS: &[&str] = &[
    "was", "wer", "wie", "wann", "wo", "warum", "wieso", "welche", "welcher", "welches", "what",
    "whats", "who", "whos", "when", "where", "why", "which", "how",
];

/// Composed Unicode, lower case, umlauts folded, apostrophes dropped, an ordinal's dot kept
/// with its number.
pub fn fold(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut previous_digit = false;
    for c in text.nfc() {
        match c {
            '\'' | '’' | '`' | '´' => {}
            '.' if previous_digit => {}
            c => {
                for lower in c.to_lowercase() {
                    match lower {
                        'ä' => out.push_str("ae"),
                        'ö' => out.push_str("oe"),
                        'ü' => out.push_str("ue"),
                        'ß' => out.push_str("ss"),
                        other => out.push(other),
                    }
                }
            }
        }
        previous_digit = c.is_ascii_digit();
    }
    out
}

/// Whether `word` decides what a sentence means, also drawn out ("neee",
/// "nichtt") as transcribers write a long sound.
pub fn decides_meaning(word: &str) -> bool {
    decides_meaning_in(word, |word| {
        NEGATIONS.contains(&word) || CONDITIONS.contains(&word) || WH_WORDS.contains(&word)
    })
}

/// [`decides_meaning`] with a language's own negation, condition and
/// question words: `listed` is asked with the folded word and its drawn-out
/// form collapsed.
pub fn decides_meaning_in(word: &str, listed: impl Fn(&str) -> bool) -> bool {
    let folded = fold(word);
    let mut collapsed = String::with_capacity(folded.len());
    for c in folded.chars() {
        if !collapsed.ends_with(c) {
            collapsed.push(c);
        }
    }
    listed(&folded) || listed(&collapsed)
}

/// Entries one vocabulary holds in one language.
const MAX_VOCABULARY_ENTRIES: usize = 5_000;
/// A word, name or value longer than this is not something a voice says.
pub(crate) const MAX_ENTRY_BYTES: usize = 128;
/// A spoken name longer than this is a sentence, not a name.
pub const MAX_SPOKEN_NAME_CHARS: usize = 64;

/// What people call one server family's fields, choice values and tables in
/// one language. Keys are the machine names exactly as the tool writes them.
#[derive(Debug, Default, Deserialize, PartialEq, Eq, Clone, Facet, HeapSize)]
pub struct SpokenNamesConfig {
    /// The spoken name of a field, keyed by the field's exact name.
    #[serde(default)]
    #[facet(erato_config::introduced_in(version = "0.9.0"))]
    pub field_names: HashMap<String, String>,
    /// What each value of a choice field is called, keyed by the field's
    /// exact name and then by the value as the tool writes it.
    #[serde(default)]
    #[facet(erato_config::introduced_in(version = "0.9.0"))]
    pub choice_labels: HashMap<String, HashMap<String, String>>,
    /// What the records of a table are called, in the plural, keyed by the
    /// table's exact name.
    #[serde(default)]
    #[facet(erato_config::introduced_in(version = "0.9.0"))]
    pub table_names: HashMap<String, String>,
    /// One field's own natural sentence variants, by sentence type
    /// (`changed`, `set`, `updated`) and then by the field's exact name (or
    /// `table.field`). Used when the card is read in the natural wording.
    /// Only a `table.field` variant may leave out `{field}`, such as
    /// `"opportunity.estimatedclosedate" = "Der Abschluss verschiebt sich {from} {to}."`.
    #[serde(default)]
    #[facet(erato_config::introduced_in(version = "0.9.0"))]
    pub sentences: HashMap<String, HashMap<String, String>>,
}

/// `[spoken_vocabularies.<name>.<language>]`: named so that a content package
/// can ship the words for a kind of server without knowing a deployment's
/// server ids. A server uses them through `glossary.vocabularies`.
pub type SpokenVocabulariesConfig = HashMap<String, HashMap<String, SpokenNamesConfig>>;

const SPOKEN_NAMES_SETTINGS: &[&str] =
    &["field_names", "choice_labels", "table_names", "sentences"];

/// Sentence types with a natural variant and the slots each must hold, in
/// the precise sentence's order. The opening of a card has none: its verb is
/// the card's action.
const SENTENCE_TYPES: &[(&str, &[&str])] = &[
    ("changed", &["field", "from", "to"]),
    ("set", &["field", "value"]),
    ("updated", &["field", "value"]),
];
const MAX_VARIANT_CHARS: usize = 300;

/// The slots of `template` in order, or `None` when a brace stands alone.
pub(crate) fn slots_of(template: &str) -> Option<Vec<&str>> {
    let mut found = Vec::new();
    let mut rest = template;
    while let Some(open) = rest.find(['{', '}']) {
        let after = rest[open..].strip_prefix('{')?;
        let close = after.find('}')?;
        let name = &after[..close];
        if name.is_empty() || !name.chars().all(|c| c.is_ascii_lowercase()) {
            return None;
        }
        found.push(name);
        rest = &after[close + 1..];
    }
    Some(found)
}

/// Why `template` may not stand for the sentence `key` (`changed`, `set`,
/// `updated`), or `None` when it may: every required slot exactly once, no
/// other slot or brace, and the precise order (old before new). A variant
/// for one field of one table may leave out `{field}`. This guards the
/// slots, not the meaning: whoever writes a variant answers for what it
/// says. The web app checks the same, against the same cases
/// (`frontend/src/lib/toolCallGist/fixtures/spokenSentenceVariants.json`).
pub fn variant_problem(key: &str, template: &str, for_one_field: bool) -> Option<&'static str> {
    let Some((_, slots)) = SENTENCE_TYPES.iter().find(|(name, _)| *name == key) else {
        return Some("no sentence type has this name");
    };
    if template.trim().is_empty() {
        return Some("it is blank");
    }
    if template.chars().count() > MAX_VARIANT_CHARS {
        return Some("it is longer than 300 characters");
    }
    if template.chars().any(char::is_control) || has_hidden_chars(template) {
        return Some("it holds control or hidden characters");
    }
    let Some(found) = slots_of(template) else {
        return Some("a brace is not part of a slot such as {field}");
    };
    if found.iter().any(|slot| !slots.contains(slot)) {
        return Some("it holds a slot this sentence does not have");
    }
    let mut unique = found.clone();
    unique.sort_unstable();
    unique.dedup();
    if unique.len() != found.len() {
        return Some("a slot is used twice");
    }
    if slots
        .iter()
        .filter(|slot| !(for_one_field && **slot == "field"))
        .any(|slot| !found.contains(slot))
    {
        return Some("a slot is missing");
    }
    let order: Vec<usize> = found
        .iter()
        .map(|slot| slots.iter().position(|known| known == slot).unwrap_or(0))
        .collect();
    (!order.windows(2).all(|pair| pair[0] < pair[1]))
        .then_some("its slots are not in the precise sentence's order")
}

pub fn usable_variant(key: &str, template: &str, for_one_field: bool) -> bool {
    variant_problem(key, template, for_one_field).is_none()
}

/// What a variant says with sample values, in its language where the
/// backend has samples for it, so whoever wrote it sees at startup what the
/// voice will say. Old and new carry their direction, as on the voice.
pub fn sample_sentence(language: &str, key: &str, template: &str) -> String {
    let german = crate::language_words::primary_subtag(language) == "de";
    let samples: &[(&str, &str)] = match (german, key) {
        (true, "changed") => &[
            ("field", "Priorität"),
            ("from", "von Niedrig"),
            ("to", "auf Hoch"),
        ],
        (true, "updated") => &[("field", "Priorität"), ("value", "auf Hoch")],
        (true, _) => &[("field", "Priorität"), ("value", "Hoch")],
        (false, "changed") => &[
            ("field", "Priority"),
            ("from", "from Low"),
            ("to", "to High"),
        ],
        (false, "updated") => &[("field", "Priority"), ("value", "to High")],
        (false, _) => &[("field", "Priority"), ("value", "High")],
    };
    let mut said = template.to_string();
    for (slot, value) in samples {
        said = said.replace(&format!("{{{slot}}}"), value);
    }
    said.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Every natural sentence variant in use, rendered with sample values, for
/// the startup log.
pub fn sentences_in_use(
    vocabularies: &SpokenVocabulariesConfig,
    approval_speech: Option<&ApprovalSpeechConfig>,
) -> Vec<String> {
    let mut lines = Vec::new();
    for (language, variants) in approval_speech
        .map(|speech| &speech.sentences)
        .into_iter()
        .flatten()
    {
        for (key, template) in variants {
            lines.push(format!(
                "approval_speech.sentences.{language}.{key} says \"{}\"",
                sample_sentence(language, key, template)
            ));
        }
    }
    for (name, languages) in vocabularies {
        for (language, names) in languages {
            for (kind, variants) in &names.sentences {
                for (field, template) in variants {
                    lines.push(format!(
                        "spoken_vocabularies.{name}.{language}.sentences.{kind}.{field} says \"{}\"",
                        sample_sentence(language, kind, template)
                    ));
                }
            }
        }
    }
    lines.sort();
    lines
}

/// The vocabularies as written, whatever their shape, so that a text where a
/// table belongs (or the other way round) is dropped with a warning instead
/// of stopping the configuration.
#[derive(Deserialize)]
#[serde(untagged)]
pub(crate) enum Written {
    Text(String),
    Flag(bool),
    Number(i64),
    Table(HashMap<String, Written>),
    List(Vec<Written>),
    Other(serde::de::IgnoredAny),
}

pub(crate) fn written_table(
    place: &str,
    written: Written,
    dropped: &mut Vec<String>,
) -> HashMap<String, Written> {
    match written {
        Written::Table(entries) => entries,
        _ => {
            dropped.push(format!("{place} is not a table and is ignored"));
            HashMap::new()
        }
    }
}

fn written_texts(
    place: &str,
    written: Written,
    dropped: &mut Vec<String>,
) -> HashMap<String, String> {
    let mut texts = HashMap::new();
    for (key, value) in written_table(place, written, dropped) {
        match value {
            Written::Text(text) => {
                texts.insert(key, text);
            }
            _ => dropped.push(format!(
                "{place}: '{}' is not a text and is ignored",
                shown(&key)
            )),
        }
    }
    texts
}

/// The vocabularies whose shape is right, and each part that is not.
fn shaped_vocabularies(written: Written) -> (SpokenVocabulariesConfig, Vec<String>) {
    let mut dropped = Vec::new();
    let mut vocabularies = SpokenVocabulariesConfig::new();
    for (name, languages) in written_table("spoken_vocabularies", written, &mut dropped) {
        let place = format!("spoken_vocabularies.{name}");
        let mut shaped = HashMap::new();
        for (language, settings) in written_table(&place, languages, &mut dropped) {
            let place = format!("{place}.{language}");
            if !matches!(settings, Written::Table(_)) {
                dropped.push(format!("{place} is not a table and is ignored"));
                continue;
            }
            let mut settings = written_table(&place, settings, &mut dropped);
            let mut texts = |setting: &str, dropped: &mut Vec<String>| {
                settings
                    .remove(setting)
                    .map(|written| written_texts(&format!("{place}.{setting}"), written, dropped))
                    .unwrap_or_default()
            };
            let field_names = texts("field_names", &mut dropped);
            let table_names = texts("table_names", &mut dropped);
            let mut nested = |setting: &str, dropped: &mut Vec<String>| {
                let mut tables = HashMap::new();
                if let Some(written) = settings.remove(setting) {
                    let place = format!("{place}.{setting}");
                    for (key, entries) in written_table(&place, written, dropped) {
                        let place = format!("{place}.{key}");
                        if matches!(entries, Written::Table(_)) {
                            tables.insert(key, written_texts(&place, entries, dropped));
                        } else {
                            dropped.push(format!("{place} is not a table and is ignored"));
                        }
                    }
                }
                tables
            };
            let choice_labels = nested("choice_labels", &mut dropped);
            let sentences = nested("sentences", &mut dropped);
            shaped.insert(
                language,
                SpokenNamesConfig {
                    field_names,
                    choice_labels,
                    table_names,
                    sentences,
                },
            );
        }
        vocabularies.insert(name, shaped);
    }
    dropped.sort();
    (vocabularies, dropped)
}

/// Reads `[spoken_vocabularies]` leaving out every wrongly shaped part;
/// [`misshaped_spoken_entries`] names them.
pub fn deserialize_spoken_vocabularies<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<SpokenVocabulariesConfig, D::Error> {
    Ok(shaped_vocabularies(Written::deserialize(deserializer)?).0)
}

/// The parts of `[spoken_vocabularies]` the loader leaves out for their
/// shape, sorted: a text where a table belongs, or anything but a text where
/// a name belongs.
pub fn misshaped_spoken_entries(schema: &Config) -> Vec<String> {
    schema
        .get::<Written>("spoken_vocabularies")
        .map(|written| shaped_vocabularies(written).1)
        .unwrap_or_default()
}

/// The values of `[approval_speech]` the loader replaces by the default for
/// their kind, sorted.
pub fn misshaped_approval_speech(schema: &Config) -> Vec<String> {
    schema
        .get::<Written>("approval_speech")
        .map(|written| shaped_approval_speech(written).1)
        .unwrap_or_default()
}

fn wrong(dropped: &mut Vec<String>, key: &str, expected: &str) {
    dropped.push(format!(
        "approval_speech.{key} is not {expected}; the default is used"
    ));
}

/// `[approval_speech]` as written: a value of the wrong kind or shape keeps
/// the default with a warning instead of stopping the configuration.
fn shaped_approval_speech(written: Written) -> (ApprovalSpeechConfig, Vec<String>) {
    let mut dropped = Vec::new();
    let mut config = ApprovalSpeechConfig::default();
    let mut settings = written_table("approval_speech", written, &mut dropped);
    match settings.remove("amount") {
        None => {}
        Some(Written::Text(text)) if text == "full" => config.amount = ApprovalSpeechAmount::Full,
        Some(Written::Text(text)) if text == "short" => {
            config.amount = ApprovalSpeechAmount::Short;
        }
        Some(_) => wrong(&mut dropped, "amount", "`full` or `short`"),
    }
    match settings.remove("wording") {
        None => {}
        Some(Written::Text(text)) if text == "precise" => {
            config.wording = ApprovalSpeechWording::Precise;
        }
        Some(Written::Text(text)) if text == "natural" => {
            config.wording = ApprovalSpeechWording::Natural;
        }
        Some(_) => wrong(&mut dropped, "wording", "`precise` or `natural`"),
    }
    match settings.remove("short_details") {
        None => {}
        Some(Written::Number(number)) if number > i64::from(MAX_SHORT_DETAILS) => {
            dropped.push(format!(
                "approval_speech.short_details {number} is more than {MAX_SHORT_DETAILS}; {MAX_SHORT_DETAILS} is used"
            ));
            config.short_details = MAX_SHORT_DETAILS;
        }
        Some(Written::Number(number)) if number >= 0 => {
            config.short_details = u8::try_from(number).unwrap_or(MAX_SHORT_DETAILS);
        }
        Some(_) => wrong(&mut dropped, "short_details", "a number from 0 to 3"),
    }
    match settings.remove("user_choice") {
        None => {}
        Some(Written::Flag(flag)) => config.user_choice = flag,
        Some(_) => wrong(&mut dropped, "user_choice", "`true` or `false`"),
    }
    if let Some(languages) = settings.remove("sentences") {
        let place = "approval_speech.sentences";
        for (language, variants) in written_table(place, languages, &mut dropped) {
            let place = format!("{place}.{language}");
            if matches!(variants, Written::Table(_)) {
                config
                    .sentences
                    .insert(language, written_texts(&place, variants, &mut dropped));
            } else {
                dropped.push(format!("{place} is not a table and is ignored"));
            }
        }
    }
    if let Some(words) = settings.remove("words") {
        config.words =
            crate::approval_speech_words::shaped_approval_speech_words(words, &mut dropped);
    }
    dropped.sort();
    (config, dropped)
}

/// Reads `[approval_speech]` keeping the default for every value of the
/// wrong kind; [`misshaped_approval_speech`] names them.
pub fn deserialize_approval_speech<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<ApprovalSpeechConfig, D::Error> {
    Ok(shaped_approval_speech(Written::deserialize(deserializer)?).0)
}

/// One language's number words, so that a number or date a person says in
/// words ("den zweiundzwanzigsten", "sixty percent") is recognised as the
/// value on a corrected approval card. The web app combines them the same
/// way for every language; which words exist, and how ordinals end, is this
/// data. Without it only digits are read.
#[derive(Debug, Default, Deserialize, Serialize, PartialEq, Eq, Clone, Facet, HeapSize)]
pub struct SpokenNumberWordsConfig {
    /// Words that are a number alone and inside a compound: `zwei = 2`,
    /// `zwanzig = 20`.
    #[serde(default)]
    #[facet(erato_config::introduced_in(version = "0.9.0"))]
    pub numbers: HashMap<String, u64>,
    /// Words that may be a number or another word (`ein`, `one`, `second`):
    /// inside a compound they are a number, alone only maybe, so the voice
    /// then neither calls a change asked for nor unasked.
    #[serde(default)]
    #[facet(erato_config::introduced_in(version = "0.9.0"))]
    pub ambiguous: HashMap<String, u64>,
    /// Words that multiply what comes before them: `hundert = 100`,
    /// `thousand = 1000`.
    #[serde(default)]
    #[facet(erato_config::introduced_in(version = "0.9.0"))]
    pub multipliers: HashMap<String, u64>,
    /// Words that join the parts of one number: `und`, `and`.
    #[serde(default)]
    #[facet(erato_config::introduced_in(version = "0.9.0"))]
    pub joiners: Vec<String>,
    /// Ordinals as the stem before an ending: `zwanzigst = 20`,
    /// `third = 3`.
    #[serde(default)]
    #[facet(erato_config::introduced_in(version = "0.9.0"))]
    pub ordinals: HashMap<String, u64>,
    /// Ordinal stems that may be another word (`acht` in "achte darauf",
    /// `erst` in "als Erstes"): inside a compound an ordinal, alone only
    /// maybe, like `ambiguous`.
    #[serde(default)]
    #[facet(erato_config::introduced_in(version = "0.9.0"))]
    pub ambiguous_ordinals: HashMap<String, u64>,
    /// What may follow an ordinal stem (`en` in "zwanzigsten"); `""` lets a
    /// stem stand alone, as in English.
    #[serde(default)]
    #[facet(erato_config::introduced_in(version = "0.9.0"))]
    pub ordinal_endings: Vec<String>,
}

/// `[spoken_number_words.<language>]`, by lowercase language tag.
pub type SpokenNumberWordsByLanguage = HashMap<String, SpokenNumberWordsConfig>;

const NUMBER_WORDS_SETTINGS: &[&str] = &[
    "numbers",
    "ambiguous",
    "multipliers",
    "joiners",
    "ordinals",
    "ambiguous_ordinals",
    "ordinal_endings",
];
/// Words one language holds; far more than any language's number words.
const MAX_NUMBER_WORDS: usize = 2_000;
/// A word longer than this is no number word.
const MAX_NUMBER_WORD_BYTES: usize = 64;
/// A value above this is no number a person says to a card.
const MAX_NUMBER_VALUE: i64 = 1_000_000_000_000;
const MAX_ORDINAL_ENDING_BYTES: usize = 16;

fn written_numbers(
    place: &str,
    written: Written,
    dropped: &mut Vec<String>,
) -> HashMap<String, u64> {
    let mut numbers = HashMap::new();
    for (word, value) in written_table(place, written, dropped) {
        match value {
            Written::Number(number) if (0..=MAX_NUMBER_VALUE).contains(&number) => {
                numbers.insert(word, number.unsigned_abs());
            }
            _ => dropped.push(format!(
                "{place}: '{}' is not a whole number from 0 to {MAX_NUMBER_VALUE} and is ignored",
                shown(&word)
            )),
        }
    }
    numbers
}

/// Unlike [`crate::language_words::word_list`], keeps an empty entry: an
/// empty ordinal ending lets a stem stand alone. `drop_unusable` checks the
/// entries.
fn written_words(place: &str, written: Written, dropped: &mut Vec<String>) -> Vec<String> {
    let Written::List(entries) = written else {
        dropped.push(format!("{place} is not a list and is ignored"));
        return Vec::new();
    };
    let mut words = Vec::new();
    for entry in entries {
        match entry {
            Written::Text(text) => words.push(text),
            _ => dropped.push(format!("{place}: an entry is not a text and is ignored")),
        }
    }
    words
}

/// The number words whose shape is right, and each part that is not.
fn shaped_number_words(written: Written) -> (SpokenNumberWordsByLanguage, Vec<String>) {
    let mut dropped = Vec::new();
    let mut languages = SpokenNumberWordsByLanguage::new();
    for (language, mut settings) in
        crate::language_words::language_tables("spoken_number_words", written, &mut dropped)
    {
        let place = format!("spoken_number_words.{language}");
        let mut numbers = |setting: &str, dropped: &mut Vec<String>| {
            settings
                .remove(setting)
                .map(|written| written_numbers(&format!("{place}.{setting}"), written, dropped))
                .unwrap_or_default()
        };
        let words = numbers("numbers", &mut dropped);
        let ambiguous = numbers("ambiguous", &mut dropped);
        let multipliers = numbers("multipliers", &mut dropped);
        let ordinals = numbers("ordinals", &mut dropped);
        let ambiguous_ordinals = numbers("ambiguous_ordinals", &mut dropped);
        let mut list = |setting: &str, dropped: &mut Vec<String>| {
            settings
                .remove(setting)
                .map(|written| written_words(&format!("{place}.{setting}"), written, dropped))
                .unwrap_or_default()
        };
        let joiners = list("joiners", &mut dropped);
        let ordinal_endings = list("ordinal_endings", &mut dropped);
        languages.insert(
            language,
            SpokenNumberWordsConfig {
                numbers: words,
                ambiguous,
                multipliers,
                joiners,
                ordinals,
                ambiguous_ordinals,
                ordinal_endings,
            },
        );
    }
    dropped.sort();
    (languages, dropped)
}

/// Reads `[spoken_number_words]` leaving out every wrongly shaped part;
/// [`misshaped_number_words`] names them.
pub fn deserialize_spoken_number_words<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<SpokenNumberWordsByLanguage, D::Error> {
    Ok(shaped_number_words(Written::deserialize(deserializer)?).0)
}

/// The parts of `[spoken_number_words]` the loader leaves out for their
/// shape, sorted.
pub fn misshaped_number_words(schema: &Config) -> Vec<String> {
    schema
        .get::<Written>("spoken_number_words")
        .map(|written| shaped_number_words(written).1)
        .unwrap_or_default()
}

impl SpokenNumberWordsConfig {
    fn entries(&self) -> usize {
        self.numbers.len()
            + self.ambiguous.len()
            + self.multipliers.len()
            + self.ordinals.len()
            + self.ambiguous_ordinals.len()
            + self.joiners.len()
            + self.ordinal_endings.len()
    }

    /// Removes the words that cannot be a number word and names each one:
    /// blank, too long, with spaces or hidden characters. A language with
    /// more words than allowed is removed whole.
    fn drop_unusable(&mut self, place: &str) -> Vec<String> {
        if self.entries() > MAX_NUMBER_WORDS {
            let count = self.entries();
            *self = Self::default();
            return vec![format!(
                "{place} holds {count} words, more than the {MAX_NUMBER_WORDS} allowed; it is ignored"
            )];
        }
        let word_ok = |word: &str| {
            usable(word, MAX_NUMBER_WORD_BYTES) && !word.chars().any(char::is_whitespace)
        };
        let mut dropped = Vec::new();
        for (what, entries) in [
            ("numbers", &mut self.numbers),
            ("ambiguous", &mut self.ambiguous),
            ("multipliers", &mut self.multipliers),
            ("ordinals", &mut self.ordinals),
            ("ambiguous_ordinals", &mut self.ambiguous_ordinals),
        ] {
            entries.retain(|word, _| {
                let keep = word_ok(word);
                if !keep {
                    dropped.push(format!("{place}.{what}: '{}' is ignored", shown(word)));
                }
                keep
            });
        }
        self.multipliers.retain(|word, value| {
            let keep = *value >= 10;
            if !keep {
                dropped.push(format!(
                    "{place}.multipliers: '{}' multiplies by less than 10 and is ignored",
                    shown(word)
                ));
            }
            keep
        });
        self.joiners.retain(|word| {
            let keep = word_ok(word);
            if !keep {
                dropped.push(format!("{place}.joiners: '{}' is ignored", shown(word)));
            }
            keep
        });
        // An empty ending is meaningful: the stem may stand alone.
        self.ordinal_endings.retain(|ending| {
            let keep = ending.len() <= MAX_ORDINAL_ENDING_BYTES
                && !ending.chars().any(|c| c.is_control() || c.is_whitespace())
                && !has_hidden_chars(ending);
            if !keep {
                dropped.push(format!(
                    "{place}.ordinal_endings: '{}' is ignored",
                    shown(ending)
                ));
            }
            keep
        });
        dropped
    }
}

/// Removes what cannot be read as number words, so that one bad entry of a
/// content package never stops a deployment, and names each removal for a
/// warning.
pub fn drop_unusable_number_words(languages: &mut SpokenNumberWordsByLanguage) -> Vec<String> {
    let mut dropped = Vec::new();
    languages.retain(|language, words| {
        let place = format!("spoken_number_words.{language}");
        dropped.extend(words.drop_unusable(&place));
        // Without numbers, ordinals or their endings a day said in words
        // would read as not said: such a table counts as none.
        let missing: Vec<&str> = [
            ("numbers", words.numbers.is_empty()),
            (
                "ordinals",
                words.ordinals.is_empty() && words.ambiguous_ordinals.is_empty(),
            ),
            ("ordinal_endings", words.ordinal_endings.is_empty()),
        ]
        .into_iter()
        .filter_map(|(what, empty)| empty.then_some(what))
        .collect();
        if !missing.is_empty() {
            dropped.push(format!(
                "{place} has no {}; it is ignored and only digits are read in this language",
                missing.join(", ")
            ));
            return false;
        }
        true
    });
    dropped.sort();
    dropped
}

/// A language tag as the voice uses it: `de`, `en`, `pt-br`.
pub fn is_language_tag(tag: &str) -> bool {
    let mut parts = tag.split('-');
    let primary = parts.next().unwrap_or_default();
    (2..=3).contains(&primary.len())
        && primary.chars().all(|c| c.is_ascii_lowercase())
        && parts.all(|part| {
            (2..=8).contains(&part.len()) && part.chars().all(|c| c.is_ascii_alphanumeric())
        })
}

pub(crate) fn usable(text: &str, max_bytes: usize) -> bool {
    !text.trim().is_empty()
        && text.len() <= max_bytes
        && !text.chars().any(char::is_control)
        && !has_hidden_chars(text)
}

pub(crate) fn shown(text: &str) -> String {
    text.chars().take(MAX_ENTRY_BYTES).collect()
}

impl SpokenNamesConfig {
    fn entries(&self) -> usize {
        self.field_names.len()
            + self.table_names.len()
            + self.choice_labels.values().map(HashMap::len).sum::<usize>()
            + self.sentences.values().map(HashMap::len).sum::<usize>()
    }

    /// Removes the entries the voice cannot say and names each one: blank,
    /// too long, or with hidden characters. A language with more entries
    /// than allowed is removed whole.
    fn drop_unusable(&mut self, place: &str) -> Vec<String> {
        if self.entries() > MAX_VOCABULARY_ENTRIES {
            let count = self.entries();
            *self = Self::default();
            return vec![format!(
                "{place} holds {count} entries, more than the {MAX_VOCABULARY_ENTRIES} allowed; it is ignored"
            )];
        }
        let name_ok = |name: &str| {
            usable(name, MAX_ENTRY_BYTES) && name.chars().count() <= MAX_SPOKEN_NAME_CHARS
        };
        let mut dropped = Vec::new();
        for (what, entries) in [
            ("field_names", &mut self.field_names),
            ("table_names", &mut self.table_names),
        ] {
            entries.retain(|key, name| {
                let keep = usable(key, MAX_ENTRY_BYTES) && name_ok(name);
                if !keep {
                    dropped.push(format!("{place}.{what}: '{}' is ignored", shown(key)));
                }
                keep
            });
        }
        self.sentences.retain(|kind, variants| {
            if !SENTENCE_TYPES.iter().any(|(name, _)| name == kind) {
                dropped.push(format!("{place}.sentences: '{}' is ignored", shown(kind)));
                return false;
            }
            variants.retain(|key, template| {
                // Only a variant for one field of one table may leave the
                // field's name out: its words name that field.
                let problem = if usable(key, MAX_ENTRY_BYTES) {
                    variant_problem(kind, template, key.contains('.'))
                } else {
                    Some("its field name is blank, too long or holds hidden characters")
                };
                if let Some(problem) = problem {
                    dropped.push(format!(
                        "{place}.sentences.{kind}: '{}' is ignored: {problem}",
                        shown(key)
                    ));
                }
                problem.is_none()
            });
            true
        });
        self.choice_labels.retain(|field, labels| {
            if !usable(field, MAX_ENTRY_BYTES) {
                dropped.push(format!(
                    "{place}.choice_labels: '{}' is ignored",
                    shown(field)
                ));
                return false;
            }
            labels.retain(|value, label| {
                let keep = usable(value, MAX_ENTRY_BYTES) && name_ok(label);
                if !keep {
                    dropped.push(format!(
                        "{place}.choice_labels.{}: '{}' is ignored",
                        shown(field),
                        shown(value)
                    ));
                }
                keep
            });
            true
        });
        dropped
    }
}

/// Removes what the voice cannot say from the vocabularies, so that one bad
/// entry of a content package never stops a deployment, and names each
/// removal for a warning: a blank or hidden-character name, a language that
/// is not a lowercase tag, an entry that is blank, too long or holds hidden
/// characters.
pub fn drop_unusable_spoken_entries(vocabularies: &mut SpokenVocabulariesConfig) -> Vec<String> {
    let mut dropped = Vec::new();
    vocabularies.retain(|name, languages| {
        if !usable(name, MAX_ENTRY_BYTES) {
            dropped.push(format!("spoken_vocabularies: '{}' is ignored", shown(name)));
            return false;
        }
        languages.retain(|language, names| {
            if !is_language_tag(language) {
                dropped.push(format!(
                    "spoken_vocabularies.{name}: '{}' is not a lowercase language tag such as `de` and is ignored",
                    shown(language)
                ));
                return false;
            }
            dropped.extend(names.drop_unusable(&format!("spoken_vocabularies.{name}.{language}")));
            true
        });
        true
    });
    dropped.sort();
    dropped
}

/// How much a spoken card says.
#[derive(
    Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Facet, HeapSize, ToSchema,
)]
#[serde(rename_all = "snake_case")]
#[repr(u8)]
pub enum ApprovalSpeechAmount {
    /// What the card says today: losses, up to three details, the rest
    /// counted.
    #[default]
    Full,
    /// Only the first `short_details` details in the card's own order; the
    /// rest is held back, counted, and said when the user asks for it.
    Short,
}

/// How a spoken card is worded.
#[derive(
    Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Facet, HeapSize, ToSchema,
)]
#[serde(rename_all = "snake_case")]
#[repr(u8)]
pub enum ApprovalSpeechWording {
    /// Every spoken field named, old and new value both said.
    #[default]
    Precise,
    /// Hand-written sentence variants with the values in fixed slots.
    Natural,
}

/// `[approval_speech]`: how a waiting approval card is read aloud in
/// conversational audio mode. No model is involved: both settings choose
/// among sentences built by rule. Must-say pieces (losses, the outside
/// warning, a delete's subject, the consequence) and the request are said
/// in every combination, in their precise words.
#[derive(Debug, Deserialize, PartialEq, Eq, Clone, Facet, HeapSize)]
#[serde(default)]
pub struct ApprovalSpeechConfig {
    /// The deployment's amount: `full` or `short`.
    #[facet(erato_config::introduced_in(version = "0.9.0"))]
    pub amount: ApprovalSpeechAmount,
    /// Details a short reading says before it holds back the rest, 0 to 3.
    #[facet(erato_config::introduced_in(version = "0.9.0"))]
    pub short_details: u8,
    /// The deployment's wording: `precise` or `natural`.
    #[facet(erato_config::introduced_in(version = "0.9.0"))]
    pub wording: ApprovalSpeechWording,
    /// Whether a user may choose their own amount and wording. `false` is a
    /// lock no audience reopens; with `true`, a supervisor's audience may
    /// still close it.
    #[facet(erato_config::introduced_in(version = "0.9.0"))]
    pub user_choice: bool,
    /// Per language tag, natural sentence variants by sentence type
    /// (`changed`, `set`, `updated`), replacing the built-in ones. A variant
    /// without exactly its slots is ignored with a warning; each one in use
    /// is logged at startup with sample values. The check guards the slots,
    /// not the meaning: the sentence is its author's responsibility.
    #[facet(erato_config::introduced_in(version = "0.9.0"))]
    pub sentences: HashMap<String, HashMap<String, String>>,
    /// Per language tag, the words a spoken card says as code (number
    /// words, ordinals, times, a value's direction) and reads the user's
    /// words with, added to the built-in German and English ones. A
    /// language says the whole card only with `full_card = true`.
    #[serde(skip)]
    #[facet(erato_config::introduced_in(version = "0.9.0"))]
    pub words: crate::approval_speech_words::ApprovalSpeechWordsByLanguage,
}

pub const MAX_SHORT_DETAILS: u8 = 3;

impl Default for ApprovalSpeechConfig {
    fn default() -> Self {
        Self {
            amount: ApprovalSpeechAmount::Full,
            short_details: 1,
            wording: ApprovalSpeechWording::Precise,
            user_choice: true,
            sentences: HashMap::new(),
            words: HashMap::new(),
        }
    }
}

impl ApprovalSpeechConfig {
    /// Clamps what is out of range and removes the variants that cannot be
    /// used, naming each for a warning.
    pub fn drop_unusable(&mut self) -> Vec<String> {
        let mut dropped = Vec::new();
        if self.short_details > MAX_SHORT_DETAILS {
            dropped.push(format!(
                "approval_speech.short_details {} is more than {MAX_SHORT_DETAILS}; {MAX_SHORT_DETAILS} is used",
                self.short_details
            ));
            self.short_details = MAX_SHORT_DETAILS;
        }
        self.sentences.retain(|language, variants| {
            if !is_language_tag(language) {
                dropped.push(format!(
                    "approval_speech.sentences: '{}' is not a lowercase language tag and is ignored",
                    shown(language)
                ));
                return false;
            }
            variants.retain(|key, template| {
                let problem = variant_problem(key, template, false);
                if let Some(problem) = problem {
                    dropped.push(format!(
                        "approval_speech.sentences.{language}: '{}' is ignored: {problem}",
                        shown(key)
                    ));
                }
                problem.is_none()
            });
            true
        });
        dropped.sort();
        dropped
    }
}

const APPROVAL_SPEECH_SETTINGS: &[&str] = &[
    "amount",
    "short_details",
    "wording",
    "user_choice",
    "sentences",
    "words",
];

/// The vocabularies a server names that no source defines. Warned about, not
/// rejected: the content package that defines them may not be applied.
pub fn missing_vocabularies<'a>(
    used: impl IntoIterator<Item = (&'a str, &'a [String])>,
    vocabularies: &SpokenVocabulariesConfig,
) -> Vec<String> {
    let mut missing: Vec<String> = used
        .into_iter()
        .flat_map(|(server, names)| {
            names
                .iter()
                .filter(|name| !vocabularies.contains_key(name.as_str()))
                .map(move |name| format!("mcp_servers.{server}.glossary.vocabularies: '{name}'"))
        })
        .collect();
    missing.sort();
    missing
}

/// Keys under `[spoken_vocabularies]` this backend does not know, sorted. A
/// content package may be newer than the backend.
pub fn unknown_spoken_keys(schema: &Config) -> Vec<String> {
    let mut unknown = Vec::new();
    if let Ok(settings) = schema.get_table("approval_speech") {
        unknown.extend(
            settings
                .into_keys()
                .filter(|key| !APPROVAL_SPEECH_SETTINGS.contains(&key.as_str()))
                .map(|key| format!("approval_speech.{key}")),
        );
    }
    if let Ok(languages) = schema.get_table("spoken_number_words") {
        for (language, settings) in languages {
            let Ok(settings) = settings.into_table() else {
                continue;
            };
            unknown.extend(
                settings
                    .into_keys()
                    .filter(|key| !NUMBER_WORDS_SETTINGS.contains(&key.as_str()))
                    .map(|key| format!("spoken_number_words.{language}.{key}")),
            );
        }
    }
    if let Ok(vocabularies) = schema.get_table("spoken_vocabularies") {
        for (name, languages) in vocabularies {
            let Ok(languages) = languages.into_table() else {
                continue;
            };
            for (language, settings) in languages {
                let Ok(settings) = settings.into_table() else {
                    continue;
                };
                unknown.extend(
                    settings
                        .into_keys()
                        .filter(|key| !SPOKEN_NAMES_SETTINGS.contains(&key.as_str()))
                        .map(|key| format!("spoken_vocabularies.{name}.{language}.{key}")),
                );
            }
        }
    }
    unknown.sort();
    unknown
}

#[cfg(test)]
mod tests {
    use super::*;
    use config::{File, FileFormat};

    fn schema(toml: &str) -> Config {
        Config::builder()
            .add_source(File::from_str(toml, FileFormat::Toml))
            .build()
            .unwrap()
    }

    fn vocabularies(toml: &str) -> SpokenVocabulariesConfig {
        #[derive(Deserialize)]
        struct Holder {
            #[serde(default, deserialize_with = "deserialize_spoken_vocabularies")]
            spoken_vocabularies: SpokenVocabulariesConfig,
        }
        schema(toml)
            .try_deserialize::<Holder>()
            .unwrap()
            .spoken_vocabularies
    }

    #[test]
    fn a_vocabulary_holds_names_per_language() {
        let loaded = vocabularies(
            r#"
            [spoken_vocabularies.dataverse.de.field_names]
            statecode = "Status"
            [spoken_vocabularies.dataverse.de.choice_labels.statecode]
            "0" = "aktiv"
            [spoken_vocabularies.dataverse.en.table_names]
            opportunity = "opportunities"
            "#,
        );
        let de = &loaded["dataverse"]["de"];
        assert_eq!(de.field_names["statecode"], "Status");
        assert_eq!(de.choice_labels["statecode"]["0"], "aktiv");
        assert_eq!(
            loaded["dataverse"]["en"].table_names["opportunity"],
            "opportunities"
        );
        assert!(drop_unusable_spoken_entries(&mut loaded.clone()).is_empty());
    }

    #[test]
    fn unusable_entries_and_language_tags_are_dropped_with_a_warning() {
        for toml in [
            "[spoken_vocabularies.v.German.field_names]\na = \"b\"",
            "[spoken_vocabularies.v.de.field_names]\na = \" \"",
            "[spoken_vocabularies.v.de.field_names]\na = \"b\u{200B}c\"",
            "[spoken_vocabularies.v.de.table_names]\na = \"eine sehr lange Bezeichnung, die eher ein Satz ist als ein Name für eine Tabelle\"",
            "[spoken_vocabularies.v.de.choice_labels.f]\n\"\" = \"b\"",
        ] {
            let mut loaded = vocabularies(&format!(
                "{toml}\n[spoken_vocabularies.v.en.field_names]\nok = \"Good\""
            ));
            let dropped = drop_unusable_spoken_entries(&mut loaded);
            assert_eq!(dropped.len(), 1, "{toml}: {dropped:?}");
            assert_eq!(loaded["v"]["en"].field_names["ok"], "Good", "{toml}");
        }
    }

    #[test]
    fn unknown_keys_are_listed_not_rejected() {
        let toml = r#"
            [spoken_vocabularies.dataverse.de]
            verbs = { a = "b" }
            [spoken_vocabularies.dataverse.de.field_names]
            a = "b"
        "#;
        assert_eq!(
            unknown_spoken_keys(&schema(toml)),
            vec!["spoken_vocabularies.dataverse.de.verbs".to_string()]
        );
        assert!(
            vocabularies(toml)["dataverse"]["de"]
                .field_names
                .contains_key("a")
        );
    }

    #[test]
    fn variants_follow_the_cases_the_web_app_checks_too() {
        #[derive(Deserialize)]
        struct Case {
            key: String,
            template: String,
            for_one_field: bool,
            usable: bool,
        }
        #[derive(Deserialize)]
        struct Cases {
            cases: Vec<Case>,
        }
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../frontend/src/lib/toolCallGist/fixtures/spokenSentenceVariants.json"
        );
        let cases: Cases = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        assert!(cases.cases.len() > 20);
        for case in cases.cases {
            assert_eq!(
                usable_variant(&case.key, &case.template, case.for_one_field),
                case.usable,
                "{} {:?}: {:?}",
                case.key,
                case.template,
                variant_problem(&case.key, &case.template, case.for_one_field)
            );
        }
    }

    #[test]
    fn only_a_variant_for_one_table_may_leave_out_the_field() {
        let mut loaded = vocabularies(
            r#"
            [spoken_vocabularies.v.de.sentences.changed]
            estimatedclosedate = "Der Abschluss verschiebt sich {from} {to}."
            "opportunity.estimatedclosedate" = "Der Abschluss verschiebt sich {from} {to}."
            closeprobability = "{field} geht {from} {to}."
            "#,
        );
        let dropped = drop_unusable_spoken_entries(&mut loaded);
        assert_eq!(
            dropped,
            vec![
                "spoken_vocabularies.v.de.sentences.changed: 'estimatedclosedate' is ignored: a slot is missing"
                    .to_string()
            ]
        );
        let changed = &loaded["v"]["de"].sentences["changed"];
        assert!(changed.contains_key("opportunity.estimatedclosedate"));
        assert!(changed.contains_key("closeprobability"));
    }

    #[test]
    fn every_variant_in_use_is_shown_with_sample_values() {
        let loaded = vocabularies(
            r#"
            [spoken_vocabularies.v.en.sentences.changed]
            "opportunity.estimatedclosedate" = "The close date moves {from} {to}."
            "#,
        );
        let speech = ApprovalSpeechConfig {
            sentences: HashMap::from([(
                "de".to_string(),
                HashMap::from([(
                    "updated".to_string(),
                    "{field} wird {value} gesetzt.".to_string(),
                )]),
            )]),
            ..ApprovalSpeechConfig::default()
        };
        assert_eq!(
            sentences_in_use(&loaded, Some(&speech)),
            vec![
                "approval_speech.sentences.de.updated says \"Priorität wird auf Hoch gesetzt.\"",
                "spoken_vocabularies.v.en.sentences.changed.opportunity.estimatedclosedate says \"The close date moves from Low to High.\"",
            ]
        );
        // A swapped sentence cannot hide it: the direction is in the value.
        assert_eq!(
            sample_sentence("en", "changed", "{field}: now {from}, previously {to}."),
            "Priority: now from Low, previously to High."
        );
    }

    #[test]
    fn a_wrong_approval_speech_value_keeps_the_default() {
        #[derive(Deserialize)]
        struct Holder {
            #[serde(default, deserialize_with = "deserialize_approval_speech")]
            approval_speech: ApprovalSpeechConfig,
        }
        let toml = r#"
            [approval_speech]
            amount = "medium"
            wording = "natural"
            short_details = 300
            user_choice = "no"
            [approval_speech.sentences]
            de = "x"
            [approval_speech.sentences.en]
            changed = "{field} changes {from} {to}."
            set = 5
        "#;
        let loaded = schema(toml)
            .try_deserialize::<Holder>()
            .unwrap()
            .approval_speech;
        assert_eq!(loaded.amount, ApprovalSpeechAmount::Full);
        assert_eq!(loaded.wording, ApprovalSpeechWording::Natural);
        assert_eq!(loaded.short_details, MAX_SHORT_DETAILS);
        assert!(loaded.user_choice);
        assert_eq!(loaded.sentences.len(), 1);
        assert_eq!(loaded.sentences["en"].len(), 1);
        assert_eq!(
            misshaped_approval_speech(&schema(toml)),
            vec![
                "approval_speech.amount is not `full` or `short`; the default is used",
                "approval_speech.sentences.de is not a table and is ignored",
                "approval_speech.sentences.en: 'set' is not a text and is ignored",
                "approval_speech.short_details 300 is more than 3; 3 is used",
                "approval_speech.user_choice is not `true` or `false`; the default is used",
            ]
        );
        let plain = schema("[approval_speech]\namount = \"short\"\nshort_details = 2")
            .try_deserialize::<Holder>()
            .unwrap()
            .approval_speech;
        assert_eq!(plain.amount, ApprovalSpeechAmount::Short);
        assert_eq!(plain.short_details, 2);
    }

    #[test]
    fn unusable_variants_are_dropped_with_a_warning() {
        let mut config = ApprovalSpeechConfig {
            short_details: 9,
            sentences: HashMap::from([(
                "de".to_string(),
                HashMap::from([
                    (
                        "changed".to_string(),
                        "{field} geht {from} {to}.".to_string(),
                    ),
                    ("set".to_string(), "{value} ist {field}.".to_string()),
                ]),
            )]),
            ..ApprovalSpeechConfig::default()
        };
        let dropped = config.drop_unusable();
        assert_eq!(dropped.len(), 2, "{dropped:?}");
        assert_eq!(config.short_details, MAX_SHORT_DETAILS);
        assert!(config.sentences["de"].contains_key("changed"));
        assert!(!config.sentences["de"].contains_key("set"));
    }

    #[test]
    fn a_wrongly_shaped_entry_is_dropped_and_named() {
        let toml = r#"
            [spoken_vocabularies.broken]
            de = "x"
            [spoken_vocabularies.dataverse.de]
            table_names = "Tabellen"
            [spoken_vocabularies.dataverse.de.field_names]
            ok = "Gut"
            nested = { a = "b" }
            number = 5
            [spoken_vocabularies.dataverse.de.choice_labels]
            statecode = "Status"
            [spoken_vocabularies.dataverse.de.choice_labels.prioritycode]
            "1" = "Hoch"
            "2" = { a = "b" }
            [spoken_vocabularies.dataverse.de.sentences]
            changed = "{field} ändert sich {from} {to}."
            [spoken_vocabularies.dataverse.de.sentences.set]
            statecode = "{field} wird {value}."
        "#;
        let loaded = vocabularies(toml);
        let de = &loaded["dataverse"]["de"];
        assert_eq!(de.field_names.len(), 1);
        assert_eq!(de.field_names["ok"], "Gut");
        assert!(de.table_names.is_empty());
        assert!(!de.choice_labels.contains_key("statecode"));
        assert_eq!(de.choice_labels["prioritycode"].len(), 1);
        assert!(loaded["broken"].is_empty());
        assert_eq!(de.sentences.len(), 1);
        assert_eq!(de.sentences["set"].len(), 1);
        assert_eq!(
            misshaped_spoken_entries(&schema(toml)),
            vec![
                "spoken_vocabularies.broken.de is not a table and is ignored",
                "spoken_vocabularies.dataverse.de.choice_labels.prioritycode: '2' is not a text and is ignored",
                "spoken_vocabularies.dataverse.de.choice_labels.statecode is not a table and is ignored",
                "spoken_vocabularies.dataverse.de.field_names: 'nested' is not a text and is ignored",
                "spoken_vocabularies.dataverse.de.field_names: 'number' is not a text and is ignored",
                "spoken_vocabularies.dataverse.de.sentences.changed is not a table and is ignored",
                "spoken_vocabularies.dataverse.de.table_names is not a table and is ignored",
            ]
        );
        assert!(misshaped_spoken_entries(&schema("[other]\na = 1")).is_empty());
    }

    #[test]
    fn a_missing_vocabulary_is_named() {
        let loaded = vocabularies("[spoken_vocabularies.dataverse.de.field_names]\na = \"b\"");
        let used = vec!["dataverse".to_string(), "sap".to_string()];
        assert_eq!(
            missing_vocabularies([("dynamics", used.as_slice())], &loaded),
            vec!["mcp_servers.dynamics.glossary.vocabularies: 'sap'".to_string()]
        );
    }
    fn number_words(toml: &str) -> SpokenNumberWordsByLanguage {
        #[derive(Deserialize)]
        struct Holder {
            #[serde(default, deserialize_with = "deserialize_spoken_number_words")]
            spoken_number_words: SpokenNumberWordsByLanguage,
        }
        schema(toml)
            .try_deserialize::<Holder>()
            .unwrap()
            .spoken_number_words
    }

    #[test]
    fn number_words_take_the_same_language_tags_as_the_other_language_data() {
        let toml = "[spoken_number_words.DE]\nnumbers = { zwei = 2 }\n\
                    [spoken_number_words.pt-BR]\nnumbers = { dois = 2 }\n\
                    [spoken_number_words.pt-br]\nnumbers = { dois = 2 }\n";
        assert_eq!(number_words(toml).keys().collect::<Vec<_>>(), ["pt-br"]);
        assert_eq!(
            misshaped_number_words(&schema(toml)),
            ["DE", "pt-BR"].map(|tag| format!(
                "spoken_number_words: '{tag}' is not a lowercase language tag such as `de` and is ignored"
            ))
        );
    }

    #[test]
    fn number_words_hold_one_language_each() {
        let loaded = number_words(
            r#"
            [spoken_number_words.de]
            numbers = { zwei = 2, zwanzig = 20 }
            ambiguous = { ein = 1 }
            multipliers = { tausend = 1000 }
            joiners = ["und"]
            ordinals = { zwanzigst = 20 }
            ambiguous_ordinals = { acht = 8, "zwölft" = 12 }
            ordinal_endings = ["e", "en"]
            [spoken_number_words.en]
            ordinal_endings = [""]
        "#,
        );
        assert_eq!(loaded["de"].ambiguous_ordinals["acht"], 8);
        assert_eq!(loaded["de"].ambiguous_ordinals["zwölft"], 12);
        let de = &loaded["de"];
        assert_eq!(de.numbers["zwanzig"], 20);
        assert_eq!(de.ambiguous["ein"], 1);
        assert_eq!(de.multipliers["tausend"], 1000);
        assert_eq!(de.joiners, vec!["und"]);
        assert_eq!(de.ordinals["zwanzigst"], 20);
        assert_eq!(de.ordinal_endings, vec!["e", "en"]);
        assert_eq!(loaded["en"].ordinal_endings, vec![""]);
    }

    #[test]
    fn wrongly_shaped_number_words_are_dropped_and_named() {
        let toml = r#"
            [spoken_number_words]
            fr = "x"
            [spoken_number_words.de]
            numbers = { zwei = 2, minus = -1, halb = 0.5, viel = "viel", riesig = 9999999999999 }
            joiners = "und"
            ordinal_endings = ["en", 5]
            colour = "blue"
        "#;
        let loaded = number_words(toml);
        assert_eq!(loaded["de"].numbers.len(), 1);
        assert!(loaded["de"].joiners.is_empty());
        assert_eq!(loaded["de"].ordinal_endings, vec!["en"]);
        assert!(!loaded.contains_key("fr"));
        assert_eq!(
            misshaped_number_words(&schema(toml)),
            vec![
                "spoken_number_words.de.joiners is not a list and is ignored",
                "spoken_number_words.de.numbers: 'halb' is not a whole number from 0 to 1000000000000 and is ignored",
                "spoken_number_words.de.numbers: 'minus' is not a whole number from 0 to 1000000000000 and is ignored",
                "spoken_number_words.de.numbers: 'riesig' is not a whole number from 0 to 1000000000000 and is ignored",
                "spoken_number_words.de.numbers: 'viel' is not a whole number from 0 to 1000000000000 and is ignored",
                "spoken_number_words.de.ordinal_endings: an entry is not a text and is ignored",
                "spoken_number_words.fr is not a table and is ignored",
            ]
        );
        assert_eq!(
            unknown_spoken_keys(&schema(toml)),
            vec!["spoken_number_words.de.colour"]
        );
    }

    #[test]
    fn unusable_number_words_are_dropped_with_a_warning() {
        let mut loaded = number_words(
            r#"
            [spoken_number_words.de]
            numbers = { zwei = 2, "zwei drei" = 23, "" = 0 }
            multipliers = { tausend = 1000, eins = 1 }
            joiners = ["und", " "]
            ordinals = { zweit = 2 }
            ordinal_endings = ["", "en", "sehr lange endung"]
            [spoken_number_words.DE]
            numbers = { zwei = 2 }
            [spoken_number_words.en]
            numbers = { "two words" = 2 }
            ordinals = { second = 2 }
            ordinal_endings = [""]
            [spoken_number_words.fr]
            numbers = { deux = 2 }
        "#,
        );
        let dropped = drop_unusable_number_words(&mut loaded);
        assert_eq!(
            dropped,
            vec![
                "spoken_number_words.de.joiners: ' ' is ignored",
                "spoken_number_words.de.multipliers: 'eins' multiplies by less than 10 and is ignored",
                "spoken_number_words.de.numbers: '' is ignored",
                "spoken_number_words.de.numbers: 'zwei drei' is ignored",
                "spoken_number_words.de.ordinal_endings: 'sehr lange endung' is ignored",
                "spoken_number_words.en has no numbers; it is ignored and only digits are read in this language",
                "spoken_number_words.en.numbers: 'two words' is ignored",
                "spoken_number_words.fr has no ordinals, ordinal_endings; it is ignored and only digits are read in this language",
            ]
        );
        assert!(!loaded.contains_key("DE"));
        assert!(!loaded.contains_key("en"));
        assert!(!loaded.contains_key("fr"));
        let de = &loaded["de"];
        assert_eq!(de.numbers.len(), 1);
        assert_eq!(de.multipliers.len(), 1);
        assert_eq!(de.joiners, vec!["und"]);
        assert_eq!(de.ordinal_endings, vec!["", "en"]);
    }
}
