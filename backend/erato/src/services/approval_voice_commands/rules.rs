//! The plain words and short phrases, German and English together since
//! people mix them, matched without a model. A sentence the rules are not
//! sure of is left to the model; the rules never guess.

use super::{CardPiece, CardPieceRole, VoiceCommandInput, VoiceMeaning, default_text_piece};
use std::collections::HashSet;
use std::sync::LazyLock;

pub(super) struct RuleMatch {
    pub meaning: VoiceMeaning,
    pub piece_id: Option<String>,
}

/// Fillers dropped wherever they stand.
const FILLERS: &[&str] = &[
    "aeh", "aehm", "aehh", "aehhm", "oeh", "oehm", "eh", "ehm", "hm", "hmm", "hmmm", "mh", "mhm",
    "mhmm", "uh", "uhm", "uhh", "um", "umm", "erm", "bitte", "please", "mal", "doch", "einfach",
    "eben", "kurz",
];

/// A segment made only of these is listening noise.
const NOISE_WORDS: &[&str] = &[
    "okay",
    "ok",
    "oke",
    "okey",
    "okee",
    "gut",
    "aha",
    "ah",
    "ach",
    "achso",
    "so",
    "alles",
    "klar",
    "verstanden",
    "genau",
    "interessant",
    "right",
    "alright",
    "allright",
    "i",
    "see",
    "huh",
    "oh",
    "cool",
    "nice",
    "super",
    "wow",
    "aja",
    "jaja",
    "interesting",
];

const NOISE_PHRASES: &[&str] = &[
    "in ordnung",
    "uh huh",
    "i see",
    "got you",
    "ah ja",
    "ach ja",
    "aha ja",
];

/// Dropped from the start of a segment when something follows.
const LEADING: &[&str] = &[
    "okay",
    "ok",
    "oke",
    "okey",
    "okee",
    "gut",
    "aha",
    "ah",
    "ach",
    "achso",
    "alles",
    "klar",
    "verstanden",
    "genau",
    "right",
    "alright",
    "allright",
    "also",
    "so",
    "na",
    "naja",
    "well",
    "und",
    "and",
    "dann",
    "then",
    "hey",
    "oh",
    "ja",
    "jo",
    "yes",
    "yeah",
    "yep",
    "nein",
    "nee",
    "no",
    "nope",
];
const LEADING_YES: &[&str] = &["ja", "jo", "yes", "yeah", "yep"];
const LEADING_NO: &[&str] = &["nein", "nee", "no", "nope"];

const APPROVE: &[&str] = &[
    "ja",
    "jawohl",
    "ja genau",
    "ja gerne",
    "ja gern",
    "ja klar",
    "ja passt",
    "ja mach",
    "ja mach das",
    "ja mach es",
    "ja machen",
    "ja das passt",
    "mach",
    "mach das",
    "mach es",
    "machen",
    "mach das so",
    "passt",
    "passt so",
    "das passt",
    "einverstanden",
    "bin einverstanden",
    "ich bin einverstanden",
    "bestaetigt",
    "bestaetigen",
    "bestaetige",
    "ich bestaetige",
    "freigeben",
    "freigegeben",
    "genehmigt",
    "los",
    "leg los",
    "los gehts",
    "ab dafuer",
    "yes",
    "yeah",
    "yep",
    "yup",
    "sure",
    "do it",
    "yes do it",
    "go ahead",
    "go for it",
    "sounds good",
    "approve",
    "approved",
    "i approve",
    "confirm",
    "confirmed",
    "i confirm",
    "thats fine",
    "fine",
];

/// Besides the words of [`APPROVE`], acknowledgements and noise: the only
/// words an approval may have. A word outside them, even a misheard one, is
/// a doubt, and a doubt is not a decision.
const AGREEMENT_WORDS: &[&str] = &[
    "das",
    "es",
    "so",
    "ruhig",
    "gerne",
    "gern",
    "danke",
    "kannst",
    "du",
    "koennen",
    "sie",
    "ausfuehren",
    "ausfuehrt",
    "abschicken",
    "schicken",
    "schick",
    "senden",
    "send",
    "speichern",
    "save",
    "richtig",
    "stimmt",
    "prima",
    "perfekt",
    "wunderbar",
    "toll",
    "it",
    "that",
    "this",
    "looks",
    "right",
    "good",
    "great",
    "perfect",
    "correct",
    "you",
    "can",
    "thanks",
    "thank",
    "please",
    "absolutely",
    "of",
    "course",
    "jawoll",
    "selbstverstaendlich",
    "natuerlich",
];

