//! The lists the rules match with, built once per language at startup: the
//! built-in German and English base in `rules.rs`, with what a language
//! package adds or removes for German, English and the card's language.
//! People mix German and English, so their words count on every card.
//! A few words stay in the rules' code because they shape a rule rather than
//! fill a list: "ne"/"noe"/"doch", "aber"/"but", "take", the copula words,
//! "nicht ändern", a final "so"/"then", "rest", "ueberspr"/"skip" and "um".

use super::rules::{self, drop_fillers, words_of};
use erato_config::language_words::{WordLists, merge_word_list};
use erato_config::voice_command_words::{VoiceCommandWordLists, VoiceCommandWordsByLanguage};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, LazyLock};

/// The languages whose words count on every card.
const SHARED_LANGUAGES: [&str; 2] = ["de", "en"];

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    /// Single words: an entry of several words is dropped.
    Word,
    /// Phrases compared whole.
    Phrase,
    /// Words in a row, looked for inside a segment.
    Cue,
}

/// The built-in list of a config list name.
fn base(name: &str) -> Option<(Kind, Vec<String>)> {
    use Kind::{Cue, Phrase, Word};
    use rules::*;
    let (kind, words): (Kind, &[&str]) = match name {
        "repeat_cues" | "read_cues" | "known_cues" => {
            let cues = match name {
                "repeat_cues" => REPEAT_CUES,
                "read_cues" => READ_CUES,
                _ => KNOWN_CUES,
            };
            return Some((Cue, cues.iter().map(|cue| cue.join(" ")).collect()));
        }
        "negations" => (Word, NEGATIONS),
        "conditions" => (Word, CONDITIONS),
        "continuations" => (Word, CONTINUATIONS),
        "question_verbs" => (Word, QUESTION_VERBS),
        "wh_words" => (Word, WH_WORDS),
        "question_first" => (Word, QUESTION_FIRST),
        "backchannels" => (Word, BACKCHANNELS),
        "yes_particles" => (Word, YES_PARTICLES),
        "doubled_yes" => (Word, DOUBLED_YES),
        "leading_yes" => (Word, LEADING_YES),
        "leading_no" => (Word, LEADING_NO),
        "hesitations" => (Word, HESITATIONS),
        "fillers" => (Word, FILLER_WORDS),
        "noise_words" => (Word, NOISE_WORDS),
        "noise_phrases" => (Phrase, NOISE_PHRASES),
        "leading" => (Word, LEADING),
        "approve" => (Phrase, APPROVE),
        "agreement_words" => (Word, AGREEMENT_WORDS),
        "refusal_words" => (Word, REFUSAL_WORDS),
        "reject" => (Phrase, REJECT),
        "stop" => (Phrase, STOP),
        "stop_first" => (Word, STOP_FIRST),
        "skip" => (Phrase, SKIP),

        "repeat" => (Phrase, REPEAT),
        "personal_subjects" => (Word, PERSONAL_SUBJECTS),
        "subjects" => (Word, SUBJECTS),
        "corrections" => (Word, CORRECTIONS),
        "dangling" => (Word, DANGLING),
        "rest_words" => (Word, REST_WORDS),
        "known_words" => (Word, KNOWN_WORDS),
        "onward_first" => (Word, ONWARD_FIRST),
        "onward_words" => (Word, ONWARD_WORDS),
        "not_like_that_alone" => (Phrase, NOT_LIKE_THAT_ALONE),
        "not_like_that" => (Cue, NOT_LIKE_THAT),
        "change_anywhere" => (Word, CHANGE_ANYWHERE),
        "change_first" => (Word, CHANGE_FIRST),
        "make_first" => (Word, MAKE_FIRST),
        "make_object" => (Word, MAKE_OBJECT),
        "keep_verbs" => (Word, KEEP_VERBS),
        "keep_endings" => (Word, KEEP_ENDINGS),
        "pronouns" => (Word, PRONOUNS),
        "date_prepositions" => (Word, DATE_PREPOSITIONS),
        "date_words" => (Word, DATE_WORDS),
        "rest_ask" => (Word, REST_ASK),
        "rest_what" => (Word, REST_WHAT),
        "generic" => (Word, GENERIC),
        "rather" => (Word, RATHER),
        "rather_not" => (Word, RATHER_NOT),
        "already" => (Word, ALREADY),
        "again" => (Cue, AGAIN),
        "negations_before" => (Word, NEGATIONS_BEFORE),
        "approve_helpers" => (Word, APPROVE_HELPERS),
        "reject_helpers" => (Word, REJECT_HELPERS),
        _ => return None,
    };
    Some((kind, words.iter().map(|word| word.to_string()).collect()))
}

