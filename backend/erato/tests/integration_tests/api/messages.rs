//! Message submission and streaming API tests.

use axum::Router;
use axum::http;
use axum_test::TestServer;
use erato::config::{
    ActionFacetConfig, ExperimentalFacetsConfig, FacetConfig, McpServerAuthenticationConfig,
    McpServerConfig, ModelSettings, PromptSourceSpecification,
};
use erato::models::message::{GenerationInputMessages, GenerationParameters};
use erato::models::user::get_or_create_user;
use erato::server::router::router;
use sea_orm::prelude::Uuid;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
use serde_json::{Value, json};
use sqlx::Pool;
use sqlx::postgres::Postgres;
use std::collections::HashMap;
use std::env;

use crate::test_app_state;
use crate::test_utils::{
    JwtTokenBuilder, TEST_JWT_TOKEN, TEST_USER_ISSUER, TEST_USER_SUBJECT, TestRequestAuthExt,
    extract_chat_id, parse_sse_events, read_integration_test_file_bytes, setup_mock_llm_server,
};

fn mock_mcp_base_url() -> String {
    env::var("TEST_MOCK_MCP_SERVER_BASE_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:44321".to_string())
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
        },
    );
    app_config.experimental_facets = ExperimentalFacetsConfig {
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
        },
    );
    app_config.experimental_facets = ExperimentalFacetsConfig {
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
    app_state.background_tasks.remove_task(&chat_uuid).await;

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

    let system_texts: Vec<String> = gen_input_value["messages"]
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

    let found = system_texts.iter().any(|text| {
        text.contains("Rewrite the following in a professional tone")
            && text.contains("yo whats up")
    });
    assert!(
        found,
        "Expected rendered action facet prompt as system message. System texts: {system_texts:?}"
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

    let system_texts: Vec<String> = gen_input_value["messages"]
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

    // The rendered template should contain the literal "{{content}}" from the tone arg,
    // not "actual content" substituted again
    let found = system_texts
        .iter()
        .any(|text| text.contains("{{content}}") && text.contains("actual content"));
    assert!(
        found,
        "Expected literal '{{{{content}}}}' in rendered prompt (no re-rendering). System texts: {system_texts:?}"
    );
}
