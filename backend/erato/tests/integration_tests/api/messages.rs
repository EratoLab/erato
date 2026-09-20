//! Message submission and streaming API tests.

use axum::Router;
use axum::http;
use axum_test::TestServer;
use chrono::Utc;
use erato::config::{
    ActionFacetConfig, ClientToolConfig, FacetConfig, FacetsConfig, McpServerAuthenticationConfig,
    McpServerConfig, McpServerForwardedAuthenticationConfig, McpServerForwardedCredential,
    McpServerOauth2AuthenticationConfig, ModelSettings, PromptSourceSpecification,
    SecretConfigString,
};
use erato::db::entity::prelude::Messages;
use erato::db::entity::{chat_file_uploads, chats, file_uploads};
use erato::models::message::{GenerationInputMessages, GenerationParameters};
use erato::models::user::get_or_create_user;
use erato::server::router::router;
use sea_orm::prelude::Uuid;
use sea_orm::{ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
use serde_json::{Value, json};
use sqlx::Pool;
use sqlx::postgres::Postgres;
use std::collections::HashMap;
use std::env;
use std::net::{IpAddr, Ipv4Addr};

use mocktail::MockSet;
use mocktail::body::BodyAction;
use mocktail::mock_builder::Then;
use mocktail::server::{MockServer, MockServerConfig};

use crate::test_app_state;
use crate::test_utils::{
    BodyContainsMatcher, JwtTokenBuilder, RequestBodyRecorder, RequestHeadersRecorder,
    TEST_JWT_TOKEN, TEST_USER_ISSUER, TEST_USER_SUBJECT, TestRequestAuthExt, archive_chat_via_api,
    build_openai_text_streaming_response, build_openai_tool_calls_streaming_response,
    extract_chat_id, extract_full_text, has_event_type, hermetic_app_config, parse_sse_events,
    read_integration_test_file_bytes, setup_mock_llm_server, setup_mock_llm_server_with_mocks,
};

fn mock_mcp_base_url() -> String {
    env::var("TEST_MOCK_MCP_SERVER_BASE_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:44321".to_string())
}

/// Configures a mock-LLM `then` clause to stream the given SSE body actions.
fn mock_llm_sse_response(then: Then, actions: Vec<BodyAction>) {
    then.status(http::StatusCode::OK)
        .headers([
            ("Content-Type", "text/event-stream"),
            ("Cache-Control", "no-cache"),
            ("Connection", "keep-alive"),
        ])
        .bytes_stream_with_delays(actions);
}

fn mcp_server_config(
    base_url: &str,
    path: &str,
    authentication: McpServerAuthenticationConfig,
) -> McpServerConfig {
    McpServerConfig {
        transport_type: "streamable_http".to_string(),
        url: format!("{base_url}{path}"),
        http_headers: None,
        allow_tools: None,
        exclude_tools: vec![],
        wait_tools: vec![],
        authentication,
        max_session_idle_seconds: None,
    }
}

/// Test message submission with SSE streaming.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
///
/// # Test Behavior
/// Verifies that users can submit messages to a chat and receive streamed responses
/// with all expected Server-Sent Event types.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_message_submit_stream(pool: Pool<Postgres>) {
    // Set up mock LLM server
    let (app_config, _server) = setup_mock_llm_server(None).await;

    // Create app state with the database connection
    let app_state = test_app_state(app_config, pool).await;

    // Create a test user
    let issuer = TEST_USER_ISSUER;
    let subject = TEST_USER_SUBJECT;
    let _user = get_or_create_user(&app_state.db, issuer, subject, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);

    // Create the test server with our router
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Prepare the request body
    let request_body = serde_json::json!({
        "user_message": "Hello, this is a test message"
    });

    // Make a request to the message submit endpoint with the mock JWT
    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&request_body)
        .await;

    // Verify the response status is OK
    response.assert_status_ok();

    // Collect all SSE events
    let body = response.as_bytes();
    let body_str = String::from_utf8_lossy(body);

    // Split the SSE stream into individual events
    let events: Vec<String> = body_str
        .split("\n\n")
        .filter(|chunk| chunk.contains("data:"))
        .map(|chunk| chunk.to_string())
        .collect();

    println!("Received {} events", events.len());
    for (i, event) in events.iter().enumerate() {
        println!("Event {}: {}", i, event);
    }

    // Helper function to check if an event of a specific type exists
    let has_event_type = |event_type: &str| {
        events.iter().any(|event| {
            let data = event.split("data:").nth(1).unwrap_or("").trim();
            if let Ok(json) = serde_json::from_str::<Value>(data) {
                json["message_type"] == event_type
            } else {
                false
            }
        })
    };

    // Count text_delta events
    let text_delta_count = events
        .iter()
        .filter(|event| {
            let data = event.split("data:").nth(1).unwrap_or("").trim();
            if let Ok(json) = serde_json::from_str::<Value>(data) {
                json["message_type"] == "text_delta"
            } else {
                false
            }
        })
        .count();

    // Assert that we received all expected event types
    assert!(
        has_event_type("chat_created"),
        "No chat_created event received"
    );
    assert!(
        has_event_type("user_message_saved"),
        "No user_message_saved event received"
    );
    assert!(
        has_event_type("assistant_message_started"),
        "No assistant_message_started event received"
    );
    assert!(text_delta_count > 0, "No text_delta events received");
    assert!(
        has_event_type("assistant_message_completed"),
        "No assistant_message_completed event received"
    );
    assert!(has_event_type("stream_end"), "No stream_end event received");

    // Additionally, verify the content of the assistant_message_completed event
    let assistant_message_completed_event_data = events
        .iter()
        .find_map(|event| {
            let data = event.split("data:").nth(1).unwrap_or("").trim();
            if let Ok(json) = serde_json::from_str::<Value>(data)
                && json["message_type"] == "assistant_message_completed"
            {
                return Some(json);
            }
            None
        })
        .expect("Could not find assistant_message_completed event data");

    let content_array = assistant_message_completed_event_data["content"]
        .as_array()
        .expect("Content should be an array");
    assert!(
        !content_array.is_empty(),
        "Content array should not be empty"
    );
    let first_content_part = &content_array[0];
    assert_eq!(first_content_part["content_type"].as_str().unwrap(), "text");
    assert!(first_content_part["text"].as_str().is_some());
}

/// Test facet selection persistence across a two-turn chat.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_facets_persisted_in_generation_parameters(pool: Pool<Postgres>) {
    let (mut app_config, _server) = setup_mock_llm_server(None).await;

    let mut facets = HashMap::new();
    facets.insert(
        "extended_thinking".to_string(),
        FacetConfig {
            display_name: "Extended thinking".to_string(),
            icon: Some("iconoir-lightbulb".to_string()),
            additional_system_prompt: None,
            tool_call_allowlist: vec![],
            model_settings: ModelSettings::default(),
            disable_facet_prompt_template: true,
            hidden: false,
            hidden_always_active_for_platform: None,
            delegation: None,
        },
    );
    facets.insert(
        "web_search".to_string(),
        FacetConfig {
            display_name: "Web search".to_string(),
            icon: Some("iconoir-globe".to_string()),
            additional_system_prompt: Some(PromptSourceSpecification::Static {
                content: "Please execute one or multiple web searches.".to_string(),
            }),
            tool_call_allowlist: vec!["web-search-mcp/*".to_string()],
            model_settings: ModelSettings::default(),
            disable_facet_prompt_template: false,
            hidden: false,
            hidden_always_active_for_platform: None,
            delegation: None,
        },
    );
    app_config.facets = FacetsConfig {
        facets,
        priority_order: vec!["extended_thinking".to_string(), "web_search".to_string()],
        tool_call_allowlist: vec![],
        facet_prompt_template: None,
        only_single_facet: false,
        show_facet_indicator_with_display_name: true,
        default_selected_facets: vec!["web_search".to_string()],
    };

    let app_state = test_app_state(app_config, pool).await;
    let db = app_state.db.clone();

    let issuer = TEST_USER_ISSUER;
    let subject = TEST_USER_SUBJECT;
    let _user = get_or_create_user(&app_state.db, issuer, subject, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    let facets_response = server
        .get("/api/v1beta/me/facets")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    facets_response.assert_status_ok();

    let first_request = json!({
        "previous_message_id": null,
        "user_message": "First turn",
        "selected_facet_ids": ["web_search"]
    });
    let first_response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&first_request)
        .await;
    first_response.assert_status_ok();

    let first_events = parse_sse_events(&first_response);
    let chat_id = extract_chat_id(&first_events).expect("Expected chat_id from first turn");
    let first_assistant_message_id = first_events
        .iter()
        .find_map(|event| {
            if let Ok(json) = serde_json::from_str::<Value>(&event.data)
                && json["message_type"] == "assistant_message_completed"
            {
                return json["message_id"].as_str().map(|s| s.to_string());
            }
            None
        })
        .expect("Expected assistant_message_completed event with message_id");

    let second_request = json!({
        "previous_message_id": first_assistant_message_id,
        "user_message": "Second turn",
        "selected_facet_ids": ["extended_thinking"]
    });
    let second_response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&second_request)
        .await;
    second_response.assert_status_ok();

    let chat_uuid: Uuid = chat_id.parse().expect("Failed to parse chat UUID");
    let assistant_messages = erato::db::entity::messages::Entity::find()
        .filter(erato::db::entity::messages::Column::ChatId.eq(chat_uuid))
        .filter(erato::db::entity::messages::Column::GenerationParameters.is_not_null())
        .order_by_asc(erato::db::entity::messages::Column::CreatedAt)
        .all(&db)
        .await
        .expect("Failed to fetch messages with generation parameters");

    assert_eq!(
        assistant_messages.len(),
        2,
        "Expected two assistant messages with generation parameters"
    );

    let first_params: GenerationParameters = serde_json::from_value(
        assistant_messages[0]
            .generation_parameters
            .clone()
            .expect("Missing generation_parameters"),
    )
    .expect("Failed to deserialize generation parameters for first turn");
    assert_eq!(
        first_params.selected_facets.get("web_search").copied(),
        Some(true)
    );
    assert_eq!(
        first_params
            .selected_facets
            .get("extended_thinking")
            .copied(),
        Some(false)
    );

    let second_params: GenerationParameters = serde_json::from_value(
        assistant_messages[1]
            .generation_parameters
            .clone()
            .expect("Missing generation_parameters"),
    )
    .expect("Failed to deserialize generation parameters for second turn");
    assert_eq!(
        second_params.selected_facets.get("web_search").copied(),
        Some(false)
    );
    assert_eq!(
        second_params
            .selected_facets
            .get("extended_thinking")
            .copied(),
        Some(true)
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_platform_persisted_in_generation_parameters_and_defaults_to_web(
    pool: Pool<Postgres>,
) {
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;
    let db = app_state.db.clone();

    let _user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    let first_response = server
        .post("/api/v1beta/me/messages/submitstream")
        .add_header("X-Erato-Platform", "desktop")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": "First turn" }))
        .await;
    first_response.assert_status_ok();

    let first_events = parse_sse_events(&first_response);
    let first_assistant_message_id = first_events
        .iter()
        .find_map(|event| {
            if let Ok(json) = serde_json::from_str::<Value>(&event.data)
                && json["message_type"] == "assistant_message_completed"
            {
                return json["message_id"].as_str().map(|s| s.to_string());
            }
            None
        })
        .expect("Expected assistant_message_completed event with message_id");

    let second_response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "previous_message_id": first_assistant_message_id,
            "user_message": "Second turn"
        }))
        .await;
    second_response.assert_status_ok();

    let assistant_messages = erato::db::entity::messages::Entity::find()
        .filter(erato::db::entity::messages::Column::GenerationParameters.is_not_null())
        .order_by_asc(erato::db::entity::messages::Column::CreatedAt)
        .all(&db)
        .await
        .expect("Failed to fetch messages with generation parameters");

    assert_eq!(assistant_messages.len(), 2);

    let first_params: GenerationParameters = serde_json::from_value(
        assistant_messages[0]
            .generation_parameters
            .clone()
            .expect("Missing generation_parameters"),
    )
    .expect("Failed to deserialize first generation parameters");
    assert_eq!(
        first_params
            .request_context
            .as_ref()
            .and_then(|context| context.platform.as_deref()),
        Some("desktop")
    );

    let second_params: GenerationParameters = serde_json::from_value(
        assistant_messages[1]
            .generation_parameters
            .clone()
            .expect("Missing generation_parameters"),
    )
    .expect("Failed to deserialize second generation parameters");
    assert_eq!(
        second_params
            .request_context
            .as_ref()
            .and_then(|context| context.platform.as_deref()),
        Some("web")
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_platform_persisted_for_regenerate_and_edit_generation_requests(pool: Pool<Postgres>) {
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;
    let db = app_state.db.clone();

    let _user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    let submit_response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": "Original turn" }))
        .await;
    submit_response.assert_status_ok();

    let submit_events = parse_sse_events(&submit_response);
    let original_assistant_message_id = submit_events
        .iter()
        .find_map(|event| {
            if let Ok(json) = serde_json::from_str::<Value>(&event.data)
                && json["message_type"] == "assistant_message_completed"
            {
                return json["message_id"].as_str().map(|s| s.to_string());
            }
            None
        })
        .expect("Expected assistant_message_completed event with message_id");

    let regenerate_response = server
        .post("/api/v1beta/me/messages/regeneratestream")
        .add_header("X-Erato-Platform", "mobile")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "current_message_id": original_assistant_message_id }))
        .await;
    regenerate_response.assert_status_ok();

    let user_message_to_edit = erato::db::entity::messages::Entity::find()
        .filter(erato::db::entity::messages::Column::GenerationParameters.is_null())
        .order_by_desc(erato::db::entity::messages::Column::CreatedAt)
        .one(&db)
        .await
        .expect("Failed to fetch latest user message")
        .expect("Expected user message to edit");

    let edit_response = server
        .post("/api/v1beta/me/messages/editstream")
        .add_header("X-Erato-Platform", "ios")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "message_id": user_message_to_edit.id,
            "replace_user_message": "Edited turn"
        }))
        .await;
    edit_response.assert_status_ok();

    let assistant_messages = erato::db::entity::messages::Entity::find()
        .filter(erato::db::entity::messages::Column::GenerationParameters.is_not_null())
        .order_by_asc(erato::db::entity::messages::Column::CreatedAt)
        .all(&db)
        .await
        .expect("Failed to fetch assistant messages");

    assert_eq!(assistant_messages.len(), 3);

    let regenerate_params: GenerationParameters = serde_json::from_value(
        assistant_messages[1]
            .generation_parameters
            .clone()
            .expect("Missing regenerate generation_parameters"),
    )
    .expect("Failed to deserialize regenerate generation parameters");
    assert_eq!(
        regenerate_params
            .request_context
            .as_ref()
            .and_then(|context| context.platform.as_deref()),
        Some("mobile")
    );

    let edit_params: GenerationParameters = serde_json::from_value(
        assistant_messages[2]
            .generation_parameters
            .clone()
            .expect("Missing edit generation_parameters"),
    )
    .expect("Failed to deserialize edit generation parameters");
    assert_eq!(
        edit_params
            .request_context
            .as_ref()
            .and_then(|context| context.platform.as_deref()),
        Some("ios")
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_summary_generation_sends_rendered_chat_provider_headers(pool: Pool<Postgres>) {
    let summary_headers = RequestHeadersRecorder::new();
    let mut mocks = MockSet::new();
    {
        let summary_headers = summary_headers.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&["Generate a summary"], &[]))
                .matcher(summary_headers);

            then.status(http::StatusCode::OK)
                .headers([("Content-Type", "application/json")])
                .json(json!({
                    "id": "chatcmpl-summary-header-test",
                    "object": "chat.completion",
                    "created": 1234567890,
                    "model": "gpt-3.5-turbo",
                    "choices": [{
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": "Rendered Summary"
                        },
                        "finish_reason": "stop"
                    }],
                    "usage": {
                        "prompt_tokens": 1,
                        "completion_tokens": 1,
                        "total_tokens": 2
                    }
                }));
        });
    }
    mocks.mock(|when, then| {
        when.post().path("/v1/chat/completions");
        mock_llm_sse_response(
            then,
            build_openai_text_streaming_response(&["Main response."]),
        );
    });

    let (mut app_config, _mock_server) = setup_mock_llm_server_with_mocks(mocks).await;
    let provider = app_config
        .chat_providers
        .as_mut()
        .expect("Expected chat providers")
        .providers
        .get_mut("mock-llm")
        .expect("Expected mock provider");
    provider.additional_request_headers = Some(vec![
        SecretConfigString::from("X-Erato-Summary-Email={{id_token.claims.email}}"),
        SecretConfigString::from("X-Erato-Summary-User={{erato_user.id}}"),
    ]);

    let app_state = test_app_state(app_config, pool).await;
    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    let submit_response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": "Summarize the header propagation path" }))
        .await;
    submit_response.assert_status_ok();

    for _ in 0..50 {
        if !summary_headers.headers().is_empty() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }

    let recorded_headers = summary_headers.headers();
    assert!(
        recorded_headers.iter().any(|headers| headers
            .iter()
            .any(|(name, value)| name == "x-erato-summary-email" && value == "admin@example.com")),
        "Expected rendered email header in summary provider request, got {recorded_headers:?}"
    );
    assert!(
        recorded_headers.iter().any(|headers| headers
            .iter()
            .any(|(name, value)| name == "x-erato-summary-user"
                && !value.is_empty()
                && !value.contains("{{"))),
        "Expected rendered user id header in summary provider request, got {recorded_headers:?}"
    );
}

/// Regenerating a message generated under an action facet re-applies the
/// stored facet when the request doesn't re-send one — mirroring the chat
/// provider fallback ("same input, new sample").
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_regenerate_falls_back_to_stored_action_facet(pool: Pool<Postgres>) {
    // Capture the LLM request bodies so we can assert the rendered facet
    // directive actually reached the model, not just the persisted params.
    let llm_request_recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    {
        let recorder = llm_request_recorder.clone();
        mocks.mock(move |when, then| {
            when.post().path("/v1/chat/completions").matcher(recorder);
            mock_llm_sse_response(then, build_openai_text_streaming_response(&["Rewritten."]));
        });
    }
    let (mut app_config, _server) = setup_mock_llm_server_with_mocks(mocks).await;
    add_action_facets(&mut app_config);
    let app_state = test_app_state(app_config, pool).await;
    let db = app_state.db.clone();

    let _user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    let submit_response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "user_message": "Rewrite this",
            "action_facet": {
                "id": "rewrite",
                "args": { "tone": "professional", "content": "yo whats up" }
            }
        }))
        .await;
    submit_response.assert_status_ok();

    let submit_events = parse_sse_events(&submit_response);
    let original_assistant_message_id = submit_events
        .iter()
        .find_map(|event| {
            if let Ok(json) = serde_json::from_str::<Value>(&event.data)
                && json["message_type"] == "assistant_message_completed"
            {
                return json["message_id"].as_str().map(|s| s.to_string());
            }
            None
        })
        .expect("Expected assistant_message_completed event with message_id");

    // Regenerate WITHOUT re-sending the action facet.
    let regenerate_response = server
        .post("/api/v1beta/me/messages/regeneratestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "current_message_id": original_assistant_message_id }))
        .await;
    regenerate_response.assert_status_ok();

    let assistant_messages = erato::db::entity::messages::Entity::find()
        .filter(erato::db::entity::messages::Column::GenerationParameters.is_not_null())
        .order_by_asc(erato::db::entity::messages::Column::CreatedAt)
        .all(&db)
        .await
        .expect("Failed to fetch assistant messages");
    assert_eq!(assistant_messages.len(), 2);

    let regenerate_params: GenerationParameters = serde_json::from_value(
        assistant_messages[1]
            .generation_parameters
            .clone()
            .expect("Missing regenerate generation_parameters"),
    )
    .expect("Failed to deserialize regenerate generation parameters");
    assert_eq!(
        regenerate_params.action_facet_id.as_deref(),
        Some("rewrite"),
        "Regenerate must re-apply the facet stored on the original generation",
    );
    assert_eq!(
        regenerate_params
            .action_facet_args
            .as_ref()
            .and_then(|args| args.get("tone"))
            .map(String::as_str),
        Some("professional")
    );

    // The rendered directive must have reached the LLM on both the original
    // submit and the regenerate request, not merely the persisted parameters.
    // The recorder also sees the chat-title summary request, which carries
    // only the raw user message — so count the directive-carrying bodies.
    let llm_request_bodies = llm_request_recorder.bodies();
    let directive_body_count = llm_request_bodies
        .iter()
        .filter(|body| {
            body.contains("Rewrite the following in a professional tone:")
                && body.contains("yo whats up")
        })
        .count();
    assert_eq!(
        directive_body_count, 2,
        "Expected the rendered facet directive in both generation request bodies: {llm_request_bodies:?}"
    );
}

/// Regenerating after the stored action facet stopped validating against the
/// current config drops the facet instead of failing the request.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_regenerate_drops_stored_action_facet_that_no_longer_validates(pool: Pool<Postgres>) {
    let (mut app_config, server) = setup_mock_llm_server(None).await;
    add_action_facets(&mut app_config);
    let app_state = test_app_state(app_config, pool.clone()).await;

    let _user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let test_server =
        TestServer::new(app.into_make_service()).expect("Failed to create test server");

    let submit_response = test_server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "user_message": "Rewrite this",
            "action_facet": {
                "id": "rewrite",
                "args": { "tone": "professional", "content": "yo whats up" }
            }
        }))
        .await;
    submit_response.assert_status_ok();

    let submit_events = parse_sse_events(&submit_response);
    let original_assistant_message_id = submit_events
        .iter()
        .find_map(|event| {
            if let Ok(json) = serde_json::from_str::<Value>(&event.data)
                && json["message_type"] == "assistant_message_completed"
            {
                return json["message_id"].as_str().map(|s| s.to_string());
            }
            None
        })
        .expect("Expected assistant_message_completed event with message_id");

    // Replace the config with one that no longer knows the stored facet
    // (same mock LLM, same database) and regenerate against the new app.
    let replacement_config = hermetic_app_config(None, Some(server.url("/v1/").to_string()));
    assert!(
        !replacement_config
            .action_facets
            .facets
            .contains_key("rewrite"),
        "Replacement config must not declare the stored facet"
    );
    let replacement_app_state = test_app_state(replacement_config, pool).await;
    let db = replacement_app_state.db.clone();
    let replacement_app: Router = router(replacement_app_state.clone())
        .split_for_parts()
        .0
        .with_state(replacement_app_state);
    let replacement_server =
        TestServer::new(replacement_app.into_make_service()).expect("Failed to create test server");

    let regenerate_response = replacement_server
        .post("/api/v1beta/me/messages/regeneratestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "current_message_id": original_assistant_message_id }))
        .await;
    regenerate_response.assert_status_ok();

    // The stream returns 200 even when it carries a mid-stream error event,
    // so assert the regenerate actually completed a generation.
    let regenerate_events = parse_sse_events(&regenerate_response);
    let regenerate_assistant_message_id = assistant_message_id_from_events(&regenerate_events);

    let assistant_messages = erato::db::entity::messages::Entity::find()
        .filter(erato::db::entity::messages::Column::GenerationParameters.is_not_null())
        .order_by_asc(erato::db::entity::messages::Column::CreatedAt)
        .all(&db)
        .await
        .expect("Failed to fetch assistant messages");
    assert_eq!(assistant_messages.len(), 2);
    assert_eq!(
        assistant_messages[1].id.to_string(),
        regenerate_assistant_message_id,
        "The completed regenerate stream must correspond to the second assistant row",
    );

    let regenerate_params: GenerationParameters = serde_json::from_value(
        assistant_messages[1]
            .generation_parameters
            .clone()
            .expect("Missing regenerate generation_parameters"),
    )
    .expect("Failed to deserialize regenerate generation parameters");
    assert_eq!(
        regenerate_params.action_facet_id, None,
        "A stored facet that no longer validates must be dropped on regenerate",
    );
    assert_eq!(regenerate_params.action_facet_args, None);
}

/// Test facet prompt injection behavior across a two-turn chat.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_facet_prompt_injection_toggle_behavior(pool: Pool<Postgres>) {
    let (mut app_config, _server) = setup_mock_llm_server(None).await;

    let mut facets = HashMap::new();
    facets.insert(
        "web_search".to_string(),
        FacetConfig {
            display_name: "Web search".to_string(),
            icon: Some("iconoir-globe".to_string()),
            additional_system_prompt: Some(PromptSourceSpecification::Static {
                content: "Use web search now.".to_string(),
            }),
            tool_call_allowlist: vec!["web-search-mcp/*".to_string()],
            model_settings: ModelSettings::default(),
            disable_facet_prompt_template: false,
            hidden: false,
            hidden_always_active_for_platform: None,
            delegation: None,
        },
    );
    facets.insert(
        "extended_thinking".to_string(),
        FacetConfig {
            display_name: "Extended thinking".to_string(),
            icon: Some("iconoir-lightbulb".to_string()),
            additional_system_prompt: Some(PromptSourceSpecification::Static {
                content: "Use extended thinking now.".to_string(),
            }),
            tool_call_allowlist: vec![],
            model_settings: ModelSettings::default(),
            disable_facet_prompt_template: true,
            hidden: false,
            hidden_always_active_for_platform: None,
            delegation: None,
        },
    );
    app_config.facets = FacetsConfig {
        facets,
        priority_order: vec!["web_search".to_string(), "extended_thinking".to_string()],
        tool_call_allowlist: vec![],
        facet_prompt_template: Some(PromptSourceSpecification::Static {
            content: "Facet {{facet_display_name}} tools:\n{{facet_tools_list}}".to_string(),
        }),
        only_single_facet: false,
        show_facet_indicator_with_display_name: true,
        default_selected_facets: vec![],
    };

    let app_state = test_app_state(app_config, pool).await;
    let db = app_state.db.clone();

    let issuer = TEST_USER_ISSUER;
    let subject = TEST_USER_SUBJECT;
    let _user = get_or_create_user(&app_state.db, issuer, subject, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    let facets_response = server
        .get("/api/v1beta/me/facets")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    facets_response.assert_status_ok();

    let first_request = json!({
        "previous_message_id": null,
        "user_message": "First turn",
        "selected_facet_ids": ["web_search"]
    });
    let first_response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&first_request)
        .await;
    first_response.assert_status_ok();

    let first_events = parse_sse_events(&first_response);
    let chat_id = extract_chat_id(&first_events).expect("Expected chat_id from first turn");
    let first_assistant_message_id = first_events
        .iter()
        .find_map(|event| {
            if let Ok(json) = serde_json::from_str::<Value>(&event.data)
                && json["message_type"] == "assistant_message_completed"
            {
                return json["message_id"].as_str().map(|s| s.to_string());
            }
            None
        })
        .expect("Expected assistant_message_completed event with message_id");

    let second_request = json!({
        "previous_message_id": first_assistant_message_id,
        "user_message": "Second turn",
        "selected_facet_ids": ["extended_thinking"]
    });
    let second_response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&second_request)
        .await;
    second_response.assert_status_ok();

    let chat_uuid: Uuid = chat_id.parse().expect("Failed to parse chat UUID");
    let assistant_messages = erato::db::entity::messages::Entity::find()
        .filter(erato::db::entity::messages::Column::ChatId.eq(chat_uuid))
        .filter(erato::db::entity::messages::Column::GenerationInputMessages.is_not_null())
        .order_by_asc(erato::db::entity::messages::Column::CreatedAt)
        .all(&db)
        .await
        .expect("Failed to fetch messages with generation input messages");

    assert_eq!(
        assistant_messages.len(),
        2,
        "Expected two assistant messages with generation input messages"
    );

    let first_gen_input: GenerationInputMessages = serde_json::from_value(
        assistant_messages[0]
            .generation_input_messages
            .clone()
            .expect("Missing generation_input_messages"),
    )
    .expect("Failed to deserialize generation input messages for first turn");
    let first_gen_input_value = serde_json::to_value(&first_gen_input)
        .expect("Failed to serialize generation input messages");
    let first_system_texts: Vec<String> = first_gen_input_value["messages"]
        .as_array()
        .expect("Expected messages array")
        .iter()
        .filter(|msg| msg["role"].as_str() == Some("system"))
        .filter_map(|msg| {
            if msg["content"]["content_type"].as_str() == Some("text") {
                msg["content"]["text"].as_str().map(str::to_string)
            } else {
                None
            }
        })
        .collect();

    let expected_template = "Facet Web search tools:\n- web-search-mcp/*".to_string();
    assert!(
        first_system_texts
            .iter()
            .any(|text| text == &expected_template),
        "Expected facet prompt template for web_search"
    );
    assert!(
        first_system_texts
            .iter()
            .any(|text| text.contains("Use web search now.")),
        "Expected additional_system_prompt for web_search"
    );

    let second_gen_input: GenerationInputMessages = serde_json::from_value(
        assistant_messages[1]
            .generation_input_messages
            .clone()
            .expect("Missing generation_input_messages"),
    )
    .expect("Failed to deserialize generation input messages for second turn");
    let second_gen_input_value = serde_json::to_value(&second_gen_input)
        .expect("Failed to serialize generation input messages");
    let second_system_texts: Vec<String> = second_gen_input_value["messages"]
        .as_array()
        .expect("Expected messages array")
        .iter()
        .filter(|msg| msg["role"].as_str() == Some("system"))
        .filter_map(|msg| {
            if msg["content"]["content_type"].as_str() == Some("text") {
                msg["content"]["text"].as_str().map(str::to_string)
            } else {
                None
            }
        })
        .collect();

    assert!(
        second_system_texts
            .iter()
            .any(|text| text.contains("Use extended thinking now.")),
        "Expected additional_system_prompt for extended_thinking"
    );
    assert!(
        second_system_texts
            .iter()
            .all(|text| !text.contains("Facet Web search tools")),
        "Did not expect web_search template on second turn"
    );
    assert!(
        second_system_texts
            .iter()
            .all(|text| !text.contains("Use web search now.")),
        "Did not expect web_search additional prompt on second turn"
    );
    assert!(
        second_system_texts
            .iter()
            .all(|text| !text.contains("Facet Extended thinking tools")),
        "Did not expect facet prompt template for extended_thinking when disabled"
    );
}

