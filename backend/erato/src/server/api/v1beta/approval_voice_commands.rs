//! What the user said while an approval card waits, as one meaning from a
//! closed list. The answer names no words to speak. With deciding by voice
//! on, an approval in the confirmation phrase or a refusal also gets a
//! receipt, which the decision then carries.

use super::approval_access::check_waiting_approval_of_user;
use super::me_profile_middleware::{MeProfile, normalize_supported_language};
use super::message_streaming::ParkedApprovalState;
use crate::models::message::VoiceDecisionOutcome;
use crate::policy::engine::PolicyEngine;
use crate::services::approval_voice_commands::decision::{
    RecordInput, VoiceReceipt, VoiceSignals, approval_is_screen_only, card_asked, card_digest,
    check_signals, only_points, record, stop_is_screen_only,
};
use crate::services::approval_voice_commands::phrase::{PhraseMatch, match_phrase};
use crate::services::approval_voice_commands::{
    CardPiece, Classified, DEFAULT_PROMPT, InputProblem, VoiceCommand, VoiceCommandInput,
    VoiceCommandSource, VoiceDecisionAnswer, VoiceDecisionStatus, VoiceMeaning, VoiceModel,
    VoiceQuestion, check_input, classify_by_model, classify_by_rules, classify_without_model,
    request_heard,
};
use crate::services::delegation::TaskModelPermissions;
use crate::services::sentry::log_internal_server_error;
use crate::state::AppState;
use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
};
use serde::Deserialize;
use std::time::{Duration, Instant};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Deserialize, ToSchema)]
pub struct ApprovalVoiceCommandRequest {
    /// What the user said, as transcribed. At most 300 characters.
    pub transcript: String,
    /// The language of the words as a tag such as `de`; the user's language
    /// when omitted.
    #[serde(default)]
    #[schema(nullable = false)]
    pub language: Option<String>,
    /// The spoken card's pieces in the order they are said, at most 16.
    pub pieces: Vec<CardPiece>,
    /// The piece being spoken, or the last one spoken.
    #[serde(default)]
    #[schema(nullable = false)]
    pub current_piece_id: Option<String>,
    /// What the voice just asked, when the words may answer it.
    #[serde(default)]
    #[schema(nullable = false)]
    pub question: Option<VoiceQuestion>,
    /// The approval the card asks about; deciding by voice needs it.
    #[serde(default)]
    #[schema(nullable = false)]
    pub approval_id: Option<String>,
    /// What the device measured about the recording; an approval by voice
    /// needs it.
    #[serde(default)]
    #[schema(nullable = false)]
    pub signals: Option<VoiceSignals>,
}

