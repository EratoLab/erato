//! Native consent/export persistence only. The generic attempt owns every
//! execution, cancellation, expiry and continuation transition.
use super::{contract, signing::Signer, tool, uploads::PreparedFiles};
use crate::db::entity::{client_operation_attempts as attempts, local_evidence_exports as exports};
use crate::query_metrics::named_statement_from_sql_and_values;
use crate::services::client_operations::{
    self as operations, OperationOutcome, OperationRequest, OperationResult, OperationValue,
};
use eyre::{Result, eyre};
use sea_orm::{
    ConnectionTrait, DatabaseBackend, DatabaseConnection, EntityTrait, FromQueryResult,
    TransactionTrait, prelude::Uuid,
};
use serde_json::{Value, json};

fn statement(sql: &str, values: Vec<sea_orm::Value>) -> sea_orm::Statement {
    named_statement_from_sql_and_values(
        DatabaseBackend::Postgres,
        crate::metrics_constants::POSTGRES_QUERY_LOCAL_EVIDENCE,
        sql,
        values,
    )
}
fn conflict() -> eyre::Report {
    eyre!("Local evidence request could not be accepted")
}

pub struct NativeJob {
    pub request: OperationRequest,
    pub state: attempts::AttemptState,
    pub binding: Value,
    pub origin: String,
    pub plan: Value,
    pub receipt: Option<String>,
    pub server_outcome: Option<Value>,
}
fn native_job(row: attempts::Model, extension: exports::Model) -> Result<NativeJob> {
    let request: OperationRequest = serde_json::from_value(row.request)?;
    if request.kind != tool::KIND || request.operation_id != tool::QUALIFIED_NAME {
        return Err(conflict());
    }
    let server_outcome = row.result.as_ref().and_then(|result| {
        let code = result["error"]["code"].as_str()?;
        // These are server-authored outcomes, never device progress or errors.
        Some(json!({"status": if code == "expired" { "expired" } else { "cancelled" }}))
    });
    Ok(NativeJob {
        request,
        state: row.state,
        binding: extension.binding,
        origin: extension.origin,
        plan: extension.plan,
        receipt: extension.receipt,
        server_outcome,
    })
}
async fn extension<C: ConnectionTrait>(db: &C, id: Uuid) -> Result<exports::Model> {
    exports::Entity::find_by_id(id)
        .one(db)
        .await?
        .ok_or_else(conflict)
}
pub async fn get(db: &DatabaseConnection, owner: Uuid, id: Uuid) -> Result<NativeJob> {
    native_job(
        operations::store::get(db, owner, id).await?,
        extension(db, id).await?,
    )
}

/// A generic claim is required before issuing a native start authorization.
/// Capture the original execution identity once; later continuation generations
/// must not mutate fields that native consent signed.
pub async fn bind(
    db: &DatabaseConnection,
    owner: Uuid,
    id: Uuid,
    token: Uuid,
    backend_origin: &str,
    origin: &str,
) -> Result<NativeJob> {
    let tx = db.begin().await?;
    let row = operations::store::lock_attempt(&tx, owner, id).await?;
    let request: OperationRequest = serde_json::from_value(row.request.clone())?;
    let binding = &request.binding;
    if request.kind != tool::KIND
        || request.operation_id != tool::QUALIFIED_NAME
        || row.state != attempts::AttemptState::Claimed
        || row.claim_token != Some(token)
        || row.claim_binding.as_ref() != Some(&serde_json::to_value(binding)?)
        || row
            .claim_expires_at
            .is_none_or(|expiry| expiry <= chrono::Utc::now())
        || request.expires_at <= chrono::Utc::now()
        || binding
            .host_context
            .as_ref()
            .is_none_or(|host| host.kind != "origin" || host.identity != origin)
    {
        return Err(conflict());
    }
    let existing = exports::Entity::find_by_id(id).one(&tx).await?;
    let saved = if let Some(existing) = existing {
        existing
    } else {
        let plan = tool::request_plan(&request)?;
        let native_binding = json!({"backendOrigin":backend_origin,"accountId":owner,
            "deviceId":binding.device_id,"taskId":request.chat_id,"jobId":id,
            "attemptId":row.generation_id,"toolCallId":request.tool_call_id,
            "planDigest":contract::plan_digest(&plan)?});
        contract::validate("binding", &native_binding)?;
        tx.execute_raw(statement(
            "INSERT INTO local_evidence_exports(attempt_id,binding,origin,plan) VALUES($1,$2,$3,$4)",
            vec![id.into(),native_binding.into(),origin.into(),plan.into()])).await?;
        extension(&tx, id).await?
    };
    if saved.origin != origin
        || saved.binding["deviceId"] != binding.device_id
        || saved.binding["backendOrigin"] != backend_origin
    {
        return Err(conflict());
    }
    let job = native_job(row, saved)?;
    tx.commit().await?;
    Ok(job)
}

