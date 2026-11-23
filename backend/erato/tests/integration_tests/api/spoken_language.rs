//! "Languages I speak" (`preference_spoken_languages`) and the resolved
//! languages of the voice (`GET /me/spoken-language`).

use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::Pool;
use sqlx::postgres::Postgres;

use crate::test_app_state;
use crate::test_utils::{
    TEST_JWT_TOKEN, TestRequestAuthExt, create_test_server, setup_mock_llm_server,
};

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_person_lists_the_languages_they_speak(pool: Pool<Postgres>) {
    let (app_config, _llm) = setup_mock_llm_server(None).await;
    let server = create_test_server(test_app_state(app_config, pool).await);
    let spoken = || async {
        server
            .get("/api/v1beta/me/spoken-language")
            .with_bearer_token(TEST_JWT_TOKEN)
            .await
            .json::<Value>()
    };

    let unset = spoken().await;
    assert_eq!(unset["main"], unset["app_language"]);
    assert_eq!(unset["candidates"], json!([]));
    assert_eq!(unset["own"], json!([]));
    assert_eq!(unset["source"], "deployment");

    let saved: Value = server
        .put("/api/v1beta/me/profile/preferences")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "preference_spoken_languages": ["hi-IN", "en", "hi"] }))
        .await
        .json();
    assert_eq!(saved["preference_spoken_languages"], json!(["hi", "en"]));
    let profile: Value = server
        .get("/api/v1beta/me/profile")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .json();
    assert_eq!(profile["preference_spoken_languages"], json!(["hi", "en"]));
    let listed = spoken().await;
    assert_eq!(listed["main"], "hi");
    assert_eq!(listed["candidates"], json!(["hi", "en"]));
    assert_eq!(listed["source"], "user");

    for rejected in [json!(["xx"]), json!(["de", "en", "fr", "hi"]), json!("de")] {
        let status = server
            .put("/api/v1beta/me/profile/preferences")
            .with_bearer_token(TEST_JWT_TOKEN)
            .json(&json!({ "preference_spoken_languages": rejected }))
            .await
            .status_code();
        assert!(status.is_client_error(), "{rejected}: {status}");
    }
    assert_eq!(spoken().await["own"], json!(["hi", "en"]));

    // Another preference leaves the list alone.
    server
        .put("/api/v1beta/me/profile/preferences")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "preference_wait_lines_amount": "off" }))
        .await
        .assert_status_ok();
    assert_eq!(spoken().await["own"], json!(["hi", "en"]));

    for cleared in [json!(null), json!([])] {
        server
            .put("/api/v1beta/me/profile/preferences")
            .with_bearer_token(TEST_JWT_TOKEN)
            .json(&json!({ "preference_spoken_languages": ["tr"] }))
            .await
            .assert_status_ok();
        let response = server
            .put("/api/v1beta/me/profile/preferences")
            .with_bearer_token(TEST_JWT_TOKEN)
            .json(&json!({ "preference_spoken_languages": cleared }))
            .await;
        assert_eq!(response.status_code(), StatusCode::OK);
        assert!(
            response.json::<Value>()["preference_spoken_languages"].is_null(),
            "{cleared}"
        );
        assert_eq!(spoken().await["own"], json!([]));
    }
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn the_deployment_limits_and_locks_the_languages(pool: Pool<Postgres>) {
    let (mut app_config, _llm) = setup_mock_llm_server(None).await;
    app_config.audio_conversational.spoken_language.languages = vec!["de".into(), "fr".into()];
    app_config
        .audio_conversational
        .spoken_language
        .follow_speaker = false;
    let server = create_test_server(test_app_state(app_config, pool).await);
    server
        .put("/api/v1beta/me/profile/preferences")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "preference_spoken_languages": ["hi", "fr"] }))
        .await
        .assert_status_ok();
    let spoken: Value = server
        .get("/api/v1beta/me/spoken-language")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .json();
    assert_eq!(spoken["main"], "fr");
    assert_eq!(spoken["candidates"], json!(["fr"]));
    assert_eq!(spoken["offered"], json!(["de", "fr"]));
    assert_eq!(spoken["follow_speaker"], false);
}