const REJECT: &[&str] = &[
    "nein",
    "nee",
    "ne",
    "noe",
    "nein danke",
    "nein lass es",
    "nein lass das",
    "lass",
    "lass es",
    "lass das",
    "lass es sein",
    "lass das sein",
    "lass gut sein",
    "nicht machen",
    "mach das nicht",
    "mach es nicht",
    "nein mach das nicht",
    "nein nicht machen",
    "besser nicht",
    "lieber nicht",
    "auf keinen fall",
    "abbrechen",
    "abbruch",
    "brich ab",
    "ablehnen",
    "abgelehnt",
    "ich lehne ab",
    "vergiss es",
    "vergiss das",
    "no",
    "nope",
    "nah",
    "no thanks",
    "no thank you",
    "dont",
    "dont do it",
    "dont do that",
    "do not do that",
    "do not do it",
    "cancel",
    "cancel it",
    "cancel that",
    "reject",
    "rejected",
    "deny",
    "decline",
    "forget it",
    "leave it",
    "no way",
    "absolutely not",
];

const STOP: &[&str] = &[
    "stopp",
    "stop",
    "halt",
    "ruhe",
    "ruhig",
    "sei still",
    "sei ruhig",
    "still",
    "pause",
    "warte",
    "wart",
    "moment",
    "einen moment",
    "sekunde",
    "eine sekunde",
    "genug",
    "das reicht",
    "reicht",
    "schluss",
    "aufhoeren",
    "hoer auf",
    "hoer auf zu lesen",
    "hoer auf zu reden",
    "nicht weiterlesen",
    "stop talking",
    "stop reading",
    "stop it",
    "be quiet",
    "quiet",
    "shut up",
    "hush",
    "enough",
    "thats enough",
    "hold on",
    "wait",
    "wait a second",
    "wait a moment",
    "one moment",
    "one sec",
    "silence",
];
const STOP_FIRST: &[&str] = &["stopp", "stop", "halt", "ruhe"];

const SKIP: &[&str] = &[
    "weiter",
    "mach weiter",
    "weitermachen",
    "naechster",
    "naechste",
    "naechstes",
    "der naechste",
    "das naechste",
    "naechster punkt",
    "zum naechsten",
    "zum naechsten punkt",
    "ueberspringen",
    "ueberspring",
    "skip",
    "next",
    "next one",
    "schon klar",
    "got it",
    "i got it",
    "got that",
    "i got that",
    "already know",
    "move on",
    "go on",
    "carry on",
    "keep going",
    "continue",
];
/// "hab ich", "kenn ich (schon)": the user knows this piece.
const KNOWN_FIRST: &[&str] = &["hab", "habe", "kenn", "kenne", "weiss"];

const REPEAT: &[&str] = &[
    "nochmal",
    "noch mal",
    "noch einmal",
    "nochmals",
    "wiederholen",
    "wiederhole",
    "wiederhol",
    "wiederhol das",
    "wiederhole das",
    "kannst du das wiederholen",
    "sag das nochmal",
    "sags nochmal",
    "was",
    "wie",
    "wie bitte",
    "hae",
    "haeh",
    "was hast du gesagt",
    "was sagtest du",
    "wie war das",
    "was war das",
    "again",
    "repeat",
    "repeat that",
    "repeat it",
    "say that again",
    "say it again",
    "come again",
    "pardon",
    "sorry",
    "what",
    "what was that",
    "what did you say",
    "once more",
    "one more time",
];

const NEGATIONS: &[&str] = &[
    "nicht", "not", "dont", "kein", "keine", "keinen", "never", "nie", "nein", "no", "shouldnt",
    "wont", "cant", "isnt", "doesnt", "didnt", "nobody", "niemand",
];
/// A sentence ending in one of these goes on; it is not a finished decision.
const CONTINUATIONS: &[&str] = &[
    "so", "also", "und", "and", "aber", "but", "dann", "then", "well", "weil", "because", "wenn",
    "if", "ich", "i", "naja",
];
const CONDITIONS: &[&str] = &[
    "aber",
    "but",
    "wenn",
    "falls",
    "if",
    "unless",
    "sofern",
    "nur",
    "only",
    "ausser",
    "except",
    "though",
    "however",
    "jedoch",
    "allerdings",
    "vorausgesetzt",
    "provided",
    "oder",
    "or",
];

