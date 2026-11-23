use axum::http::StatusCode;
use erato::config::DisclaimerConfig;
use serde_json::{Value, json};
use sqlx::{Pool, Postgres};

use crate::test_app_state;
use crate::test_utils::{
    TEST_JWT_TOKEN, TestRequestAuthExt, create_test_server, hermetic_app_config,
};

const DISCLAIMERS: &str = "/api/v1beta/me/disclaimers";

/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_disclaimers_require_sign_in_and_follow_config(pool: Pool<Postgres>) {
    let mut config = hermetic_app_config(None, None);
    config.disclaimers.enable_settings_tab = true;
    for (id, title, content) in [
        ("privacy", "Privacy", "Read the policy."),
        (
            "ai_policy",
            "AI policy",
            "Verify **answers**.\n\n- First step",
        ),
    ] {
        config.disclaimers.disclaimers.insert(
            id.into(),
            DisclaimerConfig {
                title: title.into(),
                content: content.into(),
            },
        );
    }

    let server = create_test_server(test_app_state(config.clone(), pool.clone()).await);
    server
        .get(DISCLAIMERS)
        .await
        .assert_status(StatusCode::UNAUTHORIZED);
    let response = server
        .get(DISCLAIMERS)
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    response.assert_status_ok();
    response.assert_header("cache-control", "no-store");
    assert_eq!(
        response.json::<Value>(),
        json!({ "disclaimers": [
            { "id": "ai_policy", "title": "AI policy", "content": "Verify **answers**.\n\n- First step" },
            { "id": "privacy", "title": "Privacy", "content": "Read the policy." }
        ] })
    );

    config.disclaimers.enable_settings_tab = false;
    let disabled = create_test_server(test_app_state(config, pool).await);
    let response = disabled
        .get(DISCLAIMERS)
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    response.assert_status_ok();
    assert_eq!(response.json::<Value>(), json!({ "disclaimers": [] }));
}
