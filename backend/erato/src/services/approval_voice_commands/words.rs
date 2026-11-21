//! The lists the rules match with, built once per language at startup: the
//! built-in German and English base in `rules.rs`, with what a language
//! package adds or removes for German, English and the card's language.
//! People mix German and English, so their words count on every card.
//! A few words stay in the rules' code because they shape a rule rather than
//! fill a list: "ne"/"noe"/"doch", "aber"/"but", "take", the copula words,
//! "nicht ändern", a final "so"/"then", "rest", "ueberspr"/"skip" and "um".

use super::phrase::{ConfirmationPhrase, PhraseNote, built_in_phrases};
use super::rules::{self, words_of};
use erato_config::confirmation_phrases::{ConfirmationPhraseConfig, ConfirmationPhrasesByLanguage};
use erato_config::language_words::{WordLists, merge_word_list};
use erato_config::voice_command_words::{VoiceCommandWordLists, VoiceCommandWordsByLanguage};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::{Arc, LazyLock};

/// The languages whose words count on every card.
const SHARED_LANGUAGES: [&str; 2] = ["de", "en"];

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    /// Single words: an entry of several words is dropped.
    Word,
    /// Phrases compared whole.
    Phrase,
}

/// The lists a language package can add to, with their built-in base. The
/// other lists stay the built-in ones in `rules.rs`.
const CONFIGURABLE: &[(&str, Kind, &[&str])] = {
    use Kind::{Phrase, Word};
    use rules::*;
    &[
        ("approve", Phrase, APPROVE),
        ("reject", Phrase, REJECT),
        ("refusal_words", Word, REFUSAL_WORDS),
        ("stop", Phrase, STOP),
        ("stop_first", Word, STOP_FIRST),
        ("skip", Phrase, SKIP),
        ("repeat", Phrase, REPEAT),
        ("hesitations", Word, HESITATIONS),
        ("fillers", Word, FILLER_WORDS),
        ("negations", Word, NEGATIONS),
        ("conditions", Word, CONDITIONS),
        ("wh_words", Word, WH_WORDS),
        ("yes_particles", Word, YES_PARTICLES),
        ("noise_words", Word, NOISE_WORDS),
        ("approve_helpers", Word, APPROVE_HELPERS),
        ("reject_helpers", Word, REJECT_HELPERS),
        ("casual_approvals", Phrase, CASUAL_APPROVALS),
    ]
};

/// The lists a refusal or stop word may be added to; it is refused
/// everywhere else, so no package can hide one.
const MAY_REFUSE: &[&str] = &["reject", "refusal_words", "negations"];
const MAY_STOP: &[&str] = &["stop", "stop_first", "negations"];

fn fixed(words: &[&str]) -> Vec<String> {
    words.iter().map(|word| word.to_string()).collect()
}

/// The words that carry a built-in refusal, and those that stop alone.
/// Added words never hide them.
fn refusal_and_stop_core() -> &'static (HashSet<String>, HashSet<String>) {
    static CORE: LazyLock<(HashSet<String>, HashSet<String>)> = LazyLock::new(|| {
        use rules::*;
        let set = |words: &[&str]| -> HashSet<String> { fixed(words).into_iter().collect() };
        let refusing = carrying(
            &fixed(REJECT),
            &set(NOISE_WORDS),
            &set(PRONOUNS),
            &set(SUBJECTS),
            &set(REJECT_HELPERS),
        );
        let stopping = STOP
            .iter()
            .filter(|phrase| !phrase.contains(' '))
            .chain(STOP_FIRST)
            .map(|word| word.to_string())
            .collect();
        (refusing, stopping)
    });
    &CORE
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
    /// `agreement_words` alone.
    pub(super) agreement_words: HashSet<String>,
    /// `refusal_words` alone.
    pub(super) refusal_words: HashSet<String>,
    /// The words of `stop` phrases that carry the stop, and `stop_first`.
    pub(super) stopping: HashSet<String>,
    pub(super) casual_approvals: HashSet<String>,
    /// The confirmation phrases tried: German, English, then the card
    /// language's.
    pub(super) phrases: Vec<ConfirmationPhrase>,
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
        let Some(&(_, kind, base)) = CONFIGURABLE.iter().find(|(list, ..)| *list == name) else {
            return Vec::new();
        };
        let (refusing, stopping) = refusal_and_stop_core();
        let hides = |words: &[String]| {
            if !MAY_REFUSE.contains(&name) && words.iter().any(|word| refusing.contains(word)) {
                Some(
                    "a refusal word is only ever added to `reject`, `refusal_words` or `negations`",
                )
            } else if !MAY_STOP.contains(&name) && words.iter().any(|word| stopping.contains(word))
            {
                Some("a stop word is only ever added to `stop`, `stop_first` or `negations`")
            } else {
                None
            }
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
                    hides(&words).or_else(|| refuse(&words))
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
            base.iter().copied(),
            added.iter().map(String::as_str),
            &removed,
        )
    }
}

