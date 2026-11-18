//! How approval cards are spoken in conversational audio mode: the words a
//! person says for a server's machine names, per language, and the reading
//! style. Both are display only: they never change what a call does or
//! whether it asks.

use std::collections::HashMap;

use config::Config;
use erato_memory::HeapSize;
use eyre::{Report, eyre};
use facet::Facet;
use serde::{Deserialize, Serialize};

use crate::config::has_hidden_chars;
use crate::config_facet_attrs as erato_config;

/// Entries one vocabulary holds in one language.
const MAX_VOCABULARY_ENTRIES: usize = 5_000;
/// A name or value longer than this is not something a voice says as a name.
const MAX_ENTRY_BYTES: usize = 128;
/// A spoken name longer than this is a sentence, not a name.
pub const MAX_SPOKEN_NAME_CHARS: usize = 64;
/// Words the natural style may add, per language.
const MAX_ALLOWED_WORDS: usize = 5_000;
const MAX_ALLOWED_WORD_CHARS: usize = 40;
/// The natural style's own instruction is short; a package's may be longer.
const MAX_PROMPT_CHARS: usize = 20_000;

/// What people call one server family's fields, choice values and tables in
/// one language. Keys are the machine names exactly as the tool writes them.
#[derive(Debug, Default, Deserialize, PartialEq, Eq, Clone, Facet, HeapSize)]
pub struct SpokenNamesConfig {
    /// The spoken name of a field, keyed by the field's exact name.
    #[serde(default)]
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    pub field_names: HashMap<String, String>,
    /// What each value of a choice field is called, keyed by the field's
    /// exact name and then by the value as the tool writes it.
    #[serde(default)]
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    pub choice_labels: HashMap<String, HashMap<String, String>>,
    /// What the records of a table are called, in the plural, keyed by the
    /// table's exact name.
    #[serde(default)]
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    pub table_names: HashMap<String, String>,
}

/// `[spoken_vocabularies.<name>.<language>]`: named so that a content package
/// can ship the words for a kind of server without knowing a deployment's
/// server ids. A server uses them through `glossary.vocabularies`.
pub type SpokenVocabulariesConfig = HashMap<String, HashMap<String, SpokenNamesConfig>>;

const SPOKEN_NAMES_SETTINGS: &[&str] = &["field_names", "choice_labels", "table_names"];

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

fn usable(text: &str, max_bytes: usize) -> bool {
    !text.trim().is_empty()
        && text.len() <= max_bytes
        && !text.chars().any(char::is_control)
        && !has_hidden_chars(text)
}

fn shown(text: &str) -> String {
    text.chars().take(MAX_ENTRY_BYTES).collect()
}

impl SpokenNamesConfig {
    fn entries(&self) -> usize {
        self.field_names.len()
            + self.table_names.len()
            + self.choice_labels.values().map(HashMap::len).sum::<usize>()
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

/// How the voice reads an approval card.
#[derive(
    Debug,
    Default,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    Facet,
    HeapSize,
    utoipa::ToSchema,
)]
#[serde(rename_all = "snake_case")]
#[repr(u8)]
pub enum ApprovalSpeechStyle {
    /// Built by rule from the card's data, piece by piece.
    #[default]
    Precise,
    /// The precise pieces reworded by a small model, each checked by rule
    /// against the card's facts; a piece that fails is said precisely.
    Natural,
}

impl ApprovalSpeechStyle {
    pub fn from_wire(name: &str) -> Option<Self> {
        match name {
            "precise" => Some(Self::Precise),
            "natural" => Some(Self::Natural),
            _ => None,
        }
    }

    pub fn wire_name(self) -> &'static str {
        match self {
            Self::Precise => "precise",
            Self::Natural => "natural",
        }
    }
}

/// `[approval_speech]`: how a waiting approval card is read aloud in
/// conversational audio mode. Precise by default. The natural style needs a
/// provider; without one every card is read precisely.
#[derive(Debug, Deserialize, PartialEq, Eq, Clone, Facet, HeapSize)]
#[serde(default)]
pub struct ApprovalSpeechConfig {
    /// The organisation's style: `precise` or `natural`.
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    pub style: ApprovalSpeechStyle,
    /// Whether a user may choose the other style in their preferences.
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    pub user_choice: bool,
    /// Provider for the natural style. It receives the card's spoken pieces,
    /// which hold the call's values.
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    #[facet(erato_config::security_relevance(level = "medium"))]
    pub chat_provider_id: Option<String>,
    /// How long the card waits for the natural wording before it is read
    /// precisely, in milliseconds. Defaults to `1500`; allowed from `200` to
    /// `10000`.
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    pub model_timeout_ms: u32,
    /// Replaces the natural style's built-in instruction. Unset or blank
    /// keeps it.
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    pub prompt: Option<String>,
    /// Per language tag, words a natural wording may use that the precise
    /// piece does not have, such as verbs and articles. Any other new word
    /// makes the piece be read precisely.
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    pub words: HashMap<String, Vec<String>>,
}

pub const APPROVAL_SPEECH_TIMEOUT_MS_RANGE: std::ops::RangeInclusive<u32> = 200..=10_000;

