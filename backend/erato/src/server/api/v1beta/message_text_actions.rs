//! Actions on text the user marked in a chat message. Each one is a side call
//! to a model that reads the message and stores nothing.

use super::me_profile_middleware::{MeProfile, normalize_supported_language};
use crate::models;
use crate::models::message::{ContentPart, MessageSchema};
use crate::policy::engine::PolicyEngine;
use crate::services::genai::build_chat_options_for_completion;
use crate::state::AppState;
use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
    response::sse::{Event, KeepAlive, Sse},
};
use futures::{Stream, StreamExt};
use genai::chat::{ChatMessage as GenAiChatMessage, ChatRequest, ChatStreamEvent, StreamChunk};
use sea_orm::prelude::Uuid;
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use utoipa::ToSchema;

pub const EXPLAIN_MAX_SELECTED_TEXT_CHARS: usize = 4_000;
/// Questions and answers together: ten follow-ups with their answers.
pub const EXPLAIN_MAX_TURNS: usize = 20;
pub const EXPLAIN_MAX_TURN_CHARS: usize = 8_000;
const EXPLAIN_MAX_CONTEXT_CHARS: usize = 24_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MessageExplainTurnRole {
    User,
    Assistant,
}

/// One entry of the small chat an explanation opened.
#[derive(Debug, Deserialize, ToSchema)]
pub struct MessageExplainTurn {
    pub role: MessageExplainTurnRole,
    pub text: String,
}

