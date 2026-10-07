//! Approved MCP calls must materialize files before streaming or replaying results.
use super::*;
use axum::{
    Json,
    body::Bytes,
    extract::State,
    http::{Method, Uri},
    response::{IntoResponse, Response},
    routing::post,
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};

const PNG: &str =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const CSV: &str = "eCx5CjEsMgo=";
const MARKER: &str = "MCP-FILE-RESULT";

#[derive(Clone)]
struct Fixture {
    output: Value,
    structured: bool,
    is_error: bool,
    storage_failure: bool,
    calls: Arc<AtomicUsize>,
    files: Arc<Mutex<HashMap<String, Vec<u8>>>>,
}

async fn mcp(State(fixture): State<Fixture>, Json(request): Json<Value>) -> Response {
    if request.get("id").is_none() {
        return http::StatusCode::ACCEPTED.into_response();
    }
    let result = match request["method"].as_str().unwrap() {
        "initialize" => json!({
            "protocolVersion": request["params"]["protocolVersion"],
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "file-output-test", "version": "1"}
        }),
        "tools/list" => json!({"tools": [{
            "name": "generate_files", "inputSchema": {"type": "object"},
            "outputSchema": {
                "type": "object", "properties": {
                    "files": {"type": "array", "items": {"$ref": "#/$defs/File"}}
                },
                "$defs": {"File": {"type": "object", "properties": {
                    "content_base64": {"type": "string", "chat.erato/file_content_field": true},
                    "path": {"type": "string", "chat.erato/file_name_field": true},
                    "mime_type": {"type": "string"}
                }}}
            }
        }]}),
        "tools/call" => {
            fixture.calls.fetch_add(1, Ordering::SeqCst);
            let mut result = json!({
                "content": [{"type": "text", "text": fixture.output.to_string()}],
                "isError": fixture.is_error
            });
            if fixture.structured {
                // Both copies contain Base64 on the wire; neither may leak to history.
                result["structuredContent"] = fixture.output;
            }
            result
        }
        other => panic!("Unexpected MCP method: {other}"),
    };
    Json(json!({"jsonrpc": "2.0", "id": request["id"], "result": result})).into_response()
}

/// Minimal S3 fixture retains the actual uploaded bytes and serves replay reads.
async fn storage(
    State(fixture): State<Fixture>,
    method: Method,
    uri: Uri,
    body: Bytes,
) -> Response {
    if fixture.storage_failure {
        return http::StatusCode::FORBIDDEN.into_response();
    }
    let mut files = fixture.files.lock().unwrap();
    if method == Method::PUT {
        files.insert(uri.path().to_string(), body.to_vec());
        return ([("etag", "\"fixture\"")], "").into_response();
    }
    let Some(bytes) = files.get(uri.path()) else {
        return http::StatusCode::NOT_FOUND.into_response();
    };
    let mime = if uri.path().ends_with(".png") {
        "image/png"
    } else {
        "text/csv"
    };
    let mut response = if method == Method::HEAD {
        Bytes::new().into_response()
    } else {
        Bytes::copy_from_slice(bytes).into_response()
    };
    response
        .headers_mut()
        .insert("content-type", mime.parse().unwrap());
    response
        .headers_mut()
        .insert("content-length", bytes.len().into());
    response
        .headers_mut()
        .insert("etag", "\"fixture\"".parse().unwrap());
    response
}

fn file_output() -> Value {
    json!({"stdout": MARKER, "files": [
        {"path": "chart.png", "mime_type": "image/png", "content_base64": PNG},
        {"path": "data.csv", "mime_type": "text/csv", "content_base64": CSV}
    ]})
}