fn set(list: Vec<String>) -> HashSet<String> {
    list.into_iter().collect()
}

fn cue_list(cues: &[&[&str]]) -> Vec<Vec<String>> {
    cues.iter().map(|cue| fixed(cue)).collect()
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

    /// A noise, hesitation, filler, listening, yes, agreement or leading
    /// word: said without meaning to approve.
    pub(super) fn is_quiet(&self, word: &str) -> bool {
        self.noise_words.contains(word)
            || self.fillers.contains(word)
            || self.backchannels.contains(word)
            || self.yes_particles.contains(word)
            || self.agreement_words.contains(word)
            || self.leading.contains(word)
    }

    /// A quiet word that neither says no nor carries the sentence on: the
    /// only kind that may stand before or after a confirmation phrase.
    pub(super) fn may_surround_phrase(&self, word: &str) -> bool {
        self.is_quiet(word) && !self.leading_no.contains(word) && !self.continuations.contains(word)
    }

    /// A word that carries a stop: never said with the confirmation phrase.
    pub(super) fn stops(&self, word: &str) -> bool {
        self.stopping.contains(word)
    }

    /// A word that carries a refusal, or one a refusal holds and an approval
    /// does not: never said with the confirmation phrase.
    pub(super) fn refuses(&self, word: &str) -> bool {
        self.refusing.contains(word)
            || self.reject.contains(word)
            || (self.refusal_words.contains(word)
                && !self.agreement_words.contains(word)
                && !self.fillers.contains(word)
                && !self.pronouns.contains(word)
                && !self.subjects.contains(word))
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

    /// The phrase of `language` ("fr", "fr-CA", …) itself, if it has one.
    pub fn phrase_of(&self, language: &str) -> Option<&ConfirmationPhrase> {
        let tag = language.trim().to_ascii_lowercase().replace('_', "-");
        let primary = tag.split('-').next().unwrap_or_default();
        self.phrases
            .iter()
            .find(|phrase| phrase.language == tag)
            .or_else(|| {
                self.phrases
                    .iter()
                    .find(|phrase| phrase.language == primary)
            })
    }

    /// The built-in German and English lists alone.
    pub fn base() -> &'static CommandWords {
        static BASE: LazyLock<CommandWords> = LazyLock::new(|| CommandWords::build(&[]).0);
        &BASE
    }

    fn build(languages: &[(&str, &VoiceCommandWordLists, bool)]) -> (Self, Vec<String>) {
        use rules::*;
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
        let wh_words = list("wh_words");
        let question = set([wh_words.clone(), fixed(QUESTION_FIRST)].concat());
        let subjects = set(fixed(SUBJECTS));
        let reject = list("reject");
        let refusal_words = list("refusal_words");
        let stop = list("stop");
        let stop_first = list("stop_first");
        let relied_on: HashSet<String> = [
            negations.clone(),
            conditions.clone(),
            fixed(CONTINUATIONS),
            fixed(QUESTION_VERBS),
            fixed(LEADING_YES),
            fixed(LEADING_NO),
            fixed(BACKCHANNELS),
            fixed(DOUBLED_YES),
            refusal_words.clone(),
            stop_first.clone(),
            fixed(APPROVE_HELPERS),
            fixed(REJECT_HELPERS),
        ]
        .into_iter()
        .flatten()
        .chain(question.iter().cloned())
        .chain(subjects.iter().cloned())
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
        let mut agreeing_list = |name: &str| builder.list(name, &agreeing_problem);
        let yes_particles = agreeing_list("yes_particles");
        let approve = agreeing_list("approve");
        let noise_words = agreeing_list("noise_words");
        let approve_helpers = set(agreeing_list("approve_helpers"));
        let reject_helpers = set(builder.list("reject_helpers", &any));
        let relied_on: HashSet<String> = relied_on
            .into_iter()
            .chain(yes_particles.iter().cloned())
            .chain(noise_words.iter().cloned())
            .chain(approve_helpers.iter().cloned())
            .chain(reject_helpers.iter().cloned())
            .collect();
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
        let hesitations = builder.list("hesitations", &filler_problem);
        let filler_words = builder.list("fillers", &filler_problem);
        let mut list = |name: &str| builder.list(name, &any);
        let skip = list("skip");
        let repeat = list("repeat");
        let casual_approvals = list("casual_approvals");
        let leading = fixed(LEADING);
        let again = cues(fixed(AGAIN));
        let fillers: HashSet<String> = hesitations.iter().chain(&filler_words).cloned().collect();
        let phrases = |list: &[String]| -> HashSet<String> {
            list.iter()
                .map(|phrase| drop_fillers(&words_of(phrase), &fillers, &again).join(" "))
                .collect()
        };
        let noise_words = set(noise_words);
        let leading_no_set = set(fixed(LEADING_NO));
        let leading_yes_set = set(fixed(LEADING_YES));
        let yes_particles = set(yes_particles);
        let negations = set(negations);
        let pronouns = set(fixed(PRONOUNS));
        let agreement_words = set(fixed(AGREEMENT_WORDS));
        let agreement = approve
            .iter()
            .flat_map(|phrase| words_of(phrase))
            .chain(agreement_words.iter().cloned())
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
            .chain(refusal_words.iter().cloned())
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
        let stop_first = set(stop_first);
        let stopping = carrying(&stop, &noise_words, &pronouns, &subjects, &HashSet::new())
            .into_iter()
            .chain(stop_first.iter().cloned())
            .collect();
        let casual_approvals = phrases(&casual_approvals);
        let words = CommandWords {
            noise_phrases: phrases(&fixed(NOISE_PHRASES)),
            approve: phrases(&approve),
            reject: phrases(&reject),
            stop: phrases(&stop),
            skip: phrases(&skip),
            repeat: phrases(&repeat),
            not_like_that_alone: phrases(&fixed(NOT_LIKE_THAT_ALONE)),
            hesitations: set(hesitations),
            fillers,
            noise_words,
            leading: set(leading),
            leading_yes: leading_yes_set,
            leading_no: leading_no_set,
            stop_first,
            known_cues: cue_list(KNOWN_CUES),
            negations,
            backchannels: set(fixed(BACKCHANNELS)),
            yes_particles,
            doubled_yes: set(fixed(DOUBLED_YES)),
            question_verbs: set(fixed(QUESTION_VERBS)),
            subjects,
            wh_words: set(wh_words),
            personal_subjects: set(fixed(PERSONAL_SUBJECTS)),
            corrections: set(fixed(CORRECTIONS)),
            dangling: set(fixed(DANGLING)),
            rest_words: set(fixed(REST_WORDS)),
            known_words: set(fixed(KNOWN_WORDS)),
            onward_first: set(fixed(ONWARD_FIRST)),
            onward_words: set(fixed(ONWARD_WORDS)),
            continuations: set(fixed(CONTINUATIONS)),
            conditions,
            not_like_that: cues(fixed(NOT_LIKE_THAT)),
            change_anywhere: set(fixed(CHANGE_ANYWHERE)),
            change_first: set(fixed(CHANGE_FIRST)),
            make_first: set(fixed(MAKE_FIRST)),
            make_object: set(fixed(MAKE_OBJECT)),
            keep_verbs: set(fixed(KEEP_VERBS)),
            keep_endings: set(fixed(KEEP_ENDINGS)),
            pronouns,
            date_prepositions: set(fixed(DATE_PREPOSITIONS)),
            date_words: set(fixed(DATE_WORDS)),
            question_first: set(fixed(QUESTION_FIRST)),
            repeat_cues: cue_list(REPEAT_CUES),
            read_cues: cue_list(READ_CUES),
            rest_ask: set(fixed(REST_ASK)),
            rest_what: set(fixed(REST_WHAT)),
            generic: set(fixed(GENERIC)),
            rather: set(fixed(RATHER)),
            rather_not: set(fixed(RATHER_NOT)),
            already: set(fixed(ALREADY)),
            again,
            negations_before: set(fixed(NEGATIONS_BEFORE)),
            agreement,
            agreeing,
            refusal,
            refusing,
            agreement_words,
            refusal_words: set(refusal_words),
            stopping,
            casual_approvals,
            phrases: built_in_phrases().to_vec(),
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
        Self::build(
            &VoiceCommandWordsByLanguage::new(),
            &ConfirmationPhrasesByLanguage::new(),
        )
        .0
    }
}

impl CommandWordsByLanguage {
    /// Builds every language's lists once, warning for each configured entry
    /// or phrase that cannot be used and logging what each language adds or
    /// removes and every phrase in use, built-in ones included.
    pub fn from_config(
        config: &VoiceCommandWordsByLanguage,
        phrases: &ConfirmationPhrasesByLanguage,
    ) -> Self {
        let mut languages: Vec<&String> = config.keys().collect();
        languages.sort();
        for language in languages {
            crate::server::api::v1beta::me_profile_middleware::warn_unreachable_voice_language(
                "Voice-command words",
                language,
            );
            if let Some(summary) = summary(&config[language]) {
                tracing::info!("Voice-command words for `{language}`: {summary}.");
            }
        }
        let mut phrase_languages: Vec<&String> = phrases.keys().collect();
        phrase_languages.sort();
        for language in phrase_languages {
            crate::server::api::v1beta::me_profile_middleware::warn_unreachable_voice_language(
                "Confirmation phrase",
                language,
            );
        }
        let (built, notes, phrase_notes) = Self::build_noted(config, phrases);
        for note in notes {
            tracing::warn!("Voice-command word dropped: {note}.");
        }
        for note in phrase_notes {
            tracing::warn!("{}", note.log_line());
        }
        for (language, phrases) in built.shown_phrases_by_card_language() {
            tracing::info!("Confirmation phrases on `{language}` cards: {phrases}.");
        }
        built
    }

    /// [`Self::from_config`] without logging: the lists, and a note for each
    /// entry or phrase that cannot be used.
    pub fn build(
        config: &VoiceCommandWordsByLanguage,
        phrases: &ConfirmationPhrasesByLanguage,
    ) -> (Self, Vec<String>) {
        let (built, mut notes, phrase_notes) = Self::build_noted(config, phrases);
        notes.extend(phrase_notes.iter().map(|note| note.text().to_string()));
        notes.sort();
        notes.dedup();
        (built, notes)
    }

    /// The lists, the notes on configured words and those on phrases.
    fn build_noted(
        config: &VoiceCommandWordsByLanguage,
        phrases: &ConfirmationPhrasesByLanguage,
    ) -> (Self, Vec<String>, Vec<PhraseNote>) {
        let mut phrase_notes = Vec::new();
        let mut languages: Vec<(&String, &VoiceCommandWordLists)> = config.iter().collect();
        languages.sort_by(|a, b| a.0.cmp(b.0));
        let shared_languages: Vec<(&str, &VoiceCommandWordLists, bool)> = languages
            .iter()
            .filter(|(language, _)| SHARED_LANGUAGES.contains(&language.as_str()))
            .map(|(language, lists)| (language.as_str(), *lists, true))
            .collect();
        let (mut shared, mut all_notes) = CommandWords::build(&shared_languages);
        // A configured German or English phrase replaces the built-in one;
        // one that fails the check leaves the built-in one in place.
        let replacing: Vec<(usize, ConfirmationPhrase)> = shared
            .phrases
            .iter()
            .enumerate()
            .filter_map(|(at, phrase)| {
                let configured = phrases.get(&phrase.language)?;
                ConfirmationPhrase::checked(
                    &phrase.language,
                    configured,
                    &shared,
                    &mut phrase_notes,
                )
                .map(|checked| (at, checked))
            })
            .collect();
        for (at, phrase) in replacing {
            shared.phrases[at] = phrase;
        }
        let shared_phrases = shared.phrases.clone();
        let empty = VoiceCommandWordLists::default();
        let mut own: Vec<(
            &str,
            &VoiceCommandWordLists,
            Option<&ConfirmationPhraseConfig>,
        )> = languages
            .iter()
            .filter(|(language, _)| !SHARED_LANGUAGES.contains(&language.as_str()))
            .map(|(language, lists)| (language.as_str(), *lists, phrases.get(*language)))
            .collect();
        let mut phrase_only: Vec<&String> = phrases
            .keys()
            .filter(|language| {
                !SHARED_LANGUAGES.contains(&language.as_str()) && !config.contains_key(*language)
            })
            .collect();
        phrase_only.sort();
        own.extend(
            phrase_only
                .into_iter()
                .map(|language| (language.as_str(), &empty, phrases.get(language))),
        );
        let mut by_language = HashMap::new();
        for (language, lists, phrase) in own {
            let mut active: Vec<(&str, &VoiceCommandWordLists, bool)> = shared_languages
                .iter()
                .map(|(language, lists, _)| (*language, *lists, false))
                .collect();
            active.push((language, lists, true));
            let (mut words, notes) = CommandWords::build(&active);
            all_notes.extend(notes);
            words.phrases = shared_phrases.clone();
            if let Some(phrase) = phrase.and_then(|phrase| {
                ConfirmationPhrase::checked(language, phrase, &words, &mut phrase_notes)
            }) {
                words.phrases.push(phrase);
            }
            by_language.insert(language.to_string(), Arc::new(words));
        }
        all_notes.sort();
        all_notes.dedup();
        phrase_notes.sort_by(|a, b| a.text().cmp(b.text()));
        phrase_notes.dedup();
        (
            Self {
                shared: Arc::new(shared),
                by_language,
            },
            all_notes,
            phrase_notes,
        )
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

    /// The phrase each language approves with, as shown: German, English
    /// and each configured language that has one.
    pub fn shown_phrases(&self) -> BTreeMap<String, String> {
        self.shared
            .phrases
            .iter()
            .chain(self.by_language.values().flat_map(|words| &words.phrases))
            .map(|phrase| (phrase.language.clone(), phrase.shown.clone()))
            .collect()
    }

    /// "„Ich bestätige“ (de), …" by card language, for the startup log.
    pub(super) fn shown_phrases_by_card_language(&self) -> Vec<(String, String)> {
        let said = |words: &CommandWords| {
            words
                .phrases
                .iter()
                .map(|phrase| format!("'{}' ({})", phrase.shown, phrase.language))
                .collect::<Vec<_>>()
                .join(", ")
        };
        let mut lines = vec![("de/en".to_string(), said(&self.shared))];
        let mut languages: Vec<_> = self.by_language.iter().collect();
        languages.sort_by(|a, b| a.0.cmp(b.0));
        lines.extend(languages.into_iter().map(|(language, words)| {
            // The API approves such a card on screen only.
            let shown = match words.phrase_of(language) {
                Some(_) => said(words),
                None => "none, screen only".to_string(),
            };
            (language.clone(), shown)
        }));
        lines
    }

    /// For each configured turn-end hesitation list, the sounds that hold a
    /// turn but are not trimmed before a confirmation phrase: only a card's
    /// own checked `hesitations` are.
    pub fn hesitation_notes(
        &self,
        audio: &erato_config::config::AudioConversationalConfig,
    ) -> Vec<String> {
        let mut notes = Vec::new();
        let mut check = |place: String, entries: &[String], language: &str| {
            let words = self.for_language(language);
            let untrimmed: Vec<String> = entries
                .iter()
                .filter(|entry| {
                    words_of(entry)
                        .iter()
                        .any(|word| !words.hesitations.contains(word))
                })
                .map(|entry| format!("'{entry}'"))
                .collect();
            if !untrimmed.is_empty() {
                let into = if place.ends_with(language) {
                    language
                } else {
                    "<language>"
                };
                notes.push(format!(
                    "{place}: {} only hold a turn and are not trimmed before a confirmation phrase; add them to `approval_voice_commands.words.{into}.hesitations` for that",
                    untrimmed.join(", ")
                ));
            }
        };
        check(
            "audio_conversational.hesitation_words".to_string(),
            &audio.hesitation_words,
            "de",
        );
        let mut languages: Vec<_> = audio.hesitations.iter().collect();
        languages.sort();
        for (language, entries) in languages {
            check(
                format!("audio_conversational.hesitations.{language}"),
                entries,
                language,
            );
        }
        notes
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
        let names: Vec<&str> = CONFIGURABLE.iter().map(|(name, ..)| *name).collect();
        assert_eq!(names, VoiceCommandWordLists::NAMES);
        for (name, _, base) in CONFIGURABLE {
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
