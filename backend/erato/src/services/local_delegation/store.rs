//! Logged job/checkpoint persistence. Every result and continuation transition is
//! serialized in PostgreSQL; replica affinity and process-local channels play no role.
use super::{Checkpoint, contract};
use eyre::{Result, eyre};
use sea_orm::prelude::Uuid;
use sea_orm::{
    ConnectionTrait, DatabaseConnection, DatabaseTransaction, DbBackend, Statement,
    TransactionTrait,
};
use serde_json::{Value, json};

fn statement(sql: &str, values: Vec<sea_orm::Value>) -> Statement {
    Statement::from_sql_and_values(DbBackend::Postgres, sql, values)
}
fn conflict() -> eyre::Report {
    eyre!("Local delegation state conflict")
}

#[derive(Clone)]
pub struct PendingJob {
    pub id: Uuid,
    pub chat_id: Uuid,
    pub message_id: Uuid,
    pub tool_call_id: String,
    pub task_id: String,
    pub attempt_id: Uuid,
    pub plan: Value,
    pub binding: Option<Value>,
    pub origin: Option<String>,
    pub state: String,
    pub receipt: Option<String>,
    pub server_outcome: Option<Value>,
}
impl PendingJob {
    fn from_row(row: sea_orm::QueryResult) -> Result<Self> {
        Ok(Self {
            id: row.try_get("", "id")?,
            chat_id: row.try_get("", "chat_id")?,
            message_id: row.try_get("", "message_id")?,
            tool_call_id: row.try_get("", "tool_call_id")?,
            task_id: row.try_get("", "task_id")?,
            attempt_id: row.try_get("", "attempt_id")?,
            plan: row.try_get("", "plan")?,
            binding: row.try_get("", "binding")?,
            origin: row.try_get("", "origin")?,
            state: row.try_get("", "state")?,
            receipt: row.try_get("", "receipt")?,
            server_outcome: row.try_get("", "server_outcome")?,
        })
    }
}
/// Server-created checkpoint, never accepted from a frontend request.
pub struct Park<'a> {
    pub owner: &'a str,
    pub chat_id: Uuid,
    pub message_id: Uuid,
    pub generation_id: Uuid,
    pub tool_call_id: &'a str,
    pub task_id: &'a str,
    pub plan: &'a Value,
    pub checkpoint: &'a Checkpoint,
    pub message: &'a Value,
}
pub async fn park(db: &DatabaseConnection, input: Park<'_>) -> Result<Uuid> {
    contract::validate("plan", input.plan)?;
    if input.checkpoint.version != 1 {
        return Err(conflict());
    }
    let checkpoint = serde_json::to_value(input.checkpoint)?;
    if serde_json::to_vec(&checkpoint)?.len() > 32 * 1024 * 1024 {
        return Err(conflict());
    }
    let tx = db.begin().await?;
    // This also serializes against archive, generation takeover and tool-policy updates.
    let chat=tx.query_one_raw(statement("SELECT id FROM chats WHERE id=$1 AND owner_user_id=$2 AND archived_at IS NULL AND active_generation_id=$3 AND generation_state='running' FOR UPDATE",vec![input.chat_id.into(),input.owner.into(),input.generation_id.into()])).await?;
    if chat.is_none() {
        return Err(conflict());
    }
    let id = Uuid::new_v4();
    let inserted=tx.execute_raw(statement("INSERT INTO local_delegation_jobs(id,owner_user_id,chat_id,message_id,tool_call_id,attempt_id,task_id,plan,checkpoint,expires_at) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,to_timestamp($10::bigint) WHERE $10>extract(epoch from now()) AND $10<=extract(epoch from now())+604800 ON CONFLICT(message_id,tool_call_id) DO NOTHING",vec![id.into(),input.owner.into(),input.chat_id.into(),input.message_id.into(),input.tool_call_id.into(),Uuid::new_v4().into(),input.task_id.into(),input.plan.clone().into(),checkpoint.into(),input.plan["expiresAt"].as_i64().ok_or_else(conflict)?.into()])).await?;
    if inserted.rows_affected() != 1 {
        return Err(conflict());
    }
    let updated = tx
        .execute_raw(statement(
            "UPDATE messages SET raw_message=$3 WHERE id=$1 AND chat_id=$2",
            vec![
                input.message_id.into(),
                input.chat_id.into(),
                input.message.clone().into(),
            ],
        ))
        .await?;
    if updated.rows_affected() != 1 {
        return Err(conflict());
    }
    // Release active generation only after the checkpoint and message are durable.
    tx.execute_raw(statement("UPDATE chats SET generation_state='awaiting_approval',generation_ended_at=now() WHERE id=$1 AND active_generation_id=$2",vec![input.chat_id.into(),input.generation_id.into()])).await?;
    tx.commit().await?;
    Ok(id)
}

