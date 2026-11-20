//! `[approval_speech.words.<language>]`: the words a spoken approval card
//! says as code rather than catalog text (number words, ordinals, times,
//! the direction of a value) and the words it reads the user's own words
//! with (instruction words before a dictation, fillers when telling what a
//! change request named). German and English are built in; a language
//! package adds a language or changes a built-in one.

use std::collections::{BTreeMap, HashMap};

use config::Config;
use erato_memory::HeapSize;
use facet::Facet;
use serde::{Deserialize, Deserializer, Serialize};

use crate::language_words::{
    MAX_ENTRY_BYTES, WordLists, language_tables, merge_word_list, named_word_lists, word_list,
};
use crate::spoken::{Written, shown, usable};

/// Number words said for 0 to 12.
pub const MAX_NUMBER_WORDS: usize = 13;
/// Ordinals said for the first to the tenth.
pub const MAX_ORDINALS: usize = 10;
const MAX_LOCALE_BYTES: usize = 35;

macro_rules! removable_lists {
    ($( $(#[doc = $doc:literal])+ $name:ident, )+) => {
        /// Words a language takes out of the built-in lists, by list.
        #[derive(Debug, Default, PartialEq, Eq, Clone, Facet, HeapSize)]
        pub struct ApprovalSpeechWordRemovals {
            $( $(#[doc = $doc])+ pub $name: Vec<String>, )+
        }

        impl WordLists for ApprovalSpeechWordRemovals {
            const NAMES: &'static [&'static str] = &[$(stringify!($name)),+];

            fn list(&self, name: &str) -> Option<&Vec<String>> {
                match name {
                    $( stringify!($name) => Some(&self.$name), )+
                    _ => None,
                }
            }

            fn list_mut(&mut self, name: &str) -> Option<&mut Vec<String>> {
                match name {
                    $( stringify!($name) => Some(&mut self.$name), )+
                    _ => None,
                }
            }
        }
    };
}

removable_lists! {
    /// Verbs that say what to do with a dictated text ("schreib", "write").
    dictation_verbs,
    /// Besides the verbs, the words such an instruction may hold.
    dictation_words,
    /// Words that say nothing about a value on their own.
    difference_fillers,
}

/// One language's words for spoken approval cards, as configured.
#[derive(Debug, Default, PartialEq, Eq, Clone, Facet, HeapSize)]
pub struct ApprovalSpeechWords {
    /// The locale dates, numbers and lists are formatted in (`fr-FR`).
    /// Unset keeps the built-in one, else the language tag itself.
    pub locale: Option<String>,
    /// Whether the voice says the whole card in this language. Off, it only
    /// says that a decision waits on screen. On for German and English.
    pub full_card: Option<bool>,
    /// Number words for 0 to 12 as said, in order; larger numbers are said
    /// as digits.
    pub numbers: Vec<String>,
    /// Ordinals for the first to the tenth as said, in order.
    pub ordinals: Vec<String>,
    /// A full hour, with `{hour}` (`{hour} Uhr`). Unset uses `time`, else
    /// the locale's own format.
    pub time_full_hour: Option<String>,
    /// A time of day, with `{hour}` and `{minute}` (`{hour}:{minute} Uhr`);
    /// the minute is said with two digits. Unset uses the locale's own
    /// format.
    pub time: Option<String>,
    /// An old value in a sentence variant, with `{value}` (`from {value}`),
    /// for a language whose value carries no direction of its own.
    pub from: Option<String>,
    /// A new value in a sentence variant, with `{value}` (`to {value}`).
    pub to: Option<String>,
    /// Verbs that say what to do with a dictated text ("schreib", "write").
    pub dictation_verbs: Vec<String>,
    /// Besides the verbs, the words an instruction before a dictated text
    /// may hold ("bitte", "dem", "Kunden").
    pub dictation_words: Vec<String>,
    /// Words that say nothing about a value on their own, when telling what
    /// a change request named ("und", "bitte", "instead").
    pub difference_fillers: Vec<String>,
    /// Words taken out of the built-in lists, by list.
    pub remove: ApprovalSpeechWordRemovals,
}

/// `[approval_speech.words.<language>]`, by lowercase language tag.
pub type ApprovalSpeechWordsByLanguage = HashMap<String, ApprovalSpeechWords>;

/// One language's words as the web app uses them: the built-in ones with
/// the configured ones merged in.
#[derive(Debug, Default, PartialEq, Eq, Clone, Serialize, Deserialize)]
pub struct SpokenCardLanguage {
    pub locale: String,
    pub full_card: bool,
    pub numbers: Vec<String>,
    pub ordinals: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_full_hour: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
    pub dictation_verbs: Vec<String>,
    pub dictation_words: Vec<String>,
    pub difference_fillers: Vec<String>,
}

fn texts(words: &[&str]) -> Vec<String> {
    words.iter().map(|word| (*word).to_string()).collect()
}

/// The built-in German and English words, which the web app also ships as
/// `frontend/src/lib/generated/languageBase.json` (`gen-language-base`).
pub fn base_spoken_card_languages() -> BTreeMap<String, SpokenCardLanguage> {
    let german = SpokenCardLanguage {
        locale: "de-DE".into(),
        full_card: true,
        numbers: texts(&[
            "null", "eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun",
            "zehn", "elf", "zwölf",
        ]),
        ordinals: texts(&[
            "erste", "zweite", "dritte", "vierte", "fünfte", "sechste", "siebte", "achte",
            "neunte", "zehnte",
        ]),
        // Said as people say it: "10 Uhr", "10:30 Uhr".
        time_full_hour: Some("{hour} Uhr".into()),
        time: Some("{hour}:{minute} Uhr".into()),
        // A German value carries its direction already ("vom 1. Dezember").
        from: None,
        to: None,
        dictation_verbs: texts(&[
            "schreib",
            "schreibe",
            "notier",
            "notiere",
            "antworte",
            "schick",
            "schicke",
            "sende",
            "formulier",
            "formuliere",
            "verfass",
            "verfasse",
            "erstell",
            "erstelle",
        ]),
        dictation_words: texts(&[
            "nein",
            "ja",
            "okay",
            "ok",
            "also",
            "bitte",
            "dann",
            "jetzt",
            "und",
            "mal",
            "kurz",
            "noch",
            "dazu",
            "zurück",
            "an",
            "dem",
            "den",
            "der",
            "die",
            "das",
            "ein",
            "eine",
            "einen",
            "ihm",
            "ihr",
            "ihnen",
            "kunden",
            "kundin",
            "team",
            "mail",
            "e-mail",
            "nachricht",
            "antwort",
            "notiz",
            "text",
            "folgendes",
            "folgende",
            "folgenden",
        ]),
        difference_fillers: texts(&[
            "und",
            "oder",
            "der",
            "die",
            "das",
            "den",
            "dem",
            "des",
            "ein",
            "eine",
            "einen",
            "mit",
            "für",
            "von",
            "auf",
            "nicht",
            // Words that frame a change rather than name what changes.
            "bitte",
            "doch",
            "lieber",
            "statt",
            "stattdessen",
            "nimm",
            "nehmen",
            "mach",
            "mache",
            "machen",
            "setz",
            "setze",
            "setzen",
            "ändere",
            "ändern",
            "noch",
            "eben",
            "jetzt",
            "lass",
            "aber",
            "auch",
        ]),
    };
    let english = SpokenCardLanguage {
        locale: "en-GB".into(),
        full_card: true,
        numbers: texts(&[
            "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
            "eleven", "twelve",
        ]),
        ordinals: texts(&[
            "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth",
            "tenth",
        ]),
        time_full_hour: None,
        time: None,
        from: Some("from {value}".into()),
        to: Some("to {value}".into()),
        // Not "reply", "answer", "draft" or "note": alone before a colon
        // they are labels that may be part of the dictation.
        dictation_verbs: texts(&["write", "send", "compose"]),
        dictation_words: texts(&[
            "no",
            "yes",
            "okay",
            "ok",
            "so",
            "and",
            "then",
            "now",
            "please",
            "back",
            "to",
            "the",
            "a",
            "an",
            "them",
            "him",
            "her",
            "customer",
            "client",
            "team",
            "email",
            "e-mail",
            "mail",
            "message",
            "note",
            "reply",
            "text",
            "following",
            "this",
        ]),
        difference_fillers: texts(&[
            "the", "and", "for", "with", "from", "not", "please", "instead", "rather", "make",
            "take", "change", "just", "also", "then", "now",
        ]),
    };
    BTreeMap::from([("de".to_string(), german), ("en".to_string(), english)])
}

fn lower(words: &[String]) -> Vec<String> {
    words.iter().map(|word| word.to_lowercase()).collect()
}

fn merged_list(base: &[String], added: &[String], removed: &[String]) -> Vec<String> {
    let added = lower(added);
    let removed = lower(removed);
    let removed: Vec<&str> = removed.iter().map(String::as_str).collect();
    merge_word_list(
        base.iter().map(String::as_str),
        added.iter().map(String::as_str),
        &removed,
    )
}

/// The built-in words with the configured ones merged in, for every
/// language that has either. A configured value replaces the built-in one;
/// a configured list adds to the built-in one, without its `remove` words.
pub fn spoken_card_languages(
    configured: &ApprovalSpeechWordsByLanguage,
) -> BTreeMap<String, SpokenCardLanguage> {
    let mut languages = base_spoken_card_languages();
    for (language, words) in configured {
        let base = languages
            .remove(language)
            .unwrap_or_else(|| SpokenCardLanguage {
                locale: language.clone(),
                ..Default::default()
            });
        let replaced = |configured: &[String], base: Vec<String>| {
            if configured.is_empty() {
                base
            } else {
                configured.to_vec()
            }
        };
        let merged = SpokenCardLanguage {
            locale: words.locale.clone().unwrap_or(base.locale),
            full_card: words.full_card.unwrap_or(base.full_card),
            numbers: replaced(&words.numbers, base.numbers),
            ordinals: replaced(&words.ordinals, base.ordinals),
            time_full_hour: words.time_full_hour.clone().or(base.time_full_hour),
            time: words.time.clone().or(base.time),
            from: words.from.clone().or(base.from),
            to: words.to.clone().or(base.to),
            dictation_verbs: merged_list(
                &base.dictation_verbs,
                &words.dictation_verbs,
                &words.remove.dictation_verbs,
            ),
            dictation_words: merged_list(
                &base.dictation_words,
                &words.dictation_words,
                &words.remove.dictation_words,
            ),
            difference_fillers: merged_list(
                &base.difference_fillers,
                &words.difference_fillers,
                &words.remove.difference_fillers,
            ),
        };
        languages.insert(language.clone(), merged);
    }
    languages
}

const PLACE: &str = "approval_speech.words";

/// A locale `Intl` accepts: `fr`, `fr-FR`, `zh-Hant-TW`.
fn is_locale(text: &str) -> bool {
    let mut parts = text.split('-');
    let primary = parts.next().unwrap_or_default();
    text.len() <= MAX_LOCALE_BYTES
        && (2..=3).contains(&primary.len())
        && primary.chars().all(|c| c.is_ascii_alphabetic())
        && parts.all(|part| {
            (1..=8).contains(&part.len()) && part.chars().all(|c| c.is_ascii_alphanumeric())
        })
}

/// The `{…}` slots of a template, or `None` when a brace is unmatched.
fn slots(template: &str) -> Option<Vec<&str>> {
    let mut slots = Vec::new();
    let mut rest = template;
    while let Some(open) = rest.find(['{', '}']) {
        if rest[open..].starts_with('}') {
            return None;
        }
        let close = rest[open..].find('}')? + open;
        let slot = &rest[open + 1..close];
        if slot.contains('{') {
            return None;
        }
        slots.push(slot);
        rest = &rest[close + 1..];
    }
    Some(slots)
}

fn template(
    place: &str,
    written: Written,
    wanted: &[&str],
    dropped: &mut Vec<String>,
) -> Option<String> {
    let needs = wanted
        .iter()
        .map(|slot| format!("{{{slot}}}"))
        .collect::<Vec<_>>()
        .join(" and ");
    match written {
        Written::Text(text)
            if usable(&text, MAX_ENTRY_BYTES)
                && slots(&text).is_some_and(|found| {
                    found.iter().all(|slot| wanted.contains(slot))
                        && wanted.iter().all(|slot| found.contains(slot))
                }) =>
        {
            Some(text.trim().to_string())
        }
        _ => {
            dropped.push(format!(
                "{place} is not a text with exactly the slots {needs}; it is ignored"
            ));
            None
        }
    }
}

/// A list whose entries count by their place: one wrong entry would move
/// every later one, so the whole list is dropped.
fn ordered_list(
    place: &str,
    written: Written,
    max: usize,
    dropped: &mut Vec<String>,
) -> Vec<String> {
    let mut wrong = Vec::new();
    let words = word_list(place, written, &mut wrong);
    if !wrong.is_empty() {
        dropped.extend(wrong);
        dropped.push(format!(
            "{place} is ignored: its entries count by their place"
        ));
        return Vec::new();
    }
    if words.len() > max {
        dropped.push(format!(
            "{place} holds more than {max} entries; it is ignored"
        ));
        return Vec::new();
    }
    words
}

fn shaped_language(
    place: &str,
    table: HashMap<String, Written>,
    dropped: &mut Vec<String>,
) -> ApprovalSpeechWords {
    let mut words = ApprovalSpeechWords::default();
    let mut entries: Vec<(String, Written)> = table.into_iter().collect();
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    for (key, value) in entries {
        let place = format!("{place}.{}", shown(&key));
        match key.as_str() {
            "locale" => match value {
                Written::Text(text) if is_locale(text.trim()) => {
                    words.locale = Some(text.trim().to_string());
                }
                _ => dropped.push(format!(
                    "{place} is not a locale such as `fr-FR`; it is ignored"
                )),
            },
            "full_card" => match value {
                Written::Flag(flag) => words.full_card = Some(flag),
                _ => dropped.push(format!("{place} is not `true` or `false`; it is ignored")),
            },
            "numbers" => words.numbers = ordered_list(&place, value, MAX_NUMBER_WORDS, dropped),
            "ordinals" => words.ordinals = ordered_list(&place, value, MAX_ORDINALS, dropped),
            "time_full_hour" => words.time_full_hour = template(&place, value, &["hour"], dropped),
            "time" => words.time = template(&place, value, &["hour", "minute"], dropped),
            "from" => words.from = template(&place, value, &["value"], dropped),
            "to" => words.to = template(&place, value, &["value"], dropped),
            "remove" => match value {
                Written::Table(table) => {
                    words.remove = named_word_lists(&place, table, &[], "", dropped);
                }
                _ => dropped.push(format!("{place} is not a table and is ignored")),
            },
            name => match words_list_mut(&mut words, name) {
                Some(list) => *list = word_list(&place, value, dropped),
                None => dropped.push(format!("{place} is not a known setting; it is ignored")),
            },
        }
    }
    words
}

fn words_list_mut<'a>(
    words: &'a mut ApprovalSpeechWords,
    name: &str,
) -> Option<&'a mut Vec<String>> {
    match name {
        "dictation_verbs" => Some(&mut words.dictation_verbs),
        "dictation_words" => Some(&mut words.dictation_words),
        "difference_fillers" => Some(&mut words.difference_fillers),
        _ => None,
    }
}

/// `[approval_speech.words]` as written, with each wrong part dropped and
/// named; each setting of a language is checked on its own.
pub(crate) fn shaped_approval_speech_words(
    written: Written,
    dropped: &mut Vec<String>,
) -> ApprovalSpeechWordsByLanguage {
    language_tables(PLACE, written, dropped)
        .into_iter()
        .map(|(language, table)| {
            let place = format!("{PLACE}.{language}");
            let words = shaped_language(&place, table, dropped);
            (language, words)
        })
        .collect()
}

/// Reads `[approval_speech.words]` leaving out every wrong part.
pub fn deserialize_approval_speech_words<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<ApprovalSpeechWordsByLanguage, D::Error> {
    Ok(shaped_approval_speech_words(
        Written::deserialize(deserializer)?,
        &mut Vec::new(),
    ))
}

/// The parts of `[approval_speech.words]` the loader leaves out, sorted.
pub fn misshaped_approval_speech_words(schema: &Config) -> Vec<String> {
    let mut dropped = Vec::new();
    if let Ok(written) = schema.get::<Written>(PLACE) {
        shaped_approval_speech_words(written, &mut dropped);
    }
    dropped.sort();
    dropped
}

/// What the web app ships of the built-in language data, for when no
/// environment is injected (development server, tests).
#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LanguageBase {
    pub approval_speech_words: BTreeMap<String, SpokenCardLanguage>,
}