#[allow(clippy::too_many_arguments)]
async fn check_output(
    pool: Pool<Postgres>,
    output: Value,
    approval: Option<&str>,
    structured: bool,
    is_error: bool,
    storage_failure: bool,
    expected_status: &str,
    expected_files: usize,
) {
    let fixture = Fixture {
        output,
        structured,
        is_error,
        storage_failure,
        calls: Arc::default(),
        files: Arc::default(),
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let app = Router::new()
        .route("/mcp", post(mcp))
        .fallback(storage)
        .with_state(fixture.clone());
    let handle = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    for marker in [MARKER, "The user denied this tool call."] {
        let recorder = recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&[marker], &[]))
                .matcher(recorder);
            mock_llm_sse_response(
                then,
                build_openai_text_streaming_response(&["Files handled."]),
            );
        });
    }
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[],
                &[MARKER, "The user denied this tool call."],
            ));
        mock_llm_sse_response(
            then,
            build_openai_tool_calls_streaming_response(&[(
                "call_files",
                "generate_files",
                json!({}),
            )]),
        );
    });
    let (mut config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    config.mcp_servers.clear();
    config.mcp_servers.insert(
        "files".into(),
        mcp_server_config(&url, "/mcp", McpServerAuthenticationConfig::None),
    );
    config.mcp_server_permissions.rules.insert(
        "files".into(),
        erato::config::McpServerPermissionRule::AllowAll {
            mcp_server_ids: vec!["files".into()],
        },
    );
    config.mcp_servers_global.approval = erato::config::McpToolApprovalConfig {
        enabled: approval.is_some(),
        preset: erato::config::McpToolApprovalPreset::Restrictive,
        allow_always: false,
    };
    config.file_storage_providers.insert(
        "seaweedfs".into(),
        serde_json::from_value(json!({
            "provider_kind": "s3", "config": {
                "endpoint": url, "bucket": "files", "region": "us-east-1",
                "access_key_id": "fixture", "secret_access_key": "fixture"
            }
        }))
        .unwrap(),
    );
    let state = test_app_state(config, pool).await;
    get_or_create_user(&state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .unwrap();
    let server = app_server(state.clone());
    let initial = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"user_message": "Generate a chart and CSV"}))
        .await;
    initial.assert_status_ok();
    let events = parse_sse_events(&initial);
    let message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();
    let chat_id = extract_chat_id(&events).unwrap();
    let response = if let Some(decision) = approval {
        assert_eq!(
            fixture.calls.load(Ordering::SeqCst),
            0,
            "approval must precede execution"
        );
        assert!(fixture.files.lock().unwrap().is_empty());
        server
            .post("/api/v1beta/me/messages/continuestream")
            .with_bearer_token(TEST_JWT_TOKEN)
            .json(&json!({"message_id": message_id, "decision": decision}))
            .await
    } else {
        initial
    };
    response.assert_status_ok();
    let row = Messages::find_by_id(message_id)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    let parts = row.raw_message["content"].as_array().unwrap();
    let tool = parts
        .iter()
        .find(|part| part["content_type"] == "tool_use")
        .unwrap();
    assert_eq!(tool["status"], expected_status, "{tool}");
    let pointers: Vec<_> = parts
        .iter()
        .filter(|part| {
            part["content_type"] == "image_file_pointer"
                || part["content_type"] == "text_file_pointer"
        })
        .collect();
    assert_eq!(pointers.len(), expected_files, "{parts:?}");
    assert_eq!(
        file_uploads::Entity::find()
            .all(&state.db)
            .await
            .unwrap()
            .len(),
        expected_files,
        "failed validation or rejection must not create file rows"
    );
    assert_eq!(fixture.files.lock().unwrap().len(), expected_files);

    assert_eq!(
        fixture.calls.load(Ordering::SeqCst),
        usize::from(approval != Some("reject"))
    );
    if fixture.output["type"] == "content_filter" {
        assert!(
            recorder.bodies().is_empty(),
            "filtered result must stop generation"
        );
        assert_eq!(
            row.generation_metadata.unwrap()["error"]["error_type"],
            "content_filter"
        );
        assert!(response.text().contains("content_filter"));
    } else {
        assert_eq!(recorder.bodies().len(), 1, "generation must resume");
        let event_output = parse_sse_events(&response)
            .into_iter()
            .filter_map(|event| serde_json::from_str::<Value>(&event.data).ok())
            .find(|event| {
                event["message_type"] == "tool_call_update" && event["status"] == expected_status
            })
            .expect("terminal tool update");
        assert_eq!(event_output["output"], tool["output"]);
    }
    for pointer in &pointers {
        let id = Uuid::parse_str(pointer["file_upload_id"].as_str().unwrap()).unwrap();
        let upload = file_uploads::Entity::find_by_id(id)
            .one(&state.db)
            .await
            .unwrap()
            .unwrap();
        let expected = if pointer["content_type"] == "image_file_pointer" {
            PNG
        } else {
            CSV
        };
        assert_eq!(
            state
                .default_file_storage_provider()
                .read_file_to_bytes(&upload.file_storage_path)
                .await
                .unwrap(),
            STANDARD.decode(expected).unwrap()
        );
        assert!(
            tool["output"]
                .to_string()
                .contains(&format!("erato-file://{id}"))
        );
    }
    if expected_files > 0 {
        assert_eq!(fixture.files.lock().unwrap().len(), expected_files);
        // Exercise historical replay as well as the immediate continuation.
        server.post("/api/v1beta/me/messages/submitstream").with_bearer_token(TEST_JWT_TOKEN)
            .json(&json!({"existing_chat_id": chat_id, "previous_message_id": message_id, "user_message": "List those files again"}))
            .await.assert_status_ok();
        assert_eq!(recorder.bodies().len(), 2);
        for value in [
            row.raw_message.to_string(),
            tool["output"].to_string(),
            response.text(),
        ] {
            assert!(
                !value.contains(PNG) && !value.contains(CSV),
                "raw payload leaked: {value}"
            );
            assert!(!value.contains("structuredContent"));
        }
        for body in recorder.bodies() {
            let body: Value = serde_json::from_str(&body).unwrap();
            let outputs = body["messages"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|message| message["role"] == "tool")
                .map(Value::to_string)
                .collect::<String>();
            assert!(outputs.contains("erato-file://"), "{body}");
            assert!(!outputs.contains(PNG) && !outputs.contains(CSV));
            assert!(!outputs.contains("structuredContent"));
        }
    }
    handle.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn approved_structured_files(pool: Pool<Postgres>) {
    check_output(
        pool,
        file_output(),
        Some("approve"),
        true,
        false,
        false,
        "success",
        2,
    )
    .await;
}
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn approved_json_text_files(pool: Pool<Postgres>) {
    check_output(
        pool,
        file_output(),
        Some("approve"),
        false,
        false,
        false,
        "success",
        2,
    )
    .await;
}
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn uninterrupted_files(pool: Pool<Postgres>) {
    check_output(pool, file_output(), None, true, false, false, "success", 2).await;
}
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn rejected_files(pool: Pool<Postgres>) {
    check_output(
        pool,
        file_output(),
        Some("reject"),
        true,
        false,
        false,
        "error",
        0,
    )
    .await;
}
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn approved_invalid_base64(pool: Pool<Postgres>) {
    let mut output = file_output();
    output["files"][1]["content_base64"] = json!("not base64!");
    check_output(
        pool,
        output,
        Some("approve"),
        true,
        false,
        false,
        "error",
        0,
    )
    .await;
}
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn approved_invalid_metadata(pool: Pool<Postgres>) {
    let mut output = file_output();
    output["files"][1]["mime_type"] = json!("invalid");
    check_output(
        pool,
        output,
        Some("approve"),
        true,
        false,
        false,
        "error",
        0,
    )
    .await;
}
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn approved_storage_failure(pool: Pool<Postgres>) {
    check_output(
        pool,
        file_output(),
        Some("approve"),
        true,
        false,
        true,
        "error",
        0,
    )
    .await;
}
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn approved_empty_files(pool: Pool<Postgres>) {
    check_output(
        pool,
        json!({"stdout": MARKER, "files": []}),
        Some("approve"),
        true,
        false,
        false,
        "success",
        0,
    )
    .await;
}
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn approved_ordinary_result(pool: Pool<Postgres>) {
    check_output(
        pool,
        json!({"stdout": MARKER}),
        Some("approve"),
        false,
        false,
        false,
        "success",
        0,
    )
    .await;
}
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn approved_mcp_error(pool: Pool<Postgres>) {
    check_output(
        pool,
        json!({"stdout": MARKER, "files": [], "error": "worker failed"}),
        Some("approve"),
        true,
        true,
        false,
        "success",
        0,
    )
    .await;
}
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn approved_content_filter(pool: Pool<Postgres>) {
    check_output(
        pool,
        json!({"type": "content_filter", "message": "Blocked"}),
        Some("approve"),
        true,
        true,
        false,
        "error",
        0,
    )
    .await;
}

