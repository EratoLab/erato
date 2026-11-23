//! Deciding a waiting card by voice: which cards may be, what the recording
//! must show, and the short-lived receipt that lets the decision through.
//! An approval needs the phrase, a refusal a plain "nein"; both need a
//! recording that can carry a decision.

use super::phrase::PhraseMatchKind;
use super::{CardPiece, CardPieceRole, CardPieceState, request_heard};
use crate::models::message::{
    ApprovalItem, ToolApprovalKind, ToolCallAction, ToolCallLabel, ToolCallLabelSource,
    VoiceDecisionOutcome, VoiceDecisionPiece, VoiceDecisionRecord,
};
use crate::query_metrics::named_statement_from_sql_and_values;
use chrono::{DateTime, Utc};
use eyre::{Report, eyre};
use sea_orm::{ConnectionTrait, DatabaseConnection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::Duration;
use utoipa::ToSchema;
use uuid::Uuid;

/// More items than this stay a decision on screen.
pub const MAX_VOICE_ITEMS: u32 = 20;

/// What the device measured about the recording the words came from. Times
/// are milliseconds since the Unix epoch on the device's clock.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[schema(as = ApprovalVoiceSignals)]
pub struct VoiceSignals {
    /// When the voice last stopped speaking before the recording.
    pub voice_stopped_at_ms: u64,
    /// When the card's request to decide was heard in full.
    #[serde(default)]
    #[schema(nullable = false)]
    pub request_heard_at_ms: Option<u64>,
    pub recording_started_at_ms: u64,
    pub recording_ended_at_ms: u64,
    /// The first detector frame heard as speech.
    #[serde(default)]
    #[schema(nullable = false)]
    pub first_speech_at_ms: Option<u64>,
    /// Detector frames heard as speech, in milliseconds.
    pub speech_ms: u32,
    /// All detector frames of the recording, in milliseconds.
    pub recorded_ms: u32,
    /// The recording was opened while the voice spoke.
    #[serde(default)]
    pub over_voice: bool,
}

/// Why a decision by voice did not count.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SignalProblem {
    Missing,
    OverVoice,
    BeforeVoiceStopped,
    InEchoTail,
    TooLittleSpeech,
}

impl SignalProblem {
    pub fn name(self) -> &'static str {
        match self {
            Self::Missing => "no_signals",
            Self::OverVoice => "over_voice",
            Self::BeforeVoiceStopped => "before_voice_stopped",
            Self::InEchoTail => "in_echo_tail",
            Self::TooLittleSpeech => "too_little_speech",
        }
    }
}

/// Whether the recording can carry a decision: opened after the voice
/// stopped and not while it spoke, its first speech after the echo tail,
/// and enough speech for `syllables`.
pub fn check_signals(
    signals: &VoiceSignals,
    syllables: u32,
    echo_tail_ms: u32,
    min_speech_ms_per_syllable: u32,
) -> Result<(), SignalProblem> {
    if signals.over_voice {
        return Err(SignalProblem::OverVoice);
    }
    if signals.recording_started_at_ms < signals.voice_stopped_at_ms {
        return Err(SignalProblem::BeforeVoiceStopped);
    }
    let first_speech = signals
        .first_speech_at_ms
        .ok_or(SignalProblem::TooLittleSpeech)?;
    if first_speech
        < signals
            .voice_stopped_at_ms
            .saturating_add(u64::from(echo_tail_ms))
    {
        return Err(SignalProblem::InEchoTail);
    }
    if signals.speech_ms < syllables.saturating_mul(min_speech_ms_per_syllable) {
        return Err(SignalProblem::TooLittleSpeech);
    }
    Ok(())
}

/// Whether the voice only points to the screen for this card.
pub fn only_points(pieces: &[CardPiece]) -> bool {
    pieces
        .iter()
        .any(|piece| piece.role == CardPieceRole::Pointer)
}

/// Whether the card's request was heard and every piece that must be said
/// before the decision was too: a loss, a consequence, recipients outside,
/// and for an approval what the call does and on which record. A refusal
/// runs nothing, so it never waits for those. The device's own gate checks
/// the same; this keeps an older device honest.
pub fn card_asked(pieces: &[CardPiece], outcome: VoiceDecisionOutcome) -> bool {
    let asks = pieces
        .iter()
        .any(|piece| piece.role == CardPieceRole::Request);
    let names_the_call =
        |piece: &CardPiece| matches!(piece.role, CardPieceRole::What | CardPieceRole::Item);
    let owed = pieces.iter().any(|piece| {
        let must = match outcome {
            VoiceDecisionOutcome::Approved => piece.must_say || names_the_call(piece),
            VoiceDecisionOutcome::Refused => piece.must_say && !names_the_call(piece),
        } || matches!(
            piece.role,
            CardPieceRole::Consequence | CardPieceRole::Outside
        );
        must && piece.state != CardPieceState::Heard
    });
    asks && request_heard(pieces) && !owed && !only_points(pieces)
}

