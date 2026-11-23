//! The lists the rules match with, built once per language at startup: the
//! built-in German and English base in `rules.rs`, with what a language
//! package adds for German, English and the card's language.
//! People mix German and English, so their words count on every card.
//! A few words stay in the rules' code because they shape a rule rather than
//! fill a list: "ne"/"noe"/"doch", "aber"/"but", "take", the copula words,
//! "nicht ändern", a final "so"/"then", "rest", "ueberspr"/"skip" and "um".

use super::phrase::{ConfirmationPhrase, PhraseNote, built_in_phrases, word_syllables};
use super::rules::{self, words_of};
use erato_config::confirmation_phrases::{ConfirmationPhraseConfig, ConfirmationPhrasesByLanguage};
use erato_config::language_words::{WordLists, added_summary, by_tag, merge_word_list};
use erato_config::voice_command_words::{VoiceCommandWordLists, VoiceCommandWordsByLanguage};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::{Arc, LazyLock};

/// The languages whose words count on every card.
pub(super) const SHARED_LANGUAGES: [&str; 2] = ["de", "en"];

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    /// Single words: an entry of several words is dropped.
    Word,
    /// Phrases compared whole.
    Phrase,
}

/// The lists a language package can add to, with their built-in base. No
/// list can be shortened, and the other lists stay the built-in ones in
/// `rules.rs` ([`FixedWords`]).
const CONFIGURABLE: &[(&str, Kind, &[&str])] = {
    use Kind::{Phrase, Word};
    use rules::*;
    &[
        ("approve", Phrase, APPROVE),
        ("reject", Phrase, REJECT),
        ("stop", Phrase, STOP),
        ("skip", Phrase, SKIP),
        ("repeat", Phrase, REPEAT),
        ("hesitations", Word, HESITATIONS),
        ("fillers", Word, FILLER_WORDS),
        ("negations", Word, NEGATIONS),
        ("conditions", Word, CONDITIONS),
        ("wh_words", Word, WH_WORDS),
        ("question_first", Word, QUESTION_FIRST),
        ("question_verbs", Word, QUESTION_VERBS),
        ("continuations", Word, CONTINUATIONS),
        ("leading_no", Word, LEADING_NO),
        ("yes_particles", Word, YES_PARTICLES),
        ("casual_approvals", Phrase, CASUAL_APPROVALS),
    ]
};

/// The lists a refusal or stop word may be added to; it is refused
/// everywhere else, so no package can hide one.
const MAY_REFUSE: &[&str] = &["reject", "negations", "leading_no"];
const MAY_STOP: &[&str] = &["stop", "negations"];

/// Lists whose words make a sentence a question, carry it on or count as a
/// bare yes: none may take a word a built-in refusal or stop is made of
/// ("it" of "cancel it", "das" of "mach das nicht").
const NEVER_OF_A_REFUSAL: &[&str] = &[
    "question_first",
    "question_verbs",
    "continuations",
    "yes_particles",
];

fn fixed(words: &[&str]) -> Vec<String> {
    words.iter().map(|word| word.to_string()).collect()
}

fn fixed_set(words: &[&str]) -> HashSet<String> {
    words.iter().map(|word| word.to_string()).collect()
}

/// The words that carry a built-in refusal, those that stop alone, and every
/// word a built-in refusal or stop is made of. Added words never hide them.
struct Core {
    refusing: HashSet<String>,
    stopping: HashSet<String>,
    of_refusals_and_stops: HashSet<String>,
}

fn core() -> &'static Core {
    static CORE: LazyLock<Core> = LazyLock::new(|| {
        use rules::*;
        let refusing = carrying(
            &fixed(REJECT),
            &fixed_set(NOISE_WORDS),
            &fixed_set(PRONOUNS),
            &fixed_set(SUBJECTS),
            &fixed_set(REJECT_HELPERS),
        );
        let stopping = STOP
            .iter()
            .filter(|phrase| !phrase.contains(' '))
            .chain(STOP_FIRST)
            .map(|word| word.to_string())
            .collect();
        let of_refusals_and_stops = REJECT
            .iter()
            .chain(STOP)
            .chain(REFUSAL_WORDS)
            .flat_map(|phrase| words_of(phrase))
            .collect();
        Core {
            refusing,
            stopping,
            of_refusals_and_stops,
        }
    });
    &CORE
}

