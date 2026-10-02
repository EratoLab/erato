//! Real upload -> PDF extraction -> tool dispatch -> multimodal request -> persisted replay.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::{Extension, Router, body::Body, extract::Request, extract::State, routing::post};
use axum_test::multipart::{MultipartForm, Part};
use axum_test::{TestResponse, TestServer, TestServerConfig, Transport};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use mock_llm_server::matcher::{
    MatchRule, MatchRuleUserMessagePattern, Matcher, Mock, ResponseConfig, StaticResponseConfig,
    ToolCallResponseConfig,
};
use mock_llm_server::request_id::RequestId;
use serde_json::{Value, json};
use sqlx::{Pool, Postgres};

use crate::test_app_state;
use crate::test_utils::{
    TEST_JWT_TOKEN, TestRequestAuthExt, hermetic_app_config, parse_sse_events,
};

const TOOL: &str = "retrieve_embedded_image";
const ANSWER: &str = "PDF inspection complete.";
const PDF: &[u8] = include_bytes!("../test_files/embedded-images.pdf");

#[derive(Clone, Default)]
struct ModelRequests {
    requests: Arc<Mutex<Vec<Value>>>,
    selected_id: Arc<Mutex<Option<String>>>,
    image_index: usize,
}

fn offered_ids(request: &Value) -> Option<&Vec<Value>> {
    let tool = request["tools"]
        .as_array()?
        .iter()
        .find(|tool| tool["function"]["name"] == TOOL)?;
    tool["function"]["parameters"]["properties"]["embedded_id"]["enum"].as_array()
}

// Select from the actual schema received over HTTP, then let mock-llm-server's
// real chat handler serialize and stream the response. Record raw JSON before
// deserialization so assertions cover the complete model-facing wire format.
async fn model_response(
    State(record): State<ModelRequests>,
    request: Request,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    let (parts, body) = request.into_parts();
    let bytes = axum::body::to_bytes(body, 16 * 1024 * 1024).await.unwrap();
    let value: Value = serde_json::from_slice(&bytes).unwrap();
    let mut response = ResponseConfig::Static(StaticResponseConfig {
        chunks: vec![ANSWER.into()],
        ..Default::default()
    });
    if value["stream"] == true {
        let mut requests = record.requests.lock().unwrap();
        if requests.is_empty()
            && let Some(id) = offered_ids(&value)
                .and_then(|ids| ids.get(record.image_index))
                .and_then(Value::as_str)
        {
            *record.selected_id.lock().unwrap() = Some(id.into());
            response = ResponseConfig::ToolCall(ToolCallResponseConfig {
                tool_name: TOOL.into(),
                arguments: json!({"embedded_id": id}).to_string(),
                delay_ms: 0,
            });
        }
        requests.push(value);
    }
    let matcher = Matcher::new(vec![Mock {
        name: "embedded PDF integration".into(),
        description: "Retrieve an offered image once, then finish the turn".into(),
        match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
            pattern: String::new(),
        })],
        response,
    }]);
    mock_llm_server::endpoints::chat::chat_completions(
        State(Arc::new(matcher)),
        Extension(RequestId::generate()),
        Request::from_parts(parts, Body::from(bytes)),
    )
    .await
    .into_response()
}

fn image_urls(request: &Value) -> Vec<&str> {
    request["messages"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|message| message["content"].as_array().into_iter().flatten())
        .filter(|part| part["type"] == "image_url")
        .map(|part| part["image_url"]["url"].as_str().expect("Image URL input"))
        .collect()
}

