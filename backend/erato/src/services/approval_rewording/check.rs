//! The rule check a natural wording passes before it is spoken. What is heard
//! is what gets approved, so a wording may only add words to the precise
//! piece, never drop, replace or reorder one: the precise piece's words must
//! all be in it, in their order, and every word it adds must be on the short
//! per-language list of insertions (articles, "ist", "geht", "lautet", …).
//! Each fact is also said in exactly the precise piece's characters, so
//! "185.000" cannot become "185,000". Anything else keeps the precise piece.

use std::collections::BTreeSet;

use crate::config::is_invisible_format_char;

/// Why a wording was not used; also the counts the offline check reports.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum Rejection {
    Empty,
    TooLong,
    /// A character outside the allowed set: markup, a control or an
    /// invisible character.
    Character(char),
    /// A word of the precise piece is missing or out of its order.
    Dropped(String),
    /// A word that is not on the list of insertions.
    NewWord(String),
    /// A fact not said in exactly its precise characters, or not as often.
    FactText(String),
    /// An added "ist" or "is" before "von" or "from", which sounds like a
    /// range ("is from Low to Medium") instead of a change.
    RangeLike,
}

impl Rejection {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Empty => "empty",
            Self::TooLong => "too_long",
            Self::Character(_) => "character",
            Self::Dropped(_) => "dropped",
            Self::NewWord(_) => "new_word",
            Self::FactText(_) => "fact_text",
            Self::RangeLike => "range_like",
        }
    }
}

/// Punctuation a spoken sentence may have besides letters and digits.
const PUNCTUATION: &str = ".,:;!?'\"’‘“”„«»–—-()/%€$&+…@";
/// A wording may be this much longer than the precise piece, in characters.
const MAX_GROWTH_CHARS: usize = 80;

/// Words in lowercase, apostrophes inside a word kept ("can't"); a number
/// keeps the separators between its digits ("185.000", "15.01.2030",
/// "10:30"), so another separator is another word. Anything else separates.
pub fn tokens(text: &str) -> Vec<String> {
    let chars: Vec<char> = text
        .chars()
        .map(|c| if c == '’' || c == '‘' { '\'' } else { c })
        .collect();
    let mut words = Vec::new();
    let mut word = String::new();
    for (index, &c) in chars.iter().enumerate() {
        let inside_number = matches!(c, '.' | ',' | ':' | '/')
            && word
                .chars()
                .last()
                .is_some_and(|last| last.is_ascii_digit())
            && chars.get(index + 1).is_some_and(char::is_ascii_digit);
        if c.is_alphanumeric() || inside_number || (c == '\'' && !word.is_empty()) {
            word.extend(c.to_lowercase());
        } else if !word.is_empty() {
            words.push(std::mem::take(&mut word).trim_end_matches('\'').to_string());
        }
    }
    if !word.is_empty() {
        words.push(word.trim_end_matches('\'').to_string());
    }
    words.retain(|word| !word.is_empty());
    words
}

/// Places of `fact` in `text`, compared without case but character for
/// character otherwise, and only where it is not part of a longer word.
fn fact_places(text: &str, fact: &str) -> usize {
    let text: Vec<char> = text.to_lowercase().chars().collect();
    let fact: Vec<char> = fact.trim().to_lowercase().chars().collect();
    if fact.is_empty() || fact.len() > text.len() {
        return 0;
    }
    let edge = |c: Option<&char>| c.is_none_or(|c| !c.is_alphanumeric());
    (0..=text.len() - fact.len())
        .filter(|&start| {
            text[start..start + fact.len()] == fact[..]
                && (start == 0 || edge(text.get(start - 1)))
                && edge(text.get(start + fact.len()))
        })
        .count()
}

/// Words a language never lets a wording add: negations, numbers,
/// quantities, words for days and times, hedges, action verbs, kinds of
/// things and pointers to the screen. A configured list of insertions that
/// holds one is cut by it.
fn guarded(language: &str) -> &'static [&'static str] {
    match primary(language) {
        "de" => GUARD_DE,
        "en" => GUARD_EN,
        _ => &[],
    }
}

