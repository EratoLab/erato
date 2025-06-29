use crate::{test_app_config, test_app_state, MIGRATOR};
use axum_test::TestServer;
use chrono::{Duration, Utc};
use erato::actors::cleanup_worker::cleanup_archived_chats;
use erato::db::entity::chats;
use sea_orm::{ActiveModelTrait, ActiveValue, EntityTrait};
use serde_json::{json, Value};
use sqlx::{Pool, Postgres};

#[sqlx::test(migrator = "MIGRATOR")]
async fn test_cleanup_logic(pool: Pool<Postgres>) {
    let app_config = test_app_config();
    let app_state = test_app_state(app_config, pool).await;

    let server = TestServer::new(
        erato::server::router::router(app_state.clone())
            .split_for_parts()
            .0
            .with_state(app_state.clone()),
    )
    .expect("Failed to create test server");

    let mock_jwt = "eyJhbGciOiJSUzI1NiIsImtpZCI6IjMzNTUwZjNkZWE2MDFhNjlmODM1MmVkNDA3OTRhYTlmYWMzNDhhODAifQ.eyJpc3MiOiJodHRwOi8vMC4wLjAuMDo1NTU2Iiwic3ViIjoiQ2lRd09HRTROamcwWWkxa1lqZzRMVFJpTnpNdE9UQmhPUzB6WTJReE5qWXhaalUwTmpZU0JXeHZZMkZzIiwiYXVkIjoiZXhhbXBsZS1hcHAiLCJleHAiOjE3NDA2MDkzNTAsImlhdCI6MTc0MDUyMjk1MCwiYXRfaGFzaCI6IldVVjNiUWNEbFN4M2Vod3o2QTZkYnciLCJjX2hhc2giOiJHcHVSdW52Y25rTjR3bGY4Q1RYamh3IiwiZW1haWwiOiJhZG1pbkBleGFtcGxlLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJuYW1lIjoiYWRtaW4ifQ.h8Fo6PAl2dG3xosBd6a6U6QAWalJvpX62-F3rJaS4hft7qnh9Sv_xDB2Cp1cjj-vS0e4xveDNuMGGnGKeUAk496q4xtuhwU9oUMoAsRQwnCXdp--_ngIG7QZK80h4jhvfutOc6Gltn0TTr-N5i8Yb9tW-ubVE68_-uX3lkx771MyJxgg9sL1YY7eKKEWx7UlRZEHmY6F134fY-ZFegrEnkESxi2qLTRo5hWSSIYmNlCSwStmNBBSPIOLl_Gu4wvqfPER5qXWgYn5dkISPZmcGVqyQuOBQkGOrAKMefvWP_Y97KHOwE9Od4au-Pgg7kuTA7Ywateg1VCdxLM3FMK-Sw";

    let mut chat_ids = Vec::new();

    for i in 0..2 {
        let response = server
            .post("/api/v1beta/me/messages/submitstream")
            .add_header(
                axum::http::header::AUTHORIZATION,
                format!("Bearer {}", mock_jwt),
            )
            .json(&json!({ "user_message": format!("Chat {}", i) }))
            .await;
        response.assert_status_ok();

        let body = response.as_bytes();
        let body_str = String::from_utf8_lossy(body);
        let events: Vec<String> = body_str
            .split("\n\n")
            .filter(|chunk| chunk.contains("data:"))
            .map(|chunk| chunk.to_string())
            .collect();

        let chat_id = events
            .iter()
            .find_map(|event| {
                let data = event.split("data:").nth(1).unwrap_or("").trim();
                if let Ok(json) = serde_json::from_str::<Value>(data) {
                    if json["message_type"] == "chat_created" {
                        return json["chat_id"].as_str().map(|s| s.to_string());
                    }
                }
                None
            })
            .unwrap_or_else(|| panic!("Did not find chat_created event for chat {}", i));
        chat_ids.push(sea_orm::prelude::Uuid::parse_str(&chat_id).unwrap());
    }
    // Verify
    let remaining_chats = chats::Entity::find().all(&app_state.db).await.unwrap();
    assert_eq!(remaining_chats.len(), 2);

    // Archive chat 0 (to be deleted)
    let chat1_model = chats::ActiveModel {
        id: ActiveValue::Unchanged(chat_ids[0]),
        archived_at: ActiveValue::Set(Some((Utc::now() - Duration::days(10)).into())),
        ..Default::default()
    };
    chat1_model.update(&app_state.db).await.unwrap();

    // Archive chat 1 (to be kept)
    let chat2_model = chats::ActiveModel {
        id: ActiveValue::Unchanged(chat_ids[1]),
        archived_at: ActiveValue::Set(Some(Utc::now().into())),
        ..Default::default()
    };
    chat2_model.update(&app_state.db).await.unwrap();

    // Run cleanup
    cleanup_archived_chats(&app_state.db, 7).await.unwrap();

    // Verify
    let remaining_chats = chats::Entity::find().all(&app_state.db).await.unwrap();
    assert_eq!(remaining_chats.len(), 1);
    assert_eq!(remaining_chats[0].id, chat_ids[1]);
}