/// Test token usage estimation with file input.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
///
/// # Test Behavior
/// Verifies that the token usage endpoint correctly estimates token counts
/// for messages with file attachments.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_token_usage_estimate_with_file(pool: Pool<Postgres>) {
    // Set up mock LLM server
    let (app_config, _server) = setup_mock_llm_server(None).await;

    // Set up the test environment
    let app_state = test_app_state(app_config, pool).await;

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    // Create the test server with our router
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Create a mock JWT for authentication

    // First, create a chat by sending a message
    let message_request = json!({
        "previous_message_id": null,
        "user_message": "Test message to create a chat for token usage test"
    });

    // Send the message to create a chat
    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&message_request)
        .await;

    // Verify the response status is OK
    response.assert_status_ok();

    // Get the message ID from the response to use as previous_message_id
    let body = response.as_bytes();
    let body_str = String::from_utf8_lossy(body);
    let lines: Vec<&str> = body_str.lines().collect();

    let mut user_message_id = String::new();
    let mut chat_id = String::new();

    for i in 0..lines.len() - 1 {
        if lines[i] == "event: user_message_saved" {
            let data_line = lines[i + 1];
            if data_line.starts_with("data: ") {
                let data_json: Value = serde_json::from_str(&data_line[6..])
                    .expect("Failed to parse user_message_saved data");
                user_message_id = data_json["message_id"]
                    .as_str()
                    .expect("Expected message_id to be a string")
                    .to_string();
            }
        } else if lines[i] == "event: chat_created" {
            let data_line = lines[i + 1];
            if data_line.starts_with("data: ") {
                let data_json: Value = serde_json::from_str(&data_line[6..])
                    .expect("Failed to parse chat_created data");
                chat_id = data_json["chat_id"]
                    .as_str()
                    .expect("Expected chat_id to be a string")
                    .to_string();
            }
        }
    }

    // Create a test file
    let file_content = "This is a test file for token usage estimation.\nIt contains some text that should be tokenized by the service.\nThe goal is to test that the token usage endpoint correctly counts tokens for files.";

    // Convert to owned Vec<u8> to satisfy 'static lifetime requirement
    let file_bytes = file_content.as_bytes().to_vec();

    // Create a multipart form with the file
    let multipart_form = axum_test::multipart::MultipartForm::new().add_part(
        "file",
        axum_test::multipart::Part::bytes(file_bytes)
            .file_name("test_token_count.txt")
            .mime_type("text/plain"),
    );

    // Upload the file
    let response = server
        .post(&format!("/api/v1beta/me/files?chat_id={}", chat_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .multipart(multipart_form)
        .await;

    // Verify the response
    response.assert_status_ok();
    let response_json: Value = response.json();

    // Get the file ID
    let file_id = response_json["files"][0]["id"]
        .as_str()
        .expect("Expected file ID")
        .to_string();

    // Now call the token usage estimate endpoint with the file
    let token_usage_request = json!({
        "previous_message_id": user_message_id,
        "user_message": "Can you analyze this text file for me?",
        "input_files_ids": [file_id]
    });

    let response = server
        .post("/api/v1beta/token_usage/estimate")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&token_usage_request)
        .await;

    // Verify the response status is OK
    response.assert_status_ok();

    // Parse the token usage response
    let token_usage: Value = response.json();

    // Verify the response contains the expected fields
    assert!(
        token_usage["stats"]["total_tokens"].as_u64().is_some(),
        "Missing total_tokens in response"
    );
    assert!(
        token_usage["stats"]["user_message_tokens"]
            .as_u64()
            .is_some(),
        "Missing user_message_tokens in response"
    );
    assert!(
        token_usage["stats"]["history_tokens"].as_u64().is_some(),
        "Missing history_tokens in response"
    );
    assert!(
        token_usage["stats"]["file_tokens"].as_u64().is_some(),
        "Missing file_tokens in response"
    );
    assert!(
        token_usage["stats"]["max_tokens"].as_u64().is_some(),
        "Missing max_tokens in response"
    );
    assert!(
        token_usage["stats"]["remaining_tokens"].as_u64().is_some(),
        "Missing remaining_tokens in response"
    );

    // Verify file details
    let file_details = token_usage["file_details"]
        .as_array()
        .expect("Expected file_details array");
    assert_eq!(file_details.len(), 1, "Expected 1 file in file_details");

    let file_detail = &file_details[0];
    assert_eq!(
        file_detail["id"].as_str().unwrap(),
        file_id,
        "File ID mismatch"
    );
    assert_eq!(
        file_detail["filename"].as_str().unwrap(),
        "test_token_count.txt",
        "Filename mismatch"
    );
    assert!(
        file_detail["token_count"].as_u64().is_some(),
        "Missing token_count in file details"
    );

    // Verify the token counts are reasonable
    let user_message_tokens = token_usage["stats"]["user_message_tokens"]
        .as_u64()
        .unwrap();
    let file_tokens = token_usage["stats"]["file_tokens"].as_u64().unwrap();
    let file_detail_tokens = file_detail["token_count"].as_u64().unwrap();

    // A simple user message should have at least a few tokens
    assert!(
        user_message_tokens > 0,
        "User message token count should be > 0"
    );
    assert!(
        user_message_tokens < 50,
        "User message token count should be reasonable"
    );

    // File tokens should match the file detail tokens
    assert_eq!(
        file_tokens, file_detail_tokens,
        "File tokens should match file detail tokens"
    );

    // The file should have a reasonable number of tokens based on its content
    assert!(file_tokens > 0, "File token count should be > 0");

    // Total tokens should be at least the sum of user message, history, and file tokens
    let total_tokens = token_usage["stats"]["total_tokens"].as_u64().unwrap();
    let history_tokens = token_usage["stats"]["history_tokens"].as_u64().unwrap();
    assert!(
        total_tokens >= user_message_tokens + history_tokens,
        "Total tokens should be at least the sum of component tokens"
    );

    // Max tokens should be a reasonable value
    // In CI, this will be 1000 (test-token-limit model from erato.template.toml)
    // In local dev with different config, it may vary
    let max_tokens = token_usage["stats"]["max_tokens"].as_u64().unwrap();
    assert!(max_tokens > 0, "Max tokens should be greater than 0");
    assert!(max_tokens >= 1000, "Max tokens should be at least 1000");

    // Remaining tokens should be max_tokens - total_tokens
    let remaining_tokens = token_usage["stats"]["remaining_tokens"].as_u64().unwrap();
    assert_eq!(
        remaining_tokens,
        max_tokens - total_tokens,
        "Remaining tokens should be max_tokens - total_tokens"
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_token_usage_estimate_with_eml_file(pool: Pool<Postgres>) {
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    let message_request = json!({
        "previous_message_id": null,
        "user_message": "Test message to create a chat for EML token usage test"
    });

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&message_request)
        .await;

    response.assert_status_ok();

    let body = response.as_bytes();
    let body_str = String::from_utf8_lossy(body);
    let lines: Vec<&str> = body_str.lines().collect();

    let mut user_message_id = String::new();
    let mut chat_id = String::new();

    for i in 0..lines.len() - 1 {
        if lines[i] == "event: user_message_saved" {
            let data_line = lines[i + 1];
            if data_line.starts_with("data: ") {
                let data_json: Value = serde_json::from_str(&data_line[6..])
                    .expect("Failed to parse user_message_saved data");
                user_message_id = data_json["message_id"]
                    .as_str()
                    .expect("Expected message_id to be a string")
                    .to_string();
            }
        } else if lines[i] == "event: chat_created" {
            let data_line = lines[i + 1];
            if data_line.starts_with("data: ") {
                let data_json: Value = serde_json::from_str(&data_line[6..])
                    .expect("Failed to parse chat_created data");
                chat_id = data_json["chat_id"]
                    .as_str()
                    .expect("Expected chat_id to be a string")
                    .to_string();
            }
        }
    }

    let multipart_form = axum_test::multipart::MultipartForm::new().add_part(
        "file",
        axum_test::multipart::Part::bytes(read_integration_test_file_bytes(
            "please_review_attached_draft.eml",
        ))
        .file_name("please_review_attached_draft.eml")
        .mime_type("application/octet-stream"),
    );

    let upload_response = server
        .post(&format!("/api/v1beta/me/files?chat_id={}", chat_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .multipart(multipart_form)
        .await;

    upload_response.assert_status_ok();
    let upload_json: Value = upload_response.json();
    assert_eq!(
        upload_json["files"][0]["file_capability"]["id"],
        json!("email")
    );

    let file_id = upload_json["files"][0]["id"]
        .as_str()
        .expect("Expected file ID")
        .to_string();

    let token_usage_request = json!({
        "previous_message_id": user_message_id,
        "user_message": "Can you analyze this email file for me?",
        "input_files_ids": [file_id]
    });

    let response = server
        .post("/api/v1beta/token_usage/estimate")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&token_usage_request)
        .await;

    response.assert_status_ok();
    let token_usage: Value = response.json();

    let file_detail = &token_usage["file_details"][0];
    assert_eq!(
        file_detail["filename"],
        json!("please_review_attached_draft.eml")
    );
    assert!(
        file_detail["token_count"]
            .as_u64()
            .expect("Expected token_count")
            > 0,
        "Expected extracted email content to produce tokens"
    );
    assert!(
        token_usage["stats"]["file_tokens"]
            .as_u64()
            .expect("Expected file_tokens")
            > 0,
        "Expected file_tokens to be greater than zero"
    );
}

/// Test token usage estimate increases when a file is attached.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_token_usage_estimate_increases_with_file_over_prompt_only(pool: Pool<Postgres>) {
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    let message_request = json!({
        "previous_message_id": null,
        "user_message": "Test message to create a chat for token usage test"
    });

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&message_request)
        .await;

    response.assert_status_ok();

    let body = response.as_bytes();
    let body_str = String::from_utf8_lossy(body);
    let lines: Vec<&str> = body_str.lines().collect();

    let mut user_message_id = String::new();
    let mut chat_id = String::new();

    for i in 0..lines.len() - 1 {
        if lines[i] == "event: user_message_saved" {
            let data_line = lines[i + 1];
            if data_line.starts_with("data: ") {
                let data_json: Value = serde_json::from_str(&data_line[6..])
                    .expect("Failed to parse user_message_saved data");
                user_message_id = data_json["message_id"]
                    .as_str()
                    .expect("Expected message_id to be a string")
                    .to_string();
            }
        } else if lines[i] == "event: chat_created" {
            let data_line = lines[i + 1];
            if data_line.starts_with("data: ") {
                let data_json: Value = serde_json::from_str(&data_line[6..])
                    .expect("Failed to parse chat_created data");
                chat_id = data_json["chat_id"]
                    .as_str()
                    .expect("Expected chat_id to be a string")
                    .to_string();
            }
        }
    }

    let baseline_request = json!({
        "previous_message_id": user_message_id,
        "user_message": "Can you analyze this text for me?",
        "input_files_ids": []
    });

    let baseline_response = server
        .post("/api/v1beta/token_usage/estimate")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&baseline_request)
        .await;

    baseline_response.assert_status_ok();
    let baseline_usage: Value = baseline_response.json();
    let baseline_total = baseline_usage["stats"]["total_tokens"]
        .as_u64()
        .expect("Expected baseline total_tokens");

    let file_content = "This is a test file for token usage estimation.\nIt contains some text that should be tokenized by the service.\nThe goal is to test that the token usage endpoint correctly counts tokens for files.";
    let file_bytes = file_content.as_bytes().to_vec();
    let multipart_form = axum_test::multipart::MultipartForm::new().add_part(
        "file",
        axum_test::multipart::Part::bytes(file_bytes)
            .file_name("test_token_count.txt")
            .mime_type("text/plain"),
    );

    let response = server
        .post(&format!("/api/v1beta/me/files?chat_id={}", chat_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .multipart(multipart_form)
        .await;

    response.assert_status_ok();
    let response_json: Value = response.json();
    let file_id = response_json["files"][0]["id"]
        .as_str()
        .expect("Expected file ID")
        .to_string();

    let with_file_request = json!({
        "previous_message_id": user_message_id,
        "user_message": "Can you analyze this text for me?",
        "input_files_ids": [file_id]
    });

    let with_file_response = server
        .post("/api/v1beta/token_usage/estimate")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&with_file_request)
        .await;

    with_file_response.assert_status_ok();
    let with_file_usage: Value = with_file_response.json();
    let with_file_total = with_file_usage["stats"]["total_tokens"]
        .as_u64()
        .expect("Expected with-file total_tokens");

    assert!(
        with_file_total > baseline_total,
        "Expected total tokens to increase when a file is attached"
    );
}

/// Test token usage estimate increases when an assistant has a file.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_token_usage_estimate_includes_assistant_file(pool: Pool<Postgres>) {
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    let file_content = json!({
        "name": "assistant_doc",
        "content": "This is a test file for the assistant."
    })
    .to_string();
    let file_bytes = file_content.into_bytes();
    let multipart_form = axum_test::multipart::MultipartForm::new().add_part(
        "file",
        axum_test::multipart::Part::bytes(file_bytes)
            .file_name("assistant_doc.json")
            .mime_type("application/json"),
    );

    let upload_response = server
        .post("/api/v1beta/me/files")
        .with_bearer_token(TEST_JWT_TOKEN)
        .multipart(multipart_form)
        .await;

    upload_response.assert_status_ok();
    let upload_json: Value = upload_response.json();
    let file_id = upload_json["files"][0]["id"]
        .as_str()
        .expect("Expected file id in upload response");

    let assistant_request_no_file = json!({
        "name": "No File Assistant",
        "description": "Assistant without files",
        "prompt": "You are a helpful test assistant.",
        "mcp_server_ids": null,
        "default_chat_provider": null,
        "file_ids": []
    });

    let assistant_no_file_response = server
        .post("/api/v1beta/assistants")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&assistant_request_no_file)
        .await;

    assistant_no_file_response.assert_status(http::StatusCode::CREATED);
    let assistant_no_file_json: Value = assistant_no_file_response.json();
    let assistant_no_file_id = assistant_no_file_json["id"]
        .as_str()
        .expect("Expected assistant id in response");

    let assistant_request_with_file = json!({
        "name": "File Assistant",
        "description": "Assistant with a file",
        "prompt": "You are a helpful test assistant.",
        "mcp_server_ids": null,
        "default_chat_provider": null,
        "file_ids": [file_id]
    });

    let assistant_with_file_response = server
        .post("/api/v1beta/assistants")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&assistant_request_with_file)
        .await;

    assistant_with_file_response.assert_status(http::StatusCode::CREATED);
    let assistant_with_file_json: Value = assistant_with_file_response.json();
    let assistant_with_file_id = assistant_with_file_json["id"]
        .as_str()
        .expect("Expected assistant id in response");

    let chat_no_file_response = server
        .post("/api/v1beta/me/chats")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&json!({ "assistant_id": assistant_no_file_id }))
        .await;
    chat_no_file_response.assert_status_ok();
    let chat_no_file_json: Value = chat_no_file_response.json();
    let chat_no_file_id = chat_no_file_json["chat_id"]
        .as_str()
        .expect("Expected chat_id in response");

    let chat_with_file_response = server
        .post("/api/v1beta/me/chats")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&json!({ "assistant_id": assistant_with_file_id }))
        .await;
    chat_with_file_response.assert_status_ok();
    let chat_with_file_json: Value = chat_with_file_response.json();
    let chat_with_file_id = chat_with_file_json["chat_id"]
        .as_str()
        .expect("Expected chat_id in response");

    let no_file_request = json!({
        "existing_chat_id": chat_no_file_id,
        "user_message": "Hello there"
    });
    let no_file_response = server
        .post("/api/v1beta/token_usage/estimate")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&no_file_request)
        .await;
    no_file_response.assert_status_ok();
    let no_file_usage: Value = no_file_response.json();
    let no_file_total = no_file_usage["stats"]["total_tokens"]
        .as_u64()
        .expect("Expected total_tokens for assistant without file");

    let with_file_request = json!({
        "existing_chat_id": chat_with_file_id,
        "user_message": "Hello there"
    });
    let with_file_response = server
        .post("/api/v1beta/token_usage/estimate")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&with_file_request)
        .await;
    with_file_response.assert_status_ok();
    let with_file_usage: Value = with_file_response.json();
    let with_file_total = with_file_usage["stats"]["total_tokens"]
        .as_u64()
        .expect("Expected total_tokens for assistant with file");

    assert!(
        with_file_total > no_file_total,
        "Expected assistant file to increase total token estimate"
    );
}

/// Test token usage estimate with composable request fields.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_token_usage_estimate_with_composable_payload(pool: Pool<Postgres>) {
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    let request = json!({
        "new_chat": {},
        "new_message_content": "Please summarize this.",
        "system_prompt": "You are a concise assistant."
    });

    let response = server
        .post("/api/v1beta/token_usage/estimate")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&request)
        .await;

    response.assert_status_ok();

    let token_usage: Value = response.json();
    let total_tokens = token_usage["stats"]["total_tokens"]
        .as_u64()
        .expect("Expected total_tokens");
    let user_message_tokens = token_usage["stats"]["user_message_tokens"]
        .as_u64()
        .expect("Expected user_message_tokens");
    let remaining_tokens = token_usage["stats"]["remaining_tokens"]
        .as_u64()
        .expect("Expected remaining_tokens");
    let max_tokens = token_usage["stats"]["max_tokens"]
        .as_u64()
        .expect("Expected max_tokens");

    assert!(total_tokens > 0, "Expected total tokens to be > 0");
    assert!(
        user_message_tokens > 0,
        "Expected new_message_content to contribute user_message_tokens"
    );
    assert_eq!(
        remaining_tokens,
        max_tokens - total_tokens,
        "Expected remaining_tokens to equal max_tokens - total_tokens"
    );
}

/// Inline virtual files contribute to the per-file breakdown and token total
/// without persisting any `file_uploads` row. Add-in flow: previewed Outlook
/// email body is included in the estimate without orphaning storage.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_token_usage_estimate_with_virtual_file(pool: Pool<Postgres>) {
    use base64::{Engine as _, engine::general_purpose};

    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    let body = b"This is the previewed email body. It contains some text that should be tokenized.";
    let request = json!({
        "new_chat": {},
        "new_message_content": "Summarize this email.",
        "virtual_files": [{
            "filename": "preview.txt",
            "content_type": "text/plain",
            "base64": general_purpose::STANDARD.encode(body),
        }],
    });

    let response = server
        .post("/api/v1beta/token_usage/estimate")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&request)
        .await;

    response.assert_status_ok();
    let token_usage: Value = response.json();

    let file_details = token_usage["file_details"]
        .as_array()
        .expect("Expected file_details array");
    assert_eq!(file_details.len(), 1, "Expected one virtual file detail");
    let virtual_detail = &file_details[0];
    assert_eq!(
        virtual_detail["filename"].as_str().unwrap(),
        "preview.txt",
        "Filename should be echoed in file_details"
    );
    let virtual_tokens = virtual_detail["token_count"]
        .as_u64()
        .expect("Expected token_count");
    assert!(virtual_tokens > 0, "Virtual file should contribute tokens");

    let file_tokens = token_usage["stats"]["file_tokens"]
        .as_u64()
        .expect("Expected file_tokens");
    assert_eq!(
        file_tokens, virtual_tokens,
        "Stats.file_tokens should equal the virtual file's contribution"
    );

    let total_tokens = token_usage["stats"]["total_tokens"]
        .as_u64()
        .expect("Expected total_tokens");
    assert!(
        total_tokens >= file_tokens,
        "Total should include the virtual file contribution"
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_token_usage_estimate_with_virtual_styled_newsletter_eml(pool: Pool<Postgres>) {
    use base64::{Engine as _, engine::general_purpose};

    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    let eml_bytes = read_integration_test_file_bytes("weekly_digest_microsoft_via_erato.eml");
    let request = json!({
        "new_chat": {},
        "new_message_content": "Summarize this email and identify key points.",
        "virtual_files": [{
            "filename": "weekly_digest_microsoft_via_erato.eml",
            "content_type": "message/rfc822",
            "base64": general_purpose::STANDARD.encode(eml_bytes),
        }],
    });

    let response = server
        .post("/api/v1beta/token_usage/estimate")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&request)
        .await;

    response.assert_status_ok();
    let token_usage: Value = response.json();

    let file_details = token_usage["file_details"]
        .as_array()
        .expect("Expected file_details array");
    assert_eq!(file_details.len(), 1, "Expected one virtual file detail");
    let virtual_detail = &file_details[0];
    assert_eq!(
        virtual_detail["filename"].as_str().unwrap(),
        "weekly_digest_microsoft_via_erato.eml",
        "Filename should be echoed in file_details"
    );
    let virtual_tokens = virtual_detail["token_count"]
        .as_u64()
        .expect("Expected token_count");
    assert!(
        virtual_tokens > 1000,
        "Virtual EML should contribute tokens (and not remove too much content)"
    );
    assert!(
        virtual_tokens < 20_000,
        "Virtual EML should be parsed and bounded to realistic size; got {virtual_tokens} tokens"
    );

    let total_tokens = token_usage["stats"]["total_tokens"]
        .as_u64()
        .expect("Expected total_tokens");
    let file_tokens = token_usage["stats"]["file_tokens"]
        .as_u64()
        .expect("Expected file_tokens");

    assert!(
        file_tokens >= virtual_tokens,
        "Stats file_tokens should include virtual file contribution"
    );
    assert!(
        total_tokens >= file_tokens,
        "total_tokens should include file token contribution"
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_message_submit_with_completed_audio_transcription(pool: Pool<Postgres>) {
    use crate::test_utils::MockLlmConfig;
    let mock_config = MockLlmConfig {
        chunks: vec![
            "I".to_string(),
            " can".to_string(),
            " summarize".to_string(),
            " the".to_string(),
            " completed".to_string(),
            " audio".to_string(),
            " file".to_string(),
            ".".to_string(),
        ],
        ..Default::default()
    };
    let (app_config, _server) = setup_mock_llm_server(Some(mock_config)).await;
    let app_state = test_app_state(app_config, pool).await;
    let db = app_state.db.clone();
    let global_policy_engine = app_state.global_policy_engine.clone();

    let _user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    let create_chat_response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "user_message": "Let's start a new chat to attach a completed audio file.",
        }))
        .await;
    create_chat_response.assert_status_ok();
    let create_chat_events = parse_sse_events(&create_chat_response);
    let chat_id = extract_chat_id(&create_chat_events).expect("Expected chat_created event");
    let chat_uuid = Uuid::parse_str(&chat_id).expect("Invalid chat UUID");

    let first_assistant_message_id = create_chat_events
        .iter()
        .find_map(|event| {
            if let Ok(json) = serde_json::from_str::<Value>(&event.data)
                && json["message_type"] == "assistant_message_completed"
            {
                return json["message_id"].as_str().map(|s| s.to_string());
            }
            None
        })
        .expect("Expected assistant_message_completed in chat creation response");

    let audio_file_id = Uuid::new_v4();
    let transcript = String::from_utf8(read_integration_test_file_bytes(
        "audio_recordings/sales-summary-1-1.script.md",
    ))
    .expect("Failed to read audio transcript fixture");
    let audio_transcription = serde_json::json!({
        "status": "completed",
        "transcript": transcript,
    })
    .to_string();

    let audio_file = file_uploads::ActiveModel {
        id: ActiveValue::Set(audio_file_id),
        owner_user_id: ActiveValue::Set(TEST_USER_SUBJECT.to_string()),
        filename: ActiveValue::Set("sales-summary-1-1.mp3".to_string()),
        file_storage_provider_id: ActiveValue::Set("local".to_string()),
        file_storage_path: ActiveValue::Set("/fixtures/sales-summary-1-1.mp3".to_string()),
        audio_transcription: ActiveValue::Set(Some(audio_transcription)),
        created_at: ActiveValue::Set(Utc::now().into()),
        updated_at: ActiveValue::Set(Utc::now().into()),
    };
    audio_file
        .insert(&db)
        .await
        .expect("Failed to insert audio file upload");

    let chat_file_upload = chat_file_uploads::ActiveModel {
        chat_id: ActiveValue::Set(chat_uuid),
        file_upload_id: ActiveValue::Set(audio_file_id),
        created_at: ActiveValue::Set(Utc::now().into()),
        updated_at: ActiveValue::Set(Utc::now().into()),
    };
    chat_file_upload
        .insert(&db)
        .await
        .expect("Failed to link audio file upload to chat");

    // The rows were inserted directly; the upload endpoint would have
    // invalidated the policy data after creating them.
    global_policy_engine.invalidate_data().await;

    let summarize_response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "previous_message_id": first_assistant_message_id,
            "user_message": "Can you summarize this audio?",
            "input_files_ids": [audio_file_id],
        }))
        .await;
    summarize_response.assert_status_ok();

    let summarize_events = parse_sse_events(&summarize_response);
    assert!(
        summarize_events.iter().any(|event| {
            if let Ok(json) = serde_json::from_str::<Value>(&event.data) {
                return json["message_type"] == "assistant_message_completed";
            }
            false
        }),
        "Expected assistant_message_completed when using completed audio transcription"
    );

    let assistant_text = extract_full_text(&summarize_events);
    assert!(
        assistant_text.contains("audio"),
        "Expected audio summary response, got: {assistant_text}"
    );
}

/// When a user submits an audio file with a completed transcript as the *first* (and only)
/// message in a new chat — no typed text — the SSE submission path must accept the request
/// and create the chat (rather than rejecting an empty `user_message`).
///
/// Regression test for: audio transcription mode producing "Untitled Chat" summaries. This
/// test exercises the request path that triggers `generate_chat_summary` with a
/// `TextFilePointer`-only first turn. With the bug present the request itself still succeeds
/// (the only visible symptom is a missing title) so the asserts below are necessary but not
/// sufficient. The transcript-promotion logic itself is covered by the `resolver_*` tests
/// in `message_streaming::summary_generation_tests`, which exercise
/// `resolve_audio_transcripts_for_summary` directly against an in-memory `FileUploadLookup`
/// stub.
///
/// Full end-to-end verification that `chats.title_by_summary` is populated requires the mock
/// LLM in `setup_mock_llm_server` to serve a non-streaming (`stream: false`) JSON response
/// for the summary call — the current mock only returns `text/event-stream`, so the
/// background summary task fails for every test in this file regardless of the audio fix.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_chat_summary_generated_for_audio_only_first_message(pool: Pool<Postgres>) {
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;
    let db = app_state.db.clone();
    let global_policy_engine = app_state.global_policy_engine.clone();

    let _user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Create a preliminary chat so we have a chat to link the audio file to.
    // File upload authorization requires the file to be linked to an accessible chat.
    let preliminary_response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": "preliminary chat" }))
        .await;
    preliminary_response.assert_status_ok();
    let preliminary_events = parse_sse_events(&preliminary_response);
    let preliminary_chat_id = extract_chat_id(&preliminary_events)
        .expect("Expected chat_created event in preliminary request");
    let preliminary_chat_uuid =
        Uuid::parse_str(&preliminary_chat_id).expect("Invalid preliminary chat UUID");

    // Insert a file upload with a completed audio transcript and link it to the
    // preliminary chat so the policy engine allows access.
    let audio_file_id = Uuid::new_v4();
    let audio_transcription = serde_json::json!({
        "status": "completed",
        "transcript": "This is a transcript about quarterly sales performance.",
    })
    .to_string();

    let audio_file = file_uploads::ActiveModel {
        id: ActiveValue::Set(audio_file_id),
        owner_user_id: ActiveValue::Set(TEST_USER_SUBJECT.to_string()),
        filename: ActiveValue::Set("quarterly-update.mp3".to_string()),
        file_storage_provider_id: ActiveValue::Set("local".to_string()),
        file_storage_path: ActiveValue::Set("/fixtures/quarterly-update.mp3".to_string()),
        audio_transcription: ActiveValue::Set(Some(audio_transcription)),
        created_at: ActiveValue::Set(Utc::now().into()),
        updated_at: ActiveValue::Set(Utc::now().into()),
    };
    audio_file
        .insert(&db)
        .await
        .expect("Failed to insert audio file upload");

    let chat_file_upload = chat_file_uploads::ActiveModel {
        chat_id: ActiveValue::Set(preliminary_chat_uuid),
        file_upload_id: ActiveValue::Set(audio_file_id),
        created_at: ActiveValue::Set(Utc::now().into()),
        updated_at: ActiveValue::Set(Utc::now().into()),
    };
    chat_file_upload
        .insert(&db)
        .await
        .expect("Failed to link audio file to preliminary chat");

    // The rows were inserted directly; the upload endpoint would have
    // invalidated the policy data after creating them.
    global_policy_engine.invalidate_data().await;

    // Submit the audio file as the first (and only content) in a BRAND NEW chat.
    // No `user_message` text and no `previous_message_id` — the audio-only first-message
    // scenario reported in the bug.
    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "user_message": "",
            "input_files_ids": [audio_file_id],
        }))
        .await;
    response.assert_status_ok();

    let events = parse_sse_events(&response);
    let audio_chat_id = extract_chat_id(&events).expect("Expected chat_created event");
    assert_ne!(
        audio_chat_id, preliminary_chat_id,
        "Audio-only submission should create a new chat, not reuse the preliminary one"
    );
    let audio_chat_uuid = Uuid::parse_str(&audio_chat_id).expect("Invalid audio chat UUID");

    let assistant_completed = events.iter().any(|event| {
        serde_json::from_str::<Value>(&event.data)
            .ok()
            .is_some_and(|json| json["message_type"] == "assistant_message_completed")
    });
    assert!(
        assistant_completed,
        "Expected assistant_message_completed when the audio-only first turn is accepted"
    );

    // The new chat row exists. We deliberately do not assert on `title_by_summary` here
    // because the mock LLM in `setup_mock_llm_server` only serves streaming responses and
    // the summary path uses `exec_chat` (non-streaming JSON), so the background summary
    // task fails in every test — independently of the audio fix.
    let _audio_chat = chats::Entity::find_by_id(audio_chat_uuid)
        .one(&db)
        .await
        .expect("Failed to fetch audio chat")
        .expect("Audio chat row not found");
}

/// Malformed base64 in `virtual_files` returns 400 — the request should not
/// be silently dropped or re-tried.
///
/// # Test Categories
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_token_usage_estimate_virtual_file_invalid_base64(pool: Pool<Postgres>) {
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    let request = json!({
        "new_chat": {},
        "new_message_content": "Summarize this.",
        "virtual_files": [{
            "filename": "bad.txt",
            "content_type": "text/plain",
            "base64": "!!!not-base64!!!",
        }],
    });

    let response = server
        .post("/api/v1beta/token_usage/estimate")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&request)
        .await;

    response.assert_status(http::StatusCode::BAD_REQUEST);
}

