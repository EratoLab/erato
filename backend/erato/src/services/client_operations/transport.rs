use super::ExecutorBinding;
use crate::query_metrics::named_statement_from_sql_and_values;
use eyre::Report;
use sea_orm::prelude::Uuid;
use sea_orm::{ConnectionTrait, DatabaseBackend, DatabaseConnection};

pub const HEARTBEAT: std::time::Duration = std::time::Duration::from_secs(5);

fn statement(sql: &str, values: Vec<sea_orm::Value>) -> sea_orm::Statement {
    named_statement_from_sql_and_values(
        DatabaseBackend::Postgres,
        "client_operations.transport",
        sql,
        values,
    )
}

pub async fn initialize(
    db: &DatabaseConnection,
    chat_id: Uuid,
    generation_id: Uuid,
    binding: &ExecutorBinding,
    operation_id: &str,
    transport_id: Option<Uuid>,
) -> Result<(), Report> {
    db.execute_raw(statement(
        r#"INSERT INTO client_operation_transports
           (chat_id, generation_id, binding, operation_id, transport_id, expires_at)
           SELECT id, $2, $3, $4, $5, now() + interval '20 seconds' FROM chats
           WHERE id = $1 AND active_generation_id = $2 AND generation_state = 'running' FOR UPDATE
           ON CONFLICT (chat_id) DO UPDATE SET generation_id = EXCLUDED.generation_id,
             binding = EXCLUDED.binding, operation_id = EXCLUDED.operation_id,
             transport_id = EXCLUDED.transport_id, expires_at = EXCLUDED.expires_at
           WHERE client_operation_transports.generation_id <> EXCLUDED.generation_id"#,
        vec![
            chat_id.into(),
            generation_id.into(),
            serde_json::to_value(binding)?.into(),
            operation_id.into(),
            transport_id.into(),
        ],
    ))
    .await?;
    Ok(())
}

pub async fn acquire(
    db: &DatabaseConnection,
    chat_id: Uuid,
    generation_id: Uuid,
    binding: &ExecutorBinding,
    registered: &[String],
    transport_id: Uuid,
) -> Result<bool, Report> {
    Ok(db
        .execute_raw(statement(
            r#"UPDATE client_operation_transports t SET transport_id = $5,
             expires_at = now() + interval '20 seconds'
           FROM chats c WHERE t.chat_id = $1 AND t.generation_id = $2 AND t.binding = $3
             AND ($4::jsonb ? t.operation_id OR $4::jsonb ? regexp_replace(t.operation_id, '^.*/', ''))
             AND (t.transport_id IS NULL OR t.expires_at <= now())
             AND c.id = t.chat_id AND c.active_generation_id = t.generation_id
             AND c.generation_state = 'running'"#,
            vec![
                chat_id.into(),
                generation_id.into(),
                serde_json::to_value(binding)?.into(),
                serde_json::to_value(registered)?.into(),
                transport_id.into(),
            ],
        ))
        .await?
        .rows_affected()
        == 1)
}

pub async fn renew(
    db: &DatabaseConnection,
    generation_id: Uuid,
    transport_id: Uuid,
) -> Result<bool, Report> {
    Ok(db
        .execute_raw(statement(
            r#"UPDATE client_operation_transports t SET expires_at = now() + interval '20 seconds'
           FROM chats c WHERE t.generation_id = $1 AND t.transport_id = $2
             AND t.expires_at > now() AND c.id = t.chat_id
             AND c.active_generation_id = t.generation_id AND c.generation_state = 'running'"#,
            vec![generation_id.into(), transport_id.into()],
        ))
        .await?
        .rows_affected()
        == 1)
}

pub async fn release(
    db: &DatabaseConnection,
    generation_id: Uuid,
    transport_id: Uuid,
) -> Result<(), Report> {
    db.execute_raw(statement(
        "UPDATE client_operation_transports SET transport_id = NULL, expires_at = now() WHERE generation_id = $1 AND transport_id = $2",
        vec![generation_id.into(), transport_id.into()],
    )).await?;
    Ok(())
}

/// None means this generation has no ownership row.
pub async fn owner(
    db: &DatabaseConnection,
    generation_id: Uuid,
) -> Result<Option<Option<Uuid>>, Report> {
    db.query_one_raw(statement(
        r#"SELECT CASE WHEN t.expires_at > now() AND c.active_generation_id = t.generation_id
             AND c.generation_state = 'running' THEN t.transport_id END AS owner
           FROM client_operation_transports t JOIN chats c ON c.id = t.chat_id
           WHERE t.generation_id = $1"#,
        vec![generation_id.into()],
    ))
    .await?
    .map(|row| row.try_get("", "owner").map_err(Into::into))
    .transpose()
}
