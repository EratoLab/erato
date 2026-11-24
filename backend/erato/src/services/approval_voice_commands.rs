//! While an approval card waits in conversational audio mode, what the user
//! says is matched to one meaning from a closed list: skip, the rest, repeat,
//! read a long text, stop, a change request, a new request, a decision,
//! listening noise. Rules match the plain words; a configured model may pick
//! for the rest. Neither writes anything to be spoken. With deciding by
//! voice on, an approval needs the confirmation phrase (`phrase`), and
//! `decision` issues the receipt the decision then carries.

mod corpus;
pub mod decision;
mod model;
pub mod phrase;
pub mod recheck;
mod rules;
pub mod words;

use crate::config::ChatProviderConfig;
use crate::services::genai::GenAIClient;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use utoipa::ToSchema;

pub use model::DEFAULT_PROMPT;
pub use phrase::PhraseMatchKind;
pub use words::{CommandWords, CommandWordsByLanguage, StopWordLists};

pub const MAX_TRANSCRIPT_CHARS: usize = 300;
/// The card's pieces and the fields it says only when asked for by name.
pub const MAX_PIECES: usize = 32;
pub const MAX_PIECE_ID_CHARS: usize = 64;
pub const MAX_FIELD_CHARS: usize = 100;
/// Other names one field may carry: the card's own and a few languages'.
pub const MAX_FIELD_NAMES: usize = 6;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
#[schema(as = ApprovalVoiceMeaning)]
pub enum VoiceMeaning {
    /// Go on with the next piece.
    Skip,
    /// Say only what is left of the card.
    Rest,
    /// Say a piece again: the one named by its field, or the current one.
    Repeat,
    /// Read a long text of the card aloud.
    ReadText,
    Stop,
    /// The user wants the call done differently; their words are the request.
    Change,
    /// Something unrelated to the card.
    NewRequest,
    /// A clear, short agreement. Reported only; nothing acts on it.
    Approve,
    /// A clear, short refusal. Reported only; nothing acts on it.
    Reject,
    /// A backchannel or filler while listening, to be ignored.
    Noise,
    Unclear,
}

impl VoiceMeaning {
    pub const ALL: [VoiceMeaning; 11] = [
        Self::Skip,
        Self::Rest,
        Self::Repeat,
        Self::ReadText,
        Self::Stop,
        Self::Change,
        Self::NewRequest,
        Self::Approve,
        Self::Reject,
        Self::Noise,
        Self::Unclear,
    ];

    pub fn wire_name(self) -> &'static str {
        match self {
            Self::Skip => "skip",
            Self::Rest => "rest",
            Self::Repeat => "repeat",
            Self::ReadText => "read_text",
            Self::Stop => "stop",
            Self::Change => "change",
            Self::NewRequest => "new_request",
            Self::Approve => "approve",
            Self::Reject => "reject",
            Self::Noise => "noise",
            Self::Unclear => "unclear",
        }
    }

    fn is_decision(self) -> bool {
        matches!(self, Self::Approve | Self::Reject)
    }
}

/// What a piece of the spoken card is, as the card that speaks it names it.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, erato_memory::HeapSize,
)]
#[serde(rename_all = "snake_case")]
#[schema(as = ApprovalCardPieceRole)]
pub enum CardPieceRole {
    Count,
    What,
    Item,
    Detail,
    Outside,
    More,
    Text,
    Consequence,
    Request,
    Pointer,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, erato_memory::HeapSize,
)]
#[serde(rename_all = "snake_case")]
#[schema(as = ApprovalCardPieceState)]
pub enum CardPieceState {
    Heard,
    CutShort,
    NotSaid,
}

/// One piece of the spoken card, without what it says.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[schema(as = ApprovalCardPiece)]
pub struct CardPiece {
    pub id: String,
    pub role: CardPieceRole,
    /// For a detail or a long text: the field's name as the card shows it.
    #[serde(default)]
    pub field: Option<String>,
    pub state: CardPieceState,
    /// The card must say this piece before a decision counts: a loss, a
    /// consequence, recipients outside.
    #[serde(default)]
    pub must_say: bool,
    /// Other names of the field: as the card shows it, and as the vocabulary
    /// says it in each language. Words naming any of them name the piece.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub names: Vec<String>,
    /// A field the card counts as "more" and says only when asked for by
    /// name. Hearing it never stands in for any piece of the card.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub on_request: bool,
}

/// What the voice just asked about the card, when the user's words may
/// answer it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
#[schema(as = ApprovalVoiceQuestion)]
pub enum VoiceQuestion {
    /// Which of the card's long texts to read: a text's field named alone
    /// ("die Zusammenfassung") means reading that text.
    WhichText,
    /// Which of several fields to say: a field named alone means saying it.
    WhichField,
}

