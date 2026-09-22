//! Logged job/checkpoint persistence. Every result and continuation transition is
//! persisted in PostgreSQL for one backend replica. Continuations reuse the
//! existing chat generation identity and lifecycle; no separate job lease exists.
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
    pub id: Uuid,
    pub previous: Option<Fence>,
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
    let id = input.id;
    if let Some(previous) = input.previous {
        lock_fence(&tx, previous).await?;
        let row = tx
            .query_one_raw(statement(
                "SELECT checkpoint,message_id FROM local_delegation_jobs WHERE id=$1 FOR UPDATE",
                vec![previous.job_id.into()],
            ))
            .await?
            .ok_or_else(conflict)?;
        let prior: Checkpoint = serde_json::from_value(row.try_get("", "checkpoint")?)?;
        if row.try_get::<Uuid>("", "message_id")? != input.message_id
            || !preserves_authority(input.checkpoint, &prior)
            || prior.model_finished
        {
            return Err(conflict());
        }
        let changed = tx.execute_raw(statement(&format!("UPDATE local_delegation_jobs j SET state='completed' FROM chats c WHERE {FENCED}"),fence_values(previous))).await?;
        if changed.rows_affected() != 1 {
            return Err(conflict());
        }
    }
    let inserted=tx.execute_raw(statement("INSERT INTO local_delegation_jobs(id,owner_user_id,chat_id,message_id,tool_call_id,attempt_id,task_id,plan,checkpoint,expires_at,generation_id) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,to_timestamp($10::bigint),$11 WHERE $10>extract(epoch from now()) AND $10<=extract(epoch from now())+604800 ON CONFLICT(message_id,tool_call_id) DO NOTHING",vec![id.into(),input.owner.into(),input.chat_id.into(),input.message_id.into(),input.tool_call_id.into(),Uuid::new_v4().into(),input.task_id.into(),input.plan.clone().into(),checkpoint.into(),input.plan["expiresAt"].as_i64().ok_or_else(conflict)?.into(),input.generation_id.into()])).await?;
    if inserted.rows_affected() != 1 {
        return Err(conflict());
    }
    let updated = tx
        .execute_raw(statement(
            "UPDATE messages SET raw_message=$3,generation_metadata=$4 WHERE id=$1 AND chat_id=$2",
            vec![
                input.message_id.into(),
                input.chat_id.into(),
                input.message.clone().into(),
                serde_json::to_value(&input.checkpoint.generation_metadata)?.into(),
            ],
        ))
        .await?;
    if updated.rows_affected() != 1 {
        return Err(conflict());
    }
    // The running chat lease is released by the generation lifecycle AFTER this
    // commit and its final event. A crash in between is recovered from this row;
    // a frontend cannot resume while the old worker is still finalizing.
    tx.commit().await?;
    Ok(id)
}

