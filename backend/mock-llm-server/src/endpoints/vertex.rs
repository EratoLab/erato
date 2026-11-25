use axum::{
    extract::{Extension, Request},
    http::StatusCode,
    response::{sse::Event, IntoResponse, Response, Sse},
    Json,
};
use futures::StreamExt;
use serde_json::{json, Value};

use crate::{log, request_id::RequestId, responses::StreamAction};

const VERTEX_CHUNK_DELAY_MS: u64 = 350;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VertexScenario {
    MixedTextThenFunctionCall,
    PostToolFollowupText,
    GenericText,
}

pub async fn vertex_generate_content(
    Extension(request_id): Extension<RequestId>,
    request: Request,
) -> Result<Response, (StatusCode, Json<Value>)> {
    let uri = request.uri().path().to_string();
    let bytes = axum::body::to_bytes(request.into_body(), usize::MAX)
        .await
        .map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Failed to read request body"})),
            )
        })?;

    let request_json: Value = serde_json::from_slice(&bytes).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Invalid JSON"})),
        )
    })?;

    let scenario = detect_vertex_scenario(&request_json);
    log::log_request(
        request_id.as_str(),
        "POST",
        &uri,
        &format!("Received Vertex request, matched scenario: {scenario:?}"),
    );

    let actions = chunk_actions(
        build_vertex_chunks(&request_json, scenario),
        VERTEX_CHUNK_DELAY_MS,
    );
    log::log_response_start(request_id.as_str(), "vertex chat completion");

    let total_actions = actions.len();
    let request_id_for_stream = request_id.clone();
    let stream =
        futures::stream::iter(actions.into_iter().enumerate()).filter_map(move |(idx, action)| {
            let request_id = request_id_for_stream.clone();
            async move {
                let is_last = idx + 1 == total_actions;
                match action {
                    StreamAction::Bytes(data) => {
                        if is_last {
                            log::log_response_complete(request_id.as_str());
                        }
                        Some(Ok::<Event, std::convert::Infallible>(
                            Event::default().data(data),
                        ))
                    }
                    StreamAction::Delay(duration) => {
                        tokio::time::sleep(duration).await;
                        None
                    }
                }
            }
        });

    // genai's Gemini adapter always asks for `alt=sse`, which real Vertex
    // answers with one `data:` event per chunk.
    Ok(Sse::new(stream).into_response())
}

fn detect_vertex_scenario(request: &Value) -> VertexScenario {
    if has_function_response(request, "list_files") {
        return VertexScenario::PostToolFollowupText;
    }

    if request_contains_text(
        request,
        r#"Please call the tool list_files, but before that output the text "Foo""#,
    ) && request_declares_tool(request, "list_files")
    {
        return VertexScenario::MixedTextThenFunctionCall;
    }

    VertexScenario::GenericText
}

fn build_vertex_chunks(request: &Value, scenario: VertexScenario) -> Vec<Value> {
    match scenario {
        VertexScenario::MixedTextThenFunctionCall => {
            vec![
                json!({
                    "candidates": [{
                        "content": {
                            "role": "model",
                            "parts": [{
                                "text": "Foo",
                                "thoughtSignature": "mock-thought-signature"
                            }]
                        }
                    }],
                    "usageMetadata": {
                        "trafficType": "ON_DEMAND"
                    },
                    "modelVersion": "gemini-2.5-flash",
                    "createTime": "2026-04-01T13:57:14.385443Z",
                    "responseId": "mock-mixed-turn"
                }),
                json!({
                    "candidates": [{
                        "content": {
                            "role": "model",
                            "parts": [{
                                "functionCall": {
                                    "name": "list_files",
                                    "args": {}
                                }
                            }]
                        },
                        "finishReason": "STOP"
                    }],
                    "usageMetadata": {
                        "promptTokenCount": 42,
                        "candidatesTokenCount": 4,
                        "totalTokenCount": 104,
                        "trafficType": "ON_DEMAND",
                        "promptTokensDetails": [{
                            "modality": "TEXT",
                            "tokenCount": 42
                        }],
                        "candidatesTokensDetails": [{
                            "modality": "TEXT",
                            "tokenCount": 4
                        }],
                        "thoughtsTokenCount": 58
                    },
                    "modelVersion": "gemini-2.5-flash",
                    "createTime": "2026-04-01T13:57:14.385443Z",
                    "responseId": "mock-mixed-turn"
                }),
            ]
        }
        VertexScenario::PostToolFollowupText => {
            vec![
                json!({
                    "candidates": [{
                        "content": {
                            "role": "model",
                            "parts": [{
                                "text": "Bar\n\n"
                            }]
                        }
                    }],
                    "usageMetadata": {
                        "trafficType": "ON_DEMAND"
                    },
                    "modelVersion": "gemini-2.5-flash",
                    "createTime": "2026-04-01T13:57:15.111001Z",
                    "responseId": "mock-post-tool-turn"
                }),
                json!({
                    "candidates": [{
                        "content": {
                            "role": "model",
                            "parts": [{
                                "text": "Okay, I've called the `list_files` tool. I'm not"
                            }]
                        }
                    }],
                    "usageMetadata": {
                        "trafficType": "ON_DEMAND"
                    },
                    "modelVersion": "gemini-2.5-flash",
                    "createTime": "2026-04-01T13:57:15.111001Z",
                    "responseId": "mock-post-tool-turn"
                }),
                json!({
                    "candidates": [{
                        "content": {
                            "role": "model",
                            "parts": [{
                                "text": " sure why I was asked to output \"Foo\" *before* the tool call, but I will fulfill"
                            }]
                        }
                    }],
                    "usageMetadata": {
                        "trafficType": "ON_DEMAND"
                    },
                    "modelVersion": "gemini-2.5-flash",
                    "createTime": "2026-04-01T13:57:15.111001Z",
                    "responseId": "mock-post-tool-turn"
                }),
                json!({
                    "candidates": [{
                        "content": {
                            "role": "model",
                            "parts": [{
                                "text": " the request as specified.\n"
                            }]
                        },
                        "finishReason": "STOP"
                    }],
                    "usageMetadata": {
                        "promptTokenCount": 74,
                        "candidatesTokenCount": 47,
                        "totalTokenCount": 121,
                        "trafficType": "ON_DEMAND",
                        "promptTokensDetails": [{
                            "modality": "TEXT",
                            "tokenCount": 74
                        }],
                        "candidatesTokensDetails": [{
                            "modality": "TEXT",
                            "tokenCount": 47
                        }]
                    },
                    "modelVersion": "gemini-2.5-flash",
                    "createTime": "2026-04-01T13:57:15.111001Z",
                    "responseId": "mock-post-tool-turn"
                }),
            ]
        }
        VertexScenario::GenericText => {
            let fallback_text = extract_first_user_text(request)
                .map(|text| format!("Mock Vertex response for: {text}"))
                .unwrap_or_else(|| "Mock Vertex response".to_string());
            vec![json!({
                "candidates": [{
                    "content": {
                        "role": "model",
                        "parts": [{
                            "text": fallback_text
                        }]
                    },
                    "finishReason": "STOP"
                }],
                "usageMetadata": {
                    "promptTokenCount": 12,
                    "candidatesTokenCount": 8,
                    "totalTokenCount": 20,
                    "trafficType": "ON_DEMAND"
                },
                "modelVersion": "gemini-2.5-flash",
                "createTime": "2026-04-01T13:57:15.111001Z",
                "responseId": "mock-generic-turn"
            })]
        }
    }
}

