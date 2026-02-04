//! Facets API tests.

use axum::Router;
use axum_test::TestServer;
use erato::config::{
    ExperimentalFacetsConfig, FacetConfig, ModelSettings, PromptSourceSpecification,
};
use erato::server::router::router;
use serde_json::Value;
use sqlx::Pool;
use sqlx::postgres::Postgres;
use std::collections::HashMap;

use crate::test_app_state;
use crate::test_utils::{
    TEST_JWT_TOKEN, TEST_USER_ISSUER, TEST_USER_SUBJECT, TestRequestAuthExt, setup_mock_llm_server,
};

/// Test retrieving configured facets for the authenticated user.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_facets_endpoint(pool: Pool<Postgres>) {
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
        .get("/api/v1beta/me/facets")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    response.assert_status_ok();

    let response_body: Value = response.json();
    let global_settings = response_body
        .get("global_facet_settings")
        .expect("Missing global_facet_settings");
    assert_eq!(
        global_settings
            .get("only_single_facet")
            .and_then(Value::as_bool),
        Some(false)
    );
    assert_eq!(
        global_settings
            .get("show_facet_indicator_with_display_name")
            .and_then(Value::as_bool),
        Some(true)
    );

    let facets = response_body
        .get("facets")
        .and_then(Value::as_array)
        .expect("Missing facets list");
    assert_eq!(facets.len(), 2);
    assert_eq!(facets[0]["id"], "extended_thinking");
    assert_eq!(facets[1]["id"], "web_search");
    assert_eq!(facets[1]["default_enabled"], true);
}
