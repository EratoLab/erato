//! Facets API tests.

use axum::Router;
use axum_test::TestServer;
use erato::config::{
    ExperimentalFacetsConfig, FacetConfig, FacetPermissionRule, ModelPermissionRule, ModelSettings,
    PromptSourceSpecification,
};
use erato::server::router::router;
use serde_json::Value;
use sqlx::Pool;
use sqlx::postgres::Postgres;
use std::collections::HashMap;

use crate::test_app_state;
use crate::test_utils::{
    JwtTokenBuilder, TEST_JWT_TOKEN, TEST_USER_ISSUER, TEST_USER_SUBJECT, TestRequestAuthExt,
    setup_mock_llm_server,
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

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_facets_endpoint_filters_by_policy(pool: Pool<Postgres>) {
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
    app_config.facet_permissions.rules.insert(
        "allow-extended".to_string(),
        FacetPermissionRule::AllowAll {
            facet_ids: vec!["extended_thinking".to_string()],
        },
    );
    app_config.facet_permissions.rules.insert(
        "allow-web-premium".to_string(),
        FacetPermissionRule::AllowForGroupMembers {
            facet_ids: vec!["web_search".to_string()],
            groups: vec!["premium".to_string()],
        },
    );

    let app_state = test_app_state(app_config, pool).await;
    let _user = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
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
    let facets = response_body["facets"].as_array().unwrap();
    assert_eq!(facets.len(), 1);
    assert_eq!(facets[0]["id"], "extended_thinking");

    let premium_token = JwtTokenBuilder::new()
        .groups(vec!["premium".to_string()])
        .build();
    let premium_response = server
        .get("/api/v1beta/me/facets")
        .with_bearer_token(&premium_token)
        .await;
    premium_response.assert_status_ok();
    let premium_body: Value = premium_response.json();
    let premium_facets = premium_body["facets"].as_array().unwrap();
    assert_eq!(premium_facets.len(), 2);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_models_endpoint_filters_by_policy(pool: Pool<Postgres>) {
    let (mut app_config, _server) = setup_mock_llm_server(None).await;
    let base_provider_id = app_config
        .chat_providers
        .as_ref()
        .unwrap()
        .priority_order
        .first()
        .unwrap()
        .clone();
    let base_provider = app_config
        .chat_providers
        .as_ref()
        .unwrap()
        .providers
        .get(&base_provider_id)
        .unwrap()
        .clone();

    app_config
        .chat_providers
        .as_mut()
        .unwrap()
        .providers
        .insert("premium-model".to_string(), base_provider);
    app_config
        .chat_providers
        .as_mut()
        .unwrap()
        .priority_order
        .push("premium-model".to_string());
    app_config.model_permissions.rules.insert(
        "allow-premium".to_string(),
        ModelPermissionRule::AllowForGroupMembers {
            chat_provider_ids: vec!["premium-model".to_string()],
            groups: vec!["premium".to_string()],
        },
    );

    let app_state = test_app_state(app_config, pool).await;
    let _user = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    let response = server
        .get("/api/v1beta/me/models")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    response.assert_status_ok();
    let response_body: Value = response.json();
    let model_ids: Vec<&str> = response_body
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|model| model["chat_provider_id"].as_str())
        .collect();
    assert!(model_ids.contains(&base_provider_id.as_str()));
    assert!(!model_ids.contains(&"premium-model"));

    let premium_token = JwtTokenBuilder::new()
        .groups(vec!["premium".to_string()])
        .build();
    let premium_response = server
        .get("/api/v1beta/me/models")
        .with_bearer_token(&premium_token)
        .await;
    premium_response.assert_status_ok();
    let premium_body: Value = premium_response.json();
    let premium_model_ids: Vec<&str> = premium_body
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|model| model["chat_provider_id"].as_str())
        .collect();
    assert!(premium_model_ids.contains(&base_provider_id.as_str()));
    assert!(premium_model_ids.contains(&"premium-model"));
}
