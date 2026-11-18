//! What people call a call's machine names, from the server's spoken
//! vocabularies, for the voice only. Looked up by the name as the tool wrote
//! it and keyed by the name as the label carries it, so the client finds the
//! entry without knowing the raw name.

use std::collections::BTreeMap;

use erato_config::config::{McpRuntimeConfig, SpokenNamesConfig};

use crate::models::message::{ToolCallChange, ToolCallSpokenNames};

/// Entries one label carries per language; a call that touches more names
/// speaks the rest as the card shows them.
const MAX_SPOKEN_ENTRIES: usize = 64;

/// The vocabularies one server uses, in the order its glossary names them.
pub struct SpokenVocabulary<'a> {
    /// Per language, the vocabularies that have it, first one first.
    languages: BTreeMap<&'a str, Vec<&'a SpokenNamesConfig>>,
}

impl<'a> SpokenVocabulary<'a> {
    /// `None` when the server names no vocabulary that exists.
    pub fn for_server(config: &'a McpRuntimeConfig, server_id: &str) -> Option<Self> {
        let server = config.mcp_servers.get(server_id)?;
        let mut languages: BTreeMap<&str, Vec<&SpokenNamesConfig>> = BTreeMap::new();
        for name in &server.glossary.vocabularies {
            let Some(vocabulary) = config.spoken_vocabularies.get(name) else {
                continue;
            };
            for (language, names) in vocabulary {
                languages.entry(language.as_str()).or_default().push(names);
            }
        }
        (!languages.is_empty()).then_some(Self { languages })
    }

    /// A collector for one call; `table` is the table the call acts on,
    /// where its label names one, for entries scoped as `table.name`.
    pub fn collector(&self, table: Option<&str>) -> SpokenNamesCollector<'_, 'a> {
        SpokenNamesCollector {
            vocabulary: self,
            table: table.map(str::to_string),
            names: BTreeMap::new(),
        }
    }
}

/// The first non-blank entry any layer has for `key` scoped to `table`, else
/// for `key` alone: an entry for one table wins over one for every table.
fn first<'a>(
    layers: &[&'a SpokenNamesConfig],
    table: Option<&str>,
    key: &str,
    get: impl Fn(&'a SpokenNamesConfig, &str) -> Option<&'a String>,
) -> Option<&'a str> {
    let in_layers = |key: &str| {
        layers.iter().find_map(|layer| {
            get(layer, key)
                .map(|name| name.trim())
                .filter(|name| !name.is_empty())
        })
    };
    table
        .and_then(|table| in_layers(&format!("{table}.{key}")))
        .or_else(|| in_layers(key))
}

/// Gathers the entries for the names one label carries.
pub struct SpokenNamesCollector<'v, 'a> {
    vocabulary: &'v SpokenVocabulary<'a>,
    table: Option<String>,
    names: BTreeMap<String, ToolCallSpokenNames>,
}

impl SpokenNamesCollector<'_, '_> {
    fn add(
        &mut self,
        lookup: impl Fn(&[&SpokenNamesConfig]) -> Option<String>,
        put: impl Fn(&mut ToolCallSpokenNames, String),
    ) {
        for (language, layers) in &self.vocabulary.languages {
            let Some(spoken) = lookup(layers) else {
                continue;
            };
            let entry = self.names.entry((*language).to_string()).or_default();
            if entries(entry) < MAX_SPOKEN_ENTRIES {
                put(entry, spoken);
            }
        }
    }

    /// A field the label names `shown`, which the tool writes `raw`.
    pub fn field(&mut self, shown: &str, raw: &str) {
        if shown.is_empty() {
            return;
        }
        let table = self.table.clone();
        self.add(
            |layers| {
                first(layers, table.as_deref(), raw, |names, key| {
                    names.field_names.get(key)
                })
                .map(str::to_string)
            },
            |entry, spoken| {
                entry.fields.insert(shown.to_string(), spoken);
            },
        );
    }

    /// A coded value of a field, each as the label carries it and as the tool
    /// writes it.
    pub fn choice(&mut self, shown_field: &str, raw_field: &str, shown: &str, raw: &str) {
        if shown_field.is_empty() || shown.is_empty() {
            return;
        }
        let table = self.table.clone();
        self.add(
            |layers| {
                first(layers, table.as_deref(), raw_field, |names, key| {
                    names.choice_labels.get(key)?.get(raw)
                })
                .map(str::to_string)
            },
            |entry, spoken| {
                entry
                    .choices
                    .entry(shown_field.to_string())
                    .or_default()
                    .insert(shown.to_string(), spoken);
            },
        );
    }