/// Match what the user said while an approval card waits to one meaning.
///
/// Built-in rules answer the plain words; a configured model may answer the
/// rest, seeing the words and the pieces' roles and field names. The answer
/// carries no text and is not stored. `approve` and `reject` count only once
/// the card's request piece was heard (or the card has none): a yes or no
/// before that, or beside a backchannel ("mhm, ja"), is `noise`.
///
/// With `[approval_voice_decisions]` on, `decision` says whether the words decide the
/// card. Only the whole confirmation phrase approves ("Ich bestätige", "I
/// confirm"), checked before any rule or model and never by a model; a
/// refusal by the rules or the model refuses. Either needs the turn's own
/// single call as `approval_id`, a card whose request was heard with nothing
/// owed, and for an approval a recording that started after the voice and
/// heard enough speech. An accepted decision gets a receipt, kept for
/// `receipt_ttl_seconds`, with a record of how it was given.
#[utoipa::path(
    post,
    path = "/me/messages/{message_id}/approval-voice-command",
    params(("message_id" = Uuid, Path, description = "The assistant message whose approval waits")),
    request_body = ApprovalVoiceCommandRequest,
    responses(
        (status = OK, body = VoiceCommand),
        (status = BAD_REQUEST, description = "Empty words, a piece id twice or empty, or a current piece that is not on the card"),
        (status = NOT_FOUND, description = "Voice commands are off, or the message does not exist or is not in a chat of the user"),
        (status = CONFLICT, description = "The message has no approval waiting for a decision"),
        (status = PAYLOAD_TOO_LARGE, description = "Words over 300 characters, more than 16 pieces, a piece id over 64 or a field name over 100 characters")
    ),
    security(("bearer_auth" = []))
)]
pub async fn interpret_approval_voice_command(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    Path(message_id): Path<Uuid>,
    Json(request): Json<ApprovalVoiceCommandRequest>,
) -> Result<Json<VoiceCommand>, StatusCode> {
    let config = &app_state.config.approval_voice_commands;
    if !config.enabled {
        return Err(StatusCode::NOT_FOUND);
    }
    let language = normalize_supported_language(request.language.as_deref())
        .or_else(|| normalize_supported_language(me_user.preference_language.as_deref()))
        .unwrap_or(&me_user.preferred_language)
        .to_string();
    let input = VoiceCommandInput {
        transcript: &request.transcript,
        language: &language,
        pieces: &request.pieces,
        current_piece_id: request.current_piece_id.as_deref(),
        question: request.question,
    };
    check_input(&input).map_err(|problem| match problem {
        InputProblem::TooLarge => StatusCode::PAYLOAD_TOO_LARGE,
        InputProblem::Invalid => StatusCode::BAD_REQUEST,
    })?;

    let waiting =
        check_waiting_approval_of_user(&app_state, &policy, &me_user, &message_id).await?;

    let start = Instant::now();
    let deciding = app_state.config.approval_voice_decisions.enabled;
    let phrase = deciding
        .then(|| {
            match_phrase(
                &request.transcript,
                &app_state
                    .config
                    .audio_conversational
                    .effective_hesitation_words(),
            )
        })
        .flatten();
    let mut classified = match &phrase {
        // As any yes said before the card asked: listening.
        Some(_) if !request_heard(&request.pieces) => Classified {
            command: VoiceCommand {
                meaning: VoiceMeaning::Noise,
                piece_id: None,
                source: VoiceCommandSource::Rules,
                decision: None,
            },
            outcome: "phrase_early",
        },
        Some(_) => Classified {
            command: VoiceCommand {
                meaning: VoiceMeaning::Approve,
                piece_id: None,
                source: VoiceCommandSource::Rules,
                decision: None,
            },
            outcome: "phrase",
        },
        None => match classify_by_rules(&input) {
            Some(classified) => classified,
            None => {
                let deadline = tokio::time::Instant::now()
                    + Duration::from_millis(u64::from(config.model_timeout_ms));
                ask_model(&app_state, &policy, &me_user, &input, deadline).await?
            }
        },
    };
    let mut refused_by = None;
    if deciding {
        let decided = decide(
            &app_state,
            &me_user,
            message_id,
            &waiting,
            &request,
            &language,
            &classified.command,
            phrase.as_ref(),
        )
        .await;
        classified.command.decision = decided.answer;
        refused_by = decided.problem;
    }
    // The user's words stay out of the log.
    tracing::info!(
        %message_id,
        meaning = classified.command.meaning.wire_name(),
        outcome = classified.outcome,
        decision = ?classified.command.decision.as_ref().map(|decision| decision.status),
        decision_problem = refused_by,
        elapsed_ms = start.elapsed().as_millis() as u64,
        "Matched a voice command on a waiting approval"
    );
    Ok(Json(classified.command))
}

struct Decided {
    answer: Option<VoiceDecisionAnswer>,
    /// Why a phrase did not approve, for the log.
    problem: Option<&'static str>,
}