/// Why a stop is decided on screen only, for any decision by voice: it is
/// not the turn's own single call, that call's card needs a choice on
/// screen, or it is not `approval_id`.
pub fn stop_is_screen_only(
    kind: ToolApprovalKind,
    decidable: &[ApprovalItem],
    approval_id: Option<&str>,
) -> bool {
    let [item] = decidable else {
        return true;
    };
    !matches!(
        kind,
        ToolApprovalKind::McpTool | ToolApprovalKind::ClientTool
    ) || item.child.is_some()
        || item
            .chained
            .as_ref()
            .is_some_and(|chained| chained.decide_on_screen)
        || approval_id != Some(item.approval_id.as_str())
}

/// Whether an approval of this call is given on screen only: no label to
/// read from, a statement (SQL, also a plain read; code), a label warning,
/// or more than [`MAX_VOICE_ITEMS`] items. A refusal is still taken by
/// voice.
pub fn approval_is_screen_only(item: &ApprovalItem) -> bool {
    let Some(label) = item
        .display
        .as_ref()
        .and_then(|display| display.label.as_ref())
    else {
        return true;
    };
    label_is_screen_only(label)
}

pub fn label_is_screen_only(label: &ToolCallLabel) -> bool {
    // A read keeps a generic label but says what it looks at.
    let generic = label.read.is_none()
        && (label.source == ToolCallLabelSource::Generic || label.action == ToolCallAction::Other);
    let change = label.change.as_ref();
    let statement = label.read.as_ref().is_some_and(|read| read.query.is_some());
    generic
        || statement
        || !label.warnings.is_empty()
        || label.action == ToolCallAction::Run
        || change.is_some_and(|change| !change.opaque.is_empty() || change.opaque_omitted > 0)
        || item_count(label) > MAX_VOICE_ITEMS
}

/// How many things the call acts on, counted as the card counts them: the
/// batch's total, else the values of the first item's title (or id) slot.
fn item_count(label: &ToolCallLabel) -> u32 {
    if let Some(batch) = label
        .change
        .as_ref()
        .and_then(|change| change.batch.as_ref())
    {
        return batch.total;
    }
    label
        .items
        .first()
        .and_then(|item| {
            item.title
                .as_ref()
                .filter(|title| !title.values.is_empty())
                .or(item.id.as_ref())
        })
        .map_or(1, |slot| {
            (u32::try_from(slot.values.len()).unwrap_or(u32::MAX)).saturating_add(slot.omitted)
        })
        .max(1)
}

/// What the card asked about, for binding a decision to the version heard:
/// a corrected card has a new approval id and new arguments.
pub fn card_digest(item: &ApprovalItem) -> String {
    let mut hasher = Sha256::new();
    hasher.update(item.approval_id.as_bytes());
    hasher.update([0]);
    hasher.update(item.tool_name.as_bytes());
    hasher.update([0]);
    hasher.update(item.input.to_string().as_bytes());
    hasher.finalize()[..16]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn at(ms: u64) -> String {
    i64::try_from(ms)
        .ok()
        .and_then(DateTime::<Utc>::from_timestamp_millis)
        .unwrap_or_default()
        .to_rfc3339()
}

/// What is kept of one decision by voice.
pub struct RecordInput<'a> {
    pub user_id: &'a str,
    pub item: &'a ApprovalItem,
    pub language: &'a str,
    pub pieces: &'a [CardPiece],
    pub required_phrase: Option<&'a str>,
    pub matched_words: &'a str,
    pub match_kind: Option<PhraseMatchKind>,
    pub signals: &'a VoiceSignals,
    pub outcome: VoiceDecisionOutcome,
}

pub fn record(input: RecordInput<'_>) -> VoiceDecisionRecord {
    let signals = input.signals;
    VoiceDecisionRecord {
        user_id: input.user_id.to_string(),
        approval_id: input.item.approval_id.clone(),
        card_digest: card_digest(input.item),
        language: input.language.to_string(),
        pieces: input
            .pieces
            .iter()
            .map(|piece| VoiceDecisionPiece {
                id: piece.id.clone(),
                role: piece.role,
                state: piece.state,
            })
            .collect(),
        required_phrase: input.required_phrase.map(str::to_string),
        matched_words: input.matched_words.chars().take(100).collect(),
        match_kind: input.match_kind,
        request_heard_at: signals.request_heard_at_ms.map(at),
        voice_stopped_at: at(signals.voice_stopped_at_ms),
        recording_started_at: at(signals.recording_started_at_ms),
        recording_ended_at: at(signals.recording_ended_at_ms),
        matched_at: Utc::now().to_rfc3339(),
        speech_ms: signals.speech_ms,
        speech_frames_permille: if signals.recorded_ms == 0 {
            0
        } else {
            (u64::from(signals.speech_ms.min(signals.recorded_ms)) * 1000
                / u64::from(signals.recorded_ms)) as u16
        },
        answer_latency_ms: signals
            .request_heard_at_ms
            .zip(signals.first_speech_at_ms)
            .and_then(|(asked, spoke)| spoke.checked_sub(asked))
            .map(|ms| u32::try_from(ms).unwrap_or(u32::MAX)),
        outcome: input.outcome,
    }
}