/// Persisted and virtual files coexist in `file_details` and both contribute
/// to the token total. Mixed-source breakdown is the add-in scenario where
/// the user previews one email and drag-drops another.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_token_usage_estimate_mixes_virtual_and_persisted(pool: Pool<Postgres>) {
    use base64::{Engine as _, engine::general_purpose};

    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Upload one persisted file (no chat — standalone).
    let persisted_bytes = b"Persisted file content used for token estimation.".to_vec();
    let multipart_form = axum_test::multipart::MultipartForm::new().add_part(
        "file",
        axum_test::multipart::Part::bytes(persisted_bytes)
            .file_name("persisted.txt")
            .mime_type("text/plain"),
    );
    let upload_response = server
        .post("/api/v1beta/me/files")
        .with_bearer_token(TEST_JWT_TOKEN)
        .multipart(multipart_form)
        .await;
    upload_response.assert_status_ok();
    let persisted_file_id = upload_response.json::<Value>()["files"][0]["id"]
        .as_str()
        .expect("Expected persisted file id")
        .to_string();

    let virtual_bytes = b"Virtual preview body used in the same request.".to_vec();
    let request = json!({
        "new_chat": {},
        "new_message_content": "Summarize.",
        "input_files_ids": [persisted_file_id],
        "virtual_files": [{
            "filename": "virtual.txt",
            "content_type": "text/plain",
            "base64": general_purpose::STANDARD.encode(&virtual_bytes),
        }],
    });

    let response = server
        .post("/api/v1beta/token_usage/estimate")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&request)
        .await;
    response.assert_status_ok();

    let token_usage: Value = response.json();
    let file_details = token_usage["file_details"]
        .as_array()
        .expect("Expected file_details");
    assert_eq!(
        file_details.len(),
        2,
        "Expected both persisted and virtual entries in file_details"
    );
    let filenames: Vec<&str> = file_details
        .iter()
        .map(|item| item.get("filename").and_then(Value::as_str).unwrap_or(""))
        .collect();
    assert!(
        filenames.contains(&"persisted.txt"),
        "Expected persisted file in file_details"
    );
    assert!(
        filenames.contains(&"virtual.txt"),
        "Expected virtual file in file_details"
    );

    let summed: u64 = file_details
        .iter()
        .map(|item| item["token_count"].as_u64().unwrap_or(0))
        .sum();
    assert_eq!(
        token_usage["stats"]["file_tokens"].as_u64().unwrap(),
        summed,
        "Stats.file_tokens should equal the sum across both sources"
    );
}

/// Test message submission with invalid previous_message_id (non-existent UUID).
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
///
/// # Test Behavior
/// Verifies that submitting a message with a non-existent previous_message_id
/// returns a 500 error (internal server error from SSE stream).
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_message_submit_with_nonexistent_previous_message_id(pool: Pool<Postgres>) {
    // Set up mock LLM server
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;
    let issuer = TEST_USER_ISSUER;
    let subject = TEST_USER_SUBJECT;
    let _user = get_or_create_user(&app_state.db, issuer, subject, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Use a random UUID that doesn't exist
    let non_existent_id = "00000000-0000-0000-0000-000000000001";

    let request_body = json!({
        "previous_message_id": non_existent_id,
        "user_message": "This should fail"
    });

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&request_body)
        .await;

    // The response should now return 400 Bad Request due to validation
    response.assert_status(axum::http::StatusCode::BAD_REQUEST);

    // Check that the error message is about non-existent message
    let error_text = response.text();
    assert!(
        error_text.contains("not found") || error_text.contains("Failed to get previous message"),
        "Expected error message about non-existent previous message, got: {}",
        error_text
    );
}

/// Test message submission with previous_message_id of wrong role (user after user).
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
///
/// # Test Behavior
/// Verifies that submitting a user message with a previous_message_id pointing to
/// another user message (instead of an assistant message) returns an error.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_message_submit_with_wrong_role_previous_message(pool: Pool<Postgres>) {
    // Set up mock LLM server
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;
    let issuer = TEST_USER_ISSUER;
    let subject = TEST_USER_SUBJECT;
    let _user = get_or_create_user(&app_state.db, issuer, subject, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // First, submit a message to create a chat with a user message
    let first_request = json!({
        "user_message": "First message"
    });

    let first_response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&first_request)
        .await;

    first_response.assert_status_ok();

    // Extract the user message ID from the response
    let body = first_response.as_bytes();
    let body_str = String::from_utf8_lossy(body);
    let events: Vec<String> = body_str
        .split("\n\n")
        .filter(|chunk| chunk.contains("data:"))
        .map(|chunk| chunk.to_string())
        .collect();

    let user_message_id = events
        .iter()
        .find_map(|event| {
            let data = event.split("data:").nth(1).unwrap_or("").trim();
            if let Ok(json) = serde_json::from_str::<Value>(data)
                && json["message_type"] == "user_message_saved"
            {
                return json["message_id"].as_str().map(|s| s.to_string());
            }
            None
        })
        .expect("Expected to find user_message_saved event");

    // Now try to submit a second user message with the first user message as previous
    let second_request = json!({
        "previous_message_id": user_message_id,
        "user_message": "This should fail - user after user"
    });

    let second_response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&second_request)
        .await;

    // The response should now return 400 Bad Request due to validation
    second_response.assert_status(axum::http::StatusCode::BAD_REQUEST);

    // Check that the error message is about wrong role
    let error_text = second_response.text();
    assert!(
        error_text.contains("assistant") || error_text.contains("role"),
        "Expected error message about wrong role, got: {}",
        error_text
    );
}

/// Test resume streaming endpoint basic behavior.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
///
/// # Test Behavior
/// Verifies that the resume endpoint exists and returns appropriate errors
/// when no active task is found.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_resume_stream_endpoint_basic(pool: Pool<Postgres>) {
    // Set up mock LLM server
    let (app_config, _server) = setup_mock_llm_server(None).await;

    // Create app state with the database connection
    let app_state = test_app_state(app_config, pool).await;

    // Create a test user
    let issuer = TEST_USER_ISSUER;
    let subject = TEST_USER_SUBJECT;
    let _user = get_or_create_user(&app_state.db, issuer, subject, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);

    // Create the test server with our router
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Generate a random chat ID
    let chat_id = sea_orm::prelude::Uuid::new_v4();

    // Prepare the request body
    let request_body = json!({
        "chat_id": chat_id.to_string()
    });

    // Make a request to the resume endpoint with a non-existent chat
    let response = server
        .post("/api/v1beta/me/messages/resumestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&request_body)
        .await;

    // Should return 403 Forbidden when trying to access a non-existent chat
    // (authorization check happens before task lookup)
    response.assert_status(axum::http::StatusCode::FORBIDDEN);

    let error_text = response.text();
    assert!(
        error_text.contains("Access denied") || error_text.contains("not found"),
        "Expected error about access denied, got: {}",
        error_text
    );
}

/// Test resume streaming returns 404 for existing chat with no active task.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
///
/// # Test Behavior
/// Verifies that when calling resume on a chat that exists (user has access)
/// but has no active background task, the endpoint returns 404 Not Found.
/// This tests the scenario where generation has completed and the task
/// has been cleaned up.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_resume_stream_no_active_task(pool: Pool<Postgres>) {
    use std::time::Duration;

    // Set up mock LLM server with fast response (minimal delay)
    let (app_config, _server) = setup_mock_llm_server(None).await;

    // Create app state with the database connection
    let app_state = test_app_state(app_config, pool).await;

    // Create a test user
    let issuer = TEST_USER_ISSUER;
    let subject = TEST_USER_SUBJECT;
    let _user = get_or_create_user(&app_state.db, issuer, subject, None)
        .await
        .expect("Failed to create user");

    // Start a real server so we can make concurrent requests
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server_addr = listener.local_addr().unwrap();

    let app: axum::Router = erato::server::router::router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state.clone());

    // Spawn the server
    let server_handle = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    // Give the server a moment to start
    tokio::time::sleep(Duration::from_millis(100)).await;

    let client = reqwest::Client::new();
    let base_url = format!("http://{}", server_addr);

    // First, create a chat by submitting a message
    // We need to get the chat_id before the task is cleaned up
    let submit_response = client
        .post(format!("{}/api/v1beta/me/messages/submitstream", base_url))
        .header("Authorization", format!("Bearer {}", TEST_JWT_TOKEN))
        .header("Content-Type", "application/json")
        .json(&json!({
            "user_message": "Hello, create a chat for testing"
        }))
        .send()
        .await
        .expect("Failed to send submit request");

    assert!(
        submit_response.status().is_success(),
        "Submit request should succeed"
    );

    // Read the response to get the chat_id
    let body = submit_response
        .text()
        .await
        .expect("Failed to read response");

    // Extract chat_id from the chat_created event
    let chat_id = body
        .split("\n\n")
        .filter(|chunk| chunk.contains("data:"))
        .find_map(|event| {
            let data = event.split("data:").nth(1).unwrap_or("").trim();
            if let Ok(json) = serde_json::from_str::<Value>(data)
                && json["message_type"] == "chat_created"
            {
                return json["chat_id"].as_str().map(|s| s.to_string());
            }
            None
        })
        .expect("Expected to find chat_created event with chat_id");

    println!("Created chat with ID: {}", chat_id);

    // Now manually remove the task from the manager to simulate cleanup
    // (normally this happens after 60 seconds, but we force it for testing)
    let chat_uuid: sea_orm::prelude::Uuid = chat_id.parse().expect("Invalid UUID");
    if let Some(task) = app_state.background_tasks.get_task(&chat_uuid).await {
        app_state
            .background_tasks
            .remove_task(
                &chat_uuid,
                task.generation_id,
                erato::services::background_tasks::TaskOutcome::Completed,
            )
            .await;
    }

    // Verify the task is no longer in the manager
    let task = app_state.background_tasks.get_task(&chat_uuid).await;
    assert!(task.is_none(), "Task should have been removed from manager");

    // Now try to resume - should get 404 because task no longer exists
    let resume_response = client
        .post(format!("{}/api/v1beta/me/messages/resumestream", base_url))
        .header("Authorization", format!("Bearer {}", TEST_JWT_TOKEN))
        .header("Content-Type", "application/json")
        .json(&json!({
            "chat_id": chat_id
        }))
        .send()
        .await
        .expect("Failed to send resume request");

    // Should return 404 Not Found
    assert_eq!(
        resume_response.status(),
        reqwest::StatusCode::NOT_FOUND,
        "Expected 404 for existing chat with no active task"
    );

    let error_text = resume_response.text().await.unwrap_or_default();
    assert!(
        error_text.contains("No active generation task") || error_text.contains("not found"),
        "Expected error about no active task, got: {}",
        error_text
    );

    println!("✅ Correctly returned 404 for existing chat with no active task");

    // Clean up - abort the server
    server_handle.abort();
}

/// Test resume streaming with full event replay and continuation.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
///
/// # Test Behavior
/// As specified in ERMAIN-46:
/// 1. Sets up a mocked LLM that streams numbered messages ("Message 01", "Message 02", etc.)
/// 2. Starts a generation request
/// 3. Calls resume endpoint while generation is ongoing
/// 4. Verifies that resume endpoint replays all historical events and continues streaming
///
/// This tests the key requirement that a brittle client can disconnect and resume
/// multiple times during a long-running generation.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_resume_stream_full_replay(pool: Pool<Postgres>) {
    use crate::test_utils::MockLlmConfig;
    use std::time::Duration;

    // Create numbered messages for the mock LLM
    // Use 20 messages with 200ms delays = ~4 seconds total
    // This gives us time to call resume while generation is still running
    let chunks: Vec<String> = (1..=20).map(|i| format!("Message {:02}", i)).collect();
    let expected_chunks = chunks.clone();

    let mock_config = MockLlmConfig {
        chunks,
        delay_ms: 200, // 200ms between chunks for ~4 seconds total
        provider_id: "mock-llm".to_string(),
        model_name: "gpt-3.5-turbo".to_string(),
        ..Default::default()
    };

    // Set up mock LLM server with numbered messages
    let (app_config, _server) = setup_mock_llm_server(Some(mock_config)).await;

    // Create app state with the database connection
    let app_state = test_app_state(app_config, pool).await;

    // Create a test user
    let issuer = TEST_USER_ISSUER;
    let subject = TEST_USER_SUBJECT;
    let _user = get_or_create_user(&app_state.db, issuer, subject, None)
        .await
        .expect("Failed to create user");

    // We need to make concurrent requests. Since axum_test waits for full response,
    // we'll use a real TCP server with reqwest for more control.

    // Start the actual server
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server_addr = listener.local_addr().unwrap();

    let app: axum::Router = erato::server::router::router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state.clone());

    // Spawn the server
    let server_handle = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    // Give the server a moment to start
    tokio::time::sleep(Duration::from_millis(100)).await;

    let client = reqwest::Client::new();
    let base_url = format!("http://{}", server_addr);

    // Start the first message submission request in a separate task
    let client_clone = client.clone();
    let base_url_clone = base_url.clone();
    let first_request_handle = tokio::spawn(async move {
        let response = client_clone
            .post(format!(
                "{}/api/v1beta/me/messages/submitstream",
                base_url_clone
            ))
            .header("Authorization", format!("Bearer {}", TEST_JWT_TOKEN))
            .header("Content-Type", "application/json")
            .json(&json!({
                "user_message": "Generate numbered messages"
            }))
            .send()
            .await
            .expect("Failed to send first request");

        assert!(
            response.status().is_success(),
            "First request should succeed"
        );

        // Read the full response body
        response.text().await.expect("Failed to read response body")
    });

    // Wait a bit for the first request to start and generate some events
    // (wait for about half the generation time so we catch it mid-stream)
    tokio::time::sleep(Duration::from_secs(2)).await;

    // Extract chat_id from background tasks directly
    // Since we can't easily parse the streaming response mid-flight,
    // we'll get the chat_id from the manager
    let chat_id = {
        let tasks = app_state.background_tasks.tasks.read().await;
        tasks.keys().next().copied()
    };

    let chat_id = chat_id.expect("Expected to find an active background task");
    println!("Found active task for chat_id: {}", chat_id);

    // Now call the resume endpoint while the first request is still running
    let resume_response = client
        .post(format!("{}/api/v1beta/me/messages/resumestream", base_url))
        .header("Authorization", format!("Bearer {}", TEST_JWT_TOKEN))
        .header("Content-Type", "application/json")
        .json(&json!({
            "chat_id": chat_id.to_string()
        }))
        .send()
        .await
        .expect("Failed to send resume request");

    assert!(
        resume_response.status().is_success(),
        "Resume request should succeed, got: {} - {}",
        resume_response.status(),
        resume_response.text().await.unwrap_or_default()
    );

    // Read the resume response body (this will wait for the stream to complete)
    let resume_body = resume_response
        .text()
        .await
        .expect("Failed to read resume response body");

    // Parse events from resume response
    let resume_events: Vec<String> = resume_body
        .split("\n\n")
        .filter(|chunk| chunk.contains("data:"))
        .map(|chunk| chunk.to_string())
        .collect();

    println!("Resume request received {} events", resume_events.len());

    // Wait for the first request to complete
    let first_body = first_request_handle
        .await
        .expect("First request task panicked");

    // Parse events from the first request
    let first_events: Vec<String> = first_body
        .split("\n\n")
        .filter(|chunk| chunk.contains("data:"))
        .map(|chunk| chunk.to_string())
        .collect();

    println!("First request received {} events", first_events.len());

    // Helper to extract text deltas from events
    let extract_text_deltas = |events: &[String]| -> Vec<String> {
        events
            .iter()
            .filter_map(|event| {
                let data = event.split("data:").nth(1).unwrap_or("").trim();
                if let Ok(json) = serde_json::from_str::<Value>(data)
                    && json["message_type"] == "text_delta"
                {
                    return json["new_text"].as_str().map(|s| s.to_string());
                }
                None
            })
            .collect()
    };

    // Helper to check for event type
    let has_event_type = |events: &[String], event_type: &str| -> bool {
        events.iter().any(|event| {
            let data = event.split("data:").nth(1).unwrap_or("").trim();
            if let Ok(json) = serde_json::from_str::<Value>(data) {
                json["message_type"] == event_type
            } else {
                false
            }
        })
    };

    // Extract text deltas from both responses
    let first_text_deltas = extract_text_deltas(&first_events);
    let resume_text_deltas = extract_text_deltas(&resume_events);

    println!("First request text deltas: {:?}", first_text_deltas);
    println!("Resume request text deltas: {:?}", resume_text_deltas);

    // Build full text from deltas
    let first_full_text: String = first_text_deltas.iter().cloned().collect();
    let resume_full_text: String = resume_text_deltas.iter().cloned().collect();

    println!("First full text: {}", first_full_text);
    println!("Resume full text: {}", resume_full_text);

    // Verify first request received all chunks
    for chunk in &expected_chunks {
        assert!(
            first_full_text.contains(chunk),
            "First request should contain '{}', got: {}",
            chunk,
            first_full_text
        );
    }

    // KEY TEST: Resume request should have ALL historical events
    // This means the resume response should contain AT LEAST as many events
    // as were generated before we called resume (which was after ~2 seconds)
    // Plus any events that came after

    // The resume response should have replayed all historical events
    // Since we called resume mid-stream, it should have:
    // 1. All events from history (before resume was called)
    // 2. All events after resume was called (live streaming)

    // Verify resume response has all the expected event types
    assert!(
        has_event_type(&resume_events, "chat_created"),
        "Resume missing chat_created event"
    );
    assert!(
        has_event_type(&resume_events, "user_message_saved"),
        "Resume missing user_message_saved event"
    );
    assert!(
        has_event_type(&resume_events, "assistant_message_started"),
        "Resume missing assistant_message_started event"
    );
    assert!(
        has_event_type(&resume_events, "text_delta"),
        "Resume missing text_delta events"
    );

    // The resume response should have received ALL chunks
    // This is the key test - replay + continuation should give complete results
    for chunk in &expected_chunks {
        assert!(
            resume_full_text.contains(chunk),
            "Resume request should contain '{}', got: {}",
            chunk,
            resume_full_text
        );
    }

    // Verify both responses have the same chat_id
    let extract_chat_id = |events: &[String]| -> Option<String> {
        events.iter().find_map(|event| {
            let data = event.split("data:").nth(1).unwrap_or("").trim();
            if let Ok(json) = serde_json::from_str::<Value>(data)
                && json["message_type"] == "chat_created"
            {
                return json["chat_id"].as_str().map(|s| s.to_string());
            }
            None
        })
    };

    let first_chat_id = extract_chat_id(&first_events);
    let resume_chat_id = extract_chat_id(&resume_events);

    assert_eq!(
        first_chat_id, resume_chat_id,
        "Chat IDs should match between first and resume requests"
    );

    println!("✅ Resume streaming test passed!");
    println!(
        "   - First request received all {} messages",
        expected_chunks.len()
    );
    println!(
        "   - Resume request replayed + continued to receive all {} messages",
        expected_chunks.len()
    );
    println!("   - All event types verified in both responses");

    // Clean up - abort the server
    server_handle.abort();
}

/// Test that a mid-generation `GET /chats/{id}/messages` returns the user
/// message of the in-flight turn.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `uses-mocked-llm`
///
/// # Test Behavior
/// 1. Starts a slow generation and lets it run for a couple of seconds
/// 2. Fetches the chat history while that generation is still streaming
/// 3. Verifies the user message is already listed
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_get_chat_messages_returns_in_flight_user_message(pool: Pool<Postgres>) {
    use crate::test_utils::MockLlmConfig;
    use std::time::Duration;

    const USER_MESSAGE: &str = "In-flight history probe";

    // ~4 seconds of generation, so the fetch below lands mid-stream.
    let mock_config = MockLlmConfig {
        chunks: (1..=20).map(|i| format!("Message {:02}", i)).collect(),
        delay_ms: 200,
        provider_id: "mock-llm".to_string(),
        model_name: "gpt-3.5-turbo".to_string(),
        ..Default::default()
    };

    let (app_config, _server) = setup_mock_llm_server(Some(mock_config)).await;
    let app_state = test_app_state(app_config, pool).await;

    let _user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");

    // A real TCP server: axum_test waits for the full response, leaving no
    // window to fetch in.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server_addr = listener.local_addr().unwrap();
    let app: axum::Router = erato::server::router::router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state.clone());
    let server_handle = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    tokio::time::sleep(Duration::from_millis(100)).await;

    let client = reqwest::Client::new();
    let base_url = format!("http://{}", server_addr);

    let client_clone = client.clone();
    let base_url_clone = base_url.clone();
    let submit_handle = tokio::spawn(async move {
        client_clone
            .post(format!(
                "{}/api/v1beta/me/messages/submitstream",
                base_url_clone
            ))
            .header("Authorization", format!("Bearer {}", TEST_JWT_TOKEN))
            .header("Content-Type", "application/json")
            .json(&json!({ "user_message": USER_MESSAGE }))
            .send()
            .await
            .expect("Failed to send submitstream request")
            .text()
            .await
            .expect("Failed to read submitstream body")
    });

    tokio::time::sleep(Duration::from_secs(2)).await;

    let chat_id = {
        let tasks = app_state.background_tasks.tasks.read().await;
        tasks.keys().next().copied()
    }
    .expect("Expected to find an active background task");

    let messages_response = client
        .get(format!(
            "{}/api/v1beta/chats/{}/messages",
            base_url, chat_id
        ))
        .header("Authorization", format!("Bearer {}", TEST_JWT_TOKEN))
        .send()
        .await
        .expect("Failed to fetch chat messages");

    assert_eq!(
        messages_response.status(),
        reqwest::StatusCode::OK,
        "Mid-generation message fetch should succeed"
    );

    let body: Value = messages_response
        .json()
        .await
        .expect("Failed to parse chat messages response");

    let user_message = body["messages"]
        .as_array()
        .expect("Expected a messages array")
        .iter()
        .find(|message| message["role"] == "user")
        .expect("Expected the in-flight user message to be listed");

    assert_eq!(
        user_message["content"][0]["text"], USER_MESSAGE,
        "Listed user message should carry the submitted text"
    );

    submit_handle.abort();
    server_handle.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_abort_stream_persists_partial_message(pool: Pool<Postgres>) {
    use crate::test_utils::MockLlmConfig;
    use std::time::Duration;

    let chunks: Vec<String> = (1..=12).map(|i| format!("Chunk {:02}", i)).collect();
    let mock_config = MockLlmConfig {
        chunks: chunks.clone(),
        delay_ms: 200,
        provider_id: "mock-llm".to_string(),
        model_name: "gpt-3.5-turbo".to_string(),
        ..Default::default()
    };

    let (app_config, _server) = setup_mock_llm_server(Some(mock_config)).await;
    let app_state = test_app_state(app_config, pool).await;

    let _user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server_addr = listener.local_addr().unwrap();
    let app: axum::Router = erato::server::router::router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state.clone());
    let server_handle = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    tokio::time::sleep(Duration::from_millis(100)).await;

    let client = reqwest::Client::new();
    let base_url = format!("http://{}", server_addr);

    let client_clone = client.clone();
    let base_url_clone = base_url.clone();
    let submit_handle = tokio::spawn(async move {
        let response = client_clone
            .post(format!(
                "{}/api/v1beta/me/messages/submitstream",
                base_url_clone
            ))
            .header("Authorization", format!("Bearer {}", TEST_JWT_TOKEN))
            .header("Content-Type", "application/json")
            .json(&json!({
                "user_message": "Abort this long generation"
            }))
            .send()
            .await
            .expect("Failed to send submitstream request");

        assert!(response.status().is_success());
        response
            .text()
            .await
            .expect("Failed to read submit response")
    });

    tokio::time::sleep(Duration::from_millis(900)).await;

    let chat_id = {
        let tasks = app_state.background_tasks.tasks.read().await;
        tasks.keys().next().copied()
    }
    .expect("Expected active background task");

    let abort_response = client
        .post(format!("{}/api/v1beta/me/messages/abortstream", base_url))
        .header("Authorization", format!("Bearer {}", TEST_JWT_TOKEN))
        .header("Content-Type", "application/json")
        .json(&json!({
            "chat_id": chat_id.to_string()
        }))
        .send()
        .await
        .expect("Failed to send abortstream request");

    assert!(
        abort_response.status().is_success(),
        "Abort request failed: {}",
        abort_response.text().await.unwrap_or_default()
    );

    let submit_body = submit_handle.await.expect("submit task panicked");
    let submit_events: Vec<String> = submit_body
        .split("\n\n")
        .filter(|chunk| chunk.contains("data:"))
        .map(|chunk| chunk.to_string())
        .collect();

    let assistant_completed = submit_events.iter().find_map(|event| {
        let data = event.split("data:").nth(1).unwrap_or("").trim();
        if let Ok(json) = serde_json::from_str::<Value>(data)
            && json["message_type"] == "assistant_message_completed"
        {
            return Some(json);
        }
        None
    });

    let assistant_completed =
        assistant_completed.expect("Expected assistant_message_completed after abort");
    let completed_text = assistant_completed["content"]
        .as_array()
        .and_then(|parts| parts.first())
        .and_then(|part| part["text"].as_str())
        .unwrap_or_default()
        .to_string();

    assert!(
        completed_text.contains("Chunk 01") || completed_text.is_empty(),
        "Expected persisted partial content or empty content, got: {}",
        completed_text
    );
    assert!(
        !completed_text.contains("Chunk 12"),
        "Aborted generation should not contain the full response"
    );

    let assistant_message_id = Uuid::parse_str(
        assistant_completed["message_id"]
            .as_str()
            .expect("assistant_message_completed should contain message_id"),
    )
    .expect("message_id should be a uuid");

    let saved_message = erato::db::entity::messages::Entity::find_by_id(assistant_message_id)
        .one(&app_state.db)
        .await
        .expect("Failed to load saved message")
        .expect("Expected saved assistant message");

    let generation_metadata = saved_message
        .generation_metadata
        .expect("Expected generation metadata on aborted message");
    assert_eq!(generation_metadata["was_aborted"], json!(true));

    let saved_raw_message = saved_message.raw_message;
    let saved_content = saved_raw_message["content"]
        .as_array()
        .expect("Saved assistant content should be an array");
    assert_eq!(saved_content.len(), 1);
    assert_eq!(saved_content[0]["content_type"], json!("text"));

    server_handle.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_message_submit_tolerates_unavailable_mcp_server_and_records_metadata(
    pool: Pool<Postgres>,
) {
    let mock_mcp_base_url = mock_mcp_base_url();
    let (mut app_config, _server) = setup_mock_llm_server(None).await;

    let chat_providers = app_config
        .chat_providers
        .as_mut()
        .expect("Expected chat providers in test config");
    let primary_provider_id = chat_providers
        .priority_order
        .first()
        .cloned()
        .expect("Expected at least one chat provider");
    let secondary_provider = chat_providers
        .providers
        .get(&primary_provider_id)
        .cloned()
        .expect("Expected primary chat provider config");
    chat_providers
        .providers
        .insert("secondary".to_string(), secondary_provider);
    chat_providers.priority_order.push("secondary".to_string());

    app_config.mcp_servers.insert(
        "healthy-file".to_string(),
        mcp_server_config(
            &mock_mcp_base_url,
            "/mcp/file",
            McpServerAuthenticationConfig::None,
        ),
    );
    app_config.mcp_servers.insert(
        "failing-500".to_string(),
        mcp_server_config(
            &mock_mcp_base_url,
            "/mcp/list-tools-500",
            McpServerAuthenticationConfig::None,
        ),
    );
    app_config.model_permissions.rules.insert(
        "allow-secondary".to_string(),
        erato::config::ModelPermissionRule::AllowAll {
            chat_provider_ids: vec!["secondary".to_string()],
        },
    );
    app_config.mcp_server_permissions.rules.insert(
        "allow-mcp-servers".to_string(),
        erato::config::McpServerPermissionRule::AllowAll {
            mcp_server_ids: vec!["healthy-file".to_string(), "failing-500".to_string()],
        },
    );

    let test_token = JwtTokenBuilder::new()
        .subject("many-models-user")
        .email("many-models@example.com")
        .name("many-models-user")
        .build();

    let app_state = test_app_state(app_config, pool).await;
    let _user = get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        "many-models-user",
        Some("many-models@example.com"),
    )
    .await
    .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state.clone());
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(&test_token)
        .json(&json!({
            "user_message": "Hello resilient MCP world",
            "chat_provider_id": "secondary"
        }))
        .await;
    response.assert_status_ok();

    let events = parse_sse_events(&response);
    let assistant_completed = events
        .iter()
        .find_map(|event| {
            let json: Value = serde_json::from_str(&event.data).ok()?;
            (json["message_type"] == "assistant_message_completed").then_some(json)
        })
        .expect("Expected assistant_message_completed event");

    assert_eq!(
        assistant_completed["message"]["mcp_servers_unavailable"],
        json!(["failing-500"])
    );

    let assistant_message_id = Uuid::parse_str(
        assistant_completed["message_id"]
            .as_str()
            .expect("assistant_message_completed should contain message_id"),
    )
    .expect("assistant message id should be a uuid");

    let saved_message = erato::db::entity::messages::Entity::find_by_id(assistant_message_id)
        .one(&app_state.db)
        .await
        .expect("Failed to load saved message")
        .expect("Expected saved assistant message");

    let generation_metadata = saved_message
        .generation_metadata
        .expect("Expected generation metadata on assistant message");
    assert_eq!(
        generation_metadata["mcp_servers_unavailable"],
        json!(["failing-500"])
    );

    let chat_messages_response = server
        .get(&format!(
            "/api/v1beta/chats/{}/messages",
            saved_message.chat_id
        ))
        .with_bearer_token(&test_token)
        .await;
    chat_messages_response.assert_status_ok();

    let body: Value = chat_messages_response.json();
    let fetched_assistant_message = body["messages"]
        .as_array()
        .and_then(|messages| {
            messages
                .iter()
                .find(|message| message["id"] == assistant_message_id.to_string())
        })
        .expect("Expected assistant message in chat messages response");
    assert_eq!(
        fetched_assistant_message["mcp_servers_unavailable"],
        json!(["failing-500"])
    );
}