impl Default for ApprovalSpeechConfig {
    fn default() -> Self {
        Self {
            style: ApprovalSpeechStyle::Precise,
            user_choice: true,
            chat_provider_id: None,
            model_timeout_ms: 1500,
            prompt: None,
            words: HashMap::new(),
        }
    }
}

impl ApprovalSpeechConfig {
    /// The provider id when one is set and not blank.
    pub fn provider_id(&self) -> Option<&str> {
        self.chat_provider_id
            .as_deref()
            .map(str::trim)
            .filter(|id| !id.is_empty())
    }

    /// The style a user hears: their own choice where the organisation lets
    /// them choose, else the organisation's. Natural without a provider is
    /// precise.
    pub fn style_for(&self, user_choice: Option<ApprovalSpeechStyle>) -> ApprovalSpeechStyle {
        let style = match user_choice {
            Some(choice) if self.user_choice => choice,
            _ => self.style,
        };
        if self.provider_id().is_none() {
            ApprovalSpeechStyle::Precise
        } else {
            style
        }
    }

    pub fn validate(&self) -> Result<(), Report> {
        if !APPROVAL_SPEECH_TIMEOUT_MS_RANGE.contains(&self.model_timeout_ms) {
            return Err(eyre!(
                "approval_speech.model_timeout_ms must be from {} to {} milliseconds",
                APPROVAL_SPEECH_TIMEOUT_MS_RANGE.start(),
                APPROVAL_SPEECH_TIMEOUT_MS_RANGE.end()
            ));
        }
        if self
            .prompt
            .as_deref()
            .is_some_and(|prompt| prompt.chars().count() > MAX_PROMPT_CHARS)
        {
            return Err(eyre!(
                "approval_speech.prompt must be at most {MAX_PROMPT_CHARS} characters"
            ));
        }
        for (language, words) in &self.words {
            if !is_language_tag(language) {
                return Err(eyre!(
                    "approval_speech.words: '{}' is not a lowercase language tag such as `de` or `en`",
                    shown(language)
                ));
            }
            if words.len() > MAX_ALLOWED_WORDS {
                return Err(eyre!(
                    "approval_speech.words.{language} holds {} words, more than the {MAX_ALLOWED_WORDS} allowed",
                    words.len()
                ));
            }
            if let Some(word) = words.iter().find(|word| {
                !usable(word, MAX_ENTRY_BYTES)
                    || word.chars().count() > MAX_ALLOWED_WORD_CHARS
                    || word.chars().any(char::is_whitespace)
            }) {
                return Err(eyre!(
                    "approval_speech.words.{language}: '{}' must be one word of at most {MAX_ALLOWED_WORD_CHARS} characters without hidden characters",
                    shown(word)
                ));
            }
        }
        Ok(())
    }
}

const APPROVAL_SPEECH_SETTINGS: &[&str] = &[
    "style",
    "user_choice",
    "chat_provider_id",
    "model_timeout_ms",
    "prompt",
    "words",
];

/// Keys under `[approval_speech]` and `[spoken_vocabularies]` this backend
/// does not know, sorted. A content package may be newer than the backend.
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
            #[serde(default)]
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
            [approval_speech]
            style = "natural"
            tone = "warm"
            [spoken_vocabularies.dataverse.de]
            verbs = { a = "b" }
            [spoken_vocabularies.dataverse.de.field_names]
            a = "b"
        "#;
        assert_eq!(
            unknown_spoken_keys(&schema(toml)),
            vec![
                "approval_speech.tone".to_string(),
                "spoken_vocabularies.dataverse.de.verbs".to_string()
            ]
        );
        assert!(
            vocabularies(toml)["dataverse"]["de"]
                .field_names
                .contains_key("a")
        );
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

    #[test]
    fn the_style_a_user_hears() {
        let mut config = ApprovalSpeechConfig {
            chat_provider_id: Some("small".into()),
            ..ApprovalSpeechConfig::default()
        };
        assert_eq!(config.style_for(None), ApprovalSpeechStyle::Precise);
        assert_eq!(
            config.style_for(Some(ApprovalSpeechStyle::Natural)),
            ApprovalSpeechStyle::Natural
        );
        config.user_choice = false;
        assert_eq!(
            config.style_for(Some(ApprovalSpeechStyle::Natural)),
            ApprovalSpeechStyle::Precise
        );
        config.style = ApprovalSpeechStyle::Natural;
        assert_eq!(config.style_for(None), ApprovalSpeechStyle::Natural);
        config.chat_provider_id = Some("  ".into());
        assert_eq!(config.style_for(None), ApprovalSpeechStyle::Precise);
    }

    #[test]
    fn approval_speech_settings_are_checked() {
        let base = ApprovalSpeechConfig::default();
        base.validate().unwrap();
        for bad in [
            ApprovalSpeechConfig {
                model_timeout_ms: 50,
                ..base.clone()
            },
            ApprovalSpeechConfig {
                words: HashMap::from([("de".into(), vec!["zwei Wörter".into()])]),
                ..base.clone()
            },
            ApprovalSpeechConfig {
                words: HashMap::from([("Deutsch".into(), vec!["ich".into()])]),
                ..base.clone()
            },
        ] {
            assert!(bad.validate().is_err());
        }
    }
}