pub fn language_base() -> LanguageBase {
    LanguageBase {
        approval_speech_words: base_spoken_card_languages(),
    }
}

/// [`language_base`] as the web app's JSON file holds it.
pub fn language_base_json() -> String {
    let mut json =
        serde_json::to_string_pretty(&language_base()).expect("the language base serializes");
    json.push('\n');
    json
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

    fn words(toml: &str) -> ApprovalSpeechWordsByLanguage {
        shaped_approval_speech_words(schema(toml).get::<Written>(PLACE).unwrap(), &mut Vec::new())
    }

    const FRENCH: &str = "[approval_speech.words.fr]\nlocale = \"fr-FR\"\nfull_card = true\n\
        numbers = [\"zéro\", \"un\", \"deux\", \"trois\", \"quatre\", \"cinq\", \"six\", \"sept\", \"huit\", \"neuf\", \"dix\", \"onze\", \"douze\"]\n\
        ordinals = [\"premier\", \"deuxième\"]\n\
        time_full_hour = \"{hour} heures\"\ntime = \"{hour} h {minute}\"\n\
        dictation_verbs = [\"écris\", \"Envoie\"]\ndictation_words = [\"au\", \"client\"]\n\
        difference_fillers = [\"et\", \"plutôt\"]\n";

    #[test]
    fn a_language_package_adds_a_language() {
        let configured = words(FRENCH);
        assert!(misshaped_approval_speech_words(&schema(FRENCH)).is_empty());
        let languages = spoken_card_languages(&configured);
        let french = &languages["fr"];
        assert_eq!(french.locale, "fr-FR");
        assert!(french.full_card);
        assert_eq!(french.numbers[12], "douze");
        assert_eq!(french.ordinals, ["premier", "deuxième"]);
        assert_eq!(french.time.as_deref(), Some("{hour} h {minute}"));
        assert_eq!(french.from, None);
        assert_eq!(french.dictation_verbs, ["écris", "envoie"]);
        assert_eq!(languages["de"], base_spoken_card_languages()["de"]);
    }

    #[test]
    fn a_language_without_settings_says_only_the_pointer() {
        let languages = spoken_card_languages(&words(
            "[approval_speech.words.it]\ndifference_fillers = [\"e\"]\n",
        ));
        let italian = &languages["it"];
        assert!(!italian.full_card);
        assert_eq!(italian.locale, "it");
        assert!(italian.numbers.is_empty());
    }

    #[test]
    fn a_built_in_language_merges_by_kind() {
        let languages = spoken_card_languages(&words(
            "[approval_speech.words.en]\nnumbers = [\"nought\"]\nfrom = \"since {value}\"\n\
             dictation_verbs = [\"draft\"]\n\
             [approval_speech.words.en.remove]\ndictation_verbs = [\"Send\"]\n",
        ));
        let english = &languages["en"];
        let base = &base_spoken_card_languages()["en"];
        assert_eq!(english.numbers, ["nought"]);
        assert_eq!(english.ordinals, base.ordinals);
        assert_eq!(english.from.as_deref(), Some("since {value}"));
        assert_eq!(english.to, base.to);
        assert_eq!(english.dictation_verbs, ["write", "compose", "draft"]);
        assert_eq!(english.locale, "en-GB");
        assert!(english.full_card);
    }

    #[test]
    fn a_bad_entry_is_dropped_without_the_rest_of_its_language() {
        let toml = "[approval_speech.words]\nIT = { full_card = true }\n\
                    [approval_speech.words.fr]\nlocale = \"fr FR\"\nfull_card = \"yes\"\n\
                    numbers = [\"zéro\", 1, \"deux\"]\nordinals = [\"premier\"]\n\
                    time = \"{hour} h\"\nfrom = \"de {valeur}\"\nto = \"à {value}\"\n\
                    dictation_verbs = [\"écris\", \" \"]\nshout = true\nremove = 2\n";
        let configured = words(toml);
        let french = &configured["fr"];
        assert_eq!(configured.len(), 1);
        assert_eq!(french.locale, None);
        assert_eq!(french.full_card, None);
        assert!(french.numbers.is_empty());
        assert_eq!(french.ordinals, ["premier"]);
        assert_eq!(french.time, None);
        assert_eq!(french.from, None);
        assert_eq!(french.to.as_deref(), Some("à {value}"));
        assert_eq!(french.dictation_verbs, ["écris"]);
        assert_eq!(
            misshaped_approval_speech_words(&schema(toml)),
            [
                "approval_speech.words.fr.dictation_verbs: ' ' is blank, longer than 128 bytes or holds hidden characters and is ignored",
                "approval_speech.words.fr.from is not a text with exactly the slots {value}; it is ignored",
                "approval_speech.words.fr.full_card is not `true` or `false`; it is ignored",
                "approval_speech.words.fr.locale is not a locale such as `fr-FR`; it is ignored",
                "approval_speech.words.fr.numbers is ignored: its entries count by their place",
                "approval_speech.words.fr.numbers: an entry is not a text and is ignored",
                "approval_speech.words.fr.remove is not a table and is ignored",
                "approval_speech.words.fr.shout is not a known setting; it is ignored",
                "approval_speech.words.fr.time is not a text with exactly the slots {hour} and {minute}; it is ignored",
                "approval_speech.words: 'IT' is not a lowercase language tag such as `de` and is ignored",
            ]
        );
    }

    #[test]
    fn the_section_loads_its_words_beside_its_settings() {
        let toml = "[approval_speech]\nwording = \"natural\"\n\
                    [approval_speech.words.fr]\nfull_card = true\nshout = 1\n";
        let config = crate::spoken::deserialize_approval_speech(
            schema(toml)
                .get::<serde_json::Value>("approval_speech")
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            config.wording,
            crate::spoken::ApprovalSpeechWording::Natural
        );
        assert_eq!(config.words["fr"].full_card, Some(true));
        assert_eq!(
            crate::spoken::misshaped_approval_speech(&schema(toml)),
            ["approval_speech.words.fr.shout is not a known setting; it is ignored"]
        );
        assert!(crate::spoken::unknown_spoken_keys(&schema(toml)).is_empty());
    }

    #[test]
    fn templates_need_exactly_their_slots() {
        for (text, ok) in [
            ("{hour}:{minute} Uhr", true),
            ("{minute} past {hour}", true),
            ("{hour} Uhr", false),
            ("{hour}:{minute}:{second}", false),
            ("{hour}:{minute", false),
            ("hour}:{minute}", false),
        ] {
            let found = template(
                "t",
                Written::Text(text.into()),
                &["hour", "minute"],
                &mut Vec::new(),
            );
            assert_eq!(found.is_some(), ok, "{text}");
        }
    }

    #[test]
    fn the_web_app_ships_the_same_base() {
        let shipped: LanguageBase = serde_json::from_str(include_str!(
            "../../../frontend/src/lib/generated/languageBase.json"
        ))
        .unwrap();
        assert_eq!(
            shipped,
            language_base(),
            "run `just generate_language_base` in backend/"
        );
    }
}