fn chunk_actions(chunks: Vec<Value>, delay_ms: u64) -> Vec<StreamAction> {
    let mut actions = Vec::new();
    for (index, chunk) in chunks.into_iter().enumerate() {
        if index > 0 {
            actions.push(StreamAction::Delay(std::time::Duration::from_millis(
                delay_ms,
            )));
        }
        actions.push(StreamAction::Bytes(chunk.to_string()));
    }
    actions
}

fn request_contains_text(request: &Value, needle: &str) -> bool {
    request
        .get("contents")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|message| message.get("parts").and_then(Value::as_array))
        .flatten()
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .any(|text| text.contains(needle))
}

fn request_declares_tool(request: &Value, tool_name: &str) -> bool {
    request
        .get("tools")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|tool| tool.get("functionDeclarations").and_then(Value::as_array))
        .flatten()
        .filter_map(|declaration| declaration.get("name").and_then(Value::as_str))
        .any(|name| name == tool_name)
}

fn has_function_response(request: &Value, tool_name: &str) -> bool {
    request
        .get("contents")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|message| message.get("parts").and_then(Value::as_array))
        .flatten()
        .filter_map(|part| part.get("functionResponse"))
        .filter_map(|response| response.get("name").and_then(Value::as_str))
        .any(|name| name == tool_name)
}

fn extract_first_user_text(request: &Value) -> Option<String> {
    request
        .get("contents")
        .and_then(Value::as_array)?
        .iter()
        .find(|message| message.get("role").and_then(Value::as_str) == Some("user"))?
        .get("parts")
        .and_then(Value::as_array)?
        .iter()
        .find_map(|part| part.get("text").and_then(Value::as_str))
        .map(ToOwned::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn detects_initial_mixed_text_and_tool_call_scenario() {
        let request = json!({
            "contents": [{
                "role": "user",
                "parts": [{
                    "text": "Please call the tool list_files, but before that output the text \"Foo\""
                }]
            }],
            "tools": [{
                "functionDeclarations": [{
                    "name": "list_files"
                }]
            }]
        });

        assert_eq!(
            detect_vertex_scenario(&request),
            VertexScenario::MixedTextThenFunctionCall
        );
    }

    #[test]
    fn detects_post_tool_followup_scenario() {
        let request = json!({
            "contents": [
                {
                    "role": "user",
                    "parts": [{
                        "text": "Please call the tool list_files, but before that output the text \"Foo\""
                    }]
                },
                {
                    "role": "model",
                    "parts": [{
                        "functionCall": {
                            "name": "list_files",
                            "args": {}
                        }
                    }]
                },
                {
                    "role": "user",
                    "parts": [{
                        "functionResponse": {
                            "name": "list_files",
                            "response": {
                                "content": "{\"files\":[\"docs/readme.txt\"]}"
                            }
                        }
                    }]
                }
            ]
        });

        assert_eq!(
            detect_vertex_scenario(&request),
            VertexScenario::PostToolFollowupText
        );
    }

    #[test]
    fn chunk_actions_send_one_compact_json_per_chunk() {
        let actions = chunk_actions(vec![json!({"a": 1}), json!({"b": 2})], 10);
        let sent: Vec<&str> = actions
            .iter()
            .filter_map(|action| match action {
                StreamAction::Bytes(bytes) => Some(bytes.as_str()),
                StreamAction::Delay(_) => None,
            })
            .collect();
        assert_eq!(sent, vec![r#"{"a":1}"#, r#"{"b":2}"#]);
    }
}
