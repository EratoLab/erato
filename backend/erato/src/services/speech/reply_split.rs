//! A spoken reply written in one model call as two parts: what the voice says
//! inside `<spoken>…</spoken>`, then the complete written answer for the chat.
//! The protocol text and the parser live together because they change
//! together. A reply that does not keep the format falls back to today's
//! strict reading: the written text is the message and the voice reads it.

/// The built-in turn instruction that asks for the two parts: the format the
/// parser needs and what each part is for. It is English on purpose: the
/// model answers in the user's language whatever language the instruction is
/// in, and the parser depends on its exact markers. How the spoken part
/// sounds is `turn_instructions.spoken_reply`; [`SPOKEN_STYLE_FALLBACK`]
/// stands in when that is not set.
pub const SPOKEN_AND_WRITTEN_PROTOCOL: &str = "This reply is spoken aloud and also kept in the chat for reading later. \
Begin your reply with <spoken> and close that part with </spoken>: what the voice says, in plain sentences with no formatting. \
Instructions about how this reply is spoken apply to the spoken part only. \
After </spoken>, write the complete answer for the chat as you would for a typed message, in the normal chat style, with lists, tables and code where they help. \
It must stand on its own for a reader and contain any question you asked aloud. \
Write the written part whenever the reply holds a fact, number, date, name, source, list or step. \
Only for pure conversation (thanks, a greeting, a question back) may you write nothing after </spoken>. \
Before a tool call, write at most a short spoken part and no written part. \
A call that creates, changes, sends or deletes something is shown to the user as a confirmation card with every value it writes, and the user confirms that card. \
So before such a call the spoken part says only what you are preparing and for which record, for example \"I'm preparing the update to the opportunity.\" It does not say the values the call will write: the card says them. \
After tool results, begin again with <spoken>: the spoken part gives the result of a lookup, then the written answer follows. \
After a change has run, the spoken part confirms in one short sentence what was done, without reading out its values again.";

/// How long the spoken part is, for a deployment without a
/// `turn_instructions.spoken_reply` text of its own.
pub const SPOKEN_STYLE_FALLBACK: &str = "Keep the spoken part to one to three short sentences.";

/// The protocol's text as the model gets it.
pub fn protocol_text(spoken_style_configured: bool) -> String {
    if spoken_style_configured {
        SPOKEN_AND_WRITTEN_PROTOCOL.to_string()
    } else {
        format!("{SPOKEN_AND_WRITTEN_PROTOCOL} {SPOKEN_STYLE_FALLBACK}")
    }
}

/// A spoken part in the format it was written in.
pub fn spoken_markup(said: &str) -> String {
    format!("{OPEN}{}{CLOSE}", said.trim())
}

pub const OPEN: &str = "<spoken>";
pub const CLOSE: &str = "</spoken>";

/// Text held at the start of a model call while it could still become the
/// opening marker, leading whitespace included.
const START_HOLD_MAX: usize = 32;