fn negations(language: &str) -> &'static [&'static str] {
    match primary(language) {
        "de" => NEGATIONS_DE,
        "en" => NEGATIONS_EN,
        _ => &[],
    }
}

pub fn primary(language: &str) -> &str {
    language.split(['-', '_']).next().unwrap_or(language)
}

/// The words a wording in `language` may add, from the configured list (or
/// the built-in one), without the guarded words.
pub fn allowed_words(language: &str, configured: &[String]) -> BTreeSet<String> {
    let guard = guarded(language);
    let negation = negations(language);
    let built_in: &[&str] = match primary(language) {
        "de" => super::words::WORDS_DE,
        "en" => super::words::WORDS_EN,
        _ => &[],
    };
    let listed: Vec<String> = if configured.is_empty() {
        built_in.iter().map(|word| (*word).to_string()).collect()
    } else {
        configured.to_vec()
    };
    listed
        .iter()
        .flat_map(|word| tokens(word))
        .filter(|word| {
            !guard.contains(&word.as_str())
                && !negation.contains(&word.as_str())
                && !word.chars().any(|c| c.is_numeric())
        })
        .collect()
}

/// Copulas that may not be added right before the word that starts a change.
fn range_like(language: &str) -> (&'static [&'static str], &'static [&'static str]) {
    match primary(language) {
        "de" => (&["ist", "sind"], &["von", "vom"]),
        "en" => (&["is", "are"], &["from"]),
        _ => (&[], &[]),
    }
}

/// One precise piece and what it must keep.
pub struct Precise<'a> {
    pub text: &'a str,
    /// The words the precise piece says for each of its values, in the order
    /// the card gives them.
    pub facts: &'a [String],
}

/// Whether `wording` may be spoken in place of `precise`.
pub fn check(
    precise: &Precise<'_>,
    wording: &str,
    language: &str,
    allowed: &BTreeSet<String>,
) -> Result<(), Rejection> {
    let wording = wording.trim();
    if wording.is_empty() {
        return Err(Rejection::Empty);
    }
    let precise_chars = precise.text.chars().count();
    let wording_chars = wording.chars().count();
    if wording_chars > super::MAX_PIECE_CHARS || wording_chars > precise_chars + MAX_GROWTH_CHARS {
        return Err(Rejection::TooLong);
    }
    if let Some(c) = wording.chars().find(|c| {
        !(c.is_alphanumeric() || *c == ' ' || PUNCTUATION.contains(*c))
            || c.is_control()
            || is_invisible_format_char(*c)
    }) && !precise.text.contains(c)
    {
        return Err(Rejection::Character(c));
    }

    // The precise words, in order, with only allowed words between them.
    let said = tokens(precise.text);
    let new = tokens(wording);
    let (copulas, change_starts) = range_like(language);
    let mut next = 0;
    let mut added_before: Option<&str> = None;
    for word in &new {
        if said.get(next) == Some(word) {
            if added_before.is_some_and(|added| copulas.contains(&added))
                && change_starts.contains(&word.as_str())
            {
                return Err(Rejection::RangeLike);
            }
            added_before = None;
            next += 1;
        } else if allowed.contains(word.as_str()) {
            added_before = Some(word.as_str());
        } else {
            return Err(Rejection::NewWord(word.clone()));
        }
    }
    if let Some(missing) = said.get(next) {
        return Err(Rejection::Dropped(missing.clone()));
    }

    for fact in precise.facts {
        if fact_places(wording, fact) != fact_places(precise.text, fact) {
            return Err(Rejection::FactText(fact.clone()));
        }
    }
    Ok(())
}

const NEGATIONS_DE: &[&str] = &[
    "nicht", "kein", "keine", "keinen", "keinem", "keiner", "keines", "nie", "niemals", "nichts",
    "ohne", "weder", "nirgends", "niemand", "nein",
];

