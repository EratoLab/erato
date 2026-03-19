//! Starter prompts API tests.

use axum::Router;
use axum_test::TestServer;
use erato::config::{PromptSourceSpecification, StarterPromptConfig, StarterPromptsConfig};
use erato::server::router::router;
use serde_json::Value;
use sqlx::Pool;
use sqlx::postgres::Postgres;
use std::collections::HashMap;

use crate::test_app_state;
use crate::test_utils::{
    TEST_JWT_TOKEN, TEST_USER_ISSUER, TEST_USER_SUBJECT, TestRequestAuthExt, setup_mock_llm_server,
};

/// Test retrieving configured starter prompts for the authenticated user.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_starter_prompts_endpoint(pool: Pool<Postgres>) {
    let (mut app_config, _server) = setup_mock_llm_server(None).await;

    let mut prompts = HashMap::new();
    prompts.insert(
        "web_research".to_string(),
        StarterPromptConfig {
            title: "Research a topic".to_string(),
            subtitle: "Kick off with web search enabled".to_string(),
            icon: Some("iconoir-globe".to_string()),
            prompt: PromptSourceSpecification::Static {
                content: "Research the latest information about this topic.".to_string(),
            },
            selected_facets: vec!["web_search".to_string(), "missing".to_string()],
            chat_provider: Some("mock-llm".to_string()),
        },
    );
    prompts.insert(
        "draft_email".to_string(),
        StarterPromptConfig {
            title: "Draft an email".to_string(),
            subtitle: "Write a concise customer reply".to_string(),
            icon: Some("iconoir-mail".to_string()),
            prompt: PromptSourceSpecification::Static {
                content: "Draft a concise and friendly reply to this customer email.".to_string(),
            },
            selected_facets: vec![],
            chat_provider: Some("missing-provider".to_string()),
        },
    );

    app_config.starter_prompts = StarterPromptsConfig {
        enabled: true,
        prompts,
        priority_order: vec!["draft_email".to_string(), "web_research".to_string()],
    };
    app_config.experimental_facets.facets.insert(
        "web_search".to_string(),
        erato::config::FacetConfig {
            display_name: "Web search".to_string(),
            icon: Some("iconoir-globe".to_string()),
            additional_system_prompt: None,
            tool_call_allowlist: vec![],
            model_settings: Default::default(),
            disable_facet_prompt_template: false,
        },
    );

    let app_state = test_app_state(app_config, pool).await;

    let issuer = TEST_USER_ISSUER;
    let subject = TEST_USER_SUBJECT;
    let _user = erato::models::user::get_or_create_user(&app_state.db, issuer, subject, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    let response = server
        .get("/api/v1beta/me/starter-prompts")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    response.assert_status_ok();

    let response_body: Value = response.json();
    let starter_prompts = response_body
        .get("starter_prompts")
        .and_then(Value::as_array)
        .expect("Missing starter prompts list");
    assert_eq!(starter_prompts.len(), 2);
    assert_eq!(starter_prompts[0]["id"], "draft_email");
    assert_eq!(starter_prompts[1]["id"], "web_research");
    assert_eq!(starter_prompts[0]["chat_provider"], Value::Null);
    assert_eq!(starter_prompts[1]["chat_provider"], "mock-llm");
    assert_eq!(
        starter_prompts[1]["selected_facets"],
        serde_json::json!(["web_search"])
    );
    assert_eq!(
        starter_prompts[1]["prompt"],
        "Research the latest information about this topic."
    );
}