/// An OAuth2 MCP server the requesting user has not connected yet is skipped
/// without failing generation, and the skip is recorded under
/// `mcp_servers_needing_auth` — never under `mcp_servers_unavailable`, which
/// stays reserved for genuinely broken servers. A healthy server appears in
/// neither list.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_message_submit_records_mcp_server_needing_oauth_authorization(pool: Pool<Postgres>) {
    let mock_mcp_base_url = mock_mcp_base_url();
    let (mut app_config, _llm_server) = setup_mock_llm_server(None).await;

    // The OAuth mock only serves authorization-server metadata. That is all
    // the "configured but not connected" state needs: token resolution finds
    // the metadata, then fails with AuthorizationRequired because no
    // credentials are stored for the user — before any MCP request is made.
    let mockserver_config = MockServerConfig {
        listen_addr: IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)),
        ..Default::default()
    };
    let oauth_server = MockServer::new_http("mcp-oauth-mock").with_config(mockserver_config);
    oauth_server
        .start()
        .await
        .expect("Failed to start OAuth metadata mock server");
    let oauth_server_base_url = oauth_server.url("").to_string();
    let oauth_server_base_url = oauth_server_base_url.trim_end_matches('/');
    oauth_server.mocks().mock(|when, then| {
        when.get()
            .path("/.well-known/oauth-authorization-server/oauth");
        then.status(http::StatusCode::OK)
            .headers([("Content-Type", "application/json")])
            .json(json!({
                "issuer": format!("{oauth_server_base_url}/oauth"),
                "authorization_endpoint": "http://127.0.0.1:1/authorize",
                "token_endpoint": "http://127.0.0.1:1/token",
            }));
    });

    app_config.mcp_servers.insert(
        "healthy-file".to_string(),
        mcp_server_config(
            &mock_mcp_base_url,
            "/mcp/file",
            McpServerAuthenticationConfig::None,
        ),
    );
    app_config.mcp_servers.insert(
        "failing-500".to_string(),
        mcp_server_config(
            &mock_mcp_base_url,
            "/mcp/list-tools-500",
            McpServerAuthenticationConfig::None,
        ),
    );
    app_config.mcp_servers.insert(
        "oauth-pending".to_string(),
        mcp_server_config(
            oauth_server_base_url,
            "/oauth",
            McpServerAuthenticationConfig::Oauth2 {
                oauth2: McpServerOauth2AuthenticationConfig {
                    resource: None,
                    client_id: Some("test-oauth-client".to_string()),
                    client_secret: None,
                    scopes: vec![],
                    client_name: None,
                },
            },
        ),
    );
    app_config.mcp_server_permissions.rules.insert(
        "allow-mcp-servers".to_string(),
        erato::config::McpServerPermissionRule::AllowAll {
            mcp_server_ids: vec![
                "healthy-file".to_string(),
                "failing-500".to_string(),
                "oauth-pending".to_string(),
            ],
        },
    );

    let test_token = JwtTokenBuilder::new()
        .subject("oauth-pending-user")
        .email("oauth-pending@example.com")
        .name("oauth-pending-user")
        .build();

    let app_state = test_app_state(app_config, pool).await;
    let _user = get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        "oauth-pending-user",
        Some("oauth-pending@example.com"),
    )
    .await
    .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state.clone());
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(&test_token)
        .json(&json!({
            "user_message": "Hello, some of my servers are not connected yet"
        }))
        .await;
    response.assert_status_ok();

    let events = parse_sse_events(&response);
    let assistant_completed = events
        .iter()
        .find_map(|event| {
            let json: Value = serde_json::from_str(&event.data).ok()?;
            (json["message_type"] == "assistant_message_completed").then_some(json)
        })
        .expect("Expected assistant_message_completed event");

    assert_eq!(
        assistant_completed["message"]["mcp_servers_needing_auth"],
        json!(["oauth-pending"])
    );
    assert_eq!(
        assistant_completed["message"]["mcp_servers_unavailable"],
        json!(["failing-500"])
    );

    let assistant_message_id = Uuid::parse_str(
        assistant_completed["message_id"]
            .as_str()
            .expect("assistant_message_completed should contain message_id"),
    )
    .expect("assistant message id should be a uuid");

    let saved_message = erato::db::entity::messages::Entity::find_by_id(assistant_message_id)
        .one(&app_state.db)
        .await
        .expect("Failed to load saved message")
        .expect("Expected saved assistant message");

    let generation_metadata = saved_message
        .generation_metadata
        .expect("Expected generation metadata on assistant message");
    assert_eq!(
        generation_metadata["mcp_servers_needing_auth"],
        json!(["oauth-pending"])
    );
    assert_eq!(
        generation_metadata["mcp_servers_unavailable"],
        json!(["failing-500"])
    );

    let chat_messages_response = server
        .get(&format!(
            "/api/v1beta/chats/{}/messages",
            saved_message.chat_id
        ))
        .with_bearer_token(&test_token)
        .await;
    chat_messages_response.assert_status_ok();

    let body: Value = chat_messages_response.json();
    let fetched_assistant_message = body["messages"]
        .as_array()
        .and_then(|messages| {
            messages
                .iter()
                .find(|message| message["id"] == assistant_message_id.to_string())
        })
        .expect("Expected assistant message in chat messages response");
    assert_eq!(
        fetched_assistant_message["mcp_servers_needing_auth"],
        json!(["oauth-pending"])
    );
    assert_eq!(
        fetched_assistant_message["mcp_servers_unavailable"],
        json!(["failing-500"])
    );
}

// --- Action-Facet tests ---

/// Helper to set up an app with action facets configured.
fn add_action_facets(app_config: &mut erato::config::AppConfig) {
    app_config.action_facets.facets.insert(
        "rewrite".to_string(),
        ActionFacetConfig {
            display_name: "Rewrite".to_string(),
            platform: None,
            template: "Rewrite the following in a {{tone}} tone:\n\n{{content}}".to_string(),
            allowed_args: vec!["tone".to_string(), "content".to_string()],
            client_actions: vec![],
            presentation: None,
            client_actions_always_ask: vec![],
            tool_call_allowlist: vec![],
        },
    );
    app_config.action_facets.facets.insert(
        "reply".to_string(),
        ActionFacetConfig {
            display_name: "Reply".to_string(),
            platform: None,
            template: "FOR THIS MESSAGE ONLY: Draft a reply ({{body_format}}) and propose \
                       how to send it."
                .to_string(),
            allowed_args: vec!["body_format".to_string()],
            client_actions: vec!["outlook.reply".to_string(), "outlook.reply_all".to_string()],
            presentation: None,
            client_actions_always_ask: vec![],
            tool_call_allowlist: vec![],
        },
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_action_facet_unknown_id_returns_400(pool: Pool<Postgres>) {
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;

    let _user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "user_message": "Hello",
            "action_facet": { "id": "nonexistent_facet", "args": {} }
        }))
        .await;
    response.assert_status(http::StatusCode::BAD_REQUEST);
    let body = response.text();
    assert!(
        body.contains("Unknown action facet"),
        "Expected 'Unknown action facet' in: {body}"
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_action_facet_persisted_in_generation_parameters(pool: Pool<Postgres>) {
    let (mut app_config, _server) = setup_mock_llm_server(None).await;
    add_action_facets(&mut app_config);
    let app_state = test_app_state(app_config, pool).await;
    let db = app_state.db.clone();

    let _user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "user_message": "Hello",
            "action_facet": {
                "id": "rewrite",
                "args": { "tone": "casual", "content": "Hello world" }
            }
        }))
        .await;
    response.assert_status_ok();

    let assistant_messages = erato::db::entity::messages::Entity::find()
        .filter(erato::db::entity::messages::Column::GenerationParameters.is_not_null())
        .order_by_asc(erato::db::entity::messages::Column::CreatedAt)
        .all(&db)
        .await
        .expect("Failed to fetch messages");

    assert!(
        !assistant_messages.is_empty(),
        "Expected at least one assistant message"
    );

    let params: GenerationParameters = serde_json::from_value(
        assistant_messages[0]
            .generation_parameters
            .clone()
            .expect("Missing generation_parameters"),
    )
    .expect("Failed to deserialize generation parameters");

    assert_eq!(params.action_facet_id.as_deref(), Some("rewrite"));
    let args = params
        .action_facet_args
        .expect("Expected action_facet_args");
    assert_eq!(args.get("tone").map(|s| s.as_str()), Some("casual"));
    assert_eq!(args.get("content").map(|s| s.as_str()), Some("Hello world"));
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_action_facet_rendered_prompt_in_generation_input(pool: Pool<Postgres>) {
    let (mut app_config, _server) = setup_mock_llm_server(None).await;
    add_action_facets(&mut app_config);
    let app_state = test_app_state(app_config, pool).await;
    let db = app_state.db.clone();

    let _user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "user_message": "Rewrite this",
            "action_facet": {
                "id": "rewrite",
                "args": { "tone": "professional", "content": "yo whats up" }
            }
        }))
        .await;
    response.assert_status_ok();

    let assistant_messages = erato::db::entity::messages::Entity::find()
        .filter(erato::db::entity::messages::Column::GenerationInputMessages.is_not_null())
        .order_by_asc(erato::db::entity::messages::Column::CreatedAt)
        .all(&db)
        .await
        .expect("Failed to fetch messages");

    assert!(
        !assistant_messages.is_empty(),
        "Expected at least one message"
    );

    let gen_input_value = assistant_messages[0]
        .generation_input_messages
        .clone()
        .expect("Missing generation_input_messages");

    // Persisted shape: an `ActionFacetMarker` on a User-role message with
    // the facet id + args. Rendering is deferred until request-build time
    // (the resolver wraps it in a `<system-reminder>` sentinel), so the
    // saved row stores source-of-truth metadata, not derived text. The
    // `tone` and `content` args round-trip through the JSON unchanged.
    let marker = gen_input_value["messages"]
        .as_array()
        .expect("Expected messages array")
        .iter()
        .find(|msg| {
            msg["role"].as_str() == Some("user")
                && msg["content"]["content_type"].as_str() == Some("action_facet_marker")
        })
        .expect(
            "Expected ActionFacetMarker as user-role message in saved generation_input_messages",
        );

    assert_eq!(
        marker["content"]["facet_id"].as_str(),
        Some("rewrite"),
        "Expected marker.facet_id to round-trip into saved JSON"
    );
    assert_eq!(
        marker["content"]["args"]["tone"].as_str(),
        Some("professional"),
        "Expected marker.args.tone to round-trip into saved JSON"
    );
    assert_eq!(
        marker["content"]["args"]["content"].as_str(),
        Some("yo whats up"),
        "Expected marker.args.content to round-trip into saved JSON"
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_action_facet_template_literal_values_no_rerendering(pool: Pool<Postgres>) {
    let (mut app_config, _server) = setup_mock_llm_server(None).await;
    add_action_facets(&mut app_config);
    let app_state = test_app_state(app_config, pool).await;
    let db = app_state.db.clone();

    let _user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Send args with {{ in values — should be treated as literals, not re-rendered
    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "user_message": "Test injection",
            "action_facet": {
                "id": "rewrite",
                "args": { "tone": "{{content}}", "content": "actual content" }
            }
        }))
        .await;
    response.assert_status_ok();

    let assistant_messages = erato::db::entity::messages::Entity::find()
        .filter(erato::db::entity::messages::Column::GenerationInputMessages.is_not_null())
        .order_by_asc(erato::db::entity::messages::Column::CreatedAt)
        .all(&db)
        .await
        .expect("Failed to fetch messages");

    let gen_input_value = assistant_messages[0]
        .generation_input_messages
        .clone()
        .expect("Missing generation_input_messages");

    // The marker preserves args verbatim — `{{content}}` in the tone arg
    // round-trips into the saved JSON unchanged. Re-rendering protection
    // (one-pass template substitution; arg values are NOT re-expanded) now
    // lives in the resolver step at request-build time and is covered by
    // the unit tests for `render_placeholder_template`.
    let marker = gen_input_value["messages"]
        .as_array()
        .expect("Expected messages array")
        .iter()
        .find(|msg| {
            msg["role"].as_str() == Some("user")
                && msg["content"]["content_type"].as_str() == Some("action_facet_marker")
        })
        .expect("Expected ActionFacetMarker in saved generation_input_messages");

    assert_eq!(
        marker["content"]["args"]["tone"].as_str(),
        Some("{{content}}"),
        "Marker must preserve `{{content}}` literally in args, no re-rendering"
    );
    assert_eq!(
        marker["content"]["args"]["content"].as_str(),
        Some("actual content")
    );
}

// --- Client-action interception tests ---

const CLIENT_ACTION_TOOL: &str = erato::services::client_actions::CLIENT_ACTION_TOOL_NAME;

/// Distinctive fragments of the model-facing tool responses written by the
/// client-action interception, used to route the mock LLM's turns.
const PROPOSED_RESPONSE_FRAGMENT: &str = "Proposed client action";
const INVALID_RESPONSE_FRAGMENT: &str = "Invalid client action proposal";

/// Submits a message under the `reply` client-action facet and returns the
/// parsed SSE events of the response.
async fn submit_under_reply_facet(server: &TestServer) -> Vec<crate::test_utils::Event> {
    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "user_message": "Reply to this email",
            "action_facet": { "id": "reply", "args": { "body_format": "text" } }
        }))
        .await;
    response.assert_status_ok();
    parse_sse_events(&response)
}

/// Fetches the persisted assistant message's tool_use content parts.
async fn fetch_assistant_tool_use_parts(
    server: &TestServer,
    chat_id: &str,
    assistant_message_id: &str,
) -> Vec<Value> {
    let response = server
        .get(&format!("/api/v1beta/chats/{chat_id}/messages"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    response.assert_status_ok();
    let body: Value = response.json();
    let assistant_message = body["messages"]
        .as_array()
        .and_then(|messages| {
            messages
                .iter()
                .find(|message| message["id"] == assistant_message_id)
        })
        .expect("Expected assistant message in chat messages response")
        .clone();
    assistant_message["content"]
        .as_array()
        .expect("Expected content parts array")
        .iter()
        .filter(|part| part["content_type"] == "tool_use")
        .cloned()
        .collect()
}

fn tool_call_update_events(events: &[crate::test_utils::Event]) -> Vec<Value> {
    events
        .iter()
        .filter_map(|event| serde_json::from_str::<Value>(&event.data).ok())
        .filter(|json| json["message_type"] == "tool_call_update")
        .collect()
}

fn assistant_message_id_from_events(events: &[crate::test_utils::Event]) -> String {
    events
        .iter()
        .find_map(|event| {
            if let Ok(json) = serde_json::from_str::<Value>(&event.data)
                && json["message_type"] == "assistant_message_completed"
            {
                return json["message_id"].as_str().map(|s| s.to_string());
            }
            None
        })
        .expect("Expected assistant_message_completed event with message_id")
}

/// Two `propose_client_action` calls in one parallel batch: the FIRST one
/// wins, the second is answered with the already-proposed error, and the
/// model receives corrective tool responses before finishing the turn.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_client_action_parallel_proposals_first_wins(pool: Pool<Postgres>) {
    let corrective_request_recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    // Turn 1: no tool responses in the request yet → propose both actions in
    // one parallel batch.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[], &[PROPOSED_RESPONSE_FRAGMENT]));
        mock_llm_sse_response(
            then,
            build_openai_tool_calls_streaming_response(&[
                (
                    "call_first",
                    CLIENT_ACTION_TOOL,
                    json!({"action": "outlook.reply"}),
                ),
                (
                    "call_second",
                    CLIENT_ACTION_TOOL,
                    json!({"action": "outlook.reply_all"}),
                ),
            ]),
        );
    });
    // Turn 2: the corrective tool responses arrived → finish with text.
    {
        let recorder = corrective_request_recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&[PROPOSED_RESPONSE_FRAGMENT], &[]))
                .matcher(recorder);
            mock_llm_sse_response(then, build_openai_text_streaming_response(&["Done."]));
        });
    }

    let (mut app_config, _server) = setup_mock_llm_server_with_mocks(mocks).await;
    add_action_facets(&mut app_config);
    let app_state = test_app_state(app_config, pool).await;

    let _user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    let events = submit_under_reply_facet(&server).await;

    // SSE: both calls get a terminal update — success for the first emitted
    // call, the already-proposed error for the second.
    let updates = tool_call_update_events(&events);
    assert_eq!(
        updates.len(),
        2,
        "Expected one tool_call_update per proposal, got: {updates:?}"
    );
    assert_eq!(updates[0]["tool_call_id"], "call_first");
    assert_eq!(updates[0]["status"], "success");
    assert_eq!(updates[0]["output"]["status"], "proposed");
    assert_eq!(updates[0]["output"]["action"], "outlook.reply");
    assert_eq!(updates[1]["tool_call_id"], "call_second");
    assert_eq!(updates[1]["status"], "error");
    assert_eq!(updates[1]["output"]["status"], "rejected");
    assert!(
        updates[1]["output"]["error"]
            .as_str()
            .is_some_and(|error| error.contains("already proposed")),
        "Expected the already-proposed error, got: {}",
        updates[1]["output"]
    );

    // Persisted message: exactly one successful proposal (the FIRST action)
    // plus the error part for the superseded call.
    let chat_id = extract_chat_id(&events).expect("Expected chat_id");
    let assistant_message_id = assistant_message_id_from_events(&events);
    let tool_use_parts =
        fetch_assistant_tool_use_parts(&server, &chat_id, &assistant_message_id).await;
    let proposed: Vec<&Value> = tool_use_parts
        .iter()
        .filter(|part| part["output"]["status"] == "proposed")
        .collect();
    assert_eq!(
        proposed.len(),
        1,
        "Expected exactly one successful proposal part, got: {tool_use_parts:?}"
    );
    assert_eq!(proposed[0]["tool_call_id"], "call_first");
    assert_eq!(proposed[0]["status"], "success");
    assert_eq!(proposed[0]["output"]["action"], "outlook.reply");
    let rejected: Vec<&Value> = tool_use_parts
        .iter()
        .filter(|part| part["output"]["status"] == "rejected")
        .collect();
    assert_eq!(
        rejected.len(),
        1,
        "Expected exactly one rejected proposal part, got: {tool_use_parts:?}"
    );
    assert_eq!(rejected[0]["tool_call_id"], "call_second");
    assert_eq!(rejected[0]["status"], "error");
    assert_eq!(tool_use_parts.len(), 2);

    // The model received both corrective tool responses on the next turn.
    let corrective_bodies = corrective_request_recorder.bodies();
    assert!(
        corrective_bodies.iter().any(|body| {
            body.contains("Proposed client action 'outlook.reply'")
                && body.contains("only one proposal is allowed")
        }),
        "Expected corrective tool responses in the follow-up LLM request: {corrective_bodies:?}"
    );
}

/// An out-of-enum action is answered with a corrective error WITHOUT
/// consuming the one-proposal budget: a later valid call in the same
/// generation still succeeds.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_client_action_invalid_proposal_then_valid_retry_succeeds(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    // Turn 1: propose an action outside the configured enum.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[],
                &[INVALID_RESPONSE_FRAGMENT, PROPOSED_RESPONSE_FRAGMENT],
            ));
        mock_llm_sse_response(
            then,
            build_openai_tool_calls_streaming_response(&[(
                "call_invalid",
                CLIENT_ACTION_TOOL,
                json!({"action": "outlook.forward"}),
            )]),
        );
    });
    // Turn 2: the corrective error arrived → retry with a valid action.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[INVALID_RESPONSE_FRAGMENT],
                &[PROPOSED_RESPONSE_FRAGMENT],
            ));
        mock_llm_sse_response(
            then,
            build_openai_tool_calls_streaming_response(&[(
                "call_valid",
                CLIENT_ACTION_TOOL,
                json!({"action": "outlook.reply_all"}),
            )]),
        );
    });
    // Turn 3: the retry was accepted → finish with text.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[PROPOSED_RESPONSE_FRAGMENT], &[]));
        mock_llm_sse_response(then, build_openai_text_streaming_response(&["Done."]));
    });

    let (mut app_config, _server) = setup_mock_llm_server_with_mocks(mocks).await;
    add_action_facets(&mut app_config);
    let app_state = test_app_state(app_config, pool).await;

    let _user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    let events = submit_under_reply_facet(&server).await;

    let updates = tool_call_update_events(&events);
    assert_eq!(
        updates.len(),
        2,
        "Expected one tool_call_update per proposal, got: {updates:?}"
    );
    assert_eq!(updates[0]["tool_call_id"], "call_invalid");
    assert_eq!(updates[0]["status"], "error");
    assert_eq!(updates[0]["output"]["status"], "rejected");
    assert!(
        updates[0]["output"]["error"]
            .as_str()
            .is_some_and(|error| error.contains("not allowed")),
        "Expected the out-of-enum error, got: {}",
        updates[0]["output"]
    );
    assert_eq!(updates[1]["tool_call_id"], "call_valid");
    assert_eq!(updates[1]["status"], "success");
    assert_eq!(updates[1]["output"]["status"], "proposed");
    assert_eq!(updates[1]["output"]["action"], "outlook.reply_all");

    let chat_id = extract_chat_id(&events).expect("Expected chat_id");
    let assistant_message_id = assistant_message_id_from_events(&events);
    let tool_use_parts =
        fetch_assistant_tool_use_parts(&server, &chat_id, &assistant_message_id).await;
    assert_eq!(tool_use_parts.len(), 2, "Got: {tool_use_parts:?}");
    assert_eq!(tool_use_parts[0]["tool_call_id"], "call_invalid");
    assert_eq!(tool_use_parts[0]["output"]["status"], "rejected");
    assert_eq!(tool_use_parts[1]["tool_call_id"], "call_valid");
    assert_eq!(tool_use_parts[1]["output"]["status"], "proposed");
    assert_eq!(tool_use_parts[1]["output"]["action"], "outlook.reply_all");
}

/// A call to a tool that was never offered (no facet ⇒ empty allow-list)
/// must be refused per-CALL and answered so the model recovers — not kill
/// the whole turn into an empty assistant message.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_unoffered_tool_call_recovers_instead_of_killing_the_turn(pool: Pool<Postgres>) {
    const NOT_ALLOWED: &str = "not allowed for this request";
    let mut mocks = MockSet::new();
    // Turn 1: hallucinate a tool nothing offered.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[], &[NOT_ALLOWED]));
        mock_llm_sse_response(
            then,
            build_openai_tool_calls_streaming_response(&[(
                "call_ghost",
                "totally_made_up_tool",
                json!({}),
            )]),
        );
    });
    // Turn 2: the corrective error arrived → finish with text.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[NOT_ALLOWED], &[]));
        mock_llm_sse_response(then, build_openai_text_streaming_response(&["Recovered."]));
    });

    let (app_config, _server) = setup_mock_llm_server_with_mocks(mocks).await;
    let app_state = test_app_state(app_config, pool).await;
    let _user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": "hi" }))
        .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);

    // The turn completes with the recovery text — no error event, no dead turn.
    assert_eq!(extract_full_text(&events), "Recovered.");
    assert!(
        !events
            .iter()
            .filter_map(|event| serde_json::from_str::<Value>(&event.data).ok())
            .any(|json| json["message_type"] == "error"),
        "the refused tool call must not surface as a turn-killing error event"
    );

    // The refusal is persisted as an error tool_use part the model saw.
    let chat_id = extract_chat_id(&events).expect("Expected chat_id");
    let assistant_message_id = assistant_message_id_from_events(&events);
    let tool_use_parts =
        fetch_assistant_tool_use_parts(&server, &chat_id, &assistant_message_id).await;
    assert_eq!(tool_use_parts.len(), 1, "Got: {tool_use_parts:?}");
    assert_eq!(tool_use_parts[0]["tool_call_id"], "call_ghost");
    assert_eq!(tool_use_parts[0]["status"], "error");
    assert!(
        tool_use_parts[0]["output"]["error"]
            .as_str()
            .is_some_and(|error| error.contains(NOT_ALLOWED)),
        "Got: {}",
        tool_use_parts[0]["output"]
    );
}

// ---------------------------------------------------------------------------
// Archived-chat write rejection + not-found contract.
//
// Writes into an archived chat must be rejected with 409 before any stream
// opens; a missing chat is a 404. Reads remain accessible and are exercised
// elsewhere. These share a helper that opens a chat via a full first turn.
// ---------------------------------------------------------------------------

/// Submit an opening turn against a fresh chat, streaming it to completion, and
/// return `(chat_id, assistant_message_id)`.
async fn submit_opening_turn(server: &TestServer) -> (String, String) {
    let submit_response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": "Opening turn" }))
        .await;
    submit_response.assert_status_ok();

    let events = parse_sse_events(&submit_response);
    let chat_id = extract_chat_id(&events).expect("Expected chat_created event");
    let assistant_message_id = events
        .iter()
        .find_map(|event| {
            if let Ok(json) = serde_json::from_str::<Value>(&event.data)
                && json["message_type"] == "assistant_message_completed"
            {
                return json["message_id"].as_str().map(|s| s.to_string());
            }
            None
        })
        .expect("Expected assistant_message_completed event with message_id");

    (chat_id, assistant_message_id)
}

fn app_server(app_state: erato::state::AppState) -> TestServer {
    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    TestServer::new(app.into_make_service()).expect("Failed to create test server")
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_get_messages_nonexistent_chat_returns_404(pool: Pool<Postgres>) {
    let app_state = test_app_state(hermetic_app_config(None, None), pool).await;
    get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let server = app_server(app_state);

    let response = server
        .get(&format!("/api/v1beta/chats/{}/messages", Uuid::new_v4()))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    assert_eq!(response.status_code(), http::StatusCode::NOT_FOUND);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_submit_to_nonexistent_chat_returns_404(pool: Pool<Postgres>) {
    let app_state = test_app_state(hermetic_app_config(None, None), pool).await;
    get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let server = app_server(app_state);

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "existing_chat_id": Uuid::new_v4().to_string(),
            "user_message": "Hello into the void",
        }))
        .await;

    assert_eq!(response.status_code(), http::StatusCode::NOT_FOUND);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_submit_to_archived_chat_returns_409(pool: Pool<Postgres>) {
    let (app_config, _mock_server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;
    get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let server = app_server(app_state);

    let (chat_id, _assistant_message_id) = submit_opening_turn(&server).await;
    archive_chat_via_api(&server, &chat_id).await;

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "existing_chat_id": chat_id,
            "user_message": "Please answer after archiving",
        }))
        .await;

    assert_eq!(response.status_code(), http::StatusCode::CONFLICT);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_regenerate_in_archived_chat_returns_409(pool: Pool<Postgres>) {
    let (app_config, _mock_server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;
    get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let server = app_server(app_state);

    let (chat_id, assistant_message_id) = submit_opening_turn(&server).await;
    archive_chat_via_api(&server, &chat_id).await;

    let response = server
        .post("/api/v1beta/me/messages/regeneratestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "current_message_id": assistant_message_id }))
        .await;

    assert_eq!(response.status_code(), http::StatusCode::CONFLICT);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_edit_in_archived_chat_returns_409(pool: Pool<Postgres>) {
    let (app_config, _mock_server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;
    let db = app_state.db.clone();
    get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let server = app_server(app_state);

    let (chat_id, _assistant_message_id) = submit_opening_turn(&server).await;

    // The opening user message is the only message without generation parameters.
    let user_message = erato::db::entity::messages::Entity::find()
        .filter(erato::db::entity::messages::Column::GenerationParameters.is_null())
        .order_by_desc(erato::db::entity::messages::Column::CreatedAt)
        .one(&db)
        .await
        .expect("Failed to fetch user message")
        .expect("Expected a user message to edit");

    archive_chat_via_api(&server, &chat_id).await;

    let response = server
        .post("/api/v1beta/me/messages/editstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "message_id": user_message.id,
            "replace_user_message": "Edited after archiving",
        }))
        .await;

    assert_eq!(response.status_code(), http::StatusCode::CONFLICT);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_submit_to_normal_existing_chat_still_succeeds(pool: Pool<Postgres>) {
    let (app_config, _mock_server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;
    get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let server = app_server(app_state);

    let (chat_id, _assistant_message_id) = submit_opening_turn(&server).await;

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "existing_chat_id": chat_id,
            "user_message": "Second turn in the same chat",
        }))
        .await;

    response.assert_status_ok();
    let events = parse_sse_events(&response);
    assert!(
        has_event_type(&events, "assistant_message_completed"),
        "Expected a completed assistant response for a normal existing chat",
    );
}

// ---------------------------------------------------------------------------
// MCP tool approval: the durable park and its `continuestream` continuation.
// ---------------------------------------------------------------------------

/// Under the restrictive approval preset an open-world MCP tool call stops the
/// turn durably: the approval request is the last persisted content part, the
/// chat is parked, and no answer was streamed. `continuestream` with an
/// approval then calls the tool, replays the call and its result to the model
/// and finishes the SAME assistant message.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
async fn continuestream_resumes_a_parked_tool_approval(pool: Pool<Postgres>, tasks_enabled: bool) {
    const TOOL_RESULT: &str = "approval probe published";
    let continuation_recorder = RequestBodyRecorder::new();

    let mut mocks = MockSet::new();
    // The continuation: the tool result arrived, answer in prose.
    {
        let recorder = continuation_recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&[TOOL_RESULT], &[]))
                .matcher(recorder);
            mock_llm_sse_response(
                then,
                build_openai_text_streaming_response(&["APPROVAL-CONTINUED-ANSWER"]),
            );
        });
    }
    // The parked turn: call the approval-gated tool.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[], &[TOOL_RESULT]));
        mock_llm_sse_response(
            then,
            build_openai_tool_calls_streaming_response(&[(
                "call_probe",
                "publish_approval_probe",
                json!({}),
            )]),
        );
    });

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.mcp_servers.insert(
        "mock_mcp_approval".to_string(),
        mcp_server_config(
            &mock_mcp_base_url(),
            "/mcp/approval-policy",
            McpServerAuthenticationConfig::None,
        ),
    );
    app_config.mcp_server_permissions.rules.insert(
        "allow-mock-mcp".to_string(),
        erato::config::McpServerPermissionRule::AllowAll {
            mcp_server_ids: vec!["mock_mcp_approval".to_string()],
        },
    );
    app_config.mcp_servers_global.approval = erato::config::McpToolApprovalConfig {
        enabled: true,
        preset: erato::config::McpToolApprovalPreset::Restrictive,
        allow_always: false,
    };
    // `continuestream` is the one user write where EVERY call lands on a row
    // in `awaiting_approval`, so under the task gate the takeover mode decides
    // 100% of this route's behaviour rather than a parked-chat corner case.
    app_config.delegation.tasks.enabled = tasks_enabled;
    let app_state = test_app_state(app_config, pool).await;
    get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let db = app_state.db.clone();
    let server = app_server(app_state);

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": "publish the approval probe" }))
        .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);

    let chat_id = Uuid::parse_str(&extract_chat_id(&events).expect("Expected chat_id")).unwrap();
    let assistant_message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();
    assert_eq!(extract_full_text(&events), "");

    let parked = erato::db::entity::messages::Entity::find_by_id(assistant_message_id)
        .one(&db)
        .await
        .unwrap()
        .expect("Expected the parked assistant message");
    let approval_request = parked.raw_message["content"]
        .as_array()
        .unwrap()
        .last()
        .expect("Expected a persisted content part")
        .clone();
    assert_eq!(approval_request["content_type"], "tool_approval_request");
    assert_eq!(approval_request["tool_name"], "publish_approval_probe");
    assert_eq!(approval_request["mcp_server_id"], "mock_mcp_approval");
    assert_eq!(approval_request["preset"], "restrictive");
    assert_eq!(
        chats::Entity::find_by_id(chat_id)
            .one(&db)
            .await
            .unwrap()
            .unwrap()
            .generation_state
            .as_deref(),
        Some("awaiting_approval")
    );

    let continued = server
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "message_id": assistant_message_id,
            "decision": "approve",
        }))
        .await;
    continued.assert_status_ok();
    let continued_events = parse_sse_events(&continued);
    assert_eq!(
        extract_full_text(&continued_events),
        "APPROVAL-CONTINUED-ANSWER"
    );

    let continuation_bodies = continuation_recorder.bodies();
    assert_eq!(continuation_bodies.len(), 1);
    assert!(continuation_bodies[0].contains("call_probe"));

    // One message, extended in place.
    let resumed = erato::db::entity::messages::Entity::find_by_id(assistant_message_id)
        .one(&db)
        .await
        .unwrap()
        .expect("Expected the resumed assistant message");
    let resumed_content = resumed.raw_message["content"].as_array().unwrap().clone();
    let content_types: Vec<&str> = resumed_content
        .iter()
        .map(|part| part["content_type"].as_str().unwrap())
        .collect();
    assert_eq!(
        content_types,
        vec!["tool_approval_request", "tool_approval", "tool_use", "text"]
    );
    assert_eq!(resumed_content[1]["tool_call_id"], "call_probe");
    assert_eq!(resumed_content[1]["always_allow"], false);
    assert_eq!(resumed_content[2]["status"], "success");
    assert!(
        serde_json::to_string(&resumed_content[2]["output"])
            .unwrap()
            .contains(TOOL_RESULT)
    );
    assert_eq!(
        chats::Entity::find_by_id(chat_id)
            .one(&db)
            .await
            .unwrap()
            .unwrap()
            .generation_state
            .as_deref(),
        Some("completed")
    );
}

