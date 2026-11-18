//! The natural reading of a spoken approval card: a small model rewords the
//! card's precise pieces, and each wording is spoken only when the rule check
//! in [`check`] passes it. Every other piece, and every piece the model does
//! not answer in time, is spoken as the card composed it. Piece ids, roles,
//! order and count never change, so skipping, "the rest" and repeating work
//! the same in both styles.

pub mod check;
mod model;
mod words;

use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::config::ChatProviderConfig;
use crate::services::approval_voice_commands::CardPieceRole;
use crate::services::genai::GenAIClient;
pub use check::Rejection;
pub use model::DEFAULT_PROMPT;

/// The same bounds as the voice endpoint that speaks the pieces.
pub const MAX_PIECES: usize = 16;
pub const MAX_PIECE_CHARS: usize = 400;
pub const MAX_CARD_CHARS: usize = 2_000;
pub const MAX_PIECE_ID_CHARS: usize = 64;
pub const MAX_FACTS: usize = 24;
pub const MAX_FACT_CHARS: usize = 200;

/// One piece as the card composed it, with the words it says for each of
/// its values.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[schema(as = ApprovalRewordingPiece)]
pub struct RewordPiece {
    pub id: String,
    pub role: CardPieceRole,
    /// The precise sentence.
    pub text: String,
    /// The words `text` says for each value it is built from, in the card's
    /// order: names, dates, numbers, field names, the item. A wording must
    /// keep every one.
    #[serde(default)]
    pub facts: Vec<String>,
    /// A loss, a warning or a delete's subject: said even when the listener
    /// skips ahead, and never reworded.
    #[serde(default)]
    pub must_say: bool,
}

/// A piece as it is spoken: the precise text, or a wording that passed the
/// check.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[schema(as = ApprovalRewordedPiece)]
pub struct RewordedPiece {
    pub id: String,
    pub text: String,
    /// `text` is a checked wording, not the precise sentence.
    pub natural: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[schema(as = ApprovalRewording)]
pub struct Reworded {
    /// Every piece of the request, in its order, with its id.
    pub pieces: Vec<RewordedPiece>,
}

pub struct RewordInput<'a> {
    pub language: &'a str,
    pub pieces: &'a [RewordPiece],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputProblem {
    TooLarge,
    Invalid,
}

/// Pieces a wording may replace. A consequence, the request to decide and
/// every piece that must be said (a loss, the outside warning, a delete's
/// subject) are always the precise sentences; a count and a pointer say only
/// that.
pub fn rewordable(piece: &RewordPiece) -> bool {
    !piece.must_say
        && matches!(
            piece.role,
            CardPieceRole::What
                | CardPieceRole::Item
                | CardPieceRole::Detail
                | CardPieceRole::More
                | CardPieceRole::Text
        )
}

pub fn check_input(input: &RewordInput<'_>) -> Result<(), InputProblem> {
    let pieces = input.pieces;
    if pieces.is_empty() {
        return Err(InputProblem::Invalid);
    }
    let chars = |text: &str| text.chars().count();
    if pieces.len() > MAX_PIECES
        || pieces.iter().map(|piece| chars(&piece.text)).sum::<usize>() > MAX_CARD_CHARS
        || pieces.iter().any(|piece| {
            chars(&piece.text) > MAX_PIECE_CHARS
                || chars(&piece.id) > MAX_PIECE_ID_CHARS
                || piece.facts.len() > MAX_FACTS
                || piece.facts.iter().any(|fact| chars(fact) > MAX_FACT_CHARS)
        })
    {
        return Err(InputProblem::TooLarge);
    }
    let mut ids = BTreeSet::new();
    if pieces
        .iter()
        .any(|piece| piece.id.trim().is_empty() || !ids.insert(piece.id.as_str()))
        || !erato_config::spoken::is_language_tag(input.language)
    {
        return Err(InputProblem::Invalid);
    }
    Ok(())
}

/// The configured model.
pub struct RewordModel<'a> {
    pub client: &'a dyn GenAIClient,
    pub config: &'a ChatProviderConfig,
    pub prompt: &'a str,
    /// The words the language allows, already without the guarded ones.
    pub allowed: &'a BTreeSet<String>,
    pub timeout: Duration,
}

/// What was spoken and, for logs and the offline check, why.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Outcome {
    pub reworded: Reworded,
    /// `reworded`, `partly_reworded`, `none_passed`, `nothing_to_reword`, or
    /// why the model gave no answer.
    pub outcome: &'static str,
    /// The pieces whose wording failed the check.
    pub rejected: Vec<(String, Rejection)>,
    /// The model's wordings, checked or not, for the offline check.
    pub wordings: BTreeMap<String, String>,
    /// Input and output tokens of the model call, where the provider says.
    pub tokens: Option<(u64, u64)>,
}

/// Every piece as the card composed it.
pub fn precise(input: &RewordInput<'_>, outcome: &'static str) -> Outcome {
    Outcome {
        reworded: Reworded {
            pieces: input
                .pieces
                .iter()
                .map(|piece| RewordedPiece {
                    id: piece.id.clone(),
                    text: piece.text.clone(),
                    natural: false,
                })
                .collect(),
        },
        outcome,
        rejected: Vec::new(),
        wordings: BTreeMap::new(),
        tokens: None,
    }
}

/// The pieces with each answered wording that passes the check in place of
/// the precise text. A piece that is not rewordable keeps its text whatever
/// the answer holds for it.
pub fn apply(
    input: &RewordInput<'_>,
    wordings: BTreeMap<String, String>,
    allowed: &BTreeSet<String>,
) -> Outcome {
    let mut rejected = Vec::new();
    let mut natural = 0;
    let pieces = input
        .pieces
        .iter()
        .map(|piece| {
            let wording = wordings
                .get(&piece.id)
                .filter(|_| rewordable(piece))
                .map(|wording| wording.trim());
            let passed = wording.and_then(|wording| {
                let precise = check::Precise {
                    text: &piece.text,
                    facts: &piece.facts,
                };
                match check::check(&precise, wording, input.language, allowed) {
                    Ok(()) => Some(wording.to_string()),
                    Err(rejection) => {
                        rejected.push((piece.id.clone(), rejection));
                        None
                    }
                }
            });
            natural += usize::from(passed.is_some());
            RewordedPiece {
                id: piece.id.clone(),
                natural: passed.is_some(),
                text: passed.unwrap_or_else(|| piece.text.clone()),
            }
        })
        .collect();
    let asked = input
        .pieces
        .iter()
        .filter(|piece| rewordable(piece))
        .count();
    Outcome {
        reworded: Reworded { pieces },
        outcome: if natural == 0 {
            "none_passed"
        } else if natural == asked {
            "reworded"
        } else {
            "partly_reworded"
        },
        rejected,
        wordings,
        tokens: None,
    }
}

/// One model call for the whole card, then the check per piece.
pub async fn reword(input: &RewordInput<'_>, model: &RewordModel<'_>) -> Outcome {
    if !input.pieces.iter().any(rewordable) {
        return precise(input, "nothing_to_reword");
    }
    match model::ask(model, input).await {
        Ok((wordings, tokens)) => Outcome {
            tokens,
            ..apply(input, wordings, model.allowed)
        },
        Err(outcome) => precise(input, outcome),
    }
}

#[cfg(test)]
mod eval;
#[cfg(test)]
mod tests;