/// Integrated retrieval uses the existing extraction/cache path and stores only
/// its durable reference marker, including after a subsequent user turn.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn integrated_file_retrieval_full_text_and_replay(pool: Pool<Postgres>) {
    let file_id = Uuid::new_v4();
    let reference = format!("erato-file://{file_id}");
    let contents = format!(
        "column\n{}\nRETRIEVED-DOCUMENT-END\n",
        "document data\n".repeat(1500)
    );
    let fixture = Fixture {
        output: json!({}),
        structured: false,
        is_error: false,
        storage_failure: false,
        calls: Arc::default(),
        files: Arc::new(Mutex::new(HashMap::from([(
            "/files/document.csv".into(),
            contents.as_bytes().to_vec(),
        )]))),
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let app = Router::new().fallback(storage).with_state(fixture);
    let storage_task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    let empty_recorder = recorder.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&["No attachment"], &[]))
            .matcher(empty_recorder);
        mock_llm_sse_response(then, build_openai_text_streaming_response(&["Ready."]));
    });
    let first_recorder = recorder.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[],
                &["requested_in_full", "No attachment"],
            ))
            .matcher(first_recorder);
        mock_llm_sse_response(
            then,
            build_openai_tool_calls_streaming_response(&[(
                "read-document",
                "retrieve_file_contents",
                json!({"file_reference": reference}),
            )]),
        );
    });
    let next_recorder = recorder.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&["requested_in_full"], &[]))
            .matcher(next_recorder);
        mock_llm_sse_response(
            then,
            build_openai_text_streaming_response(&["Document read."]),
        );
    });
    let (mut config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    config.mcp_servers.clear();
    config.file_context.retrieve_file_contents_enabled = true;
    config.file_context.max_inline_tokens_per_file = 1;
    config.file_context.max_preview_tokens_per_file = 200;
    config.file_context.max_total_attachment_tokens = 200;
    config.file_context.preview.csv_max_sample_rows = 1;
    config.mcp_servers_global.approval.enabled = true;
    config.file_storage_providers.insert("seaweedfs".into(), serde_json::from_value(json!({
        "provider_kind":"s3", "config": {"endpoint":endpoint, "bucket":"files", "region":"us-east-1",
            "access_key_id":"fixture", "secret_access_key":"fixture"}
    })).unwrap());
    let state = test_app_state(config, pool).await;
    let user = get_or_create_user(&state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .unwrap();
    file_uploads::ActiveModel {
        id: ActiveValue::Set(file_id),
        owner_user_id: ActiveValue::Set(user.id.to_string()),
        filename: ActiveValue::Set("document.csv".into()),
        file_storage_provider_id: ActiveValue::Set("seaweedfs".into()),
        file_storage_path: ActiveValue::Set("document.csv".into()),
        audio_transcription: ActiveValue::Set(None),
        external_id_ews_id: ActiveValue::Set(None),
        outlook_provenance: ActiveValue::Set(None),
        created_at: ActiveValue::Set(Utc::now().into()),
        updated_at: ActiveValue::Set(Utc::now().into()),
    }
    .insert(&state.db)
    .await
    .unwrap();
    let server = app_server(state.clone());
    server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"user_message":"No attachment"}))
        .await
        .assert_status_ok();
    let empty_request: Value = serde_json::from_str(&recorder.bodies()[0]).unwrap();
    assert!(
        !empty_request["tools"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|tool| tool["function"]["name"] == "retrieve_file_contents")
    );
    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"user_message":"Read the complete document", "input_files_ids":[file_id]}))
        .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    let message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();
    let chat_id = extract_chat_id(&events).unwrap();
    let row = Messages::find_by_id(message_id)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    let tool = row.raw_message["content"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["content_type"] == "tool_use")
        .unwrap();
    assert_eq!(tool["status"], "success", "{}", response.text());
    assert_eq!(tool["output"]["file_context_status"], "requested_in_full");
    assert_eq!(tool["output"]["extraction_status"], "complete");
    assert!(
        !row.raw_message
            .to_string()
            .contains("RETRIEVED-DOCUMENT-END")
    );
    assert!(
        !row.generation_input_messages
            .unwrap()
            .to_string()
            .contains("RETRIEVED-DOCUMENT-END")
    );
    // Mock matchers can record the same request while trying multiple routes.
    // Select the actual model phases by their message content.
    let requests: Vec<Value> = recorder
        .bodies()
        .iter()
        .map(|body| serde_json::from_str(body).unwrap())
        .collect();
    let first = requests
        .iter()
        .find(|request| {
            request.to_string().contains("Read the complete document")
                && request["tools"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .any(|tool| tool["function"]["name"] == "retrieve_file_contents")
                && !request["messages"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|m| m["role"] == "tool")
        })
        .expect("initial document request");
    assert!(
        first
            .to_string()
            .contains("available via retrieve_file_contents"),
        "{first:#}"
    );
    assert!(!first.to_string().contains("RETRIEVED-DOCUMENT-END"));
    let second = requests
        .iter()
        .find(|request| {
            request["messages"]
                .as_array()
                .unwrap()
                .iter()
                .any(|m| m["role"] == "tool")
        })
        .expect("model continuation after retrieval");
    let messages = second["messages"].as_array().unwrap();
    let tool_position = messages.iter().position(|m| m["role"] == "tool").unwrap();
    assert!(
        !messages[tool_position]
            .to_string()
            .contains("RETRIEVED-DOCUMENT-END")
    );
    assert!(
        messages[tool_position + 1..]
            .iter()
            .any(|m| m["role"] == "user" && m.to_string().contains("RETRIEVED-DOCUMENT-END"))
    );
    server.post("/api/v1beta/me/messages/submitstream").with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"existing_chat_id":chat_id, "previous_message_id":message_id, "user_message":"Read that last line again"})).await.assert_status_ok();
    assert!(
        recorder
            .bodies()
            .iter()
            .any(|body| body.contains("Read that last line again")
                && body.contains("RETRIEVED-DOCUMENT-END"))
    );
    storage_task.abort();
}