/// Gate off: the approval continuation is unaffected by the task lease.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_continuestream_resumes_a_parked_tool_approval(pool: Pool<Postgres>) {
    continuestream_resumes_a_parked_tool_approval(pool, false).await;
}

/// Gate ON, and this is the arm that had no coverage at all.
///
/// With `delegation.tasks.enabled` the route acquires the lease through
/// `try_start_task` before it spawns. Every continuation arrives on a chat in
/// `awaiting_approval`, so `Takeover::TakeParked` is not a corner case here —
/// it is the whole gate. Flip that literal in `acquire_user_generation_lease`
/// to `RefuseParked` and every MCP tool approval 409s forever: the stale-lease
/// arm of the CAS rescues `running` rows only, never `awaiting_approval`, so
/// the entire approval flow dies. Before this test, nothing failed.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn continuestream_resumes_a_parked_tool_approval_under_the_task_gate(pool: Pool<Postgres>) {
    continuestream_resumes_a_parked_tool_approval(pool, true).await;
}

/// The wire contract the web client seeds its streaming buffer from: a
/// continuation extends the SAME assistant message, so it emits NO
/// `assistant_message_started` and numbers its deltas as offsets into that
/// message's full persisted content — after the two parts the continuation
/// appends before it reaches the model (the decision, then the gated call).
/// A client that starts from an empty buffer, or seeds only the parked parts,
/// misplaces every delta. Asserted for both decisions, on a park that already
/// carries earlier content so index 0 is not the degenerate answer.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_continuestream_numbers_deltas_after_the_decision_and_call_parts(
    pool: Pool<Postgres>,
) {
    for (decision, marker) in [
        ("approve", "approval probe published"),
        ("reject", "denied this tool call"),
    ] {
        let mut mocks = MockSet::new();
        {
            let marker = marker.to_string();
            mocks.mock(move |when, then| {
                when.post()
                    .path("/v1/chat/completions")
                    .matcher(BodyContainsMatcher::new(&[&marker], &[]));
                mock_llm_sse_response(
                    then,
                    build_openai_text_streaming_response(&["CONTINUED-", "ANSWER"]),
                );
            });
        }
        {
            let marker = marker.to_string();
            mocks.mock(move |when, then| {
                when.post()
                    .path("/v1/chat/completions")
                    .matcher(BodyContainsMatcher::new(&[], &[&marker]));
                mock_llm_sse_response(
                    then,
                    crate::test_utils::build_openai_narrated_tool_calls_streaming_response(
                        "Let me publish that. ",
                        &[("call_probe", "publish_approval_probe", json!({}))],
                    ),
                );
            });
        }

        let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
        app_config.mcp_servers.insert(
            "mock_mcp_approval".to_string(),
            mcp_server_config(
                &mock_mcp_base_url(),
                "/mcp/approval-policy",
                McpServerAuthenticationConfig::None,
            ),
        );
        app_config.mcp_server_permissions.rules.insert(
            "allow-mock-mcp".to_string(),
            erato::config::McpServerPermissionRule::AllowAll {
                mcp_server_ids: vec!["mock_mcp_approval".to_string()],
            },
        );
        app_config.mcp_servers_global.approval = erato::config::McpToolApprovalConfig {
            enabled: true,
            preset: erato::config::McpToolApprovalPreset::Restrictive,
            allow_always: false,
        };
        let app_state = test_app_state(app_config, pool.clone()).await;
        get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
            .await
            .expect("Failed to create user");
        let db = app_state.db.clone();
        let server = app_server(app_state);

        let response = server
            .post("/api/v1beta/me/messages/submitstream")
            .with_bearer_token(TEST_JWT_TOKEN)
            .json(&json!({ "user_message": "publish the approval probe" }))
            .await;
        response.assert_status_ok();
        let events = parse_sse_events(&response);
        let assistant_message_id =
            Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();

        let parked = erato::db::entity::messages::Entity::find_by_id(assistant_message_id)
            .one(&db)
            .await
            .unwrap()
            .expect("Expected the parked assistant message");
        let parked_len = parked.raw_message["content"].as_array().unwrap().len();
        assert_eq!(
            parked_len, 2,
            "{decision}: expected the narrated park to persist text + the approval request"
        );

        let continued = server
            .post("/api/v1beta/me/messages/continuestream")
            .with_bearer_token(TEST_JWT_TOKEN)
            .json(&json!({
                "message_id": assistant_message_id,
                "decision": decision,
            }))
            .await;
        continued.assert_status_ok();
        let continued_events = parse_sse_events(&continued);

        assert!(
            !continued_events
                .iter()
                .any(|event| event.event_type == "assistant_message_started"),
            "{decision}: a continuation extends an existing message and must not announce a new one"
        );

        let delta_indices: Vec<usize> = continued_events
            .iter()
            .filter(|event| event.event_type == "text_delta")
            .map(|event| {
                serde_json::from_str::<serde_json::Value>(&event.data).unwrap()["content_index"]
                    .as_u64()
                    .unwrap() as usize
            })
            .collect();
        assert!(
            !delta_indices.is_empty(),
            "{decision}: expected the continuation to stream an answer"
        );
        assert!(
            delta_indices.iter().all(|index| *index == parked_len + 2),
            "{decision}: expected every delta at parked_len + 2 ({}), got {delta_indices:?}",
            parked_len + 2
        );

        // The gated call's outcome is announced at its own index, ahead of
        // the answer, so a client that seeded the call as running can settle
        // it in place (and a resume can rebuild it) while the answer streams.
        let tool_updates: Vec<serde_json::Value> = continued_events
            .iter()
            .filter(|event| event.event_type == "tool_call_update")
            .map(|event| serde_json::from_str(&event.data).unwrap())
            .collect();
        assert_eq!(
            tool_updates.len(),
            1,
            "{decision}: expected one terminal update for the gated call, got {tool_updates:?}"
        );
        assert_eq!(tool_updates[0]["tool_call_id"], "call_probe");
        assert_eq!(tool_updates[0]["content_index"], parked_len + 1);
        assert_eq!(
            tool_updates[0]["status"],
            if decision == "reject" {
                "error"
            } else {
                "success"
            },
            "{decision}: the announced status must match the persisted call"
        );
        let first_update_at = continued_events
            .iter()
            .position(|event| event.event_type == "tool_call_update")
            .unwrap();
        let first_delta_at = continued_events
            .iter()
            .position(|event| event.event_type == "text_delta")
            .unwrap();
        assert!(
            first_update_at < first_delta_at,
            "{decision}: the call's outcome must precede the answer"
        );

        // The two parts the client seeds, in the order it seeds them.
        let resumed = erato::db::entity::messages::Entity::find_by_id(assistant_message_id)
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        let content_types: Vec<&str> = resumed.raw_message["content"]
            .as_array()
            .unwrap()
            .iter()
            .map(|part| part["content_type"].as_str().unwrap())
            .collect();
        let expected_decision_part = if decision == "reject" {
            "tool_rejection"
        } else {
            "tool_approval"
        };
        assert_eq!(
            content_types,
            vec![
                "text",
                "tool_approval_request",
                expected_decision_part,
                "tool_use",
                "text"
            ],
            "{decision}: unexpected persisted layout"
        );
    }
}

/// The same park continued with a denial: the tool is never called, the
/// rejection and a failed tool result are persisted in its place, and the model
/// answers around it. `approve_always` is refused outright while the approval
/// policy disallows it.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_continuestream_denies_a_parked_tool_approval(pool: Pool<Postgres>) {
    const TOOL_RESULT: &str = "approval probe published";
    const DENIAL: &str = "The user denied this tool call.";
    let continuation_recorder = RequestBodyRecorder::new();

    let mut mocks = MockSet::new();
    // The continuation: the denial arrived, answer around it.
    {
        let recorder = continuation_recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&[DENIAL], &[]))
                .matcher(recorder);
            mock_llm_sse_response(
                then,
                build_openai_text_streaming_response(&["APPROVAL-DENIED-ANSWER"]),
            );
        });
    }
    // The parked turn: call the approval-gated tool.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[], &[DENIAL]));
        mock_llm_sse_response(
            then,
            build_openai_tool_calls_streaming_response(&[(
                "call_probe",
                "publish_approval_probe",
                json!({}),
            )]),
        );
    });

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.mcp_servers.insert(
        "mock_mcp_approval".to_string(),
        mcp_server_config(
            &mock_mcp_base_url(),
            "/mcp/approval-policy",
            McpServerAuthenticationConfig::None,
        ),
    );
    app_config.mcp_server_permissions.rules.insert(
        "allow-mock-mcp".to_string(),
        erato::config::McpServerPermissionRule::AllowAll {
            mcp_server_ids: vec!["mock_mcp_approval".to_string()],
        },
    );
    app_config.mcp_servers_global.approval = erato::config::McpToolApprovalConfig {
        enabled: true,
        preset: erato::config::McpToolApprovalPreset::Restrictive,
        allow_always: false,
    };
    let app_state = test_app_state(app_config, pool).await;
    get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let db = app_state.db.clone();
    let server = app_server(app_state);

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": "publish the approval probe" }))
        .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    let chat_id = Uuid::parse_str(&extract_chat_id(&events).expect("Expected chat_id")).unwrap();
    let assistant_message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();

    let always = server
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "message_id": assistant_message_id,
            "decision": "approve_always",
        }))
        .await;
    always.assert_status(http::StatusCode::BAD_REQUEST);

    let continued = server
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "message_id": assistant_message_id,
            "decision": "reject",
        }))
        .await;
    continued.assert_status_ok();
    let continued_events = parse_sse_events(&continued);
    assert_eq!(
        extract_full_text(&continued_events),
        "APPROVAL-DENIED-ANSWER"
    );

    let continuation_bodies = continuation_recorder.bodies();
    assert_eq!(continuation_bodies.len(), 1);
    assert!(
        !continuation_bodies[0].contains(TOOL_RESULT),
        "a denied tool must not be called"
    );

    let resumed = erato::db::entity::messages::Entity::find_by_id(assistant_message_id)
        .one(&db)
        .await
        .unwrap()
        .expect("Expected the resumed assistant message");
    let resumed_content = resumed.raw_message["content"].as_array().unwrap().clone();
    let content_types: Vec<&str> = resumed_content
        .iter()
        .map(|part| part["content_type"].as_str().unwrap())
        .collect();
    assert_eq!(
        content_types,
        vec![
            "tool_approval_request",
            "tool_rejection",
            "tool_use",
            "text"
        ]
    );
    assert_eq!(resumed_content[1]["tool_call_id"], "call_probe");
    assert_eq!(resumed_content[2]["status"], "error");
    assert_eq!(resumed_content[2]["output"]["status"], "rejected");
    assert_eq!(resumed_content[2]["output"]["error"], DENIAL);
    assert_eq!(
        chats::Entity::find_by_id(chat_id)
            .one(&db)
            .await
            .unwrap()
            .unwrap()
            .generation_state
            .as_deref(),
        Some("completed")
    );
}

// ---------------------------------------------------------------------------
// Per-user MCP tool denial: enforced when the tool set is built and again
// when a parked approval is continued.
// ---------------------------------------------------------------------------

/// The model-facing tool names of every recorded chat-completion request
/// that offered tools, in request order. The chat-title request carries no
/// tools and is skipped.
fn recorded_tool_offers(bodies: &[String]) -> Vec<Vec<String>> {
    bodies
        .iter()
        .filter_map(|body| {
            let body: Value = serde_json::from_str(body).expect("recorded body is JSON");
            let tools = body["tools"].as_array()?;
            Some(
                tools
                    .iter()
                    .map(|tool| tool["function"]["name"].as_str().unwrap().to_string())
                    .collect(),
            )
        })
        .collect()
}

/// A tool the user denied for themselves is not offered to the model, and the
/// denial needs no approval policy at all: it is accepted while approvals are
/// off entirely, where a grant is still refused.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_denied_mcp_tool_is_not_offered_to_the_model(pool: Pool<Postgres>) {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    {
        let recorder = recorder.clone();
        mocks.mock(move |when, then| {
            when.post().path("/v1/chat/completions").matcher(recorder);
            mock_llm_sse_response(
                then,
                build_openai_text_streaming_response(&["FILES-ANSWER"]),
            );
        });
    }

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.mcp_servers.insert(
        "files".to_string(),
        mcp_server_config(
            &mock_mcp_base_url(),
            "/mcp/file",
            McpServerAuthenticationConfig::None,
        ),
    );
    app_config.mcp_server_permissions.rules.insert(
        "allow-files".to_string(),
        erato::config::McpServerPermissionRule::AllowAll {
            mcp_server_ids: vec!["files".to_string()],
        },
    );
    app_config.mcp_servers_global.approval = erato::config::McpToolApprovalConfig {
        enabled: false,
        allow_always: false,
        ..Default::default()
    };
    let app_state = test_app_state(app_config, pool).await;
    get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let server = app_server(app_state);

    let grant = server
        .post("/api/v1beta/me/mcp-tool-approval-settings")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "mcp_server_id": "files",
            "tool_name": "read_file",
            "decision": "always_allow",
        }))
        .await;
    grant.assert_status(http::StatusCode::BAD_REQUEST);
    let denied = server
        .post("/api/v1beta/me/mcp-tool-approval-settings")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "mcp_server_id": "files",
            "tool_name": "read_file",
            "decision": "denied",
        }))
        .await;
    denied.assert_status_ok();

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": "what files are there?" }))
        .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    assert_eq!(extract_full_text(&events), "FILES-ANSWER");

    let offers = recorded_tool_offers(&recorder.bodies());
    assert_eq!(offers.len(), 1);
    let offered = &offers[0];
    assert!(
        offered.iter().any(|name| name == "list_files"),
        "undenied tools stay offered: {offered:?}"
    );
    assert!(
        !offered.iter().any(|name| name == "read_file"),
        "the denied tool must not reach the model: {offered:?}"
    );

    let tools = server
        .get("/api/v1beta/me/mcp_servers/files/tools")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    tools.assert_status_ok();
    let tools: Value = tools.json();
    let decisions: Vec<(&str, &str)> = tools["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| {
            (
                tool["name"].as_str().unwrap(),
                tool["user_decision"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        decisions,
        vec![("list_files", "none"), ("read_file", "denied")]
    );
}

/// A denial stored while an approval was pending wins over the approval: the
/// continued turn does not execute the tool, records a refusal in its place,
/// no longer offers the tool, and completes cleanly. "Always allow" on the
/// stale card must not overwrite the denial either.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_continuestream_refuses_a_tool_denied_after_the_park(pool: Pool<Postgres>) {
    const TOOL_RESULT: &str = "approval probe published";
    const REFUSAL: &str = "has disabled the tool";
    let continuation_recorder = RequestBodyRecorder::new();

    let mut mocks = MockSet::new();
    {
        let recorder = continuation_recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&[REFUSAL], &[]))
                .matcher(recorder);
            mock_llm_sse_response(
                then,
                build_openai_text_streaming_response(&["DENIED-AFTER-PARK-ANSWER"]),
            );
        });
    }
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[], &[REFUSAL]));
        mock_llm_sse_response(
            then,
            build_openai_tool_calls_streaming_response(&[(
                "call_probe",
                "publish_approval_probe",
                json!({}),
            )]),
        );
    });

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.mcp_servers.insert(
        "mock_mcp_approval".to_string(),
        mcp_server_config(
            &mock_mcp_base_url(),
            "/mcp/approval-policy",
            McpServerAuthenticationConfig::None,
        ),
    );
    app_config.mcp_server_permissions.rules.insert(
        "allow-mock-mcp".to_string(),
        erato::config::McpServerPermissionRule::AllowAll {
            mcp_server_ids: vec!["mock_mcp_approval".to_string()],
        },
    );
    app_config.mcp_servers_global.approval = erato::config::McpToolApprovalConfig {
        enabled: true,
        preset: erato::config::McpToolApprovalPreset::Restrictive,
        allow_always: true,
    };
    let app_state = test_app_state(app_config, pool).await;
    get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let db = app_state.db.clone();
    let server = app_server(app_state);

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": "publish the approval probe" }))
        .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    let chat_id = Uuid::parse_str(&extract_chat_id(&events).expect("Expected chat_id")).unwrap();
    let assistant_message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();
    assert_eq!(
        chats::Entity::find_by_id(chat_id)
            .one(&db)
            .await
            .unwrap()
            .unwrap()
            .generation_state
            .as_deref(),
        Some("awaiting_approval")
    );

    // The denial lands while the card is still waiting.
    let denied = server
        .post("/api/v1beta/me/mcp-tool-approval-settings")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "mcp_server_id": "mock_mcp_approval",
            "tool_name": "publish_approval_probe",
            "decision": "denied",
        }))
        .await;
    denied.assert_status_ok();

    let continued = server
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "message_id": assistant_message_id,
            "decision": "approve_always",
        }))
        .await;
    continued.assert_status_ok();
    let continued_events = parse_sse_events(&continued);
    assert_eq!(
        extract_full_text(&continued_events),
        "DENIED-AFTER-PARK-ANSWER"
    );

    let continuation_bodies = continuation_recorder.bodies();
    assert_eq!(continuation_bodies.len(), 1);
    assert!(
        !continuation_bodies[0].contains(TOOL_RESULT),
        "a denied tool must not be executed"
    );
    let offers = recorded_tool_offers(&continuation_bodies);
    assert_eq!(offers.len(), 1);
    let offered = &offers[0];
    assert!(
        offered.iter().any(|name| name == "read_approval_fixture"),
        "{offered:?}"
    );
    assert!(
        !offered.iter().any(|name| name == "publish_approval_probe"),
        "the denied tool must not be offered to the continued turn: {offered:?}"
    );

    let resumed = erato::db::entity::messages::Entity::find_by_id(assistant_message_id)
        .one(&db)
        .await
        .unwrap()
        .expect("Expected the resumed assistant message");
    let resumed_content = resumed.raw_message["content"].as_array().unwrap().clone();
    let content_types: Vec<&str> = resumed_content
        .iter()
        .map(|part| part["content_type"].as_str().unwrap())
        .collect();
    assert_eq!(
        content_types,
        vec!["tool_approval_request", "tool_approval", "tool_use", "text"]
    );
    assert_eq!(resumed_content[1]["always_allow"], false);
    assert_eq!(resumed_content[2]["status"], "error");
    assert_eq!(resumed_content[2]["output"]["status"], "rejected");
    assert!(
        resumed_content[2]["output"]["error"]
            .as_str()
            .unwrap()
            .contains(REFUSAL)
    );
    assert_eq!(
        chats::Entity::find_by_id(chat_id)
            .one(&db)
            .await
            .unwrap()
            .unwrap()
            .generation_state
            .as_deref(),
        Some("completed")
    );

    let settings = server
        .get("/api/v1beta/me/mcp-tool-approval-settings")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    let settings: Value = settings.json();
    let settings = settings["settings"].as_array().unwrap().clone();
    assert_eq!(settings.len(), 1);
    assert_eq!(settings[0]["tool_name"], "publish_approval_probe");
    assert_eq!(
        settings[0]["decision"], "denied",
        "approve_always on a stale card must not overwrite the denial"
    );
}

/// A denial outranks the server's health: a parked approval on a tool the
/// user has since denied is refused even when the tool's server cannot be
/// reached at continuation time, instead of the park staying retryable
/// behind an outage error. The continuation runs on a fresh app state so the
/// session cache is cold, as after a restart.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_continuestream_refuses_a_denied_tool_while_its_server_is_down(pool: Pool<Postgres>) {
    const TOOL_RESULT: &str = "approval probe published";
    const REFUSAL: &str = "has disabled the tool";
    let continuation_recorder = RequestBodyRecorder::new();

    let mut mocks = MockSet::new();
    {
        let recorder = continuation_recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&[REFUSAL], &[]))
                .matcher(recorder);
            mock_llm_sse_response(
                then,
                build_openai_text_streaming_response(&["DENIED-WHILE-DOWN-ANSWER"]),
            );
        });
    }
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[], &[REFUSAL]));
        mock_llm_sse_response(
            then,
            build_openai_tool_calls_streaming_response(&[(
                "call_probe",
                "publish_approval_probe",
                json!({}),
            )]),
        );
    });

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.mcp_servers.insert(
        "mock_mcp_approval".to_string(),
        mcp_server_config(
            &mock_mcp_base_url(),
            "/mcp/approval-policy",
            McpServerAuthenticationConfig::None,
        ),
    );
    app_config.mcp_server_permissions.rules.insert(
        "allow-mock-mcp".to_string(),
        erato::config::McpServerPermissionRule::AllowAll {
            mcp_server_ids: vec!["mock_mcp_approval".to_string()],
        },
    );
    app_config.mcp_servers_global.approval = erato::config::McpToolApprovalConfig {
        enabled: true,
        preset: erato::config::McpToolApprovalPreset::Restrictive,
        allow_always: true,
    };
    // The same deployment after the server went down: every request to it
    // now fails, so discovery reports it unavailable.
    let mut app_config_server_down = app_config.clone();
    app_config_server_down.mcp_servers.insert(
        "mock_mcp_approval".to_string(),
        mcp_server_config(
            &mock_mcp_base_url(),
            "/mcp/list-tools-500",
            McpServerAuthenticationConfig::None,
        ),
    );

    let app_state = test_app_state(app_config, pool.clone()).await;
    get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let db = app_state.db.clone();
    let server = app_server(app_state);

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": "publish the approval probe" }))
        .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    let chat_id = Uuid::parse_str(&extract_chat_id(&events).expect("Expected chat_id")).unwrap();
    let assistant_message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();
    assert_eq!(
        chats::Entity::find_by_id(chat_id)
            .one(&db)
            .await
            .unwrap()
            .unwrap()
            .generation_state
            .as_deref(),
        Some("awaiting_approval")
    );

    let denied = server
        .post("/api/v1beta/me/mcp-tool-approval-settings")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "mcp_server_id": "mock_mcp_approval",
            "tool_name": "publish_approval_probe",
            "decision": "denied",
        }))
        .await;
    denied.assert_status_ok();
    drop(server);

    let server = app_server(test_app_state(app_config_server_down, pool).await);
    let continued = server
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "message_id": assistant_message_id,
            "decision": "approve",
        }))
        .await;
    continued.assert_status_ok();
    let continued_events = parse_sse_events(&continued);
    assert_eq!(
        extract_full_text(&continued_events),
        "DENIED-WHILE-DOWN-ANSWER"
    );
    assert!(
        !continued_events
            .iter()
            .filter_map(|event| serde_json::from_str::<Value>(&event.data).ok())
            .any(|json| json["message_type"] == "error"),
        "the denial must not surface as an outage error"
    );

    let continuation_bodies = continuation_recorder.bodies();
    assert_eq!(continuation_bodies.len(), 1);
    assert!(
        !continuation_bodies[0].contains(TOOL_RESULT),
        "a denied tool must not be executed"
    );
    assert!(
        recorded_tool_offers(&continuation_bodies)
            .iter()
            .flatten()
            .all(|name| name != "publish_approval_probe"),
        "the denied tool must not be offered to the continued turn"
    );

    let resumed = erato::db::entity::messages::Entity::find_by_id(assistant_message_id)
        .one(&db)
        .await
        .unwrap()
        .expect("Expected the resumed assistant message");
    let resumed_content = resumed.raw_message["content"].as_array().unwrap().clone();
    let content_types: Vec<&str> = resumed_content
        .iter()
        .map(|part| part["content_type"].as_str().unwrap())
        .collect();
    assert_eq!(
        content_types,
        vec!["tool_approval_request", "tool_approval", "tool_use", "text"]
    );
    assert_eq!(resumed_content[2]["status"], "error");
    assert_eq!(resumed_content[2]["output"]["status"], "rejected");
    assert!(
        resumed_content[2]["output"]["error"]
            .as_str()
            .unwrap()
            .contains(REFUSAL)
    );
    assert_eq!(
        chats::Entity::find_by_id(chat_id)
            .one(&db)
            .await
            .unwrap()
            .unwrap()
            .generation_state
            .as_deref(),
        Some("completed")
    );
}

/// A continuation that arrives without the forwarded credential the tool's
/// server needs does not burn the park: discovery skips the server, the
/// approval is left untouched, and a later continuation carrying the token
/// runs the approved call.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_continuestream_keeps_the_park_when_the_forwarded_credential_is_missing(
    pool: Pool<Postgres>,
) {
    const TOOL_RESULT: &str = "approval probe published";
    const FORWARDED_TOKEN: &str = "forwarded-access-token";
    let continuation_recorder = RequestBodyRecorder::new();

    let mut mocks = MockSet::new();
    {
        let recorder = continuation_recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&[TOOL_RESULT], &[]))
                .matcher(recorder);
            mock_llm_sse_response(
                then,
                build_openai_text_streaming_response(&["APPROVAL-CONTINUED-ANSWER"]),
            );
        });
    }
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[], &[TOOL_RESULT]));
        mock_llm_sse_response(
            then,
            build_openai_tool_calls_streaming_response(&[(
                "call_probe",
                "publish_approval_probe",
                json!({}),
            )]),
        );
    });

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    // The approval route ignores the bearer it is sent; what matters is that
    // a session for it can only be keyed while the request carries a token.
    app_config.mcp_servers.insert(
        "mock_mcp_approval".to_string(),
        mcp_server_config(
            &mock_mcp_base_url(),
            "/mcp/approval-policy",
            McpServerAuthenticationConfig::Forwarded {
                forwarded: McpServerForwardedAuthenticationConfig {
                    credential: McpServerForwardedCredential::AccessToken,
                    ..Default::default()
                },
            },
        ),
    );
    app_config.mcp_server_permissions.rules.insert(
        "allow-mock-mcp".to_string(),
        erato::config::McpServerPermissionRule::AllowAll {
            mcp_server_ids: vec!["mock_mcp_approval".to_string()],
        },
    );
    app_config.mcp_servers_global.approval = erato::config::McpToolApprovalConfig {
        enabled: true,
        preset: erato::config::McpToolApprovalPreset::Restrictive,
        allow_always: false,
    };
    let app_state = test_app_state(app_config, pool).await;
    get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let db = app_state.db.clone();
    let server = app_server(app_state);

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Forwarded-Access-Token", FORWARDED_TOKEN)
        .json(&json!({ "user_message": "publish the approval probe" }))
        .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    let chat_id = Uuid::parse_str(&extract_chat_id(&events).expect("Expected chat_id")).unwrap();
    let assistant_message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();
    assert_eq!(
        chats::Entity::find_by_id(chat_id)
            .one(&db)
            .await
            .unwrap()
            .unwrap()
            .generation_state
            .as_deref(),
        Some("awaiting_approval")
    );

    // The approval arrives without the token, as during a token refresh. The
    // continuation fails outright, which the test client surfaces as a panic
    // on the broken stream.
    let without_token = futures::FutureExt::catch_unwind(std::panic::AssertUnwindSafe(
        std::future::IntoFuture::into_future(
            server
                .post("/api/v1beta/me/messages/continuestream")
                .with_bearer_token(TEST_JWT_TOKEN)
                .json(&json!({
                    "message_id": assistant_message_id,
                    "decision": "approve",
                })),
        ),
    ))
    .await;
    let failure = without_token.expect_err("a continuation that cannot reach the server must fail");
    let failure = failure
        .downcast_ref::<String>()
        .cloned()
        .expect("the stream failure carries its cause");
    assert!(
        failure.contains("Approved MCP tool is no longer available"),
        "{failure}"
    );
    assert!(
        continuation_recorder.bodies().is_empty(),
        "the model must not be contacted while the approval is still parked"
    );
    let parked = erato::db::entity::messages::Entity::find_by_id(assistant_message_id)
        .one(&db)
        .await
        .unwrap()
        .expect("Expected the parked assistant message");
    let parked_content_types: Vec<String> = parked.raw_message["content"]
        .as_array()
        .unwrap()
        .iter()
        .map(|part| part["content_type"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(
        parked_content_types,
        vec!["tool_approval_request"],
        "the park must survive a continuation without the credential"
    );

    let with_token = server
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Forwarded-Access-Token", FORWARDED_TOKEN)
        .json(&json!({
            "message_id": assistant_message_id,
            "decision": "approve",
        }))
        .await;
    with_token.assert_status_ok();
    assert_eq!(
        extract_full_text(&parse_sse_events(&with_token)),
        "APPROVAL-CONTINUED-ANSWER"
    );
    assert_eq!(continuation_recorder.bodies().len(), 1);

    let resumed = erato::db::entity::messages::Entity::find_by_id(assistant_message_id)
        .one(&db)
        .await
        .unwrap()
        .expect("Expected the resumed assistant message");
    let resumed_content = resumed.raw_message["content"].as_array().unwrap().clone();
    let content_types: Vec<&str> = resumed_content
        .iter()
        .map(|part| part["content_type"].as_str().unwrap())
        .collect();
    assert_eq!(
        content_types,
        vec!["tool_approval_request", "tool_approval", "tool_use", "text"]
    );
    assert_eq!(resumed_content[2]["status"], "success");
    assert!(
        serde_json::to_string(&resumed_content[2]["output"])
            .unwrap()
            .contains(TOOL_RESULT)
    );
    assert_eq!(
        chats::Entity::find_by_id(chat_id)
            .one(&db)
            .await
            .unwrap()
            .unwrap()
            .generation_state
            .as_deref(),
        Some("completed")
    );
}

/// The continued turn is offered the tool set the parked turn was built with:
/// an assistant restricted to one server keeps the other authorized server's
/// tools out of the continuation too.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_continuestream_keeps_the_original_filtered_tool_set(pool: Pool<Postgres>) {
    const TOOL_RESULT: &str = "approval probe published";
    let parked_recorder = RequestBodyRecorder::new();
    let continuation_recorder = RequestBodyRecorder::new();

    let mut mocks = MockSet::new();
    {
        let recorder = continuation_recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&[TOOL_RESULT], &[]))
                .matcher(recorder);
            mock_llm_sse_response(
                then,
                build_openai_text_streaming_response(&["FILTERED-CONTINUATION-ANSWER"]),
            );
        });
    }
    {
        let recorder = parked_recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&[], &[TOOL_RESULT]))
                .matcher(recorder);
            mock_llm_sse_response(
                then,
                build_openai_tool_calls_streaming_response(&[(
                    "call_probe",
                    "publish_approval_probe",
                    json!({}),
                )]),
            );
        });
    }

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.mcp_servers.insert(
        "mock_mcp_approval".to_string(),
        mcp_server_config(
            &mock_mcp_base_url(),
            "/mcp/approval-policy",
            McpServerAuthenticationConfig::None,
        ),
    );
    app_config.mcp_servers.insert(
        "files".to_string(),
        mcp_server_config(
            &mock_mcp_base_url(),
            "/mcp/file",
            McpServerAuthenticationConfig::None,
        ),
    );
    app_config.mcp_server_permissions.rules.insert(
        "allow-both".to_string(),
        erato::config::McpServerPermissionRule::AllowAll {
            mcp_server_ids: vec!["mock_mcp_approval".to_string(), "files".to_string()],
        },
    );
    app_config.mcp_servers_global.approval = erato::config::McpToolApprovalConfig {
        enabled: true,
        preset: erato::config::McpToolApprovalPreset::Restrictive,
        allow_always: false,
    };
    let app_state = test_app_state(app_config, pool).await;
    get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let server = app_server(app_state);

    let assistant = server
        .post("/api/v1beta/assistants")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&json!({
            "name": "Approval only",
            "description": "Sees one server",
            "prompt": "You are a helpful test assistant.",
            "mcp_server_ids": ["mock_mcp_approval"],
            "default_chat_provider": null,
            "file_ids": []
        }))
        .await;
    assistant.assert_status(http::StatusCode::CREATED);
    let assistant: Value = assistant.json();
    let chat = server
        .post("/api/v1beta/me/chats")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&json!({ "assistant_id": assistant["id"] }))
        .await;
    chat.assert_status_ok();
    let chat: Value = chat.json();

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "existing_chat_id": chat["chat_id"],
            "user_message": "publish the approval probe",
        }))
        .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    let assistant_message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();

    let mut parked_offers = recorded_tool_offers(&parked_recorder.bodies());
    assert_eq!(parked_offers.len(), 1);
    let mut parked_offered = parked_offers.remove(0);
    parked_offered.sort();
    assert_eq!(
        parked_offered,
        vec!["publish_approval_probe", "read_approval_fixture"]
    );

    let continued = server
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "message_id": assistant_message_id,
            "decision": "approve",
        }))
        .await;
    continued.assert_status_ok();
    let continued_events = parse_sse_events(&continued);
    assert_eq!(
        extract_full_text(&continued_events),
        "FILTERED-CONTINUATION-ANSWER"
    );

    let mut continued_offers = recorded_tool_offers(&continuation_recorder.bodies());
    assert_eq!(continued_offers.len(), 1);
    let mut continued_offered = continued_offers.remove(0);
    continued_offered.sort();
    assert_eq!(
        continued_offered, parked_offered,
        "the continued turn must be offered exactly the parked turn's tools"
    );
}