/// Words that ask for a different call wherever they stand.
const CHANGE_ANYWHERE: &[&str] = &[
    "ohne",
    "statt",
    "anstatt",
    "stattdessen",
    "sondern",
    "lieber",
    "without",
    "instead",
    "rather",
    "weglassen",
    "rausnehmen",
    "streichen",
    "entfernen",
    "aendern",
    "hinzufuegen",
    "ergaenzen",
    "verschieben",
    "korrigieren",
    "ersetzen",
];
/// Verbs that ask for a different call at the start of a segment.
const CHANGE_FIRST: &[&str] = &[
    "nimm",
    "nehm",
    "nehme",
    "nehmt",
    "aendere",
    "aender",
    "aendern",
    "setz",
    "setze",
    "stell",
    "stelle",
    "verschieb",
    "verschiebe",
    "entfern",
    "entferne",
    "streich",
    "streiche",
    "fueg",
    "fuege",
    "ersetz",
    "ersetze",
    "korrigier",
    "korrigiere",
    "trag",
    "trage",
    "change",
    "take",
    "use",
    "set",
    "add",
    "remove",
    "drop",
    "replace",
    "swap",
    "switch",
    "put",
];
/// "mach", "make": a change only with a date, a number or a preposition after.
const MAKE_FIRST: &[&str] = &["mach", "make"];
const MAKE_OBJECT: &[&str] = &[
    "am", "auf", "zum", "zur", "bis", "ab", "um", "daraus", "spaeter", "frueher", "to", "on", "at",
    "later", "earlier",
];
/// "lass X weg", "leave X as it is": keep or drop a part.
const KEEP_VERBS: &[&str] = &[
    "lass", "lasst", "lasse", "leave", "keep", "behalte", "behalt",
];
const KEEP_ENDINGS: &[&str] = &[
    "weg",
    "raus",
    "wie",
    "stehen",
    "unveraendert",
    "drin",
    "gleich",
    "as",
    "out",
    "alone",
    "unchanged",
    "same",
];
const PRONOUNS: &[&str] = &[
    "es", "das", "den", "die", "der", "sie", "ihn", "it", "that", "this", "them", "mal",
];
const DATE_PREPOSITIONS: &[&str] = &[
    "am", "auf", "zum", "zur", "den", "der", "ab", "bis", "um", "on", "to", "the", "at", "by",
];
const DATE_WORDS: &[&str] = &[
    "montag",
    "dienstag",
    "mittwoch",
    "donnerstag",
    "freitag",
    "samstag",
    "sonntag",
    "januar",
    "februar",
    "maerz",
    "april",
    "mai",
    "juni",
    "juli",
    "august",
    "september",
    "oktober",
    "november",
    "dezember",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "january",
    "february",
    "march",
    "june",
    "july",
    "october",
    "december",
];
const QUESTION_FIRST: &[&str] = &[
    "was", "wer", "wie", "wann", "wo", "warum", "ist", "hat", "kann", "hast", "habe", "gibt",
    "what", "whats", "who", "when", "where", "why", "is", "does", "do", "can", "have", "will",
];

const REPEAT_CUES: &[&[&str]] = &[
    &["nochmal"],
    &["nochmals"],
    &["noch", "mal"],
    &["noch", "einmal"],
    &["wie", "war"],
    &["was", "war"],
    &["wie", "lautet"],
    &["wie", "lautete"],
    &["wiederhol"],
    &["wiederhole"],
    &["wiederholen"],
    &["repeat"],
    &["again"],
    &["what", "was"],
    &["whats", "the"],
    &["what", "is", "the"],
    &["nicht", "verstanden"],
    &["nicht", "mitbekommen"],
    &["nicht", "gehoert"],
    &["didnt", "catch"],
    &["didnt", "get"],
    &["didnt", "hear"],
];
const READ_CUES: &[&[&str]] = &[
    &["vorlesen"],
    &["vorlest"],
    &["lies"],
    &["lese"],
    &["liest"],
    &["lest"],
    &["read"],
];
const REST_ASK: &[&str] = &["was", "what", "whats", "anything", "sonst", "und"];
const REST_WHAT: &[&str] = &[
    "noch",
    "sonst",
    "else",
    "left",
    "uebrig",
    "remaining",
    "remains",
    "ausserdem",
];

