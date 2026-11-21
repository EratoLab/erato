//! A spoken reply written in one model call as two parts: what the voice says
//! inside `<spoken>…</spoken>`, then the complete written answer for the chat.
//! The protocol text and the parser live together because they change
//! together. A reply that does not keep the format falls back to today's
//! strict reading: the written text is the message and the voice reads it.

/// The built-in turn instruction that asks for the two parts. It is English
/// on purpose: the model answers in the user's language whatever language
/// the instruction is in, and the parser depends on its exact markers.
pub const SPOKEN_AND_WRITTEN_PROTOCOL: &str = "This reply is spoken aloud and also kept in the chat for reading later. \
Begin your reply with <spoken> and close that part with </spoken>: what the voice says, one to three short plain sentences with no formatting. \
Instructions about how this reply is spoken apply to the spoken part only. \
After </spoken>, write the complete answer for the chat as you would for a typed message, in the normal chat style, with lists, tables and code where they help. \
It must stand on its own for a reader and contain any question you asked aloud. \
Write the written part whenever the reply holds a fact, number, date, name, source, list or step. \
Only for pure conversation (thanks, a greeting, a question back) may you write nothing after </spoken>. \
Before a tool call, write at most a short spoken part and no written part; the written answer comes after the results.";

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum State {
    Start,
    Spoken,
    Written,
    Plain,
}

/// Splits the text deltas of one generation. `speaking` is false on a turn
/// that is not read back (a typed turn in a chat whose history shows the
/// format): the spoken part is then dropped, unless nothing was written, in
/// which case it becomes the written text.
#[derive(Debug)]
pub struct ReplySplit {
    speaking: bool,
    state: State,
    held: String,
    spoken: String,
    spoken_chars: usize,
    wrote: bool,
    written_started: bool,
    fallback: Option<Fallback>,
}

impl ReplySplit {
    pub fn new(speaking: bool) -> Self {
        Self {
            speaking,
            state: State::Start,
            held: String::new(),
            spoken: String::new(),
            spoken_chars: 0,
            wrote: false,
            written_started: false,
            fallback: None,
        }
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
        if !self.speaking && !self.wrote && !self.spoken.trim().is_empty() {
            out.push(Piece::Written(std::mem::take(&mut self.spoken)));
        }
        let fallback = self.fallback;
        *self = Self::new(self.speaking);
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
        if self.speaking {
            out.push(Piece::Spoken(text.to_string()));
        }
    }

    fn demote(&mut self, out: &mut Vec<Piece>) {
        if self.speaking {
            if !self.spoken.is_empty() {
                out.push(Piece::SpokenIsWritten);
            }
        } else if !self.spoken.is_empty() {
            out.push(Piece::Written(self.spoken.clone()));
        }
        self.wrote |= !self.spoken.trim().is_empty();
        self.spoken.clear();
        self.written_started = true;
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
                    if !self.held.is_empty() {
                        self.wrote |= !self.held.trim().is_empty();
                        out.push(Piece::Plain(std::mem::take(&mut self.held)));
                    }
                    return;
                }
                State::Spoken => {
                    if let Some(at) = self.held.find(CLOSE) {
                        let rest = self.held.split_off(at + CLOSE.len());
                        let part = self.held[..at].to_string();
                        self.held = rest;
                        self.say(&part, out);
                        if self.speaking {
                            out.push(Piece::SpokenEnd);
                        }
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
                    // A tag the model repeats later is removed from the chat.
                    for tag in [OPEN, CLOSE] {
                        if self.held.contains(tag) {
                            self.held = self.held.replace(tag, "");
                        }
                    }
                    let keep = if end {
                        0
                    } else {
                        partial_suffix_len(&self.held, OPEN)
                            .max(partial_suffix_len(&self.held, CLOSE))
                    };
                    let rest = self.held.split_off(self.held.len() - keep);
                    let ready = std::mem::replace(&mut self.held, rest);
                    if !ready.is_empty() {
                        self.wrote |= !ready.trim().is_empty();
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

    fn run(speaking: bool, chunks: &[&str]) -> Vec<Piece> {
        let mut split = ReplySplit::new(speaking);
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
            assert_eq!(run(true, &chunks), expected, "chunk size {size}");
        }
    }

    #[test]
    fn leading_whitespace_before_the_marker_is_allowed() {
        assert_eq!(
            run(true, &["\n ", "<spo", "ken>Ja.</spoken>Mehr."]),
            vec![spoken("Ja."), Piece::SpokenEnd, written("Mehr.")]
        );
    }

    #[test]
    fn without_the_marker_the_reply_is_read_as_written() {
        let mut split = ReplySplit::new(true);
        let mut out = split.push("Hier sind ");
        out.extend(split.push("die Optionen."));
        out.extend(split.finish());
        assert_eq!(
            merge(out),
            vec![Piece::Plain("Hier sind die Optionen.".into())]
        );
        // The fallback is counted where the format was asked for.
        let mut split = ReplySplit::new(true);
        split.push("Hallo");
        assert_eq!(split.take_fallback(), Some(Fallback::NoOpen));
        assert_eq!(split.take_fallback(), None);
    }

    #[test]
    fn a_text_that_only_looks_like_the_marker_for_a_while_is_plain() {
        assert_eq!(
            run(true, &["<sp", "an>x</span>"]),
            vec![Piece::Plain("<span>x</span>".into())]
        );
    }

    #[test]
    fn an_unclosed_spoken_part_becomes_the_written_body() {
        let mut split = ReplySplit::new(true);
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
        let mut split = ReplySplit::new(true);
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
            run(true, &["<spoken>Gern.</spoken>\n\n"]),
            vec![spoken("Gern."), Piece::SpokenEnd]
        );
        assert_eq!(
            run(
                true,
                &["<spoken>Ja.</spoken>Text <spo", "ken>mit</spoken> Tags."]
            ),
            vec![spoken("Ja."), Piece::SpokenEnd, written("Text mit Tags.")]
        );
    }

    #[test]
    fn each_model_call_starts_again() {
        let mut split = ReplySplit::new(true);
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
    fn a_turn_that_is_not_read_back_drops_the_spoken_part() {
        assert_eq!(
            run(false, &["<spoken>Kurz.</spoken>Die ganze Antwort."]),
            vec![written("Die ganze Antwort.")]
        );
        assert_eq!(
            run(false, &["<spoken>Gern geschehen.</spoken>"]),
            vec![written("Gern geschehen.")]
        );
        assert_eq!(
            run(false, &["<spoken>Nie geschlossen"]),
            vec![written("Nie geschlossen")]
        );
        assert_eq!(
            run(false, &["Normale Antwort."]),
            vec![Piece::Plain("Normale Antwort.".into())]
        );
    }
}
