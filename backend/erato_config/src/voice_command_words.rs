//! `[approval_voice_commands.words.<language>]`: what a language package adds
//! to, or takes out of, the built-in German and English words the voice
//! commands on approval cards are matched with.

use std::collections::HashMap;

use config::Config;
use serde::{Deserialize, Deserializer};

use crate::language_words::{WordLists, language_tables, named_word_lists, word_lists};
use crate::spoken::Written;

word_lists! {
    /// One language's words for the voice commands on approval cards,
    /// added to the built-in lists. Words and phrases are compared as
    /// transcripts are: lower case, umlauts as "ae", punctuation as a word
    /// break. The other built-in lists (navigation, changes, dates) stay in
    /// code.
    pub struct VoiceCommandWordLists {
        /// Phrases that approve. A card still asks for its confirmation
        /// phrase.
        approve,
        /// Phrases that refuse.
        reject,
        /// Besides the words of `reject` and the negations, the words a
        /// refusal may hold.
        refusal_words,
        /// Phrases that stop the voice.
        stop,
        /// First words that stop the voice whatever follows.
        stop_first,
        /// Phrases that skip to the next piece.
        skip,
        /// Phrases that ask to repeat.
        repeat,
        /// Hesitation sounds, dropped wherever they stand and trimmed around
        /// the confirmation phrase.
        hesitations,
        /// Fillers dropped wherever they stand.
        fillers,
        /// Words that negate: a sentence with one is never an approval.
        negations,
        /// Words that make a sentence conditional: it never decides.
        conditions,
        /// Question words that open a question.
        wh_words,
        /// Words of a bare yes, which alone or doubled is listening.
        yes_particles,
        /// A segment made only of these is listening noise.
        noise_words,
        /// Words of an approving phrase that do not approve on their own
        /// ("bin" of "bin einverstanden").
        approve_helpers,
        /// Words of a refusing phrase that do not refuse on their own
        /// ("will" of "das will ich nicht").
        reject_helpers,
        /// Approvals said in passing ("passt", "go ahead"): a confirmation
        /// phrase equal to one of them is refused.
        casual_approvals,
    }
    with {
        /// Words taken out of the built-in `skip`, `repeat`, `hesitations`
        /// and `fillers`. No other list can be shortened.
        remove: VoiceCommandWordRemovals,
    }
}

word_lists! {
    /// What one language takes out of the built-in lists: only lists whose
    /// words never decide a card.
    pub struct VoiceCommandWordRemovals {
        /// Phrases that skip to the next piece.
        skip,
        /// Phrases that ask to repeat.
        repeat,
        /// Hesitation sounds.
        hesitations,
        /// Fillers.
        fillers,
    }
}

/// `[approval_voice_commands.words.<language>]`, by lowercase language tag.
pub type VoiceCommandWordsByLanguage = HashMap<String, VoiceCommandWordLists>;

const PLACE: &str = "approval_voice_commands.words";

/// The words whose shape is right, and each part that is not.
fn shaped_voice_command_words(written: Written) -> (VoiceCommandWordsByLanguage, Vec<String>) {
    let mut dropped = Vec::new();
    let mut languages = VoiceCommandWordsByLanguage::new();
    for (language, mut table) in language_tables(PLACE, written, &mut dropped) {
        let place = format!("{PLACE}.{language}");
        let remove = table.remove("remove");
        let mut lists: VoiceCommandWordLists =
            named_word_lists(&place, table, &[], "", &mut dropped);
        match remove {
            None => {}
            Some(Written::Table(table)) => {
                let kept: Vec<&str> = VoiceCommandWordLists::NAMES
                    .iter()
                    .copied()
                    .filter(|name| !VoiceCommandWordRemovals::NAMES.contains(name))
                    .collect();
                lists.remove = named_word_lists(
                    &format!("{place}.remove"),
                    table,
                    &kept,
                    "approvals, refusals, stops and the lists the guards rely on are never shortened",
                    &mut dropped,
                );
            }
            Some(_) => dropped.push(format!("{place}.remove is not a table and is ignored")),
        }
        languages.insert(language, lists);
    }
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
    fn a_language_adds_and_removes_by_list() {
        let toml = "[approval_voice_commands.words.fr]\n\
                    approve = [\"oui\", \"d'accord\"]\nreject = [\"non\"]\n\
                    [approval_voice_commands.words.fr.remove]\nfillers = [\"mal\"]\n";
        let words = words(toml);
        let fr = &words["fr"];
        assert_eq!(fr.approve, ["oui", "d'accord"]);
        assert_eq!(fr.reject, ["non"]);
        assert_eq!(fr.remove.fillers, ["mal"]);
        assert!(misshaped_voice_command_words(&schema(toml)).is_empty());
    }

    #[test]
    fn unknown_lists_are_dropped_with_a_warning() {
        let toml = "[approval_voice_commands.words.fr]\n\
                    approvals = [\"oui\"]\nreject = [\"non\"]\nleading = [\"alors\"]\n\
                    [approval_voice_commands.words.fr.remove]\nskips = [\"ne\"]\n";
        let words = words(toml);
        assert_eq!(words["fr"].reject, ["non"]);
        assert!(words["fr"].approve.is_empty());
        assert_eq!(
            misshaped_voice_command_words(&schema(toml)),
            [
                "approval_voice_commands.words.fr.approvals: no list has this name; it is ignored",
                "approval_voice_commands.words.fr.leading: no list has this name; it is ignored",
                "approval_voice_commands.words.fr.remove.skips: no list has this name; it is ignored",
            ]
        );
    }

    #[test]
    fn only_lists_that_never_decide_can_be_shortened() {
        let toml = "[approval_voice_commands.words.fr]\nnegations = [\"pas\"]\n\
                    [approval_voice_commands.words.fr.remove]\n\
                    negations = [\"nicht\"]\nreject = [\"ne\"]\nstop = [\"halt\"]\n\
                    stop_first = [\"halt\"]\napprove = [\"ja\"]\nrefusal_words = [\"das\"]\n\
                    noise_words = [\"okay\"]\nskip = [\"weiter\"]\n";
        let words = words(toml);
        assert_eq!(words["fr"].negations, ["pas"]);
        assert_eq!(words["fr"].remove.skip, ["weiter"]);
        let never = "is ignored: approvals, refusals, stops and the lists the guards rely on are never shortened";
        assert_eq!(
            misshaped_voice_command_words(&schema(toml)),
            [
                "approve",
                "negations",
                "noise_words",
                "refusal_words",
                "reject",
                "stop",
                "stop_first"
            ]
            .map(|list| format!("approval_voice_commands.words.fr.remove.{list} {never}"))
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
        for name in VoiceCommandWordRemovals::NAMES {
            assert!(VoiceCommandWordLists::NAMES.contains(name));
        }
    }
}