    pub fn table(&mut self, shown: &str, raw: &str) {
        if shown.is_empty() {
            return;
        }
        self.add(
            |layers| {
                first(layers, None, raw, |names, key| names.table_names.get(key))
                    .map(str::to_string)
            },
            |entry, spoken| {
                entry.tables.insert(shown.to_string(), spoken);
            },
        );
    }

    /// The fields and coded values a change writes: an effect's raw name is
    /// both the key and the lookup, and a value's text is the code as written.
    pub fn change(&mut self, change: &ToolCallChange) {
        for effect in &change.effects {
            let raw = effect.raw_name.as_str();
            self.field(raw, raw);
            let values = effect
                .values
                .iter()
                .chain(&effect.old)
                .chain(&effect.removed)
                .chain(&effect.kept)
                .chain(&effect.added);
            for value in values.filter(|value| !value.machine_id) {
                self.choice(raw, raw, &value.text, &value.text);
            }
        }
        for text in &change.texts {
            self.field(&text.raw_name, &text.raw_name);
        }
    }

    /// Entries scoped to `table` from here on, as a read's condition on one
    /// of several tables.
    pub fn in_table(&mut self, table: Option<&str>) {
        self.table = table.map(str::to_string);
    }

    pub fn finish(self) -> BTreeMap<String, ToolCallSpokenNames> {
        self.names
            .into_iter()
            .filter(|(_, names)| entries(names) > 0)
            .collect()
    }

    /// Adds what another collector found, as a read built apart from the
    /// label does.
    pub fn merge(&mut self, other: BTreeMap<String, ToolCallSpokenNames>) {
        for (language, names) in other {
            let entry = self.names.entry(language).or_default();
            for (shown, spoken) in names.fields {
                if entries(entry) < MAX_SPOKEN_ENTRIES {
                    entry.fields.entry(shown).or_insert(spoken);
                }
            }
            for (shown, spoken) in names.tables {
                if entries(entry) < MAX_SPOKEN_ENTRIES {
                    entry.tables.entry(shown).or_insert(spoken);
                }
            }
            for (field, values) in names.choices {
                for (shown, spoken) in values {
                    if entries(entry) < MAX_SPOKEN_ENTRIES {
                        entry
                            .choices
                            .entry(field.clone())
                            .or_default()
                            .entry(shown)
                            .or_insert(spoken);
                    }
                }
            }
        }
    }
}

