//! `[audio_conversational.spoken_language]`: which language the voice speaks
//! in conversational audio mode. The voice follows the language the user
//! speaks, chosen among the user's languages and the ones allowed here. The
//! interface language is a separate setting.

use erato_memory::HeapSize;
use facet::Facet;
use serde::{Deserialize, Deserializer};

use crate::config_facet_attrs as erato_config;
use crate::language_words::primary_subtag;
use crate::spoken::{Written, written_table, written_words};
use config::Config;

const PLACE: &str = "audio_conversational.spoken_language";

/// How many languages a user may list as the languages they speak.
pub const MAX_USER_SPOKEN_LANGUAGES: usize = 3;

/// The ISO 639 code a tag names (`hi`, `hi-IN`, `de_DE` → `de`), or `None`
/// for a tag that is not a language tag.
pub fn language_code(tag: &str) -> Option<String> {
    let primary = primary_subtag(tag);
    ((2..=3).contains(&primary.len()) && primary.bytes().all(|b| b.is_ascii_lowercase()))
        .then_some(primary)
}

/// `tags` as language codes in their order, without repeats; the tags that
/// are not language tags are returned apart.
pub fn language_codes<'a>(tags: impl IntoIterator<Item = &'a str>) -> (Vec<String>, Vec<&'a str>) {
    let mut codes: Vec<String> = Vec::new();
    let mut malformed = Vec::new();
    for tag in tags {
        match language_code(tag) {
            Some(code) if !codes.contains(&code) => codes.push(code),
            Some(_) => {}
            None => malformed.push(tag),
        }
    }
    (codes, malformed)
}

/// `[audio_conversational.spoken_language]`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Facet, HeapSize)]
#[serde(default)]
pub struct SpokenLanguageConfig {
    /// Whether the voice follows the language the user speaks, turn by turn.
    /// Off, the voice always speaks the user's main language. Defaults to
    /// `true`.
    #[facet(erato_config::introduced_in(version = "0.9.0"))]
    pub follow_speaker: bool,
    /// The languages people may speak here, as ISO 639-1 codes (`de`, `en`,
    /// `hi`), first = the main language for a user none of whose languages
    /// is listed. Also sent to the speech recognizer as the expected
    /// languages where it takes them. A user's own languages are limited to
    /// this list. Entries that are not language codes are dropped with a
    /// warning. Defaults to empty: any language.
    #[facet(erato_config::introduced_in(version = "0.9.0"))]
    pub languages: Vec<String>,
    /// Whether a user may list the languages they speak, unless a
    /// supervisor's audience setting says otherwise. Defaults to `true`.
    #[facet(erato_config::introduced_in(version = "0.9.0"))]
    pub user_choice: bool,
}

impl Default for SpokenLanguageConfig {
    fn default() -> Self {
        Self {
            follow_speaker: true,
            languages: Vec::new(),
            user_choice: true,
        }
    }
}

/// A value of the wrong kind keeps the default with a warning instead of
/// stopping the configuration.
fn shaped_spoken_language(written: Written) -> (SpokenLanguageConfig, Vec<String>) {
    let mut dropped = Vec::new();
    let mut config = SpokenLanguageConfig::default();
    let mut no_usable_language = false;
    for (key, value) in written_table(PLACE, written, &mut dropped) {
        match (key.as_str(), value) {
            ("follow_speaker", Written::Flag(flag)) => config.follow_speaker = flag,
            ("follow_speaker", _) => dropped.push(format!(
                "{PLACE}.follow_speaker is not `true` or `false`; the default is used"
            )),
            ("user_choice", Written::Flag(flag)) => config.user_choice = flag,
            ("user_choice", _) => dropped.push(format!(
                "{PLACE}.user_choice is not `true` or `false`; the default is used"
            )),
            ("languages", written) => {
                let place = format!("{PLACE}.languages");
                let tags = written_words(&place, written, &mut dropped);
                let (languages, malformed) = language_codes(tags.iter().map(String::as_str));
                for tag in &malformed {
                    dropped.push(format!("{place} has `{tag}`, which is not a language code"));
                }
                if languages.is_empty() && !malformed.is_empty() {
                    dropped.push(format!(
                        "{place} has no language code; the voice keeps to each user's main language"
                    ));
                    no_usable_language = true;
                } else {
                    config.languages = languages;
                }
            }
            (other, _) => dropped.push(format!("{PLACE}.{other} is not known and is ignored")),
        }
    }
    // A list with none of its languages left must not open the voice to any
    // language; with no level below the deployment, the voice keeps to the
    // main language instead.
    if no_usable_language {
        config.follow_speaker = false;
    }
    dropped.sort();
    (config, dropped)
}

pub fn deserialize_spoken_language<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<SpokenLanguageConfig, D::Error> {
    Ok(shaped_spoken_language(Written::deserialize(deserializer)?).0)
}

/// What the loader replaced or left out of
/// `[audio_conversational.spoken_language]`, sorted.
pub fn misshaped_spoken_language(schema: &Config) -> Vec<String> {
    schema
        .get::<Written>(PLACE)
        .map(|written| shaped_spoken_language(written).1)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shaped(value: serde_json::Value) -> (SpokenLanguageConfig, Vec<String>) {
        shaped_spoken_language(serde_json::from_value(value).unwrap())
    }

    #[test]
    fn follows_the_speaker_in_any_language_by_default() {
        let (config, dropped) = shaped(serde_json::json!({}));
        assert_eq!(config, SpokenLanguageConfig::default());
        assert!(config.follow_speaker);
        assert!(config.languages.is_empty());
        assert!(config.user_choice);
        assert!(dropped.is_empty());
    }

    #[test]
    fn languages_are_normalized_and_non_codes_dropped() {
        let (config, dropped) = shaped(serde_json::json!({
            "languages": ["DE", "hi-IN", "de_AT", "sv", "Swedish!", 3]
        }));
        assert_eq!(config.languages, ["de", "hi", "sv"]);
        assert_eq!(dropped.len(), 2, "{dropped:?}");
    }

    #[test]
    fn a_list_without_a_language_code_never_opens_the_voice() {
        let (config, dropped) = shaped(serde_json::json!({
            "languages": ["Swahili!"],
            "follow_speaker": true
        }));
        assert!(config.languages.is_empty());
        assert!(!config.follow_speaker);
        assert_eq!(dropped.len(), 2, "{dropped:?}");
    }

    #[test]
    fn a_wrong_value_keeps_the_default_and_the_rest() {
        let (config, dropped) = shaped(serde_json::json!({
            "follow_speaker": "no",
            "user_choice": false,
            "languages": "de",
            "detect": true
        }));
        assert!(config.follow_speaker);
        assert!(!config.user_choice);
        assert!(config.languages.is_empty());
        assert_eq!(dropped.len(), 3, "{dropped:?}");
    }

    #[test]
    fn language_tags() {
        assert_eq!(language_code("hi").as_deref(), Some("hi"));
        assert_eq!(language_code("pt-BR").as_deref(), Some("pt"));
        assert_eq!(language_code("fil").as_deref(), Some("fil"));
        assert_eq!(language_code("German"), None);
        assert_eq!(language_code(""), None);
    }
}
