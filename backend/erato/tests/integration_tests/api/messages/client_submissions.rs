//! Exercise actual request preparation, SSE dispatch, REST feedback and persistence
//! with a deterministic provider. No paid inference or application-specific host.
use super::*;
use erato::config::ClientToolSubmissionConfig;
use erato::services::background_tasks::StreamingEvent;
use std::collections::HashSet;
use std::time::Duration;

async fn run_submission(
    pool: Pool<Postgres>,
    attempts: Vec<Vec<(&'static str, Value)>>,
    client_results: Vec<Value>,
    max_attempts: u32,
    timeout_ms: u64,
    native: bool,
) -> (Vec<Value>, Vec<Value>) {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    let mut previous_id = None;
    for calls in attempts {
        let first_id = calls[0].0;
        let capture = recorder.clone();
        let previous = previous_id;
        mocks.mock(move |when, then| {
            let required = previous.into_iter().collect::<Vec<_>>();
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&required, &[first_id]))
                .matcher(capture);
            let calls = calls
                .into_iter()
                .map(|(id, input)| (id, "submit_draft", input))
                .collect::<Vec<_>>();
            mock_llm_sse_response(then, build_openai_tool_calls_streaming_response(&calls));
        });
        previous_id = Some(first_id);
    }
    let capture = recorder.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[previous_id.unwrap()], &[]))
            .matcher(capture);
        mock_llm_sse_response(
            then,
            build_openai_text_streaming_response(&["UNEXPECTED EXTRA INFERENCE"]),
        );
    });
    let (mut config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    for provider in config
        .chat_providers
        .as_mut()
        .unwrap()
        .providers
        .values_mut()
    {
        provider.model_capabilities.supports_strict_tool_calling = native;
    }
    config.client_tools.tools.insert("draft".into(), ClientToolConfig {
        name: "submit_draft".into(),
        description: "Validate and stage a draft for review. Call alone after reading.".into(),
        parameters: json!({"type":"object","properties":{"title":{"type":"string"}},"required":["title"],"additionalProperties":false}).to_string(),
        timeout_ms: Some(timeout_ms),
        submission: (max_attempts > 0).then_some(ClientToolSubmissionConfig { max_attempts, ..Default::default() }),
        ..Default::default()
    });
    config.facets.tool_call_allowlist = vec!["client/submit_draft".into()];
    let state = test_app_state(config, pool).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let server = app_server(state.clone());
    let request_body = json!({"existing_chat_id":chat_id,"user_message":"Prepare a draft"});
    let submit = async {
        server
            .post("/api/v1beta/me/messages/submitstream")
            .with_bearer_token(TEST_JWT_TOKEN)
            .json(&request_body)
            .await
    };
    let client = async {
        let mut results = client_results.into_iter();
        let mut next_result = results.next();
        let mut answered = HashSet::new();
        while next_result.is_some() {
            if let Some(task) = state.background_tasks.get_task(&chat_id).await {
                for event in task.get_event_history().await {
                    if let StreamingEvent::ClientToolCall {
                        message_id,
                        tool_call_id,
                        ..
                    } = event
                        && answered.insert(tool_call_id.clone())
                    {
                        let mut payload = next_result.take().expect("unexpected dispatch");
                        payload["chat_id"] = json!(chat_id);
                        payload["message_id"] = json!(message_id);
                        payload["tool_call_id"] = json!(tool_call_id);
                        let response = server
                            .post("/api/v1beta/me/messages/clienttoolresult")
                            .with_bearer_token(TEST_JWT_TOKEN)
                            .json(&payload)
                            .await;
                        response.assert_status_ok();
                        assert_eq!(response.json::<Value>()["delivered"], true);
                        next_result = results.next();
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    };
    let (response, ()) = tokio::time::timeout(Duration::from_secs(30), async {
        tokio::join!(submit, client)
    })
    .await
    .expect("submission loop did not finish");
    response.assert_status_ok();
    let events = parse_sse_events(&response)
        .into_iter()
        .filter_map(|event| serde_json::from_str::<Value>(&event.data).ok())
        .collect::<Vec<_>>();
    assert!(
        events
            .iter()
            .any(|event| event["message_type"] == "assistant_message_completed"),
        "{events:?}"
    );
    let rows = Messages::find()
        .filter(erato::db::entity::messages::Column::ChatId.eq(chat_id))
        .all(&state.db)
        .await
        .unwrap();
    if max_attempts > 0 {
        assert!(
            rows.iter()
                .any(|row| row.raw_message.to_string().contains("submission")),
            "submission result must persist"
        );
    }
    (
        recorder
            .bodies()
            .iter()
            .map(|body| serde_json::from_str::<Value>(body).unwrap())
            // Chat-title generation is independent of the tool loop and also
            // uses this mock endpoint. Count every tool-enabled inference,
            // including an unwanted continuation after an accepted draft.
            .filter(|body| body.get("tools").is_some())
            .collect(),
        events,
    )
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn schema_then_parser_repair_stops_after_acceptance(pool: Pool<Postgres>) {
    let (requests, events) = run_submission(pool, vec![
        vec![("call_schema", json!({"title":123}))],
        vec![("call_parser", json!({"title":"Unknown reference"}))],
        vec![("call_accept", json!({"title":"Valid draft"}))],
    ], vec![
        json!({"error":"Invalid draft","validation_errors":[{"path":"/title","code":"unknown_reference","message":"Use a known reference"}]}),
        json!({"result":{"draft_id":"draft-1"}}),
    ], 3, 5_000, true).await;
    assert_eq!(requests.len(), 3, "no fourth inference after acceptance");
    assert_eq!(requests[0]["tools"][0]["function"]["strict"], true);
    assert!(requests[1].to_string().contains("validation_errors"));
    assert!(requests[2].to_string().contains("unknown_reference"));
    let calls = events
        .iter()
        .filter(|event| event["message_type"] == "client_tool_call")
        .collect::<Vec<_>>();
    assert_eq!(calls.len(), 2, "invalid schema never reaches the client");
    assert!(
        events
            .iter()
            .any(|event| event["output"]["submission"]["status"] == "accepted")
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn local_validation_stops_at_attempt_limit(pool: Pool<Postgres>) {
    let (requests, events) = run_submission(
        pool,
        vec![
            vec![("call_one", json!({"title":1}))],
            vec![("call_two", json!({"title":2}))],
        ],
        vec![],
        2,
        5_000,
        false,
    )
    .await;
    assert_eq!(requests.len(), 2);
    assert_eq!(requests[0]["tools"][0]["function"]["strict"], false);
    assert!(
        !events
            .iter()
            .any(|event| event["message_type"] == "client_tool_call")
    );
    assert!(
        events.iter().any(|event| event["output"]["submission"]
            == json!({"status":"failed","attempts_remaining":0}))
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn parallel_submissions_never_stage_two_drafts(pool: Pool<Postgres>) {
    let (requests, events) = run_submission(
        pool,
        vec![vec![
            ("call_a", json!({"title":"A"})),
            ("call_b", json!({"title":"B"})),
        ]],
        vec![],
        2,
        5_000,
        false,
    )
    .await;
    assert_eq!(requests.len(), 1);
    assert!(
        !events
            .iter()
            .any(|event| event["message_type"] == "client_tool_call")
    );
    assert!(
        events
            .iter()
            .any(|event| event["output"]["validation_errors"][0]["code"]
                == "submission_must_be_alone")
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn timed_out_submission_finishes_without_retrying_the_host(pool: Pool<Postgres>) {
    let (requests, events) = run_submission(
        pool,
        vec![vec![("call_timeout", json!({"title":"Draft"}))]],
        vec![],
        3,
        20,
        false,
    )
    .await;
    assert_eq!(requests.len(), 1);
    assert!(
        events
            .iter()
            .any(|event| event["output"]["reason"] == "timeout"
                && event["output"]["submission"]["status"] == "failed")
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn ordinary_client_tools_still_continue_after_success(pool: Pool<Postgres>) {
    let (requests, events) = run_submission(
        pool,
        vec![vec![("call_read", json!({"title":"Read input"}))]],
        vec![json!({"result":{"available":true}})],
        0,
        5_000,
        true,
    )
    .await;
    assert_eq!(
        requests.len(),
        2,
        "ordinary read tools still resume inference"
    );
    assert_eq!(requests[0]["tools"][0]["function"]["strict"], false);
    assert!(
        !events
            .iter()
            .any(|event| event["output"].get("submission").is_some())
    );
}

/// Client files must survive the full tool loop, completion SSE and persisted
/// history; a JSON-only reference cannot drive the attachment renderer.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn client_tool_attachments_are_linked_streamed_and_persisted(pool: Pool<Postgres>) {
    use axum_test::multipart::{MultipartForm, Part};

    let mut mocks = MockSet::new();
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[], &["call_files"]));
        mock_llm_sse_response(
            then,
            build_openai_tool_calls_streaming_response(&[(
                "call_files",
                "retrieve_files",
                json!({}),
            )]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&["call_files"], &[]));
        mock_llm_sse_response(
            then,
            build_openai_text_streaming_response(&["Retrieved your files."]),
        );
    });
    let (mut config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    config.client_tools.tools.insert(
        "files".into(),
        ClientToolConfig {
            name: "retrieve_files".into(),
            parameters: json!({"type":"object","properties":{}}).to_string(),
            ..Default::default()
        },
    );
    config.facets.tool_call_allowlist = vec!["client/retrieve_files".into()];
    let state = test_app_state(config, pool).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let server = app_server(state.clone());
    // Standalone uploads exercise creation of the chat association. Include a
    // document that parses, one that cannot parse, and an image.
    let mut ids = Vec::new();
    for (name, mime, bytes) in [
        ("note.txt", "text/plain", b"ATTACHMENT TEXT".to_vec()),
        ("broken.pdf", "application/pdf", b"not a valid PDF".to_vec()),
        (
            "image.png",
            "image/png",
            read_integration_test_file_bytes("image_1.png"),
        ),
    ] {
        let upload_url = if name == "note.txt" {
            format!("/api/v1beta/me/files?chat_id={chat_id}")
        } else {
            "/api/v1beta/me/files".to_string()
        };
        let uploaded = server
            .post(&upload_url)
            .with_bearer_token(TEST_JWT_TOKEN)
            .multipart(
                MultipartForm::new()
                    .add_part("file", Part::bytes(bytes).file_name(name).mime_type(mime)),
            )
            .await;
        uploaded.assert_status_ok();
        ids.push(
            uploaded.json::<Value>()["files"][0]["id"]
                .as_str()
                .unwrap()
                .to_string(),
        );
    }
    let request = json!({"existing_chat_id":chat_id,"user_message":"Retrieve the files"});
    let submit = async {
        server
            .post("/api/v1beta/me/messages/submitstream")
            .with_bearer_token(TEST_JWT_TOKEN)
            .json(&request)
            .await
    };
    let client = async {
        loop {
            if let Some(task) = state.background_tasks.get_task(&chat_id).await {
                for event in task.get_event_history().await {
                    if let StreamingEvent::ClientToolCall {
                        message_id,
                        tool_call_id,
                        ..
                    } = event
                    {
                        let response = server.post("/api/v1beta/me/messages/clienttoolresult")
                            .with_bearer_token(TEST_JWT_TOKEN)
                            .json(&json!({
                                "chat_id": chat_id, "message_id": message_id, "tool_call_id": tool_call_id,
                                "result": null,
                                "file_upload_ids": [ids[0], ids[1], ids[2], ids[0]],
                            })).await;
                        response.assert_status_ok();
                        assert_eq!(response.json::<Value>()["delivered"], true);
                        return;
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    };
    let (response, ()) = tokio::time::timeout(Duration::from_secs(30), async {
        tokio::join!(submit, client)
    })
    .await
    .expect("file tool loop did not finish");
    response.assert_status_ok();
    let events: Vec<Value> = parse_sse_events(&response)
        .into_iter()
        .filter_map(|event| serde_json::from_str(&event.data).ok())
        .collect();
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
    let listing = server
        .get(&format!("/api/v1beta/chats/{chat_id}/messages"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    listing.assert_status_ok();
    let listing: Value = listing.json();
    let reloaded = listing["messages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|message| message["id"] == message_id.to_string())
        .unwrap();
    for content in [
        &completed["content"],
        &completed["message"]["content"],
        &saved.raw_message["content"],
        &reloaded["content"],
    ] {
        let parts = content.as_array().expect("message content");
        let pointers: Vec<_> = parts
            .iter()
            .filter(|part| part.get("file_upload_id").is_some())
            .collect();
        assert_eq!(pointers.len(), 3, "each file is attached once: {content}");
        for (index, id) in ids.iter().enumerate() {
            assert_eq!(pointers[index]["file_upload_id"], *id);
            assert_eq!(
                pointers[index]["content_type"],
                if index == 2 {
                    "image_file_pointer"
                } else {
                    "text_file_pointer"
                }
            );
        }
    }
    for id in ids {
        assert!(
            chat_file_uploads::Entity::find_by_id((chat_id, Uuid::parse_str(&id).unwrap()))
                .one(&state.db)
                .await
                .unwrap()
                .is_some()
        );
    }
}