const NEGATIONS_EN: &[&str] = &[
    "not",
    "no",
    "never",
    "none",
    "nothing",
    "without",
    "neither",
    "nor",
    "nobody",
    "nowhere",
    "cannot",
    "can't",
    "don't",
    "doesn't",
    "won't",
    "isn't",
    "aren't",
    "wasn't",
    "weren't",
    "shouldn't",
    "wouldn't",
    "couldn't",
    "didn't",
    "hasn't",
    "haven't",
    "n't",
];

const GUARD_DE: &[&str] = &[
    "null",
    "eins",
    "ein",
    "eine",
    "einen",
    "einem",
    "einer",
    "eines",
    "zwei",
    "drei",
    "vier",
    "fünf",
    "sechs",
    "sieben",
    "acht",
    "neun",
    "zehn",
    "elf",
    "zwölf",
    "zwanzig",
    "dreißig",
    "hundert",
    "tausend",
    "million",
    "millionen",
    "milliarde",
    "milliarden",
    "halb",
    "halbe",
    "viertel",
    "dutzend",
    "beide",
    "beiden",
    "alle",
    "allen",
    "jede",
    "jeden",
    "jedem",
    "jeder",
    "jedes",
    "erste",
    "ersten",
    "zweite",
    "dritte",
    "letzte",
    "letzten",
    "mehr",
    "weniger",
    "weitere",
    "weiteren",
    "weiterer",
    "heute",
    "morgen",
    "gestern",
    "übermorgen",
    "vorgestern",
    "montag",
    "dienstag",
    "mittwoch",
    "donnerstag",
    "freitag",
    "samstag",
    "sonntag",
    "januar",
    "februar",
    "märz",
    "april",
    "mai",
    "juni",
    "juli",
    "august",
    "september",
    "oktober",
    "november",
    "dezember",
    "uhr",
    "jahr",
    "monat",
    "woche",
    "tag",
    "tage",
    "prozent",
    "euro",
    "dollar",
    "früh",
    "spät",
    "später",
    "vorher",
    "nachher",
    "bald",
    "sofort",
    "immer",
    "nur",
    "auch",
    "noch",
    "wieder",
    "zurück",
    "gelöscht",
    "löschen",
    "endgültig",
    "laut",
    "ob",
    "bekannt",
    "unbekannt",
    "vermutlich",
    "angeblich",
    "eventuell",
    "vielleicht",
    // What is done, to what kind of thing, and what is only on screen or cut.
    "anlegen",
    "lege",
    "legt",
    "angelegt",
    "erstellen",
    "erstelle",
    "erstellt",
    "ändern",
    "ändere",
    "ändert",
    "geändert",
    "setzen",
    "setze",
    "setzt",
    "gesetzt",
    "verschieben",
    "verschiebe",
    "verschiebt",
    "verschoben",
    "eintragen",
    "trage",
    "trägt",
    "eingetragen",
    "aktualisieren",
    "aktualisiere",
    "aktualisiert",
    "ersetzen",
    "ersetze",
    "ersetzt",
    "hinzufügen",
    "füge",
    "fügt",
    "hinzugefügt",
    "entfernen",
    "entferne",
    "entfernt",
    "leeren",
    "leere",
    "leert",
    "geleert",
    "markieren",
    "markiere",
    "markiert",
    "zuweisen",
    "weise",
    "weist",
    "zugewiesen",
    "senden",
    "sende",
    "sendet",
    "gesendet",
    "schicken",
    "schicke",
    "schickt",
    "geschickt",
    "verschicken",
    "verschicke",
    "verschickt",
    "teilen",
    "teile",
    "teilt",
    "geteilt",
    "lesen",
    "lese",
    "liest",
    "gelesen",
    "suchen",
    "suche",
    "sucht",
    "gesucht",
    "auflisten",
    "liste",
    "listet",
    "aufgelistet",
    "abrufen",
    "rufe",
    "ruft",
    "abgerufen",
    "ausführen",
    "führe",
    "führt",
    "ausgeführt",
    "speichern",
    "speichere",
    "speichert",
    "gespeichert",
    "archivieren",
    "archiviere",
    "archiviert",
    "anhängen",
    "hänge",
    "hängt",
    "angehängt",
    "hochladen",
    "lade",
    "lädt",
    "hochgeladen",
    "festlegen",
    "festgelegt",
    "notieren",
    "notiere",
    "notiert",
    "verwenden",
    "verwende",
    "verwendet",
    "absagen",
    "sage",
    "abgesagt",
    "freigeben",
    "gebe",
    "freigegeben",
    "kopieren",
    "kopiere",
    "kopiert",
    "erledigen",
    "erledige",
    "erledigt",
    "seite",
    "seiten",
    "datensatz",
    "datensätze",
    "datenbank",
    "datenbanken",
    "ordner",
    "notiz",
    "notizen",
    "kommentar",
    "kommentare",
    "absatz",
    "absätze",
    "dokument",
    "dokumente",
    "mail",
    "mails",
    "nachricht",
    "nachrichten",
    "termin",
    "termine",
    "datei",
    "dateien",
    "aufgabe",
    "aufgaben",
    "eintrag",
    "einträge",
    "tool",
    "tabelle",
    "tabellen",
    "bildschirm",
    "kennung",
    "gekürzt",
];

