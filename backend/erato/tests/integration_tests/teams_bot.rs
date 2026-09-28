//! Teams bot integration tests: the Erato side of a Teams conversation.

use crate::test_utils::{MockLlmConfig, setup_mock_llm_server};
use crate::{MIGRATOR, test_app_state};
use erato::db::entity::prelude::Messages;
use erato::db::entity::{messages, users};
use erato::models::user::{
    find_user_by_entra_object_id, get_or_create_user, record_entra_object_id,
};
use erato::teams_bot::activity::ConversationKind;
use erato::teams_bot::graph::GraphIdentity;
use erato::teams_bot::host::{Completion, GenerationUpdate, Host};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
use sqlx::Pool;
use sqlx::postgres::Postgres;
use tokio::sync::mpsc;

const OID: &str = "4a1b3c5d-0000-4000-8000-00000000cafe";

fn identity() -> GraphIdentity {
    serde_json::from_value(serde_json::json!({
        "id": OID,
        "displayName": "Teams User",
        "mail": "teams.user@example.com",
    }))
    .expect("identity parses")
}

async fn completion(mut updates: mpsc::Receiver<GenerationUpdate>) -> (Completion, usize) {
    let mut text_updates = 0;
    let mut completion = None;
    while let Some(update) = updates.recv().await {
        match update {
            GenerationUpdate::Text(_) => text_updates += 1,
            GenerationUpdate::Completed(done) => completion = Some(done),
            GenerationUpdate::Failed(error) => panic!("generation failed: {error}"),
            GenerationUpdate::Tool(_) => {}
        }
    }
    (completion.expect("generation completed"), text_updates)
}

/// A Teams user is found by Entra object ID, and two turns in one Teams
/// conversation land in one Erato chat as a single thread.
///
/// # Test Categories
/// - `uses-db`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "MIGRATOR")]
async fn test_teams_conversation_continues_one_chat(pool: Pool<Postgres>) {
    let (app_config, _server) = setup_mock_llm_server(Some(MockLlmConfig {
        chunks: vec!["Hello".to_string(), " from Teams".to_string()],
        delay_ms: 10,
        ..Default::default()
    }))
    .await;
    let app_state = test_app_state(app_config, pool).await;
    let user = get_or_create_user(&app_state.db, "https://issuer.example", "subject-1", None)
        .await
        .expect("user");
    record_entra_object_id(&app_state.db, &user, OID)
        .await
        .expect("oid recorded");
    let found = find_user_by_entra_object_id(&app_state.db, OID)
        .await
        .expect("lookup")
        .expect("user found by oid");
    assert_eq!(found.id, user.id);

    let host = Host::new(app_state.clone());
    let session = host
        .session(
            &found,
            &identity(),
            Vec::new(),
            "graph-token".into(),
            Some("de-DE"),
            "tenant-1",
        )
        .await
        .expect("session");
    let row = host
        .upsert_conversation(
            "a:personal-1",
            ConversationKind::Personal,
            user.id,
            "https://smba.example/",
            "29:user",
        )
        .await
        .expect("conversation");
    let (chat_id, created) = host.ensure_chat(&session, &row, None).await.expect("chat");
    assert!(created);

    let first = host
        .submit(&session, chat_id, "Hi".to_string(), Vec::new())
        .await
        .expect("first submit starts");
    let (first, text_updates) = completion(first).await;
    assert_eq!(first.chat_id, chat_id);
    assert_eq!(first.text, "Hello from Teams");
    assert!(first.approvals.is_empty());
    assert!(text_updates > 0, "text is forwarded while generating");

    // The same Teams conversation keeps its chat.
    let row = host
        .upsert_conversation(
            "a:personal-1",
            ConversationKind::Personal,
            user.id,
            "https://smba.example/",
            "29:user",
        )
        .await
        .expect("conversation again");
    assert_eq!(row.current_chat_id, Some(chat_id));
    let (same_chat, created) = host.ensure_chat(&session, &row, None).await.expect("chat");
    assert_eq!((same_chat, created), (chat_id, false));

    let second = host
        .submit(&session, chat_id, "And again".to_string(), Vec::new())
        .await
        .expect("second submit starts");
    let (second, _) = completion(second).await;

    // Four rows, one thread: the second user turn follows the first answer.
    let rows = Messages::find()
        .filter(messages::Column::ChatId.eq(chat_id))
        .order_by_asc(messages::Column::CreatedAt)
        .all(&app_state.db)
        .await
        .expect("messages");
    assert_eq!(rows.len(), 4);
    assert!(rows.iter().all(|row| row.is_message_in_active_thread));
    assert_eq!(rows[2].previous_message_id, Some(first.message_id));

    // Proactive delivery finds the conversation and the stored answer.
    let conversations = host.conversations_for_chat(chat_id).await.expect("rows");
    assert_eq!(conversations.len(), 1);
    let stored = host
        .completion_for_message(chat_id, second.message_id)
        .await
        .expect("stored completion")
        .expect("message exists");
    assert_eq!(stored.text, second.text);

    // `/new` detaches the chat; the next message starts a fresh one.
    host.set_current_chat(&row, None).await.expect("reset");
    let row = host
        .upsert_conversation(
            "a:personal-1",
            ConversationKind::Personal,
            user.id,
            "https://smba.example/",
            "29:user",
        )
        .await
        .expect("conversation after reset");
    let (fresh, created) = host.ensure_chat(&session, &row, None).await.expect("chat");
    assert!(created);
    assert_ne!(fresh, chat_id);
}

/// Every Teams client sends the SSO exchange invoke; only the first is processed.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn test_token_exchange_is_claimed_once(pool: Pool<Postgres>) {
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let host = Host::new(test_app_state(app_config, pool).await);
    assert!(
        host.claim_token_exchange("exchange-1")
            .await
            .expect("first")
    );
    assert!(
        !host
            .claim_token_exchange("exchange-1")
            .await
            .expect("second")
    );
    assert!(
        host.claim_token_exchange("exchange-2")
            .await
            .expect("other")
    );
}

/// An object ID already recorded on one user is never moved to another.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn test_entra_object_id_is_not_reassigned(pool: Pool<Postgres>) {
    let conn = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool);
    let first = get_or_create_user(&conn, "iss", "first", None)
        .await
        .expect("first");
    let second = get_or_create_user(&conn, "iss", "second", None)
        .await
        .expect("second");
    record_entra_object_id(&conn, &first, OID)
        .await
        .expect("first records");
    record_entra_object_id(&conn, &second, OID)
        .await
        .expect("conflict is not an error");
    let owner = find_user_by_entra_object_id(&conn, OID)
        .await
        .expect("lookup")
        .expect("owner");
    assert_eq!(owner.id, first.id);
    let second = users::Entity::find_by_id(second.id)
        .one(&conn)
        .await
        .expect("reload")
        .expect("second exists");
    assert_eq!(second.entra_object_id, None);
}