fn accepted(row: &attempts::Model, package: &Value) -> Result<Option<(String, OperationResult)>> {
    let Some(result) = &row.result else {
        return Ok(None);
    };
    let result: OperationResult = serde_json::from_value(result.clone())?;
    let Some(OperationValue::Receipt { receipt }) = &result.result else {
        return Err(conflict());
    };
    if receipt["package"] != *package {
        return Err(conflict());
    }
    Ok(Some((
        receipt["receipt"].as_str().ok_or_else(conflict)?.into(),
        result,
    )))
}
/// Lost-response retries remain valid after expiry and continuation. Different
/// payloads cannot replace a committed package, even under the same export ID.
pub async fn accepted_receipt(
    db: &DatabaseConnection,
    owner: Uuid,
    id: Uuid,
    token: Uuid,
    package: &Value,
) -> Result<Option<(String, OperationResult)>> {
    let row = operations::store::get(db, owner, id).await?;
    if row.claim_token != Some(token) {
        return Err(conflict());
    }
    accepted(&row, package)
}

pub struct ApprovedUpload<'a> {
    pub owner: Uuid,
    pub id: Uuid,
    pub token: Uuid,
    pub package: &'a Value,
    pub files: PreparedFiles,
}

pub async fn accept_files(
    db: &DatabaseConnection,
    registry: &operations::OperationRegistry,
    signer: &Signer,
    upload: ApprovedUpload<'_>,
) -> Result<(String, OperationResult)> {
    let ApprovedUpload {
        owner,
        id,
        token,
        package,
        files,
    } = upload;
    let tx = db.begin().await?;
    let row = operations::store::lock_attempt(&tx, owner, id).await?;
    if row.claim_token != Some(token) {
        return Err(conflict());
    }
    if let Some(accepted) = accepted(&row, package)? {
        return Ok(accepted);
    }
    let job = native_job(row, extension(&tx, id).await?)?;
    contract::validate_export(
        package,
        &job.binding,
        &job.plan,
        chrono::Utc::now().timestamp(),
    )?;
    let receipt = signer.sign(
        "receipt-claims",
        json!({"iss":job.binding["backendOrigin"],
        "aud":"erato-local-export-receipt-v1","binding":job.binding,"exportId":package["exportId"],
        "manifestDigest":package["manifestDigest"],"receiptId":Uuid::new_v4().simple().to_string(),
        "acceptedAt":chrono::Utc::now().timestamp()}),
    )?;
    let result = OperationResult {
        attempt_id: id,
        operation_id: job.request.operation_id,
        base_revision: job.request.base_revision,
        outcome: OperationOutcome::Succeeded,
        result: Some(OperationValue::Receipt {
            receipt: json!({"receipt":receipt,"package":package}),
        }),
        error: None,
        executor: job.request.binding,
    };
    // The same validator and claim fence protect /result and this attachment
    // adapter. Receipt, files and ready-to-continue intent commit atomically.
    operations::store::accept_in(&tx, registry, owner, token, &result).await?;
    for file in files.files {
        crate::models::file_upload::create_file_upload_record(
            &tx,
            file.id,
            owner.to_string(),
            &job.request.chat_id,
            file.filename,
            file.provider,
            file.path,
            None,
            None,
        )
        .await?;
    }
    tx.execute_raw(statement(
        "UPDATE local_evidence_exports SET receipt=$2,export_id=$3 WHERE attempt_id=$1",
        vec![
            id.into(),
            receipt.clone().into(),
            package["exportId"].as_str().ok_or_else(conflict)?.into(),
        ],
    ))
    .await?;
    tx.commit().await?;
    Ok((receipt, result))
}

/// Receipt/cancellation delivery to native may lag cloud continuation. Retain a
/// bounded recovery inbox even after the generic attempt is completed. No native
/// acknowledgement/status is posted upstream; identical native acks are harmless.
pub async fn receipts(
    db: &DatabaseConnection,
    owner: Uuid,
    after: Option<Uuid>,
) -> Result<Vec<NativeJob>> {
    let rows = attempts::Model::find_by_statement(statement(
        r#"
        SELECT a.* FROM client_operation_attempts a JOIN local_evidence_exports e USING(attempt_id)
        WHERE a.account_id=$1 AND a.result IS NOT NULL AND a.expires_at > now() - interval '7 days'
          AND ($2::uuid IS NULL OR a.attempt_id > $2)
        ORDER BY a.attempt_id LIMIT 100
    "#,
        vec![owner.into(), after.into()],
    ))
    .all(db)
    .await?;
    let mut jobs = Vec::new();
    for row in rows {
        let saved = extension(db, row.attempt_id).await?;
        jobs.push(native_job(row, saved)?);
    }
    Ok(jobs)
}