const GUARD_EN: &[&str] = &[
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "twenty",
    "thirty",
    "hundred",
    "thousand",
    "million",
    "billion",
    "half",
    "quarter",
    "dozen",
    "both",
    "all",
    "every",
    "each",
    "first",
    "second",
    "third",
    "last",
    "more",
    "less",
    "fewer",
    "other",
    "others",
    "another",
    "today",
    "tomorrow",
    "yesterday",
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
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
    "o'clock",
    "am",
    "pm",
    "year",
    "month",
    "week",
    "day",
    "days",
    "percent",
    "euro",
    "euros",
    "dollar",
    "dollars",
    "early",
    "late",
    "later",
    "before",
    "after",
    "soon",
    "now",
    "always",
    "only",
    "also",
    "again",
    "back",
    "deleted",
    "delete",
    "permanently",
    "according",
    "says",
    "say",
    "whether",
    "known",
    "unknown",
    "probably",
    "apparently",
    "maybe",
    "perhaps",
    // What is done, to what kind of thing, and what is only on screen or cut.
    "create",
    "creates",
    "creating",
    "created",
    "add",
    "adds",
    "adding",
    "added",
    "change",
    "changes",
    "changing",
    "changed",
    "set",
    "sets",
    "setting",
    "move",
    "moves",
    "moving",
    "moved",
    "update",
    "updates",
    "updating",
    "updated",
    "replace",
    "replaces",
    "replacing",
    "replaced",
    "remove",
    "removes",
    "removing",
    "removed",
    "clear",
    "clears",
    "clearing",
    "cleared",
    "empty",
    "empties",
    "emptying",
    "emptied",
    "mark",
    "marks",
    "marking",
    "marked",
    "assign",
    "assigns",
    "assigning",
    "assigned",
    "send",
    "sends",
    "sending",
    "sent",
    "share",
    "shares",
    "sharing",
    "shared",
    "read",
    "reads",
    "reading",
    "search",
    "searches",
    "searching",
    "searched",
    "look",
    "looks",
    "looking",
    "list",
    "lists",
    "listing",
    "listed",
    "fetch",
    "fetches",
    "fetching",
    "fetched",
    "run",
    "runs",
    "running",
    "ran",
    "save",
    "saves",
    "saving",
    "saved",
    "archive",
    "archives",
    "archiving",
    "archived",
    "attach",
    "attaches",
    "attaching",
    "attached",
    "upload",
    "uploads",
    "uploading",
    "uploaded",
    "put",
    "puts",
    "putting",
    "file",
    "files",
    "filing",
    "filed",
    "make",
    "makes",
    "making",
    "made",
    "fill",
    "fills",
    "filling",
    "filled",
    "reschedule",
    "reschedules",
    "rescheduling",
    "rescheduled",
    "use",
    "uses",
    "using",
    "used",
    "cancel",
    "cancels",
    "cancelling",
    "cancelled",
    "copy",
    "copies",
    "copying",
    "copied",
    "complete",
    "completes",
    "completing",
    "completed",
    "page",
    "pages",
    "record",
    "records",
    "database",
    "databases",
    "folder",
    "folders",
    "note",
    "notes",
    "comment",
    "comments",
    "paragraph",
    "paragraphs",
    "document",
    "documents",
    "email",
    "emails",
    "message",
    "messages",
    "event",
    "events",
    "task",
    "tasks",
    "item",
    "items",
    "entry",
    "entries",
    "tool",
    "table",
    "tables",
    "screen",
    "id",
    "shortened",
];

