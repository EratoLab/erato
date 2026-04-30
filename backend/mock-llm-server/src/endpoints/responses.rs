use axum::{
    extract::{Extension, Request},
    http::StatusCode,
    response::{sse::Event, Sse},
    Json,
};
use futures::StreamExt;
use serde_json::{json, Value};
use std::time::Duration;
use tokio::time::sleep;

use crate::{log, request_id::RequestId};

const REASONING_ITEM_ID: &str = "rs_mock_reasoning_123";
const MESSAGE_ITEM_ID: &str = "msg_mock_reasoning_123";
const RESPONSE_ID: &str = "resp_mock_reasoning_123";
const ENCRYPTED_REASONING_CONTENT: &str =
    "gAAAAABmockEncryptedReasoningContentForThoughtSignatureReplay0123456789";
const RESPONSE_STREAM_EVENT_DELAY_MS: u64 = 450;

/// Handler for OpenAI Responses API endpoint.
pub async fn responses(
    Extension(request_id): Extension<RequestId>,
    request: Request,
) -> Result<
    Sse<impl futures::Stream<Item = Result<Event, std::convert::Infallible>>>,
    (StatusCode, Json<Value>),
> {
    let uri = request.uri().path().to_string();
    let bytes = axum::body::to_bytes(request.into_body(), usize::MAX)
        .await
        .map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "Failed to read request body"})),
            )
        })?;

    let request_value: Value = serde_json::from_slice(&bytes).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Invalid JSON"})),
        )
    })?;

    let input_text = collect_strings(&request_value).join(" ").to_lowercase();
    log::log_request(
        request_id.as_str(),
        "POST",
        &uri,
        &format!(
            "Received OpenAI Responses request with {} bytes",
            bytes.len()
        ),
    );

    let events = if is_riddle_follow_up_scenario(&input_text) {
        if !has_replayed_reasoning_signature(&request_value) {
            log::log_with_id(
                request_id.as_str(),
                "OpenAI Responses riddle follow-up missing replayed reasoning signature",
            );
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": {
                        "message": "riddle follow-up requires replayed reasoning encrypted_content",
                        "expected_encrypted_content": ENCRYPTED_REASONING_CONTENT
                    }
                })),
            ));
        }
        log::log_with_id(
            request_id.as_str(),
            "Matched OpenAI Responses riddle follow-up with replayed reasoning signature",
        );
        riddle_follow_up_response_events()
    } else if is_reasoning_scenario(&input_text) {
        log::log_with_id(
            request_id.as_str(),
            "Matched OpenAI Responses reasoning scenario",
        );
        reasoning_response_events()
    } else {
        log::log_with_id(
            request_id.as_str(),
            "No OpenAI Responses reasoning scenario match; using generic response",
        );
        generic_response_events()
    };

    log::log_response_start(request_id.as_str(), "OpenAI Responses");

    let request_id_for_stream = request_id.clone();
    let total_events = events.len();
    let stream =
        futures::stream::iter(events.into_iter().enumerate()).filter_map(move |(idx, event)| {
            let request_id = request_id_for_stream.clone();
            async move {
                if idx > 0 {
                    sleep(Duration::from_millis(RESPONSE_STREAM_EVENT_DELAY_MS)).await;
                }
                if idx >= total_events - 1 {
                    log::log_response_complete(request_id.as_str());
                }
                Some(Ok(event))
            }
        });

    Ok(Sse::new(stream))
}

fn is_reasoning_scenario(input_text: &str) -> bool {
    input_text.contains("five-digit riddle")
}

fn is_riddle_follow_up_scenario(input_text: &str) -> bool {
    input_text.contains("riddle follow-up")
}

fn has_replayed_reasoning_signature(value: &Value) -> bool {
    match value {
        Value::Object(map) => {
            map.get("encrypted_content")
                .or_else(|| map.get("encrypted_data"))
                .and_then(Value::as_str)
                == Some(ENCRYPTED_REASONING_CONTENT)
                || map.values().any(has_replayed_reasoning_signature)
        }
        Value::Array(values) => values.iter().any(has_replayed_reasoning_signature),
        _ => false,
    }
}

