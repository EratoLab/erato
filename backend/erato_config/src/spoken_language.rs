//! `[audio_conversational.spoken_language]`: which language the voice speaks
//! in conversational audio mode. The voice follows the language the user
//! speaks, chosen among the user's languages and the ones allowed here. The
//! interface language is a separate setting.

use erato_memory::HeapSize;
use facet::Facet;
use serde::{Deserialize, Deserializer};

use crate::config_facet_attrs as erato_config;
use crate::spoken::{Written, written_table};
use config::Config;

const PLACE: &str = "audio_conversational.spoken_language";

/// How many languages a user may list as the languages they speak.
pub const MAX_USER_SPOKEN_LANGUAGES: usize = 3;

/// The languages the word check can tell apart, as ISO 639-1 codes. A spoken
/// language outside this list cannot be confirmed from the words, so it is
/// not offered.
pub const SPEAKABLE_LANGUAGES: &[&str] = &[
    "af", "ar", "az", "be", "bg", "bn", "bs", "ca", "cs", "cy", "da", "de", "el", "en", "eo", "es",
    "et", "eu", "fa", "fi", "fr", "ga", "gu", "he", "hi", "hr", "hu", "hy", "id", "is", "it", "ja",
    "ka", "kk", "ko", "la", "lg", "lt", "lv", "mi", "mk", "mn", "mr", "ms", "nb", "nl", "nn", "pa",
    "pl", "pt", "ro", "ru", "sk", "sl", "sn", "so", "sq", "sr", "st", "sv", "sw", "ta", "te", "th",
    "tl", "tn", "tr", "ts", "uk", "ur", "vi", "xh", "yo", "zh", "zu",
];

/// The speakable language a tag names (`hi`, `hi-IN`, `de_DE` → `de`), or
/// `None` for a tag whose language the word check does not know.
pub fn speakable_language(tag: &str) -> Option<&'static str> {
    let primary = tag.trim().split(['-', '_']).next()?.to_ascii_lowercase();
    SPEAKABLE_LANGUAGES
        .iter()
        .find(|code| **code == primary)
        .copied()
}

/// `tags` as speakable languages in their order, without repeats; the tags
/// that are not speakable are returned apart.
pub fn speakable_languages<'a>(
    tags: impl IntoIterator<Item = &'a str>,
) -> (Vec<String>, Vec<&'a str>) {
    let mut languages: Vec<String> = Vec::new();
    let mut unknown = Vec::new();
    for tag in tags {
        match speakable_language(tag) {
            Some(code) if !languages.iter().any(|known| known == code) => {
                languages.push(code.to_string());
            }
            Some(_) => {}
            None => unknown.push(tag),
        }
    }
    (languages, unknown)
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
    /// this list. Codes the word check does not know are dropped with a
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
            ("languages", Written::List(entries)) => {
                let mut tags = Vec::new();
                for entry in entries {
                    match entry {
                        Written::Text(tag) => tags.push(tag),
                        _ => {
                            dropped.push(format!("{PLACE}.languages has an entry that is not text"))
                        }
                    }
                }
                let (languages, unknown) = speakable_languages(tags.iter().map(String::as_str));
                for tag in unknown {
                    dropped.push(format!(
                        "{PLACE}.languages has `{tag}`, a language the word check does not know"
                    ));
                }
                config.languages = languages;
            }
            ("languages", _) => dropped.push(format!(
                "{PLACE}.languages is not a list of language codes; any language is allowed"
            )),
            (other, _) => dropped.push(format!("{PLACE}.{other} is not known and is ignored")),
        }
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
    fn languages_are_normalized_and_unknown_ones_dropped() {
        let (config, dropped) = shaped(serde_json::json!({
            "languages": ["DE", "hi-IN", "de_AT", "klingon", 3]
        }));
        assert_eq!(config.languages, ["de", "hi"]);
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
    fn speakable_tags() {
        assert_eq!(speakable_language("hi"), Some("hi"));
        assert_eq!(speakable_language("pt-BR"), Some("pt"));
        assert_eq!(speakable_language("xx"), None);
        assert_eq!(speakable_language(""), None);
        assert_eq!(SPEAKABLE_LANGUAGES.len(), 75);
    }
}
