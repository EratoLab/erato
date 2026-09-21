//! Gate the provider on observed preparation events, so these tests cannot pass
//! if the backend buffers progress until the entire tool call has been generated.
use super::*;
use axum::body::Body;
use axum::extract::State;
use axum::response::Response;
use axum::{Json, routing::post};
use erato::config::ClientToolSubmissionConfig;
use erato::services::background_tasks::{StreamingEvent, ToolCallStatus};
use std::convert::Infallible;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tokio::sync::Notify;

#[derive(Clone)]
struct Provider {
    responses: bool,
    advance: Arc<Notify>,
    completed: Arc<AtomicBool>,
}

fn event(value: Value) -> String {
    format!("data: {value}\n\n")
}

async fn provider(State(provider): State<Provider>, Json(request): Json<Value>) -> Response {
    // Independent chat-title generation does not participate in the test gate.
    if request.get("tools").is_none() {
        return Response::builder()
            .header("content-type", "application/json")
            .body(Body::from(if provider.responses {
                json!({"id":"title","model":"gpt-4o","output":[{"type":"message","content":[{"type":"output_text","text":"Draft"}]}]})
            } else {
                json!({"choices":[{"message":{"role":"assistant","content":"Draft"}}]})
            }.to_string()))
            .unwrap();
    }
    let stream = futures::stream::unfold((0, provider), |(phase, provider)| async move {
        if phase == 3 {
            return None;
        }
        if phase > 0 {
            provider.advance.notified().await;
            // Cross the update throttle deliberately; no timing assumptions
            // about the consumer, which releases each phase only after seeing it.
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
        let delta = ["{\"title\":\"", "Hello", "\"}"][phase];
        let body = if provider.responses {
            let mut body = String::new();
            if phase == 0 {
                body += &event(
                    json!({"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","call_id":"call_draft","name":"submit_draft"}}),
                );
            }
            body += &event(
                json!({"type":"response.function_call_arguments.delta","output_index":0,"delta":delta}),
            );
            if phase == 2 {
                body += &event(
                    json!({"type":"response.completed","response":{"id":"response_draft","model":"gpt-4o","output":[{"type":"function_call","call_id":"call_draft","name":"submit_draft","arguments":"{\"title\":\"Hello\"}"}]}}),
                );
            }
            body
        } else {
            let call = if phase == 0 {
                json!({"index":0,"id":"call_draft","type":"function","function":{"name":"submit_draft","arguments":delta}})
            } else {
                json!({"index":0,"function":{"arguments":delta}})
            };
            let mut body = event(
                json!({"choices":[{"index":0,"delta":{"tool_calls":[call]},"finish_reason":null}]}),
            );
            if phase == 2 {
                body += &event(
                    json!({"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}),
                );
                body += "data: [DONE]\n\n";
            }
            body
        };
        if phase == 2 {
            provider.completed.store(true, Ordering::SeqCst);
        }
        Some((Ok::<_, Infallible>(body), (phase + 1, provider)))
    });
    Response::builder()
        .header("content-type", "text/event-stream")
        .body(Body::from_stream(stream))
        .unwrap()
}

async fn check_streaming(pool: Pool<Postgres>, responses: bool, abort: bool) {
    let provider_state = Provider {
        responses,
        advance: Arc::new(Notify::new()),
        completed: Arc::new(AtomicBool::new(false)),
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let provider_app = Router::new()
        .route("/v1/chat/completions", post(provider))
        .route("/v1/responses", post(provider))
        .with_state(provider_state.clone());
    let provider_handle = tokio::spawn(async move {
        axum::serve(listener, provider_app).await.unwrap();
    });
    let mut config = hermetic_app_config(None, Some(format!("http://{addr}/v1/")));
    if responses {
        for provider in config
            .chat_providers
            .as_mut()
            .unwrap()
            .providers
            .values_mut()
        {
            provider.provider_kind = "openai_responses".into();
        }
    }
    config.client_tools.tools.insert("draft".into(), ClientToolConfig {
        name: "submit_draft".into(),
        description: "Stage a draft".into(),
        parameters: json!({"type":"object","properties":{"title":{"type":"string"}},"required":["title"],"additionalProperties":false}).to_string(),
        timeout_ms: Some(5_000),
        submission: Some(ClientToolSubmissionConfig::default()),
        ..Default::default()
    });
    config.facets.tool_call_allowlist = vec!["client/submit_draft".into()];
    let state = test_app_state(config, pool).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let server = app_server(state.clone());
    let submit = async {
        server
            .post("/api/v1beta/me/messages/submitstream")
            .with_bearer_token(TEST_JWT_TOKEN)
            .json(&json!({"existing_chat_id":chat_id,"user_message":"Prepare a draft"}))
            .await
    };
    let client = async {
        let mut observed = 0;
        let mut phases = 0;
        loop {
            if let Some(task) = state.background_tasks.get_task(&chat_id).await {
                // This is also the history used to replay events on reconnect.
                let events = task.get_event_history().await;
                for event in &events[observed..] {
                    match event {
                        StreamingEvent::ToolCallUpdate {
                            status: ToolCallStatus::Preparing,
                            input,
                            progress,
                            ..
                        } if phases < 2 => {
                            assert!(!provider_state.completed.load(Ordering::SeqCst));
                            let expected = if phases == 0 {
                                "{\"title\":\""
                            } else {
                                "{\"title\":\"Hello"
                            };
                            assert_eq!(input, &Some(json!(expected)));
                            assert_eq!(*progress, Some(expected.len() as f64));
                            assert!(!events.iter().any(|event| matches!(
                                event,
                                StreamingEvent::ClientToolCall { .. }
                            )));
                            phases += 1;
                            if abort {
                                server
                                    .post("/api/v1beta/me/messages/abortstream")
                                    .with_bearer_token(TEST_JWT_TOKEN)
                                    .json(&json!({"chat_id":chat_id}))
                                    .await
                                    .assert_status_ok();
                                return;
                            }
                            provider_state.advance.notify_one();
                        }
                        StreamingEvent::ClientToolCall {
                            message_id,
                            tool_call_id,
                            input,
                            ..
                        } => {
                            assert_eq!(phases, 2);
                            assert!(provider_state.completed.load(Ordering::SeqCst));
                            assert_eq!(input, &Some(json!({"title":"Hello"})));
                            server.post("/api/v1beta/me/messages/clienttoolresult")
                                .with_bearer_token(TEST_JWT_TOKEN)
                                .json(&json!({"chat_id":chat_id,"message_id":message_id,"tool_call_id":tool_call_id,"result":{"draft_id":"draft-1"}}))
                                .await.assert_status_ok();
                            return;
                        }
                        _ => {}
                    }
                }
                observed = events.len();
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    };
    let result = tokio::time::timeout(Duration::from_secs(30), async {
        tokio::join!(submit, client)
    })
    .await;
    provider_handle.abort();
    let (response, ()) = result.expect("preparation was not streamed before provider completion");
    response.assert_status_ok();
    let events: Vec<Value> = parse_sse_events(&response)
        .into_iter()
        .filter_map(|event| serde_json::from_str(&event.data).ok())
        .collect();
    let proposed: Vec<_> = events
        .iter()
        .filter(|event| event["message_type"] == "tool_call_proposed")
        .collect();
    assert_eq!(
        proposed.len(),
        1,
        "one identity from preparation to completion"
    );
    assert!(
        events
            .iter()
            .filter(|event| event["message_type"] == "tool_call_update")
            .all(|event| event["content_index"] == proposed[0]["content_index"])
    );
    assert_eq!(
        events
            .iter()
            .filter(|event| event["message_type"] == "client_tool_call")
            .count(),
        usize::from(!abort)
    );
    let completed = events
        .iter()
        .find(|event| event["message_type"] == "assistant_message_completed")
        .expect("completed event");
    let message_id = Uuid::parse_str(completed["message_id"].as_str().unwrap()).unwrap();
    let saved = Messages::find_by_id(message_id)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(saved.raw_message["content"], completed["content"]);
    let tools: Vec<_> = completed["content"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|part| part["content_type"] == "tool_use")
        .collect();
    if abort {
        assert!(
            tools.is_empty(),
            "interrupted argument fragments must not be replayed to the next inference"
        );
        assert!(!provider_state.completed.load(Ordering::SeqCst));
    } else {
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["status"], "success");
        assert_eq!(tools[0]["input"], json!({"title":"Hello"}));
    }
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn chat_completions_stream_arguments_before_dispatch(pool: Pool<Postgres>) {
    check_streaming(pool, false, false).await;
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn responses_stream_arguments_before_dispatch(pool: Pool<Postgres>) {
    check_streaming(pool, true, false).await;
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn interrupted_arguments_are_neither_executed_nor_persisted(pool: Pool<Postgres>) {
    check_streaming(pool, true, true).await;
}