/// The lists for one set of languages.
#[derive(Debug)]
pub struct CommandWords {
    pub(super) hesitations: HashSet<String>,
    /// The hesitations and the other fillers.
    pub(super) fillers: HashSet<String>,
    pub(super) noise_words: HashSet<String>,
    pub(super) noise_phrases: HashSet<String>,
    pub(super) leading: HashSet<String>,
    pub(super) leading_yes: HashSet<String>,
    pub(super) leading_no: HashSet<String>,
    pub(super) approve: HashSet<String>,
    pub(super) reject: HashSet<String>,
    pub(super) stop: HashSet<String>,
    pub(super) stop_first: HashSet<String>,
    pub(super) skip: HashSet<String>,
    pub(super) known_cues: Vec<Vec<String>>,
    pub(super) repeat: HashSet<String>,
    pub(super) negations: HashSet<String>,
    pub(super) backchannels: HashSet<String>,
    pub(super) yes_particles: HashSet<String>,
    pub(super) doubled_yes: HashSet<String>,
    pub(super) question_verbs: HashSet<String>,
    pub(super) subjects: HashSet<String>,
    pub(super) wh_words: HashSet<String>,
    pub(super) personal_subjects: HashSet<String>,
    pub(super) corrections: HashSet<String>,
    pub(super) dangling: HashSet<String>,
    pub(super) rest_words: HashSet<String>,
    pub(super) known_words: HashSet<String>,
    pub(super) onward_first: HashSet<String>,
    pub(super) onward_words: HashSet<String>,
    pub(super) continuations: HashSet<String>,
    pub(super) conditions: HashSet<String>,
    pub(super) not_like_that_alone: HashSet<String>,
    pub(super) not_like_that: Vec<Vec<String>>,
    pub(super) change_anywhere: HashSet<String>,
    pub(super) change_first: HashSet<String>,
    pub(super) make_first: HashSet<String>,
    pub(super) make_object: HashSet<String>,
    pub(super) keep_verbs: HashSet<String>,
    pub(super) keep_endings: HashSet<String>,
    pub(super) pronouns: HashSet<String>,
    pub(super) date_prepositions: HashSet<String>,
    pub(super) date_words: HashSet<String>,
    pub(super) question_first: HashSet<String>,
    pub(super) repeat_cues: Vec<Vec<String>>,
    pub(super) read_cues: Vec<Vec<String>>,
    pub(super) rest_ask: HashSet<String>,
    pub(super) rest_what: HashSet<String>,
    pub(super) generic: HashSet<String>,
    pub(super) rather: HashSet<String>,
    pub(super) rather_not: HashSet<String>,
    pub(super) already: HashSet<String>,
    pub(super) again: Vec<Vec<String>>,
    pub(super) negations_before: HashSet<String>,
    /// Besides acknowledgements and noise, the words an approval may hold.
    pub(super) agreement: HashSet<String>,
    /// Words that carry the agreement itself, not just accompany it.
    pub(super) agreeing: HashSet<String>,
    pub(super) refusal: HashSet<String>,
    pub(super) refusing: HashSet<String>,
}

/// Merges the configured entries of each list into its base, and notes each
/// entry it cannot use.
struct Builder<'a> {
    /// The languages in use, and whether to note their unusable entries.
    languages: &'a [(&'a str, &'a VoiceCommandWordLists, bool)],
    notes: Vec<String>,
}

impl Builder<'_> {
    /// The list `name`: base, configured words, without removed ones. An
    /// entry `refuse` names a reason for is not added.
    fn list(
        &mut self,
        name: &str,
        refuse: &dyn Fn(&[String]) -> Option<&'static str>,
    ) -> Vec<String> {
        let Some((kind, base)) = base(name) else {
            return Vec::new();
        };
        let mut added = Vec::new();
        let mut removed = Vec::new();
        for (language, lists, noted) in self.languages {
            for entry in lists.list(name).into_iter().flatten() {
                let words = words_of(entry);
                let problem = if words.is_empty() {
                    Some("it holds no word")
                } else if kind == Kind::Word && words.len() > 1 {
                    Some("this list holds single words")
                } else {
                    refuse(&words)
                };
                match problem {
                    Some(problem) if *noted => self.notes.push(format!(
                        "approval_voice_commands.words.{language}.{name}: '{entry}' is ignored: {problem}"
                    )),
                    Some(_) => {}
                    None => added.push(words.join(" ")),
                }
            }
            removed.extend(
                lists
                    .remove
                    .list(name)
                    .into_iter()
                    .flatten()
                    .map(|entry| words_of(entry).join(" ")),
            );
        }
        let removed: Vec<&str> = removed.iter().map(String::as_str).collect();
        merge_word_list(
            base.iter().map(String::as_str),
            added.iter().map(String::as_str),
            &removed,
        )
    }
}