/// MCP wins a name clash with a client tool. Denying the MCP tool removes it
/// from the offer without promoting the same-named client tool it shadowed.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_denied_mcp_tool_does_not_promote_a_same_named_client_tool(pool: Pool<Postgres>) {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    {
        let recorder = recorder.clone();
        mocks.mock(move |when, then| {
            when.post().path("/v1/chat/completions").matcher(recorder);
            mock_llm_sse_response(
                then,
                build_openai_text_streaming_response(&["COLLISION-ANSWER"]),
            );
        });
    }

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.mcp_servers.insert(
        "files".to_string(),
        mcp_server_config(
            &mock_mcp_base_url(),
            "/mcp/file",
            McpServerAuthenticationConfig::None,
        ),
    );
    app_config.mcp_server_permissions.rules.insert(
        "allow-files".to_string(),
        erato::config::McpServerPermissionRule::AllowAll {
            mcp_server_ids: vec!["files".to_string()],
        },
    );
    // A client tool with the MCP tool's model-facing name, globally
    // allowlisted; no facets, so the MCP side stays unfiltered.
    app_config.client_tools.tools.insert(
        "outlook_read_file".to_string(),
        ClientToolConfig {
            name: "read_file".to_string(),
            namespace: Some("outlook".to_string()),
            description: "Reads a file from the mailbox".to_string(),
            parameters: r#"{"type":"object","properties":{}}"#.to_string(),
            timeout_ms: None,
        },
    );
    app_config.facets.tool_call_allowlist = vec!["outlook/read_file".to_string()];
    let app_state = test_app_state(app_config, pool).await;
    get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let server = app_server(app_state);

    let before = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": "read the file" }))
        .await;
    before.assert_status_ok();
    let before_offers = recorded_tool_offers(&recorder.bodies());
    assert_eq!(before_offers.len(), 1);
    let before_offered = &before_offers[0];
    assert_eq!(
        before_offered
            .iter()
            .filter(|name| *name == "read_file")
            .count(),
        1,
        "the MCP tool shadows the client tool: {before_offered:?}"
    );

    let denied = server
        .post("/api/v1beta/me/mcp-tool-approval-settings")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "mcp_server_id": "files",
            "tool_name": "read_file",
            "decision": "denied",
        }))
        .await;
    denied.assert_status_ok();

    let after = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": "read the file again" }))
        .await;
    after.assert_status_ok();
    let offers = recorded_tool_offers(&recorder.bodies());
    assert_eq!(offers.len(), 2);
    let after_offered = &offers[1];
    assert!(
        after_offered.iter().any(|name| name == "list_files"),
        "{after_offered:?}"
    );
    assert!(
        !after_offered.iter().any(|name| name == "read_file"),
        "denying the MCP tool must not promote the client tool it shadowed: {after_offered:?}"
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_continuestream_in_archived_chat_returns_409(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mocks.mock(|when, then| {
        when.post().path("/v1/chat/completions");
        mock_llm_sse_response(
            then,
            build_openai_tool_calls_streaming_response(&[(
                "call_probe",
                "publish_approval_probe",
                json!({}),
            )]),
        );
    });

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.mcp_servers.insert(
        "mock_mcp_approval".to_string(),
        mcp_server_config(
            &mock_mcp_base_url(),
            "/mcp/approval-policy",
            McpServerAuthenticationConfig::None,
        ),
    );
    app_config.mcp_server_permissions.rules.insert(
        "allow-mock-mcp".to_string(),
        erato::config::McpServerPermissionRule::AllowAll {
            mcp_server_ids: vec!["mock_mcp_approval".to_string()],
        },
    );
    app_config.mcp_servers_global.approval = erato::config::McpToolApprovalConfig {
        enabled: true,
        preset: erato::config::McpToolApprovalPreset::Restrictive,
        allow_always: false,
    };
    let app_state = test_app_state(app_config, pool).await;
    get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let db = app_state.db.clone();
    let server = app_server(app_state);

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": "publish the approval probe" }))
        .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    let chat_id = Uuid::parse_str(&extract_chat_id(&events).expect("Expected chat_id")).unwrap();
    let assistant_message_id = assistant_message_id_from_events(&events);

    archive_chat_via_api(&server, &chat_id.to_string()).await;

    let continued = server
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "message_id": assistant_message_id,
            "decision": "approve",
        }))
        .await;

    assert_eq!(continued.status_code(), http::StatusCode::CONFLICT);
    assert_eq!(
        chats::Entity::find_by_id(chat_id)
            .one(&db)
            .await
            .unwrap()
            .unwrap()
            .generation_state
            .as_deref(),
        Some("awaiting_approval")
    );
}

/// A run that dies before it owns an assistant message to attach an error to
/// still terminates every listener: the task lifecycle broadcasts the generic
/// failure frame, closes with a single stream end, and marks the lease errored.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_failed_generation_broadcasts_a_failure_frame_then_stream_end(pool: Pool<Postgres>) {
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;
    get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let db = app_state.db.clone();
    let server = app_server(app_state);

    let first = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": "a message in another chat" }))
        .await;
    first.assert_status_ok();
    let foreign_message_id = assistant_message_id_from_events(&parse_sse_events(&first));

    let created = server
        .post("/api/v1beta/me/chats")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({}))
        .await;
    created.assert_status_ok();
    let chat_id = Uuid::parse_str(created.json::<Value>()["chat_id"].as_str().unwrap()).unwrap();

    // Threading a turn off another chat's message: saving the user message
    // fails, so the run never reaches an assistant message of its own.
    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "existing_chat_id": chat_id,
            "previous_message_id": foreign_message_id,
            "user_message": "threaded across chats",
        }))
        .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);

    let frames: Vec<Value> = events
        .iter()
        .filter_map(|event| serde_json::from_str::<Value>(&event.data).ok())
        .collect();
    let message_types: Vec<&str> = frames
        .iter()
        .filter_map(|frame| frame["message_type"].as_str())
        .collect();
    assert_eq!(message_types, vec!["error", "stream_end"]);
    assert_eq!(frames[0]["error_type"], "internal_error");
    assert_eq!(
        frames[0]["error_description"],
        "The message could not be generated."
    );

    assert_eq!(
        chats::Entity::find_by_id(chat_id)
            .one(&db)
            .await
            .unwrap()
            .unwrap()
            .generation_state
            .as_deref(),
        Some("errored")
    );
}

// ---------------------------------------------------------------------------
// Per-chat write toggle: with writes off, only tools the server marks
// read-only are offered, client actions are withheld, and a parked write
// tool is refused on continuation.
// ---------------------------------------------------------------------------

/// Sets the chat's write toggle through `PUT /me/chats/{chat_id}`.
async fn put_chat_write_tools(server: &TestServer, chat_id: &str, enabled: bool) {
    let response = server
        .put(&format!("/api/v1beta/me/chats/{chat_id}"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "mcp_write_tools_enabled": enabled }))
        .await;
    response.assert_status_ok();
    let body: Value = response.json();
    assert_eq!(body["mcp_write_tools_enabled"], enabled);
}

/// Reads the chat's write toggle back from `GET /me/chats/{chat_id}`.
async fn chat_write_tools(server: &TestServer, chat_id: &str) -> bool {
    let response = server
        .get(&format!("/api/v1beta/me/chats/{chat_id}"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    response.assert_status_ok();
    let body: Value = response.json();
    body["mcp_write_tools_enabled"]
        .as_bool()
        .expect("chat detail carries the write toggle")
}

/// Turning writes off drops every MCP tool the server does not mark
/// read-only and keeps the read-only ones; turning them back on restores the
/// full set.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_writes_off_offers_only_server_declared_read_only_mcp_tools(pool: Pool<Postgres>) {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    {
        let recorder = recorder.clone();
        mocks.mock(move |when, then| {
            when.post().path("/v1/chat/completions").matcher(recorder);
            mock_llm_sse_response(
                then,
                build_openai_text_streaming_response(&["WRITE-TOGGLE-ANSWER"]),
            );
        });
    }

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.mcp_servers.insert(
        "mock_mcp_approval".to_string(),
        mcp_server_config(
            &mock_mcp_base_url(),
            "/mcp/approval-policy",
            McpServerAuthenticationConfig::None,
        ),
    );
    app_config.mcp_servers.insert(
        "files".to_string(),
        mcp_server_config(
            &mock_mcp_base_url(),
            "/mcp/file",
            McpServerAuthenticationConfig::None,
        ),
    );
    app_config.mcp_server_permissions.rules.insert(
        "allow-both".to_string(),
        erato::config::McpServerPermissionRule::AllowAll {
            mcp_server_ids: vec!["mock_mcp_approval".to_string(), "files".to_string()],
        },
    );
    app_config.mcp_servers_global.approval = erato::config::McpToolApprovalConfig {
        enabled: false,
        allow_always: false,
        ..Default::default()
    };
    let app_state = test_app_state(app_config, pool).await;
    get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let server = app_server(app_state);

    let chat = server
        .post("/api/v1beta/me/chats")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({}))
        .await;
    chat.assert_status_ok();
    let chat_id = chat.json::<Value>()["chat_id"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(
        chat_write_tools(&server, &chat_id).await,
        "writes default on"
    );

    let submit = |message: &'static str| {
        let server = &server;
        let chat_id = chat_id.clone();
        async move {
            let response = server
                .post("/api/v1beta/me/messages/submitstream")
                .with_bearer_token(TEST_JWT_TOKEN)
                .json(&json!({ "existing_chat_id": chat_id, "user_message": message }))
                .await;
            response.assert_status_ok();
            let events = parse_sse_events(&response);
            assert_eq!(extract_full_text(&events), "WRITE-TOGGLE-ANSWER");
        }
    };

    submit("with writes on").await;
    put_chat_write_tools(&server, &chat_id, false).await;
    assert!(!chat_write_tools(&server, &chat_id).await);
    submit("with writes off").await;
    put_chat_write_tools(&server, &chat_id, true).await;
    submit("with writes back on").await;

    let mut offers = recorded_tool_offers(&recorder.bodies());
    assert_eq!(offers.len(), 3, "{offers:?}");
    for offered in offers.iter_mut() {
        offered.sort();
    }
    let full_set = vec![
        "list_files",
        "publish_approval_probe",
        "read_approval_fixture",
        "read_file",
    ];
    assert_eq!(offers[0], full_set, "writes on offers every tool");
    assert_eq!(
        offers[1],
        vec!["list_files", "read_approval_fixture", "read_file"],
        "writes off keeps only tools the server marks read-only"
    );
    assert_eq!(offers[2], full_set, "writes back on restores the full set");
}

/// With writes off the client-action tool is withheld even though the action
/// facet declares client actions, while top-level client tools — read-only by
/// contract — stay offered.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_writes_off_withholds_client_actions_but_keeps_client_tools(pool: Pool<Postgres>) {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    {
        let recorder = recorder.clone();
        mocks.mock(move |when, then| {
            when.post().path("/v1/chat/completions").matcher(recorder);
            mock_llm_sse_response(
                then,
                build_openai_text_streaming_response(&["CLIENT-CHANNELS-ANSWER"]),
            );
        });
    }

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    add_action_facets(&mut app_config);
    app_config.client_tools.tools.insert(
        "probe".to_string(),
        ClientToolConfig {
            name: "probe_client_tool".to_string(),
            namespace: None,
            description: "A probe client tool".to_string(),
            parameters: r#"{"type":"object","properties":{}}"#.to_string(),
            timeout_ms: None,
        },
    );
    app_config.facets.tool_call_allowlist = vec!["client/*".to_string()];
    let app_state = test_app_state(app_config, pool).await;
    get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let server = app_server(app_state);

    let submit_under_reply = |write_tools_enabled: bool| {
        let server = &server;
        async move {
            let response = server
                .post("/api/v1beta/me/messages/submitstream")
                .with_bearer_token(TEST_JWT_TOKEN)
                .json(&json!({
                    "user_message": "Reply to this email",
                    "action_facet": { "id": "reply", "args": { "body_format": "text" } },
                    "mcp_write_tools_enabled": write_tools_enabled,
                }))
                .await;
            response.assert_status_ok();
            let events = parse_sse_events(&response);
            assert_eq!(extract_full_text(&events), "CLIENT-CHANNELS-ANSWER");
        }
    };

    submit_under_reply(true).await;
    submit_under_reply(false).await;

    let mut offers = recorded_tool_offers(&recorder.bodies());
    assert_eq!(offers.len(), 2, "{offers:?}");
    for offered in offers.iter_mut() {
        offered.sort();
    }
    assert_eq!(
        offers[0],
        vec!["probe_client_tool", CLIENT_ACTION_TOOL],
        "writes on offers the action facet's client actions"
    );
    assert_eq!(
        offers[1],
        vec!["probe_client_tool"],
        "writes off withholds the client-action tool but keeps client tools"
    );
}

/// The submit request seeds the write toggle of the chat it creates and is
/// ignored for an existing chat, whose toggle belongs to `PUT`.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_submitstream_seeds_the_write_toggle_only_for_a_new_chat(pool: Pool<Postgres>) {
    let (app_config, _llm) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;
    get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let server = app_server(app_state);

    let seeded = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": "start quiet", "mcp_write_tools_enabled": false }))
        .await;
    seeded.assert_status_ok();
    let seeded_chat_id = extract_chat_id(&parse_sse_events(&seeded)).expect("chat_id");
    assert!(
        !chat_write_tools(&server, &seeded_chat_id).await,
        "a new chat takes the toggle from the submit request"
    );

    let unseeded = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": "start default" }))
        .await;
    unseeded.assert_status_ok();
    let unseeded_chat_id = extract_chat_id(&parse_sse_events(&unseeded)).expect("chat_id");
    assert!(
        chat_write_tools(&server, &unseeded_chat_id).await,
        "an omitted toggle leaves writes on"
    );

    let ignored = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "existing_chat_id": unseeded_chat_id,
            "user_message": "try to turn writes off on the way in",
            "mcp_write_tools_enabled": false,
        }))
        .await;
    ignored.assert_status_ok();
    assert!(
        chat_write_tools(&server, &unseeded_chat_id).await,
        "the submit request never changes an existing chat's toggle"
    );

    let recent = server
        .get("/api/v1beta/me/recent_chats")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    recent.assert_status_ok();
    let recent: Value = recent.json();
    let toggle_of = |chat_id: &str| {
        recent["chats"]
            .as_array()
            .unwrap()
            .iter()
            .find(|chat| chat["id"] == chat_id)
            .expect("chat listed")["mcp_write_tools_enabled"]
            .as_bool()
            .unwrap()
    };
    assert!(!toggle_of(&seeded_chat_id));
    assert!(toggle_of(&unseeded_chat_id));
}

/// A chat that turns writes off while an approval card is waiting refuses the
/// approved write tool: the continued turn does not execute it, records a
/// refusal in its place, offers only read-only tools, and completes cleanly.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_continuestream_refuses_a_write_tool_after_the_chat_turns_writes_off(
    pool: Pool<Postgres>,
) {
    const TOOL_RESULT: &str = "approval probe published";
    const REFUSAL: &str = "Write operations are turned off for this chat";
    let continuation_recorder = RequestBodyRecorder::new();

    let mut mocks = MockSet::new();
    {
        let recorder = continuation_recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&[REFUSAL], &[]))
                .matcher(recorder);
            mock_llm_sse_response(
                then,
                build_openai_text_streaming_response(&["WRITES-OFF-AFTER-PARK-ANSWER"]),
            );
        });
    }
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[], &[REFUSAL]));
        mock_llm_sse_response(
            then,
            build_openai_tool_calls_streaming_response(&[(
                "call_probe",
                "publish_approval_probe",
                json!({}),
            )]),
        );
    });

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.mcp_servers.insert(
        "mock_mcp_approval".to_string(),
        mcp_server_config(
            &mock_mcp_base_url(),
            "/mcp/approval-policy",
            McpServerAuthenticationConfig::None,
        ),
    );
    app_config.mcp_server_permissions.rules.insert(
        "allow-mock-mcp".to_string(),
        erato::config::McpServerPermissionRule::AllowAll {
            mcp_server_ids: vec!["mock_mcp_approval".to_string()],
        },
    );
    app_config.mcp_servers_global.approval = erato::config::McpToolApprovalConfig {
        enabled: true,
        preset: erato::config::McpToolApprovalPreset::Restrictive,
        allow_always: false,
    };
    let app_state = test_app_state(app_config, pool).await;
    get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let db = app_state.db.clone();
    let server = app_server(app_state);

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": "publish the approval probe" }))
        .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    let chat_id = extract_chat_id(&events).expect("Expected chat_id");
    let assistant_message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();
    assert_eq!(
        chats::Entity::find_by_id(Uuid::parse_str(&chat_id).unwrap())
            .one(&db)
            .await
            .unwrap()
            .unwrap()
            .generation_state
            .as_deref(),
        Some("awaiting_approval")
    );

    // Writes go off while the card is still waiting.
    put_chat_write_tools(&server, &chat_id, false).await;

    let continued = server
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "message_id": assistant_message_id,
            "decision": "approve",
        }))
        .await;
    continued.assert_status_ok();
    let continued_events = parse_sse_events(&continued);
    assert_eq!(
        extract_full_text(&continued_events),
        "WRITES-OFF-AFTER-PARK-ANSWER"
    );

    let continuation_bodies = continuation_recorder.bodies();
    assert_eq!(continuation_bodies.len(), 1);
    assert!(
        !continuation_bodies[0].contains(TOOL_RESULT),
        "a write tool must not be executed once the chat turned writes off"
    );
    let offers = recorded_tool_offers(&continuation_bodies);
    assert_eq!(offers.len(), 1);
    assert_eq!(
        offers[0],
        vec!["read_approval_fixture"],
        "the continued turn is offered only tools the server marks read-only"
    );

    let resumed = erato::db::entity::messages::Entity::find_by_id(assistant_message_id)
        .one(&db)
        .await
        .unwrap()
        .expect("Expected the resumed assistant message");
    let resumed_content = resumed.raw_message["content"].as_array().unwrap().clone();
    let content_types: Vec<&str> = resumed_content
        .iter()
        .map(|part| part["content_type"].as_str().unwrap())
        .collect();
    assert_eq!(
        content_types,
        vec!["tool_approval_request", "tool_approval", "tool_use", "text"]
    );
    assert_eq!(resumed_content[2]["status"], "error");
    assert_eq!(resumed_content[2]["output"]["status"], "rejected");
    assert!(
        resumed_content[2]["output"]["error"]
            .as_str()
            .unwrap()
            .contains(REFUSAL)
    );
    assert_eq!(
        chats::Entity::find_by_id(Uuid::parse_str(&chat_id).unwrap())
            .one(&db)
            .await
            .unwrap()
            .unwrap()
            .generation_state
            .as_deref(),
        Some("completed")
    );
}

// ---------------------------------------------------------------------------
// Per-chat server disable: a server the user switched off for the chat
// loses every tool, the other servers keep theirs, the generation records the
// servers it withheld, and a parked tool of a server disabled meanwhile is
// refused on continuation.
// ---------------------------------------------------------------------------

/// Replaces the chat's disabled server list through `PUT /me/chats/{chat_id}`.
async fn put_chat_disabled_servers(server: &TestServer, chat_id: &str, server_ids: &[&str]) {
    let response = server
        .put(&format!("/api/v1beta/me/chats/{chat_id}"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "disabled_mcp_server_ids": server_ids }))
        .await;
    response.assert_status_ok();
    let body: Value = response.json();
    assert_eq!(body["disabled_mcp_server_ids"], json!(server_ids));
}

/// Reads the chat's disabled server list back from `GET /me/chats/{chat_id}`.
async fn chat_disabled_servers(server: &TestServer, chat_id: &str) -> Value {
    let response = server
        .get(&format!("/api/v1beta/me/chats/{chat_id}"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    response.assert_status_ok();
    let body: Value = response.json();
    body["disabled_mcp_server_ids"].clone()
}

/// The `assistant_message_completed` event of a streamed submit.
fn assistant_completed_event(events: &[crate::test_utils::Event]) -> Value {
    events
        .iter()
        .find_map(|event| {
            let json: Value = serde_json::from_str(&event.data).ok()?;
            (json["message_type"] == "assistant_message_completed").then_some(json)
        })
        .expect("Expected assistant_message_completed event")
}

/// Switching a server off for the chat drops every one of its tools while
/// the other server keeps its full set; the withheld server is recorded on
/// the completed message, in the persisted metadata and on the message
/// listing; an id outside the chat's scope changes nothing and is not
/// reported; clearing the list restores the full set.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_disabled_mcp_server_loses_its_tools_and_is_reported(pool: Pool<Postgres>) {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    {
        let recorder = recorder.clone();
        mocks.mock(move |when, then| {
            when.post().path("/v1/chat/completions").matcher(recorder);
            mock_llm_sse_response(
                then,
                build_openai_text_streaming_response(&["SERVER-DISABLE-ANSWER"]),
            );
        });
    }

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.mcp_servers.insert(
        "mock_mcp_approval".to_string(),
        mcp_server_config(
            &mock_mcp_base_url(),
            "/mcp/approval-policy",
            McpServerAuthenticationConfig::None,
        ),
    );
    app_config.mcp_servers.insert(
        "files".to_string(),
        mcp_server_config(
            &mock_mcp_base_url(),
            "/mcp/file",
            McpServerAuthenticationConfig::None,
        ),
    );
    app_config.mcp_server_permissions.rules.insert(
        "allow-both".to_string(),
        erato::config::McpServerPermissionRule::AllowAll {
            mcp_server_ids: vec!["mock_mcp_approval".to_string(), "files".to_string()],
        },
    );
    app_config.mcp_servers_global.approval = erato::config::McpToolApprovalConfig {
        enabled: false,
        allow_always: false,
        ..Default::default()
    };
    let app_state = test_app_state(app_config, pool).await;
    get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let db = app_state.db.clone();
    let server = app_server(app_state);

    let chat = server
        .post("/api/v1beta/me/chats")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({}))
        .await;
    chat.assert_status_ok();
    let chat_id = chat.json::<Value>()["chat_id"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(chat_disabled_servers(&server, &chat_id).await, json!([]));

    let submit = |message: &'static str| {
        let server = &server;
        let chat_id = chat_id.clone();
        async move {
            let response = server
                .post("/api/v1beta/me/messages/submitstream")
                .with_bearer_token(TEST_JWT_TOKEN)
                .json(&json!({ "existing_chat_id": chat_id, "user_message": message }))
                .await;
            response.assert_status_ok();
            let events = parse_sse_events(&response);
            assert_eq!(extract_full_text(&events), "SERVER-DISABLE-ANSWER");
            assistant_completed_event(&events)
        }
    };

    let all_on = submit("with every server on").await;
    put_chat_disabled_servers(&server, &chat_id, &["files"]).await;
    let files_off = submit("with the files server off").await;
    put_chat_disabled_servers(&server, &chat_id, &["not-a-configured-server"]).await;
    let unknown_off = submit("with an unknown server off").await;
    put_chat_disabled_servers(&server, &chat_id, &[]).await;
    let back_on = submit("with the files server back on").await;

    let mut offers = recorded_tool_offers(&recorder.bodies());
    assert_eq!(offers.len(), 4, "{offers:?}");
    for offered in offers.iter_mut() {
        offered.sort();
    }
    let full_set = vec![
        "list_files",
        "publish_approval_probe",
        "read_approval_fixture",
        "read_file",
    ];
    assert_eq!(offers[0], full_set, "every server on offers every tool");
    assert_eq!(
        offers[1],
        vec!["publish_approval_probe", "read_approval_fixture"],
        "the disabled server loses every tool and the other keeps its own"
    );
    assert_eq!(
        offers[2], full_set,
        "an id outside the chat's scope is a no-op"
    );
    assert_eq!(
        offers[3], full_set,
        "clearing the list restores the full set"
    );

    assert_eq!(
        all_on["message"]["mcp_servers_disabled_by_user"],
        Value::Null
    );
    assert_eq!(
        files_off["message"]["mcp_servers_disabled_by_user"],
        json!(["files"])
    );
    assert_eq!(
        unknown_off["message"]["mcp_servers_disabled_by_user"],
        Value::Null,
        "only servers this generation would have consulted are reported"
    );
    assert_eq!(
        back_on["message"]["mcp_servers_disabled_by_user"],
        Value::Null
    );

    let files_off_message_id = Uuid::parse_str(files_off["message_id"].as_str().unwrap()).unwrap();
    let saved = erato::db::entity::messages::Entity::find_by_id(files_off_message_id)
        .one(&db)
        .await
        .unwrap()
        .expect("Expected the saved assistant message");
    assert_eq!(
        saved
            .generation_metadata
            .expect("Expected generation metadata")["mcp_servers_disabled_by_user"],
        json!(["files"])
    );

    let listing = server
        .get(&format!("/api/v1beta/chats/{chat_id}/messages"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    listing.assert_status_ok();
    let listing: Value = listing.json();
    let listed = listing["messages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|message| message["id"] == files_off_message_id.to_string())
        .expect("Expected the assistant message in the listing");
    assert_eq!(listed["mcp_servers_disabled_by_user"], json!(["files"]));
}

/// MCP wins a name clash with a client tool. Switching the MCP tool's server
/// off removes the tool from the offer without promoting the same-named
/// client tool it shadowed.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_disabled_mcp_server_does_not_promote_a_same_named_client_tool(pool: Pool<Postgres>) {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    {
        let recorder = recorder.clone();
        mocks.mock(move |when, then| {
            when.post().path("/v1/chat/completions").matcher(recorder);
            mock_llm_sse_response(
                then,
                build_openai_text_streaming_response(&["SERVER-COLLISION-ANSWER"]),
            );
        });
    }

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.mcp_servers.insert(
        "files".to_string(),
        mcp_server_config(
            &mock_mcp_base_url(),
            "/mcp/file",
            McpServerAuthenticationConfig::None,
        ),
    );
    app_config.mcp_server_permissions.rules.insert(
        "allow-files".to_string(),
        erato::config::McpServerPermissionRule::AllowAll {
            mcp_server_ids: vec!["files".to_string()],
        },
    );
    // A client tool with the MCP tool's model-facing name, globally
    // allowlisted; no facets, so the MCP side stays unfiltered.
    app_config.client_tools.tools.insert(
        "outlook_read_file".to_string(),
        ClientToolConfig {
            name: "read_file".to_string(),
            namespace: Some("outlook".to_string()),
            description: "Reads a file from the mailbox".to_string(),
            parameters: r#"{"type":"object","properties":{}}"#.to_string(),
            timeout_ms: None,
        },
    );
    app_config.facets.tool_call_allowlist = vec!["outlook/read_file".to_string()];
    let app_state = test_app_state(app_config, pool).await;
    get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let server = app_server(app_state);

    let before = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": "read the file" }))
        .await;
    before.assert_status_ok();
    let chat_id = extract_chat_id(&parse_sse_events(&before)).expect("chat_id");
    let before_offers = recorded_tool_offers(&recorder.bodies());
    assert_eq!(before_offers.len(), 1);
    let before_offered = &before_offers[0];
    assert_eq!(
        before_offered
            .iter()
            .filter(|name| *name == "read_file")
            .count(),
        1,
        "the MCP tool shadows the client tool: {before_offered:?}"
    );
    assert!(before_offered.iter().any(|name| name == "list_files"));

    put_chat_disabled_servers(&server, &chat_id, &["files"]).await;

    let after = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "existing_chat_id": chat_id, "user_message": "read the file again" }))
        .await;
    after.assert_status_ok();
    // Only the first submit offered tools: the title requests carry none, and
    // neither does the second submit.
    let offers = recorded_tool_offers(&recorder.bodies());
    assert_eq!(
        offers.len(),
        1,
        "switching the only server off must not promote the client tool it shadowed: {offers:?}"
    );
}