pub async fn pending(db: &DatabaseConnection, owner: &str) -> Result<Vec<PendingJob>> {
    let rows=db.query_all_raw(statement("SELECT j.* FROM local_delegation_jobs j JOIN chats c ON c.id=j.chat_id WHERE j.owner_user_id=$1 AND c.owner_user_id=$1 AND c.archived_at IS NULL AND (j.state IN ('awaiting_authenticated_resume','continuing') OR (j.state='waiting_for_local_result' AND j.expires_at>now()) OR (j.state='completed' AND j.receipt IS NOT NULL AND j.expires_at>now()-interval '7 days')) ORDER BY j.created_at LIMIT 128",vec![owner.into()])).await?;
    rows.into_iter().map(PendingJob::from_row).collect()
}
pub async fn get(db: &DatabaseConnection, id: Uuid, owner: &str) -> Result<PendingJob> {
    let row=db.query_one_raw(statement("SELECT j.* FROM local_delegation_jobs j JOIN chats c ON c.id=j.chat_id WHERE j.id=$1 AND j.owner_user_id=$2 AND c.owner_user_id=$2 AND c.archived_at IS NULL",vec![id.into(),owner.into()])).await?.ok_or_else(conflict)?;
    PendingJob::from_row(row)
}
async fn lock_job(tx: &DatabaseTransaction, id: Uuid, owner: &str) -> Result<sea_orm::QueryResult> {
    // Lock chat first consistently with generation/archival code.
    if tx.query_one_raw(statement("SELECT c.id FROM chats c JOIN local_delegation_jobs j ON j.chat_id=c.id WHERE j.id=$1 AND j.owner_user_id=$2 AND c.owner_user_id=$2 AND c.archived_at IS NULL FOR UPDATE OF c",vec![id.into(),owner.into()])).await?.is_none() {return Err(conflict());}
    tx.query_one_raw(statement("SELECT *,floor(extract(epoch from now()))::bigint AS clock FROM local_delegation_jobs WHERE id=$1 AND owner_user_id=$2 FOR UPDATE",vec![id.into(),owner.into()])).await?.ok_or_else(conflict)
}
pub async fn bind_device(
    db: &DatabaseConnection,
    id: Uuid,
    owner: &str,
    backend_origin: &str,
    device: &str,
    origin: &str,
) -> Result<PendingJob> {
    let tx = db.begin().await?;
    let row = lock_job(&tx, id, owner).await?;
    let now: i64 = row.try_get("", "clock")?;
    let mut job = PendingJob::from_row(row)?;
    if job.server_outcome.is_some()
        || (job.receipt.is_none()
            && (job.state != "waiting_for_local_result"
                || job.plan["expiresAt"].as_i64().ok_or_else(conflict)? <= now))
    {
        return Err(conflict());
    }
    let binding = json!({"backendOrigin":backend_origin,"accountId":owner,"deviceId":device,"taskId":job.task_id,"jobId":id,"attemptId":job.attempt_id,"toolCallId":job.tool_call_id,"planDigest":contract::plan_digest(&job.plan)?});
    contract::validate("binding", &binding)?;
    if let Some(current) = &job.binding {
        if current != &binding || job.origin.as_deref() != Some(origin) {
            return Err(conflict());
        }
    } else {
        tx.execute_raw(statement(
            "UPDATE local_delegation_jobs SET binding=$2,origin=$3 WHERE id=$1",
            vec![id.into(), binding.clone().into(), origin.into()],
        ))
        .await?;
        job.binding = Some(binding);
        job.origin = Some(origin.into());
    }
    tx.commit().await?;
    Ok(job)
}
/// The signer is called within the locked result transaction. Receipt, exact
/// package and continuation intent become visible in the same logged commit.
pub async fn accept(
    db: &DatabaseConnection,
    id: Uuid,
    owner: &str,
    package: &Value,
    sign: impl FnOnce(Value) -> Result<String>,
) -> Result<String> {
    let tx = db.begin().await?;
    let row = lock_job(&tx, id, owner).await?;
    let saved: Option<Value> = row.try_get("", "approved_export")?;
    if let Some(saved) = saved {
        if &saved != package {
            return Err(conflict());
        }
        let receipt: String = row.try_get("", "receipt")?;
        tx.commit().await?;
        return Ok(receipt);
    }
    let now: i64 = row.try_get("", "clock")?;
    let job = PendingJob::from_row(row)?;
    if job.state != "waiting_for_local_result" {
        return Err(conflict());
    }
    let binding = job.binding.ok_or_else(conflict)?;
    contract::validate_export(package, &binding, &job.plan, now)?;
    let receipt = sign(
        json!({"iss":binding["backendOrigin"],"aud":"erato-local-export-receipt-v1","binding":binding,"exportId":package["exportId"],"manifestDigest":package["manifestDigest"],"receiptId":Uuid::new_v4().simple().to_string(),"acceptedAt":now}),
    )?;
    tx.execute_raw(statement("UPDATE local_delegation_jobs SET state='awaiting_authenticated_resume',approved_export=$2,receipt=$3,export_id=$4,manifest_digest=$5,accepted_at=to_timestamp($6::bigint) WHERE id=$1",vec![id.into(),package.clone().into(),receipt.clone().into(),package["exportId"].as_str().ok_or_else(conflict)?.into(),package["manifestDigest"].as_str().ok_or_else(conflict)?.into(),now.into()])).await?;
    tx.commit().await?;
    Ok(receipt)
}

