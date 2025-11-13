//! Actor and background worker tests.

use crate::test_utils::{setup_mock_llm_server, TestRequestAuthExt, TEST_JWT_TOKEN};
use crate::{test_app_state, MIGRATOR};
use axum_test::TestServer;
use chrono::{Duration, Utc};
use erato::actors::cleanup_worker::cleanup_archived_chats;
use erato::db::entity::chats;
use erato::db::entity::{chat_file_uploads, file_uploads};
use sea_orm::{ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, QueryFilter};
use serde_json::{json, Value};
use sqlx::{Pool, Postgres};

/// Test the cleanup worker logic for archived chats.
///
/// # Test Categories
/// - `uses-db`
/// - `e2e-flow`
/// - `sse-streaming`
/// - `auth-required`
///
/// # Test Behavior
/// This test verifies the background cleanup worker functionality:
/// - Creates multiple chats via API
/// - Archives chats with different timestamps
/// - Runs the cleanup worker with a retention period
/// - Verifies that only chats older than the retention period are deleted
/// - Ensures recently archived chats are preserved
#[sqlx::test(migrator = "MIGRATOR")]
async fn test_cleanup_logic(pool: Pool<Postgres>) {
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;

    let server = TestServer::new(
        erato::server::router::router(app_state.clone())
            .split_for_parts()
            .0
            .with_state(app_state.clone()),
    )
    .expect("Failed to create test server");

    let mut chat_ids = Vec::new();

    for i in 0..2 {
        let response = server
            .post("/api/v1beta/me/messages/submitstream")
            .with_bearer_token(TEST_JWT_TOKEN)
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

/// Test the cleanup worker logic for archived chats with file uploads.
///
/// # Test Categories
/// - `uses-db`
/// - `e2e-flow`
/// - `auth-required`
///
/// # Test Behavior
/// This test verifies that the cleanup worker can successfully delete chats that have
/// attached file uploads by properly handling the database relations:
/// - Creates a chat with attached file uploads
/// - Archives the chat with an old timestamp
/// - Runs the cleanup worker with a retention period
/// - Verifies that the chat is deleted and file upload relations are nullified
/// - Ensures file upload entries remain as orphaned records
#[sqlx::test(migrator = "MIGRATOR")]
async fn test_cleanup_logic_with_file_uploads(pool: Pool<Postgres>) {
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;

    let server = TestServer::new(
        erato::server::router::router(app_state.clone())
            .split_for_parts()
            .0
            .with_state(app_state.clone()),
    )
    .expect("Failed to create test server");

    // Create a chat
    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": "Test chat with file" }))
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
        .expect("Did not find chat_created event");
    let chat_uuid = sea_orm::prelude::Uuid::parse_str(&chat_id).unwrap();

    // Create file uploads (independent of chat)
    let file_upload1_id = sea_orm::prelude::Uuid::new_v4();
    let file_upload1 = file_uploads::ActiveModel {
        id: ActiveValue::Set(file_upload1_id),
        filename: ActiveValue::Set("test_file1.txt".to_string()),
        file_storage_provider_id: ActiveValue::Set("local".to_string()),
        file_storage_path: ActiveValue::Set("/uploads/test_file1.txt".to_string()),
        created_at: ActiveValue::Set(Utc::now().into()),
        updated_at: ActiveValue::Set(Utc::now().into()),
    };
    file_upload1.insert(&app_state.db).await.unwrap();

    let file_upload2_id = sea_orm::prelude::Uuid::new_v4();
    let file_upload2 = file_uploads::ActiveModel {
        id: ActiveValue::Set(file_upload2_id),
        filename: ActiveValue::Set("test_file2.pdf".to_string()),
        file_storage_provider_id: ActiveValue::Set("s3".to_string()),
        file_storage_path: ActiveValue::Set("/bucket/test_file2.pdf".to_string()),
        created_at: ActiveValue::Set(Utc::now().into()),
        updated_at: ActiveValue::Set(Utc::now().into()),
    };
    file_upload2.insert(&app_state.db).await.unwrap();

    // Create relations in chat_file_uploads join table
    let chat_file_upload1 = chat_file_uploads::ActiveModel {
        chat_id: ActiveValue::Set(chat_uuid),
        file_upload_id: ActiveValue::Set(file_upload1_id),
        created_at: ActiveValue::Set(Utc::now().into()),
        updated_at: ActiveValue::Set(Utc::now().into()),
    };
    chat_file_upload1.insert(&app_state.db).await.unwrap();

    let chat_file_upload2 = chat_file_uploads::ActiveModel {
        chat_id: ActiveValue::Set(chat_uuid),
        file_upload_id: ActiveValue::Set(file_upload2_id),
        created_at: ActiveValue::Set(Utc::now().into()),
        updated_at: ActiveValue::Set(Utc::now().into()),
    };
    chat_file_upload2.insert(&app_state.db).await.unwrap();

    // Verify initial state
    let chats = chats::Entity::find().all(&app_state.db).await.unwrap();
    assert_eq!(chats.len(), 1);
    assert_eq!(chats[0].id, chat_uuid);

    // Verify file uploads exist
    let file_uploads = file_uploads::Entity::find()
        .all(&app_state.db)
        .await
        .unwrap();
    assert_eq!(file_uploads.len(), 2);

    // Verify join table relations exist
    let chat_file_uploads = chat_file_uploads::Entity::find()
        .filter(chat_file_uploads::Column::ChatId.eq(chat_uuid))
        .all(&app_state.db)
        .await
        .unwrap();
    assert_eq!(chat_file_uploads.len(), 2);

    // Archive the chat with an old timestamp (older than retention period)
    let chat_model = chats::ActiveModel {
        id: ActiveValue::Unchanged(chat_uuid),
        archived_at: ActiveValue::Set(Some((Utc::now() - Duration::days(10)).into())),
        ..Default::default()
    };
    chat_model.update(&app_state.db).await.unwrap();

    // Run cleanup (should delete the chat and join table relations, but preserve file uploads)
    cleanup_archived_chats(&app_state.db, 7).await.unwrap();

    // Verify chat is deleted
    let remaining_chats = chats::Entity::find().all(&app_state.db).await.unwrap();
    assert_eq!(
        remaining_chats.len(),
        0,
        "Chat should be deleted by cleanup worker"
    );

    // Verify join table relations are deleted
    let remaining_chat_file_uploads = chat_file_uploads::Entity::find()
        .filter(chat_file_uploads::Column::ChatId.eq(chat_uuid))
        .all(&app_state.db)
        .await
        .unwrap();
    assert_eq!(
        remaining_chat_file_uploads.len(),
        0,
        "Chat-file upload relations should be deleted"
    );

    // Verify file uploads are preserved (orphaned but not deleted)
    let remaining_file_uploads = file_uploads::Entity::find()
        .all(&app_state.db)
        .await
        .unwrap();
    assert_eq!(
        remaining_file_uploads.len(),
        2,
        "File uploads should be preserved as orphaned records"
    );
}