fn collect_strings(value: &Value) -> Vec<String> {
    match value {
        Value::String(value) => vec![value.clone()],
        Value::Array(values) => values.iter().flat_map(collect_strings).collect(),
        Value::Object(map) => map.values().flat_map(collect_strings).collect(),
        _ => Vec::new(),
    }
}

fn reasoning_response_events() -> Vec<Event> {
    let summary_text = "**Evaluating the constraints**\n\nThe first digit cannot be 1 or 5, the fifth digit is smaller than the first, and the third digit must equal the sum of the first and fifth. Checking the valid digit pairs leaves 3 and 2 as the first and fifth digits, which makes 5 the third digit. The fourth digit must be odd and unused, so it is 1, leaving 4 for the second digit.";
    let summary_chunks = [
        "**Evaluating the constraints**\n\n",
        "The first digit cannot be 1 or 5, and the fifth digit is smaller than the first. ",
        "The third digit must equal the sum of the first and fifth. ",
        "Checking valid digit pairs leaves 3 and 2 as the first and fifth digits, making 5 the third digit. ",
        "The fourth digit must be odd and unused, so it is 1, leaving 4 for the second digit.",
    ];
    let output_text = "**Code: 34512.**\n**Justification:** The only consistent placement is first=3, third=5, fifth=2, fourth=1, and second=4; this satisfies 4 > 1 and uses each digit exactly once.";

    let mut events = vec![
        sse_json(
            "response.created",
            json!({
                "type": "response.created",
                "response": response_object("in_progress", vec![], None),
                "sequence_number": 0
            }),
        ),
        sse_json(
            "response.output_item.added",
            json!({
                "type": "response.output_item.added",
                "output_index": 0,
                "item": {
                    "id": REASONING_ITEM_ID,
                    "type": "reasoning",
                    "encrypted_content": ENCRYPTED_REASONING_CONTENT,
                    "summary": []
                },
                "sequence_number": 1
            }),
        ),
        sse_json(
            "response.reasoning_summary_part.added",
            json!({
                "type": "response.reasoning_summary_part.added",
                "item_id": REASONING_ITEM_ID,
                "output_index": 0,
                "summary_index": 0,
                "part": {"type": "summary_text", "text": ""},
                "sequence_number": 2
            }),
        ),
    ];

    for (chunk_index, summary_chunk) in summary_chunks.iter().enumerate() {
        events.push(sse_json(
            "response.reasoning_summary_text.delta",
            json!({
                "type": "response.reasoning_summary_text.delta",
                "output_index": 0,
                "summary_index": 0,
                "delta": summary_chunk,
                "sequence_number": 3 + chunk_index
            }),
        ));
    }

    events.extend([
        sse_json(
            "response.output_item.added",
            json!({
                "type": "response.output_item.added",
                "output_index": 1,
                "item": {
                    "id": MESSAGE_ITEM_ID,
                    "type": "message",
                    "role": "assistant",
                    "status": "in_progress",
                    "content": []
                },
                "sequence_number": 8
            }),
        ),
        sse_json(
            "response.content_part.added",
            json!({
                "type": "response.content_part.added",
                "item_id": MESSAGE_ITEM_ID,
                "output_index": 1,
                "content_index": 0,
                "part": {"type": "output_text", "text": "", "annotations": []},
                "sequence_number": 9
            }),
        ),
        sse_json(
            "response.output_text.delta",
            json!({
                "type": "response.output_text.delta",
                "item_id": MESSAGE_ITEM_ID,
                "output_index": 1,
                "content_index": 0,
                "delta": output_text,
                "sequence_number": 10
            }),
        ),
        sse_json(
            "response.completed",
            json!({
                "type": "response.completed",
                "response": response_object(
                    "completed",
                    vec![
                        json!({
                            "id": REASONING_ITEM_ID,
                            "type": "reasoning",
                            "encrypted_content": ENCRYPTED_REASONING_CONTENT,
                            "summary": [{"type": "summary_text", "text": summary_text}]
                        }),
                        json!({
                            "id": MESSAGE_ITEM_ID,
                            "type": "message",
                            "status": "completed",
                            "role": "assistant",
                            "content": [{
                                "type": "output_text",
                                "text": output_text,
                                "annotations": []
                            }]
                        })
                    ],
                    Some(json!({
                        "input_tokens": 103,
                        "input_tokens_details": {"cached_tokens": 0},
                        "output_tokens": 180,
                        "output_tokens_details": {"reasoning_tokens": 96},
                        "total_tokens": 283
                    }))
                ),
                "sequence_number": 11
            }),
        ),
    ]);

    events
}

