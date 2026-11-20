//! The plain words and short phrases, German and English together since
//! people mix them, matched without a model. A sentence the rules are not
//! sure of is left to the model; the rules never guess. The lists below are
//! the built-in base; `words.rs` adds what a language package brings.

use super::words::CommandWords;
use super::{
    CardPiece, CardPieceRole, VoiceCommandInput, VoiceMeaning, VoiceQuestion, default_text_piece,
};
pub(super) use erato_config::spoken::{CONDITIONS, NEGATIONS, WH_WORDS, fold};
use std::collections::HashSet;

pub(super) struct RuleMatch {
    pub meaning: VoiceMeaning,
    pub piece_id: Option<String>,
}

/// Hesitation sounds, dropped wherever they stand.
pub(super) const HESITATIONS: &[&str] = &[
    "aeh", "aehm", "aehh", "aehhm", "oeh", "oehm", "eh", "ehm", "hm", "hmm", "hmmm", "mh", "mhm",
    "mhmm", "uh", "uhm", "uhh", "um", "umm", "erm",
];
/// Fillers dropped wherever they stand, besides the hesitation sounds.
pub(super) const FILLER_WORDS: &[&str] =
    &["bitte", "please", "mal", "doch", "einfach", "eben", "kurz"];

/// A segment made only of these is listening noise.
pub(super) const NOISE_WORDS: &[&str] = &[
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
    "danke",
    "thanks",
];

pub(super) const NOISE_PHRASES: &[&str] = &[
    "in ordnung",
    "uh huh",
    "i see",
    "got you",
    "ah ja",
    "ach ja",
    "aha ja",
    "thank you",
    "danke schoen",
    "vielen dank",
];