/// The built-in lists no package changes, built once and shared by every
/// language's [`CommandWords`].
#[derive(Debug)]
pub struct FixedWords {
    pub(super) noise_words: HashSet<String>,
    pub(super) leading_yes: HashSet<String>,
    pub(super) stop_first: HashSet<String>,
    pub(super) known_cues: Vec<Vec<String>>,
    pub(super) backchannels: HashSet<String>,
    pub(super) doubled_yes: HashSet<String>,
    pub(super) subjects: HashSet<String>,
    pub(super) personal_subjects: HashSet<String>,
    pub(super) corrections: HashSet<String>,
    pub(super) dangling: HashSet<String>,
    pub(super) rest_words: HashSet<String>,
    pub(super) known_words: HashSet<String>,
    pub(super) onward_first: HashSet<String>,
    pub(super) onward_words: HashSet<String>,
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
    pub(super) repeat_cues: Vec<Vec<String>>,
    pub(super) content_cues: Vec<Vec<String>>,
    pub(super) read_cues: Vec<Vec<String>>,
    pub(super) rest_ask: HashSet<String>,
    pub(super) rest_what: HashSet<String>,
    pub(super) generic: HashSet<String>,
    pub(super) rather: HashSet<String>,
    pub(super) rather_not: HashSet<String>,
    pub(super) already: HashSet<String>,
    pub(super) again: Vec<Vec<String>>,
    pub(super) negations_before: HashSet<String>,
    /// Besides approve phrases, acknowledgements and noise, the words an
    /// approval may hold.
    pub(super) agreement_words: HashSet<String>,
    /// Besides reject phrases and negations, the words a refusal may hold.
    pub(super) refusal_words: HashSet<String>,
    pub(super) approve_helpers: HashSet<String>,
    pub(super) reject_helpers: HashSet<String>,
}

fn fixed_words() -> &'static FixedWords {
    static FIXED: LazyLock<FixedWords> = LazyLock::new(|| {
        use rules::*;
        FixedWords {
            noise_words: fixed_set(NOISE_WORDS),
            leading_yes: fixed_set(LEADING_YES),
            stop_first: fixed_set(STOP_FIRST),
            known_cues: cue_list(KNOWN_CUES),
            backchannels: fixed_set(BACKCHANNELS),
            doubled_yes: fixed_set(DOUBLED_YES),
            subjects: fixed_set(SUBJECTS),
            personal_subjects: fixed_set(PERSONAL_SUBJECTS),
            corrections: fixed_set(CORRECTIONS),
            dangling: fixed_set(DANGLING),
            rest_words: fixed_set(REST_WORDS),
            known_words: fixed_set(KNOWN_WORDS),
            onward_first: fixed_set(ONWARD_FIRST),
            onward_words: fixed_set(ONWARD_WORDS),
            not_like_that: cues(fixed(NOT_LIKE_THAT)),
            change_anywhere: fixed_set(CHANGE_ANYWHERE),
            change_first: fixed_set(CHANGE_FIRST),
            make_first: fixed_set(MAKE_FIRST),
            make_object: fixed_set(MAKE_OBJECT),
            keep_verbs: fixed_set(KEEP_VERBS),
            keep_endings: fixed_set(KEEP_ENDINGS),
            pronouns: fixed_set(PRONOUNS),
            date_prepositions: fixed_set(DATE_PREPOSITIONS),
            date_words: fixed_set(DATE_WORDS),
            repeat_cues: cue_list(REPEAT_CUES),
            content_cues: cue_list(CONTENT_CUES),
            read_cues: cue_list(READ_CUES),
            rest_ask: fixed_set(REST_ASK),
            rest_what: fixed_set(REST_WHAT),
            generic: fixed_set(GENERIC),
            rather: fixed_set(RATHER),
            rather_not: fixed_set(RATHER_NOT),
            already: fixed_set(ALREADY),
            again: cues(fixed(AGAIN)),
            negations_before: fixed_set(NEGATIONS_BEFORE),
            agreement_words: fixed_set(AGREEMENT_WORDS),
            refusal_words: fixed_set(REFUSAL_WORDS),
            approve_helpers: fixed_set(APPROVE_HELPERS),
            reject_helpers: fixed_set(REJECT_HELPERS),
        }
    });
    &FIXED
}