#[cfg(test)]
mod tests {
    use super::*;

    fn run(precise: &str, facts: &[&str], wording: &str, language: &str) -> Result<(), Rejection> {
        let facts: Vec<String> = facts.iter().map(|fact| (*fact).to_string()).collect();
        check(
            &Precise {
                text: precise,
                facts: &facts,
            },
            wording,
            language,
            &allowed_words(language, &[]),
        )
    }

    #[test]
    fn tokens_ignore_case_and_keep_a_number_whole() {
        assert_eq!(
            tokens("Fälligkeitsdatum: 15. Januar 2030, 10:30 Uhr."),
            vec!["fälligkeitsdatum", "15", "januar", "2030", "10:30", "uhr"]
        );
        assert_eq!(
            tokens("185.000 und 185,000"),
            vec!["185.000", "und", "185,000"]
        );
        assert_eq!(
            tokens("I can’t, it's E-Mail"),
            vec!["i", "can't", "it's", "e", "mail"]
        );
    }

    /// Faithful rewordings: only articles, a copula, "geht", "lautet" or
    /// "Wert" added, as the model does in the measured run.
    #[test]
    fn faithful_wordings_pass() {
        let rows: &[(&str, &[&str], &str, &str)] = &[
            (
                "Priorität: Hoch.",
                &["Priorität", "Hoch"],
                "Die Priorität ist Hoch.",
                "de",
            ),
            (
                "Bezug: Line 4 Retrofit.",
                &["Bezug", "Line 4 Retrofit"],
                "Der Bezug ist Line 4 Retrofit.",
                "de",
            ),
            (
                "Voraussichtliches Abschlussdatum: vom 1. Dezember auf den 15. Januar 2030.",
                &[
                    "Voraussichtliches Abschlussdatum",
                    "1. Dezember",
                    "15. Januar 2030",
                ],
                "Das Voraussichtliches Abschlussdatum geht vom 1. Dezember auf den 15. Januar 2030.",
                "de",
            ),
            (
                "Betreff: Termin für die Begehung.",
                &["Betreff", "Termin für die Begehung"],
                "Der Betreff lautet Termin für die Begehung.",
                "de",
            ),
            (
                "Geschätzter Umsatz: 185.000.",
                &["Geschätzter Umsatz", "185.000"],
                "Der Geschätzter Umsatz ist 185.000.",
                "de",
            ),
            (
                "Priority: High.",
                &["Priority", "High"],
                "The priority is High.",
                "en",
            ),
            (
                "Probability: from 10 to 60 percent.",
                &["Probability", "10", "60 percent"],
                "The probability goes from 10 to 60 percent.",
                "en",
            ),
            (
                "Phone: +49 821 555 0100.",
                &["Phone", "+49 821 555 0100"],
                "The Phone value is +49 821 555 0100.",
                "en",
            ),
        ];
        for (precise, facts, wording, language) in rows {
            assert_eq!(run(precise, facts, wording, language), Ok(()), "{wording}");
        }
    }