/// Dropped from the start of a segment when something follows.
pub(super) const LEADING: &[&str] = &[
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
pub(super) const LEADING_YES: &[&str] = &["ja", "jo", "yes", "yeah", "yep"];
pub(super) const LEADING_NO: &[&str] = &["nein", "nee", "no", "nope"];

pub(super) const APPROVE: &[&str] = &[
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
pub(super) const AGREEMENT_WORDS: &[&str] = &[
    "das",
    "es",
    "so",
    "ruhig",
    "gerne",
    "gern",
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
    "please",
    "absolutely",
    "of",
    "course",
    "jawoll",
    "selbstverstaendlich",
    "natuerlich",
];

/// Besides the words of [`REJECT`], negations, acknowledgements and noise:
/// the only words a refusal may have. A yes is not among them, so "ja nee"
/// and "yeah, nope" are left as they are: not a refusal the guard lets pass.
pub(super) const REFUSAL_WORDS: &[&str] = &[
    "das", "es", "machen", "mal", "bitte", "please", "it", "that", "this", "do", "lieber",
    "besser", "sein", "wir", "we", "jetzt", "now",
];

pub(super) const REJECT: &[&str] = &[
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

/// Words of an [`APPROVE`] phrase that do not approve on their own.
pub(super) const APPROVE_HELPERS: &[&str] = &["bin", "s", "gehts"];
/// Words of a [`REJECT`] phrase that do not refuse on their own. "will",
/// "ausfuehren", "want" and "run" stand in refusals a package may add ("das
/// will ich nicht", "don't run it").
pub(super) const REJECT_HELPERS: &[&str] = &[
    "mach",
    "machen",
    "do",
    "sein",
    "gut",
    "danke",
    "thanks",
    "thank",
    "besser",
    "lieber",
    "auf",
    "fall",
    "way",
    "absolutely",
    "mal",
    "bitte",
    "please",
    "ab",
    "will",
    "ausfuehren",
    "want",
    "run",
];

pub(super) const STOP: &[&str] = &[
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
pub(super) const STOP_FIRST: &[&str] = &["stopp", "stop", "halt", "ruhe"];

pub(super) const SKIP: &[&str] = &[
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
/// "hab ich", "kenn ich (schon)", "I know": the user knows this piece.
pub(super) const KNOWN_CUES: &[&[&str]] = &[
    &["hab", "ich"],
    &["habe", "ich"],
    &["kenn", "ich"],
    &["kenne", "ich"],
    &["weiss", "ich"],
    &["ich", "hab"],
    &["ich", "habe"],
    &["ich", "kenn"],
    &["ich", "kenne"],
    &["ich", "weiss"],
    &["i", "know"],
    &["i", "already"],
    &["i", "heard"],
];

pub(super) const REPEAT: &[&str] = &[
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

/// Heard before a yes, these make it a listening "mhm, ja", not agreement.
pub(super) const BACKCHANNELS: &[&str] = &["mhm", "mhmm", "mh", "hm", "hmm", "hmmm", "aha", "huh"];
pub(super) const YES_PARTICLES: &[&str] = &["ja", "jo", "yes", "yeah", "yep"];
/// Words that open a question without a question mark: "passt das",
/// "kannst du", "is that".
pub(super) const QUESTION_VERBS: &[&str] = &[
    "passt",
    "stimmt",
    "ist",
    "sind",
    "hat",
    "haben",
    "kann",
    "kannst",
    "koennen",
    "koennte",
    "koenntest",
    "soll",
    "sollen",
    "sollte",
    "willst",
    "wuerdest",
    "gibt",
    "geht",
    "is",
    "are",
    "was",
    "were",
    "does",
    "did",
    "can",
    "could",
    "should",
    "would",
    "will",
    "shall",
    "have",
    "has",
];
pub(super) const SUBJECTS: &[&str] = &[
    "das", "es", "du", "ihr", "sie", "wir", "ich", "man", "you", "it", "that", "this", "we", "i",
    "he", "she", "they", "there",
];
/// A sentence that starts with its own subject ("ich möchte lieber …") is
/// about the speaker, not obviously about the card.
pub(super) const PERSONAL_SUBJECTS: &[&str] = &[
    "ich", "i", "id", "ill", "im", "ive", "wir", "we", "man", "du", "you",
];
/// Words that say something on the card is wrong, or that a part goes out
/// or in: maybe a change.
pub(super) const CORRECTIONS: &[&str] = &[
    "falsch",
    "falsche",
    "falschen",
    "fehler",
    "wrong",
    "incorrect",
    "mistake",
    "raus",
    "weg",
    "dazu",
    "rein",
    "hinzu",
    "kuerzer",
    "laenger",
    "shorter",
    "longer",
    "should",
];
/// A change that ends on one of these has not yet said what to change.
pub(super) const DANGLING: &[&str] = &[
    "den", "die", "der", "das", "dem", "des", "ein", "eine", "einen", "the", "a", "an", "to", "on",
    "at", "auf", "am", "zum", "zur", "mit", "ohne", "statt", "und", "and", "aber", "but", "for",
    "fuer", "von", "of", "in", "im", "bis", "ab", "lieber", "rather", "without",
];
/// Besides "the rest" and "what else", the only words a request for the
/// rest may have.
pub(super) const REST_WORDS: &[&str] = &[
    "geaendert",
    "aktualisiert",
    "veraendert",
    "updated",
    "changed",
    "changing",
    "changes",
    "change",
    "update",
    "updating",
    "kommt",
    "come",
    "comes",
    "coming",
    "gibt",
    "gibts",
    "gib",
    "there",
    "offen",
    "open",
    "passiert",
    "happens",
    "happening",
    "dinge",
    "ding",
    "things",
    "thing",
    "punkte",
    "sachen",
    "aenderungen",
    "aenderung",
    "steht",
    "stehen",
    "drin",
    "drauf",
    "aendert",
    "sich",
    "erzaehl",
    "tell",
    "sag",
    "say",
    "give",
    "being",
    "done",
    "rest",
    "fehlt",
    "missing",
    "also",
    "is",
    "are",
    "uebrig",
];
/// Besides [`KNOWN_CUES`], the only words a skip of a known piece may have.
pub(super) const KNOWN_WORDS: &[&str] = &[
    "schon",
    "bereits",
    "gehoert",
    "gelesen",
    "verstanden",
    "mitbekommen",
    "ja",
    "alles",
    "klar",
    "so",
    "gut",
    "auch",
    "jetzt",
    "hab",
    "habe",
    "kenn",
    "kenne",
    "weiss",
    "know",
    "one",
    "part",
    "already",
    "all",
    "heard",
    "got",
    "read",
    "weiter",
];
/// A skip that starts with one of these may hold [`ONWARD_WORDS`] after it.
pub(super) const ONWARD_FIRST: &[&str] = &["weiter"];
/// Besides [`ONWARD_FIRST`], the only words a "weiter …" skip may have.
pub(super) const ONWARD_WORDS: &[&str] = &[
    "zum",
    "naechsten",
    "naechste",
    "naechstes",
    "naechster",
    "punkt",
    "im",
    "text",
    "jetzt",
    "so",
    "geht",
    "gehts",
    "es",
    "machen",
    "weiter",
];
/// A sentence ending in one of these goes on; it is not a finished decision.
/// A final "so" or "then" after what it qualifies closes it: see
/// [`Words::ends_open`].
pub(super) const CONTINUATIONS: &[&str] = &[
    "so", "also", "und", "and", "aber", "but", "dann", "then", "well", "weil", "because", "wenn",
    "if", "ich", "i", "naja",
];

/// "Not like that" said on its own: a wish for a different call.
pub(super) const NOT_LIKE_THAT_ALONE: &[&str] = &[
    "nicht so",
    "so nicht",
    "nicht so machen",
    "so nicht machen",
    "mach das nicht so",
    "mach das so nicht",
    "mach es nicht so",
    "mach es so nicht",
    "genau so nicht",
    "not like that",
    "not like this",
    "dont do it like that",
];

/// Words that ask for a different call wherever they stand.
pub(super) const CHANGE_ANYWHERE: &[&str] = &[
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
pub(super) const CHANGE_FIRST: &[&str] = &[
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
pub(super) const MAKE_FIRST: &[&str] = &["mach", "make"];
pub(super) const MAKE_OBJECT: &[&str] = &[
    "am", "auf", "zum", "zur", "bis", "ab", "um", "daraus", "spaeter", "frueher", "to", "on", "at",
    "later", "earlier",
];
/// "lass X weg", "leave X as it is": keep or drop a part.
pub(super) const KEEP_VERBS: &[&str] = &[
    "lass", "lasst", "lasse", "leave", "keep", "behalte", "behalt",
];
pub(super) const KEEP_ENDINGS: &[&str] = &[
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
pub(super) const PRONOUNS: &[&str] = &[
    "es", "das", "den", "die", "der", "sie", "ihn", "it", "that", "this", "them", "mal",
];
pub(super) const DATE_PREPOSITIONS: &[&str] = &[
    "am", "auf", "zum", "zur", "den", "der", "ab", "bis", "um", "on", "to", "the", "at", "by",
];
pub(super) const DATE_WORDS: &[&str] = &[
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
pub(super) const QUESTION_FIRST: &[&str] = &[
    "was", "wer", "wie", "wann", "wo", "warum", "ist", "hat", "kann", "hast", "habe", "gibt",
    "what", "whats", "who", "when", "where", "why", "is", "does", "do", "can", "have", "will",
];

pub(super) const REPEAT_CUES: &[&[&str]] = &[
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
pub(super) const READ_CUES: &[&[&str]] = &[
    &["vorlesen"],
    &["vorlest"],
    &["lies"],
    &["lese"],
    &["liest"],
    &["lest"],
    &["read"],
];
pub(super) const REST_ASK: &[&str] = &["was", "what", "whats", "anything", "sonst", "und"];
pub(super) const REST_WHAT: &[&str] = &[
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
pub(super) const GENERIC: &[&str] = &[
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

/// "lieber", "rather": a wish for something else, unless "not" follows.
pub(super) const RATHER: &[&str] = &["lieber", "rather"];
/// "not" after [`RATHER`]: "lieber nicht" refuses.
pub(super) const RATHER_NOT: &[&str] = &["nicht", "not"];
/// A read cue said with one of these ("das hab ich schon gelesen") is no
/// wish to hear the text.
pub(super) const ALREADY: &[&str] = &["already", "schon"];
/// "Again": its words are no fillers ("noch mal") and ask for no rest.
pub(super) const AGAIN: &[&str] = &["noch mal", "noch einmal"];
/// "Not like that" anywhere in a segment.
pub(super) const NOT_LIKE_THAT: &[&str] = &["nicht so", "so nicht", "not like that"];
/// A yes said twice in a row is listening: "ja ja".
pub(super) const DOUBLED_YES: &[&str] = &["ja"];
/// Negations that stand right before the word they negate.
pub(super) const NEGATIONS_BEFORE: &[&str] = &["nicht", "not", "dont", "never", "nie"];

/// Whether `words[index]` ends one of the `again` phrases ("noch mal").
fn ends_again(words: &[String], index: usize, again: &[Vec<String>]) -> bool {
    again.iter().any(|cue| {
        cue.len() > 1 && index + 1 >= cue.len() && words[index + 1 - cue.len()..=index] == cue[..]
    })
}

/// Whether one of the `again` phrases starts at `words[index]`.
fn starts_again(words: &[String], index: usize, again: &[Vec<String>]) -> bool {
    again.iter().any(|cue| words[index..].starts_with(cue))
}

/// `fillers` and `again` are passed in because the phrase lists are built
/// with them.
pub(super) fn drop_fillers(
    words: &[String],
    fillers: &HashSet<String>,
    again: &[Vec<String>],
) -> Vec<String> {
    let mut kept = Vec::with_capacity(words.len());
    for (index, word) in words.iter().enumerate() {
        // German "um 10" is a time.
        let time = word == "um"
            && words
                .get(index + 1)
                .is_some_and(|next| next.starts_with(|c: char| c.is_ascii_digit()));
        if time || ends_again(words, index, again) || !fillers.contains(word.as_str()) {
            kept.push(word.clone());
        }
    }
    kept
}

pub(super) fn words_of(text: &str) -> Vec<String> {
    fold(text)
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(str::to_string)
        .collect()
}

fn is_segment_break(c: char) -> bool {
    matches!(
        c,
        ',' | '.'
            | ';'
            | ':'
            | '!'
            | '?'
            | '…'
            | '–'
            | '—'
            | '('
            | ')'
            | '"'
            | '\n'
            | '、'
            | '。'
            | '！'
            | '？'
            | '，'
            | '；'
    )
}

/// A letter of a script written without spaces between words (Han, kana,
/// Thai, …): the rules cannot tell its words apart, so they never decide on it.
fn is_unspaced_letter(c: char) -> bool {
    matches!(
        u32::from(c),
        0x0E00..=0x0EFF // Thai, Lao
            | 0x0F00..=0x0FFF // Tibetan
            | 0x1000..=0x109F // Myanmar
            | 0x1780..=0x17FF // Khmer
            | 0x19E0..=0x19FF // Khmer symbols
            | 0x1B00..=0x1B7F // Balinese
            | 0x3040..=0x30FF // Hiragana, Katakana
            | 0x31F0..=0x31FF // Katakana extension
            | 0x3400..=0x4DBF // CJK extension A
            | 0x4E00..=0x9FFF // CJK
            | 0xA980..=0xA9DF // Javanese
            | 0xF900..=0xFAFF // CJK compatibility
            | 0xFF66..=0xFF9F // half-width Katakana
            | 0x20000..=0x3134F // CJK extensions B to G
    )
}

/// An utterance as words, in segments split at punctuation, fillers dropped.
pub(super) struct Words<'l> {
    lists: &'l CommandWords,
    segments: Vec<Vec<String>>,
    /// Per segment: it ends with a question mark.
    marked_questions: Vec<bool>,
    question: bool,
    /// The transcript stops mid-word or trails off.
    broken_off: bool,
    /// A backchannel such as "mhm" was said.
    backchannel: bool,
    /// A no is taken back: "nein, doch".
    takes_back: bool,
    /// Written in a script without spaces between words.
    unspaced: bool,
}

impl<'l> Words<'l> {
    /// With the built-in lists only.
    #[cfg(test)]
    pub(super) fn of(transcript: &str) -> Words<'static> {
        Words::with(transcript, CommandWords::base())
    }

    pub(super) fn with(transcript: &str, lists: &'l CommandWords) -> Self {
        let folded = fold(transcript);
        let mut raw: Vec<(String, bool)> = Vec::new();
        let mut current = String::new();
        for c in folded.chars() {
            if is_segment_break(c) {
                raw.push((std::mem::take(&mut current), matches!(c, '?' | '？')));
            } else {
                current.push(c);
            }
        }
        raw.push((current, false));
        let (mut segments, mut marked_questions) = (Vec::new(), Vec::new());
        let (mut backchannel, mut said_no, mut takes_back) = (false, false, false);
        for (text, marked) in raw {
            let words = words_of(&text);
            for word in &words {
                backchannel |= lists.backchannels.contains(word.as_str());
                takes_back |= said_no && word == "doch";
                said_no |= lists.leading_no.contains(word.as_str())
                    || matches!(word.as_str(), "ne" | "noe");
            }
            let kept = drop_fillers(&words, &lists.fillers, &lists.again);
            if kept.is_empty() {
                if marked && let Some(last) = marked_questions.last_mut() {
                    *last = true;
                }
            } else {
                segments.push(kept);
                marked_questions.push(marked);
            }
        }
        let end = transcript.trim_end();
        Self {
            lists,
            segments,
            marked_questions,
            question: transcript.contains(['?', '？']),
            broken_off: end.ends_with('-') || end.ends_with('…') || end.ends_with("..."),
            backchannel,
            takes_back,
            unspaced: transcript.chars().any(is_unspaced_letter),
        }
    }

    /// Whether a segment asks: a question mark, a question word first, or a
    /// verb before its subject ("passt das", "kannst du").
    fn asks(&self, index: usize) -> bool {
        let segment = &self.segments[index];
        self.marked_questions[index]
            || segment
                .first()
                .is_some_and(|word| self.lists.wh_words.contains(word.as_str()))
            || matches!(segment.as_slice(), [verb, subject, ..]
                if self.lists.question_verbs.contains(verb.as_str())
                    && self.lists.subjects.contains(subject.as_str()))
    }

    fn any_asks(&self) -> bool {
        (0..self.segments.len()).any(|index| self.asks(index))
    }

    /// Stops before it says what it is about: a broken-off word, or a last
    /// word such as "den" or "ohne".
    pub(super) fn breaks_off(&self) -> bool {
        self.broken_off
            || self
                .all()
                .last()
                .is_some_and(|last| self.lists.dangling.contains(last))
    }

    /// A yes that only shows the user is listening: "mhm, ja", "ja ja".
    pub(super) fn is_backchannel_yes(&self) -> bool {
        let lists = self.lists;
        let only_yes = self
            .all()
            .all(|word| lists.yes_particles.contains(word) || lists.noise_words.contains(word));
        let doubled = self.segments.iter().any(|segment| {
            segment
                .windows(2)
                .any(|pair| pair[0] == pair[1] && lists.doubled_yes.contains(&pair[0]))
        });
        !self.unspaced && only_yes && (self.backchannel || doubled)
    }

    fn all(&self) -> impl Iterator<Item = &str> {
        self.segments.iter().flatten().map(String::as_str)
    }

    fn count(&self) -> usize {
        self.segments.iter().map(Vec::len).sum()
    }

    fn has_any(&self, list: &HashSet<String>) -> bool {
        self.all().any(|word| list.contains(word))
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
                    .is_some_and(|w| self.lists.question_first.contains(w.as_str()))
            })
    }

    /// Words that could ask for a different call: another value, a part
    /// left out or kept. Broad, for the guards.
    pub(super) fn has_change_marker(&self) -> bool {
        self.change_marker(false)
    }

    /// A change the rules may report: not in a question, not in a sentence
    /// about the speaker ("ich möchte lieber …"), and it says what to change.
    fn is_plain_change(&self) -> bool {
        self.change_marker(true) && !self.breaks_off()
    }

    fn change_marker(&self, plain: bool) -> bool {
        let lists = self.lists;
        // "nicht so", "so nicht", "not like that": the call, but different.
        // For the guards it counts anywhere. As a change the rules report
        // without the model, only when the segment says nothing else: "nicht
        // so schnell" or "ist das nicht so?" is no wish for a change.
        if self.segments.iter().enumerate().any(|(index, segment)| {
            if plain {
                // After leading words ("nein", "also"); "so" leads too.
                let leading = segment
                    .iter()
                    .take_while(|word| lists.leading.contains(word.as_str()))
                    .count();
                !self.asks(index)
                    && (0..=leading).any(|start| {
                        lists
                            .not_like_that_alone
                            .contains(&segment[start..].join(" "))
                    })
            } else {
                has_cue(segment, &lists.not_like_that)
            }
        }) {
            return true;
        }
        for (index, segment) in self.segments.iter().enumerate() {
            let personal = segment
                .first()
                .is_some_and(|word| lists.personal_subjects.contains(word.as_str()));
            if plain && (self.asks(index) || personal) {
                continue;
            }
            let rather_not = |at: usize| {
                lists.rather.contains(segment[at].as_str())
                    && segment
                        .get(at + 1)
                        .is_none_or(|next| lists.rather_not.contains(next.as_str()))
            };
            if segment
                .iter()
                .enumerate()
                .any(|(at, word)| lists.change_anywhere.contains(word.as_str()) && !rather_not(at))
            {
                return true;
            }
        }
        let all: Vec<&str> = self.all().collect();
        for segment in &self.segments {
            let start = segment
                .iter()
                .take_while(|word| {
                    lists.leading.contains(word.as_str()) || matches!(word.as_str(), "aber" | "but")
                })
                .count();
            let segment = &segment[start..];
            let Some(first) = segment.first().map(String::as_str) else {
                continue;
            };
            if lists.change_first.contains(first) && !(first == "take" && segment.len() == 1) {
                return true;
            }
            let dated = |words: &[String]| {
                words.iter().any(|word| {
                    word.chars().any(|c| c.is_ascii_digit())
                        || lists.date_words.contains(word.as_str())
                })
            };
            if lists.make_first.contains(first)
                && (dated(segment)
                    || segment[1..]
                        .iter()
                        .any(|word| lists.make_object.contains(word.as_str())))
            {
                return true;
            }
            // "den 22.", "am Freitag": a short segment that is only a date.
            if lists.date_prepositions.contains(first)
                && segment.len() <= 4
                && dated(segment)
                && !self.starts_as_question()
                && !self.has_cue(&lists.repeat_cues)
            {
                return true;
            }
        }
        // "die Wahrscheinlichkeit lass, wie sie ist" spans a comma.
        for (index, word) in all.iter().enumerate() {
            if !lists.keep_verbs.contains(*word) {
                continue;
            }
            let object = all[..index]
                .iter()
                .chain(all[index + 1..].iter())
                .any(|other| {
                    !lists.pronouns.contains(*other)
                        && !lists.keep_endings.contains(*other)
                        && !lists.keep_verbs.contains(*other)
                        && !lists.leading.contains(*other)
                        && !["ist", "is", "sind", "are", "war", "was", "so"].contains(other)
                });
            if object
                && all[index + 1..]
                    .iter()
                    .any(|w| lists.keep_endings.contains(*w))
            {
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
            !lists.pronouns.contains(*word)
                && !lists.leading.contains(*word)
                && !lists.negations.contains(*word)
                && !matches!(
                    *word,
                    "do" | "change" | "touch" | "anything" | "aendern" | "veraendern" | "anfassen"
                )
        })
    }

    fn has_cue(&self, cues: &[Vec<String>]) -> bool {
        self.segments.iter().any(|segment| has_cue(segment, cues))
    }

    /// Whether the words could be a plain decision: short; no question, also
    /// without a question mark; no condition, change, number or field of the
    /// card; only words of agreement (or of refusal), at least one of which
    /// carries it; and not in a script the rules cannot split into words.
    pub(super) fn could_be_plain_decision(
        &self,
        meaning: VoiceMeaning,
        pieces: &[CardPiece],
    ) -> bool {
        let lists = self.lists;
        let (allowed, carrying) = if meaning == VoiceMeaning::Approve {
            (&lists.agreement, &lists.agreeing)
        } else {
            (&lists.refusal, &lists.refusing)
        };
        // Only a yes may end on "so" or "then", or open with an
        // acknowledgement ("in Ordnung, mach"): a refusal must be a clear
        // no, and "lass es so" or "nein, in Ordnung, mach" are not.
        let approve = meaning == VoiceMeaning::Approve;
        let words = if approve {
            self.decision_words()
        } else {
            self.all().collect()
        };
        let open = if approve {
            self.ends_open()
        } else {
            self.all()
                .last()
                .is_some_and(|last| lists.continuations.contains(last))
        };
        !self.unspaced
            && !self.question
            && !self.any_asks()
            && !self.broken_off
            && !self.takes_back
            && !open
            && !(approve && self.has_any(&lists.negations))
            && !(!approve && self.agrees_without_its_no())
            && words.iter().all(|word| allowed.contains(*word))
            && words.iter().any(|word| carrying.contains(*word))
            && self.count() > 0
            && self.count() <= 6
            && !self.has_any(&lists.conditions)
            && !self.has_number()
            && !self.has_change_marker()
            && !self.names_a_field(pieces)
    }

    /// Whether the sentence goes on after its last word: "ja, und dann", "yes,
    /// but". A final "so" or "then" closes it after what it qualifies ("mach
    /// das so", "passt so", "go ahead then"), not after a yes, a joining word
    /// or a condition ("uh, yes, so", "ja, und so").
    pub(super) fn ends_open(&self) -> bool {
        let lists = self.lists;
        let words: Vec<&str> = self.all().collect();
        let Some((last, before)) = words.split_last() else {
            return false;
        };
        if !lists.continuations.contains(*last) {
            return false;
        }
        if !matches!(*last, "so" | "then") {
            return true;
        }
        before.last().is_none_or(|previous| {
            lists.continuations.contains(*previous)
                || lists.conditions.contains(*previous)
                || lists.yes_particles.contains(*previous)
        })
    }

    /// The words a yes is checked for: without a first segment that is only
    /// an acknowledgement ("in Ordnung, mach", "I see, go ahead").
    fn decision_words(&self) -> Vec<&str> {
        let skip = self.segments.first().is_some_and(|segment| {
            segment.len() > 1 && self.lists.noise_phrases.contains(&segment.join(" "))
        });
        self.segments
            .iter()
            .skip(usize::from(skip))
            .flatten()
            .map(String::as_str)
            .collect()
    }

    /// A word that agrees ("mach", "do") with no negation of its own: "nein,
    /// mach" is no clear no. Its negation follows it in the segment ("mach
    /// das nicht") or stands right before it ("nicht machen", "don't do").
    fn agrees_without_its_no(&self) -> bool {
        let lists = self.lists;
        self.segments.iter().any(|segment| {
            segment.iter().enumerate().any(|(at, word)| {
                lists.agreeing.contains(word.as_str())
                    && !segment[at + 1..]
                        .iter()
                        .any(|later| lists.negations.contains(later.as_str()))
                    && !at.checked_sub(1).is_some_and(|before| {
                        lists.negations_before.contains(segment[before].as_str())
                    })
            })
        })
    }

    /// Whether the words could be about this card's call rather than
    /// something new.
    pub(super) fn could_be_change(&self, pieces: &[CardPiece]) -> bool {
        let lists = self.lists;
        self.has_change_marker()
            || self.has_number()
            || self.has_any(&lists.negations)
            || self.has_any(&lists.conditions)
            || self.has_any(&lists.date_words)
            || self.has_any(&lists.corrections)
            || self.names_a_field(pieces)
    }

    fn names_a_field(&self, pieces: &[CardPiece]) -> bool {
        self.all().any(|word| {
            pieces
                .iter()
                .any(|piece| field_matches(piece, word, self.lists))
        })
    }
}

fn has_cue(segment: &[String], cues: &[Vec<String>]) -> bool {
    cues.iter().any(|cue| {
        segment
            .windows(cue.len())
            .any(|window| window.iter().zip(cue.iter()).all(|(a, b)| a == b))
    })
}

/// The segment without its leading acknowledgements, and whether those
/// included a yes or a no.
fn strip_leading<'s>(segment: &'s [String], lists: &CommandWords) -> (&'s [String], bool, bool) {
    let mut start = 0;
    let (mut yes, mut no) = (false, false);
    while start + 1 < segment.len() && lists.leading.contains(segment[start].as_str()) {
        yes |= lists.leading_yes.contains(segment[start].as_str());
        no |= lists.leading_no.contains(segment[start].as_str());
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
fn field_matches(piece: &CardPiece, word: &str, lists: &CommandWords) -> bool {
    let Some(field) = piece.field.as_deref() else {
        return false;
    };
    if word.chars().count() < 3 || lists.generic.contains(word) {
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

fn reference(segment: &[String], pieces: &[CardPiece], lists: &CommandWords) -> Reference {
    let mut found: Option<&str> = None;
    let mut any = false;
    for word in segment {
        if lists.generic.contains(word.as_str()) || word.chars().count() < 3 {
            continue;
        }
        any = true;
        let matches: Vec<&CardPiece> = pieces
            .iter()
            .filter(|piece| field_matches(piece, word, lists))
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

fn classify_segment(
    segment: &[String],
    input: &VoiceCommandInput<'_>,
    lists: &CommandWords,
) -> Segment {
    let joined = segment.join(" ");
    if segment
        .iter()
        .all(|word| lists.noise_words.contains(word.as_str()))
        || lists.noise_phrases.contains(&joined)
    {
        return Segment::Noise;
    }
    if let Some(found) = exact(&joined, input, lists) {
        return found;
    }
    let (rest, yes, no) = strip_leading(segment, lists);
    let found = if rest.len() < segment.len() {
        let joined = rest.join(" ");
        if lists.noise_phrases.contains(&joined) {
            Some(Segment::Noise)
        } else {
            exact(&joined, input, lists)
        }
    } else {
        None
    };
    let found = found.or_else(|| pattern(rest, input, lists));
    match found {
        Some(Segment::Decision(VoiceMeaning::Approve)) if no => Segment::Unknown,
        Some(Segment::Decision(VoiceMeaning::Reject)) if yes => Segment::Unknown,
        Some(found) => found,
        None => Segment::Unknown,
    }
}

fn exact(joined: &str, input: &VoiceCommandInput<'_>, lists: &CommandWords) -> Option<Segment> {
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

fn pattern(
    segment: &[String],
    input: &VoiceCommandInput<'_>,
    lists: &CommandWords,
) -> Option<Segment> {
    let first = segment.first()?.as_str();
    let negated = segment
        .iter()
        .any(|word| lists.negations.contains(word.as_str()));
    if lists.stop_first.contains(first) {
        return Some(Segment::Nav(VoiceMeaning::Stop, None));
    }
    // The voice asked which text to read: naming one answers it.
    if input.question == Some(VoiceQuestion::WhichText)
        && !negated
        && let Reference::Piece(id) = reference(segment, input.pieces, lists)
        && input
            .pieces
            .iter()
            .any(|piece| piece.id == id && piece.role == CardPieceRole::Text)
    {
        return Some(Segment::Nav(VoiceMeaning::ReadText, Some(id)));
    }
    if has_cue(segment, &lists.read_cues)
        && !negated
        && !segment
            .iter()
            .any(|word| lists.already.contains(word.as_str()))
    {
        return match reference(segment, input.pieces, lists) {
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
    if has_cue(segment, &lists.repeat_cues) {
        return match reference(segment, input.pieces, lists) {
            Reference::None => Some(Segment::Nav(
                VoiceMeaning::Repeat,
                input.current_piece_id.map(str::to_string),
            )),
            Reference::Piece(id) => Some(Segment::Nav(VoiceMeaning::Repeat, Some(id))),
            Reference::Unknown => None,
        };
    }
    let asks_rest = segment.iter().any(|word| word == "rest")
        || (segment
            .iter()
            .any(|word| lists.rest_ask.contains(word.as_str()))
            && segment.iter().enumerate().any(|(index, word)| {
                lists.rest_what.contains(word.as_str())
                    && !starts_again(segment, index, &lists.again)
            }));
    if asks_rest {
        // "Was steht heute noch in meinem Kalender?" asks about something else.
        let only_rest_words = segment.iter().all(|word| {
            let word = word.as_str();
            lists.generic.contains(word)
                || lists.rest_ask.contains(word)
                || lists.rest_what.contains(word)
                || lists.rest_words.contains(word)
                || lists.leading.contains(word)
                || lists.noise_words.contains(word)
        });
        return (only_rest_words && !negated).then_some(Segment::Nav(VoiceMeaning::Rest, None));
    }
    if negated {
        return None;
    }
    let only = |extra: &HashSet<String>| {
        segment.iter().all(|word| {
            let word = word.as_str();
            extra.contains(word) || lists.pronouns.contains(word) || lists.subjects.contains(word)
        })
    };
    let knows = has_cue(segment, &lists.known_cues);
    if lists.onward_first.contains(first) && only(&lists.onward_words)
        || segment
            .iter()
            .any(|word| word.starts_with("ueberspr") || word == "skip")
        || knows && only(&lists.known_words)
    {
        return Some(Segment::Nav(VoiceMeaning::Skip, None));
    }
    None
}

pub(super) fn match_rules(
    input: &VoiceCommandInput<'_>,
    lists: &CommandWords,
) -> Option<RuleMatch> {
    let words = Words::with(input.transcript, lists);
    // A script without spaces is left to the model, and the guard keeps
    // its decisions on screen.
    if words.unspaced {
        return None;
    }
    if words.segments.is_empty() {
        return Some(RuleMatch {
            meaning: VoiceMeaning::Noise,
            piece_id: None,
        });
    }
    if words.is_plain_change() {
        return Some(RuleMatch {
            meaning: VoiceMeaning::Change,
            piece_id: None,
        });
    }
    let mut navigation = None;
    let mut decisions = HashSet::new();
    for segment in &words.segments {
        match classify_segment(segment, input, lists) {
            Segment::Noise => {}
            Segment::Nav(meaning, piece_id) => navigation = Some((meaning, piece_id)),
            Segment::Decision(meaning) => {
                decisions.insert(meaning);
            }
            Segment::Unknown => return None,
        }
    }
    // Yes and no together ("no, wait, yes"), or a no taken back, are for the
    // model. A single yes or no beside navigation acknowledges; the
    // navigation is meant.
    if decisions.len() > 1 || words.takes_back && !decisions.is_empty() {
        return None;
    }
    if let Some((meaning, piece_id)) = navigation {
        return Some(RuleMatch { meaning, piece_id });
    }
    match decisions.len() {
        0 => Some(RuleMatch {
            meaning: VoiceMeaning::Noise,
            piece_id: None,
        }),
        _ => decisions
            .into_iter()
            .next()
            .filter(|meaning| words.could_be_plain_decision(*meaning, input.pieces))
            .map(|meaning| RuleMatch {
                meaning,
                piece_id: None,
            }),
    }
}