/// Words that say nothing about which piece is meant.
const GENERIC: &[&str] = &[
    "der",
    "die",
    "das",
    "den",
    "dem",
    "des",
    "ein",
    "eine",
    "einen",
    "einem",
    "einer",
    "es",
    "er",
    "sie",
    "ihn",
    "ihm",
    "mir",
    "mich",
    "uns",
    "du",
    "ich",
    "wir",
    "ihr",
    "was",
    "wie",
    "war",
    "ist",
    "sind",
    "wird",
    "werden",
    "wurde",
    "nochmal",
    "nochmals",
    "noch",
    "einmal",
    "dann",
    "und",
    "oder",
    "also",
    "so",
    "jetzt",
    "da",
    "hier",
    "mit",
    "von",
    "zu",
    "zum",
    "zur",
    "im",
    "in",
    "am",
    "an",
    "auf",
    "fuer",
    "aus",
    "vor",
    "laut",
    "ganz",
    "ganze",
    "ganzen",
    "ganzes",
    "komplett",
    "vollstaendig",
    "kannst",
    "koenntest",
    "kann",
    "koennte",
    "moechte",
    "will",
    "wuerde",
    "wuerdest",
    "gern",
    "gerne",
    "hoeren",
    "lesen",
    "lies",
    "lese",
    "liest",
    "lest",
    "vorlesen",
    "vorlest",
    "wiederhol",
    "wiederhole",
    "wiederholen",
    "sag",
    "sage",
    "sagen",
    "gesagt",
    "lautet",
    "lautete",
    "genau",
    "eigentlich",
    "text",
    "feld",
    "punkt",
    "teil",
    "nicht",
    "verstanden",
    "mitbekommen",
    "gehoert",
    "dein",
    "deine",
    "the",
    "a",
    "an",
    "it",
    "that",
    "this",
    "me",
    "us",
    "you",
    "i",
    "we",
    "my",
    "your",
    "what",
    "whats",
    "is",
    "are",
    "were",
    "be",
    "again",
    "once",
    "more",
    "one",
    "time",
    "can",
    "could",
    "would",
    "read",
    "out",
    "aloud",
    "loud",
    "whole",
    "full",
    "entire",
    "all",
    "of",
    "to",
    "for",
    "say",
    "said",
    "tell",
    "repeat",
    "about",
    "field",
    "part",
    "bit",
    "didnt",
    "catch",
    "get",
    "hear",
    "heard",
    "was",
    "wieder",
    "nur",
    "eigene",
    "ok",
    "okay",
    "hab",
    "habe",
];

