//! The words a person says for a server's machine names, per language, for
//! approval cards spoken in conversational audio mode. Display only: they
//! never change what a call does or whether it asks.

use std::collections::HashMap;

use config::Config;
use erato_memory::HeapSize;
use facet::Facet;
use serde::{Deserialize, Deserializer};

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
}

/// `[spoken_vocabularies.<name>.<language>]`: named so that a content package
/// can ship the words for a kind of server without knowing a deployment's
/// server ids. A server uses them through `glossary.vocabularies`.
pub type SpokenVocabulariesConfig = HashMap<String, HashMap<String, SpokenNamesConfig>>;

const SPOKEN_NAMES_SETTINGS: &[&str] = &["field_names", "choice_labels", "table_names"];

/// The vocabularies as written, whatever their shape, so that a text where a
/// table belongs (or the other way round) is dropped with a warning instead
/// of stopping the configuration.
#[derive(Deserialize)]
#[serde(untagged)]
enum Written {
    Text(String),
    Table(HashMap<String, Written>),
    Other(serde::de::IgnoredAny),
}

fn written_table(
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
            let mut choice_labels = HashMap::new();
            if let Some(fields) = settings.remove("choice_labels") {
                let place = format!("{place}.choice_labels");
                for (field, labels) in written_table(&place, fields, &mut dropped) {
                    let place = format!("{place}.{field}");
                    if matches!(labels, Written::Table(_)) {
                        choice_labels.insert(field, written_texts(&place, labels, &mut dropped));
                    } else {
                        dropped.push(format!("{place} is not a table and is ignored"));
                    }
                }
            }
            shaped.insert(
                language,
                SpokenNamesConfig {
                    field_names,
                    choice_labels,
                    table_names,
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

/// Keys under `[spoken_vocabularies]` this backend does not know, sorted. A
/// content package may be newer than the backend.
pub fn unknown_spoken_keys(schema: &Config) -> Vec<String> {
    let mut unknown = Vec::new();
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
        "#;
        let loaded = vocabularies(toml);
        let de = &loaded["dataverse"]["de"];
        assert_eq!(de.field_names.len(), 1);
        assert_eq!(de.field_names["ok"], "Gut");
        assert!(de.table_names.is_empty());
        assert!(!de.choice_labels.contains_key("statecode"));
        assert_eq!(de.choice_labels["prioritycode"].len(), 1);
        assert!(loaded["broken"].is_empty());
        assert_eq!(
            misshaped_spoken_entries(&schema(toml)),
            vec![
                "spoken_vocabularies.broken.de is not a table and is ignored",
                "spoken_vocabularies.dataverse.de.choice_labels.prioritycode: '2' is not a text and is ignored",
                "spoken_vocabularies.dataverse.de.choice_labels.statecode is not a table and is ignored",
                "spoken_vocabularies.dataverse.de.field_names: 'nested' is not a text and is ignored",
                "spoken_vocabularies.dataverse.de.field_names: 'number' is not a text and is ignored",
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
}