/// The lists for one set of languages. The built-in lists no package
/// changes are reached through [`FixedWords`].
#[derive(Debug)]
pub struct CommandWords {
    fixed: &'static FixedWords,
    pub(super) hesitations: HashSet<String>,
    /// The hesitations and the other fillers.
    pub(super) fillers: HashSet<String>,
    pub(super) noise_phrases: HashSet<String>,
    pub(super) leading: HashSet<String>,
    pub(super) leading_no: HashSet<String>,
    pub(super) approve: HashSet<String>,
    pub(super) reject: HashSet<String>,
    pub(super) stop: HashSet<String>,
    pub(super) skip: HashSet<String>,
    pub(super) repeat: HashSet<String>,
    pub(super) negations: HashSet<String>,
    pub(super) yes_particles: HashSet<String>,
    pub(super) question_verbs: HashSet<String>,
    pub(super) wh_words: HashSet<String>,
    pub(super) continuations: HashSet<String>,
    pub(super) conditions: HashSet<String>,
    pub(super) not_like_that_alone: HashSet<String>,
    pub(super) question_first: HashSet<String>,
    /// Besides acknowledgements and noise, the words an approval may hold.
    pub(super) agreement: HashSet<String>,
    /// Words that carry the agreement itself, not just accompany it.
    pub(super) agreeing: HashSet<String>,
    pub(super) refusal: HashSet<String>,
    pub(super) refusing: HashSet<String>,
    /// The words of `stop` phrases that carry the stop, and `stop_first`.
    pub(super) stopping: HashSet<String>,
    pub(super) casual_approvals: HashSet<String>,
    /// The confirmation phrases tried: German, English, then the card
    /// language's.
    pub(super) phrases: Vec<ConfirmationPhrase>,
}

impl std::ops::Deref for CommandWords {
    type Target = FixedWords;

    fn deref(&self) -> &FixedWords {
        self.fixed
    }
}

/// Merges the configured entries of each list into its base, and notes each
/// entry it cannot use.
struct Builder<'a> {
    /// The languages in use, and whether to note their unusable entries.
    languages: &'a [(&'a str, &'a VoiceCommandWordLists, bool)],
    notes: Vec<String>,
}

/// Why an entry of a language cannot be added, if it cannot.
type Refuse<'f> = &'f dyn Fn(&str, &[String]) -> Option<&'static str>;

