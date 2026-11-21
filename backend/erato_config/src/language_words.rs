//! Loading rules shared by the data a language package brings for a
//! feature, kept in the feature's own section by language
//! (`<feature>.<thing>.<language>`). Loading is lenient: a wrong entry is
//! dropped with a warning and never stops the server, and every part of a
//! language is checked on its own, so one wrong part never drops the rest.

use std::collections::HashMap;

use crate::spoken::{MAX_ENTRY_BYTES, Written, is_language_tag, shown, usable, written_table};

/// Entries one list may hold in one language.
pub const MAX_LIST_ENTRIES: usize = 500;

/// Named lists of words for one language, as one table of a section holds
/// them.
pub trait WordLists: Default {
    /// Every list name such a table may hold.
    const NAMES: &'static [&'static str];
    fn list(&self, name: &str) -> Option<&Vec<String>>;
    fn list_mut(&mut self, name: &str) -> Option<&mut Vec<String>>;
}

/// A struct of named word lists and its [`WordLists`], each list named once.
/// Fields under `with` are kept as they are and are not lists.
macro_rules! word_lists {
    (
        $(#[doc = $doc:literal])*
        pub struct $name:ident {
            $( $(#[doc = $list_doc:literal])+ $list:ident, )+
        }
        $( with { $( $(#[doc = $extra_doc:literal])+ $extra:ident: $extra_ty:ty, )+ } )?
    ) => {
        $(#[doc = $doc])*
        #[derive(Debug, Default, PartialEq, Eq, Clone, ::facet::Facet, ::erato_memory::HeapSize)]
        pub struct $name {
            $( $(#[doc = $list_doc])+ pub $list: Vec<String>, )+
            $($( $(#[doc = $extra_doc])+ pub $extra: $extra_ty, )+)?
        }

        impl $crate::language_words::WordLists for $name {
            const NAMES: &'static [&'static str] = &[$(stringify!($list)),+];

            fn list(&self, name: &str) -> Option<&Vec<String>> {
                match name {
                    $( stringify!($list) => Some(&self.$list), )+
                    _ => None,
                }
            }

            fn list_mut(&mut self, name: &str) -> Option<&mut Vec<String>> {
                match name {
                    $( stringify!($list) => Some(&mut self.$list), )+
                    _ => None,
                }
            }
        }
    };
}
pub(crate) use word_lists;

/// The entries of `place` by language. A key that is not a lowercase
/// language tag (`pt-br`, not `pt-BR`) is dropped with a warning: lookups
/// compare lowercase tags.
fn language_entries(
    place: &str,
    written: Written,
    dropped: &mut Vec<String>,
) -> Vec<(String, Written)> {
    written_table(place, written, dropped)
        .into_iter()
        .filter(|(language, _)| {
            let tag = is_language_tag(language) && *language == language.to_ascii_lowercase();
            if !tag {
                dropped.push(format!(
                    "{place}: '{}' is not a lowercase language tag such as `de` and is ignored",
                    shown(language)
                ));
            }
            tag
        })
        .collect()
}

/// The word lists of `place` by language, each checked as [`word_list`]
/// checks it.
pub(crate) fn language_word_lists(
    place: &str,
    written: Written,
    dropped: &mut Vec<String>,
) -> HashMap<String, Vec<String>> {
    language_entries(place, written, dropped)
        .into_iter()
        .map(|(language, value)| {
            let words = word_list(&format!("{place}.{language}"), value, dropped);
            (language, words)
        })
        .collect()
}

const HESITATIONS_PLACE: &str = "audio_conversational.hesitations";

/// Reads `audio_conversational.hesitations` leaving out every wrong part;
/// [`misshaped_hesitations`] names them.
pub fn deserialize_hesitations<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<HashMap<String, Vec<String>>, D::Error> {
    use serde::Deserialize;
    Ok(language_word_lists(
        HESITATIONS_PLACE,
        Written::deserialize(deserializer)?,
        &mut Vec::new(),
    ))
}

/// The parts of `audio_conversational.hesitations` the loader leaves out,
/// sorted.
pub fn misshaped_hesitations(schema: &config::Config) -> Vec<String> {
    let mut dropped = Vec::new();
    if let Ok(written) = schema.get::<Written>(HESITATIONS_PLACE) {
        language_word_lists(HESITATIONS_PLACE, written, &mut dropped);
    }
    dropped.sort();
    dropped
}

/// The tables of `place` by language. A key that is not a lowercase
/// language tag, or a language that is not a table, is dropped with a
/// warning.
pub(crate) fn language_tables(
    place: &str,
    written: Written,
    dropped: &mut Vec<String>,
) -> Vec<(String, HashMap<String, Written>)> {
    let mut tables = Vec::new();
    for (language, value) in language_entries(place, written, dropped) {
        let place = format!("{place}.{language}");
        if !matches!(value, Written::Table(_)) {
            dropped.push(format!("{place} is not a table and is ignored"));
            continue;
        }
        tables.push((language, written_table(&place, value, dropped)));
    }
    tables
}

/// A list of words or phrases. An entry that is not a text, is blank, is
/// longer than [`MAX_ENTRY_BYTES`] or holds hidden characters is dropped on
/// its own, and so is every entry past [`MAX_LIST_ENTRIES`].
pub(crate) fn word_list(place: &str, written: Written, dropped: &mut Vec<String>) -> Vec<String> {
    let Written::List(entries) = written else {
        dropped.push(format!("{place} is not a list and is ignored"));
        return Vec::new();
    };
    let mut words = Vec::new();
    for entry in entries {
        match entry {
            Written::Text(_) if words.len() == MAX_LIST_ENTRIES => {
                dropped.push(format!(
                    "{place} holds more than {MAX_LIST_ENTRIES} entries; the rest is ignored"
                ));
                break;
            }
            Written::Text(text) if usable(&text, MAX_ENTRY_BYTES) => {
                words.push(text.trim().to_string());
            }
            Written::Text(text) => dropped.push(format!(
                "{place}: '{}' is blank, longer than {MAX_ENTRY_BYTES} bytes or holds hidden characters and is ignored",
                shown(&text)
            )),
            _ => dropped.push(format!("{place}: an entry is not a text and is ignored")),
        }
    }
    words
}

/// One language's named lists. A name the lists do not have is dropped with
/// a warning.
pub(crate) fn named_word_lists<L: WordLists>(
    place: &str,
    table: HashMap<String, Written>,
    dropped: &mut Vec<String>,
) -> L {
    let mut lists = L::default();
    for (name, written) in table {
        let place = format!("{place}.{}", shown(&name));
        match lists.list_mut(&name) {
            Some(list) => *list = word_list(&place, written, dropped),
            None => dropped.push(format!("{place}: no list has this name; it is ignored")),
        }
    }
    lists
}

/// "adds approve 2, reject 1": the lists a language adds to, for the startup
/// log; nothing when it adds to none.
pub fn added_summary<L: WordLists>(lists: &L) -> Option<String> {
    let counts: Vec<String> = L::NAMES
        .iter()
        .map(|name| (*name, lists.list(name).map_or(0, Vec::len)))
        .filter(|(_, count)| *count > 0)
        .map(|(name, count)| format!("{name} {count}"))
        .collect();
    (!counts.is_empty()).then(|| format!("adds {}", counts.join(", ")))
}

/// Looks `language` ("de", "de-AT", "de_AT") up by its whole tag, in lower
/// case with a hyphen, then by its primary subtag: "de-AT" finds "de".
pub fn by_tag<T>(language: &str, mut find: impl FnMut(&str) -> Option<T>) -> Option<T> {
    let tag = language.trim().to_ascii_lowercase().replace('_', "-");
    let primary = primary_subtag(&tag);
    find(&tag).or_else(|| find(&primary))
}

/// The primary subtag of `language`, in lower case: "de" for "de-AT".
pub fn primary_subtag(language: &str) -> String {
    language
        .trim()
        .split(['-', '_'])
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase()
}

/// `base`, then the `added` entries it lacks, in order and without repeats.
/// The caller passes both in the form it compares words in.
pub fn merge_word_list<'a>(
    base: impl IntoIterator<Item = &'a str>,
    added: impl IntoIterator<Item = &'a str>,
) -> Vec<String> {
    let mut merged: Vec<String> = Vec::new();
    for word in base.into_iter().chain(added) {
        if !merged.iter().any(|kept| kept == word) {
            merged.push(word.to_string());
        }
    }
    merged
}

#[cfg(test)]
mod tests {
    use super::*;

    word_lists! {
        pub struct Lists {
            /// Yes.
            yes,
            /// No.
            no,
        }
    }

    fn written(toml: &str) -> Written {
        config::Config::builder()
            .add_source(config::File::from_str(toml, config::FileFormat::Toml))
            .build()
            .unwrap()
            .get::<Written>("section")
            .unwrap()
    }

    fn load(toml: &str) -> (Vec<(String, Lists)>, Vec<String>) {
        let mut dropped = Vec::new();
        let mut languages: Vec<(String, Lists)> =
            language_tables("section", written(toml), &mut dropped)
                .into_iter()
                .map(|(language, table)| {
                    let place = format!("section.{language}");
                    let lists = named_word_lists(&place, table, &mut dropped);
                    (language, lists)
                })
                .collect();
        languages.sort_by(|a, b| a.0.cmp(&b.0));
        dropped.sort();
        (languages, dropped)
    }

    #[test]
    fn each_wrong_part_is_dropped_on_its_own() {
        let (languages, dropped) = load(
            "[section]\nFR = { yes = [\"oui\"] }\nit = \"si\"\npt-BR = { yes = [\"sim\"] }\n\
             [section.fr]\nyes = [\"oui\", \" \", 3, \"ouais\"]\nmaybe = [\"bof\"]\nno = [\"non\"]\n\
             [section.es]\nyes = \"si\"\n",
        );
        assert_eq!(
            languages,
            [
                ("es".to_string(), Lists::default()),
                (
                    "fr".to_string(),
                    Lists {
                        yes: vec!["oui".into(), "ouais".into()],
                        no: vec!["non".into()],
                    }
                ),
            ]
        );
        assert_eq!(
            dropped,
            [
                "section.es.yes is not a list and is ignored",
                "section.fr.maybe: no list has this name; it is ignored",
                "section.fr.yes: ' ' is blank, longer than 128 bytes or holds hidden characters and is ignored",
                "section.fr.yes: an entry is not a text and is ignored",
                "section.it is not a table and is ignored",
                "section: 'FR' is not a lowercase language tag such as `de` and is ignored",
                "section: 'pt-BR' is not a lowercase language tag such as `de` and is ignored",
            ]
        );
    }

    #[test]
    fn a_list_keeps_at_most_its_allowed_entries() {
        let entries: Vec<String> = (0..=MAX_LIST_ENTRIES)
            .map(|n| format!("\"w{n}\""))
            .collect();
        let (languages, dropped) = load(&format!("[section.fr]\nyes = [{}]", entries.join(",")));
        assert_eq!(languages[0].1.yes.len(), MAX_LIST_ENTRIES);
        assert_eq!(dropped.len(), 1);
    }

    #[test]
    fn a_tag_finds_its_own_entry_then_its_primary_subtags() {
        let map: HashMap<&str, u8> = [("de", 1), ("de-at", 2)].into();
        let find = |language: &str| by_tag(language, |tag| map.get(tag).copied());
        assert_eq!(find("de_AT"), Some(2));
        assert_eq!(find(" DE-at "), Some(2));
        assert_eq!(find("de-CH"), Some(1));
        assert_eq!(find("fr"), None);
        assert_eq!(primary_subtag("pt_BR"), "pt");
    }

    #[test]
    fn the_summary_counts_what_each_list_adds() {
        let lists = Lists {
            yes: vec!["oui".into(), "ouais".into()],
            no: Vec::new(),
        };
        assert_eq!(added_summary(&lists).as_deref(), Some("adds yes 2"));
        assert_eq!(added_summary(&Lists::default()), None);
    }

    #[test]
    fn merging_adds_after_the_base_without_repeats() {
        assert_eq!(
            merge_word_list(["ja", "nein"], ["oui", "ja", "non"]),
            ["ja", "nein", "oui", "non"]
        );
    }
}
