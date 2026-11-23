use super::approval_access::check_waiting_approval_of_user;
use super::me_profile_middleware::{MeProfile, normalize_supported_language};
use crate::config::SpeechProviderConfig;
use crate::models::message::{ContentPart, MessageRole, MessageSchema, get_message_by_id};
use crate::policy::engine::PolicyEngine;
use crate::services::sentry::log_internal_server_error;
use crate::services::speech::session::{MAX_INPUT_BYTES, PassageSpeaker};
use crate::services::speech::spoken::{SpeechLanguage, plain_as_markdown, speakable};
use crate::state::AppState;
use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
    response::{
        IntoResponse, Response,
        sse::{Event, KeepAlive, Sse},
    },
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use utoipa::ToSchema;
use uuid::Uuid;

/// One event of a read aloud stream. The stream ends after `done` or `error`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "message_type", rename_all = "snake_case")]
pub enum ReadAloudStreamEvent {
    /// Base64 of signed 16-bit little-endian mono PCM.
    AudioDelta {
        sequence: u64,
        audio: String,
        sample_rate: u32,
        /// The piece of a spoken approval card the audio belongs to; absent
        /// when a message is read aloud.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[schema(nullable = false)]
        piece: Option<u32>,
    },
    /// Every audio chunk of this piece of a spoken approval card was sent.
    PieceDone { piece: u32 },
    /// Every passage of the message was spoken.
    Done,
    /// Speech synthesis failed; no further audio follows.
    Error,
}

impl ReadAloudStreamEvent {
    fn message_type(&self) -> &'static str {
        match self {
            Self::AudioDelta { .. } => "audio_delta",
            Self::PieceDone { .. } => "piece_done",
            Self::Done => "done",
            Self::Error => "error",
        }
    }
}

/// The speech for `pieces`, one after another, with the audio numbered across
/// them. `numbered` marks each chunk with its piece and ends each piece with
/// `piece_done`, for a client that plays them one at a time.
///
/// The speakers live in the response body: when the client disconnects the
/// body is dropped, and the provider request with it.
pub(super) fn speech_response(
    config: &SpeechProviderConfig,
    pieces: &[String],
    language: &SpeechLanguage,
    numbered: bool,
    message_id: Uuid,
) -> Result<Response, StatusCode> {
    struct Spoken {
        pieces: VecDeque<(u32, PassageSpeaker)>,
        sequence: u64,
    }
    let pieces = (0u32..)
        .zip(pieces)
        .map(|(index, text)| {
            PassageSpeaker::for_text(config, text, language.clone()).map(|speaker| (index, speaker))
        })
        .collect::<Result<VecDeque<_>, _>>()
        .map_err(log_internal_server_error)?;
    let events = futures::stream::unfold(
        Some(Spoken {
            pieces,
            sequence: 0,
        }),
        move |spoken| async move {
            let mut spoken = spoken?;
            let event = loop {
                let Some((piece, speaker)) = spoken.pieces.front_mut() else {
                    break ReadAloudStreamEvent::Done;
                };
                let piece = *piece;
                match speaker.next_chunk().await {
                    Ok(Some(chunk)) => {
                        let sequence = spoken.sequence;
                        spoken.sequence += 1;
                        break ReadAloudStreamEvent::AudioDelta {
                            sequence,
                            audio: STANDARD.encode(&chunk.pcm),
                            sample_rate: chunk.sample_rate,
                            piece: numbered.then_some(piece),
                        };
                    }
                    Ok(None) => {
                        spoken.pieces.pop_front();
                        if numbered {
                            break ReadAloudStreamEvent::PieceDone { piece };
                        }
                    }
                    Err(error) => {
                        tracing::warn!(%error, %message_id, "Speech for the reader failed");
                        break ReadAloudStreamEvent::Error;
                    }
                }
            };
            let next = matches!(
                event,
                ReadAloudStreamEvent::AudioDelta { .. } | ReadAloudStreamEvent::PieceDone { .. }
            )
            .then_some(spoken);
            let sse = Event::default()
                .event(event.message_type())
                .json_data(&event);
            Some((sse, next))
        },
    );

    Ok(Sse::new(events)
        .keep_alive(KeepAlive::new().interval(std::time::Duration::from_secs(5)))
        .into_response())
}