/// The submit request seeds the disabled server list of the chat it creates
/// and is ignored for an existing chat, whose list belongs to `PUT`.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_submitstream_seeds_disabled_servers_only_for_a_new_chat(pool: Pool<Postgres>) {
    let (app_config, _llm) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;
    get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let server = app_server(app_state);

    let seeded = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "user_message": "start narrow",
            "disabled_mcp_server_ids": ["files", "files", "crm"],
        }))
        .await;
    seeded.assert_status_ok();
    let seeded_chat_id = extract_chat_id(&parse_sse_events(&seeded)).expect("chat_id");
    assert_eq!(
        chat_disabled_servers(&server, &seeded_chat_id).await,
        json!(["files", "crm"]),
        "a new chat takes the list from the submit request, without repeats"
    );

    let unseeded = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": "start default" }))
        .await;
    unseeded.assert_status_ok();
    let unseeded_chat_id = extract_chat_id(&parse_sse_events(&unseeded)).expect("chat_id");
    assert_eq!(
        chat_disabled_servers(&server, &unseeded_chat_id).await,
        json!([]),
        "an omitted list leaves every server on"
    );

    let ignored = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "existing_chat_id": unseeded_chat_id,
            "user_message": "try to switch a server off on the way in",
            "disabled_mcp_server_ids": ["files"],
        }))
        .await;
    ignored.assert_status_ok();
    assert_eq!(
        chat_disabled_servers(&server, &unseeded_chat_id).await,
        json!([]),
        "the submit request never changes an existing chat's list"
    );

    let recent = server
        .get("/api/v1beta/me/recent_chats")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    recent.assert_status_ok();
    let recent: Value = recent.json();
    let list_of = |chat_id: &str| {
        recent["chats"]
            .as_array()
            .unwrap()
            .iter()
            .find(|chat| chat["id"] == chat_id)
            .expect("chat listed")["disabled_mcp_server_ids"]
            .clone()
    };
    assert_eq!(list_of(&seeded_chat_id), json!(["files", "crm"]));
    assert_eq!(list_of(&unseeded_chat_id), json!([]));
}

/// A chat that switches a server off while an approval card is waiting
/// refuses the approved tool of that server: the continued turn does not
/// execute it, records a refusal in its place, offers only the other server's
/// tools, and completes cleanly.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_continuestream_refuses_a_tool_of_a_server_disabled_after_the_park(
    pool: Pool<Postgres>,
) {
    const TOOL_RESULT: &str = "approval probe published";
    const REFUSAL: &str = "The user has turned off the server 'mock_mcp_approval' for this chat";
    let continuation_recorder = RequestBodyRecorder::new();

    let mut mocks = MockSet::new();
    {
        let recorder = continuation_recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&[REFUSAL], &[]))
                .matcher(recorder);
            mock_llm_sse_response(
                then,
                build_openai_text_streaming_response(&["SERVER-OFF-AFTER-PARK-ANSWER"]),
            );
        });
    }
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[], &[REFUSAL]));
        mock_llm_sse_response(
            then,
            build_openai_tool_calls_streaming_response(&[(
                "call_probe",
                "publish_approval_probe",
                json!({}),
            )]),
        );
    });

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.mcp_servers.insert(
        "mock_mcp_approval".to_string(),
        mcp_server_config(
            &mock_mcp_base_url(),
            "/mcp/approval-policy",
            McpServerAuthenticationConfig::None,
        ),
    );
    app_config.mcp_servers.insert(
        "files".to_string(),
        mcp_server_config(
            &mock_mcp_base_url(),
            "/mcp/file",
            McpServerAuthenticationConfig::None,
        ),
    );
    app_config.mcp_server_permissions.rules.insert(
        "allow-both".to_string(),
        erato::config::McpServerPermissionRule::AllowAll {
            mcp_server_ids: vec!["mock_mcp_approval".to_string(), "files".to_string()],
        },
    );
    app_config.mcp_servers_global.approval = erato::config::McpToolApprovalConfig {
        enabled: true,
        preset: erato::config::McpToolApprovalPreset::Restrictive,
        allow_always: false,
    };
    let app_state = test_app_state(app_config, pool).await;
    get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let db = app_state.db.clone();
    let server = app_server(app_state);

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": "publish the approval probe" }))
        .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    let chat_id = extract_chat_id(&events).expect("Expected chat_id");
    let assistant_message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();
    assert_eq!(
        chats::Entity::find_by_id(Uuid::parse_str(&chat_id).unwrap())
            .one(&db)
            .await
            .unwrap()
            .unwrap()
            .generation_state
            .as_deref(),
        Some("awaiting_approval")
    );

    // The server goes off while the card is still waiting.
    put_chat_disabled_servers(&server, &chat_id, &["mock_mcp_approval"]).await;

    let continued = server
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "message_id": assistant_message_id,
            "decision": "approve",
        }))
        .await;
    continued.assert_status_ok();
    let continued_events = parse_sse_events(&continued);
    assert_eq!(
        extract_full_text(&continued_events),
        "SERVER-OFF-AFTER-PARK-ANSWER"
    );

    let continuation_bodies = continuation_recorder.bodies();
    assert_eq!(continuation_bodies.len(), 1);
    assert!(
        !continuation_bodies[0].contains(TOOL_RESULT),
        "a tool of a server switched off meanwhile must not be executed"
    );
    let mut offers = recorded_tool_offers(&continuation_bodies);
    assert_eq!(offers.len(), 1);
    offers[0].sort();
    assert_eq!(
        offers[0],
        vec!["list_files", "read_file"],
        "the continued turn is offered only the other server's tools"
    );

    let resumed = erato::db::entity::messages::Entity::find_by_id(assistant_message_id)
        .one(&db)
        .await
        .unwrap()
        .expect("Expected the resumed assistant message");
    assert_eq!(
        resumed
            .generation_metadata
            .as_ref()
            .expect("Expected generation metadata")["mcp_servers_disabled_by_user"],
        json!(["mock_mcp_approval"]),
        "the continued turn records the server it withheld"
    );
    let resumed_content = resumed.raw_message["content"].as_array().unwrap().clone();
    let content_types: Vec<&str> = resumed_content
        .iter()
        .map(|part| part["content_type"].as_str().unwrap())
        .collect();
    assert_eq!(
        content_types,
        vec!["tool_approval_request", "tool_approval", "tool_use", "text"]
    );
    assert_eq!(resumed_content[2]["status"], "error");
    assert_eq!(resumed_content[2]["output"]["status"], "rejected");
    assert!(
        resumed_content[2]["output"]["error"]
            .as_str()
            .unwrap()
            .contains(REFUSAL)
    );
    assert_eq!(
        chats::Entity::find_by_id(Uuid::parse_str(&chat_id).unwrap())
            .one(&db)
            .await
            .unwrap()
            .unwrap()
            .generation_state
            .as_deref(),
        Some("completed")
    );
}

// ---------------------------------------------------------------------------
// Per-chat tool disable: a `server/tool` pattern the user stored for the chat
// removes just that tool, the generation records the tools it withheld, a
// pattern for a tool the server no longer exposes is a silent no-op, and a
// parked tool disabled meanwhile is refused on continuation.
// ---------------------------------------------------------------------------

/// Replaces the chat's disabled tool list through `PUT /me/chats/{chat_id}`.
async fn put_chat_disabled_tools(server: &TestServer, chat_id: &str, patterns: &[&str]) {
    let response = server
        .put(&format!("/api/v1beta/me/chats/{chat_id}"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "disabled_mcp_tools": patterns }))
        .await;
    response.assert_status_ok();
    let body: Value = response.json();
    assert_eq!(body["disabled_mcp_tools"], json!(patterns));
}

/// Reads the chat's disabled tool list back from `GET /me/chats/{chat_id}`.
async fn chat_disabled_tools(server: &TestServer, chat_id: &str) -> Value {
    let response = server
        .get(&format!("/api/v1beta/me/chats/{chat_id}"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    response.assert_status_ok();
    let body: Value = response.json();
    body["disabled_mcp_tools"].clone()
}

/// Switching one tool off for the chat drops that tool alone while its server
/// keeps its other tools; the withheld tool is recorded on the completed
/// message, in the persisted metadata and on the message listing; a pattern
/// for a tool the server does not expose changes nothing and is not
/// reported; a tool of a server switched off as a whole is reported under the
/// server, not again as a tool; clearing the list restores the full set.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_disabled_mcp_tool_is_withheld_and_reported(pool: Pool<Postgres>) {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    {
        let recorder = recorder.clone();
        mocks.mock(move |when, then| {
            when.post().path("/v1/chat/completions").matcher(recorder);
            mock_llm_sse_response(
                then,
                build_openai_text_streaming_response(&["TOOL-DISABLE-ANSWER"]),
            );
        });
    }

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.mcp_servers.insert(
        "mock_mcp_approval".to_string(),
        mcp_server_config(
            &mock_mcp_base_url(),
            "/mcp/approval-policy",
            McpServerAuthenticationConfig::None,
        ),
    );
    app_config.mcp_servers.insert(
        "files".to_string(),
        mcp_server_config(
            &mock_mcp_base_url(),
            "/mcp/file",
            McpServerAuthenticationConfig::None,
        ),
    );
    app_config.mcp_server_permissions.rules.insert(
        "allow-both".to_string(),
        erato::config::McpServerPermissionRule::AllowAll {
            mcp_server_ids: vec!["mock_mcp_approval".to_string(), "files".to_string()],
        },
    );
    app_config.mcp_servers_global.approval = erato::config::McpToolApprovalConfig {
        enabled: false,
        allow_always: false,
        ..Default::default()
    };
    let app_state = test_app_state(app_config, pool).await;
    get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let db = app_state.db.clone();
    let server = app_server(app_state);

    let chat = server
        .post("/api/v1beta/me/chats")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({}))
        .await;
    chat.assert_status_ok();
    let chat_id = chat.json::<Value>()["chat_id"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(chat_disabled_tools(&server, &chat_id).await, json!([]));

    let submit = |message: &'static str| {
        let server = &server;
        let chat_id = chat_id.clone();
        async move {
            let response = server
                .post("/api/v1beta/me/messages/submitstream")
                .with_bearer_token(TEST_JWT_TOKEN)
                .json(&json!({ "existing_chat_id": chat_id, "user_message": message }))
                .await;
            response.assert_status_ok();
            let events = parse_sse_events(&response);
            assert_eq!(extract_full_text(&events), "TOOL-DISABLE-ANSWER");
            assistant_completed_event(&events)
        }
    };

    let all_on = submit("with every tool on").await;
    put_chat_disabled_tools(&server, &chat_id, &["files/read_file"]).await;
    let tool_off = submit("with read_file off").await;
    put_chat_disabled_tools(&server, &chat_id, &["files/no_such_tool"]).await;
    let drifted = submit("with a tool the server no longer exposes off").await;
    put_chat_disabled_tools(&server, &chat_id, &["files/read_file"]).await;
    put_chat_disabled_servers(&server, &chat_id, &["files"]).await;
    let server_off_too = submit("with the whole files server off as well").await;
    put_chat_disabled_servers(&server, &chat_id, &[]).await;
    put_chat_disabled_tools(&server, &chat_id, &[]).await;
    let back_on = submit("with everything back on").await;

    let mut offers = recorded_tool_offers(&recorder.bodies());
    assert_eq!(offers.len(), 5, "{offers:?}");
    for offered in offers.iter_mut() {
        offered.sort();
    }
    let full_set = vec![
        "list_files",
        "publish_approval_probe",
        "read_approval_fixture",
        "read_file",
    ];
    assert_eq!(offers[0], full_set, "every tool on offers every tool");
    assert_eq!(
        offers[1],
        vec![
            "list_files",
            "publish_approval_probe",
            "read_approval_fixture"
        ],
        "the disabled tool goes and its server keeps its other tool"
    );
    assert_eq!(
        offers[2], full_set,
        "a pattern for a tool the server does not expose is a no-op"
    );
    assert_eq!(
        offers[3],
        vec!["publish_approval_probe", "read_approval_fixture"],
        "the server-level disable takes the whole server"
    );
    assert_eq!(
        offers[4], full_set,
        "clearing both lists restores the full set"
    );

    assert_eq!(all_on["message"]["mcp_tools_disabled_by_user"], Value::Null);
    assert_eq!(
        tool_off["message"]["mcp_tools_disabled_by_user"],
        json!(["files/read_file"])
    );
    assert_eq!(
        tool_off["message"]["mcp_servers_disabled_by_user"],
        Value::Null
    );
    assert_eq!(
        drifted["message"]["mcp_tools_disabled_by_user"],
        Value::Null,
        "only tools actually withheld are reported"
    );
    assert_eq!(
        server_off_too["message"]["mcp_servers_disabled_by_user"],
        json!(["files"])
    );
    assert_eq!(
        server_off_too["message"]["mcp_tools_disabled_by_user"],
        Value::Null,
        "a tool of a server switched off is reported under the server only"
    );
    assert_eq!(
        back_on["message"]["mcp_tools_disabled_by_user"],
        Value::Null
    );

    let tool_off_message_id = Uuid::parse_str(tool_off["message_id"].as_str().unwrap()).unwrap();
    let saved = erato::db::entity::messages::Entity::find_by_id(tool_off_message_id)
        .one(&db)
        .await
        .unwrap()
        .expect("Expected the saved assistant message");
    assert_eq!(
        saved
            .generation_metadata
            .expect("Expected generation metadata")["mcp_tools_disabled_by_user"],
        json!(["files/read_file"])
    );

    let listing = server
        .get(&format!("/api/v1beta/chats/{chat_id}/messages"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    listing.assert_status_ok();
    let listing: Value = listing.json();
    let listed = listing["messages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|message| message["id"] == tool_off_message_id.to_string())
        .expect("Expected the assistant message in the listing");
    assert_eq!(
        listed["mcp_tools_disabled_by_user"],
        json!(["files/read_file"])
    );
}

/// MCP wins a name clash with a client tool. Switching the MCP tool off for
/// the chat removes it from the offer without promoting the same-named client
/// tool it shadowed, while the server's other tool stays offered.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_disabled_mcp_tool_does_not_promote_a_same_named_client_tool(pool: Pool<Postgres>) {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    {
        let recorder = recorder.clone();
        mocks.mock(move |when, then| {
            when.post().path("/v1/chat/completions").matcher(recorder);
            mock_llm_sse_response(
                then,
                build_openai_text_streaming_response(&["TOOL-COLLISION-ANSWER"]),
            );
        });
    }

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.mcp_servers.insert(
        "files".to_string(),
        mcp_server_config(
            &mock_mcp_base_url(),
            "/mcp/file",
            McpServerAuthenticationConfig::None,
        ),
    );
    app_config.mcp_server_permissions.rules.insert(
        "allow-files".to_string(),
        erato::config::McpServerPermissionRule::AllowAll {
            mcp_server_ids: vec!["files".to_string()],
        },
    );
    // A client tool with the MCP tool's model-facing name, globally
    // allowlisted; no facets, so the MCP side stays unfiltered.
    app_config.client_tools.tools.insert(
        "outlook_read_file".to_string(),
        ClientToolConfig {
            name: "read_file".to_string(),
            namespace: Some("outlook".to_string()),
            description: "Reads a file from the mailbox".to_string(),
            parameters: r#"{"type":"object","properties":{}}"#.to_string(),
            timeout_ms: None,
        },
    );
    app_config.facets.tool_call_allowlist = vec!["outlook/read_file".to_string()];
    let app_state = test_app_state(app_config, pool).await;
    get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let server = app_server(app_state);

    let before = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": "read the file" }))
        .await;
    before.assert_status_ok();
    let chat_id = extract_chat_id(&parse_sse_events(&before)).expect("chat_id");
    let before_offers = recorded_tool_offers(&recorder.bodies());
    assert_eq!(before_offers.len(), 1);
    let before_offered = &before_offers[0];
    assert_eq!(
        before_offered
            .iter()
            .filter(|name| *name == "read_file")
            .count(),
        1,
        "the MCP tool shadows the client tool: {before_offered:?}"
    );
    assert!(before_offered.iter().any(|name| name == "list_files"));

    put_chat_disabled_tools(&server, &chat_id, &["files/read_file"]).await;

    let after = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "existing_chat_id": chat_id, "user_message": "read the file again" }))
        .await;
    after.assert_status_ok();
    let offers = recorded_tool_offers(&recorder.bodies());
    assert_eq!(offers.len(), 2, "{offers:?}");
    let mut after_offered = offers[1].clone();
    after_offered.sort();
    assert_eq!(
        after_offered,
        vec!["list_files"],
        "switching the MCP tool off must not promote the client tool it shadowed"
    );
}

/// The submit request seeds the disabled tool list of the chat it creates
/// and is ignored for an existing chat, whose list belongs to `PUT`.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_submitstream_seeds_disabled_tools_only_for_a_new_chat(pool: Pool<Postgres>) {
    let (app_config, _llm) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;
    get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let server = app_server(app_state);

    let seeded = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "user_message": "start picky",
            "disabled_mcp_tools": ["files/read_file", "files/read_file", "crm/*"],
        }))
        .await;
    seeded.assert_status_ok();
    let seeded_chat_id = extract_chat_id(&parse_sse_events(&seeded)).expect("chat_id");
    assert_eq!(
        chat_disabled_tools(&server, &seeded_chat_id).await,
        json!(["files/read_file", "crm/*"]),
        "a new chat takes the list from the submit request, without repeats"
    );

    let unseeded = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": "start default" }))
        .await;
    unseeded.assert_status_ok();
    let unseeded_chat_id = extract_chat_id(&parse_sse_events(&unseeded)).expect("chat_id");
    assert_eq!(
        chat_disabled_tools(&server, &unseeded_chat_id).await,
        json!([]),
        "an omitted list leaves every tool on"
    );

    let ignored = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "existing_chat_id": unseeded_chat_id,
            "user_message": "try to switch a tool off on the way in",
            "disabled_mcp_tools": ["files/read_file"],
        }))
        .await;
    ignored.assert_status_ok();
    assert_eq!(
        chat_disabled_tools(&server, &unseeded_chat_id).await,
        json!([]),
        "the submit request never changes an existing chat's list"
    );

    let recent = server
        .get("/api/v1beta/me/recent_chats")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    recent.assert_status_ok();
    let recent: Value = recent.json();
    let list_of = |chat_id: &str| {
        recent["chats"]
            .as_array()
            .unwrap()
            .iter()
            .find(|chat| chat["id"] == chat_id)
            .expect("chat listed")["disabled_mcp_tools"]
            .clone()
    };
    assert_eq!(
        list_of(&seeded_chat_id),
        json!(["files/read_file", "crm/*"])
    );
    assert_eq!(list_of(&unseeded_chat_id), json!([]));
}

/// A chat that switches a tool off while an approval card is waiting refuses
/// that approved tool: the continued turn does not execute it, records a
/// refusal in its place, still offers the server's other tool, and completes
/// cleanly.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_continuestream_refuses_a_tool_disabled_after_the_park(pool: Pool<Postgres>) {
    const TOOL_RESULT: &str = "approval probe published";
    const REFUSAL: &str = "The user has turned off the tool 'publish_approval_probe' for this chat";
    let continuation_recorder = RequestBodyRecorder::new();

    let mut mocks = MockSet::new();
    {
        let recorder = continuation_recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&[REFUSAL], &[]))
                .matcher(recorder);
            mock_llm_sse_response(
                then,
                build_openai_text_streaming_response(&["TOOL-OFF-AFTER-PARK-ANSWER"]),
            );
        });
    }
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[], &[REFUSAL]));
        mock_llm_sse_response(
            then,
            build_openai_tool_calls_streaming_response(&[(
                "call_probe",
                "publish_approval_probe",
                json!({}),
            )]),
        );
    });

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.mcp_servers.insert(
        "mock_mcp_approval".to_string(),
        mcp_server_config(
            &mock_mcp_base_url(),
            "/mcp/approval-policy",
            McpServerAuthenticationConfig::None,
        ),
    );
    app_config.mcp_servers.insert(
        "files".to_string(),
        mcp_server_config(
            &mock_mcp_base_url(),
            "/mcp/file",
            McpServerAuthenticationConfig::None,
        ),
    );
    app_config.mcp_server_permissions.rules.insert(
        "allow-both".to_string(),
        erato::config::McpServerPermissionRule::AllowAll {
            mcp_server_ids: vec!["mock_mcp_approval".to_string(), "files".to_string()],
        },
    );
    app_config.mcp_servers_global.approval = erato::config::McpToolApprovalConfig {
        enabled: true,
        preset: erato::config::McpToolApprovalPreset::Restrictive,
        allow_always: false,
    };
    let app_state = test_app_state(app_config, pool).await;
    get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let db = app_state.db.clone();
    let server = app_server(app_state);

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": "publish the approval probe" }))
        .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    let chat_id = extract_chat_id(&events).expect("Expected chat_id");
    let assistant_message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();
    assert_eq!(
        chats::Entity::find_by_id(Uuid::parse_str(&chat_id).unwrap())
            .one(&db)
            .await
            .unwrap()
            .unwrap()
            .generation_state
            .as_deref(),
        Some("awaiting_approval")
    );

    // The tool goes off while the card is still waiting.
    put_chat_disabled_tools(
        &server,
        &chat_id,
        &["mock_mcp_approval/publish_approval_probe"],
    )
    .await;

    let continued = server
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "message_id": assistant_message_id,
            "decision": "approve",
        }))
        .await;
    continued.assert_status_ok();
    let continued_events = parse_sse_events(&continued);
    assert_eq!(
        extract_full_text(&continued_events),
        "TOOL-OFF-AFTER-PARK-ANSWER"
    );

    let continuation_bodies = continuation_recorder.bodies();
    assert_eq!(continuation_bodies.len(), 1);
    assert!(
        !continuation_bodies[0].contains(TOOL_RESULT),
        "a tool switched off meanwhile must not be executed"
    );
    let mut offers = recorded_tool_offers(&continuation_bodies);
    assert_eq!(offers.len(), 1);
    offers[0].sort();
    assert_eq!(
        offers[0],
        vec!["list_files", "read_approval_fixture", "read_file"],
        "the continued turn keeps every tool but the one switched off"
    );

    let resumed = erato::db::entity::messages::Entity::find_by_id(assistant_message_id)
        .one(&db)
        .await
        .unwrap()
        .expect("Expected the resumed assistant message");
    assert_eq!(
        resumed
            .generation_metadata
            .as_ref()
            .expect("Expected generation metadata")["mcp_tools_disabled_by_user"],
        json!(["mock_mcp_approval/publish_approval_probe"]),
        "the continued turn records the tool it withheld"
    );
    let resumed_content = resumed.raw_message["content"].as_array().unwrap().clone();
    let content_types: Vec<&str> = resumed_content
        .iter()
        .map(|part| part["content_type"].as_str().unwrap())
        .collect();
    assert_eq!(
        content_types,
        vec!["tool_approval_request", "tool_approval", "tool_use", "text"]
    );
    assert_eq!(resumed_content[2]["status"], "error");
    assert_eq!(resumed_content[2]["output"]["status"], "rejected");
    assert!(
        resumed_content[2]["output"]["error"]
            .as_str()
            .unwrap()
            .contains(REFUSAL)
    );
    assert_eq!(
        chats::Entity::find_by_id(Uuid::parse_str(&chat_id).unwrap())
            .one(&db)
            .await
            .unwrap()
            .unwrap()
            .generation_state
            .as_deref(),
        Some("completed")
    );
}

// ---------------------------------------------------------------------------
// Per-user "ask" and "always allow" decisions at the approval gate.
// ---------------------------------------------------------------------------

async fn approval_policy_app_config(
    mocks: MockSet,
    approval: erato::config::McpToolApprovalConfig,
) -> (erato::config::AppConfig, MockServer) {
    let (mut app_config, llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.mcp_servers.insert(
        "mock_mcp_approval".to_string(),
        mcp_server_config(
            &mock_mcp_base_url(),
            "/mcp/approval-policy",
            McpServerAuthenticationConfig::None,
        ),
    );
    app_config.mcp_server_permissions.rules.insert(
        "allow-mock-mcp".to_string(),
        erato::config::McpServerPermissionRule::AllowAll {
            mcp_server_ids: vec!["mock_mcp_approval".to_string()],
        },
    );
    app_config.mcp_servers_global.approval = approval;
    (app_config, llm)
}

/// Mocks for a turn that calls `tool` once and then answers `answer` after
/// the tool's result reached the model.
/// `one_tool_call_then_answer` for a refused call, which never produces a
/// tool result: the second turn keys on the refusal instead.
fn one_tool_call_then_answer_after_refusal(tool: &'static str, answer: &'static str) -> MockSet {
    const REFUSAL: &str = "denied this tool call";
    let mut mocks = MockSet::new();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[REFUSAL], &[]));
        mock_llm_sse_response(then, build_openai_text_streaming_response(&[answer]));
    });
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[], &[REFUSAL]));
        mock_llm_sse_response(
            then,
            build_openai_tool_calls_streaming_response(&[("call_probe", tool, json!({}))]),
        );
    });
    mocks
}

fn one_tool_call_then_answer(
    tool: &'static str,
    tool_result: &'static str,
    answer: &'static str,
) -> MockSet {
    let mut mocks = MockSet::new();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[tool_result], &[]));
        mock_llm_sse_response(then, build_openai_text_streaming_response(&[answer]));
    });
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[], &[tool_result]));
        mock_llm_sse_response(
            then,
            build_openai_tool_calls_streaming_response(&[("call_probe", tool, json!({}))]),
        );
    });
    mocks
}

fn content_types(message: &erato::db::entity::messages::Model) -> Vec<String> {
    message.raw_message["content"]
        .as_array()
        .unwrap()
        .iter()
        .map(|part| part["content_type"].as_str().unwrap().to_string())
        .collect()
}

async fn generation_state(db: &sea_orm::DatabaseConnection, chat_id: Uuid) -> Option<String> {
    chats::Entity::find_by_id(chat_id)
        .one(db)
        .await
        .unwrap()
        .unwrap()
        .generation_state
}

/// A user's "ask" decision escalates a tool the policy would run unasked:
/// the read-only, closed-world fixture tool is auto under the permissive
/// preset, yet the turn parks on the approval card, and `continuestream`
/// with an approval runs it.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_ask_decision_parks_a_policy_auto_tool(pool: Pool<Postgres>) {
    const TOOL_RESULT: &str = "closed-world approval fixture read";
    let (app_config, _llm) = approval_policy_app_config(
        one_tool_call_then_answer("read_approval_fixture", TOOL_RESULT, "ASK-CONTINUED-ANSWER"),
        erato::config::McpToolApprovalConfig {
            enabled: true,
            preset: erato::config::McpToolApprovalPreset::Permissive,
            allow_always: false,
        },
    )
    .await;
    let app_state = test_app_state(app_config, pool).await;
    get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let db = app_state.db.clone();
    let server = app_server(app_state);

    let ask = server
        .post("/api/v1beta/me/mcp-tool-approval-settings")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "mcp_server_id": "mock_mcp_approval",
            "tool_name": "read_approval_fixture",
            "decision": "ask",
        }))
        .await;
    ask.assert_status_ok();

    let tools = server
        .get("/api/v1beta/me/mcp_servers/mock_mcp_approval/tools")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    let tools: Value = tools.json();
    assert_eq!(tools["ask_available"], true);
    let fixture = tools["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|tool| tool["name"] == "read_approval_fixture")
        .expect("fixture tool listed");
    assert_eq!(fixture["policy"], "auto");
    assert_eq!(fixture["user_decision"], "ask");
    assert_eq!(fixture["effective"], "ask");

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": "read the fixture" }))
        .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    let chat_id = Uuid::parse_str(&extract_chat_id(&events).expect("Expected chat_id")).unwrap();
    let assistant_message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();
    assert_eq!(extract_full_text(&events), "");

    let parked = erato::db::entity::messages::Entity::find_by_id(assistant_message_id)
        .one(&db)
        .await
        .unwrap()
        .expect("Expected the parked assistant message");
    assert_eq!(content_types(&parked), vec!["tool_approval_request"]);
    let approval_request = parked.raw_message["content"][0].clone();
    assert_eq!(approval_request["tool_name"], "read_approval_fixture");
    assert_eq!(approval_request["mcp_server_id"], "mock_mcp_approval");
    assert_eq!(
        generation_state(&db, chat_id).await.as_deref(),
        Some("awaiting_approval")
    );

    let continued = server
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "message_id": assistant_message_id,
            "decision": "approve",
        }))
        .await;
    continued.assert_status_ok();
    let continued_events = parse_sse_events(&continued);
    assert_eq!(extract_full_text(&continued_events), "ASK-CONTINUED-ANSWER");

    let resumed = erato::db::entity::messages::Entity::find_by_id(assistant_message_id)
        .one(&db)
        .await
        .unwrap()
        .expect("Expected the resumed assistant message");
    assert_eq!(
        content_types(&resumed),
        vec!["tool_approval_request", "tool_approval", "tool_use", "text"]
    );
    let resumed_content = resumed.raw_message["content"].as_array().unwrap();
    assert_eq!(resumed_content[1]["always_allow"], false);
    assert_eq!(resumed_content[2]["status"], "success");
    assert!(
        serde_json::to_string(&resumed_content[2]["output"])
            .unwrap()
            .contains(TOOL_RESULT)
    );
    assert_eq!(
        generation_state(&db, chat_id).await.as_deref(),
        Some("completed")
    );
    // A plain approval keeps the ask decision for the next call.
    let settings = server
        .get("/api/v1beta/me/mcp-tool-approval-settings")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    let settings: Value = settings.json();
    assert_eq!(settings["settings"][0]["decision"], "ask");
}

