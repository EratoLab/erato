//! `[approval_voice_decisions.phrases.<language>]`: the phrase that approves
//! a waiting card by voice in a language. German and English have a built-in
//! phrase; a configured one replaces it. Only the shape is checked here; the
//! backend checks each phrase against the voice-command words of its
//! language at startup.

use std::collections::{BTreeMap, HashMap};

use config::Config;
use erato_memory::HeapSize;
use facet::Facet;
use serde::{Deserialize, Deserializer, Serialize};

use crate::language_words::{language_tables, word_list};
use crate::spoken::{MAX_ENTRY_BYTES, Written, shown, usable};

/// One language's confirmation phrase.
#[derive(Debug, Default, PartialEq, Eq, Clone, Facet, HeapSize, Serialize)]
pub struct ConfirmationPhraseConfig {
    /// The phrase as the card shows and the voice names it ("Je confirme").
    /// It is compared as transcripts are: lower case, accents kept, umlauts
    /// as "ae", punctuation as a word break.
    pub phrase: String,
    /// Single words of which one may come before the phrase ("oui").
    pub leading: Vec<String>,
    /// Single words of which one may come after the phrase ("svp").
    pub trailing: Vec<String>,
}

/// `[approval_voice_decisions.phrases]`, by lowercase language tag.
pub type ConfirmationPhrasesByLanguage = HashMap<String, ConfirmationPhraseConfig>;

/// A built-in phrase.
pub struct BuiltInPhrase {
    pub language: &'static str,
    pub phrase: &'static str,
    pub leading: &'static [&'static str],
    pub trailing: &'static [&'static str],
}

/// The phrases that hold without a content package.
pub const BUILT_IN_PHRASES: &[BuiltInPhrase] = &[
    BuiltInPhrase {
        language: "de",
        phrase: "Ich bestätige",
        leading: &["ja"],
        trailing: &["das", "bitte"],
    },
    BuiltInPhrase {
        language: "en",
        phrase: "I confirm",
        leading: &["yes"],
        trailing: &["this", "please"],
    },
];

impl BuiltInPhrase {
    pub fn config(&self) -> ConfirmationPhraseConfig {
        let words = |words: &[&str]| words.iter().map(|word| word.to_string()).collect();
        ConfirmationPhraseConfig {
            phrase: self.phrase.to_string(),
            leading: words(self.leading),
            trailing: words(self.trailing),
        }
    }
}

/// The built-in phrases as shown, by language, for the web app's base.
pub fn built_in_shown_phrases() -> BTreeMap<String, String> {
    BUILT_IN_PHRASES
        .iter()
        .map(|phrase| (phrase.language.to_string(), phrase.phrase.to_string()))
        .collect()
}

const PLACE: &str = "approval_voice_decisions.phrases";

/// The phrases whose shape is right, and each part that is not. A language
/// without a usable `phrase` is dropped; a wrong `leading` or `trailing`
/// list drops only that list.
fn shaped_confirmation_phrases(written: Written) -> (ConfirmationPhrasesByLanguage, Vec<String>) {
    let mut dropped = Vec::new();
    let mut languages = ConfirmationPhrasesByLanguage::new();
    for (language, table) in language_tables(PLACE, written, &mut dropped) {
        let place = format!("{PLACE}.{language}");
        let mut phrase = ConfirmationPhraseConfig::default();
        for (key, value) in table {
            let at = format!("{place}.{}", shown(&key));
            match (key.as_str(), value) {
                ("phrase", Written::Text(text)) if usable(&text, MAX_ENTRY_BYTES) => {
                    phrase.phrase = text.trim().to_string();
                }
                ("phrase", _) => dropped.push(format!(
                    "{at} is not a text of at most {MAX_ENTRY_BYTES} bytes without hidden characters and is ignored"
                )),
                ("leading", value) => phrase.leading = word_list(&at, value, &mut dropped),
                ("trailing", value) => phrase.trailing = word_list(&at, value, &mut dropped),
                _ => dropped.push(format!("{at}: no setting has this name; it is ignored")),
            }
        }
        if phrase.phrase.is_empty() {
            dropped.push(format!("{place} has no usable `phrase` and is ignored"));
            continue;
        }
        languages.insert(language, phrase);
    }
    dropped.sort();
    (languages, dropped)
}

/// Reads `[approval_voice_decisions.phrases]` leaving out every wrong part;
/// [`misshaped_confirmation_phrases`] names them.
pub fn deserialize_confirmation_phrases<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<ConfirmationPhrasesByLanguage, D::Error> {
    Ok(shaped_confirmation_phrases(Written::deserialize(deserializer)?).0)
}

/// The parts of `[approval_voice_decisions.phrases]` the loader leaves out,
/// sorted.
pub fn misshaped_confirmation_phrases(schema: &Config) -> Vec<String> {
    schema
        .get::<Written>(PLACE)
        .map(|written| shaped_confirmation_phrases(written).1)
        .unwrap_or_default()
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

    #[test]
    fn a_language_brings_its_phrase_and_words() {
        let toml = "[approval_voice_decisions]\nenabled = true\n\
                    [approval_voice_decisions.phrases.fr]\nphrase = \"Je confirme\"\n\
                    leading = [\"oui\"]\ntrailing = [\"svp\"]\n";
        let config = schema(toml)
            .get::<crate::config::ApprovalVoiceDecisionsConfig>("approval_voice_decisions")
            .unwrap();
        assert_eq!(
            config.phrases["fr"],
            ConfirmationPhraseConfig {
                phrase: "Je confirme".into(),
                leading: vec!["oui".into()],
                trailing: vec!["svp".into()],
            }
        );
        assert!(misshaped_confirmation_phrases(&schema(toml)).is_empty());
    }

    #[test]
    fn each_wrong_part_is_dropped_on_its_own() {
        let toml = "[approval_voice_decisions.phrases]\nIT = { phrase = \"Confermo\" }\n\
                    [approval_voice_decisions.phrases.fr]\nphrase = \"Je confirme\"\nleading = \"oui\"\nlouder = true\n\
                    [approval_voice_decisions.phrases.es]\nphrase = 3\ntrailing = [\"por favor\"]\n";
        let (phrases, dropped) =
            shaped_confirmation_phrases(schema(toml).get::<Written>(PLACE).unwrap());
        assert_eq!(phrases.keys().collect::<Vec<_>>(), ["fr"]);
        assert!(phrases["fr"].leading.is_empty());
        assert_eq!(
            dropped,
            [
                "approval_voice_decisions.phrases.es has no usable `phrase` and is ignored",
                "approval_voice_decisions.phrases.es.phrase is not a text of at most 128 bytes without hidden characters and is ignored",
                "approval_voice_decisions.phrases.fr.leading is not a list and is ignored",
                "approval_voice_decisions.phrases.fr.louder: no setting has this name; it is ignored",
                "approval_voice_decisions.phrases: 'IT' is not a lowercase language tag such as `de` and is ignored",
            ]
        );
    }

    #[test]
    fn without_the_section_only_the_built_in_phrases_hold() {
        let config = schema("[approval_voice_decisions]\nenabled = true\n")
            .get::<crate::config::ApprovalVoiceDecisionsConfig>("approval_voice_decisions")
            .unwrap();
        assert!(config.phrases.is_empty());
        assert_eq!(
            built_in_shown_phrases(),
            BTreeMap::from([
                ("de".to_string(), "Ich bestätige".to_string()),
                ("en".to_string(), "I confirm".to_string()),
            ])
        );
    }
}