/// The language the user reads the app in, which speech is prepared for.
pub(super) fn speech_language(app_state: &AppState, me_user: &MeProfile) -> SpeechLanguage {
    SpeechLanguage::with_readings(
        normalize_supported_language(me_user.preference_language.as_deref())
            .unwrap_or(&me_user.preferred_language),
        &app_state.speech_readings,
    )
}

/// Speech in `spoken`, the language of what is said (any language code),
/// else in the user's language as [`speech_language`] has it.
pub(super) fn voice_language(
    app_state: &AppState,
    me_user: &MeProfile,
    spoken: Option<&str>,
) -> SpeechLanguage {
    match spoken.and_then(crate::services::spoken_language::language_code) {
        Some(code) => SpeechLanguage::with_readings(&code, &app_state.speech_readings),
        None => speech_language(app_state, me_user),
    }
}

/// A `language` a client sent with what the voice is to say: absent is the
/// user's language, a value that is no language code is refused.
pub(super) fn requested_language(language: Option<&str>) -> Result<Option<String>, StatusCode> {
    match language {
        None => Ok(None),
        Some(tag) => crate::services::spoken_language::language_code(tag)
            .map(Some)
            .ok_or(StatusCode::BAD_REQUEST),
    }
}

/// The prose of an assistant message: its text parts, without reasoning, tool calls or files.
fn message_text(content: &[ContentPart]) -> String {
    content
        .iter()
        .filter_map(|part| match part {
            ContentPart::Text(text) => Some(text.text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// Read one finished assistant message aloud.
///
/// Streams the audio while it is synthesised. Nothing is stored and the message is not changed;
/// closing the stream stops the speech provider request.
#[utoipa::path(
    post,
    path = "/me/messages/{message_id}/speech",
    params(("message_id" = Uuid, Path, description = "The assistant message to read aloud")),
    responses(
        (status = OK, content_type = "text/event-stream", body = ReadAloudStreamEvent),
        (status = BAD_REQUEST, description = "Not an assistant message, or it has no text to read"),
        (status = NOT_FOUND, description = "Read aloud is disabled, or the message does not exist or is not readable by the user"),
        (status = CONFLICT, description = "The message is still being generated"),
        (status = PAYLOAD_TOO_LARGE, description = "The message text exceeds 1 MiB")
    ),
    security(("bearer_auth" = []))
)]
pub async fn read_message_aloud(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    Path(message_id): Path<Uuid>,
) -> Result<Response, StatusCode> {
    let Some((_, provider_config)) = app_state
        .voice_switches()
        .await
        .read_aloud_speech_provider(&app_state.config)
    else {
        return Err(StatusCode::NOT_FOUND);
    };

    policy
        .rebuild_data_if_needed_req(&app_state.db, &app_state.config)
        .await?;

    // A message the user may not read answers like one that does not exist.
    let message = get_message_by_id(&app_state.db, &policy, &me_user.to_subject(), &message_id)
        .await
        .map_err(|error| {
            let text = error.to_string().to_lowercase();
            if text.contains("not found") || text.contains("not authorized") {
                StatusCode::NOT_FOUND
            } else {
                log_internal_server_error(error)
            }
        })?;

    if app_state
        .background_tasks
        .try_active_generation(&message.chat_id)
        .await
        .map_err(|error| log_internal_server_error(error.into()))?
        .is_some_and(|generation| generation.message_id() == Some(message_id))
    {
        return Err(StatusCode::CONFLICT);
    }

    let parsed =
        MessageSchema::validate(&message.raw_message).map_err(log_internal_server_error)?;
    if parsed.role != MessageRole::Assistant {
        return Err(StatusCode::BAD_REQUEST);
    }
    let text = message_text(&parsed.content);
    if text.len() > MAX_INPUT_BYTES {
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }
    // A reply to a spoken question is read in the language it was asked in.
    let spoken = crate::services::spoken_language::of_turn(&app_state.db, message_id)
        .await
        .unwrap_or_else(|error| {
            tracing::warn!(%error, "Cannot read the spoken language of the turn");
            None
        });
    let language = voice_language(&app_state, &me_user, spoken.as_deref());
    if speakable(&text, &language).trim().is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    speech_response(provider_config, &[text], &language, false, message_id)
}

/// Pieces a spoken approval card may have: what and where, the item, three
/// details, long texts, the consequence and the request, with room for a queue.
const MAX_CARD_PIECES: usize = 16;
const MAX_CARD_PIECE_CHARS: usize = 400;
const MAX_CARD_CHARS: usize = 2_000;

/// What a client says about the approval it shows.
#[derive(Debug, Deserialize, ToSchema)]
pub struct ApprovalSpeechRequest {
    /// The spoken card's pieces in the order they are said: plain sentences,
    /// at most 16 of them, each at most 400 and all together at most 2000
    /// characters.
    pub pieces: Vec<String>,
    /// The language the pieces are worded in, a code such as `de`; the
    /// user's language when omitted.
    #[serde(default)]
    #[schema(nullable = false, example = "de")]
    pub language: Option<String>,
}

/// Speak the approval a message of the user is waiting on.
///
/// The client composes the sentences from the card it shows; this only speaks
/// them, with the voice and cleaning of conversational mode's replies, piece
/// by piece. It answers only for a message of the user's own chat whose stop
/// still has a decision open, and stores nothing.
#[utoipa::path(
    post,
    path = "/me/messages/{message_id}/approval-speech",
    params(("message_id" = Uuid, Path, description = "The assistant message whose approval is spoken")),
    request_body = ApprovalSpeechRequest,
    responses(
        (status = OK, content_type = "text/event-stream", body = ReadAloudStreamEvent),
        (status = BAD_REQUEST, description = "No pieces, a piece with nothing to say, or a language that is not a language code"),
        (status = NOT_FOUND, description = "Conversational speech is off, or the message does not exist or is not in a chat of the user"),
        (status = CONFLICT, description = "The message has no approval waiting for a decision"),
        (status = PAYLOAD_TOO_LARGE, description = "More than 16 pieces, a piece over 400 characters, or more than 2000 characters in all")
    ),
    security(("bearer_auth" = []))
)]
pub async fn speak_approval(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    Path(message_id): Path<Uuid>,
    Json(request): Json<ApprovalSpeechRequest>,
) -> Result<Response, StatusCode> {
    let Some((_, provider_config)) = app_state
        .voice_switches()
        .await
        .conversational_speech_provider(&app_state.config)
    else {
        return Err(StatusCode::NOT_FOUND);
    };
    let pieces = request.pieces;
    if pieces.len() > MAX_CARD_PIECES
        || pieces
            .iter()
            .any(|piece| piece.chars().count() > MAX_CARD_PIECE_CHARS)
        || pieces
            .iter()
            .map(|piece| piece.chars().count())
            .sum::<usize>()
            > MAX_CARD_CHARS
    {
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }
    let requested = requested_language(request.language.as_deref())?;
    let language = voice_language(&app_state, &me_user, requested.as_deref());
    // The pieces are what the card shows; markdown in a value is not meant.
    let pieces: Vec<String> = pieces
        .iter()
        .map(|piece| plain_as_markdown(piece))
        .collect();
    if pieces.is_empty()
        || pieces
            .iter()
            .any(|piece| speakable(piece, &language).trim().is_empty())
    {
        return Err(StatusCode::BAD_REQUEST);
    }

    check_waiting_approval_of_user(&app_state, &policy, &me_user, &message_id).await?;

    speech_response(provider_config, &pieces, &language, true, message_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::message::{ContentPartReasoning, ContentPartText};

    #[test]
    fn only_the_written_text_is_read() {
        let content = vec![
            ContentPart::Reasoning(ContentPartReasoning::default()),
            ContentPart::Spoken(crate::models::message::ContentPartSpoken {
                text: "Kurz gesagt.".into(),
            }),
            ContentPart::Text(ContentPartText {
                text: "First.".into(),
            }),
            ContentPart::Text(ContentPartText {
                text: "Second.".into(),
            }),
        ];
        assert_eq!(message_text(&content), "First.\n\nSecond.");
    }

    #[test]
    fn events_carry_their_type_as_message_type() {
        let event = ReadAloudStreamEvent::AudioDelta {
            sequence: 3,
            audio: "AQID".into(),
            sample_rate: 24000,
            piece: None,
        };
        assert_eq!(
            serde_json::to_value(&event).unwrap(),
            serde_json::json!({
                "message_type": "audio_delta", "sequence": 3, "audio": "AQID", "sample_rate": 24000
            })
        );
        assert_eq!(
            serde_json::to_value(ReadAloudStreamEvent::PieceDone { piece: 2 }).unwrap(),
            serde_json::json!({ "message_type": "piece_done", "piece": 2 })
        );
        assert_eq!(
            serde_json::to_value(ReadAloudStreamEvent::Done).unwrap(),
            serde_json::json!({ "message_type": "done" })
        );
    }
}