/// Whether the words decide the card, and the receipt if they do.
#[allow(clippy::too_many_arguments)]
async fn decide(
    app_state: &AppState,
    me_user: &MeProfile,
    message_id: Uuid,
    waiting: &ParkedApprovalState,
    request: &ApprovalVoiceCommandRequest,
    language: &str,
    command: &VoiceCommand,
    phrase: Option<&PhraseMatch>,
) -> Decided {
    let outcome = match command.meaning {
        VoiceMeaning::Approve => VoiceDecisionOutcome::Approved,
        VoiceMeaning::Reject => VoiceDecisionOutcome::Refused,
        _ => {
            return Decided {
                answer: None,
                problem: None,
            };
        }
    };
    let answer = |status| Decided {
        answer: Some(VoiceDecisionAnswer {
            status,
            receipt: None,
        }),
        problem: None,
    };
    let decidable = waiting.decidable();
    if only_points(&request.pieces)
        || stop_is_screen_only(
            waiting.request.kind,
            &decidable,
            request.approval_id.as_deref(),
        )
    {
        return answer(VoiceDecisionStatus::ScreenOnly);
    }
    let item = &decidable[0];
    if outcome == VoiceDecisionOutcome::Approved && approval_is_screen_only(item) {
        return answer(VoiceDecisionStatus::ScreenOnly);
    }
    if !card_asked(&request.pieces) {
        return answer(VoiceDecisionStatus::NotYet);
    }
    let config = &app_state.config.approval_voice_decisions;
    let matched = match (outcome, phrase) {
        (VoiceDecisionOutcome::Approved, None) => {
            return answer(VoiceDecisionStatus::PhraseNeeded);
        }
        (VoiceDecisionOutcome::Approved, Some(matched)) => {
            if let Err(problem) = check_signals(
                request.signals.as_ref(),
                matched,
                config.echo_tail_ms,
                config.min_speech_ms_per_syllable,
            ) {
                return Decided {
                    problem: Some(problem.name()),
                    ..answer(VoiceDecisionStatus::SayAgain)
                };
            }
            Some(matched)
        }
        (VoiceDecisionOutcome::Refused, _) => None,
    };
    // A refusal from an older device without signals still refuses; it
    // is only not recorded.
    let Some(signals) = request.signals.as_ref() else {
        return answer(VoiceDecisionStatus::Accepted);
    };
    // A refusal keeps its words only when a rule matched them, so they are
    // a short refusal and nothing else the user said.
    let transcript_words;
    let matched_words = match matched {
        Some(matched) => matched.words.as_str(),
        None if command.source == VoiceCommandSource::Rules => {
            transcript_words = request.transcript.trim().to_lowercase();
            transcript_words.as_str()
        }
        None => "",
    };
    let record = record(RecordInput {
        user_id: &me_user.id,
        item,
        language,
        pieces: &request.pieces,
        required_phrase: matched.map(|matched| matched.phrase.id),
        matched_words,
        match_kind: matched.map(|matched| matched.kind),
        signals,
        outcome,
    });
    let receipt = app_state
        .voice_receipts
        .issue(VoiceReceipt {
            user_id: me_user.id.clone(),
            message_id,
            approval_id: item.approval_id.clone(),
            card_digest: card_digest(item),
            outcome,
            issued: Instant::now(),
            record,
        })
        .await;
    Decided {
        answer: Some(VoiceDecisionAnswer {
            status: VoiceDecisionStatus::Accepted,
            receipt: Some(receipt),
        }),
        problem: None,
    }
}

/// The model's answer, or "unclear" without one. Reading the user's model
/// permissions and the model call share one deadline.
async fn ask_model(
    app_state: &AppState,
    policy: &PolicyEngine,
    me_user: &MeProfile,
    input: &VoiceCommandInput<'_>,
    deadline: tokio::time::Instant,
) -> Result<Classified, StatusCode> {
    let provider = match app_state.chat_provider_for_approval_voice_commands() {
        Some(Ok(provider)) => provider,
        Some(Err(error)) => {
            tracing::warn!(%error, "Voice commands use the rules only: their provider is not usable");
            return Ok(classify_without_model("no_model"));
        }
        None => return Ok(classify_without_model("no_model")),
    };
    let subject = me_user.to_subject();
    let permitted = tokio::time::timeout_at(
        deadline,
        TaskModelPermissions::for_user(app_state, policy, &subject, &me_user.groups),
    )
    .await;
    match permitted {
        Ok(Ok(permissions)) if permissions.may_use(&provider.chat_provider_id) => {}
        Ok(Ok(_)) => {
            tracing::info!(
                "Voice commands use the rules only: the user's model permissions do not include their provider"
            );
            return Ok(classify_without_model("not_permitted"));
        }
        Ok(Err(error)) => {
            tracing::warn!(%error, "Voice commands use the rules only: reading the user's model permissions failed");
            return Ok(classify_without_model("permissions_failed"));
        }
        Err(_) => return Ok(classify_without_model("timeout")),
    }
    let client = app_state
        .genai_for_chat_provider_config_with_headers_context(
            provider.chat_provider_config.clone(),
            None,
        )
        .map_err(log_internal_server_error)?;
    let prompt = app_state
        .config
        .approval_voice_commands
        .prompt
        .as_deref()
        .map(str::trim)
        .filter(|prompt| !prompt.is_empty())
        .unwrap_or(DEFAULT_PROMPT);
    let model = VoiceModel {
        client: client.as_ref(),
        config: &provider.chat_provider_config,
        prompt,
        timeout: deadline.saturating_duration_since(tokio::time::Instant::now()),
    };
    Ok(classify_by_model(input, &model).await)
}
