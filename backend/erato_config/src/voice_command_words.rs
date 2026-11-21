//! `[approval_voice_commands.words.<language>]`: what a language package adds
//! to the built-in German and English words the voice commands on approval
//! cards are matched with.

use std::collections::HashMap;

use config::Config;
use serde::{Deserialize, Deserializer};

use crate::language_words::{language_tables, named_word_lists, word_lists};
use crate::spoken::Written;

word_lists! {
    /// One language's words for the voice commands on approval cards,
    /// added to the built-in lists; no built-in word can be taken out.
    /// Words and phrases are compared as transcripts are: lower case,
    /// umlauts as "ae", punctuation as a word break. The other built-in
    /// lists (navigation, changes, dates) stay in code.
    pub struct VoiceCommandWordLists {
        /// Phrases that approve. A card still asks for its confirmation
        /// phrase.
        approve,
        /// Phrases that refuse.
        reject,
        /// Phrases that stop the voice.
        stop,
        /// Phrases that skip to the next piece.
        skip,
        /// Phrases that ask to repeat.
        repeat,
        /// Hesitation sounds of one vowel group at most, dropped wherever
        /// they stand and trimmed around the confirmation phrase.
        hesitations,
        /// Fillers dropped wherever they stand.
        fillers,
        /// Words that negate: a sentence with one is never an approval.
        negations,
        /// Words that make a sentence conditional: it never decides.
        conditions,
        /// Question words that open a question.
        wh_words,
        /// Other first words that open a question ("est-ce").
        question_first,
        /// Verbs that ask when they come before their subject.
        question_verbs,
        /// Last words after which the sentence goes on ("et", "puis").
        continuations,
        /// A no said before something else ("non, …").
        leading_no,
        /// Words of a bare yes, which alone or doubled is listening and
        /// never part of a confirmation phrase.
        yes_particles,
        /// Approvals said in passing ("passt", "go ahead"): a confirmation
        /// phrase made of them is refused.
        casual_approvals,
    }
}

/// `[approval_voice_commands.words.<language>]`, by lowercase language tag.
pub type VoiceCommandWordsByLanguage = HashMap<String, VoiceCommandWordLists>;

const PLACE: &str = "approval_voice_commands.words";

/// The words whose shape is right, and each part that is not.
fn shaped_voice_command_words(written: Written) -> (VoiceCommandWordsByLanguage, Vec<String>) {
    let mut dropped = Vec::new();
    let languages = language_tables(PLACE, written, &mut dropped)
        .into_iter()
        .map(|(language, table)| {
            let place = format!("{PLACE}.{language}");
            let lists = named_word_lists(&place, table, &mut dropped);
            (language, lists)
        })
        .collect();
    dropped.sort();
    (languages, dropped)
}

/// Reads `[approval_voice_commands.words]` leaving out every wrong part;
/// [`misshaped_voice_command_words`] names them.
pub fn deserialize_voice_command_words<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<VoiceCommandWordsByLanguage, D::Error> {
    Ok(shaped_voice_command_words(Written::deserialize(deserializer)?).0)
}

/// The parts of `[approval_voice_commands.words]` the loader leaves out,
/// sorted.
pub fn misshaped_voice_command_words(schema: &Config) -> Vec<String> {
    schema
        .get::<Written>(PLACE)
        .map(|written| shaped_voice_command_words(written).1)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::language_words::WordLists;
    use config::{File, FileFormat};

    fn schema(toml: &str) -> Config {
        Config::builder()
            .add_source(File::from_str(toml, FileFormat::Toml))
            .build()
            .unwrap()
    }

    fn words(toml: &str) -> VoiceCommandWordsByLanguage {
        shaped_voice_command_words(schema(toml).get::<Written>(PLACE).unwrap()).0
    }

    #[test]
    fn a_language_adds_by_list() {
        let toml = "[approval_voice_commands.words.fr]\n\
                    approve = [\"oui\", \"d'accord\"]\nreject = [\"non\"]\ncontinuations = [\"et\"]\n";
        let words = words(toml);
        let fr = &words["fr"];
        assert_eq!(fr.approve, ["oui", "d'accord"]);
        assert_eq!(fr.reject, ["non"]);
        assert_eq!(fr.continuations, ["et"]);
        assert!(misshaped_voice_command_words(&schema(toml)).is_empty());
    }

    #[test]
    fn unknown_lists_and_removals_are_dropped_with_a_warning() {
        let toml = "[approval_voice_commands.words.fr]\n\
                    approvals = [\"oui\"]\nreject = [\"non\"]\nleading = [\"alors\"]\n\
                    noise_words = [\"bon\"]\n\
                    [approval_voice_commands.words.fr.remove]\nskip = [\"ne\"]\n";
        let words = words(toml);
        assert_eq!(words["fr"].reject, ["non"]);
        assert!(words["fr"].approve.is_empty());
        assert_eq!(
            misshaped_voice_command_words(&schema(toml)),
            ["approvals", "leading", "noise_words", "remove"].map(|list| format!(
                "approval_voice_commands.words.fr.{list}: no list has this name; it is ignored"
            ))
        );
    }

    #[test]
    fn a_wrong_part_never_drops_the_rest_of_its_language() {
        let toml = "[approval_voice_commands.words]\nIT = { approve = [\"si\"] }\n\
                    [approval_voice_commands.words.fr]\napprove = \"oui\"\nreject = [\"non\", 1]\nremove = 3\n";
        let words = words(toml);
        assert_eq!(words.keys().collect::<Vec<_>>(), ["fr"]);
        assert_eq!(words["fr"].reject, ["non"]);
        assert_eq!(misshaped_voice_command_words(&schema(toml)).len(), 4);
    }

    #[test]
    fn the_section_loads_its_words_and_drops_the_wrong_ones() {
        let config = schema(
            "[approval_voice_commands]\nenabled = true\n\
             [approval_voice_commands.words.fr]\nreject = [\"non\"]\nnope = [\"x\"]\n",
        )
        .get::<crate::config::ApprovalVoiceCommandsConfig>("approval_voice_commands")
        .unwrap();
        assert!(config.enabled);
        assert_eq!(config.words["fr"].reject, ["non"]);
        let none = schema("[approval_voice_commands]\nenabled = true\n")
            .get::<crate::config::ApprovalVoiceCommandsConfig>("approval_voice_commands")
            .unwrap();
        assert!(none.words.is_empty());
    }

    #[test]
    fn every_list_name_reaches_its_list() {
        let mut lists = VoiceCommandWordLists::default();
        for name in VoiceCommandWordLists::NAMES {
            lists.list_mut(name).unwrap().push((*name).to_string());
        }
        for name in VoiceCommandWordLists::NAMES {
            assert_eq!(lists.list(name).unwrap(), &[name.to_string()]);
        }
    }
}