fn entries(names: &ToolCallSpokenNames) -> usize {
    names.fields.len()
        + names.tables.len()
        + names.choices.values().map(BTreeMap::len).sum::<usize>()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::message::{ToolCallEffect, ToolCallEffectKind, ToolCallEffectValue};
    use serde_json::json;

    fn config() -> McpRuntimeConfig {
        serde_json::from_value(json!({
            "mcp_servers": {
                "dynamics": {
                    "transport_type": "streamable_http",
                    "url": "http://localhost/mcp",
                    "glossary": { "vocabularies": ["customer", "dataverse", "missing"] }
                },
                "other": {
                    "transport_type": "streamable_http",
                    "url": "http://localhost/mcp"
                }
            },
            "spoken_vocabularies": {
                "dataverse": {
                    "de": {
                        "field_names": { "statecode": "Status", "scheduledend": "Fälligkeitsdatum" },
                        "choice_labels": { "statecode": { "0": "aktiv", "1": "inaktiv" } },
                        "table_names": { "opportunity": "Verkaufschancen" }
                    },
                    "en": {
                        "field_names": { "statecode": "status", "scheduledend": "due date" },
                        "choice_labels": { "statecode": { "0": "active" } }
                    }
                },
                "customer": {
                    "de": { "field_names": { "scheduledend": "Termin", "statecode": "  " } }
                }
            }
        }))
        .unwrap()
    }

    fn value(text: &str) -> ToolCallEffectValue {
        ToolCallEffectValue {
            text: text.into(),
            truncated: false,
            machine_id: false,
            meaning: None,
        }
    }

    fn effect(raw: &str, values: &[&str]) -> ToolCallEffect {
        ToolCallEffect {
            path: format!("/{raw}"),
            name: raw.into(),
            raw_name: raw.into(),
            effect: ToolCallEffectKind::Set,
            values: values.iter().map(|text| value(text)).collect(),
            omitted: 0,
            old: Some(value("1")),
            removed: vec![],
            kept: vec![],
            added: vec![],
            list: false,
            link: false,
            new_name: false,
        }
    }

    #[test]
    fn the_first_vocabulary_with_an_entry_wins_per_language() {
        let config = config();
        let vocabulary = SpokenVocabulary::for_server(&config, "dynamics").unwrap();
        let mut names = vocabulary.collector(None);
        names.change(&ToolCallChange {
            effects: vec![
                effect("statecode", &["0"]),
                effect("scheduledend", &["2030-01-15"]),
                effect("subject", &["x"]),
            ],
            ..ToolCallChange::default()
        });
        let names = names.finish();
        let de = &names["de"];
        // The customer's own word comes first; a blank one does not count.
        assert_eq!(de.fields["scheduledend"], "Termin");
        assert_eq!(de.fields["statecode"], "Status");
        assert_eq!(de.choices["statecode"]["0"], "aktiv");
        assert_eq!(de.choices["statecode"]["1"], "inaktiv");
        assert!(!de.fields.contains_key("subject"));
        let en = &names["en"];
        assert_eq!(en.fields["scheduledend"], "due date");
        assert_eq!(en.choices["statecode"].get("1"), None);
    }

    #[test]
    fn a_read_is_keyed_by_what_its_label_shows() {
        let config = config();
        let vocabulary = SpokenVocabulary::for_server(&config, "dynamics").unwrap();
        let mut names = vocabulary.collector(None);
        // The operator's glossary named the column "State" on the read.
        names.field("State", "statecode");
        names.choice("State", "statecode", "Open", "0");
        names.table("opportunity", "opportunity");
        let names = names.finish();
        assert_eq!(names["de"].fields["State"], "Status");
        assert_eq!(names["de"].choices["State"]["Open"], "aktiv");
        assert_eq!(names["de"].tables["opportunity"], "Verkaufschancen");
        assert!(names["en"].tables.is_empty());
    }

    #[test]
    fn an_entry_for_the_table_wins_over_one_for_every_table() {
        let mut config = config();
        let de = config
            .spoken_vocabularies
            .get_mut("dataverse")
            .unwrap()
            .get_mut("de")
            .unwrap();
        de.field_names
            .insert("task.scheduledend".into(), "Fälligkeitsdatum".into());
        de.field_names.insert("scheduledend".into(), "Ende".into());
        de.choice_labels.insert(
            "opportunity.statecode".into(),
            [("1".to_string(), "Gewonnen".to_string())].into(),
        );
        // The customer's vocabulary is first but has no entry for the table.
        let vocabulary = SpokenVocabulary::for_server(&config, "dynamics").unwrap();
        let mut task = vocabulary.collector(Some("task"));
        task.field("scheduledend", "scheduledend");
        assert_eq!(
            task.finish()["de"].fields["scheduledend"],
            "Fälligkeitsdatum"
        );
        let mut opportunity = vocabulary.collector(Some("opportunity"));
        opportunity.choice("statecode", "statecode", "1", "1");
        opportunity.field("scheduledend", "scheduledend");
        let names = opportunity.finish();
        assert_eq!(names["de"].choices["statecode"]["1"], "Gewonnen");
        assert_eq!(names["de"].fields["scheduledend"], "Termin");
        let mut account = vocabulary.collector(Some("account"));
        account.choice("statecode", "statecode", "1", "1");
        assert_eq!(account.finish()["de"].choices["statecode"]["1"], "inaktiv");
    }

    #[test]
    fn a_server_without_vocabularies_has_none() {
        let config = config();
        assert!(SpokenVocabulary::for_server(&config, "other").is_none());
        assert!(SpokenVocabulary::for_server(&config, "unknown").is_none());
    }

    #[test]
    fn a_language_without_entries_for_the_call_is_left_out() {
        let config = config();
        let vocabulary = SpokenVocabulary::for_server(&config, "dynamics").unwrap();
        let mut names = vocabulary.collector(None);
        names.field("subject", "subject");
        assert!(names.finish().is_empty());
    }

    #[test]
    fn entries_are_capped_per_language() {
        let mut config = config();
        let de = config
            .spoken_vocabularies
            .get_mut("dataverse")
            .unwrap()
            .get_mut("de")
            .unwrap();
        for index in 0..100 {
            de.field_names
                .insert(format!("f{index}"), format!("Feld {index}"));
        }
        let vocabulary = SpokenVocabulary::for_server(&config, "dynamics").unwrap();
        let mut names = vocabulary.collector(None);
        for index in 0..100 {
            let name = format!("f{index}");
            names.field(&name, &name);
        }
        assert_eq!(names.finish()["de"].fields.len(), MAX_SPOKEN_ENTRIES);
    }
}
