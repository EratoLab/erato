use axum::{
    extract::{Extension, Request, State},
    http::StatusCode,
    response::{sse::Event, IntoResponse, Response, Sse},
    Json,
};
use futures::StreamExt;
use serde_json::Value;
use std::sync::Arc;

use crate::{
    log,
    matcher::{ChatCompletionRequest, Matcher, ResponseConfig, ToolCallDef},
    request_id::RequestId,
    responses::{
        build_delayed_streaming_response, build_multiple_tool_calls_streaming_response,
        build_openai_chat_completion, build_openai_tool_calls_completion,
        build_tool_call_streaming_response, StreamAction,
    },
};

/// Handler for chat completions endpoint
pub async fn chat_completions(
    State(matcher): State<Arc<Matcher>>,
    Extension(request_id): Extension<RequestId>,
    request: Request,
) -> Result<Response, (StatusCode, Json<Value>)> {
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

    // Non-streaming clients (e.g. erato's summary/title generation via genai
    // exec_chat) require a single JSON completion body and reject SSE.
    if !chat_request.stream {
        return non_streaming_chat_completion(response_config, &request_id).await;
    }

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
            if let Some(initial_delay_ms) = error_config.initial_delay_ms {
                tokio::time::sleep(std::time::Duration::from_millis(initial_delay_ms)).await;
            }
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
        crate::matcher::ResponseConfig::CiteFiles(_) => {
            unreachable!("CiteFiles responses should be resolved into Static in matcher")
        }
        crate::matcher::ResponseConfig::LongRunning(_) => {
            unreachable!("LongRunning responses should be resolved into Static in matcher")
        }
        crate::matcher::ResponseConfig::RandomOneLiner(_) => {
            unreachable!("RandomOneLiner responses should be resolved into Static in matcher")
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
                            Some(Ok::<Event, std::convert::Infallible>(
                                Event::default().data(data),
                            ))
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

    Ok(Sse::new(stream).into_response())
}

/// Answer a `stream: false` request with a single JSON completion body,
/// keeping the delay semantics of the streaming variant.
async fn non_streaming_chat_completion(
    response_config: ResponseConfig,
    request_id: &RequestId,
) -> Result<Response, (StatusCode, Json<Value>)> {
    match response_config {
        ResponseConfig::Error(error_config) => {
            log::log_with_id(
                request_id.as_str(),
                &format!(
                    "Matched error response with status {}",
                    error_config.status_code
                ),
            );
            if let Some(initial_delay_ms) = error_config.initial_delay_ms {
                tokio::time::sleep(std::time::Duration::from_millis(initial_delay_ms)).await;
            }
            Err((
                StatusCode::from_u16(error_config.status_code).unwrap_or(StatusCode::BAD_REQUEST),
                Json(error_config.body),
            ))
        }
        ResponseConfig::Static(static_config) => {
            log::log_with_id(
                request_id.as_str(),
                &format!(
                    "Matched static response with {} chunks, answering non-streaming",
                    static_config.chunks.len()
                ),
            );
            let total_delay_ms = static_config.initial_delay_ms.unwrap_or(0)
                + static_config.delay_ms * static_config.chunks.len() as u64;
            tokio::time::sleep(std::time::Duration::from_millis(total_delay_ms)).await;
            log::log_response_complete(request_id.as_str());
            Ok(Json(build_openai_chat_completion(&static_config.chunks.concat())).into_response())
        }
        ResponseConfig::ToolCall(tool_config) => {
            log::log_with_id(
                request_id.as_str(),
                &format!(
                    "Matched tool call response: {}, answering non-streaming",
                    tool_config.tool_name
                ),
            );
            tokio::time::sleep(std::time::Duration::from_millis(tool_config.delay_ms)).await;
            log::log_response_complete(request_id.as_str());
            Ok(Json(build_openai_tool_calls_completion(&[ToolCallDef {
                tool_name: tool_config.tool_name,
                arguments: tool_config.arguments,
            }]))
            .into_response())
        }
        ResponseConfig::ToolCalls(tool_calls_config) => {
            log::log_with_id(
                request_id.as_str(),
                &format!(
                    "Matched multiple tool calls response: {} tool calls, answering non-streaming",
                    tool_calls_config.tool_calls.len()
                ),
            );
            tokio::time::sleep(std::time::Duration::from_millis(tool_calls_config.delay_ms)).await;
            log::log_response_complete(request_id.as_str());
            Ok(Json(build_openai_tool_calls_completion(
                &tool_calls_config.tool_calls,
            ))
            .into_response())
        }
        ResponseConfig::CiteFiles(_) => {
            unreachable!("CiteFiles responses should be resolved into Static in matcher")
        }
        ResponseConfig::LongRunning(_) => {
            unreachable!("LongRunning responses should be resolved into Static in matcher")
        }
        ResponseConfig::RandomOneLiner(_) => {
            unreachable!("RandomOneLiner responses should be resolved into Static in matcher")
        }
    }
}
