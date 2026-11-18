//! The words a person says for a server's machine names, per language, for
//! approval cards spoken in conversational audio mode. Display only: they
//! never change what a call does or whether it asks.

use std::collections::HashMap;

use config::Config;
use erato_memory::HeapSize;
use facet::Facet;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::config::has_hidden_chars;
use crate::config_facet_attrs as erato_config;

/// Entries one vocabulary holds in one language.
const MAX_VOCABULARY_ENTRIES: usize = 5_000;
/// A name or value longer than this is not something a voice says as a name.
const MAX_ENTRY_BYTES: usize = 128;
/// A spoken name longer than this is a sentence, not a name.
pub const MAX_SPOKEN_NAME_CHARS: usize = 64;

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
    /// One field's own natural sentence variants, by sentence type
    /// (`changed`, `set`, `updated`) and then by the field's exact name (or
    /// `table.field`), such as `"Der Abschluss rückt {from} {to}."`. Used
    /// when the card is read in the natural wording.
    #[serde(default)]
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    pub sentences: HashMap<String, HashMap<String, String>>,
}

/// `[spoken_vocabularies.<name>.<language>]`: named so that a content package
/// can ship the words for a kind of server without knowing a deployment's
/// server ids. A server uses them through `glossary.vocabularies`.
pub type SpokenVocabulariesConfig = HashMap<String, HashMap<String, SpokenNamesConfig>>;

const SPOKEN_NAMES_SETTINGS: &[&str] =
    &["field_names", "choice_labels", "table_names", "sentences"];

/// Sentence types with a natural variant: the slots each must hold, and
/// whether their order carries meaning (old before new).
const SENTENCE_TYPES: &[(&str, &[&str], bool)] = &[
    ("changed", &["field", "from", "to"], true),
    ("set", &["field", "value"], true),
    ("updated", &["field", "value"], true),
    ("what", &["source", "thing", "destination", "clause"], false),
];
/// Field-specific variants exist for these types only.
const FIELD_SENTENCE_TYPES: &[&str] = &["changed", "set", "updated"];
const MAX_VARIANT_CHARS: usize = 300;

/// Whether `template` may stand for the sentence `key` (`changed`, `set`,
/// `updated`, `what.<action>`): every required slot exactly once, no other
/// slot, and the precise order where order carries meaning. A variant for
/// one field may leave out `{field}`. The web app checks the same again.
pub fn usable_variant(key: &str, template: &str, for_one_field: bool) -> bool {
    let kind = key.split('.').next().unwrap_or(key);
    let Some((_, slots, ordered)) = SENTENCE_TYPES.iter().find(|(name, _, _)| *name == kind) else {
        return false;
    };
    if template.trim().is_empty()
        || template.chars().count() > MAX_VARIANT_CHARS
        || template.chars().any(char::is_control)
        || has_hidden_chars(template)
    {
        return false;
    }
    let mut found = Vec::new();
    let mut rest = template;
    while let Some(open) = rest.find('{') {
        let after = &rest[open + 1..];
        let Some(close) = after.find('}') else {
            return false;
        };
        found.push(&after[..close]);
        rest = &after[close + 1..];
    }
    if found.iter().any(|slot| !slots.contains(slot)) {
        return false;
    }
    let mut unique = found.clone();
    unique.sort_unstable();
    unique.dedup();
    if unique.len() != found.len() {
        return false;
    }
    let required = slots
        .iter()
        .filter(|slot| !(for_one_field && **slot == "field"));
    if required.clone().any(|slot| !found.contains(slot)) {
        return false;
    }
    if !ordered {
        return true;
    }
    let order: Vec<usize> = found
        .iter()
        .map(|slot| slots.iter().position(|known| known == slot).unwrap_or(0))
        .collect();
    order.windows(2).all(|pair| pair[0] < pair[1])
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
            if !FIELD_SENTENCE_TYPES.contains(&kind.as_str()) {
                dropped.push(format!("{place}.sentences: '{}' is ignored", shown(kind)));
                return false;
            }
            variants.retain(|key, template| {
                let keep = usable(key, MAX_ENTRY_BYTES) && usable_variant(kind, template, true);
                if !keep {
                    dropped.push(format!(
                        "{place}.sentences.{kind}: '{}' is ignored",
                        shown(key)
                    ));
                }
                keep
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
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    pub amount: ApprovalSpeechAmount,
    /// Details a short reading says before it holds back the rest, 0 to 3.
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    pub short_details: u8,
    /// The deployment's wording: `precise` or `natural`.
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    pub wording: ApprovalSpeechWording,
    /// Whether a user may choose their own amount and wording, unless a
    /// supervisor's audience setting says otherwise.
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    pub user_choice: bool,
    /// Per language tag, natural sentence variants by sentence type
    /// (`changed`, `set`, `updated`, `what.<action>`), replacing the built-in
    /// ones. A variant without exactly its slots is ignored with a warning.
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    pub sentences: HashMap<String, HashMap<String, String>>,
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
                let keep = usable_variant(key, template, false);
                if !keep {
                    dropped.push(format!(
                        "approval_speech.sentences.{language}: '{}' is ignored",
                        shown(key)
                    ));
                }
                keep
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
    fn a_variant_holds_exactly_its_slots_in_the_precise_order() {
        assert!(usable_variant(
            "changed",
            "{field} ändert sich {from} {to}.",
            false
        ));
        assert!(usable_variant(
            "changed",
            "Der Abschluss rückt {from} {to}.",
            true
        ));
        assert!(!usable_variant(
            "changed",
            "Der Abschluss rückt {from} {to}.",
            false
        ));
        // Old and new swapped, a slot twice or missing, an unknown slot.
        assert!(!usable_variant(
            "changed",
            "{field}: {to} statt {from}.",
            false
        ));
        assert!(!usable_variant(
            "changed",
            "{field} {from} {from} {to}",
            false
        ));
        assert!(!usable_variant("set", "{field} ist gesetzt.", false));
        assert!(!usable_variant(
            "set",
            "{field} ist {value} für {recipient}.",
            false
        ));
        assert!(!usable_variant("delete", "{field}", false));
        // The opening's parts are of different kinds and may move.
        assert!(usable_variant(
            "what.create",
            "Als Nächstes {source} {thing} {destination} anlegen{clause}",
            false
        ));
        assert!(!usable_variant(
            "what.create",
            "Als Nächstes {thing} anlegen",
            false
        ));
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
    fn a_missing_vocabulary_is_named() {
        let loaded = vocabularies("[spoken_vocabularies.dataverse.de.field_names]\na = \"b\"");
        let used = vec!["dataverse".to_string(), "sap".to_string()];
        assert_eq!(
            missing_vocabularies([("dynamics", used.as_slice())], &loaded),
            vec!["mcp_servers.dynamics.glossary.vocabularies: 'sap'".to_string()]
        );
    }
}