fn set(list: Vec<String>) -> HashSet<String> {
    list.into_iter().collect()
}

fn cues(list: Vec<String>) -> Vec<Vec<String>> {
    list.iter()
        .map(|cue| cue.split(' ').map(str::to_string).collect())
        .collect()
}

/// The words of `phrases` that carry their meaning: without pronouns,
/// subjects, noise and `helpers`.
fn carrying(
    phrases: &[String],
    noise: &HashSet<String>,
    pronouns: &HashSet<String>,
    subjects: &HashSet<String>,
    helpers: &HashSet<String>,
) -> HashSet<String> {
    phrases
        .iter()
        .flat_map(|phrase| words_of(phrase))
        .filter(|word| {
            !noise.contains(word)
                && !pronouns.contains(word)
                && !subjects.contains(word)
                && !helpers.contains(word)
        })
        .collect()
}

fn any_in(words: &[String], set: &HashSet<String>, reason: &'static str) -> Option<&'static str> {
    words
        .iter()
        .any(|word| set.contains(word))
        .then_some(reason)
}

impl CommandWords {
    /// A negation, condition or question word: a word the guards look for.
    pub(super) fn is_guard_word(&self, word: &str) -> bool {
        self.negations.contains(word)
            || self.conditions.contains(word)
            || self.wh_words.contains(word)
            || self.question_first.contains(word)
            || self.question_verbs.contains(word)
    }

    /// A negation, condition or question word of these languages, also
    /// drawn out: checked on every word before any is trimmed.
    pub(super) fn decides_meaning(&self, word: &str) -> bool {
        erato_config::spoken::decides_meaning_in(word, |word| {
            self.negations.contains(word)
                || self.conditions.contains(word)
                || self.wh_words.contains(word)
        })
    }

    /// The built-in German and English lists alone.
    pub fn base() -> &'static CommandWords {
        static BASE: LazyLock<CommandWords> = LazyLock::new(|| CommandWords::build(&[]).0);
        &BASE
    }

    fn build(languages: &[(&str, &VoiceCommandWordLists, bool)]) -> (Self, Vec<String>) {
        let mut builder = Builder {
            languages,
            notes: Vec::new(),
        };
        let any = |_: &[String]| -> Option<&'static str> { None };
        let mut list = |name: &str| builder.list(name, &any);
        // The lists the guards and decisions rely on come first: what is
        // added elsewhere is checked against them.
        let negations = list("negations");
        let conditions = list("conditions");
        let question = set([list("wh_words"), list("question_first")].concat());
        let subjects = set(list("subjects"));
        let reject = list("reject");
        let refusal_words = list("refusal_words");
        let stop = list("stop");
        let approve_helpers = set(list("approve_helpers"));
        let reject_helpers = set(list("reject_helpers"));
        let relied_on: HashSet<String> = [
            negations.clone(),
            conditions.clone(),
            list("continuations"),
            list("question_verbs"),
            list("leading_yes"),
            list("leading_no"),
            list("backchannels"),
            list("yes_particles"),
            list("doubled_yes"),
            list("noise_words"),
            refusal_words.clone(),
        ]
        .into_iter()
        .flatten()
        .chain(question.iter().cloned())
        .chain(subjects.iter().cloned())
        .chain(approve_helpers.iter().cloned())
        .chain(reject_helpers.iter().cloned())
        .chain(
            reject
                .iter()
                .chain(&stop)
                .flat_map(|phrase| words_of(phrase)),
        )
        .collect();
        let guard: HashSet<String> = negations.iter().chain(&conditions).cloned().collect();
        let conditions = set(conditions);
        let agreeing_problem = |words: &[String]| {
            any_in(
                words,
                &guard,
                "a negation or condition never counts as agreement or noise",
            )
            .or_else(|| {
                any_in(
                    words,
                    &question,
                    "a question word never counts as agreement or noise",
                )
            })
        };
        let leading_problem = |words: &[String]| {
            any_in(words, &conditions, "a condition never leads a decision")
                .or_else(|| any_in(words, &question, "a question word never leads a decision"))
        };
        // Dropped words are invisible to every guard and decision, so none
        // of theirs may become one.
        let filler_problem = |words: &[String]| {
            agreeing_problem(words).or_else(|| {
                any_in(
                    words,
                    &relied_on,
                    "a word the guards or decisions rely on is never dropped as a filler",
                )
            })
        };
        let mut agreeing_list = |name: &str| builder.list(name, &agreeing_problem);
        let yes_particles = agreeing_list("yes_particles");
        let doubled_yes = agreeing_list("doubled_yes");
        let leading_yes = agreeing_list("leading_yes");
        let approve = agreeing_list("approve");
        let agreement_words = agreeing_list("agreement_words");
        let noise_words = agreeing_list("noise_words");
        let noise_phrases = agreeing_list("noise_phrases");
        let hesitations = builder.list("hesitations", &filler_problem);
        let filler_words = builder.list("fillers", &filler_problem);
        let leading = builder.list("leading", &leading_problem);
        let mut list = |name: &str| builder.list(name, &any);
        let leading_no = list("leading_no");
        let again = cues(list("again"));
        let fillers: HashSet<String> = hesitations.iter().chain(&filler_words).cloned().collect();
        let phrases = |list: &[String]| -> HashSet<String> {
            list.iter()
                .map(|phrase| drop_fillers(&words_of(phrase), &fillers, &again).join(" "))
                .collect()
        };
        let noise_words = set(noise_words);
        let leading_no_set = set(leading_no);
        let leading_yes_set = set(leading_yes);
        let yes_particles = set(yes_particles);
        let negations = set(negations);
        let pronouns = set(list("pronouns"));
        let agreement = approve
            .iter()
            .flat_map(|phrase| words_of(phrase))
            .chain(agreement_words)
            .chain(noise_words.iter().cloned())
            .chain(
                leading
                    .iter()
                    .filter(|word| !leading_no_set.contains(*word))
                    .cloned(),
            )
            .collect();
        let refusal = reject
            .iter()
            .flat_map(|phrase| words_of(phrase))
            .chain(refusal_words)
            .chain(negations.iter().cloned())
            .chain(noise_words.iter().cloned())
            .chain(
                leading
                    .iter()
                    .filter(|word| !leading_yes_set.contains(*word))
                    .cloned(),
            )
            .filter(|word| !yes_particles.contains(word))
            .collect();
        let agreeing = carrying(
            &approve,
            &noise_words,
            &pronouns,
            &subjects,
            &approve_helpers,
        );
        let refusing = carrying(&reject, &noise_words, &pronouns, &subjects, &reject_helpers);
        let words = CommandWords {
            noise_phrases: phrases(&noise_phrases),
            approve: phrases(&approve),
            reject: phrases(&reject),
            stop: phrases(&stop),
            skip: phrases(&list("skip")),
            repeat: phrases(&list("repeat")),
            not_like_that_alone: phrases(&list("not_like_that_alone")),
            hesitations: set(hesitations),
            fillers,
            noise_words,
            leading: set(leading),
            leading_yes: leading_yes_set,
            leading_no: leading_no_set,
            stop_first: set(list("stop_first")),
            known_cues: cues(list("known_cues")),
            negations,
            backchannels: set(list("backchannels")),
            yes_particles,
            doubled_yes: set(doubled_yes),
            question_verbs: set(list("question_verbs")),
            subjects,
            wh_words: set(list("wh_words")),
            personal_subjects: set(list("personal_subjects")),
            corrections: set(list("corrections")),
            dangling: set(list("dangling")),
            rest_words: set(list("rest_words")),
            known_words: set(list("known_words")),
            onward_first: set(list("onward_first")),
            onward_words: set(list("onward_words")),
            continuations: set(list("continuations")),
            conditions,
            not_like_that: cues(list("not_like_that")),
            change_anywhere: set(list("change_anywhere")),
            change_first: set(list("change_first")),
            make_first: set(list("make_first")),
            make_object: set(list("make_object")),
            keep_verbs: set(list("keep_verbs")),
            keep_endings: set(list("keep_endings")),
            pronouns,
            date_prepositions: set(list("date_prepositions")),
            date_words: set(list("date_words")),
            question_first: set(list("question_first")),
            repeat_cues: cues(list("repeat_cues")),
            read_cues: cues(list("read_cues")),
            rest_ask: set(list("rest_ask")),
            rest_what: set(list("rest_what")),
            generic: set(list("generic")),
            rather: set(list("rather")),
            rather_not: set(list("rather_not")),
            already: set(list("already")),
            again,
            negations_before: set(list("negations_before")),
            agreement,
            agreeing,
            refusal,
            refusing,
        };
        let mut notes = builder.notes;
        notes.sort();
        notes.dedup();
        (words, notes)
    }
}

