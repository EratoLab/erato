use super::me_profile_middleware::MeProfile;
use crate::models::message::{ContentPart, MessageRole, MessageSchema, get_message_by_id};
use crate::policy::engine::PolicyEngine;
use crate::services::sentry::log_internal_server_error;
use crate::services::speech::session::{MAX_INPUT_BYTES, PassageSpeaker};
use crate::state::AppState;
use axum::{
    Extension,
    extract::{Path, State},
    http::StatusCode,
    response::{
        IntoResponse, Response,
        sse::{Event, KeepAlive, Sse},
    },
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
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
    },
    /// Every passage of the message was spoken.
    Done,
    /// Speech synthesis failed; no further audio follows.
    Error,
}

impl ReadAloudStreamEvent {
    fn message_type(&self) -> &'static str {
        match self {
            Self::AudioDelta { .. } => "audio_delta",
            Self::Done => "done",
            Self::Error => "error",
        }
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
    let Some((_, provider_config)) = app_state.config.read_aloud_speech_provider() else {
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
    if crate::services::speech::sentences::speakable(&text)
        .trim()
        .is_empty()
    {
        return Err(StatusCode::BAD_REQUEST);
    }

    let speaker =
        PassageSpeaker::for_text(provider_config, &text).map_err(log_internal_server_error)?;

    // The speaker lives in the response body: when the client disconnects the body is dropped,
    // and the provider request with it.
    let events = futures::stream::unfold(Some(speaker), move |speaker| async move {
        let mut speaker = speaker?;
        let (event, next) = match speaker.next_chunk().await {
            Ok(Some(chunk)) => (
                ReadAloudStreamEvent::AudioDelta {
                    sequence: chunk.sequence,
                    audio: STANDARD.encode(&chunk.pcm),
                    sample_rate: chunk.sample_rate,
                },
                Some(speaker),
            ),
            Ok(None) => (ReadAloudStreamEvent::Done, None),
            Err(error) => {
                tracing::warn!(%error, %message_id, "Read aloud failed");
                (ReadAloudStreamEvent::Error, None)
            }
        };
        let sse = Event::default()
            .event(event.message_type())
            .json_data(&event);
        Some((sse, next))
    });

    Ok(Sse::new(events)
        .keep_alive(KeepAlive::new().interval(std::time::Duration::from_secs(5)))
        .into_response())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::message::{ContentPartReasoning, ContentPartText};

    #[test]
    fn only_text_parts_are_read() {
        let content = vec![
            ContentPart::Reasoning(ContentPartReasoning::default()),
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
        };
        assert_eq!(
            serde_json::to_value(&event).unwrap(),
            serde_json::json!({
                "message_type": "audio_delta", "sequence": 3, "audio": "AQID", "sample_rate": 24000
            })
        );
        assert_eq!(
            serde_json::to_value(ReadAloudStreamEvent::Done).unwrap(),
            serde_json::json!({ "message_type": "done" })
        );
    }
}