/// Request to explain a passage of a message. The server keeps nothing, so a
/// follow-up question carries the whole small chat so far.
#[derive(Debug, Deserialize, ToSchema)]
pub struct MessageExplainRequest {
    /// The text the user marked in the message.
    pub selected_text: String,
    /// Empty for the first explanation; otherwise the explanations and
    /// follow-up questions so far, ending with the question to answer.
    #[serde(default)]
    pub turns: Vec<MessageExplainTurn>,
    /// Language of the user interface, as a language tag such as `de`.
    #[serde(default)]
    #[schema(nullable = false)]
    pub language: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MessageExplainTextDelta {
    pub text: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MessageExplainCompleted {}

#[derive(Debug, Serialize, ToSchema)]
pub struct MessageExplainFailed {}

#[derive(Debug, Serialize, ToSchema)]
#[serde(tag = "message_type", rename_all = "snake_case")]
pub enum MessageExplainStreamingResponseMessage {
    TextDelta(MessageExplainTextDelta),
    Completed(MessageExplainCompleted),
    /// The model call failed after the stream had opened.
    Failed(MessageExplainFailed),
}

impl MessageExplainStreamingResponseMessage {
    fn event_name(&self) -> &'static str {
        match self {
            Self::TextDelta(_) => "text_delta",
            Self::Completed(_) => "completed",
            Self::Failed(_) => "failed",
        }
    }

    fn to_sse(&self) -> Event {
        Event::default()
            .event(self.event_name())
            .json_data(self)
            .expect("explain events serialize")
    }
}

fn validate_request(request: &MessageExplainRequest) -> Result<(), StatusCode> {
    let selected_chars = request.selected_text.chars().count();
    if request.selected_text.trim().is_empty() || selected_chars > EXPLAIN_MAX_SELECTED_TEXT_CHARS {
        return Err(StatusCode::BAD_REQUEST);
    }
    if request.turns.len() > EXPLAIN_MAX_TURNS {
        return Err(StatusCode::BAD_REQUEST);
    }
    if request.turns.iter().any(|turn| {
        turn.text.trim().is_empty() || turn.text.chars().count() > EXPLAIN_MAX_TURN_CHARS
    }) {
        return Err(StatusCode::BAD_REQUEST);
    }
    // The model answers the last entry, so it has to be a question.
    if request
        .turns
        .last()
        .is_some_and(|turn| turn.role != MessageExplainTurnRole::User)
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(())
}

fn message_text(message: &MessageSchema) -> String {
    message
        .content
        .iter()
        .filter_map(|part| match part {
            ContentPart::Text(text) => Some(text.text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// The part of the message the model reads. A long message is cut to a window
/// around the passage; the marked text is rendered text, so it is found by
/// its first line only and the window falls back to the start.
fn context_window(text: &str, selected_text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= EXPLAIN_MAX_CONTEXT_CHARS {
        return text.to_string();
    }
    let needle = selected_text.lines().next().unwrap_or_default().trim();
    let match_char_index = (!needle.is_empty())
        .then(|| text.find(needle))
        .flatten()
        .map(|byte_index| text[..byte_index].chars().count())
        .unwrap_or(0);
    let start = match_char_index
        .saturating_sub(EXPLAIN_MAX_CONTEXT_CHARS / 2)
        .min(chars.len() - EXPLAIN_MAX_CONTEXT_CHARS);
    chars[start..start + EXPLAIN_MAX_CONTEXT_CHARS]
        .iter()
        .collect()
}

fn language_name(language: &str) -> &'static str {
    match language {
        "de" => "German",
        "fr" => "French",
        "pl" => "Polish",
        "es" => "Spanish",
        _ => "English",
    }
}

fn build_chat_request(
    system_prompt: String,
    language: &str,
    source_text: &str,
    request: MessageExplainRequest,
) -> ChatRequest {
    let system = format!(
        "{}\n\nAnswer in {}.",
        system_prompt.trim(),
        language_name(language)
    );
    let opening = format!(
        "This is the message the passage comes from:\n\n<message>\n{}\n</message>\n\nExplain this passage of it:\n\n<passage>\n{}\n</passage>",
        context_window(source_text, &request.selected_text),
        request.selected_text.trim()
    );
    let mut chat_request = ChatRequest::default()
        .append_message(GenAiChatMessage::system(system))
        .append_message(GenAiChatMessage::user(opening));
    for turn in request.turns {
        chat_request = chat_request.append_message(match turn.role {
            MessageExplainTurnRole::User => GenAiChatMessage::user(turn.text),
            MessageExplainTurnRole::Assistant => GenAiChatMessage::assistant(turn.text),
        });
    }
    chat_request
}

/// Explain a passage of a message in simple words.
///
/// Streams the explanation, or the answer to the last follow-up question in
/// `turns`. Nothing is stored: no chat, message or title is written.
#[utoipa::path(
    post,
    path = "/me/messages/{message_id}/explain",
    params(
        ("message_id" = String, Path, description = "The message the marked text belongs to")
    ),
    request_body = MessageExplainRequest,
    responses(
        (status = OK, content_type = "text/event-stream", body = MessageExplainStreamingResponseMessage),
        (status = BAD_REQUEST, description = "Invalid message ID, or the marked text or the turns exceed the limits"),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided"),
        (status = FORBIDDEN, description = "When the user may not read the chat of the message"),
        (status = NOT_FOUND, description = "When the Explain action is not enabled, or the message does not exist"),
        (status = INTERNAL_SERVER_ERROR, description = "Server error")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn explain_message_text(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    Path(message_id): Path<String>,
    Json(request): Json<MessageExplainRequest>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, StatusCode> {
    let explain = &app_state.config.message_text_actions.explain;
    if !explain.enabled {
        return Err(StatusCode::NOT_FOUND);
    }
    let message_id = Uuid::parse_str(&message_id).map_err(|_| StatusCode::BAD_REQUEST)?;
    validate_request(&request)?;

    policy
        .rebuild_data_if_needed_req(&app_state.db, &app_state.config)
        .await?;
    let message = models::message::get_message_by_id(
        &app_state.db,
        &policy,
        &me_user.to_subject(),
        &message_id,
    )
    .await
    .map_err(|error| {
        if error.to_string().to_lowercase().contains("not found") {
            StatusCode::NOT_FOUND
        } else {
            tracing::warn!("Explain was refused for message {message_id}: {error}");
            StatusCode::FORBIDDEN
        }
    })?;
    let source = MessageSchema::validate(&message.raw_message).map_err(|error| {
        tracing::error!("Explain could not read message {message_id}: {error}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let prompt_spec = explain.prompt.as_ref().ok_or_else(|| {
        tracing::error!("Explain is enabled but no prompt is configured");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    let system_prompt = app_state
        .resolve_prompt_source(prompt_spec)
        .await
        .map_err(|error| {
            tracing::error!("Failed to resolve the Explain prompt: {error}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    let provider = app_state
        .chat_provider_for_message_explain()
        .map_err(|error| {
            tracing::error!("Failed to get the Explain chat provider: {error}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    let chat_options = build_chat_options_for_completion(
        &provider.chat_provider_config.model_settings,
        &provider.chat_provider_config.model_capabilities,
    );
    let language = normalize_supported_language(request.language.as_deref())
        .unwrap_or(me_user.profile.preferred_language.as_str())
        .to_string();
    let chat_request =
        build_chat_request(system_prompt, &language, &message_text(&source), request);

    let provider_stream = app_state
        .genai_for_chat_provider_config_with_headers_context(provider.chat_provider_config, None)
        .map_err(|error| {
            tracing::error!("Failed to build the Explain client: {error}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?
        .exec_chat_stream("PLACEHOLDER_MODEL", chat_request, Some(&chat_options))
        .await
        .map_err(|error| {
            tracing::error!("Failed to start the explanation: {error}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?
        .stream;

    let events = futures::stream::unfold(Some(provider_stream), |state| async move {
        let mut provider_stream = state?;
        loop {
            let message = match provider_stream.next().await {
                Some(Ok(ChatStreamEvent::Chunk(StreamChunk { content }))) => {
                    if content.is_empty() {
                        continue;
                    }
                    MessageExplainStreamingResponseMessage::TextDelta(MessageExplainTextDelta {
                        text: content,
                    })
                }
                Some(Ok(ChatStreamEvent::End(_))) | None => {
                    return Some((
                        MessageExplainStreamingResponseMessage::Completed(
                            MessageExplainCompleted {},
                        ),
                        None,
                    ));
                }
                Some(Ok(_)) => continue,
                Some(Err(error)) => {
                    tracing::error!("The explanation stream failed: {error}");
                    return Some((
                        MessageExplainStreamingResponseMessage::Failed(MessageExplainFailed {}),
                        None,
                    ));
                }
            };
            return Some((message, Some(provider_stream)));
        }
    })
    .map(|message| Ok(message.to_sse()));

    Ok(Sse::new(events).keep_alive(KeepAlive::new().interval(std::time::Duration::from_secs(15))))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(
        selected_text: &str,
        turns: Vec<(MessageExplainTurnRole, &str)>,
    ) -> MessageExplainRequest {
        MessageExplainRequest {
            selected_text: selected_text.to_string(),
            turns: turns
                .into_iter()
                .map(|(role, text)| MessageExplainTurn {
                    role,
                    text: text.to_string(),
                })
                .collect(),
            language: None,
        }
    }

    #[test]
    fn marked_text_must_be_present_and_within_the_limit() {
        assert!(validate_request(&request("a term", vec![])).is_ok());
        assert_eq!(
            validate_request(&request("  \n", vec![])),
            Err(StatusCode::BAD_REQUEST)
        );
        let at_limit = "ä".repeat(EXPLAIN_MAX_SELECTED_TEXT_CHARS);
        assert!(validate_request(&request(&at_limit, vec![])).is_ok());
        let over_limit = "ä".repeat(EXPLAIN_MAX_SELECTED_TEXT_CHARS + 1);
        assert_eq!(
            validate_request(&request(&over_limit, vec![])),
            Err(StatusCode::BAD_REQUEST)
        );
    }

    #[test]
    fn turns_are_bounded_and_end_with_a_question() {
        use MessageExplainTurnRole::{Assistant, User};
        assert!(
            validate_request(&request(
                "term",
                vec![(Assistant, "It means X."), (User, "Why?")]
            ))
            .is_ok()
        );
        assert_eq!(
            validate_request(&request("term", vec![(Assistant, "It means X.")])),
            Err(StatusCode::BAD_REQUEST)
        );
        assert_eq!(
            validate_request(&request("term", vec![(User, " ")])),
            Err(StatusCode::BAD_REQUEST)
        );
        let long = "x".repeat(EXPLAIN_MAX_TURN_CHARS + 1);
        assert_eq!(
            validate_request(&request("term", vec![(User, long.as_str())])),
            Err(StatusCode::BAD_REQUEST)
        );
        let full: Vec<_> = (0..EXPLAIN_MAX_TURNS)
            .map(|index| {
                if index % 2 == 0 {
                    (Assistant, "a")
                } else {
                    (User, "q")
                }
            })
            .collect();
        assert!(validate_request(&request("term", full.clone())).is_ok());
        let mut too_many = full;
        too_many.extend([(Assistant, "a"), (User, "q")]);
        assert_eq!(
            validate_request(&request("term", too_many)),
            Err(StatusCode::BAD_REQUEST)
        );
    }

    #[test]
    fn a_long_message_is_cut_to_a_window_around_the_passage() {
        let short = "A short message.";
        assert_eq!(context_window(short, "short"), short);

        let filler = "ö".repeat(EXPLAIN_MAX_CONTEXT_CHARS);
        let text = format!("{filler} the needle {filler}");
        let window = context_window(&text, "the needle\nsecond line");
        assert_eq!(window.chars().count(), EXPLAIN_MAX_CONTEXT_CHARS);
        assert!(window.contains("the needle"));

        let unmatched = context_window(&text, "not in the message");
        assert_eq!(unmatched.chars().count(), EXPLAIN_MAX_CONTEXT_CHARS);
        assert!(text.starts_with(&unmatched));
    }
}
