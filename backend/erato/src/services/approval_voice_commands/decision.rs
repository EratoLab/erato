//! Deciding a waiting card by voice: which cards may be, what the recording
//! must show, and the short-lived receipt that lets the decision through.
//! An approval needs the phrase; a refusal needs only a plain "nein".

use super::phrase::{PhraseMatch, PhraseMatchKind, syllables};
use super::{CardPiece, CardPieceRole, CardPieceState};
use crate::models::message::{
    ApprovalItem, ToolApprovalKind, ToolCallAction, ToolCallLabel, VoiceDecisionOutcome,
    VoiceDecisionPiece, VoiceDecisionRecord,
};
use chrono::{DateTime, Utc};
use moka::future::Cache;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use std::time::{Duration, Instant};
use utoipa::ToSchema;
use uuid::Uuid;

/// More items than this stay a decision on screen.
pub const MAX_VOICE_ITEMS: u32 = 20;
/// The longest a receipt is kept, whatever the setting says.
pub const MAX_RECEIPT_TTL: Duration = Duration::from_secs(600);

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

/// Whether the recording can carry an approval with `phrase`: opened after
/// the voice stopped, its first speech after the echo tail, and enough
/// speech for the phrase's syllables.
pub fn check_signals(
    signals: Option<&VoiceSignals>,
    matched: &PhraseMatch,
    echo_tail_ms: u32,
    min_speech_ms_per_syllable: u32,
) -> Result<(), SignalProblem> {
    let signals = signals.ok_or(SignalProblem::Missing)?;
    if signals.over_voice {
        return Err(SignalProblem::OverVoice);
    }
    if signals.recording_started_at_ms < signals.voice_stopped_at_ms {
        return Err(SignalProblem::BeforeVoiceStopped);
    }
    let first_speech = signals
        .first_speech_at_ms
        .ok_or(SignalProblem::TooLittleSpeech)?;
    if first_speech < signals.voice_stopped_at_ms + u64::from(echo_tail_ms) {
        return Err(SignalProblem::InEchoTail);
    }
    if signals.speech_ms < syllables(matched.phrase) * min_speech_ms_per_syllable {
        return Err(SignalProblem::TooLittleSpeech);
    }
    Ok(())
}

/// Whether the card's request was heard and every piece that must be said
/// before a decision (a loss, a consequence, recipients outside) was too.
/// The device's own gate checks the same; this keeps an older device honest.
pub fn card_asked(pieces: &[CardPiece]) -> bool {
    let request = pieces
        .iter()
        .any(|piece| piece.role == CardPieceRole::Request && piece.state == CardPieceState::Heard);
    let owed = pieces.iter().any(|piece| {
        matches!(
            piece.role,
            CardPieceRole::Consequence | CardPieceRole::Outside
        ) && piece.state != CardPieceState::Heard
    });
    request
        && !owed
        && !pieces
            .iter()
            .any(|piece| piece.role == CardPieceRole::Pointer)
}

/// Why a stop is decided on screen only, for any decision by voice: it is
/// not the turn's own single call, or that call is not `approval_id`.
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
        || approval_id != Some(item.approval_id.as_str())
}

/// Whether an approval of this call is given on screen only: no label to
/// read from, a statement the card cannot read (SQL, code), a label
/// warning, or more than [`MAX_VOICE_ITEMS`] items. A refusal is still
/// taken by voice.
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
    let generic = label.action == ToolCallAction::Other && label.read.is_none();
    let change = label.change.as_ref();
    generic
        || !label.warnings.is_empty()
        || label.action == ToolCallAction::Run
        || change.is_some_and(|change| !change.opaque.is_empty())
        || change
            .and_then(|change| change.batch.as_ref())
            .is_some_and(|batch| batch.total > MAX_VOICE_ITEMS)
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
                role: wire(&piece.role),
                state: wire(&piece.state),
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

fn wire<T: Serialize>(value: &T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_default()
}

/// A decision by voice the backend accepted, waiting for the decision to
/// arrive with its id.
#[derive(Debug, Clone)]
pub struct VoiceReceipt {
    pub user_id: String,
    pub message_id: Uuid,
    pub approval_id: String,
    pub card_digest: String,
    pub outcome: VoiceDecisionOutcome,
    pub issued: Instant,
    pub record: VoiceDecisionRecord,
}

/// Receipts by id, on this replica. Each is taken once.
#[derive(Clone)]
pub struct VoiceReceipts {
    receipts: Cache<String, Arc<VoiceReceipt>>,
}

impl Default for VoiceReceipts {
    fn default() -> Self {
        Self {
            receipts: Cache::builder()
                .max_capacity(10_000)
                .time_to_live(MAX_RECEIPT_TTL)
                .build(),
        }
    }
}

impl VoiceReceipts {
    pub async fn issue(&self, receipt: VoiceReceipt) -> String {
        let id = Uuid::new_v4().to_string();
        self.receipts.insert(id.clone(), Arc::new(receipt)).await;
        id
    }

    pub async fn take(&self, id: &str) -> Option<Arc<VoiceReceipt>> {
        self.receipts.remove(id).await
    }
}

/// Why a receipt does not let a decision through.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReceiptProblem {
    Unknown,
    Expired,
    OtherCard,
    OtherDecision,
}

/// Whether `receipt` was issued to this user for this card, as it is now,
/// for this decision, and not longer ago than `ttl`.
pub fn check_receipt(
    receipt: Option<&VoiceReceipt>,
    user_id: &str,
    message_id: Uuid,
    item: &ApprovalItem,
    outcome: VoiceDecisionOutcome,
    ttl: Duration,
) -> Result<(), ReceiptProblem> {
    let receipt = receipt.ok_or(ReceiptProblem::Unknown)?;
    if receipt.issued.elapsed() > ttl.min(MAX_RECEIPT_TTL) {
        return Err(ReceiptProblem::Expired);
    }
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
