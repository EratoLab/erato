use axum::{
    extract::{Extension, Request, State},
    http::StatusCode,
    response::{sse::Event, Sse},
    Json,
};
use futures::StreamExt;
use serde_json::Value;
use std::sync::Arc;

use crate::{
    log,
    matcher::{ChatCompletionRequest, Matcher},
    request_id::RequestId,
    responses::{
        build_delayed_streaming_response, build_multiple_tool_calls_streaming_response,
        build_tool_call_streaming_response, StreamAction,
    },
};

/// Handler for chat completions endpoint
pub async fn chat_completions(
    State(matcher): State<Arc<Matcher>>,
    Extension(request_id): Extension<RequestId>,
    request: Request,
) -> Result<
    Sse<impl futures::Stream<Item = Result<Event, std::convert::Infallible>>>,
    (StatusCode, Json<Value>),
> {
    let uri = request.uri().path().to_string();

    // Extract the JSON body
    let bytes = axum::body::to_bytes(request.into_body(), usize::MAX)
        .await
        .map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "Failed to read request body"})),
            )
        })?;

    let chat_request: ChatCompletionRequest = serde_json::from_slice(&bytes).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Invalid JSON"})),
        )
    })?;

    log::log_request(
        request_id.as_str(),
        "POST",
        &uri,
        &format!(
            "Received chat completion request with {} messages, stream={}",
            chat_request.messages.len(),
            chat_request.stream
        ),
    );

    // Match the request to get the response config
    let response_config = matcher.match_request(&chat_request, request_id.as_str());

    // Build the streaming response based on config type
    let actions = match response_config {
        crate::matcher::ResponseConfig::Error(error_config) => {
            log::log_with_id(
                request_id.as_str(),
                &format!(
                    "Matched error response with status {}",
                    error_config.status_code
                ),
            );
            return Err((
                StatusCode::from_u16(error_config.status_code).unwrap_or(StatusCode::BAD_REQUEST),
                Json(error_config.body),
            ));
        }
        crate::matcher::ResponseConfig::Static(static_config) => {
            log::log_with_id(
                request_id.as_str(),
                &format!(
                    "Matched static response with {} chunks, {}ms delay",
                    static_config.chunks.len(),
                    static_config.delay_ms
                ),
            );
            build_delayed_streaming_response(
                static_config.chunks,
                static_config.delay_ms,
                static_config.initial_delay_ms,
            )
        }
        crate::matcher::ResponseConfig::ToolCall(tool_config) => {
            log::log_with_id(
                request_id.as_str(),
                &format!(
                    "Matched tool call response: {} with {}ms delay",
                    tool_config.tool_name, tool_config.delay_ms
                ),
            );
            build_tool_call_streaming_response(
                tool_config.tool_name,
                tool_config.arguments,
                tool_config.delay_ms,
            )
        }
        crate::matcher::ResponseConfig::ToolCalls(tool_calls_config) => {
            log::log_with_id(
                request_id.as_str(),
                &format!(
                    "Matched multiple tool calls response: {} tool calls with {}ms delay",
                    tool_calls_config.tool_calls.len(),
                    tool_calls_config.delay_ms
                ),
            );
            build_multiple_tool_calls_streaming_response(
                tool_calls_config.tool_calls,
                tool_calls_config.delay_ms,
            )
        }
    };

    // Log that we're starting the stream
    log::log_response_start(request_id.as_str(), "chat completion");

    // Clone request_id for the stream closure
    let request_id_for_stream = request_id.clone();
    let total_actions = actions.len();

    // Create the stream - convert actions to events
    let stream =
        futures::stream::iter(actions.into_iter().enumerate()).filter_map(move |(idx, action)| {
            let request_id = request_id_for_stream.clone();
            async move {
                let is_last = idx >= total_actions - 1;

                match action {
                    StreamAction::Bytes(data) => {
                        // Only return non-empty data events
                        if !data.is_empty() {
                            if is_last {
                                log::log_response_complete(request_id.as_str());
                            }
                            Some(Ok(Event::default().data(data)))
                        } else {
                            None
                        }
                    }
                    StreamAction::Delay(duration) => {
                        tokio::time::sleep(duration).await;
                        None
                    }
                }
            }
        });

    Ok(Sse::new(stream))
}