fn riddle_follow_up_response_events() -> Vec<Event> {
    let output_text =
        "The prior reasoning signature was replayed correctly for the riddle follow-up.";

    vec![
        sse_json(
            "response.created",
            json!({
                "type": "response.created",
                "response": response_object("in_progress", vec![], None),
                "sequence_number": 0
            }),
        ),
        sse_json(
            "response.output_text.delta",
            json!({
                "type": "response.output_text.delta",
                "item_id": "msg_mock_riddle_follow_up_123",
                "output_index": 0,
                "content_index": 0,
                "delta": output_text,
                "sequence_number": 1
            }),
        ),
        sse_json(
            "response.completed",
            json!({
                "type": "response.completed",
                "response": response_object(
                    "completed",
                    vec![json!({
                        "id": "msg_mock_riddle_follow_up_123",
                        "type": "message",
                        "status": "completed",
                        "role": "assistant",
                        "content": [{
                            "type": "output_text",
                            "text": output_text,
                            "annotations": []
                        }]
                    })],
                    Some(json!({
                        "input_tokens": 54,
                        "output_tokens": 12,
                        "total_tokens": 66
                    }))
                ),
                "sequence_number": 2
            }),
        ),
    ]
}

fn generic_response_events() -> Vec<Event> {
    let output_text = "This is a generic OpenAI Responses mock reply.";
    vec![
        sse_json(
            "response.created",
            json!({
                "type": "response.created",
                "response": response_object("in_progress", vec![], None),
                "sequence_number": 0
            }),
        ),
        sse_json(
            "response.output_text.delta",
            json!({
                "type": "response.output_text.delta",
                "output_index": 0,
                "content_index": 0,
                "delta": output_text,
                "sequence_number": 1
            }),
        ),
        sse_json(
            "response.completed",
            json!({
                "type": "response.completed",
                "response": response_object(
                    "completed",
                    vec![json!({
                        "id": "msg_mock_generic_123",
                        "type": "message",
                        "status": "completed",
                        "role": "assistant",
                        "content": [{
                            "type": "output_text",
                            "text": output_text,
                            "annotations": []
                        }]
                    })],
                    Some(json!({
                        "input_tokens": 12,
                        "output_tokens": 10,
                        "total_tokens": 22
                    }))
                ),
                "sequence_number": 2
            }),
        ),
    ]
}

fn response_object(status: &str, output: Vec<Value>, usage: Option<Value>) -> Value {
    json!({
        "id": RESPONSE_ID,
        "object": "response",
        "created_at": 1234567890,
        "status": status,
        "model": "gpt-5.2-mock",
        "output": output,
        "usage": usage,
        "error": null,
        "reasoning": {"effort": "medium", "summary": "detailed"},
        "store": false,
        "parallel_tool_calls": true,
        "tools": [],
        "metadata": {}
    })
}

fn sse_json(event_name: &str, data: Value) -> Event {
    Event::default().event(event_name).data(data.to_string())
}