/// Where the meaning came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
#[schema(as = ApprovalVoiceCommandSource)]
pub enum VoiceCommandSource {
    Rules,
    Model,
    /// Neither matched: no model, or it failed, was late or answered off the list.
    None,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VoiceCommandInput<'a> {
    pub transcript: &'a str,
    pub language: &'a str,
    pub pieces: &'a [CardPiece],
    pub current_piece_id: Option<&'a str>,
    pub question: Option<VoiceQuestion>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[schema(as = ApprovalVoiceCommand)]
pub struct VoiceCommand {
    pub meaning: VoiceMeaning,
    /// For `repeat` and `read_text`: the piece meant. Null when the words do
    /// not say which and the card has no single candidate.
    pub piece_id: Option<String>,
    /// For `repeat` without a piece: the fields the words fit equally, for
    /// asking which one is meant instead of guessing.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub candidates: Vec<String>,
    pub source: VoiceCommandSource,
    /// For `approve` and `reject` while deciding by voice is on: whether the
    /// words decide the card.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub decision: Option<VoiceDecisionAnswer>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
#[schema(as = ApprovalVoiceDecisionStatus)]
pub enum VoiceDecisionStatus {
    /// The words decide the card: send the decision with the receipt.
    Accepted,
    /// An approval, but not in the confirmation phrase, or not from a
    /// recording that can carry one.
    PhraseNeeded,
    /// This card is decided on screen.
    ScreenOnly,
    /// The card has not asked yet, or something it must say is still owed.
    NotYet,
    /// The phrase, but from a recording that cannot carry an approval:
    /// opened while the voice spoke, said within its echo, or with too
    /// little speech for the words.
    SayAgain,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[schema(as = ApprovalVoiceDecision)]
pub struct VoiceDecisionAnswer {
    pub status: VoiceDecisionStatus,
    /// With `accepted`: the receipt the decision carries as `voice_receipt`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub receipt: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputProblem {
    TooLarge,
    Invalid,
}

/// The limits a request must keep. Ids must be unique and non-empty, and a
/// current piece must be one of them.
pub fn check_input(input: &VoiceCommandInput<'_>) -> Result<(), InputProblem> {
    if input.transcript.chars().count() > MAX_TRANSCRIPT_CHARS
        || input.pieces.len() > MAX_PIECES
        || input.pieces.iter().any(|piece| {
            piece.id.chars().count() > MAX_PIECE_ID_CHARS
                || piece
                    .field
                    .as_ref()
                    .is_some_and(|field| field.chars().count() > MAX_FIELD_CHARS)
                || piece.names.len() > MAX_FIELD_NAMES
                || piece
                    .names
                    .iter()
                    .any(|name| name.chars().count() > MAX_FIELD_CHARS)
        })
    {
        return Err(InputProblem::TooLarge);
    }
    let mut ids = std::collections::HashSet::new();
    if input.transcript.trim().is_empty()
        || input
            .pieces
            .iter()
            .any(|piece| piece.id.trim().is_empty() || !ids.insert(piece.id.as_str()))
        || input
            .current_piece_id
            .is_some_and(|current| !ids.contains(current))
    {
        return Err(InputProblem::Invalid);
    }
    Ok(())
}

/// The configured model, for words the rules do not match.
pub struct VoiceModel<'a> {
    pub client: &'a dyn GenAIClient,
    pub config: &'a ChatProviderConfig,
    pub prompt: &'a str,
    pub timeout: Duration,
}

/// The result, and for logs how it came about (never the user's words).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Classified {
    pub command: VoiceCommand,
    pub outcome: &'static str,
}

/// `words` are the lists of the card's language.
pub async fn classify(
    input: &VoiceCommandInput<'_>,
    words: &CommandWords,
    model: Option<VoiceModel<'_>>,
) -> Classified {
    if let Some(classified) = classify_by_rules(input, words) {
        return classified;
    }
    match model {
        Some(model) => classify_by_model(input, words, &model).await,
        None => classify_without_model("no_model"),
    }
}

/// The rules' answer, or `None` when they are not sure.
pub fn classify_by_rules(
    input: &VoiceCommandInput<'_>,
    words: &CommandWords,
) -> Option<Classified> {
    let found = rules::match_rules(input, words)?;
    let mut command = guarded(
        input,
        words,
        found.meaning,
        found.piece_id,
        VoiceCommandSource::Rules,
    );
    if command.meaning == VoiceMeaning::Repeat && command.piece_id.is_none() {
        command.candidates = found.candidates;
    }
    Some(Classified {
        command,
        outcome: "rules",
    })
}

pub async fn classify_by_model(
    input: &VoiceCommandInput<'_>,
    words: &CommandWords,
    model: &VoiceModel<'_>,
) -> Classified {
    match model::ask(model, input).await {
        Ok(answer) => from_answer(input, words, &answer),
        Err(outcome) => classify_without_model(outcome),
    }
}

/// "Unclear", for words the rules leave and no model answers.
pub fn classify_without_model(outcome: &'static str) -> Classified {
    Classified {
        command: unclear(),
        outcome,
    }
}

/// The model's answer once its piece is on the card and the guards let it pass.
fn from_answer(
    input: &VoiceCommandInput<'_>,
    words: &CommandWords,
    answer: &model::Answer,
) -> Classified {
    // "Read me the summary" for a field that is no long text is saying it.
    let meaning = match (answer.meaning, answer.piece_id.as_deref()) {
        (VoiceMeaning::ReadText, Some(id))
            if input.pieces.iter().any(|piece| {
                piece.id == id && piece.role == CardPieceRole::Detail && piece.field.is_some()
            }) =>
        {
            VoiceMeaning::Repeat
        }
        (meaning, _) => meaning,
    };
    match resolve_piece(input, meaning, answer.piece_id.as_deref()) {
        Some(piece_id) => {
            let command = guarded(input, words, meaning, piece_id, VoiceCommandSource::Model);
            let outcome = if command.meaning == answer.meaning {
                "model"
            } else {
                "model_guarded"
            };
            Classified { command, outcome }
        }
        None => Classified {
            command: unclear(),
            outcome: "wrong_piece",
        },
    }
}

fn unclear() -> VoiceCommand {
    VoiceCommand {
        meaning: VoiceMeaning::Unclear,
        piece_id: None,
        candidates: Vec::new(),
        source: VoiceCommandSource::None,
        decision: None,
    }
}

/// The piece a meaning refers to, from the piece the answer names. `None`
/// when the named piece is not on the card or cannot be meant.
fn resolve_piece(
    input: &VoiceCommandInput<'_>,
    meaning: VoiceMeaning,
    named: Option<&str>,
) -> Option<Option<String>> {
    let piece = match named {
        Some(id) => Some(input.pieces.iter().find(|piece| piece.id == id)?),
        None => None,
    };
    match meaning {
        VoiceMeaning::Repeat => Some(
            piece
                .map(|piece| piece.id.clone())
                .or_else(|| input.current_piece_id.map(str::to_string)),
        ),
        VoiceMeaning::ReadText => match piece {
            Some(piece) if piece.role == CardPieceRole::Text => Some(Some(piece.id.clone())),
            Some(_) => None,
            None => Some(default_text_piece(input)),
        },
        _ => Some(None),
    }
}

/// The text meant when the words name none: the current piece when it is a
/// text, else the card's only text.
fn default_text_piece(input: &VoiceCommandInput<'_>) -> Option<String> {
    let texts: Vec<&CardPiece> = input
        .pieces
        .iter()
        .filter(|piece| piece.role == CardPieceRole::Text)
        .collect();
    if let Some(current) = input
        .current_piece_id
        .and_then(|id| texts.iter().find(|piece| piece.id == id))
    {
        return Some(current.id.clone());
    }
    match texts.as_slice() {
        [only] => Some(only.id.clone()),
        _ => None,
    }
}

/// Whether the card has asked for a decision: its request piece was heard,
/// or it has none.
pub fn request_heard(pieces: &[CardPiece]) -> bool {
    pieces
        .iter()
        .filter(|piece| piece.role == CardPieceRole::Request)
        .all(|piece| piece.state == CardPieceState::Heard)
}

/// A decision only for a clear, short, unconditional sentence, a change only
/// once it says what to change, and a new request only when it cannot be a
/// change: otherwise "unclear". A yes or no said before the card asked, or
/// beside a backchannel ("mhm, ja"), is listening noise. The lists are those
/// of the card's language, so a language without words of its own, or a
/// script without spaces, decides on screen only.
fn guarded(
    input: &VoiceCommandInput<'_>,
    lists: &CommandWords,
    meaning: VoiceMeaning,
    piece_id: Option<String>,
    source: VoiceCommandSource,
) -> VoiceCommand {
    let words = rules::Words::with(input.transcript, lists);
    // Before the card asked, a clear yes or no is listening, whichever
    // stage heard it. Anything else the guards refuse stays unclear, so the
    // person gets an answer ("das reicht jetzt", "ja, aber dann …").
    if meaning.is_decision()
        && !request_heard(input.pieces)
        && (words.could_be_plain_decision(meaning, input.pieces) || words.is_backchannel_yes())
    {
        return VoiceCommand {
            meaning: VoiceMeaning::Noise,
            piece_id: None,
            candidates: Vec::new(),
            source,
            decision: None,
        };
    }
    let refused = (meaning.is_decision() && !words.could_be_plain_decision(meaning, input.pieces))
        || (meaning == VoiceMeaning::Change && words.breaks_off())
        || (meaning == VoiceMeaning::NewRequest && words.could_be_change(input.pieces));
    if refused {
        return unclear();
    }
    let meaning =
        if meaning.is_decision() && (words.is_backchannel_yes() || !request_heard(input.pieces)) {
            VoiceMeaning::Noise
        } else {
            meaning
        };
    VoiceCommand {
        meaning,
        piece_id,
        candidates: Vec::new(),
        source,
        decision: None,
    }
}

#[cfg(test)]
mod eval;
#[cfg(test)]
mod field_question_tests;
#[cfg(test)]
mod phrase_tests;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod words_tests;
