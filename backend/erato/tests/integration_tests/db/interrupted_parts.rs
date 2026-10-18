//! Recovery regression with completed history and more than one cleanup batch.
use erato::services::interrupted_parts::sweep_interrupted_tool_parts;
use sea_orm::SqlxPostgresConnector;
use sea_orm::prelude::Uuid;
use serde_json::{Value, json};
use sqlx::{Pool, Postgres};

async fn chat(pool: &Pool<Postgres>, state: Option<&str>, stale: bool) -> Uuid {
    sqlx::query_scalar("INSERT INTO chats (owner_user_id, generation_state, generation_heartbeat_at) VALUES ('interrupted-parts-test', $1, now() - make_interval(secs => $2)) RETURNING id")
        .bind(state).bind(if stale { 3600.0_f64 } else { 0.0 })
        .fetch_one(pool).await.unwrap()
}

async fn message(pool: &Pool<Postgres>, chat: Uuid, output: Value) -> Uuid {
    sqlx::query_scalar("INSERT INTO messages (chat_id, raw_message) VALUES ($1,$2) RETURNING id")
        .bind(chat)
        .bind(json!({"role":"assistant", "content":[{"content_type":"tool_use", "status":"in_progress", "output":output}]}))
        .fetch_one(pool).await.unwrap()
}

/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn interrupted_parts_history_batches_and_live_work(pool: Pool<Postgres>) {
    let db = SqlxPostgresConnector::from_sqlx_postgres_pool(pool.clone());
    let idle = chat(&pool, None, false).await;
    sqlx::query("INSERT INTO messages (chat_id, raw_message) SELECT $1, '{\"content\":[{\"content_type\":\"text\",\"text\":\"completed history\"}]}'::jsonb FROM generate_series(1,10000)")
        .bind(idle).execute(&pool).await.unwrap();
    assert_eq!(sweep_interrupted_tool_parts(&db, 90).await.messages, 0);

    let fresh = chat(&pool, Some("running"), false).await;
    let approval = chat(&pool, Some("awaiting_approval"), true).await;
    let stale = chat(&pool, Some("running"), true).await;
    let mut protected = Vec::new();
    for origin in [fresh, approval] {
        protected.push(message(&pool, origin, json!({"status":"queued"})).await);
    }
    for child in [fresh, approval] {
        protected.push(
            message(
                &pool,
                idle,
                json!({"status":"working", "delegate_chat_id":child}),
            )
            .await,
        );
    }
    protected.push(message(&pool, idle, json!({"run_mode":"async"})).await);
    let settled = message(&pool, stale, json!({"status":"working", "kept":"metadata"})).await;
    message(
        &pool,
        idle,
        json!({"status":"working", "child_run_id":stale}),
    )
    .await;
    assert_eq!(sweep_interrupted_tool_parts(&db, 90).await.parts, 2);
    assert_eq!(sweep_interrupted_tool_parts(&db, 90).await.parts, 0);
    let raw: Value = sqlx::query_scalar("SELECT raw_message FROM messages WHERE id=$1")
        .bind(settled)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(raw["content"][0]["status"], "error");
    assert_eq!(raw["content"][0]["output"]["status"], "cancelled");
    assert_eq!(raw["content"][0]["output"]["reason"], "interrupted");
    assert_eq!(raw["content"][0]["output"]["kept"], "metadata");

    for _ in 0..405 {
        message(&pool, idle, json!({"status":"queued"})).await;
    }
    let mut total = 0;
    for _ in 0..4 {
        // A healthy generation can keep renewing its lease during cleanup.
        let heartbeat =
            sqlx::query("UPDATE chats SET generation_heartbeat_at=now() WHERE id=$1").bind(fresh);
        let (outcome, renewed) = tokio::join!(
            sweep_interrupted_tool_parts(&db, 90),
            heartbeat.execute(&pool)
        );
        renewed.unwrap();
        assert!(outcome.messages <= 200);
        total += outcome.messages;
    }
    assert_eq!(total, 405);
    // Two replicas cleaning the same settled history remain idempotent.
    let (a, b) = tokio::join!(
        sweep_interrupted_tool_parts(&db, 90),
        sweep_interrupted_tool_parts(&db, 90)
    );
    assert_eq!(a.parts + b.parts, 0);
    for id in protected {
        let raw: Value = sqlx::query_scalar("SELECT raw_message FROM messages WHERE id=$1")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(raw["content"][0]["status"], "in_progress");
    }
}
