//! `[spoken_readings.<language>]`: written forms a voice may not say well,
//! such as abbreviations, each with the one reading the voice says instead.
//! They add to or override the built-in readings of their language.

use std::collections::HashMap;

use config::Config;
use erato_memory::HeapSize;
use facet::Facet;
use serde::{Deserialize, Deserializer, Serialize};

use crate::language_words::{MAX_ENTRY_BYTES, language_tables};
use crate::spoken::{Written, shown, usable};

/// Readings one language may hold.
pub const MAX_READINGS: usize = 500;

/// One written form's reading. Written as the spoken text alone
/// (`"z. B." = "zum Beispiel"`) or as a table with `spoken` and
/// `sentence_final`.
#[derive(Debug, Default, PartialEq, Eq, Clone, Serialize, Facet, HeapSize)]
pub struct SpokenReading {
    /// What the voice says instead of the written form.
    pub spoken: String,
    /// The written form usually ends its sentence ("usw."): when a capital
    /// letter follows, its full stop is kept so the sentence still ends
    /// there.
    pub sentence_final: bool,
}

/// `[spoken_readings.<language>]`: readings by written form, by lowercase
/// language tag.
pub type SpokenReadingsByLanguage = HashMap<String, HashMap<String, SpokenReading>>;

const PLACE: &str = "spoken_readings";

fn shaped_reading(
    place: &str,
    written: Written,
    dropped: &mut Vec<String>,
) -> Option<SpokenReading> {
    let spoken_ok = |text: &str| usable(text, MAX_ENTRY_BYTES);
    match written {
        Written::Text(spoken) if spoken_ok(&spoken) => Some(SpokenReading {
            spoken: spoken.trim().to_string(),
            sentence_final: false,
        }),
        Written::Table(mut table) => {
            let spoken = match table.remove("spoken") {
                Some(Written::Text(spoken)) if spoken_ok(&spoken) => spoken.trim().to_string(),
                _ => {
                    dropped.push(format!(
                        "{place} has no usable `spoken` text and is ignored"
                    ));
                    return None;
                }
            };
            let sentence_final = match table.remove("sentence_final") {
                None => false,
                Some(Written::Flag(flag)) => flag,
                Some(_) => {
                    dropped.push(format!(
                        "{place}.sentence_final is not `true` or `false`; `false` is used"
                    ));
                    false
                }
            };
            let mut unknown: Vec<String> = table.into_keys().map(|key| shown(&key)).collect();
            unknown.sort();
            for key in unknown {
                dropped.push(format!(
                    "{place}.{key} is not a reading setting and is ignored"
                ));
            }
            Some(SpokenReading {
                spoken,
                sentence_final,
            })
        }
        _ => {
            dropped.push(format!(
                "{place} is not a usable text or a table with `spoken` and is ignored"
            ));
            None
        }
    }
}

/// The readings whose shape is right, and each part that is not.
fn shaped_spoken_readings(written: Written) -> (SpokenReadingsByLanguage, Vec<String>) {
    let mut dropped = Vec::new();
    let mut languages = SpokenReadingsByLanguage::new();
    for (language, table) in language_tables(PLACE, written, &mut dropped) {
        let place = format!("{PLACE}.{language}");
        let mut entries: Vec<(String, Written)> = table.into_iter().collect();
        entries.sort_by(|a, b| a.0.cmp(&b.0));
        let mut readings = HashMap::new();
        for (form, value) in entries {
            let entry = format!("{place}.'{}'", shown(&form));
            if !usable(&form, MAX_ENTRY_BYTES) {
                dropped.push(format!(
                    "{entry}: the written form is blank, longer than {MAX_ENTRY_BYTES} bytes or holds hidden characters and is ignored"
                ));
                continue;
            }
            if readings.len() == MAX_READINGS {
                dropped.push(format!(
                    "{place} holds more than {MAX_READINGS} readings; the rest is ignored"
                ));
                break;
            }
            if let Some(reading) = shaped_reading(&entry, value, &mut dropped) {
                readings.insert(form.trim().to_string(), reading);
            }
        }
        languages.insert(language, readings);
    }
    dropped.sort();
    (languages, dropped)
}

/// Reads `[spoken_readings]` leaving out every wrong part;
/// [`misshaped_spoken_readings`] names them.
pub fn deserialize_spoken_readings<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<SpokenReadingsByLanguage, D::Error> {
    Ok(shaped_spoken_readings(Written::deserialize(deserializer)?).0)
}

/// The parts of `[spoken_readings]` the loader leaves out, sorted.
pub fn misshaped_spoken_readings(schema: &Config) -> Vec<String> {
    schema
        .get::<Written>(PLACE)
        .map(|written| shaped_spoken_readings(written).1)
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

    fn readings(toml: &str) -> SpokenReadingsByLanguage {
        shaped_spoken_readings(schema(toml).get::<Written>(PLACE).unwrap()).0
    }

    #[test]
    fn a_reading_is_a_text_or_a_table() {
        let toml = "[spoken_readings.fr]\n\"p. ex.\" = \"par exemple\"\n\
                    \"etc.\" = { spoken = \"et cetera\", sentence_final = true }\n";
        let readings = readings(toml);
        assert_eq!(
            readings["fr"]["p. ex."],
            SpokenReading {
                spoken: "par exemple".into(),
                sentence_final: false
            }
        );
        assert_eq!(
            readings["fr"]["etc."],
            SpokenReading {
                spoken: "et cetera".into(),
                sentence_final: true
            }
        );
        assert!(misshaped_spoken_readings(&schema(toml)).is_empty());
    }

    #[test]
    fn a_bad_entry_is_dropped_without_the_rest_of_its_language() {
        let toml = "[spoken_readings]\nFR = { \"p. ex.\" = \"par exemple\" }\nit = \"no\"\n\
                    [spoken_readings.fr]\n\"p. ex.\" = \"par exemple\"\n\" \" = \"rien\"\n\
                    \"cf.\" = 3\n\"env.\" = { sentence_final = true }\n\
                    \"etc.\" = { spoken = \"et cetera\", sentence_final = \"oui\", pause = 1 }\n";
        let readings = readings(toml);
        assert_eq!(readings.keys().collect::<Vec<_>>(), ["fr"]);
        assert_eq!(readings["fr"]["p. ex."].spoken, "par exemple");
        assert_eq!(
            readings["fr"]["etc."],
            SpokenReading {
                spoken: "et cetera".into(),
                sentence_final: false
            }
        );
        assert_eq!(readings["fr"].len(), 2);
        assert_eq!(
            misshaped_spoken_readings(&schema(toml)),
            [
                "spoken_readings.fr.' ': the written form is blank, longer than 128 bytes or holds hidden characters and is ignored",
                "spoken_readings.fr.'cf.' is not a usable text or a table with `spoken` and is ignored",
                "spoken_readings.fr.'env.' has no usable `spoken` text and is ignored",
                "spoken_readings.fr.'etc.'.pause is not a reading setting and is ignored",
                "spoken_readings.fr.'etc.'.sentence_final is not `true` or `false`; `false` is used",
                "spoken_readings.it is not a table and is ignored",
                "spoken_readings: 'FR' is not a lowercase language tag such as `de` and is ignored",
            ]
        );
    }
}