impl Builder<'_> {
    /// The list `name`: base and configured words. An entry `refuse` names a
    /// reason for is not added.
    fn list(&mut self, name: &str, refuse: Refuse<'_>) -> Vec<String> {
        let Some(&(_, kind, base)) = CONFIGURABLE.iter().find(|(list, ..)| *list == name) else {
            return Vec::new();
        };
        let core = core();
        let hides = |words: &[String]| {
            if !MAY_REFUSE.contains(&name) && words.iter().any(|word| core.refusing.contains(word))
            {
                Some("a refusal word is only ever added to `reject`, `negations` or `leading_no`")
            } else if !MAY_STOP.contains(&name)
                && words.iter().any(|word| core.stopping.contains(word))
            {
                Some("a stop word is only ever added to `stop` or `negations`")
            } else if NEVER_OF_A_REFUSAL.contains(&name)
                && words
                    .iter()
                    .any(|word| core.of_refusals_and_stops.contains(word))
            {
                Some("a word of a built-in refusal or stop never makes one a question or a yes")
            } else {
                None
            }
        };
        let mut added = Vec::new();
        for (language, lists, noted) in self.languages {
            for entry in lists.list(name).into_iter().flatten() {
                let words = words_of(entry);
                let problem = if words.is_empty() {
                    Some("it holds no word")
                } else if kind == Kind::Word && words.len() > 1 {
                    Some("this list holds single words")
                } else {
                    hides(&words).or_else(|| refuse(language, &words))
                };
                match problem {
                    Some(problem) if *noted => self.notes.push(format!(
                        "approval_voice_commands.words.{language}.{name}: '{entry}' is ignored: {problem}"
                    )),
                    Some(_) => {}
                    None => added.push(words.join(" ")),
                }
            }
        }
        merge_word_list(base.iter().copied(), added.iter().map(String::as_str))
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
        by_tag(language, |tag| {
            self.phrases.iter().find(|phrase| phrase.language == tag)
        })
    }

    /// The built-in German and English lists alone.
    pub fn base() -> &'static CommandWords {
        static BASE: LazyLock<CommandWords> = LazyLock::new(|| CommandWords::build(&[]).0);
        &BASE
    }

    fn build(languages: &[(&str, &VoiceCommandWordLists, bool)]) -> (Self, Vec<String>) {
        use rules::*;
        let built_in = fixed_words();
        let mut builder = Builder {
            languages,
            notes: Vec::new(),
        };
        let any = |_: &str, _: &[String]| -> Option<&'static str> { None };
        let mut list = |name: &str| builder.list(name, &any);
        // The lists the guards and decisions rely on come first: what is
        // added elsewhere is checked against them.
        let negations = list("negations");
        let conditions = list("conditions");
        let wh_words = list("wh_words");
        let question_first = list("question_first");
        let question_verbs = list("question_verbs");
        let continuations = list("continuations");
        let leading_no = list("leading_no");
        let question: HashSet<String> = wh_words.iter().chain(&question_first).cloned().collect();
        let reject = list("reject");
        let stop = list("stop");
        let guard: HashSet<String> = negations.iter().chain(&conditions).cloned().collect();
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
        let yes_particles = builder.list("yes_particles", &|_, words| agreeing_problem(words));
        let approve = builder.list("approve", &|_, words| agreeing_problem(words));
        // Dropped and trimmed words are invisible to every guard and
        // decision, so none of theirs, and no date, time or correction
        // word, may become one.
        let relied_on: HashSet<String> = [
            &negations,
            &conditions,
            &continuations,
            &question_verbs,
            &leading_no,
            &yes_particles,
        ]
        .into_iter()
        .flatten()
        .cloned()
        .chain(question.iter().cloned())
        .chain(
            [
                LEADING_YES,
                BACKCHANNELS,
                DOUBLED_YES,
                REFUSAL_WORDS,
                STOP_FIRST,
                APPROVE_HELPERS,
                REJECT_HELPERS,
                SUBJECTS,
                NOISE_WORDS,
                DATE_WORDS,
                DATE_PREPOSITIONS,
                CORRECTIONS,
                MAKE_OBJECT,
                CHANGE_ANYWHERE,
                CHANGE_FIRST,
            ]
            .into_iter()
            .flatten()
            .map(|word| word.to_string()),
        )
        .chain(
            reject
                .iter()
                .chain(&stop)
                .flat_map(|phrase| words_of(phrase)),
        )
        .collect();
        let filler_problem = |words: &[String]| {
            agreeing_problem(words).or_else(|| {
                any_in(
                    words,
                    &relied_on,
                    "a word the guards or decisions rely on is never dropped as a filler",
                )
            })
        };
        // Trimmed around the confirmation phrase, so only a short sound.
        let hesitations = builder.list("hesitations", &|language, words| {
            filler_problem(words).or_else(|| {
                words
                    .iter()
                    .any(|word| word_syllables(word, language) != Some(1))
                    .then_some("a hesitation is one short sound of at most one vowel group")
            })
        });
        let filler_words = builder.list("fillers", &|_, words| filler_problem(words));
        let mut list = |name: &str| builder.list(name, &any);
        let skip = list("skip");
        let repeat = list("repeat");
        let casual_approvals = list("casual_approvals");
        let leading_no = set(leading_no);
        let leading: HashSet<String> = fixed_set(LEADING)
            .into_iter()
            .chain(leading_no.iter().cloned())
            .collect();
        let fillers: HashSet<String> = hesitations.iter().chain(&filler_words).cloned().collect();
        let phrases = |list: &[String]| -> HashSet<String> {
            list.iter()
                .map(|phrase| drop_fillers(&words_of(phrase), &fillers, &built_in.again).join(" "))
                .collect()
        };
        let yes_particles = set(yes_particles);
        let negations = set(negations);
        let agreement = approve
            .iter()
            .flat_map(|phrase| words_of(phrase))
            .chain(built_in.agreement_words.iter().cloned())
            .chain(built_in.noise_words.iter().cloned())
            .chain(
                leading
                    .iter()
                    .filter(|word| !leading_no.contains(*word))
                    .cloned(),
            )
            .collect();
        // A reject phrase's own words always count; a yes besides them
        // never does ("ja nee").
        let refusal = reject
            .iter()
            .flat_map(|phrase| words_of(phrase))
            .chain(
                built_in
                    .refusal_words
                    .iter()
                    .chain(&negations)
                    .chain(&built_in.noise_words)
                    .chain(
                        leading
                            .iter()
                            .filter(|word| !built_in.leading_yes.contains(*word)),
                    )
                    .filter(|word| !yes_particles.contains(*word))
                    .cloned(),
            )
            .collect();
        let agreeing = carrying(
            &approve,
            &built_in.noise_words,
            &built_in.pronouns,
            &built_in.subjects,
            &built_in.approve_helpers,
        );
        let refusing = carrying(
            &reject,
            &built_in.noise_words,
            &built_in.pronouns,
            &built_in.subjects,
            &built_in.reject_helpers,
        );
        let stopping = carrying(
            &stop,
            &built_in.noise_words,
            &built_in.pronouns,
            &built_in.subjects,
            &HashSet::new(),
        )
        .into_iter()
        .chain(built_in.stop_first.iter().cloned())
        .collect();
        let casual_approvals = phrases(&casual_approvals);
        let words = CommandWords {
            fixed: built_in,
            noise_phrases: phrases(&fixed(NOISE_PHRASES)),
            approve: phrases(&approve),
            reject: phrases(&reject),
            stop: phrases(&stop),
            skip: phrases(&skip),
            repeat: phrases(&repeat),
            not_like_that_alone: phrases(&fixed(NOT_LIKE_THAT_ALONE)),
            hesitations: set(hesitations),
            fillers,
            leading,
            leading_no,
            negations,
            yes_particles,
            question_verbs: set(question_verbs),
            wh_words: set(wh_words),
            continuations: set(continuations),
            conditions: set(conditions),
            question_first: set(question_first),
            agreement,
            agreeing,
            refusal,
            refusing,
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
    /// or phrase that cannot be used and logging what each language adds
    /// and every phrase in use, built-in ones included.
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
            if let Some(summary) = added_summary(&config[language]) {
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
                    true,
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
            // The German and English checks hear no yes or casual approval
            // of another language: its own words must be there to check it.
            let own_words = |of: fn(&CommandWords) -> &HashSet<String>| {
                of(&words).difference(of(&shared)).next().is_some()
            };
            let knows_language = own_words(|words| &words.yes_particles)
                && own_words(|words| &words.casual_approvals);
            if let Some(phrase) = phrase.and_then(|phrase| {
                ConfirmationPhrase::checked(
                    language,
                    phrase,
                    &words,
                    knows_language,
                    &mut phrase_notes,
                )
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
        by_tag(language, |tag| self.by_language.get(tag)).unwrap_or(&self.shared)
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

    /// Drops each wait line or tool line that the card rules would hear as a
    /// decision on a card that has asked, or that is a confirmation phrase:
    /// the voice must never say what the user says to decide.
    pub fn check_wait_lines(
        &self,
        wait_lines: &mut erato_config::wait_lines::WaitLinesConfig,
    ) -> Vec<String> {
        wait_lines.drop_lines_where(|language, line| {
            let words = self.for_language(language);
            if super::phrase::match_phrase(line, words).is_some() {
                return Some("it is a confirmation phrase".to_string());
            }
            super::corpus::asked_cards(language)
                .into_iter()
                .find_map(|card| {
                    let input = super::VoiceCommandInput {
                        transcript: line,
                        language,
                        pieces: &card.pieces,
                        current_piece_id: Some(&card.current_piece_id),
                        question: None,
                    };
                    let meaning = super::classify_by_rules(&input, words)?.command.meaning;
                    meaning.is_decision().then_some(meaning)
                })
                .map(|meaning| format!("it sounds like a decision ({})", meaning.wire_name()))
        })
    }

    /// Drops each per-language turn-end hesitation that is not one word of
    /// letters, or that is a negation, condition or question word of German,
    /// English or that language, with a warning for each. Then notes the
    /// sounds that hold a turn but are not trimmed before a confirmation
    /// phrase, for the languages whose cards have one: only a card's own
    /// checked `hesitations` are trimmed.
    pub fn check_turn_hesitations(
        &self,
        audio: &mut erato_config::config::AudioConversationalConfig,
    ) -> (Vec<String>, Vec<String>) {
        let mut warnings = Vec::new();
        for (language, list) in &mut audio.hesitations {
            let words = self.for_language(language);
            list.retain(|word| {
                let place =
                    format!("`audio_conversational.hesitations.{language}` entry {word:?} dropped");
                let problem = if word.trim().is_empty() || !word.trim().chars().all(char::is_alphabetic)
                {
                    Some("it must be one word of letters")
                } else if words.decides_meaning(word.trim()) {
                    Some("it is a negation, condition or question word, which is never only a hesitation")
                } else {
                    None
                };
                if let Some(problem) = problem {
                    warnings.push(format!("{place}: {problem}."));
                }
                problem.is_none()
            });
            for word in list.iter_mut() {
                *word = word.trim().to_lowercase();
            }
        }
        warnings.sort();
        let mut notes = Vec::new();
        let mut note = |place: String, entries: &[String], language: &str| {
            let words = self.for_language(language);
            if words.phrase_of(language).is_none() {
                return;
            }
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
        note(
            "audio_conversational.hesitation_words".to_string(),
            &audio.hesitation_words,
            "de",
        );
        let mut languages: Vec<_> = audio.hesitations.iter().collect();
        languages.sort();
        for (language, entries) in languages {
            note(
                format!("audio_conversational.hesitations.{language}"),
                entries,
                language,
            );
        }
        (warnings, notes)
    }
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
    fn a_wait_line_that_sounds_like_a_decision_is_dropped() {
        let mut wait_lines = erato_config::wait_lines::WaitLinesConfig::default();
        wait_lines.phrases.insert(
            "de".into(),
            erato_config::wait_lines::WaitLinePhrasesConfig {
                opener: Some(
                    [
                        "Moment …",
                        "Ich bestätige.",
                        "Nein.",
                        "Passt.",
                        "Ich schaue nach.",
                    ]
                    .map(String::from)
                    .to_vec(),
                ),
                ..Default::default()
            },
        );
        wait_lines.tools.insert(
            "de".into(),
            erato_config::wait_lines::WaitLineToolsConfig {
                search: Some("Ich suche nach {search}.".into()),
                items: Some("Ja.".into()),
                list: None,
                server: None,
            },
        );
        let dropped = CommandWordsByLanguage::default().check_wait_lines(&mut wait_lines);
        assert_eq!(
            wait_lines.phrases["de"].opener.as_deref().unwrap(),
            ["Moment …", "Ich schaue nach."],
            "{dropped:#?}"
        );
        assert_eq!(
            wait_lines.tools["de"].search.as_deref(),
            Some("Ich suche nach {search}.")
        );
        assert_eq!(wait_lines.tools["de"].items, None);
        assert_eq!(dropped.len(), 4, "{dropped:#?}");
    }

    /// The lines of the `erato-wait-lines` configuration package.
    #[test]
    fn the_wait_lines_package_keeps_every_line() {
        let mut wait_lines: erato_config::wait_lines::WaitLinesConfig =
            serde_json::from_value(serde_json::json!({
                "phrases": {
                    "de": {
                        "opener": ["Einen Moment.", "Alles klar, einen Moment.", "Moment, ich kümmere mich darum."],
                        "opener_short": ["Moment.", "Okay, Moment."],
                        "still": ["Ich bin noch dran.", "Ich bin noch dabei.", "Ich arbeite noch daran."],
                        "long": [
                            "Das dauert gerade etwas länger.",
                            "Das braucht diesmal etwas länger. Ich bin weiter dran.",
                            "Das dauert noch etwas, ich bin noch dabei."
                        ]
                    },
                    "en": {
                        "opener": ["One moment.", "Okay, one moment.", "Sure, I'm on it."],
                        "opener_short": ["One moment.", "Okay."],
                        "still": ["Still on it.", "I'm still working on it.", "Still working on this."],
                        "long": [
                            "This is taking a bit longer.",
                            "This one's taking a little longer. Still on it.",
                            "Bear with me, this is taking a while."
                        ]
                    }
                },
                "tools": {
                    "de": {
                        "search": "Ich suche nach {search}.",
                        "items": "Ich sehe mir {table} an.",
                        "list": "Ich sehe mir die {table} an."
                    },
                    "en": {
                        "search": "Searching for {search}.",
                        "items": "Looking at {table}.",
                        "list": "Looking at the {table}."
                    }
                }
            }))
            .unwrap();
        let before = wait_lines.clone();
        let dropped = CommandWordsByLanguage::default().check_wait_lines(&mut wait_lines);
        assert!(dropped.is_empty(), "{dropped:#?}");
        assert_eq!(wait_lines, before);
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