/// Valid only inside a freshly authenticated worker holding the chat generation lease.
#[derive(Clone, Copy)]
pub struct Fence {
    pub job_id: Uuid,
    pub generation_id: Uuid,
    pub token: i64,
}
pub struct Resume {
    pub fence: Fence,
    pub checkpoint: Checkpoint,
    pub package: Option<Value>,
    pub job: PendingJob,
}
pub async fn claim_resume(
    db: &DatabaseConnection,
    id: Uuid,
    owner: &str,
    generation_id: Uuid,
) -> Result<Resume> {
    let tx = db.begin().await?;
    let row = lock_job(&tx, id, owner).await?;
    let checkpoint: Value = row.try_get("", "checkpoint")?;
    let package: Option<Value> = row.try_get("", "approved_export")?;
    let job = PendingJob::from_row(row)?;
    let claimed=tx.query_one_raw(statement("UPDATE local_delegation_jobs j SET state='continuing',fence=fence+1,generation_id=$3,lease_until=now()+interval '45 seconds' FROM chats c WHERE j.id=$1 AND j.owner_user_id=$2 AND c.id=j.chat_id AND c.active_generation_id=$3 AND c.generation_state='running' AND (j.state='awaiting_authenticated_resume' OR (j.state='continuing' AND j.lease_until<=now())) RETURNING j.fence",vec![id.into(),owner.into(),generation_id.into()])).await?.ok_or_else(conflict)?;
    let fence = Fence {
        job_id: id,
        generation_id,
        token: claimed.try_get("", "fence")?,
    };
    let checkpoint: Checkpoint = serde_json::from_value(checkpoint)?;
    if checkpoint.version != 1 {
        return Err(conflict());
    }
    tx.commit().await?;
    Ok(Resume {
        fence,
        checkpoint,
        package,
        job,
    })
}
const FENCED: &str = "j.id=$1 AND j.generation_id=$2 AND j.fence=$3 AND j.state='continuing' AND j.lease_until>now() AND c.id=j.chat_id AND c.active_generation_id=$2 AND c.generation_state='running' AND c.archived_at IS NULL";
fn fence_values(fence: Fence) -> Vec<sea_orm::Value> {
    vec![
        fence.job_id.into(),
        fence.generation_id.into(),
        fence.token.into(),
    ]
}
async fn lock_fence(tx: &DatabaseTransaction, fence: Fence) -> Result<()> {
    // Lock the chat too: an UPDATE .. FROM predicate alone does not serialize
    // with a concurrent generation takeover that changes the joined chat row.
    tx.query_one_raw(statement(&format!("SELECT c.id FROM local_delegation_jobs j JOIN chats c ON c.id=j.chat_id WHERE {FENCED} FOR UPDATE OF c"),fence_values(fence))).await?.ok_or_else(conflict)?;
    Ok(())
}
pub async fn heartbeat(db: &DatabaseConnection, fence: Fence) -> Result<()> {
    let tx = db.begin().await?;
    lock_fence(&tx, fence).await?;
    let result=tx.execute_raw(statement(&format!("UPDATE local_delegation_jobs j SET lease_until=now()+interval '45 seconds' FROM chats c WHERE {FENCED}"),fence_values(fence))).await?;
    if result.rows_affected() != 1 {
        return Err(conflict());
    }
    tx.commit().await?;
    Ok(())
}
/// Persist progress and the message together before allowing further tool execution.
pub async fn checkpoint(
    db: &DatabaseConnection,
    fence: Fence,
    checkpoint: &Checkpoint,
    message: &Value,
) -> Result<()> {
    let tx = db.begin().await?;
    lock_fence(&tx, fence).await?;
    let row = tx
        .query_one_raw(statement(
            "SELECT checkpoint FROM local_delegation_jobs WHERE id=$1 FOR UPDATE",
            vec![fence.job_id.into()],
        ))
        .await?
        .ok_or_else(conflict)?;
    let previous: Checkpoint = serde_json::from_value(row.try_get("", "checkpoint")?)?;
    if checkpoint.version != 1
        || !checkpoint.consumption.preserves(&previous.consumption)
        || checkpoint.task_client_budget != previous.task_client_budget
        || checkpoint.task_server_budget != previous.task_server_budget
        || checkpoint
            .allowed_tools
            .iter()
            .any(|tool| !previous.allowed_tools.contains(tool))
    {
        return Err(conflict());
    }
    let mut values = fence_values(fence);
    values.push(serde_json::to_value(checkpoint)?.into());
    let row=tx.query_one_raw(statement(&format!("UPDATE local_delegation_jobs j SET checkpoint=$4,lease_until=now()+interval '45 seconds' FROM chats c WHERE {FENCED} AND ($4->'consumption'->>'tool_calls')::bigint >= (j.checkpoint->'consumption'->>'tool_calls')::bigint AND ($4->'consumption'->>'model_turns')::bigint >= (j.checkpoint->'consumption'->>'model_turns')::bigint RETURNING j.message_id"),values)).await?.ok_or_else(conflict)?;
    let message_id: Uuid = row.try_get("", "message_id")?;
    tx.execute_raw(statement(
        "UPDATE messages SET raw_message=$2 WHERE id=$1",
        vec![message_id.into(), message.clone().into()],
    ))
    .await?;
    tx.commit().await?;
    Ok(())
}
pub async fn finish(
    db: &DatabaseConnection,
    fence: Fence,
    message: &Value,
    metadata: &Value,
) -> Result<()> {
    let tx = db.begin().await?;
    lock_fence(&tx, fence).await?;
    let row=tx.query_one_raw(statement(&format!("UPDATE local_delegation_jobs j SET state='completed',lease_until=NULL FROM chats c WHERE {FENCED} RETURNING j.message_id"),fence_values(fence))).await?.ok_or_else(conflict)?;
    let message_id: Uuid = row.try_get("", "message_id")?;
    tx.execute_raw(statement(
        "UPDATE messages SET raw_message=$2,generation_metadata=$3 WHERE id=$1",
        vec![
            message_id.into(),
            message.clone().into(),
            metadata.clone().into(),
        ],
    ))
    .await?;
    tx.commit().await?;
    Ok(())
}
pub async fn cancel(db: &DatabaseConnection, id: Uuid, owner: &str) -> Result<()> {
    let tx = db.begin().await?;
    lock_job(&tx, id, owner).await?;
    tx.execute_raw(statement("UPDATE local_delegation_jobs SET state='awaiting_authenticated_resume',server_outcome='{\"status\":\"cancelled\"}',fence=fence+1,lease_until=NULL WHERE id=$1 AND state NOT IN ('completed','cancelled','expired') AND server_outcome IS NULL",vec![id.into()])).await?;
    tx.commit().await?;
    Ok(())
}
/// Database-only recovery records a need for live authentication; it cannot
/// launch a cloud generation or reconstruct authority from a stored subject ID.
pub async fn recover(db: &DatabaseConnection) -> Result<()> {
    db.execute_raw(statement("UPDATE local_delegation_jobs j SET state=CASE WHEN c.archived_at IS NOT NULL OR c.owner_user_id<>j.owner_user_id THEN 'cancelled' ELSE 'awaiting_authenticated_resume' END,server_outcome=CASE WHEN j.state='waiting_for_local_result' AND j.expires_at<=now() THEN '{\"status\":\"expired\"}'::jsonb ELSE j.server_outcome END,fence=fence+1,lease_until=NULL FROM chats c WHERE c.id=j.chat_id AND j.state IN ('waiting_for_local_result','awaiting_authenticated_resume','continuing') AND (c.archived_at IS NOT NULL OR c.owner_user_id<>j.owner_user_id OR (j.state='waiting_for_local_result' AND j.expires_at<=now()) OR (j.state='continuing' AND j.lease_until<=now()))",vec![])).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::Consumption;
    use super::*;
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("../sqitch/deploy");
    fn checkpoint_fixture() -> Checkpoint {
        Checkpoint {
            version: 1,
            request: genai::chat::ChatRequest::from_user("Find local evidence"),
            content: vec![],
            pending_calls: vec![],
            consumption: Consumption {
                tool_calls: 1,
                model_turns: 1,
                ..Default::default()
            },
            generation_metadata: None,
            allowed_tools: vec!["local_collect_evidence".into()],
            model_id: "test".into(),
            origin_user_message_id: None,
            task_server_budget: Some(2),
            task_client_budget: Some(2),
        }
    }
    async fn fixture(db: &DatabaseConnection) -> (Uuid, Uuid, Uuid, Value) {
        let chat = Uuid::new_v4();
        let message = Uuid::new_v4();
        let generation = Uuid::new_v4();
        db.execute_raw(statement("INSERT INTO chats(id,owner_user_id,active_generation_id,generation_state) VALUES($1,'owner',$2,'running')",vec![chat.into(),generation.into()])).await.unwrap();
        db.execute_raw(statement("INSERT INTO messages(id,chat_id,raw_message) VALUES($1,$2,'{\"role\":\"assistant\",\"content\":[]}')",vec![message.into(),chat.into()])).await.unwrap();
        let plan = json!({"operation":"collect_evidence","queryVariants":["quarterly"],"maxHits":10,"maxArtifacts":3,"maxBytes":4096,"executionSeconds":30,"expiresAt":chrono::Utc::now().timestamp()+1800});
        let checkpoint = checkpoint_fixture();
        let content = json!({"role":"assistant","content":[]});
        let id = park(
            db,
            Park {
                owner: "owner",
                chat_id: chat,
                message_id: message,
                generation_id: generation,
                tool_call_id: "tool-call",
                task_id: "task",
                plan: &plan,
                checkpoint: &checkpoint,
                message: &content,
            },
        )
        .await
        .unwrap();
        (id, chat, message, plan)
    }
    async fn bound_package(db: &DatabaseConnection, id: Uuid) -> Value {
        let job = bind_device(
            db,
            id,
            "owner",
            "https://erato.example",
            &"d".repeat(43),
            "https://app.example",
        )
        .await
        .unwrap();
        let bytes = b"Approved exact evidence";
        let mut package = json!({"binding":job.binding,"exportId":"e".repeat(43),"snapshotId":"s".repeat(43),"grantId":"g".repeat(43),"approvedAt":chrono::Utc::now().timestamp(),"expiresAt":job.plan["expiresAt"],"artifacts":[{"artifactId":"a".repeat(43),"filename":"evidence.txt","mediaType":"text/plain","sha256":contract::digest(bytes),"byteLength":bytes.len(),"contentBase64":STANDARD.encode(bytes)}]});
        package["manifestDigest"] = json!(contract::manifest_digest(&package).unwrap());
        package
    }
    fn receipt(claims: Value) -> Result<String> {
        contract::validate("receipt-claims", &claims)?;
        Ok(claims.to_string())
    }
    /// # Test Categories
    /// - `uses-db`
    #[sqlx::test(migrator = "MIGRATOR")]
    async fn result_and_intent_commit_once_across_connections(pool: sqlx::PgPool) {
        let db = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool.clone());
        let other = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool);
        let (id, _, _, _) = fixture(&db).await;
        let package = bound_package(&db, id).await;
        assert!(
            accept(&db, id, "other-owner", &package, receipt)
                .await
                .is_err()
        );
        assert!(
            bind_device(
                &db,
                id,
                "owner",
                "https://erato.example",
                &"x".repeat(43),
                "https://app.example"
            )
            .await
            .is_err()
        );
        assert!(
            accept(&db, id, "owner", &package, |_| Err(eyre!(
                "signer unavailable"
            )))
            .await
            .is_err()
        );
        assert_eq!(
            pending(&other, "owner").await.unwrap()[0].state,
            "waiting_for_local_result"
        );
        let (a, b) = tokio::join!(
            accept(&db, id, "owner", &package, receipt),
            accept(&other, id, "owner", &package, receipt)
        );
        let first = a.unwrap();
        assert_eq!(first, b.unwrap());
        assert_eq!(
            pending(&other, "owner").await.unwrap()[0].state,
            "awaiting_authenticated_resume"
        );
        let mut conflict = package.clone();
        conflict["exportId"] = json!("x".repeat(43));
        assert!(
            accept(&other, id, "owner", &conflict, receipt)
                .await
                .is_err()
        );
        assert_eq!(
            accept(&other, id, "owner", &package, receipt)
                .await
                .unwrap(),
            first
        );
        let row=db.query_one_raw(statement("SELECT relpersistence::text AS persistence FROM pg_class WHERE oid='local_delegation_jobs'::regclass",vec![])).await.unwrap().unwrap();
        assert_eq!(row.try_get::<String>("", "persistence").unwrap(), "p");
    }
    /// # Test Categories
    /// - `uses-db`
    #[sqlx::test(migrator = "MIGRATOR")]
    async fn recovery_requires_new_auth_lease_and_fences_stale_message_writes(pool: sqlx::PgPool) {
        let db = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool.clone());
        let other = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool);
        let (id, chat, message, _) = fixture(&db).await;
        let package = bound_package(&db, id).await;
        accept(&db, id, "owner", &package, receipt).await.unwrap();
        let generation = Uuid::new_v4();
        // The caller must first obtain the ordinary authenticated chat lease.
        assert!(claim_resume(&db, id, "owner", generation).await.is_err());
        db.execute_raw(statement(
            "UPDATE chats SET active_generation_id=$2,generation_state='running' WHERE id=$1",
            vec![chat.into(), generation.into()],
        ))
        .await
        .unwrap();
        let first = claim_resume(&db, id, "owner", generation).await.unwrap();
        assert!(claim_resume(&other, id, "owner", generation).await.is_err());
        db.execute_raw(statement(
            "UPDATE local_delegation_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
            vec![id.into()],
        ))
        .await
        .unwrap();
        recover(&other).await.unwrap();
        assert_eq!(
            pending(&db, "owner").await.unwrap()[0].state,
            "awaiting_authenticated_resume"
        );
        let next = Uuid::new_v4();
        db.execute_raw(statement(
            "UPDATE chats SET active_generation_id=$2 WHERE id=$1",
            vec![chat.into(), next.into()],
        ))
        .await
        .unwrap();
        let second = claim_resume(&other, id, "owner", next).await.unwrap();
        assert!(second.fence.token > first.fence.token);
        let content = json!({"role":"assistant","content":[{"type":"text","text":"Completed"}]});
        assert!(heartbeat(&db, first.fence).await.is_err());
        assert!(
            checkpoint(&db, first.fence, &first.checkpoint, &content)
                .await
                .is_err()
        );
        assert!(
            finish(&db, first.fence, &content, &json!({}))
                .await
                .is_err()
        );
        let mut regression = second.checkpoint.clone();
        regression.consumption.tool_calls = 0;
        assert!(
            checkpoint(&other, second.fence, &regression, &content)
                .await
                .is_err()
        );
        checkpoint(&other, second.fence, &second.checkpoint, &content)
            .await
            .unwrap();
        finish(&other, second.fence, &content, &json!({}))
            .await
            .unwrap();
        assert!(
            finish(&db, second.fence, &content, &json!({}))
                .await
                .is_err()
        );
        let persisted = db
            .query_one_raw(statement(
                "SELECT raw_message FROM messages WHERE id=$1",
                vec![message.into()],
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            persisted.try_get::<Value>("", "raw_message").unwrap(),
            content
        );
    }
    /// # Test Categories
    /// - `uses-db`
    #[sqlx::test(migrator = "MIGRATOR")]
    async fn cancelled_or_archived_jobs_reject_late_completion(pool: sqlx::PgPool) {
        let db = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool);
        for archived in [false, true] {
            let (id, chat, _, _) = fixture(&db).await;
            let package = bound_package(&db, id).await;
            if archived {
                db.execute_raw(statement(
                    "UPDATE chats SET archived_at=now() WHERE id=$1",
                    vec![chat.into()],
                ))
                .await
                .unwrap();
            } else {
                cancel(&db, id, "owner").await.unwrap();
                cancel(&db, id, "owner").await.unwrap();
            }
            assert!(accept(&db, id, "owner", &package, receipt).await.is_err());
        }
    }
}