pub async fn pending(
    db: &DatabaseConnection,
    owner: &str,
    after: Option<Uuid>,
) -> Result<Vec<PendingJob>> {
    let rows=db.query_all_raw(statement("SELECT j.* FROM local_delegation_jobs j JOIN chats c ON c.id=j.chat_id WHERE j.owner_user_id=$1 AND c.owner_user_id=$1 AND c.archived_at IS NULL AND (j.state IN ('awaiting_authenticated_resume','continuing') OR (j.state='waiting_for_local_result' AND j.expires_at>now()) OR (j.state IN ('completed','cancelled') AND (j.receipt IS NOT NULL OR j.server_outcome IS NOT NULL) AND j.expires_at>now()-interval '7 days')) AND ($2::uuid IS NULL OR j.id>$2) ORDER BY j.id LIMIT 128",vec![owner.into(),after.into()])).await?;
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
#[cfg(test)]
pub async fn accept(
    db: &DatabaseConnection,
    id: Uuid,
    owner: &str,
    package: &Value,
    sign: impl FnOnce(Value) -> Result<String>,
) -> Result<String> {
    accept_files(
        db,
        id,
        owner,
        package,
        super::uploads::PreparedFiles { files: vec![] },
        sign,
    )
    .await
}
/// Read-only fast path for lost receipts, even after expiry or continuation.
pub async fn accepted_receipt(
    db: &DatabaseConnection,
    id: Uuid,
    owner: &str,
    package: &Value,
) -> Result<Option<String>> {
    let job = get(db, id, owner).await?;
    if job.receipt.is_none() {
        return Ok(None);
    }
    let row = db
        .query_one_raw(statement(
            "SELECT approved_export FROM local_delegation_jobs WHERE id=$1 AND owner_user_id=$2",
            vec![id.into(), owner.into()],
        ))
        .await?
        .ok_or_else(conflict)?;
    if row.try_get::<Value>("", "approved_export")? != *package {
        return Err(conflict());
    }
    Ok(job.receipt)
}
pub async fn accept_files(
    db: &DatabaseConnection,
    id: Uuid,
    owner: &str,
    package: &Value,
    files: super::uploads::PreparedFiles,
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
    // File metadata, attachment links, exact result, receipt and resume intent
    // have one logged commit. No visible duplicate files on retry.
    for file in files.files {
        tx.execute_raw(statement("INSERT INTO file_uploads(id,owner_user_id,filename,file_storage_provider_id,file_storage_path) VALUES($1,$2,$3,$4,$5)",vec![file.id.into(),owner.into(),file.filename.into(),file.provider.into(),file.path.into()])).await?;
        tx.execute_raw(statement(
            "INSERT INTO chat_file_uploads(chat_id,file_upload_id) VALUES($1,$2)",
            vec![job.chat_id.into(), file.id.into()],
        ))
        .await?;
    }
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
}
pub struct Resume {
    pub fence: Fence,
    pub checkpoint: Checkpoint,
    pub package: Option<Value>,
    pub job: PendingJob,
}
#[cfg(test)]
async fn claim_resume(
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
    tx.query_one_raw(statement("UPDATE local_delegation_jobs j SET state='continuing',generation_id=$3 FROM chats c WHERE j.id=$1 AND j.owner_user_id=$2 AND c.id=j.chat_id AND c.active_generation_id=$3 AND c.generation_state='running' AND j.state='awaiting_authenticated_resume' RETURNING j.id",vec![id.into(),owner.into(),generation_id.into()])).await?.ok_or_else(conflict)?;
    let fence = Fence {
        job_id: id,
        generation_id,
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
/// Read the checkpoint after the existing BackgroundTaskManager claims its generation.
pub async fn claimed(
    db: &DatabaseConnection,
    id: Uuid,
    owner: &str,
    generation_id: Uuid,
) -> Result<Resume> {
    let tx = db.begin().await?;
    let row = lock_job(&tx, id, owner).await?;
    let checkpoint: Checkpoint = serde_json::from_value(row.try_get("", "checkpoint")?)?;
    let package: Option<Value> = row.try_get("", "approved_export")?;
    let fence = Fence {
        job_id: id,
        generation_id,
    };
    lock_fence(&tx, fence).await?;
    let job = PendingJob::from_row(row)?;
    tx.commit().await?;
    Ok(Resume {
        fence,
        checkpoint,
        package,
        job,
    })
}
const FENCED: &str = "j.id=$1 AND j.generation_id=$2 AND j.state='continuing' AND c.id=j.chat_id AND c.active_generation_id=$2 AND c.generation_state='running' AND c.archived_at IS NULL";
fn fence_values(fence: Fence) -> Vec<sea_orm::Value> {
    vec![fence.job_id.into(), fence.generation_id.into()]
}
async fn lock_fence(tx: &DatabaseTransaction, fence: Fence) -> Result<()> {
    // Lock the chat too: an UPDATE .. FROM predicate alone does not serialize
    // with a concurrent generation takeover that changes the joined chat row.
    tx.query_one_raw(statement(&format!("SELECT c.id FROM local_delegation_jobs j JOIN chats c ON c.id=j.chat_id WHERE {FENCED} FOR UPDATE OF c"),fence_values(fence))).await?.ok_or_else(conflict)?;
    Ok(())
}
#[cfg(test)]
async fn ensure_current(db: &DatabaseConnection, fence: Fence) -> Result<()> {
    let tx = db.begin().await?;
    lock_fence(&tx, fence).await?;
    tx.commit().await?;
    Ok(())
}
fn preserves_authority(next: &Checkpoint, previous: &Checkpoint) -> bool {
    next.version == 1
        && next.consumption.preserves(&previous.consumption)
        && next.model_id == previous.model_id
        && next.origin_user_message_id == previous.origin_user_message_id
        && next.max_tool_calls == previous.max_tool_calls
        && next.max_model_turns == previous.max_model_turns
        && next.selected_facets == previous.selected_facets
        && next.task_client_budget == previous.task_client_budget
        && next.task_server_budget == previous.task_server_budget
        && next
            .allowed_tools
            .iter()
            .all(|tool| previous.allowed_tools.contains(tool))
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
    if !preserves_authority(checkpoint, &previous)
        || (previous.result_applied && !checkpoint.result_applied)
        || (previous.model_finished && !checkpoint.model_finished)
    {
        return Err(conflict());
    }
    let mut values = fence_values(fence);
    let serialized = serde_json::to_value(checkpoint)?;
    if serde_json::to_vec(&serialized)?.len() > 32 * 1024 * 1024 {
        return Err(conflict());
    }
    values.push(serialized.into());
    let row=tx.query_one_raw(statement(&format!("UPDATE local_delegation_jobs j SET checkpoint=$3 FROM chats c WHERE {FENCED} AND ($3->'consumption'->>'tool_calls')::bigint >= (j.checkpoint->'consumption'->>'tool_calls')::bigint AND ($3->'consumption'->>'model_turns')::bigint >= (j.checkpoint->'consumption'->>'model_turns')::bigint RETURNING j.message_id"),values)).await?.ok_or_else(conflict)?;
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
    let row=tx.query_one_raw(statement(&format!("UPDATE local_delegation_jobs j SET state='completed' FROM chats c WHERE {FENCED} RETURNING j.message_id"),fence_values(fence))).await?.ok_or_else(conflict)?;
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
    tx.execute_raw(statement("UPDATE chats c SET generation_state='completed',generation_ended_at=now() FROM local_delegation_jobs j WHERE j.id=$1 AND c.id=j.chat_id AND c.active_generation_id=$2",vec![fence.job_id.into(),fence.generation_id.into()])).await?;
    tx.commit().await?;
    Ok(())
}
/// Called only inside the chat lease transaction or an authenticated owner abort.
/// Persist the terminal decision and settle its visible tool part before another
/// generation can replace this task. Native cancellation is reconciled on return.
pub(crate) async fn abandon_in<C: ConnectionTrait>(db: &C, chat_id: Uuid) -> Result<u64> {
    let rows=db.query_all_raw(statement("UPDATE local_delegation_jobs SET state='cancelled',server_outcome='{\"status\":\"cancelled\"}' WHERE chat_id=$1 AND state IN ('waiting_for_local_result','awaiting_authenticated_resume','continuing') RETURNING message_id,tool_call_id",vec![chat_id.into()])).await?;
    for row in &rows {
        let message_id: Uuid = row.try_get("", "message_id")?;
        let call_id: String = row.try_get("", "tool_call_id")?;
        let message = db
            .query_one_raw(statement(
                "SELECT raw_message FROM messages WHERE id=$1 FOR UPDATE",
                vec![message_id.into()],
            ))
            .await?
            .ok_or_else(conflict)?;
        let mut parsed =
            crate::models::message::MessageSchema::validate(&message.try_get("", "raw_message")?)?;
        for part in &mut parsed.content {
            if let crate::models::message::ContentPart::ToolUse(tool) = part
                && tool.tool_call_id == call_id
                && matches!(
                    tool.status,
                    crate::models::message::ToolCallStatus::Preparing
                        | crate::models::message::ToolCallStatus::InProgress
                )
            {
                tool.status = crate::models::message::ToolCallStatus::Error;
                tool.output = Some(json!({"status":"cancelled"}));
                tool.progress = None;
                tool.progress_message = None;
                tool.total = None;
                tool.ended_at = Some(chrono::Utc::now().to_rfc3339());
            }
        }
        parsed
            .content
            .push(crate::models::message::ContentPart::Text(
                crate::models::message::ContentPartText {
                    text: "Local research was cancelled.".into(),
                },
            ));
        db.execute_raw(statement(
            "UPDATE messages SET raw_message=$2 WHERE id=$1",
            vec![message_id.into(), parsed.to_json()?.into()],
        ))
        .await?;
    }
    Ok(rows.len() as u64)
}
pub async fn abort_chat(db: &DatabaseConnection, chat_id: Uuid, owner: &str) -> Result<bool> {
    let tx = db.begin().await?;
    if tx.query_one_raw(statement("SELECT id FROM chats WHERE id=$1 AND owner_user_id=$2 AND archived_at IS NULL FOR UPDATE",vec![chat_id.into(),owner.into()])).await?.is_none(){return Err(conflict());}
    let changed = abandon_in(&tx, chat_id).await? > 0;
    if changed {
        tx.execute_raw(statement(
            "UPDATE chats SET generation_state='completed',generation_ended_at=now() WHERE id=$1",
            vec![chat_id.into()],
        ))
        .await?;
    }
    tx.commit().await?;
    Ok(changed)
}
pub async fn cancel(db: &DatabaseConnection, id: Uuid, owner: &str) -> Result<Option<Uuid>> {
    let tx = db.begin().await?;
    lock_job(&tx, id, owner).await?;
    let row = tx.query_one_raw(statement("UPDATE local_delegation_jobs SET state='awaiting_authenticated_resume',server_outcome='{\"status\":\"cancelled\"}' WHERE id=$1 AND state NOT IN ('completed','cancelled','expired') AND server_outcome IS NULL RETURNING generation_id",vec![id.into()])).await?;
    let generation_id: Option<Uuid> = row
        .map(|row| row.try_get("", "generation_id"))
        .transpose()?
        .flatten();
    tx.commit().await?;
    Ok(generation_id)
}
/// Database-only recovery records a need for live authentication; it cannot
/// launch a cloud generation or reconstruct authority from a stored subject ID.
pub async fn recover(db: &DatabaseConnection, stale_after_secs: u64) -> Result<()> {
    let tx = db.begin().await?;
    // Serialize recovery with normal cancellation/new-turn/checkpoint writes.
    // Lock chats first, matching the existing generation transaction's order.
    tx.query_all_raw(statement("SELECT c.id FROM chats c WHERE EXISTS (SELECT 1 FROM local_delegation_jobs j WHERE j.chat_id=c.id AND j.state IN ('waiting_for_local_result','awaiting_authenticated_resume','continuing')) ORDER BY c.id FOR UPDATE",vec![])).await?;
    tx.execute_raw(statement("UPDATE local_delegation_jobs j SET state=CASE WHEN c.archived_at IS NOT NULL OR c.owner_user_id<>j.owner_user_id THEN 'cancelled' ELSE 'awaiting_authenticated_resume' END,server_outcome=CASE WHEN j.state='waiting_for_local_result' AND j.expires_at<=now() THEN '{\"status\":\"expired\"}'::jsonb ELSE j.server_outcome END FROM chats c WHERE c.id=j.chat_id AND j.state IN ('waiting_for_local_result','awaiting_authenticated_resume','continuing') AND (c.archived_at IS NOT NULL OR c.owner_user_id<>j.owner_user_id OR (j.state='waiting_for_local_result' AND j.expires_at<=now()) OR (j.state='continuing' AND (j.generation_id IS DISTINCT FROM c.active_generation_id OR c.generation_state IS DISTINCT FROM 'running' OR COALESCE(c.generation_heartbeat_at,c.generation_started_at,'epoch'::timestamptz)<now()-make_interval(secs=>$1::double precision))))",vec![(stale_after_secs as f64).into()])).await?;
    tx.commit().await?;
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
            selected_facets: vec![],
            max_tool_calls: 20,
            max_model_turns: 22,
            result_applied: false,
            model_finished: false,
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
                id: Uuid::new_v4(),
                previous: None,
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
            pending(&other, "owner", None).await.unwrap()[0].state,
            "waiting_for_local_result"
        );
        let (a, b) = tokio::join!(
            accept(&db, id, "owner", &package, receipt),
            accept(&other, id, "owner", &package, receipt)
        );
        let first = a.unwrap();
        assert_eq!(first, b.unwrap());
        assert_eq!(
            pending(&other, "owner", None).await.unwrap()[0].state,
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
    async fn recovery_requires_fresh_auth_and_rejects_superseded_generation_writes(
        pool: sqlx::PgPool,
    ) {
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
            "UPDATE chats SET generation_state='errored' WHERE id=(SELECT chat_id FROM local_delegation_jobs WHERE id=$1)",
            vec![id.into()],
        ))
        .await
        .unwrap();
        recover(&other, 90).await.unwrap();
        assert_eq!(
            pending(&db, "owner", None).await.unwrap()[0].state,
            "awaiting_authenticated_resume"
        );
        let next = Uuid::new_v4();
        db.execute_raw(statement(
            "UPDATE chats SET active_generation_id=$2,generation_state='running' WHERE id=$1",
            vec![chat.into(), next.into()],
        ))
        .await
        .unwrap();
        let second = claim_resume(&other, id, "owner", next).await.unwrap();
        assert_ne!(second.fence.generation_id, first.fence.generation_id);
        let content = json!({"role":"assistant","content":[{"type":"text","text":"Completed"}]});
        assert!(ensure_current(&db, first.fence).await.is_err());
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
    #[sqlx::test(migrator = "MIGRATOR")]
    async fn attachments_and_receipt_finalize_together_and_survive_lost_ack(pool: sqlx::PgPool) {
        use super::super::uploads::{PreparedFile, PreparedFiles, file_id};
        let db = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool);
        let (id, chat, _, _) = fixture(&db).await;
        let package = bound_package(&db, id).await;
        let fid = file_id(
            id,
            package["exportId"].as_str().unwrap(),
            "artifact",
            "digest",
        );
        let files = || PreparedFiles {
            files: vec![PreparedFile {
                id: fid,
                filename: "evidence.txt".into(),
                provider: "test".into(),
                path: format!("local-delegation/{id}/{fid}"),
            }],
        };
        assert!(
            accept_files(&db, id, "owner", &package, files(), |_| Err(eyre!(
                "commit injection"
            )))
            .await
            .is_err()
        );
        assert!(
            db.query_one_raw(statement(
                "SELECT id FROM file_uploads WHERE id=$1",
                vec![fid.into()]
            ))
            .await
            .unwrap()
            .is_none()
        );
        let receipt = accept_files(&db, id, "owner", &package, files(), receipt)
            .await
            .unwrap();
        assert_eq!(
            accept_files(&db, id, "owner", &package, files(), |_| panic!(
                "must reuse receipt"
            ))
            .await
            .unwrap(),
            receipt
        );
        assert!(db.query_one_raw(statement("SELECT file_upload_id FROM chat_file_uploads WHERE chat_id=$1 AND file_upload_id=$2",vec![chat.into(),fid.into()])).await.unwrap().is_some());
        let generation = Uuid::new_v4();
        db.execute_raw(statement(
            "UPDATE chats SET active_generation_id=$2,generation_state='running' WHERE id=$1",
            vec![chat.into(), generation.into()],
        ))
        .await
        .unwrap();
        let claim = claim_resume(&db, id, "owner", generation).await.unwrap();
        finish(
            &db,
            claim.fence,
            &json!({"role":"assistant","content":[]}),
            &json!({}),
        )
        .await
        .unwrap();
        assert_eq!(
            pending(&db, "owner", None).await.unwrap()[0].state,
            "completed"
        );
        assert_eq!(
            accepted_receipt(&db, id, "owner", &package).await.unwrap(),
            Some(receipt)
        );
        assert!(
            bind_device(
                &db,
                id,
                "owner",
                "https://erato.example",
                &"d".repeat(43),
                "https://app.example"
            )
            .await
            .is_ok()
        );
    }
    #[sqlx::test(migrator = "MIGRATOR")]
    async fn repeated_local_search_atomically_transfers_checkpoint_and_fences_predecessor(
        pool: sqlx::PgPool,
    ) {
        let db = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool);
        let (id, chat, message, plan) = fixture(&db).await;
        let package = bound_package(&db, id).await;
        accept(&db, id, "owner", &package, receipt).await.unwrap();
        let generation = Uuid::new_v4();
        db.execute_raw(statement(
            "UPDATE chats SET active_generation_id=$2,generation_state='running' WHERE id=$1",
            vec![chat.into(), generation.into()],
        ))
        .await
        .unwrap();
        let claim = claim_resume(&db, id, "owner", generation).await.unwrap();
        let mut next = claim.checkpoint.clone();
        next.consumption.client_tool_calls += 1;
        next.consumption.tool_calls += 1;
        let next_id = Uuid::new_v4();
        park(
            &db,
            Park {
                id: next_id,
                previous: Some(claim.fence),
                owner: "owner",
                chat_id: chat,
                message_id: message,
                generation_id: generation,
                tool_call_id: "next-call",
                task_id: "task",
                plan: &plan,
                checkpoint: &next,
                message: &json!({"role":"assistant","content":[]}),
            },
        )
        .await
        .unwrap();
        assert_eq!(get(&db, id, "owner").await.unwrap().state, "completed");
        assert_eq!(
            get(&db, next_id, "owner").await.unwrap().state,
            "waiting_for_local_result"
        );
        assert!(ensure_current(&db, claim.fence).await.is_err());
        assert!(
            finish(&db, claim.fence, &json!({"overwritten":true}), &json!({}))
                .await
                .is_err()
        );
    }
    #[tokio::test]
    #[ignore = "subprocess fixture launched only by local_receipt_survives_process_death"]
    async fn local_crash_writer_fixture() {
        let Ok(url) = std::env::var("ERATO_LOCAL_JOB_CRASH_DB") else {
            return;
        };
        let id: Uuid = std::env::var("ERATO_LOCAL_JOB_CRASH_ID")
            .unwrap()
            .parse()
            .unwrap();
        let db = sea_orm::Database::connect(url).await.unwrap();
        let package = bound_package(&db, id).await;
        accept(&db, id, "owner", &package, receipt).await.unwrap();
        use std::io::Write;
        println!("DURABLE_LOCAL_RECEIPT_COMMITTED");
        std::io::stdout().flush().unwrap();
        std::future::pending::<()>().await;
    }

    /// # Test Categories
    /// - `uses-db`
    #[sqlx::test(migrator = "MIGRATOR")]
    async fn local_receipt_survives_process_death(pool: sqlx::PgPool) {
        use tokio::io::{AsyncBufReadExt, BufReader};
        let mut url = url::Url::parse(&std::env::var("DATABASE_URL").unwrap()).unwrap();
        url.set_path(pool.connect_options().get_database().unwrap());
        let db = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool);
        let (id, _, _, _) = fixture(&db).await;
        let mut child = tokio::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "services::local_delegation::store::tests::local_crash_writer_fixture",
                "--ignored",
                "--nocapture",
            ])
            .env("ERATO_LOCAL_JOB_CRASH_DB", url.as_str())
            .env("ERATO_LOCAL_JOB_CRASH_ID", id.to_string())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
        tokio::time::timeout(std::time::Duration::from_secs(20), async {
            while let Some(line) = lines.next_line().await.unwrap() {
                if line == "DURABLE_LOCAL_RECEIPT_COMMITTED" {
                    return;
                }
            }
            panic!("receipt writer exited before durable commit");
        })
        .await
        .unwrap();
        child.kill().await.unwrap();
        let _ = child.wait().await.unwrap();
        let fresh = sea_orm::Database::connect(url.as_str()).await.unwrap();
        let job = get(&fresh, id, "owner").await.unwrap();
        assert_eq!(job.state, "awaiting_authenticated_resume");
        assert!(job.receipt.is_some());
        let row = fresh
            .query_one_raw(statement(
                "SELECT approved_export FROM local_delegation_jobs WHERE id=$1",
                vec![id.into()],
            ))
            .await
            .unwrap()
            .unwrap();
        let package: Value = row.try_get("", "approved_export").unwrap();
        assert_eq!(
            accepted_receipt(&fresh, id, "owner", &package)
                .await
                .unwrap(),
            job.receipt
        );
    }

    /// # Test Categories
    /// - `uses-db`
    #[sqlx::test(migrator = "MIGRATOR")]
    async fn local_resume_reuses_chat_generation_and_rejects_duplicate_or_superseded_work(
        pool: sqlx::PgPool,
    ) {
        use crate::services::background_tasks::{BackgroundTaskManager, Takeover};
        let db = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool);
        let (id, chat, message, _) = fixture(&db).await;
        let package = bound_package(&db, id).await;
        accept(&db, id, "owner", &package, receipt).await.unwrap();
        db.execute_raw(statement(
            "UPDATE chats SET generation_state='awaiting_approval' WHERE id=$1",
            vec![chat.into()],
        ))
        .await
        .unwrap();
        let a = BackgroundTaskManager::new(Some(db.clone()), Default::default(), None);
        assert!(
            a.try_start_task(chat, message, Takeover::ResumeLocalJob(Uuid::new_v4()), 90)
                .await
                .is_err()
        );
        let (first, second) = tokio::join!(
            a.try_start_task(chat, message, Takeover::ResumeLocalJob(id), 90),
            a.try_start_task(chat, message, Takeover::ResumeLocalJob(id), 90),
        );
        assert_ne!(first.is_ok(), second.is_ok());
        let (_, task) = first.or(second).unwrap();
        let old = claimed(&db, id, "owner", task.generation_id).await.unwrap();
        ensure_current(&db, old.fence).await.unwrap();
        task.request_abort();
        db.execute_raw(statement(
            "UPDATE chats SET generation_heartbeat_at=now()-interval '5 minutes' WHERE id=$1",
            vec![chat.into()],
        ))
        .await
        .unwrap();
        db.execute_raw(statement(
            "UPDATE chats SET generation_state='errored' WHERE id=(SELECT chat_id FROM local_delegation_jobs WHERE id=$1)",
            vec![id.into()],
        ))
        .await
        .unwrap();
        recover(&db, 90).await.unwrap();
        drop(a);
        let restarted = BackgroundTaskManager::new(Some(db.clone()), Default::default(), None);
        let (_, next) = restarted
            .try_start_task(chat, message, Takeover::ResumeLocalJob(id), 90)
            .await
            .unwrap();
        let current = claimed(&db, id, "owner", next.generation_id).await.unwrap();
        assert_ne!(current.fence.generation_id, old.fence.generation_id);
        assert!(ensure_current(&db, old.fence).await.is_err());
        assert!(
            finish(&db, old.fence, &json!({}), &json!({}))
                .await
                .is_err()
        );
        assert!(abort_chat(&db, chat, "other-owner").await.is_err());
        assert!(abort_chat(&db, chat, "owner").await.unwrap());
        assert!(ensure_current(&db, current.fence).await.is_err());
        assert_eq!(get(&db, id, "owner").await.unwrap().state, "cancelled");
        next.request_abort();

        let (replacement_id, replacement_chat, replacement_message, _) = fixture(&db).await;
        db.execute_raw(statement(
            "UPDATE chats SET generation_state='awaiting_approval' WHERE id=$1",
            vec![replacement_chat.into()],
        ))
        .await
        .unwrap();
        let (_, replacement) = restarted
            .try_start_task(
                replacement_chat,
                replacement_message,
                Takeover::TakeParked,
                90,
            )
            .await
            .unwrap();
        assert_eq!(
            get(&db, replacement_id, "owner").await.unwrap().state,
            "cancelled"
        );
        assert!(
            restarted
                .try_start_task(
                    replacement_chat,
                    replacement_message,
                    Takeover::ResumeLocalJob(replacement_id),
                    90
                )
                .await
                .is_err()
        );
        replacement.request_abort();
        let memory_only = BackgroundTaskManager::new(None, Default::default(), None);
        assert!(
            memory_only
                .try_start_task(
                    Uuid::new_v4(),
                    Uuid::new_v4(),
                    Takeover::ResumeLocalJob(id),
                    90
                )
                .await
                .is_err()
        );
    }

    #[sqlx::test(migrator = "MIGRATOR")]
    async fn expiry_records_only_a_server_outcome_and_requires_authenticated_resume(
        pool: sqlx::PgPool,
    ) {
        let db = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool);
        let (id, _, _, _) = fixture(&db).await;
        db.execute_raw(statement(
            "UPDATE local_delegation_jobs SET expires_at=now()-interval '1 second' WHERE id=$1",
            vec![id.into()],
        ))
        .await
        .unwrap();
        recover(&db, 90).await.unwrap();
        let job = get(&db, id, "owner").await.unwrap();
        assert_eq!(job.state, "awaiting_authenticated_resume");
        assert_eq!(job.server_outcome, Some(json!({"status":"expired"})));
        assert!(job.receipt.is_none());
        assert!(
            claim_resume(&db, id, "owner", Uuid::new_v4())
                .await
                .is_err()
        );
    }
}