    /// Wordings that keep every fact word but change what is said, from the
    /// review of 2026-11-18, and the earlier cases: each is rejected.
    #[test]
    fn unfaithful_wordings_are_rejected() {
        let change_de =
            "Voraussichtliches Abschlussdatum: vom 1. Dezember auf den 15. Januar 2030.";
        let change_de_facts: &[&str] = &[
            "Voraussichtliches Abschlussdatum",
            "1. Dezember",
            "15. Januar 2030",
        ];
        let rows: &[(&str, &[&str], &str, &str)] = &[
            // Old and new swapped.
            (
                change_de,
                change_de_facts,
                "Voraussichtliches Abschlussdatum: neu 1. Dezember, bisher 15. Januar 2030.",
                "de",
            ),
            (
                "Wahrscheinlichkeit: von 10 auf 60 Prozent.",
                &["Wahrscheinlichkeit", "10", "60 Prozent"],
                "Die Wahrscheinlichkeit ist neu 10 statt 60 Prozent.",
                "de",
            ),
            (
                "Contact: from Anna Müller to Ben Schmidt.",
                &["Contact", "Anna Müller", "Ben Schmidt"],
                "The contact is Anna Müller instead of Ben Schmidt.",
                "en",
            ),
            (
                "Estimated close date: from 1 December to 15 January 2030.",
                &["Estimated close date", "1 December", "15 January 2030"],
                "The estimated close date goes to 1 December from 15 January 2030.",
                "en",
            ),
            (
                change_de,
                change_de_facts,
                "Voraussichtliches Abschlussdatum: vom 15. Januar 2030 auf den 1. Dezember.",
                "de",
            ),
            // A warning, a condition or a direction reversed.
            (
                "Zwei der Empfänger sind außerhalb der Firma.",
                &["Zwei"],
                "Zwei der Empfänger sind in der Firma.",
                "de",
            ),
            (
                "Two of the recipients are outside the organisation.",
                &["Two"],
                "Two of the recipients are in the organisation.",
                "en",
            ),
            (
                "Fälligkeitsdatum liegt vor dem 31. Januar 2030.",
                &["Fälligkeitsdatum", "31. Januar 2030"],
                "Fälligkeitsdatum liegt nach dem 31. Januar 2030.",
                "de",
            ),
            (
                "Ich möchte in Notion die Seiten Wochenbericht KW 44 und Wochenbericht KW 45 nach Archiv verschieben.",
                &[
                    "Notion",
                    "Wochenbericht KW 44",
                    "Wochenbericht KW 45",
                    "Archiv",
                ],
                "Ich möchte in Notion die Seiten Wochenbericht KW 44 und Wochenbericht KW 45 aus Archiv verschieben.",
                "de",
            ),
            (
                "Ich möchte in Outlook eine E-Mail an Anna Mueller und drei weitere senden:",
                &["Outlook", "Anna Mueller", "drei"],
                "Ich möchte in Outlook eine E-Mail von Anna Mueller an drei weitere senden:",
                "de",
            ),
            // Tense and modality.
            (
                "Das Feld Telefon wird geleert.",
                &["Telefon"],
                "Das Feld Telefon wurde geleert.",
                "de",
            ),
            (
                "The field Phone will be emptied.",
                &["Phone"],
                "The field Phone has been emptied.",
                "en",
            ),
            (
                "Dabei werden 15 Felder geleert.",
                &["15"],
                "Dabei können 15 Felder geleert werden.",
                "de",
            ),
            (
                "Risk level will be set to Medium.",
                &["Risk level", "Medium"],
                "Risk level could be set to Medium.",
                "en",
            ),
            // A number in another format, "oder" for "und", a moved negation,
            // a dropped approximation, "kommen dazu" said as "sind".
            (
                "Geschätzter Umsatz: 185.000.",
                &["Geschätzter Umsatz", "185.000"],
                "Der Geschätzter Umsatz ist 185,000.",
                "de",
            ),
            (
                "Priorität ist Niedrig, Normal, Hoch oder drei weitere Werte.",
                &["Priorität", "Niedrig", "Normal", "Hoch", "drei"],
                "Priorität ist Niedrig, Normal, Hoch und drei weitere Werte.",
                "de",
            ),
            (
                "Ich möchte in Dynamics 365 einen Datensatz ändern, den ich in diesem Chat nicht gelesen habe.",
                &["Dynamics 365"],
                "Ich möchte in Dynamics 365 nicht einen Datensatz ändern, den ich in diesem Chat gelesen habe.",
                "de",
            ),
            (
                "Beschreibung: ein Text von etwa 70 Wörtern, er steht auf dem Bildschirm.",
                &["Beschreibung", "70"],
                "Die Beschreibung ist ein Text von 70 Wörtern, er steht auf dem Bildschirm.",
                "de",
            ),
            (
                "Zu Labels kommen laut Tool Retrofit und Service dazu.",
                &["Labels", "Retrofit", "Service"],
                "Labels sind laut Tool Retrofit und Service.",
                "de",
            ),
            // A range where a change is meant.
            (
                "Risk level: from Low to Medium.",
                &["Risk level", "Low", "Medium"],
                "Risk level is from Low to Medium.",
                "en",
            ),
            (
                "Risikostufe: von Niedrig auf Mittel.",
                &["Risikostufe", "Niedrig", "Mittel"],
                "Die Risikostufe ist von Niedrig auf Mittel.",
                "de",
            ),
            // Earlier cases: another action, a dropped kind, a past stance,
            // a dropped hedge or pointer, a repeated fact, added words.
            (
                "Angebot freigeben.",
                &["Angebot freigeben"],
                "Ich möchte Angebot freigeben auflisten.",
                "de",
            ),
            (
                "The second one: a task, Angebot nachfassen.",
                &["Angebot nachfassen"],
                "The second one is Angebot nachfassen.",
                "en",
            ),
            (
                "Title laut Aufruf: Kickoff Line 4.",
                &["Title", "Kickoff Line 4"],
                "Title lautet Kickoff Line 4.",
                "de",
            ),
            (
                "I'd like to share a file with Planer in Google Drive whose ID is shown on screen.",
                &["Planer", "Google Drive"],
                "I'd like to share a file with Planer in Google Drive.",
                "en",
            ),
            (
                "Ich möchte in CRM einen Datensatz anlegen:",
                &["CRM"],
                "Ich möchte in CRM einen Datensatz anlegen: CRM",
                "de",
            ),
            (
                "Status: aktiv.",
                &["Status", "aktiv"],
                "Status: aktiv, ab morgen.",
                "de",
            ),
            (
                "Priority: High.",
                &["Priority", "High"],
                "Priority: High for all 2 tasks.",
                "en",
            ),
            (
                "The task is created.",
                &[],
                "The task is not created.",
                "en",
            ),
            (
                "Tags: Retrofit, Service und ein weiterer Eintrag.",
                &["Tags", "Retrofit", "Service"],
                "Tags: Retrofit, Service.",
                "de",
            ),
            // Markup, an invisible character, empty, too long.
            (
                "Status: aktiv.",
                &["Status", "aktiv"],
                "**Status**: aktiv.",
                "de",
            ),
            (
                "Status: aktiv.",
                &["Status", "aktiv"],
                "Status:\u{200B} aktiv.",
                "de",
            ),
            ("Status: aktiv.", &["Status", "aktiv"], "  ", "de"),
        ];
        for (precise, facts, wording, language) in rows {
            assert!(run(precise, facts, wording, language).is_err(), "{wording}");
        }
        let too_long = "Status: aktiv, der der der der der der der der der der der der der der der der der der der der der der der der der der der der der.";
        assert_eq!(
            run("Status: aktiv.", &["Status", "aktiv"], too_long, "de"),
            Err(Rejection::TooLong)
        );
    }

    #[test]
    fn guarded_words_cannot_be_allowed_by_configuration() {
        let configured: Vec<String> =
            ["nicht", "morgen", "zwei", "2", "ändern", "Aufgabe", "gerne"]
                .iter()
                .map(|word| (*word).to_string())
                .collect();
        assert_eq!(
            allowed_words("de", &configured),
            BTreeSet::from(["gerne".to_string()])
        );
    }

    #[test]
    fn a_language_without_insertions_only_keeps_the_piece() {
        let allowed = allowed_words("fr", &[]);
        assert!(allowed.is_empty());
        let facts = ["Statut".to_string(), "actif".to_string()];
        let precise = Precise {
            text: "Statut : actif.",
            facts: &facts,
        };
        assert_eq!(check(&precise, "Statut actif.", "fr", &allowed), Ok(()));
        assert!(check(&precise, "Le statut : actif.", "fr", &allowed).is_err());
    }
}