/// A decision by voice the backend accepted, waiting for the decision to
/// arrive with its id.
#[derive(Debug, Clone)]
pub struct VoiceReceipt {
    pub user_id: Uuid,
    pub message_id: Uuid,
    pub approval_id: String,
    pub card_digest: String,
    pub outcome: VoiceDecisionOutcome,
    pub record: VoiceDecisionRecord,
}

/// A receipt as it was taken: still valid, or past its time.
#[derive(Debug, Clone)]
pub struct TakenReceipt {
    pub receipt: VoiceReceipt,
    pub expired: bool,
}

fn outcome_name(outcome: VoiceDecisionOutcome) -> &'static str {
    match outcome {
        VoiceDecisionOutcome::Approved => "approved",
        VoiceDecisionOutcome::Refused => "refused",
    }
}

/// Stores `receipt` for `ttl` and returns its id. A card has at most one: a
/// newer receipt for the same user and approval replaces the last. Receipts
/// past their time are cleared on the way.
pub async fn issue_receipt(
    db: &DatabaseConnection,
    receipt: &VoiceReceipt,
    ttl: Duration,
) -> Result<String, Report> {
    db.execute_raw(named_statement_from_sql_and_values(
        db.get_database_backend(),
        "voice_decision_receipts.clear_expired",
        "DELETE FROM voice_decision_receipts WHERE expires_at < now()",
        [],
    ))
    .await?;
    let row = db
        .query_one_raw(named_statement_from_sql_and_values(
            db.get_database_backend(),
            "voice_decision_receipts.issue",
            r#"INSERT INTO voice_decision_receipts
                   (user_id, message_id, approval_id, card_digest, outcome, record, expires_at)
               VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(secs => $7))
               ON CONFLICT (user_id, message_id, approval_id) DO UPDATE SET
                   id = public.uuidv7(),
                   card_digest = EXCLUDED.card_digest,
                   outcome = EXCLUDED.outcome,
                   record = EXCLUDED.record,
                   created_at = now(),
                   expires_at = EXCLUDED.expires_at
               RETURNING id"#,
            [
                receipt.user_id.into(),
                receipt.message_id.into(),
                receipt.approval_id.clone().into(),
                receipt.card_digest.clone().into(),
                outcome_name(receipt.outcome).into(),
                serde_json::to_value(&receipt.record)?.into(),
                (ttl.as_secs_f64()).into(),
            ],
        ))
        .await?
        .ok_or_else(|| eyre!("Storing a voice receipt returned no row"))?;
    let id: Uuid = row.try_get("", "id")?;
    Ok(id.to_string())
}

/// Takes the receipt with `id`, whoever stored it: it is gone afterwards.
/// `None` for an id that is no receipt.
pub async fn take_receipt(
    db: &DatabaseConnection,
    id: &str,
) -> Result<Option<TakenReceipt>, Report> {
    let Ok(id) = Uuid::parse_str(id) else {
        return Ok(None);
    };
    let Some(row) = db
        .query_one_raw(named_statement_from_sql_and_values(
            db.get_database_backend(),
            "voice_decision_receipts.take",
            r#"DELETE FROM voice_decision_receipts WHERE id = $1
               RETURNING user_id, message_id, approval_id, card_digest, outcome, record,
                   expires_at < now() AS expired"#,
            [id.into()],
        ))
        .await?
    else {
        return Ok(None);
    };
    let outcome: String = row.try_get("", "outcome")?;
    let record: serde_json::Value = row.try_get("", "record")?;
    Ok(Some(TakenReceipt {
        receipt: VoiceReceipt {
            user_id: row.try_get("", "user_id")?,
            message_id: row.try_get("", "message_id")?,
            approval_id: row.try_get("", "approval_id")?,
            card_digest: row.try_get("", "card_digest")?,
            outcome: match outcome.as_str() {
                "approved" => VoiceDecisionOutcome::Approved,
                "refused" => VoiceDecisionOutcome::Refused,
                other => return Err(eyre!("A voice receipt has the unknown outcome {other:?}")),
            },
            record: serde_json::from_value(record)?,
        },
        expired: row.try_get("", "expired")?,
    }))
}

/// Why a receipt does not let a decision through.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReceiptProblem {
    Unknown,
    Expired,
    OtherCard,
    OtherDecision,
}

/// Whether the taken receipt was issued to this user for this card, as it is
/// now, for this decision, and is not past its time.
pub fn check_receipt(
    taken: Option<&TakenReceipt>,
    user_id: Uuid,
    message_id: Uuid,
    item: &ApprovalItem,
    outcome: VoiceDecisionOutcome,
) -> Result<(), ReceiptProblem> {
    let taken = taken.ok_or(ReceiptProblem::Unknown)?;
    if taken.expired {
        return Err(ReceiptProblem::Expired);
    }
    let receipt = &taken.receipt;
    if receipt.user_id != user_id
        || receipt.message_id != message_id
        || receipt.approval_id != item.approval_id
        || receipt.card_digest != card_digest(item)
    {
        return Err(ReceiptProblem::OtherCard);
    }
    if receipt.outcome != outcome {
        return Err(ReceiptProblem::OtherDecision);
    }
    Ok(())
}