/// The lists by card language: German and English with what packages add
/// for them, and for each other configured language those plus its own.
pub struct CommandWordsByLanguage {
    shared: Arc<CommandWords>,
    by_language: HashMap<String, Arc<CommandWords>>,
}

impl Default for CommandWordsByLanguage {
    fn default() -> Self {
        Self::from_config(&VoiceCommandWordsByLanguage::new())
    }
}

impl CommandWordsByLanguage {
    /// Builds every language's lists once, warning for each configured entry
    /// that cannot be used and logging what each language adds or removes.
    pub fn from_config(config: &VoiceCommandWordsByLanguage) -> Self {
        let mut languages: Vec<(&String, &VoiceCommandWordLists)> = config.iter().collect();
        languages.sort_by(|a, b| a.0.cmp(b.0));
        for (language, lists) in &languages {
            crate::server::api::v1beta::me_profile_middleware::warn_unreachable_voice_language(
                "Voice-command words",
                language,
            );
            if let Some(summary) = summary(lists) {
                tracing::info!("Voice-command words for `{language}`: {summary}.");
            }
        }
        let shared_languages: Vec<(&str, &VoiceCommandWordLists, bool)> = languages
            .iter()
            .filter(|(language, _)| SHARED_LANGUAGES.contains(&language.as_str()))
            .map(|(language, lists)| (language.as_str(), *lists, true))
            .collect();
        let (shared, notes) = CommandWords::build(&shared_languages);
        warn_unused(notes);
        let mut by_language = HashMap::new();
        for (language, lists) in languages
            .iter()
            .filter(|(language, _)| !SHARED_LANGUAGES.contains(&language.as_str()))
        {
            let mut active: Vec<(&str, &VoiceCommandWordLists, bool)> = shared_languages
                .iter()
                .map(|(language, lists, _)| (*language, *lists, false))
                .collect();
            active.push((language.as_str(), lists, true));
            let (words, notes) = CommandWords::build(&active);
            warn_unused(notes);
            by_language.insert((*language).clone(), Arc::new(words));
        }
        Self {
            shared: Arc::new(shared),
            by_language,
        }
    }