fn set(words: &[&'static str]) -> HashSet<&'static str> {
    words.iter().copied().collect()
}

fn phrases(list: &[&str]) -> HashSet<String> {
    list.iter()
        .map(|phrase| drop_fillers(&words_of(phrase), &set(FILLERS)).join(" "))
        .collect()
}

/// `fillers` is passed in because the phrase lists are built before [`LISTS`].
fn drop_fillers(words: &[String], fillers: &HashSet<&'static str>) -> Vec<String> {
    let mut kept = Vec::with_capacity(words.len());
    for (index, word) in words.iter().enumerate() {
        // German "um 10" is a time and "noch mal" means again.
        let time = word == "um"
            && words
                .get(index + 1)
                .is_some_and(|next| next.starts_with(|c: char| c.is_ascii_digit()));
        let again = word == "mal" && index > 0 && words[index - 1] == "noch";
        if time || again || !fillers.contains(word.as_str()) {
            kept.push(word.clone());
        }
    }
    kept
}

struct Lists {
    fillers: HashSet<&'static str>,
    noise_words: HashSet<&'static str>,
    noise_phrases: HashSet<String>,
    leading: HashSet<&'static str>,
    approve: HashSet<String>,
    reject: HashSet<String>,
    stop: HashSet<String>,
    skip: HashSet<String>,
    repeat: HashSet<String>,
    generic: HashSet<&'static str>,
    agreement: HashSet<String>,
}

static LISTS: LazyLock<Lists> = LazyLock::new(|| Lists {
    fillers: set(FILLERS),
    noise_words: set(NOISE_WORDS),
    noise_phrases: phrases(NOISE_PHRASES),
    leading: set(LEADING),
    approve: phrases(APPROVE),
    reject: phrases(REJECT),
    stop: phrases(STOP),
    skip: phrases(SKIP),
    repeat: phrases(REPEAT),
    generic: set(GENERIC),
    agreement: APPROVE
        .iter()
        .flat_map(|phrase| words_of(phrase))
        .chain(
            AGREEMENT_WORDS
                .iter()
                .chain(NOISE_WORDS)
                .chain(LEADING)
                .map(|word| word.to_string()),
        )
        .collect(),
});

/// Lower case, umlauts folded, apostrophes dropped, an ordinal's dot kept
/// with its number.
fn fold(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut previous_digit = false;
    for c in text.chars() {
        match c {
            '\'' | '’' | '`' | '´' => {}
            '.' if previous_digit => {}
            c => {
                for lower in c.to_lowercase() {
                    match lower {
                        'ä' => out.push_str("ae"),
                        'ö' => out.push_str("oe"),
                        'ü' => out.push_str("ue"),
                        'ß' => out.push_str("ss"),
                        other => out.push(other),
                    }
                }
            }
        }
        previous_digit = c.is_ascii_digit();
    }
    out
}

fn words_of(text: &str) -> Vec<String> {
    fold(text)
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(str::to_string)
        .collect()
}

fn is_segment_break(c: char) -> bool {
    matches!(
        c,
        ',' | '.' | ';' | ':' | '!' | '?' | '…' | '–' | '—' | '(' | ')' | '"' | '\n'
    )
}

/// An utterance as words, in segments split at punctuation, fillers dropped.
pub(super) struct Words {
    segments: Vec<Vec<String>>,
    question: bool,
    /// The transcript stops mid-word or trails off.
    broken_off: bool,
}

impl Words {
    pub(super) fn of(transcript: &str) -> Self {
        let lists = &*LISTS;
        let folded = fold(transcript);
        let segments = folded
            .split(is_segment_break)
            .map(|segment| drop_fillers(&words_of(segment), &lists.fillers))
            .filter(|segment| !segment.is_empty())
            .collect();
        let end = transcript.trim_end();
        Self {
            segments,
            question: transcript.contains('?'),
            broken_off: end.ends_with('-') || end.ends_with('…') || end.ends_with("..."),
        }
    }

    fn all(&self) -> impl Iterator<Item = &str> {
        self.segments.iter().flatten().map(String::as_str)
    }

    fn count(&self) -> usize {
        self.segments.iter().map(Vec::len).sum()
    }

    fn has_any(&self, list: &[&str]) -> bool {
        self.all().any(|word| list.contains(&word))
    }

    fn has_number(&self) -> bool {
        self.all()
            .any(|word| word.chars().any(|c| c.is_ascii_digit()))
    }

    fn starts_as_question(&self) -> bool {
        self.question
            || self.segments.iter().any(|segment| {
                segment
                    .first()
                    .is_some_and(|w| QUESTION_FIRST.contains(&w.as_str()))
            })
    }

    /// Words that ask for a different call: another value, a part left out
    /// or kept.
    pub(super) fn has_change_marker(&self) -> bool {
        let all: Vec<&str> = self.all().collect();
        let rather_not = |index: usize| {
            matches!(all[index], "lieber" | "rather")
                && all
                    .get(index + 1)
                    .is_none_or(|next| matches!(*next, "nicht" | "not"))
        };
        if all
            .iter()
            .enumerate()
            .any(|(index, word)| CHANGE_ANYWHERE.contains(word) && !rather_not(index))
        {
            return true;
        }
        for segment in &self.segments {
            let start = segment
                .iter()
                .take_while(|word| {
                    LEADING.contains(&word.as_str()) || matches!(word.as_str(), "aber" | "but")
                })
                .count();
            let segment = &segment[start..];
            let Some(first) = segment.first().map(String::as_str) else {
                continue;
            };
            if CHANGE_FIRST.contains(&first) && !(first == "take" && segment.len() == 1) {
                return true;
            }
            let dated = |words: &[String]| {
                words.iter().any(|word| {
                    word.chars().any(|c| c.is_ascii_digit()) || DATE_WORDS.contains(&word.as_str())
                })
            };
            if MAKE_FIRST.contains(&first)
                && (dated(segment)
                    || segment[1..]
                        .iter()
                        .any(|word| MAKE_OBJECT.contains(&word.as_str())))
            {
                return true;
            }
            // "den 22.", "am Freitag": a short segment that is only a date.
            if DATE_PREPOSITIONS.contains(&first)
                && segment.len() <= 4
                && dated(segment)
                && !self.starts_as_question()
                && !self.has_cue(REPEAT_CUES)
            {
                return true;
            }
        }
        // "die Wahrscheinlichkeit lass, wie sie ist" spans a comma.
        for (index, word) in all.iter().enumerate() {
            if !KEEP_VERBS.contains(word) {
                continue;
            }
            let object = all[..index]
                .iter()
                .chain(all[index + 1..].iter())
                .any(|other| {
                    !PRONOUNS.contains(other)
                        && !KEEP_ENDINGS.contains(other)
                        && !KEEP_VERBS.contains(other)
                        && !LEADING.contains(other)
                        && !["ist", "is", "sind", "are", "war", "was", "so"].contains(other)
                });
            if object && all[index + 1..].iter().any(|w| KEEP_ENDINGS.contains(w)) {
                return true;
            }
        }
        // "das Datum nicht ändern", "don't change the probability"; a bare
        // "nicht ändern" may refuse the whole call.
        all.windows(2).any(|window| {
            matches!(
                window,
                ["dont" | "not", "change" | "touch"]
                    | ["nicht", "aendern" | "veraendern" | "anfassen"]
            )
        }) && all.iter().any(|word| {
            !PRONOUNS.contains(word)
                && !LEADING.contains(word)
                && !NEGATIONS.contains(word)
                && !matches!(
                    *word,
                    "do" | "change" | "touch" | "anything" | "aendern" | "veraendern" | "anfassen"
                )
        })
    }

    fn has_cue(&self, cues: &[&[&str]]) -> bool {
        self.segments.iter().any(|segment| has_cue(segment, cues))
    }

    /// Whether the words could be a plain decision: short, no question, no
    /// condition, no change, no number and no field of the card.
    pub(super) fn could_be_plain_decision(
        &self,
        meaning: VoiceMeaning,
        pieces: &[CardPiece],
    ) -> bool {
        !self.question
            && !self.broken_off
            && !self
                .all()
                .last()
                .is_some_and(|last| CONTINUATIONS.contains(&last))
            && !(meaning == VoiceMeaning::Approve
                && (self.has_any(NEGATIONS)
                    || self.all().any(|word| !LISTS.agreement.contains(word))))
            && self.count() > 0
            && self.count() <= 6
            && !self.has_any(CONDITIONS)
            && !self.has_number()
            && !self.has_change_marker()
            && !self.names_a_field(pieces)
    }

    /// Whether the words could be about this card's call rather than
    /// something new.
    pub(super) fn could_be_change(&self, pieces: &[CardPiece]) -> bool {
        self.has_change_marker()
            || self.has_number()
            || self.has_any(NEGATIONS)
            || self.has_any(CONDITIONS)
            || self.has_any(DATE_WORDS)
            || self.names_a_field(pieces)
    }

    fn names_a_field(&self, pieces: &[CardPiece]) -> bool {
        self.all()
            .any(|word| pieces.iter().any(|piece| field_matches(piece, word)))
    }
}

fn has_cue(segment: &[String], cues: &[&[&str]]) -> bool {
    cues.iter().any(|cue| {
        segment
            .windows(cue.len())
            .any(|window| window.iter().zip(cue.iter()).all(|(a, b)| a == b))
    })
}

/// The segment without its leading acknowledgements, and whether those
/// included a yes or a no.
fn strip_leading(segment: &[String]) -> (&[String], bool, bool) {
    let lists = &*LISTS;
    let mut start = 0;
    let (mut yes, mut no) = (false, false);
    while start + 1 < segment.len() && lists.leading.contains(segment[start].as_str()) {
        yes |= LEADING_YES.contains(&segment[start].as_str());
        no |= LEADING_NO.contains(&segment[start].as_str());
        start += 1;
    }
    (&segment[start..], yes, no)
}

fn field_tokens(field: &str) -> Vec<String> {
    words_of(field)
        .into_iter()
        .filter(|word| word.chars().count() >= 3)
        .collect()
}

/// Whether a word the user said names this piece's field: the same word,
/// the head of a compound ("Datum" for "Abschlussdatum"), or an inflected
/// form ("Teilnehmern").
fn field_matches(piece: &CardPiece, word: &str) -> bool {
    let Some(field) = piece.field.as_deref() else {
        return false;
    };
    if word.chars().count() < 3 || LISTS.generic.contains(word) {
        return false;
    }
    field_tokens(field).iter().any(|token| {
        token == word
            || (word.len() >= 4 && token.ends_with(word))
            || (token.len() >= 5 && word.starts_with(token.as_str()))
            || (word.len() >= 6 && token.starts_with(word))
    })
}

enum Reference {
    /// No word says which piece.
    None,
    Piece(String),
    /// Words that name no single piece.
    Unknown,
}

fn reference(segment: &[String], pieces: &[CardPiece]) -> Reference {
    let lists = &*LISTS;
    let mut found: Option<&str> = None;
    let mut any = false;
    for word in segment {
        if lists.generic.contains(word.as_str()) || word.chars().count() < 3 {
            continue;
        }
        any = true;
        let matches: Vec<&CardPiece> = pieces
            .iter()
            .filter(|piece| field_matches(piece, word))
            .collect();
        match (matches.as_slice(), found) {
            ([only], None) => found = Some(only.id.as_str()),
            ([only], Some(id)) if only.id == id => {}
            _ => return Reference::Unknown,
        }
    }
    match found {
        Some(id) => Reference::Piece(id.to_string()),
        None if any => Reference::Unknown,
        None => Reference::None,
    }
}

#[derive(Clone, PartialEq, Eq)]
enum Segment {
    Noise,
    Nav(VoiceMeaning, Option<String>),
    Decision(VoiceMeaning),
    Unknown,
}

fn classify_segment(segment: &[String], input: &VoiceCommandInput<'_>) -> Segment {
    let lists = &*LISTS;
    let joined = segment.join(" ");
    if segment
        .iter()
        .all(|word| lists.noise_words.contains(word.as_str()))
        || lists.noise_phrases.contains(&joined)
    {
        return Segment::Noise;
    }
    if let Some(found) = exact(&joined, input) {
        return found;
    }
    let (rest, yes, no) = strip_leading(segment);
    let found = if rest.len() < segment.len() {
        let joined = rest.join(" ");
        if lists.noise_phrases.contains(&joined) {
            Some(Segment::Noise)
        } else {
            exact(&joined, input)
        }
    } else {
        None
    };
    let found = found.or_else(|| pattern(rest, input));
    match found {
        Some(Segment::Decision(VoiceMeaning::Approve)) if no => Segment::Unknown,
        Some(Segment::Decision(VoiceMeaning::Reject)) if yes => Segment::Unknown,
        Some(found) => found,
        None => Segment::Unknown,
    }
}

fn exact(joined: &str, input: &VoiceCommandInput<'_>) -> Option<Segment> {
    let lists = &*LISTS;
    if lists.approve.contains(joined) {
        Some(Segment::Decision(VoiceMeaning::Approve))
    } else if lists.reject.contains(joined) {
        Some(Segment::Decision(VoiceMeaning::Reject))
    } else if lists.stop.contains(joined) {
        Some(Segment::Nav(VoiceMeaning::Stop, None))
    } else if lists.skip.contains(joined) {
        Some(Segment::Nav(VoiceMeaning::Skip, None))
    } else if lists.repeat.contains(joined) {
        Some(Segment::Nav(
            VoiceMeaning::Repeat,
            input.current_piece_id.map(str::to_string),
        ))
    } else {
        None
    }
}

fn pattern(segment: &[String], input: &VoiceCommandInput<'_>) -> Option<Segment> {
    let first = segment.first()?.as_str();
    let negated = segment
        .iter()
        .any(|word| NEGATIONS.contains(&word.as_str()));
    if STOP_FIRST.contains(&first) {
        return Some(Segment::Nav(VoiceMeaning::Stop, None));
    }
    if has_cue(segment, READ_CUES)
        && !negated
        && !segment
            .iter()
            .any(|word| word == "already" || word == "schon")
    {
        return match reference(segment, input.pieces) {
            Reference::None => {
                let text = default_text_piece(input);
                let has_text = input
                    .pieces
                    .iter()
                    .any(|piece| piece.role == CardPieceRole::Text);
                has_text.then_some(Segment::Nav(VoiceMeaning::ReadText, text))
            }
            Reference::Piece(id) => {
                let role = input.pieces.iter().find(|piece| piece.id == id)?.role;
                Some(if role == CardPieceRole::Text {
                    Segment::Nav(VoiceMeaning::ReadText, Some(id))
                } else {
                    Segment::Nav(VoiceMeaning::Repeat, Some(id))
                })
            }
            Reference::Unknown => None,
        };
    }
    if has_cue(segment, REPEAT_CUES) {
        return match reference(segment, input.pieces) {
            Reference::None => Some(Segment::Nav(
                VoiceMeaning::Repeat,
                input.current_piece_id.map(str::to_string),
            )),
            Reference::Piece(id) => Some(Segment::Nav(VoiceMeaning::Repeat, Some(id))),
            Reference::Unknown => None,
        };
    }
    let asks_rest = segment.iter().any(|word| word == "rest")
        || (segment.iter().any(|word| REST_ASK.contains(&word.as_str()))
            && segment.iter().enumerate().any(|(index, word)| {
                REST_WHAT.contains(&word.as_str())
                    && !(word == "noch"
                        && segment
                            .get(index + 1)
                            .is_some_and(|next| next == "mal" || next == "einmal"))
            }));
    if asks_rest && !negated {
        return match reference(segment, input.pieces) {
            Reference::Piece(_) => None,
            _ => Some(Segment::Nav(VoiceMeaning::Rest, None)),
        };
    }
    if negated {
        return None;
    }
    if first == "weiter"
        || segment
            .iter()
            .any(|word| word.starts_with("ueberspr") || word == "skip")
        || !QUESTION_FIRST.contains(&first)
            && segment.windows(2).any(|pair| {
                (KNOWN_FIRST.contains(&pair[0].as_str()) && pair[1] == "ich")
                    || (pair[0] == "ich" && KNOWN_FIRST.contains(&pair[1].as_str()))
            })
        || matches!(
            segment
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>()
                .as_slice(),
            ["i", "know", ..] | ["i", "already", "know", ..] | ["i", "heard", "that" | "it", ..]
        )
    {
        return Some(Segment::Nav(VoiceMeaning::Skip, None));
    }
    None
}

pub(super) fn match_rules(input: &VoiceCommandInput<'_>) -> Option<RuleMatch> {
    let words = Words::of(input.transcript);
    if words.segments.is_empty() {
        return Some(RuleMatch {
            meaning: VoiceMeaning::Noise,
            piece_id: None,
        });
    }
    if words.has_change_marker() {
        return Some(RuleMatch {
            meaning: VoiceMeaning::Change,
            piece_id: None,
        });
    }
    let mut navigation = None;
    let mut decisions = HashSet::new();
    for segment in &words.segments {
        match classify_segment(segment, input) {
            Segment::Noise => {}
            Segment::Nav(meaning, piece_id) => navigation = Some((meaning, piece_id)),
            Segment::Decision(meaning) => {
                decisions.insert(meaning);
            }
            Segment::Unknown => return None,
        }
    }
    // A yes or no beside navigation acknowledges; the navigation is meant.
    if let Some((meaning, piece_id)) = navigation {
        return Some(RuleMatch { meaning, piece_id });
    }
    match decisions.len() {
        0 => Some(RuleMatch {
            meaning: VoiceMeaning::Noise,
            piece_id: None,
        }),
        1 => decisions
            .into_iter()
            .next()
            .filter(|meaning| words.could_be_plain_decision(*meaning, input.pieces))
            .map(|meaning| RuleMatch {
                meaning,
                piece_id: None,
            }),
        _ => None,
    }
}