/// A spoken part longer than this without its close is not a spoken part: a
/// model that reads a whole markdown answer into the voice is stopped here.
pub const SPOKEN_MAX_CHARS: usize = 1200;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Piece {
    /// For the voice and the spoken part of the message.
    Spoken(String),
    /// The spoken part is complete: the voice can say its last sentence now.
    SpokenEnd,
    /// For the chat only.
    Written(String),
    /// A reply without the format: for the chat, and the voice reads it as
    /// written, as before the split existed.
    Plain(String),
    /// What this call sent as spoken text is not a spoken part after all: it
    /// becomes the start of the written text, and the voice says no more of it.
    SpokenIsWritten,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fallback {
    NoOpen,
    Unclosed,
    TooLong,
}

impl Fallback {
    pub fn label(self) -> &'static str {
        match self {
            Self::NoOpen => "no_open",
            Self::Unclosed => "unclosed",
            Self::TooLong => "too_long",
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
enum State {
    #[default]
    Start,
    Spoken,
    Written,
    Plain,
}

/// Splits the text deltas of one generation whose turn asked for the format.
#[derive(Debug, Default)]
pub struct ReplySplit {
    state: State,
    held: String,
    spoken: String,
    spoken_chars: usize,
    written_started: bool,
    fallback: Option<Fallback>,
}

impl ReplySplit {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, text: &str) -> Vec<Piece> {
        self.held.push_str(text);
        let mut out = Vec::new();
        self.drain(false, &mut out);
        out
    }

    /// The end of one model call. The next call in the tool loop starts a
    /// new reply that may carry its own spoken part.
    pub fn finish(&mut self) -> Vec<Piece> {
        let mut out = Vec::new();
        self.drain(true, &mut out);
        let fallback = self.fallback;
        *self = Self::new();
        self.fallback = fallback;
        out
    }

    /// Why the last call fell back to plain reading, once.
    pub fn take_fallback(&mut self) -> Option<Fallback> {
        self.fallback.take()
    }

    fn say(&mut self, text: &str, out: &mut Vec<Piece>) {
        if text.is_empty() {
            return;
        }
        self.spoken.push_str(text);
        self.spoken_chars += text.chars().count();
        out.push(Piece::Spoken(text.to_string()));
    }

    fn demote(&mut self, out: &mut Vec<Piece>) {
        if !self.spoken.is_empty() {
            out.push(Piece::SpokenIsWritten);
        }
        self.spoken.clear();
        self.written_started = true;
    }

    /// The held text without the markers, up to a possible start of one.
    fn release(&mut self, end: bool) -> String {
        // A tag the model writes outside its place is removed from the chat.
        for tag in [OPEN, CLOSE] {
            if self.held.contains(tag) {
                self.held = self.held.replace(tag, "");
            }
        }
        let keep = if end {
            0
        } else {
            partial_suffix_len(&self.held, OPEN).max(partial_suffix_len(&self.held, CLOSE))
        };
        let rest = self.held.split_off(self.held.len() - keep);
        std::mem::replace(&mut self.held, rest)
    }

    fn drain(&mut self, end: bool, out: &mut Vec<Piece>) {
        loop {
            match self.state {
                State::Start => {
                    let trimmed = self.held.trim_start();
                    if let Some(rest) = trimmed.strip_prefix(OPEN) {
                        self.held = rest.to_string();
                        self.state = State::Spoken;
                        continue;
                    }
                    if !end && OPEN.starts_with(trimmed) && self.held.len() <= START_HOLD_MAX {
                        return;
                    }
                    if self.held.trim().is_empty() {
                        if end {
                            self.held.clear();
                        }
                        return;
                    }
                    self.fallback = Some(Fallback::NoOpen);
                    self.state = State::Plain;
                }
                State::Plain => {
                    let ready = self.release(end);
                    if !ready.is_empty() {
                        out.push(Piece::Plain(ready));
                    }
                    return;
                }
                State::Spoken => {
                    if let Some(at) = self.held.find(CLOSE) {
                        let rest = self.held.split_off(at + CLOSE.len());
                        let part = self.held[..at].to_string();
                        self.held = rest;
                        self.say(&part, out);
                        out.push(Piece::SpokenEnd);
                        self.state = State::Written;
                        self.written_started = false;
                        continue;
                    }
                    if end {
                        let part = std::mem::take(&mut self.held);
                        self.say(&part, out);
                        self.fallback = Some(Fallback::Unclosed);
                        self.demote(out);
                        self.state = State::Written;
                        return;
                    }
                    let ready = self.held.len() - partial_suffix_len(&self.held, CLOSE);
                    if self.spoken_chars + self.held[..ready].chars().count() > SPOKEN_MAX_CHARS {
                        self.fallback = Some(Fallback::TooLong);
                        self.demote(out);
                        self.state = State::Written;
                        continue;
                    }
                    let rest = self.held.split_off(ready);
                    let part = std::mem::replace(&mut self.held, rest);
                    self.say(&part, out);
                    return;
                }
                State::Written => {
                    if !self.written_started {
                        let trimmed = self.held.trim_start();
                        if trimmed.is_empty() {
                            self.held.clear();
                            return;
                        }
                        self.held = trimmed.to_string();
                        self.written_started = true;
                    }
                    let ready = self.release(end);
                    if !ready.is_empty() {
                        out.push(Piece::Written(ready));
                    }
                    return;
                }
            }
        }
    }
}

/// The length of the longest end of `text` that starts `tag`. Tags are
/// ASCII, so the cut is always on a character boundary.
fn partial_suffix_len(text: &str, tag: &str) -> usize {
    (1..tag.len())
        .rev()
        .find(|&length| text.ends_with(&tag[..length]))
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(chunks: &[&str]) -> Vec<Piece> {
        let mut split = ReplySplit::new();
        let mut out: Vec<Piece> = chunks.iter().flat_map(|chunk| split.push(chunk)).collect();
        out.extend(split.finish());
        merge(out)
    }

    /// Joins neighbouring pieces of one kind, so a test reads the result and
    /// not the chunking.
    fn merge(pieces: Vec<Piece>) -> Vec<Piece> {
        let mut merged: Vec<Piece> = Vec::new();
        for piece in pieces {
            match (merged.last_mut(), piece) {
                (Some(Piece::Spoken(a)), Piece::Spoken(b))
                | (Some(Piece::Written(a)), Piece::Written(b))
                | (Some(Piece::Plain(a)), Piece::Plain(b)) => a.push_str(&b),
                (_, piece) => merged.push(piece),
            }
        }
        merged
    }

    fn spoken(text: &str) -> Piece {
        Piece::Spoken(text.into())
    }

    fn written(text: &str) -> Piece {
        Piece::Written(text.into())
    }

    #[test]
    fn markers_split_across_chunks() {
        let text = "<spoken>Morgen um zwei.</spoken>\n\n| Tag | Zeit |\n|---|---|\n| Mo | 14:00 |";
        let expected = vec![
            spoken("Morgen um zwei."),
            Piece::SpokenEnd,
            written("| Tag | Zeit |\n|---|---|\n| Mo | 14:00 |"),
        ];
        for size in 1..=text.len() {
            let chunks: Vec<String> = text
                .chars()
                .collect::<Vec<_>>()
                .chunks(size)
                .map(|chunk| chunk.iter().collect())
                .collect();
            let chunks: Vec<&str> = chunks.iter().map(String::as_str).collect();
            assert_eq!(run(&chunks), expected, "chunk size {size}");
        }
    }

    #[test]
    fn leading_whitespace_before_the_marker_is_allowed() {
        assert_eq!(
            run(&["\n ", "<spo", "ken>Ja.</spoken>Mehr."]),
            vec![spoken("Ja."), Piece::SpokenEnd, written("Mehr.")]
        );
    }

    #[test]
    fn without_the_marker_the_reply_is_read_as_written() {
        let mut split = ReplySplit::new();
        let mut out = split.push("Hier sind ");
        out.extend(split.push("die Optionen."));
        out.extend(split.finish());
        assert_eq!(
            merge(out),
            vec![Piece::Plain("Hier sind die Optionen.".into())]
        );
        let mut split = ReplySplit::new();
        split.push("Hallo");
        assert_eq!(split.take_fallback(), Some(Fallback::NoOpen));
        assert_eq!(split.take_fallback(), None);
    }

    #[test]
    fn a_text_that_only_looks_like_the_marker_for_a_while_is_plain() {
        assert_eq!(
            run(&["<sp", "an>x</span>"]),
            vec![Piece::Plain("<span>x</span>".into())]
        );
    }

    #[test]
    fn an_unclosed_spoken_part_becomes_the_written_body() {
        let mut split = ReplySplit::new();
        let mut out = split.push("<spoken>Das ist alles.");
        out.extend(split.finish());
        assert_eq!(
            merge(out),
            vec![spoken("Das ist alles."), Piece::SpokenIsWritten]
        );
        assert_eq!(split.take_fallback(), Some(Fallback::Unclosed));
    }

    #[test]
    fn a_spoken_part_that_runs_too_long_becomes_written_and_the_voice_stops() {
        let long = "Satz. ".repeat(SPOKEN_MAX_CHARS / 6 + 10);
        let mut split = ReplySplit::new();
        let mut out = split.push("<spoken>Kurz.");
        out.extend(split.push(&long));
        out.extend(split.push("</spoken>Rest"));
        assert_eq!(split.take_fallback(), Some(Fallback::TooLong));
        out.extend(split.finish());
        let out = merge(out);
        assert_eq!(out[0], spoken("Kurz."));
        assert_eq!(out[1], Piece::SpokenIsWritten);
        assert_eq!(out[2], written(&format!("{long}Rest")));
        assert_eq!(out.len(), 3);
    }

    #[test]
    fn an_empty_written_part_and_stray_tags() {
        assert_eq!(
            run(&["<spoken>Gern.</spoken>\n\n"]),
            vec![spoken("Gern."), Piece::SpokenEnd]
        );
        assert_eq!(
            run(&["<spoken>Ja.</spoken>Text <spo", "ken>mit</spoken> Tags."]),
            vec![spoken("Ja."), Piece::SpokenEnd, written("Text mit Tags.")]
        );
    }

    #[test]
    fn each_model_call_starts_again() {
        let mut split = ReplySplit::new();
        let mut out = split.push("<spoken>Ich schaue nach.</spoken>");
        out.extend(split.finish());
        out.extend(
            split.push("<spoken>Morgen um 14 Uhr.</spoken>Der Termin ist am 3. März um 14:00."),
        );
        out.extend(split.finish());
        assert_eq!(
            merge(out),
            vec![
                spoken("Ich schaue nach."),
                Piece::SpokenEnd,
                spoken("Morgen um 14 Uhr."),
                Piece::SpokenEnd,
                written("Der Termin ist am 3. März um 14:00."),
            ]
        );
    }

    #[test]
    fn markers_after_a_preface_are_removed_from_the_plain_reply() {
        assert_eq!(
            run(&[
                "**Antwort:** <spo",
                "ken>Morgen um zwei.</spoken>\n\n| Tag |"
            ]),
            vec![Piece::Plain(
                "**Antwort:** Morgen um zwei.\n\n| Tag |".into()
            )]
        );
    }

    #[test]
    fn the_protocol_brings_its_own_length_only_without_a_configured_style() {
        assert!(protocol_text(false).ends_with(SPOKEN_STYLE_FALLBACK));
        assert_eq!(protocol_text(true), SPOKEN_AND_WRITTEN_PROTOCOL);
    }
}