    /// The lists for a card in `language` ("fr", "fr-CA", …).
    pub fn for_language(&self, language: &str) -> &CommandWords {
        let tag = language.trim().to_ascii_lowercase().replace('_', "-");
        let primary = tag.split('-').next().unwrap_or_default();
        self.by_language
            .get(&tag)
            .or_else(|| self.by_language.get(primary))
            .unwrap_or(&self.shared)
    }
}

fn warn_unused(notes: Vec<String>) {
    for note in notes {
        tracing::warn!("Voice-command word dropped: {note}.");
    }
}

/// "adds approve 2, reject 1; removes reject 1", or nothing for an empty
/// table.
fn summary(lists: &VoiceCommandWordLists) -> Option<String> {
    let counts = |of: &dyn Fn(&str) -> usize| {
        VoiceCommandWordLists::NAMES
            .iter()
            .map(|name| (*name, of(name)))
            .filter(|(_, count)| *count > 0)
            .map(|(name, count)| format!("{name} {count}"))
            .collect::<Vec<_>>()
    };
    let added = counts(&|name| lists.list(name).map_or(0, Vec::len));
    let removed = counts(&|name| lists.remove.list(name).map_or(0, Vec::len));
    let mut parts = Vec::new();
    if !added.is_empty() {
        parts.push(format!("adds {}", added.join(", ")));
    }
    if !removed.is_empty() {
        parts.push(format!("removes {}", removed.join(", ")));
    }
    (!parts.is_empty()).then(|| parts.join("; "))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_configurable_list_has_a_base() {
        for name in VoiceCommandWordLists::NAMES {
            let (_, base) = base(name).unwrap_or_else(|| panic!("no base for {name}"));
            assert!(!base.is_empty(), "{name}");
        }
    }

    #[test]
    fn without_configuration_every_card_gets_the_base() {
        let words = CommandWordsByLanguage::default();
        assert!(std::ptr::eq(
            words.for_language("fr"),
            words.for_language("de")
        ));
        assert_eq!(
            words.for_language("de").approve,
            CommandWords::base().approve
        );
    }
}