/// "Never allow" refuses this call and stores the denial, without needing
/// `allow_always`.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_reject_always_stores_a_standing_denial(pool: Pool<Postgres>) {
    let (app_config, _llm) = approval_policy_app_config(
        one_tool_call_then_answer_after_refusal(
            "publish_approval_probe",
            "REFUSED-CONTINUED-ANSWER",
        ),
        erato::config::McpToolApprovalConfig {
            enabled: true,
            preset: erato::config::McpToolApprovalPreset::Restrictive,
            // Off on purpose: the standing refusal must not depend on it.
            allow_always: false,
        },
    )
    .await;
    let app_state = test_app_state(app_config, pool).await;
    let user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let db = app_state.db.clone();
    let server = app_server(app_state);

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": "read the fixture" }))
        .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    let assistant_message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();

    let continued = server
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "message_id": assistant_message_id,
            "decision": "reject_always",
        }))
        .await;
    continued.assert_status_ok();
    assert_eq!(
        extract_full_text(&parse_sse_events(&continued)),
        "REFUSED-CONTINUED-ANSWER"
    );

    let resumed = erato::db::entity::messages::Entity::find_by_id(assistant_message_id)
        .one(&db)
        .await
        .unwrap()
        .expect("Expected the resumed assistant message");
    assert_eq!(
        content_types(&resumed),
        vec![
            "tool_approval_request",
            "tool_rejection",
            "tool_use",
            "text"
        ]
    );
    assert_eq!(resumed.raw_message["content"][1]["never_allow"], true);
    assert_eq!(
        erato::models::user_tool_approval_setting::find_active_decision(
            &db,
            user.id,
            "mock_mcp_approval",
            "publish_approval_probe"
        )
        .await
        .unwrap(),
        Some(erato::models::user_tool_approval_setting::UserToolDecision::Denied)
    );

    // The settings roster agrees with the decision taken in the chat.
    let tools = server
        .get("/api/v1beta/me/mcp_servers/mock_mcp_approval/tools")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    tools.assert_status_ok();
    let tools: Value = tools.json();
    let denied = tools["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|tool| tool["name"] == "publish_approval_probe")
        .expect("Expected the fixture tool on the roster");
    assert_eq!(denied["user_decision"], "denied");
    assert_eq!(denied["effective"], "denied");
}

/// A one-off refusal leaves nothing behind: the next call asks again.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_reject_once_stores_nothing(pool: Pool<Postgres>) {
    let (app_config, _llm) = approval_policy_app_config(
        one_tool_call_then_answer_after_refusal("publish_approval_probe", "REFUSED-ONCE-ANSWER"),
        erato::config::McpToolApprovalConfig {
            enabled: true,
            preset: erato::config::McpToolApprovalPreset::Restrictive,
            allow_always: false,
        },
    )
    .await;
    let app_state = test_app_state(app_config, pool).await;
    let user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let db = app_state.db.clone();
    let server = app_server(app_state);

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": "read the fixture" }))
        .await;
    response.assert_status_ok();
    let assistant_message_id = Uuid::parse_str(&assistant_message_id_from_events(
        &parse_sse_events(&response),
    ))
    .unwrap();

    let continued = server
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "message_id": assistant_message_id,
            "decision": "reject",
        }))
        .await;
    continued.assert_status_ok();

    let resumed = erato::db::entity::messages::Entity::find_by_id(assistant_message_id)
        .one(&db)
        .await
        .unwrap()
        .expect("Expected the resumed assistant message");
    assert_eq!(resumed.raw_message["content"][1]["never_allow"], false);
    assert_eq!(
        erato::models::user_tool_approval_setting::find_active_decision(
            &db,
            user.id,
            "mock_mcp_approval",
            "publish_approval_probe"
        )
        .await
        .unwrap(),
        None
    );
}

/// "Always allow" on the card of a tool the user had put on ask replaces the
/// ask: the user chose the wider decision there.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_approve_always_replaces_an_ask_decision(pool: Pool<Postgres>) {
    const TOOL_RESULT: &str = "closed-world approval fixture read";
    let (app_config, _llm) = approval_policy_app_config(
        one_tool_call_then_answer(
            "read_approval_fixture",
            TOOL_RESULT,
            "ALWAYS-CONTINUED-ANSWER",
        ),
        erato::config::McpToolApprovalConfig {
            enabled: true,
            preset: erato::config::McpToolApprovalPreset::Permissive,
            allow_always: true,
        },
    )
    .await;
    let app_state = test_app_state(app_config, pool).await;
    let user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let db = app_state.db.clone();
    erato::models::user_tool_approval_setting::upsert_active(
        &db,
        user.id,
        "mock_mcp_approval",
        "read_approval_fixture",
        erato::models::user_tool_approval_setting::UserToolDecision::Ask,
    )
    .await
    .unwrap();
    let server = app_server(app_state);

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": "read the fixture" }))
        .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    let assistant_message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();
    assert_eq!(extract_full_text(&events), "");

    let continued = server
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "message_id": assistant_message_id,
            "decision": "approve_always",
        }))
        .await;
    continued.assert_status_ok();
    let continued_events = parse_sse_events(&continued);
    assert_eq!(
        extract_full_text(&continued_events),
        "ALWAYS-CONTINUED-ANSWER"
    );

    let resumed = erato::db::entity::messages::Entity::find_by_id(assistant_message_id)
        .one(&db)
        .await
        .unwrap()
        .expect("Expected the resumed assistant message");
    assert_eq!(
        content_types(&resumed),
        vec!["tool_approval_request", "tool_approval", "tool_use", "text"]
    );
    assert_eq!(resumed.raw_message["content"][1]["always_allow"], true);
    assert_eq!(
        erato::models::user_tool_approval_setting::find_active_decision(
            &db,
            user.id,
            "mock_mcp_approval",
            "read_approval_fixture"
        )
        .await
        .unwrap(),
        Some(erato::models::user_tool_approval_setting::UserToolDecision::AlwaysAllow)
    );
}

/// Without the approval gate an "ask" decision has nothing to park on: the
/// row stays stored but the tool runs unasked, and the enumeration reports
/// the decision as stored, ineffective and unavailable.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_ask_decision_is_inert_while_approvals_are_disabled(pool: Pool<Postgres>) {
    const TOOL_RESULT: &str = "closed-world approval fixture read";
    let (app_config, _llm) = approval_policy_app_config(
        one_tool_call_then_answer("read_approval_fixture", TOOL_RESULT, "INERT-ASK-ANSWER"),
        erato::config::McpToolApprovalConfig {
            enabled: false,
            allow_always: false,
            ..Default::default()
        },
    )
    .await;
    let app_state = test_app_state(app_config, pool).await;
    let user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let db = app_state.db.clone();
    // The endpoint refuses an ask here, so the row is seeded as if the gate
    // had been on when it was stored.
    erato::models::user_tool_approval_setting::upsert_active(
        &db,
        user.id,
        "mock_mcp_approval",
        "read_approval_fixture",
        erato::models::user_tool_approval_setting::UserToolDecision::Ask,
    )
    .await
    .unwrap();
    let server = app_server(app_state);

    let tools = server
        .get("/api/v1beta/me/mcp_servers/mock_mcp_approval/tools")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    let tools: Value = tools.json();
    assert_eq!(tools["ask_available"], false);
    let fixture = tools["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|tool| tool["name"] == "read_approval_fixture")
        .expect("fixture tool listed");
    assert_eq!(fixture["policy"], "auto");
    assert_eq!(fixture["user_decision"], "ask");
    assert_eq!(fixture["effective"], "allow");

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": "read the fixture" }))
        .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    let chat_id = Uuid::parse_str(&extract_chat_id(&events).expect("Expected chat_id")).unwrap();
    let assistant_message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();
    assert_eq!(extract_full_text(&events), "INERT-ASK-ANSWER");

    let completed = erato::db::entity::messages::Entity::find_by_id(assistant_message_id)
        .one(&db)
        .await
        .unwrap()
        .expect("Expected the assistant message");
    assert_eq!(content_types(&completed), vec!["tool_use", "text"]);
    assert_eq!(completed.raw_message["content"][0]["status"], "success");
    assert_eq!(
        generation_state(&db, chat_id).await.as_deref(),
        Some("completed")
    );
}

/// A stored grant bypasses the card for a tool the policy would ask about:
/// under the restrictive preset the open-world probe asks, but the user's
/// "always allow" runs it straight away.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_always_allow_bypasses_a_policy_ask_tool(pool: Pool<Postgres>) {
    const TOOL_RESULT: &str = "approval probe published";
    let (app_config, _llm) = approval_policy_app_config(
        one_tool_call_then_answer("publish_approval_probe", TOOL_RESULT, "GRANTED-ANSWER"),
        erato::config::McpToolApprovalConfig {
            enabled: true,
            preset: erato::config::McpToolApprovalPreset::Restrictive,
            allow_always: true,
        },
    )
    .await;
    let app_state = test_app_state(app_config, pool).await;
    get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let db = app_state.db.clone();
    let server = app_server(app_state);

    let grant = server
        .post("/api/v1beta/me/mcp-tool-approval-settings")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "mcp_server_id": "mock_mcp_approval",
            "tool_name": "publish_approval_probe",
            "decision": "always_allow",
        }))
        .await;
    grant.assert_status_ok();

    let tools = server
        .get("/api/v1beta/me/mcp_servers/mock_mcp_approval/tools")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    let tools: Value = tools.json();
    let probe = tools["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|tool| tool["name"] == "publish_approval_probe")
        .expect("probe tool listed");
    assert_eq!(probe["policy"], "ask");
    assert_eq!(probe["user_decision"], "always_allow");
    assert_eq!(probe["effective"], "allow");

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": "publish the approval probe" }))
        .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    let chat_id = Uuid::parse_str(&extract_chat_id(&events).expect("Expected chat_id")).unwrap();
    let assistant_message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();
    assert_eq!(extract_full_text(&events), "GRANTED-ANSWER");

    let completed = erato::db::entity::messages::Entity::find_by_id(assistant_message_id)
        .one(&db)
        .await
        .unwrap()
        .expect("Expected the assistant message");
    assert_eq!(content_types(&completed), vec!["tool_use", "text"]);
    assert!(
        serde_json::to_string(&completed.raw_message["content"][0]["output"])
            .unwrap()
            .contains(TOOL_RESULT)
    );
    assert_eq!(
        generation_state(&db, chat_id).await.as_deref(),
        Some("completed")
    );
}

// ---------------------------------------------------------------------------
// Re-anchoring submits onto system-delivered rows (ERMAIN-778)
// ---------------------------------------------------------------------------

/// Insert a message row directly, so a delivered task result and its reaction
/// can be staged without running the delivery path (which does not exist yet).
async fn seed_row(
    db: &sea_orm::DatabaseConnection,
    chat_id: Uuid,
    previous: Option<Uuid>,
    role: &str,
    input_parameters: Option<Value>,
    generation_parameters: Option<Value>,
) -> Uuid {
    use erato::db::entity::messages;
    let id = Uuid::new_v4();
    messages::ActiveModel {
        id: ActiveValue::Set(id),
        chat_id: ActiveValue::Set(chat_id),
        previous_message_id: ActiveValue::Set(previous),
        is_message_in_active_thread: ActiveValue::Set(true),
        raw_message: ActiveValue::Set(json!({
            "role": role,
            "content": [{ "content_type": "text", "text": "x" }],
        })),
        input_parameters: ActiveValue::Set(input_parameters),
        generation_parameters: ActiveValue::Set(generation_parameters),
        ..Default::default()
    }
    .insert(db)
    .await
    .expect("Failed to seed message")
    .id
}

fn task_result_input_parameters() -> Value {
    json!({
        "task_result": {
            "delivery_id": Uuid::new_v4(),
            "child_chat_id": Uuid::new_v4(),
            "result_message_id": Uuid::new_v4(),
            "status": "completed",
            "scheduling": "when_idle",
            "sequence": 0,
        }
    })
}

async fn seed_origin_chat(db: &sea_orm::DatabaseConnection) -> Uuid {
    let user = get_or_create_user(db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    chats::ActiveModel {
        owner_user_id: ActiveValue::Set(user.id.to_string()),
        ..Default::default()
    }
    .insert(db)
    .await
    .expect("Failed to insert chat")
    .id
}

/// Nothing below the anchor, or only the user's own rows: leave it alone.
///
/// Branching below a user's own later turn is a feature, not a bug to fix.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn resolving_the_delivered_tip_is_a_noop_without_system_rows(pool: Pool<Postgres>) {
    let db = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool.clone());
    let chat_id = seed_origin_chat(&db).await;

    let user_row = seed_row(&db, chat_id, None, "user", None, None).await;
    let assistant_row = seed_row(&db, chat_id, Some(user_row), "assistant", None, None).await;

    assert_eq!(
        erato::models::message::resolve_system_delivered_tip(&db, &chat_id, &assistant_row)
            .await
            .expect("resolves"),
        None,
        "an anchor with nothing below it must not move"
    );

    // A row the user wrote below the anchor also stops the walk.
    seed_row(&db, chat_id, Some(assistant_row), "user", None, None).await;
    assert_eq!(
        erato::models::message::resolve_system_delivered_tip(&db, &chat_id, &assistant_row)
            .await
            .expect("resolves"),
        None,
        "a user-authored row below the anchor must not be walked past"
    );
}

/// The walk stops on the deepest system row, through several deliveries.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn resolving_the_delivered_tip_walks_past_results_and_reactions(pool: Pool<Postgres>) {
    let db = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool.clone());
    let chat_id = seed_origin_chat(&db).await;
    let reaction_params = json!({ "initiator": "task_result" });

    let user_row = seed_row(&db, chat_id, None, "user", None, None).await;
    let anchor = seed_row(&db, chat_id, Some(user_row), "assistant", None, None).await;

    // A delivered result with no reaction yet is itself a legal anchor: that
    // is the steady state for a `silent` delivery.
    let tr1 = seed_row(
        &db,
        chat_id,
        Some(anchor),
        "user",
        Some(task_result_input_parameters()),
        None,
    )
    .await;
    assert_eq!(
        erato::models::message::resolve_system_delivered_tip(&db, &chat_id, &anchor)
            .await
            .expect("resolves"),
        Some(tr1)
    );

    let a2 = seed_row(
        &db,
        chat_id,
        Some(tr1),
        "assistant",
        None,
        Some(reaction_params.clone()),
    )
    .await;
    let tr2 = seed_row(
        &db,
        chat_id,
        Some(a2),
        "user",
        Some(task_result_input_parameters()),
        None,
    )
    .await;
    let a3 = seed_row(
        &db,
        chat_id,
        Some(tr2),
        "assistant",
        None,
        Some(reaction_params),
    )
    .await;

    assert_eq!(
        erato::models::message::resolve_system_delivered_tip(&db, &chat_id, &anchor)
            .await
            .expect("resolves"),
        Some(a3),
        "the walk must reach the deepest system row, not the first"
    );
}

/// A REGENERATED reaction carries no `initiator` marker, and must still be
/// walked past.
///
/// Regenerating rebuilds the turn's generation parameters through the ordinary
/// request path, which writes no initiator. Keying on the marker alone stops
/// the walk one row short, and the submit then deactivates the answer the user
/// just pressed regenerate for. Mutation: drop the
/// `is_task_result AND role = 'assistant'` clause from the CTE's recursive
/// term and this fails.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn resolving_the_delivered_tip_walks_past_a_regenerated_reaction(pool: Pool<Postgres>) {
    let db = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool.clone());
    let chat_id = seed_origin_chat(&db).await;

    let user_row = seed_row(&db, chat_id, None, "user", None, None).await;
    let anchor = seed_row(&db, chat_id, Some(user_row), "assistant", None, None).await;
    let tr1 = seed_row(
        &db,
        chat_id,
        Some(anchor),
        "user",
        Some(task_result_input_parameters()),
        None,
    )
    .await;
    // No `initiator`: exactly what regenerate writes.
    let regenerated = seed_row(
        &db,
        chat_id,
        Some(tr1),
        "assistant",
        None,
        Some(json!({ "generation_chat_provider_id": "mock" })),
    )
    .await;

    assert_eq!(
        erato::models::message::resolve_system_delivered_tip(&db, &chat_id, &anchor)
            .await
            .expect("resolves"),
        Some(regenerated),
        "a regenerated reaction has no initiator marker and would otherwise be branched away"
    );
}

/// The walk stops expanding at a user's own turn.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn resolving_the_delivered_tip_stops_at_a_user_turn(pool: Pool<Postgres>) {
    let db = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool.clone());
    let chat_id = seed_origin_chat(&db).await;

    let user_row = seed_row(&db, chat_id, None, "user", None, None).await;
    let anchor = seed_row(&db, chat_id, Some(user_row), "assistant", None, None).await;
    let tr1 = seed_row(
        &db,
        chat_id,
        Some(anchor),
        "user",
        Some(task_result_input_parameters()),
        None,
    )
    .await;
    let a2 = seed_row(
        &db,
        chat_id,
        Some(tr1),
        "assistant",
        None,
        Some(json!({ "initiator": "task_result" })),
    )
    .await;
    let u2 = seed_row(&db, chat_id, Some(a2), "user", None, None).await;
    seed_row(&db, chat_id, Some(u2), "assistant", None, None).await;

    assert_eq!(
        erato::models::message::resolve_system_delivered_tip(&db, &chat_id, &anchor)
            .await
            .expect("resolves"),
        Some(a2),
        "the walk must stop at the user's own later turn, branching it as today"
    );
}

/// Submit through the real endpoint and prove the handler USES the walk.
///
/// The tests above pin `resolve_system_delivered_tip` itself; this one pins the
/// wiring, which is a separate failure. Deleting the call in
/// `run_message_submit_task` leaves every one of them green while a stale
/// client silently branches away a delivered result.
///
/// Also pins the gate: with `delegation.tasks.enabled` off the anchor must not
/// move, because the walk must not run in a deployment that never delivers.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn submit_reanchors_onto_a_delivered_task_result_only_when_enabled(pool: Pool<Postgres>) {
    for tasks_enabled in [true, false] {
        let (mut app_config, _mock) = setup_mock_llm_server(None).await;
        app_config.delegation.tasks.enabled = tasks_enabled;
        let app_state = test_app_state(app_config, pool.clone()).await;
        let db = app_state.db.clone();

        let user = get_or_create_user(&db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
            .await
            .expect("Failed to create user");
        let chat_id = chats::ActiveModel {
            owner_user_id: ActiveValue::Set(user.id.to_string()),
            ..Default::default()
        }
        .insert(&db)
        .await
        .expect("Failed to insert chat")
        .id;

        // U1 -> A1 (the row a stale client last saw) -> TR1 -> A2
        let u1 = seed_row(&db, chat_id, None, "user", None, None).await;
        let a1 = seed_row(&db, chat_id, Some(u1), "assistant", None, None).await;
        let tr1 = seed_row(
            &db,
            chat_id,
            Some(a1),
            "user",
            Some(task_result_input_parameters()),
            None,
        )
        .await;
        let a2 = seed_row(
            &db,
            chat_id,
            Some(tr1),
            "assistant",
            None,
            Some(json!({ "initiator": "task_result" })),
        )
        .await;

        let app: Router = router(app_state.clone())
            .split_for_parts()
            .0
            .with_state(app_state);
        let server =
            TestServer::new(app.into_make_service()).expect("Failed to create test server");

        let response = server
            .post("/api/v1beta/me/messages/submitstream")
            .with_bearer_token(TEST_JWT_TOKEN)
            .json(&json!({
                "user_message": "a reply from a client that has not caught up",
                "previous_message_id": a1.to_string(),
            }))
            .await;
        response.assert_status_ok();

        let saved: Value = parse_sse_events(&response)
            .into_iter()
            .find(|event| event.event_type == "user_message_saved")
            .map(|event| {
                serde_json::from_str(&event.data).expect("user_message_saved data is JSON")
            })
            .expect("expected a user_message_saved event");

        let reported_anchor = saved["message"]["previous_message_id"]
            .as_str()
            .expect("the saved user message must report its anchor");

        if tasks_enabled {
            assert_eq!(
                reported_anchor,
                a2.to_string(),
                "the submit must be re-anchored below the delivered result and its reaction"
            );
            for (label, id) in [("task result", tr1), ("reaction", a2)] {
                let row = Messages::find_by_id(id)
                    .one(&db)
                    .await
                    .expect("query")
                    .expect("row");
                assert!(
                    row.is_message_in_active_thread,
                    "the {label} row must stay on the active thread"
                );
            }
        } else {
            assert_eq!(
                reported_anchor,
                a1.to_string(),
                "with the gate off the client's own anchor must be honoured exactly as before"
            );
        }
    }
}

/// Seed a delegated child of `origin_chat_id` whose result was already
/// delivered into the `delivered_into` row of that origin chat.
///
/// Hand-written because nothing in the tree writes a `result_delivery` yet —
/// the writer is ERMAIN-780 — so the reconciler below has no other way to meet
/// a realistic row. Built through `ChatConfiguration` rather than raw JSON, so
/// what is stored is the shape the writer will actually produce.
async fn seed_delivered_child(
    db: &sea_orm::DatabaseConnection,
    origin_chat_id: Uuid,
    origin_message_id: Uuid,
    delivered_into: Uuid,
    redeliveries: u32,
) -> Uuid {
    use erato::models::chat::{
        ChatConfiguration, ChatProvenance, ChatProvenanceKind, ResultDelivery, ResultDeliveryState,
    };

    let user = get_or_create_user(db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let configuration = ChatConfiguration {
        assistant_id: None,
        provenance: Some(ChatProvenance {
            kind: ChatProvenanceKind::Delegation,
            origin_chat_id: Some(origin_chat_id),
            origin_message_id: Some(origin_message_id),
            origin_assistant_id: None,
            rebase_cutoff: None,
            depth: 1,
            adopted_at: None,
            legacy_expected_output: None,
            legacy_constraints: None,
            run_mode: None,
            result_delivery: Some(ResultDelivery {
                state: ResultDeliveryState::Delivered,
                delivery_id: Uuid::new_v4(),
                result_message_id: Some(Uuid::new_v4()),
                status: "completed".to_string(),
                reason: None,
                claimed_by: Some("a-replica-that-has-gone".to_string()),
                claimed_at: Some(Utc::now().into()),
                message_id: Some(delivered_into),
                reaction_message_id: Some(Uuid::new_v4()),
                attempts: 1,
                redeliveries,
                redelivery_of: None,
                sequence: redeliveries,
                at: Utc::now().into(),
            }),
        }),
        task: None,
    };

    chats::ActiveModel {
        owner_user_id: ActiveValue::Set(user.id.to_string()),
        assistant_configuration: ActiveValue::Set(Some(
            configuration.to_json().expect("configuration serializes"),
        )),
        ..Default::default()
    }
    .insert(db)
    .await
    .expect("Failed to insert delegated child chat")
    .id
}

/// Take a row off the active thread, the way a branch write does.
async fn deactivate_row(db: &sea_orm::DatabaseConnection, message_id: Uuid) {
    let row = Messages::find_by_id(message_id)
        .one(db)
        .await
        .expect("query")
        .expect("row");
    let mut active: erato::db::entity::messages::ActiveModel = row.into();
    active.is_message_in_active_thread = ActiveValue::Set(false);
    active.update(db).await.expect("row deactivates");
}

async fn read_result_delivery(db: &sea_orm::DatabaseConnection, chat_id: Uuid) -> Value {
    let row = chats::Entity::find_by_id(chat_id)
        .one(db)
        .await
        .expect("query")
        .expect("chat");
    row.assistant_configuration.expect("configuration")["provenance"]["result_delivery"].clone()
}

/// The first branch re-queues a delivered result; a second one closes it.
///
/// `requeue_or_supersede_branched_deliveries` and both its call sites are
/// deletable with the whole suite green today, because nothing writes a
/// `result_delivery` until ERMAIN-780 lands. That leaves the requeue/supersede
/// branch, the `redeliveries = 0` cap, the `NOT EXISTS` recheck and the
/// `RETURNING` classification entirely unexercised. Hand-seeded here so the
/// rule is pinned before its writer arrives rather than after.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_branched_delivery_requeues_once_and_is_superseded_after_that(pool: Pool<Postgres>) {
    let db = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool.clone());
    let origin_chat_id = seed_origin_chat(&db).await;

    // U1 -> A1 -> TR1 (the delivered result) -> A2 (the reaction to it)
    let u1 = seed_row(&db, origin_chat_id, None, "user", None, None).await;
    let a1 = seed_row(&db, origin_chat_id, Some(u1), "assistant", None, None).await;
    let tr1 = seed_row(
        &db,
        origin_chat_id,
        Some(a1),
        "user",
        Some(task_result_input_parameters()),
        None,
    )
    .await;
    let a2 = seed_row(
        &db,
        origin_chat_id,
        Some(tr1),
        "assistant",
        None,
        Some(json!({ "initiator": "task_result" })),
    )
    .await;

    let first_branch = seed_delivered_child(&db, origin_chat_id, u1, tr1, 0).await;
    let already_redelivered = seed_delivered_child(&db, origin_chat_id, u1, tr1, 1).await;

    // A third child on its OWN origin turn, which the branch write also removes.
    // Both children above hang off `u1`, and `u1` stays on the active thread, so
    // without this row the origin-liveness half of `requeue_cond` is never the
    // discriminator — the requeue/supersede split is decided purely by
    // `redeliveries`. Delete the whole `AND EXISTS (… om.is_message_in_active_thread)`
    // clause and every other assertion here still holds, while in production a
    // result from a turn the user rewrote is re-delivered onto the new branch
    // instead of being closed as superseded.
    let u2 = seed_row(&db, origin_chat_id, Some(a2), "user", None, None).await;
    let branched_origin = seed_delivered_child(&db, origin_chat_id, u2, tr1, 0).await;

    // While the result is still on the active thread there is nothing to fix.
    let quiet = erato::models::chat::requeue_or_supersede_branched_deliveries(&db, &origin_chat_id)
        .await
        .expect("reconciles");
    assert!(
        quiet.requeued.is_empty() && quiet.superseded.is_empty(),
        "a delivery still on the active thread must be left alone"
    );

    // The branch write: everything below A1 leaves the active thread.
    for row in [tr1, a2, u2] {
        deactivate_row(&db, row).await;
    }

    let outcome =
        erato::models::chat::requeue_or_supersede_branched_deliveries(&db, &origin_chat_id)
            .await
            .expect("reconciles");
    assert_eq!(
        outcome.requeued,
        vec![first_branch],
        "a result branched away for the first time must be queued again"
    );
    let mut superseded_ids = outcome.superseded.clone();
    superseded_ids.sort();
    let mut expected_superseded = vec![already_redelivered, branched_origin];
    expected_superseded.sort();
    assert_eq!(
        superseded_ids, expected_superseded,
        "both a spent redelivery budget and a dead origin turn close a delivery"
    );

    let requeued = read_result_delivery(&db, first_branch).await;
    assert_eq!(requeued["state"], "pending");
    assert_eq!(requeued["redeliveries"], 1);
    assert_eq!(
        requeued["sequence"], 1,
        "the next delivery is the second one the reader sees"
    );
    assert!(
        requeued["message_id"].is_null(),
        "the row that was branched away must be forgotten, or the recheck would skip it forever"
    );
    assert!(
        requeued["reaction_message_id"].is_null(),
        "its reaction went with it"
    );
    assert!(
        requeued["claimed_by"].is_null() && requeued["claimed_at"].is_null(),
        "a requeued delivery is unclaimed, or no replica could take it"
    );
    assert!(
        requeued["redelivery_of"].is_string(),
        "the attempt being replaced is recorded"
    );

    // The discriminator: this one still had its full redelivery budget, so the
    // only thing that can have closed it is that its origin turn is gone.
    let branched = read_result_delivery(&db, branched_origin).await;
    assert_eq!(branched["state"], "superseded");
    assert_eq!(branched["reason"], "origin_branched");
    assert_eq!(
        branched["redeliveries"], 0,
        "closed by the rewritten origin turn, not by a spent redelivery budget"
    );

    let superseded = read_result_delivery(&db, already_redelivered).await;
    assert_eq!(superseded["state"], "superseded");
    assert_eq!(superseded["reason"], "origin_branched");
    assert_eq!(
        superseded["message_id"].as_str(),
        Some(tr1.to_string().as_str()),
        "a superseded record keeps pointing at what it delivered, for diagnosis"
    );
}

/// The regenerate route must actually call the reconciler.
///
/// The test above pins the SQL. Deleting the call site leaves it green while a
/// real branch strands the delivery forever, so the wiring is its own test:
/// one child, one real regenerate, one state change.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_regenerate_reconciles_the_delivery_it_branched_away(pool: Pool<Postgres>) {
    let (mut app_config, _mock) = setup_mock_llm_server(None).await;
    app_config.delegation.tasks.enabled = true;
    let app_state = test_app_state(app_config, pool).await;
    let db = app_state.db.clone();

    let _user = get_or_create_user(&db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    let submit = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": "the turn a task was dispatched from" }))
        .await;
    submit.assert_status_ok();

    let assistant_message_id = parse_sse_events(&submit)
        .iter()
        .find_map(|event| {
            if let Ok(json) = serde_json::from_str::<Value>(&event.data)
                && json["message_type"] == "assistant_message_completed"
            {
                return json["message_id"]
                    .as_str()
                    .and_then(|id| Uuid::parse_str(id).ok());
            }
            None
        })
        .expect("Expected assistant_message_completed event with message_id");

    let assistant_row = Messages::find_by_id(assistant_message_id)
        .one(&db)
        .await
        .expect("query")
        .expect("the assistant row");
    let origin_chat_id = assistant_row.chat_id;
    let origin_message_id = assistant_row
        .previous_message_id
        .expect("the assistant row answers a user turn");

    // The task's result landed below that answer, and was reacted to.
    let tr1 = seed_row(
        &db,
        origin_chat_id,
        Some(assistant_message_id),
        "user",
        Some(task_result_input_parameters()),
        None,
    )
    .await;
    seed_row(
        &db,
        origin_chat_id,
        Some(tr1),
        "assistant",
        None,
        Some(json!({ "initiator": "task_result" })),
    )
    .await;

    let child = seed_delivered_child(&db, origin_chat_id, origin_message_id, tr1, 0).await;

    let regenerate = server
        .post("/api/v1beta/me/messages/regeneratestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "current_message_id": assistant_message_id.to_string() }))
        .await;
    regenerate.assert_status_ok();

    assert!(
        !Messages::find_by_id(tr1)
            .one(&db)
            .await
            .expect("query")
            .expect("the task result row")
            .is_message_in_active_thread,
        "the regenerate must have branched the delivered result away, or this test proves nothing"
    );

    let delivery = read_result_delivery(&db, child).await;
    assert_eq!(
        delivery["state"], "pending",
        "the route must re-queue the delivery it just branched away"
    );
    assert_eq!(delivery["redeliveries"], 1);
}
