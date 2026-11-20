//! `[approval_voice_commands.words.<language>]`: what a language package adds
//! to, or takes out of, the built-in German and English words the voice
//! commands on approval cards are matched with.

use std::collections::HashMap;

use config::Config;
use erato_memory::HeapSize;
use facet::Facet;
use serde::{Deserialize, Deserializer};

use crate::language_words::{WordLists, language_tables, named_word_lists};
use crate::spoken::Written;

macro_rules! voice_command_lists {
    (
        protected { $( $(#[doc = $protected_doc:literal])+ $protected:ident, )+ }
        removable { $( $(#[doc = $removable_doc:literal])+ $removable:ident, )+ }
    ) => {
        /// One language's words for the voice commands on approval cards,
        /// added to the built-in lists. Words and phrases are compared as
        /// transcripts are: lower case, umlauts as "ae", punctuation as a
        /// word break.
        #[derive(Debug, Default, PartialEq, Eq, Clone, Facet, HeapSize)]
        pub struct VoiceCommandWordLists {
            $( $(#[doc = $protected_doc])+ pub $protected: Vec<String>, )+
            $( $(#[doc = $removable_doc])+ pub $removable: Vec<String>, )+
            /// Words and phrases taken out of the built-in lists, by list.
            /// The lists the guards rely on (negations, conditions, question
            /// words, subjects, noise, helper words, …) cannot be shortened.
            pub remove: VoiceCommandWordRemovals,
        }

        /// What one language takes out of the built-in lists.
        #[derive(Debug, Default, PartialEq, Eq, Clone, Facet, HeapSize)]
        pub struct VoiceCommandWordRemovals {
            $( $(#[doc = $removable_doc])+ pub $removable: Vec<String>, )+
        }

        /// Lists the guards rely on: nothing can be removed from them.
        pub const PROTECTED_VOICE_COMMAND_LISTS: &[&str] = &[$(stringify!($protected)),+];

        impl WordLists for VoiceCommandWordLists {
            const NAMES: &'static [&'static str] =
                &[$(stringify!($protected),)+ $(stringify!($removable),)+];

            fn list(&self, name: &str) -> Option<&Vec<String>> {
                match name {
                    $( stringify!($protected) => Some(&self.$protected), )+
                    $( stringify!($removable) => Some(&self.$removable), )+
                    _ => None,
                }
            }

            fn list_mut(&mut self, name: &str) -> Option<&mut Vec<String>> {
                match name {
                    $( stringify!($protected) => Some(&mut self.$protected), )+
                    $( stringify!($removable) => Some(&mut self.$removable), )+
                    _ => None,
                }
            }
        }

        impl WordLists for VoiceCommandWordRemovals {
            const NAMES: &'static [&'static str] = &[$(stringify!($removable),)+];

            fn list(&self, name: &str) -> Option<&Vec<String>> {
                match name {
                    $( stringify!($removable) => Some(&self.$removable), )+
                    _ => None,
                }
            }

            fn list_mut(&mut self, name: &str) -> Option<&mut Vec<String>> {
                match name {
                    $( stringify!($removable) => Some(&mut self.$removable), )+
                    _ => None,
                }
            }
        }
    };
}

voice_command_lists! {
    protected {
        /// Words that negate: a sentence with one is never an approval.
        negations,
        /// Words that make a sentence conditional: it never decides.
        conditions,
        /// A sentence ending in one of these goes on and does not decide.
        continuations,
        /// Verbs that open a question when a subject follows ("passt das").
        question_verbs,
        /// Question words that open a question.
        wh_words,
        /// First words of a segment that make the utterance a question.
        question_first,
        /// Sounds that, heard before a yes, make it listening.
        backchannels,
        /// Words of a bare yes, which alone or doubled is listening.
        yes_particles,
        /// A yes said twice in a row ("ja ja") is listening.
        doubled_yes,
        /// Leading words that are a yes: they make a following no unclear.
        leading_yes,
        /// Leading words that are a no: they make a following yes unclear.
        leading_no,
        /// Subjects after a question verb ("kannst du").
        subjects,
        /// A segment made only of these is listening noise.
        noise_words,
        /// Words of an approving phrase that do not approve on their own
        /// ("bin" of "bin einverstanden").
        approve_helpers,
        /// Words of a refusing phrase that do not refuse on their own
        /// ("mach" of "mach das nicht", "will" of "das will ich nicht").
        reject_helpers,
    }
    removable {
        /// Hesitation sounds, dropped wherever they stand.
        hesitations,
        /// Fillers dropped wherever they stand.
        fillers,
        /// Phrases that are listening noise.
        noise_phrases,
        /// Words dropped from the start of a segment when something follows.
        leading,
        /// Phrases that approve.
        approve,
        /// Besides the words of `approve`, the words an approval may hold.
        agreement_words,
        /// Besides the words of `reject` and the negations, the words a
        /// refusal may hold.
        refusal_words,
        /// Phrases that refuse.
        reject,
        /// Phrases that stop the voice.
        stop,
        /// First words that stop the voice whatever follows.
        stop_first,
        /// Phrases that skip to the next piece.
        skip,
        /// Two words in a row that say the user knows this piece ("hab
        /// ich", "i know").
        known_cues,
        /// Phrases that ask to repeat.
        repeat,
        /// Words that open a sentence about the speaker, not the card.
        personal_subjects,
        /// Words that say something on the card is wrong: maybe a change.
        corrections,
        /// A change ending on one of these has not said what to change.
        dangling,
        /// Besides the question for the rest, the words it may hold.
        rest_words,
        /// Besides a known cue, the words a skip of a known piece may hold.
        known_words,
        /// First words of a skip ("weiter …") that `onward_words` may follow.
        onward_first,
        /// Besides an onward first word, the words such a skip may hold.
        onward_words,
        /// "Not like that" said alone: a wish for a different call.
        not_like_that_alone,
        /// "Not like that" anywhere: the call, but different.
        not_like_that,
        /// Words that ask for a different call wherever they stand.
        change_anywhere,
        /// Verbs that ask for a different call at the start of a segment.
        change_first,
        /// Verbs that ask for a change only with a date, number or one of
        /// `make_object` after them.
        make_first,
        /// What after a `make_first` verb makes it a change.
        make_object,
        /// Verbs that keep or drop a part ("lass X weg").
        keep_verbs,
        /// What after a `keep_verbs` verb says the part is kept or dropped.
        keep_endings,
        /// Pronouns, which name no part of the card.
        pronouns,
        /// Prepositions before a date.
        date_prepositions,
        /// Weekday and month names.
        date_words,
        /// Phrases that ask to repeat wherever they stand.
        repeat_cues,
        /// Words that ask to read a text aloud.
        read_cues,
        /// Words that, with one of `rest_what`, ask for the rest.
        rest_ask,
        /// Words that, with one of `rest_ask`, ask for the rest.
        rest_what,
        /// Words that name no piece of the card.
        generic,
        /// "Lieber", "rather": a wish for something else, unless a word of
        /// `rather_not` follows.
        rather,
        /// The word "not" after `rather` ("lieber nicht"): a refusal.
        rather_not,
        /// "Schon", "already": a read cue said with one is not a request to
        /// read.
        already,
        /// Phrases meaning "again" ("noch mal"): their words are no fillers.
        again,
        /// Negations that stand before the word they negate ("nicht machen").
        negations_before,
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
                lists.remove = named_word_lists(
                    &format!("{place}.remove"),
                    table,
                    PROTECTED_VOICE_COMMAND_LISTS,
                    "the guards rely on its words, so none can be removed",
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
                    [approval_voice_commands.words.fr.remove]\nreject = [\"ne\"]\n";
        let words = words(toml);
        let fr = &words["fr"];
        assert_eq!(fr.approve, ["oui", "d'accord"]);
        assert_eq!(fr.reject, ["non"]);
        assert_eq!(fr.remove.reject, ["ne"]);
        assert!(misshaped_voice_command_words(&schema(toml)).is_empty());
    }

    #[test]
    fn unknown_lists_are_dropped_with_a_warning() {
        let toml = "[approval_voice_commands.words.fr]\n\
                    approvals = [\"oui\"]\nreject = [\"non\"]\n\
                    [approval_voice_commands.words.fr.remove]\nrejects = [\"ne\"]\n";
        let words = words(toml);
        assert_eq!(words["fr"].reject, ["non"]);
        assert!(words["fr"].approve.is_empty());
        assert_eq!(
            misshaped_voice_command_words(&schema(toml)),
            [
                "approval_voice_commands.words.fr.approvals: no list has this name; it is ignored",
                "approval_voice_commands.words.fr.remove.rejects: no list has this name; it is ignored",
            ]
        );
    }

    #[test]
    fn protected_lists_cannot_be_shortened() {
        let toml = "[approval_voice_commands.words.fr]\nnegations = [\"pas\"]\n\
                    [approval_voice_commands.words.fr.remove]\n\
                    negations = [\"nicht\"]\nconditions = [\"aber\"]\nreject = [\"ne\"]\n\
                    subjects = [\"das\"]\nnoise_words = [\"okay\"]\nreject_helpers = [\"will\"]\n";
        let words = words(toml);
        assert_eq!(words["fr"].negations, ["pas"]);
        assert_eq!(words["fr"].remove.reject, ["ne"]);
        assert_eq!(
            misshaped_voice_command_words(&schema(toml)),
            [
                "approval_voice_commands.words.fr.remove.conditions is ignored: the guards rely on its words, so none can be removed",
                "approval_voice_commands.words.fr.remove.negations is ignored: the guards rely on its words, so none can be removed",
                "approval_voice_commands.words.fr.remove.noise_words is ignored: the guards rely on its words, so none can be removed",
                "approval_voice_commands.words.fr.remove.reject_helpers is ignored: the guards rely on its words, so none can be removed",
                "approval_voice_commands.words.fr.remove.subjects is ignored: the guards rely on its words, so none can be removed",
            ]
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
            assert!(!PROTECTED_VOICE_COMMAND_LISTS.contains(name));
            assert!(VoiceCommandWordLists::NAMES.contains(name));
        }
        assert_eq!(
            VoiceCommandWordRemovals::NAMES.len() + PROTECTED_VOICE_COMMAND_LISTS.len(),
            VoiceCommandWordLists::NAMES.len()
        );
    }
}
