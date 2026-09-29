//! Tests for recording and filtering the surface a chat was created from.

use axum::http;
use axum_test::TestServer;
use erato::db::entity::chats;
use erato::models::chat::{ChatProvenance, ChatProvenanceKind};
use sea_orm::{ActiveModelTrait, ActiveValue, EntityTrait, prelude::Uuid};
use serde_json::{Value, json};
use sqlx::Pool;
use sqlx::postgres::Postgres;

use crate::test_app_state;
use crate::test_utils::{
    TEST_JWT_TOKEN, TEST_USER_ISSUER, TEST_USER_SUBJECT, TestRequestAuthExt, create_test_server,
    extract_chat_id, parse_sse_events, setup_mock_llm_server,
};

async fn submit_new_chat(server: &TestServer, platform: Option<&str>) -> String {
    let mut request = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN);
    if let Some(platform) = platform {
        request = request.add_header("X-Erato-Platform", platform);
    }
    let response = request.json(&json!({ "user_message": "Hello" })).await;
    response.assert_status_ok();
    extract_chat_id(&parse_sse_events(&response)).expect("Expected chat_created event")
}

async fn chat_detail(server: &TestServer, chat_id: &str) -> Value {
    let response = server
        .get(&format!("/api/v1beta/me/chats/{chat_id}"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    response.assert_status_ok();
    response.json()
}

async fn recent_chats(server: &TestServer, query: &str) -> Value {
    let response = server
        .get(&format!("/api/v1beta/me/recent_chats{query}"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    response.assert_status_ok();
    response.json()
}

fn listed_ids(listing: &Value) -> Vec<String> {
    let mut ids: Vec<String> = listing["chats"]
        .as_array()
        .expect("Response missing 'chats' array")
        .iter()
        .map(|chat| chat["id"].as_str().expect("Chat missing 'id'").to_string())
        .collect();
    ids.sort();
    ids
}

fn sorted(mut ids: Vec<&String>) -> Vec<String> {
    ids.sort();
    ids.into_iter().cloned().collect()
}

/// Chats created over HTTP record their surface from the `X-Erato-Platform`
/// header; a missing or unrecognised value counts as the web app.
///
/// # Test Categories
/// - `uses-db`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_new_chats_record_created_via_from_the_platform_header(pool: Pool<Postgres>) {
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;
    erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .expect("Failed to create user");
    let server = create_test_server(app_state);

    for (platform, expected) in [
        (None, "web"),
        (Some("web"), "web"),
        (Some("outlook"), "outlook"),
        (Some("word"), "word"),
        (Some("addin-neutral"), "office_addin"),
        (Some("teams"), "ms_teams_tab"),
        (Some("PC"), "web"),
    ] {
        let chat_id = submit_new_chat(&server, platform).await;
        assert_eq!(
            chat_detail(&server, &chat_id).await["created_via"],
            expected,
            "platform {platform:?}"
        );
    }

    let response = server
        .post("/api/v1beta/me/chats")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Platform", "word")
        .json(&json!({}))
        .await;
    response.assert_status_ok();
    let created: Value = response.json();
    let chat_id = created["chat_id"].as_str().expect("chat_id");
    assert_eq!(chat_detail(&server, chat_id).await["created_via"], "word");

    // A later message from another surface does not change it.
    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Platform", "outlook")
        .json(&json!({ "user_message": "Hello", "existing_chat_id": chat_id }))
        .await;
    response.assert_status_ok();
    assert_eq!(chat_detail(&server, chat_id).await["created_via"], "word");
}

/// `created_via` keeps only the named surfaces; `exclude_created_via` keeps
/// everything else, including legacy chats. Totals follow the filter.
///
/// # Test Categories
/// - `uses-db`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_recent_chats_filter_by_created_via(pool: Pool<Postgres>) {
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;
    erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .expect("Failed to create user");
    let server = create_test_server(app_state.clone());

    let web = submit_new_chat(&server, Some("web")).await;
    let outlook = submit_new_chat(&server, Some("outlook")).await;
    let tab = submit_new_chat(&server, Some("teams")).await;
    let bot = submit_new_chat(&server, Some("web")).await;
    let legacy = submit_new_chat(&server, Some("web")).await;
    for (chat_id, created_via) in [(&bot, "ms_teams_bot"), (&legacy, "legacy")] {
        chats::ActiveModel {
            id: ActiveValue::Unchanged(Uuid::parse_str(chat_id).expect("Invalid chat UUID")),
            created_via: ActiveValue::Set(created_via.to_string()),
            ..Default::default()
        }
        .update(&app_state.db)
        .await
        .expect("Failed to set created_via");
    }

    let teams = recent_chats(&server, "?created_via=ms_teams_tab,ms_teams_bot").await;
    assert_eq!(listed_ids(&teams), sorted(vec![&tab, &bot]));
    assert_eq!(teams["stats"]["total_count"], 2);
    let listed_bot = teams["chats"]
        .as_array()
        .unwrap()
        .iter()
        .find(|chat| chat["id"] == bot.as_str())
        .expect("bot chat listed");
    assert_eq!(listed_bot["created_via"], "ms_teams_bot");

    let without_teams =
        recent_chats(&server, "?exclude_created_via=ms_teams_tab,ms_teams_bot").await;
    assert_eq!(
        listed_ids(&without_teams),
        sorted(vec![&web, &outlook, &legacy])
    );
    assert_eq!(without_teams["stats"]["total_count"], 3);

    let combined = recent_chats(
        &server,
        "?created_via=web,outlook,legacy&exclude_created_via=legacy",
    )
    .await;
    assert_eq!(listed_ids(&combined), sorted(vec![&web, &outlook]));

    // A paged request counts only matching chats.
    let paged = recent_chats(&server, "?exclude_created_via=legacy&limit=1").await;
    assert_eq!(paged["stats"]["total_count"], 4);
    assert_eq!(paged["stats"]["has_more"], true);

    let unfiltered = recent_chats(&server, "?created_via=&exclude_created_via=").await;
    assert_eq!(unfiltered["stats"]["total_count"], 5);

    let response = server
        .get("/api/v1beta/me/recent_chats?created_via=teams")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    assert_eq!(response.status_code(), http::StatusCode::BAD_REQUEST);
}

/// A delegated run records the surface of the chat it was delegated from.
///
/// # Test Categories
/// - `uses-db`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_delegated_run_inherits_created_via(pool: Pool<Postgres>) {
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;
    let user = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .expect("Failed to create user");
    let server = create_test_server(app_state.clone());
    let origin = submit_new_chat(&server, Some("teams")).await;
    let origin_id = Uuid::parse_str(&origin).expect("Invalid chat UUID");

    let policy = erato::policy::engine::PolicyEngine::new();
    policy
        .rebuild_data_if_needed(&app_state.db, &app_state.config)
        .await
        .expect("policy rebuild");
    let me_user_id = user.id.to_string();
    let child = erato::models::chat::create_delegated_chat(
        &app_state.db,
        &policy,
        &erato::policy::types::Subject::User(me_user_id.clone()),
        &me_user_id,
        None,
        ChatProvenance {
            kind: ChatProvenanceKind::Delegation,
            origin_chat_id: Some(origin_id),
            origin_message_id: None,
            parent_message_id: None,
            origin_assistant_id: None,
            rebase_cutoff: None,
            depth: 1,
            adopted_at: None,
            legacy_expected_output: None,
            legacy_constraints: None,
            run_mode: None,
            result_delivery: None,
            retry_of: None,
        },
        None,
        "Delegated".to_string(),
        true,
        Vec::new(),
        Vec::new(),
    )
    .await
    .expect("delegated chat");
    assert_eq!(child.created_via, "ms_teams_tab");

    let stored = chats::Entity::find_by_id(child.id)
        .one(&app_state.db)
        .await
        .expect("fetch")
        .expect("child exists");
    assert_eq!(stored.created_via, "ms_teams_tab");
}