fn assert_retrieval(request: &Value, id: &str, expected: &[u8]) {
    let messages = request["messages"].as_array().unwrap();
    let results: Vec<_> = messages
        .iter()
        .enumerate()
        .filter(|(_, m)| m["role"] == "tool")
        .collect();
    assert_eq!(results.len(), 1, "Exactly one retrieval result");
    let (position, result) = results[0];
    let output: Value = serde_json::from_str(result["content"].as_str().unwrap()).unwrap();
    assert_eq!(output["status"], "success");
    assert_eq!(output["embedded_id"], id);
    assert!(
        output.get("embedded_image").is_none(),
        "Image must not remain in tool text"
    );
    let call = &messages[position - 1];
    assert_eq!(call["role"], "assistant");
    assert_eq!(call["tool_calls"][0]["id"], result["tool_call_id"]);
    assert_eq!(call["tool_calls"][0]["function"]["name"], TOOL);
    let arguments: Value = serde_json::from_str(
        call["tool_calls"][0]["function"]["arguments"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(arguments["embedded_id"], id);
    let image_message = &messages[position + 1];
    assert_eq!(image_message["role"], "user");
    assert_eq!(image_message["content"][0]["type"], "image_url");
    let urls = image_urls(request);
    assert_eq!(urls.len(), 1, "Only the selected image should be injected");
    assert_eq!(image_message["content"][0]["image_url"]["url"], urls[0]);
    let (header, data) = urls[0].split_once(',').expect("Base64 data URL");
    let mime = infer::get(expected).unwrap().mime_type();
    assert!(mime.starts_with("image/"));
    assert_eq!(header, format!("data:{mime};base64"));
    let decoded = STANDARD.decode(data).expect("Valid image base64");
    assert!(!decoded.is_empty());
    assert_eq!(
        decoded, expected,
        "Must return the selected PDF image, not another index"
    );
}

fn completed_message(response: &TestResponse) -> String {
    response.assert_status_ok();
    let events = parse_sse_events(response);
    let completed = events
        .iter()
        .filter_map(|event| serde_json::from_str::<Value>(&event.data).ok())
        .find(|event| event["message_type"] == "assistant_message_completed")
        .unwrap_or_else(|| panic!("Generation did not complete: {}", response.text()));
    assert!(
        completed["content"]
            .as_array()
            .unwrap()
            .iter()
            .any(|part| part["text"] == ANSWER),
        "{completed}"
    );
    assert!(
        !events.iter().any(|event| event.event_type == "error"),
        "{}",
        response.text()
    );
    completed["message_id"].as_str().unwrap().to_owned()
}

async fn run_scenario(
    pool: Pool<Postgres>,
    global: Option<bool>,
    provider: Option<bool>,
    enabled: bool,
    image_index: usize,
) {
    let record = ModelRequests {
        image_index,
        ..Default::default()
    };
    let model = TestServer::new_with_config(
        Router::new()
            .route("/v1/chat/completions", post(model_response))
            .with_state(record.clone()),
        TestServerConfig {
            transport: Some(Transport::HttpRandomPort),
            ..Default::default()
        },
    )
    .unwrap();
    let mut config = hermetic_app_config(None, Some(model.server_url("/v1/").unwrap().to_string()));
    let providers = config.chat_providers.as_mut().unwrap();
    if let Some(global) = global {
        providers.all_providers.enable_embedded_image_retrieval_tool = global;
    }
    let selected = providers.providers.get_mut("mock-llm").unwrap();
    selected.enable_embedded_image_retrieval_tool = provider;
    selected.model_capabilities.supports_image_understanding = true;
    let state = test_app_state(config, pool).await;
    let server = TestServer::new(
        erato::server::router::router(state.clone())
            .split_for_parts()
            .0
            .with_state(state),
    )
    .unwrap();
    let upload = server
        .post("/api/v1beta/me/files")
        .with_bearer_token(TEST_JWT_TOKEN)
        .multipart(
            MultipartForm::new().add_part(
                "file",
                Part::bytes(PDF.to_vec())
                    .file_name("embedded-images.pdf")
                    .mime_type("application/pdf"),
            ),
        )
        .await;
    upload.assert_status_ok();
    let uploaded: Value = upload.json();
    let file_id = uploaded["files"][0]["id"].as_str().unwrap();
    let response = tokio::time::timeout(
        Duration::from_secs(60),
        server
            .post("/api/v1beta/me/messages/submitstream")
            .with_bearer_token(TEST_JWT_TOKEN)
            .json(&json!({
                "user_message": "Inspect the embedded PDF images.",
                "input_files_ids": [file_id],
                "chat_provider_id": "mock-llm",
            }))
            .into_future(),
    )
    .await
    .expect("PDF generation timed out");
    let previous_message_id = completed_message(&response);
    let first_requests = record.requests.lock().unwrap().clone();
    assert_eq!(first_requests.len(), if enabled { 2 } else { 1 });
    let first = &first_requests[0];
    let text = first["messages"].to_string();
    assert!(
        text.contains("Image on page 1"),
        "PDF text must reach the model"
    );
    assert!(text.contains("Image on page 2"));
    assert!(
        image_urls(first).is_empty(),
        "Images should only arrive after retrieval"
    );
    if !enabled {
        assert!(
            first["tools"]
                .as_array()
                .into_iter()
                .flatten()
                .all(|t| t["function"]["name"] != TOOL)
        );
        assert!(!text.contains("file-embed://"));
        return;
    }
    let ids = offered_ids(first).expect("Retrieval tool with an allowlist");
    assert_eq!(
        ids,
        &vec![
            json!(format!("file-embed://{file_id}/0")),
            json!(format!("file-embed://{file_id}/1"))
        ]
    );
    for id in ids {
        // Decode message content rather than matching JSON escaping.
        let marker = format!("embeddedId=\"{}\"", id.as_str().unwrap());
        assert!(
            first["messages"].as_array().unwrap().iter().any(|m| {
                m["content"].as_str().is_some_and(|s| s.contains(&marker))
                    || m["content"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .any(|p| p["text"].as_str().is_some_and(|s| s.contains(&marker)))
            }),
            "Missing PDF marker {marker}"
        );
    }
    // Independent extraction is the oracle: no mocked PDF results or production
    // retrieval helper, and compare bytes for a specific document-wide index.
    let extraction = xberg::extract(
        xberg::ExtractInput::from_bytes(PDF.to_vec(), "application/pdf", None),
        &xberg::ExtractionConfig {
            use_cache: false,
            images: Some(xberg::ImageExtractionConfig {
                extract_images: true,
                ..Default::default()
            }),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let images = extraction.results[0].images.as_ref().unwrap();
    assert_eq!(images.len(), 2);
    assert_ne!(images[0].data, images[1].data);
    let expected = &images
        .iter()
        .find(|image| image.image_index == image_index as u32)
        .unwrap()
        .data;
    let id = record.selected_id.lock().unwrap().clone().unwrap();
    assert_eq!(id, ids[image_index]);
    assert_retrieval(&first_requests[1], &id, expected);
    let replay = tokio::time::timeout(
        Duration::from_secs(60),
        server
            .post("/api/v1beta/me/messages/submitstream")
            .with_bearer_token(TEST_JWT_TOKEN)
            .json(&json!({
                "previous_message_id": previous_message_id,
                "user_message": "Review the same image again from our conversation.",
                "chat_provider_id": "mock-llm",
            }))
            .into_future(),
    )
    .await
    .expect("Replay generation timed out");
    completed_message(&replay);
    let requests = record.requests.lock().unwrap();
    assert_eq!(
        requests.len(),
        3,
        "Replay must not retrieve the image again"
    );
    assert_retrieval(&requests[2], &id, expected);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn embedded_images_global_enablement_is_inherited(pool: Pool<Postgres>) {
    run_scenario(pool, Some(true), None, true, 0).await;
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn embedded_images_provider_false_overrides_global_true(pool: Pool<Postgres>) {
    run_scenario(pool, Some(true), Some(false), false, 0).await;
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn embedded_images_provider_true_overrides_global_false(pool: Pool<Postgres>) {
    run_scenario(pool, Some(false), Some(true), true, 1).await;
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn embedded_images_omitted_is_disabled(pool: Pool<Postgres>) {
    run_scenario(pool, None, None, false, 0).await;
}
