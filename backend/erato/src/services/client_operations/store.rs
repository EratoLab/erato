use super::*;
use crate::db::entity::{client_operation_attempts as attempts, messages};
use crate::models::message::{ContentPart, MessageSchema, ToolCallStatus as MessageToolCallStatus};
use crate::query_metrics::named_statement_from_sql_and_values;
pub use attempts::AttemptState;
use eyre::{Report, eyre};
use sea_orm::{
    ConnectionTrait, DatabaseBackend, DatabaseConnection, DatabaseTransaction, EntityTrait,
    FromQueryResult, TransactionTrait,
};

fn statement(id: &'static str, sql: &str, values: Vec<sea_orm::Value>) -> sea_orm::Statement {
    named_statement_from_sql_and_values(DatabaseBackend::Postgres, id, sql, values)
}

async fn get_in<C: ConnectionTrait>(
    db: &C,
    account_id: Uuid,
    attempt_id: Uuid,
    lock: bool,
) -> Result<attempts::Model, Report> {
    let sql = if lock {
        "SELECT * FROM client_operation_attempts WHERE account_id = $1 AND attempt_id = $2 FOR UPDATE"
    } else {
        "SELECT * FROM client_operation_attempts WHERE account_id = $1 AND attempt_id = $2"
    };
    attempts::Model::find_by_statement(statement(
        "client_operations.get",
        sql,
        vec![account_id.into(), attempt_id.into()],
    ))
    .one(db)
    .await?
    .ok_or_else(|| eyre!("Operation not found"))
}

pub async fn get(
    db: &DatabaseConnection,
    account_id: Uuid,
    attempt_id: Uuid,
) -> Result<attempts::Model, Report> {
    get_in(db, account_id, attempt_id, false).await
}

/// Pure read: no global recovery writes on account polling.
pub async fn list(
    db: &DatabaseConnection,
    account_id: Uuid,
    after: Option<Uuid>,
) -> Result<Vec<attempts::Model>, Report> {
    Ok(attempts::Model::find_by_statement(statement(
        "client_operations.list",
        r#"
        SELECT a.* FROM client_operation_attempts a JOIN chats c ON c.id = a.chat_id
        WHERE a.account_id = $1 AND a.state <> 'completed' AND c.archived_at IS NULL
          AND ($2::uuid IS NULL OR a.attempt_id > $2)
        ORDER BY a.attempt_id LIMIT 100
    "#,
        vec![account_id.into(), after.into()],
    ))
    .all(db)
    .await?)
}

pub async fn for_call(
    db: &DatabaseConnection,
    account_id: Uuid,
    message_id: Uuid,
    call_id: &str,
) -> Result<Option<attempts::Model>, Report> {
    Ok(attempts::Model::find_by_statement(statement("client_operations.for_call",
        "SELECT * FROM client_operation_attempts WHERE account_id = $1 AND message_id = $2 AND tool_call_id = $3",
        vec![account_id.into(), message_id.into(), call_id.into()])).one(db).await?)
}

/// Lock order matches the generation lease: advisory chat lock, chat, attempt,
/// message. Never lock an account's other chats while handling one operation.
async fn lock_chat(
    tx: &DatabaseTransaction,
    chat_id: Uuid,
    account_id: Uuid,
) -> Result<(), Report> {
    tx.query_one_raw(statement(
        "client_operations.lock",
        "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
        vec![chat_id.to_string().into()],
    ))
    .await?;
    let row = tx
        .query_one_raw(statement(
            "client_operations.lock",
            "SELECT id FROM chats WHERE id = $1 AND owner_user_id = $2 FOR UPDATE",
            vec![chat_id.into(), account_id.to_string().into()],
        ))
        .await?;
    if row.is_none() {
        return Err(eyre!("Operation not found"));
    }
    Ok(())
}

/// Acquire the shared chat/attempt fence before a kind writes its extension.
pub async fn lock_attempt(
    tx: &DatabaseTransaction,
    account_id: Uuid,
    attempt_id: Uuid,
) -> Result<attempts::Model, Report> {
    let initial = get_in(tx, account_id, attempt_id, false).await?;
    lock_chat(tx, initial.chat_id, account_id).await?;
    get_in(tx, account_id, attempt_id, true).await
}

pub async fn save_consumption<C: ConnectionTrait>(
    db: &C,
    message_id: Uuid,
    generation_id: Uuid,
    consumption: &TurnConsumption,
) -> Result<(), Report> {
    let updated = db
        .execute_raw(statement(
            "client_operations.consumption",
            r#"
        UPDATE messages m SET generation_parameters = jsonb_set(
            COALESCE(m.generation_parameters, '{}'::jsonb), '{turn_consumption}', $3)
        FROM chats c WHERE m.id = $1 AND c.id = m.chat_id AND c.active_generation_id = $2
    "#,
            vec![
                message_id.into(),
                generation_id.into(),
                serde_json::to_value(consumption)?.into(),
            ],
        ))
        .await?;
    if updated.rows_affected() != 1 {
        return Err(eyre!("Generation ownership changed"));
    }
    Ok(())
}

pub async fn park(
    db: &DatabaseConnection,
    request: &OperationRequest,
    generation_id: Uuid,
    content: &[ContentPart],
    consumption: &TurnConsumption,
) -> Result<(), Report> {
    let tx = db.begin().await?;
    lock_chat(&tx, request.chat_id, request.account_id).await?;
    let owns = tx
        .query_one_raw(statement(
            "client_operations.park",
            r#"
        SELECT id FROM chats WHERE id = $1 AND active_generation_id = $2
        AND generation_state = 'running' AND archived_at IS NULL
    "#,
            vec![request.chat_id.into(), generation_id.into()],
        ))
        .await?;
    if owns.is_none() {
        return Err(eyre!("Generation ownership changed"));
    }
    save_consumption(&tx, request.message_id, generation_id, consumption).await?;
    tx.execute_raw(statement(
        "client_operations.park",
        r#"
        UPDATE messages SET raw_message = jsonb_set(raw_message, '{content}', $2)
        WHERE id = $1 AND chat_id = $3
    "#,
        vec![
            request.message_id.into(),
            serde_json::to_value(content)?.into(),
            request.chat_id.into(),
        ],
    ))
    .await?;
    tx.execute_raw(statement("client_operations.park", "UPDATE client_operation_attempts SET state = 'completed' WHERE message_id = $1 AND state = 'continuing' AND generation_id = $2", vec![request.message_id.into(), generation_id.into()])).await?;
    tx.execute_raw(statement("client_operations.park", r#"
        INSERT INTO client_operation_attempts
          (attempt_id, account_id, chat_id, message_id, tool_call_id, generation_id, request, state, expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8)
    "#, vec![request.attempt_id.into(), request.account_id.into(), request.chat_id.into(), request.message_id.into(), request.tool_call_id.clone().into(), generation_id.into(), serde_json::to_value(request)?.into(), request.expires_at.into()])).await?;
    tx.commit().await?;
    Ok(())
}

/// `child_tools` are the registered tools whose handlers accept grant calls;
/// a delegated task's operation goes only to one of those.
#[allow(clippy::too_many_arguments)]
pub async fn claim(
    db: &DatabaseConnection,
    registry: &OperationRegistry,
    account_id: Uuid,
    attempt_id: Uuid,
    binding: &ExecutorBinding,
    registered: &[String],
    child_tools: &[String],
    confirmed: bool,
) -> Result<Uuid, Report> {
    let initial = get(db, account_id, attempt_id).await?;
    let tx = db.begin().await?;
    lock_chat(&tx, initial.chat_id, account_id).await?;
    let row = get_in(&tx, account_id, attempt_id, true).await?;
    let request: OperationRequest = serde_json::from_value(row.request)?;
    let kind = registry
        .for_request(&request)
        .ok_or_else(|| eyre!("Operation kind unavailable"))?;
    let tool_name = request.operation_id.rsplit('/').next().unwrap_or_default();
    if !binding.validate()
        || !registered.iter().any(|name| name == tool_name)
        || request.lineage.is_some() && !child_tools.iter().any(|name| name == tool_name)
        || binding.realm != request.binding.realm
        || binding.host_context != request.binding.host_context
    {
        return Err(eyre!("Executor binding mismatch"));
    }
    let cross_device = binding.device_id != request.binding.device_id;
    if cross_device && (!kind.allow_cross_device() || !confirmed)
        || request.consent == ConsentPolicy::Ask && !confirmed
    {
        return Err(eyre!("Operation consent required"));
    }
    kind.validate_input(&request.input, binding)
        .map_err(|_| eyre!("Invalid operation input"))?;
    if row.state == AttemptState::Claimed
        && row.claim_binding.as_ref() == Some(&serde_json::to_value(binding)?)
        && row
            .claim_expires_at
            .is_some_and(|expiry| expiry > Utc::now())
    {
        let token = row
            .claim_token
            .ok_or_else(|| eyre!("Operation claim missing"))?;
        // A call may wait on a prompt on the device for as long as the attempt
        // lives, so its executor renews the claim it holds.
        if request.lineage.is_some() || kind.renews_claim() {
            let renewed = tx
                .query_one_raw(statement(
                    "client_operations.claim",
                    r#"
        UPDATE client_operation_attempts
        SET claim_expires_at = LEAST(expires_at, now() + make_interval(secs => $3))
        WHERE attempt_id = $1 AND state = 'claimed' AND claim_token = $2
          AND claim_expires_at > now()
        RETURNING attempt_id
    "#,
                    vec![
                        attempt_id.into(),
                        token.into(),
                        (kind.claim_lease().num_seconds() as f64).into(),
                    ],
                ))
                .await?;
            if renewed.is_none() {
                return Err(eyre!("Operation is not claimable"));
            }
            tx.commit().await?;
        }
        return Ok(token);
    }
    let token = Uuid::new_v4();
    let changed = tx
        .query_one_raw(statement(
            "client_operations.claim",
            r#"
        UPDATE client_operation_attempts a
        SET state = 'claimed', claim_token = $3, claim_binding = $4,
            claim_expires_at = LEAST(expires_at, now() + make_interval(secs => $5))
        FROM chats c WHERE a.attempt_id = $1 AND a.account_id = $2 AND c.id = a.chat_id
          AND c.archived_at IS NULL AND c.generation_state <> 'running' AND a.expires_at > now()
          AND (a.state = 'pending' OR (a.state = 'claimed' AND a.claim_expires_at < now()))
        RETURNING a.attempt_id
    "#,
            vec![
                attempt_id.into(),
                account_id.into(),
                token.into(),
                serde_json::to_value(binding)?.into(),
                (kind.claim_lease().num_seconds() as f64).into(),
            ],
        ))
        .await?;
    if changed.is_none() {
        return Err(eyre!("Operation is not claimable"));
    }
    tx.commit().await?;
    Ok(token)
}

pub async fn accept(
    db: &DatabaseConnection,
    registry: &OperationRegistry,
    account_id: Uuid,
    token: Option<Uuid>,
    result: &OperationResult,
) -> Result<(), Report> {
    accept_result(db, registry, account_id, token, result, false).await
}

/// The fast transport may race escalation. Invalid content from its original
/// bound executor becomes fixed refused-call feedback, including in that race.
/// Claimed durable results still require the kind's validator, unless the kind
/// settles invalid claimed results the same way.
pub async fn accept_fast(
    db: &DatabaseConnection,
    registry: &OperationRegistry,
    account_id: Uuid,
    result: &OperationResult,
) -> Result<(), Report> {
    accept_result(db, registry, account_id, None, result, true).await
}

async fn accept_result(
    db: &DatabaseConnection,
    registry: &OperationRegistry,
    account_id: Uuid,
    token: Option<Uuid>,
    result: &OperationResult,
    refuse_invalid: bool,
) -> Result<(), Report> {
    let tx = db.begin().await?;
    accept_result_in(&tx, registry, account_id, token, result, refuse_invalid).await?;
    tx.commit().await?;
    Ok(())
}

/// Kind adapters may commit approved attachments and receipts in the same logged
/// transaction as result acceptance. All generic ownership/claim checks still run.
pub async fn accept_in(
    tx: &DatabaseTransaction,
    registry: &OperationRegistry,
    account_id: Uuid,
    token: Uuid,
    result: &OperationResult,
) -> Result<(), Report> {
    accept_result_in(tx, registry, account_id, Some(token), result, false).await
}

async fn accept_result_in(
    tx: &DatabaseTransaction,
    registry: &OperationRegistry,
    account_id: Uuid,
    token: Option<Uuid>,
    result: &OperationResult,
    refuse_invalid: bool,
) -> Result<(), Report> {
    let initial = get_in(tx, account_id, result.attempt_id, false).await?;
    lock_chat(tx, initial.chat_id, account_id).await?;
    let row = get_in(tx, account_id, result.attempt_id, true).await?;
    let request: OperationRequest = serde_json::from_value(row.request.clone())?;
    if result.operation_id != request.operation_id || result.base_revision != request.base_revision
    {
        return Err(eyre!("Operation identity mismatch"));
    }
    // A late fast-path result may settle only the original, still-unclaimed
    // attempt. It cannot race a different executor's claim or native approval.
    let binding_matches = if let Some(token) = token {
        row.claim_token == Some(token)
            && row.claim_binding.as_ref() == Some(&serde_json::to_value(&result.executor)?)
    } else {
        request.consent == ConsentPolicy::None
            && row.claim_token.is_none()
            && result.executor == request.binding
    };
    if !binding_matches {
        return Err(eyre!("Operation claim mismatch"));
    }
    // Preserve idempotency even if a newer kind validator is stricter.
    let submitted = serde_json::to_value(result)?;
    if row.result.as_ref() == Some(&submitted) {
        return Ok(());
    }
    let kind = registry
        .for_request(&request)
        .ok_or_else(|| eyre!("Operation kind unavailable"))?;
    let refuse_invalid = refuse_invalid || (token.is_some() && kind.settle_invalid_claimed());
    let validated = if (refuse_invalid
        && result
            .error
            .as_ref()
            .is_some_and(|error| error.code == "invalid_operation_result"))
        || (result.outcome == OperationOutcome::Succeeded) != result.result.is_some()
        || (result.outcome == OperationOutcome::Succeeded) == result.error.is_some()
    {
        None
    } else {
        kind.validate_result(&request, result)
            .ok()
            .filter(|validated| {
                validated.succeeded == (result.outcome == OperationOutcome::Succeeded)
            })
    };
    let (serialized, validated) = match validated {
        Some(validated) => (serde_json::to_value(result)?, validated),
        None if refuse_invalid => {
            let mut refused = result.clone();
            refused.outcome = OperationOutcome::Rejected;
            refused.result = None;
            refused.error = Some(OperationError {
                validation: None,
                code: "invalid_operation_result".into(),
                message: None,
            });
            (serde_json::to_value(refused)?, invalid_result_feedback())
        }
        None => return Err(eyre!("Invalid operation result")),
    };
    if let Some(previous) = row.result {
        return if previous == serialized {
            Ok(())
        } else {
            Err(eyre!("Operation already settled"))
        };
    }
    let changed = tx
        .query_one_raw(statement(
            "client_operations.accept",
            r#"
        UPDATE client_operation_attempts a
        SET state = 'ready', result = $3, validated_result = $4
        FROM chats c WHERE a.attempt_id = $1 AND a.account_id = $2 AND c.id = a.chat_id
          AND c.archived_at IS NULL AND a.state IN ('pending','claimed') AND a.expires_at > now()
          AND (a.claim_token IS NULL OR a.claim_expires_at > now())
        RETURNING a.attempt_id
    "#,
            vec![
                result.attempt_id.into(),
                account_id.into(),
                serialized.into(),
                serde_json::to_value(validated)?.into(),
            ],
        ))
        .await?;
    if changed.is_none() {
        return Err(eyre!("Operation is no longer open"));
    }
    Ok(())
}

/// Cancellation/expiry are server outcomes, never unvalidated executor JSON.
/// They remain discoverable until an authenticated continuation consumes them.
pub async fn cancel(
    db: &DatabaseConnection,
    account_id: Uuid,
    attempt_id: Uuid,
    expired: bool,
) -> Result<(), Report> {
    settle_server_outcome(
        db,
        account_id,
        attempt_id,
        if expired { "expired" } else { "cancelled" },
    )
    .await
}

/// Withdrawal settles only an open operation. An already committed result is
/// historical evidence and is never overwritten when configuration changes.
pub async fn withdraw(
    db: &DatabaseConnection,
    account_id: Uuid,
    attempt_id: Uuid,
) -> Result<(), Report> {
    settle_server_outcome(db, account_id, attempt_id, "withdrawn").await
}

async fn settle_server_outcome(
    db: &DatabaseConnection,
    account_id: Uuid,
    attempt_id: Uuid,
    code: &str,
) -> Result<(), Report> {
    let expired = code == "expired";
    let initial = get(db, account_id, attempt_id).await?;
    let tx = db.begin().await?;
    lock_chat(&tx, initial.chat_id, account_id).await?;
    let row = get_in(&tx, account_id, attempt_id, true).await?;
    if !matches!(row.state, AttemptState::Pending | AttemptState::Claimed) {
        if row
            .result
            .as_ref()
            .is_some_and(|result| result["error"]["code"] == code)
        {
            return Ok(());
        }
        return Err(eyre!("Operation already settled"));
    }
    let request: OperationRequest = serde_json::from_value(row.request)?;
    let mut output = serde_json::json!({"status":"cancelled","reason":code});
    if request.lineage.is_some()
        && let Some(text) = crate::services::delegated_client_tools::unanswered_grant_call_text(
            code,
            request.operation_id.rsplit('/').next().unwrap_or_default(),
        )
    {
        output["error"] = text.into();
    }
    let result = OperationResult {
        attempt_id,
        operation_id: request.operation_id,
        base_revision: request.base_revision,
        outcome: OperationOutcome::Rejected,
        result: None,
        error: Some(OperationError {
            validation: None,
            code: code.into(),
            message: None,
        }),
        executor: request.binding,
    };
    let validated = ValidatedResult {
        output,
        succeeded: false,
        file_ids: Vec::new(),
    };
    let changed = tx
        .execute_raw(statement(
            "client_operations.cancel",
            r#"
        UPDATE client_operation_attempts SET state = 'ready', result = $3, validated_result = $4
        WHERE account_id = $1 AND attempt_id = $2 AND (NOT $5 OR expires_at <= now())
    "#,
            vec![
                account_id.into(),
                attempt_id.into(),
                serde_json::to_value(result)?.into(),
                serde_json::to_value(validated)?.into(),
                expired.into(),
            ],
        ))
        .await?;
    if changed.rows_affected() != 1 {
        return Err(eyre!("Operation has not expired"));
    }
    tx.commit().await?;
    Ok(())
}

/// A stored result's files, read as the user before the continuation starts:
/// the model-visible wrapper around the tool's value and the ids the user may
/// read.
pub struct ResolvedFiles {
    pub result: Value,
    pub file_ids: Vec<Uuid>,
}

/// Called only after the existing generation CAS. Applying the result and
/// claiming continuation commit together, so a retry can replay the message.
pub async fn begin_continuation(
    db: &DatabaseConnection,
    account_id: Uuid,
    attempt_id: Uuid,
    generation_id: Uuid,
    files: Option<ResolvedFiles>,
) -> Result<attempts::Model, Report> {
    let initial = get(db, account_id, attempt_id).await?;
    let tx = db.begin().await?;
    lock_chat(&tx, initial.chat_id, account_id).await?;
    let row = get_in(&tx, account_id, attempt_id, true).await?;
    if !matches!(row.state, AttemptState::Ready | AttemptState::Continuing) {
        return Err(eyre!("Operation has no result to continue"));
    }
    let owns = tx.query_one_raw(statement("client_operations.continue", "SELECT id FROM chats WHERE id = $1 AND active_generation_id = $2 AND archived_at IS NULL", vec![row.chat_id.into(), generation_id.into()])).await?;
    if owns.is_none() {
        return Err(eyre!("Generation ownership changed"));
    }
    let message = messages::Entity::find_by_id(row.message_id)
        .one(&tx)
        .await?
        .ok_or_else(|| eyre!("Operation message not found"))?;
    let mut parsed = MessageSchema::validate(&message.raw_message)?;
    if !message.is_message_in_active_thread {
        return Err(eyre!("Operation message is no longer active"));
    }
    let newer = tx.query_one_raw(statement("client_operations.continue", "SELECT id FROM messages WHERE chat_id = $1 AND is_message_in_active_thread AND created_at > $2 LIMIT 1", vec![row.chat_id.into(), message.created_at.into()])).await?;
    if newer.is_some() {
        return Err(eyre!("Operation turn was superseded"));
    }
    if pending(&parsed.content).is_some_and(|pending| pending.attempt_id != attempt_id) {
        return Err(eyre!("Another operation owns this message"));
    }
    // Result application is part of the ready -> continuing transaction.
    // A crash retry must not re-annotate an earlier result with later counters
    // or overwrite message progress committed by the abandoned worker.
    if row.state == AttemptState::Ready {
        let mut validated: ValidatedResult = serde_json::from_value(
            row.validated_result
                .clone()
                .ok_or_else(|| eyre!("Operation result missing"))?,
        )?;
        let mut saved_parameters = message
            .generation_parameters
            .clone()
            .ok_or_else(|| eyre!("Missing generation parameters"))?;
        let mut parameters: crate::models::message::GenerationParameters =
            serde_json::from_value(saved_parameters.clone())?;
        let files = files.filter(|_| validated.succeeded);
        if let Some(files) = &files {
            validated.output["result"] = files.result.clone();
        }
        let request: OperationRequest = serde_json::from_value(row.request.clone())?;
        if let Some(saved) = parameters
            .client_tools
            .values()
            .find(|tool| tool.qualified_name() == request.operation_id)
        {
            let schema = serde_json::from_str(&saved.parameters)?;
            let policy = crate::services::client_tools::OfferedClientTool::prepare(saved, &schema)
                .map_err(|error| eyre!(error))?;
            if let Some(submission) = policy.submission {
                let count = parameters
                    .turn_consumption
                    .tool_charges
                    .get(&row.tool_call_id)
                    .and_then(|charge| charge.submission_attempt)
                    .or_else(|| {
                        parameters
                            .turn_consumption
                            .submission_attempts
                            .get(&saved.name)
                            .copied()
                    })
                    .unwrap_or_default();
                let outcome = if validated.output["status"] == "cancelled" {
                    crate::services::client_tools::ClientToolOutcome::Cancelled {
                        reason: "cancelled".into(),
                    }
                } else {
                    crate::services::client_tools::ClientToolOutcome::from_payload(
                        &validated.output,
                    )
                };
                submission.annotate(&mut validated.output, &outcome, count);
            }
        }
        if parameters
            .turn_consumption
            .tool_charges
            .get(&row.tool_call_id)
            .is_some_and(|charge| charge.recovery_read)
            && let Some(correction) = parameters.turn_consumption.submission_correction.as_mut()
        {
            let outcome = if validated.output["status"] == "cancelled" {
                crate::services::client_tools::ClientToolOutcome::Cancelled {
                    reason: validated.output["reason"]
                        .as_str()
                        .unwrap_or("cancelled")
                        .into(),
                }
            } else {
                crate::services::client_tools::ClientToolOutcome::from_payload(&validated.output)
            };
            correction.record_read(&outcome);
            saved_parameters["turn_consumption"]["submission_correction"] =
                serde_json::to_value(correction)?;
        }
        let Some(position) = parsed.content.iter().position(|part| {
            matches!(part, ContentPart::ToolUse(tool) if tool.tool_call_id == row.tool_call_id)
        }) else {
            return Err(eyre!("Operation tool part missing"));
        };
        if let ContentPart::ToolUse(tool) = &mut parsed.content[position] {
            tool.status = if validated.succeeded {
                MessageToolCallStatus::Success
            } else {
                MessageToolCallStatus::Error
            };
            tool.output = Some(validated.output);
            tool.ended_at = Some(Utc::now().to_rfc3339());
        }
        if let Some(files) = files {
            let pointers = link_result_files(&tx, row.chat_id, &files.file_ids).await?;
            parsed.content.splice(position + 1..position + 1, pointers);
        }
        tx.execute_raw(statement(
            "client_operations.continue",
            "UPDATE messages SET raw_message = $2, generation_parameters = $3 WHERE id = $1",
            vec![
                message.id.into(),
                serde_json::to_value(parsed)?.into(),
                saved_parameters.into(),
            ],
        ))
        .await?;
    }
    tx.execute_raw(statement("client_operations.continue", "UPDATE client_operation_attempts SET state = 'continuing', generation_id = $3 WHERE account_id = $1 AND attempt_id = $2", vec![account_id.into(), attempt_id.into(), generation_id.into()])).await?;
    tx.commit().await?;
    Ok(row)
}

/// The parts and chat links the live path makes for a result's files, inside
/// the continuation's transaction. A file deleted since it was read is skipped.
async fn link_result_files(
    tx: &DatabaseTransaction,
    chat_id: Uuid,
    file_ids: &[Uuid],
) -> Result<Vec<ContentPart>, Report> {
    use crate::db::entity::{chat_file_uploads, file_uploads};
    use crate::models::message::{ContentPartImageFilePointer, ContentPartTextFilePointer};
    use sea_orm::ActiveValue::Set;
    let mut parts = Vec::new();
    for id in file_ids {
        let Some(file) = file_uploads::Entity::find_by_id(*id).one(tx).await? else {
            continue;
        };
        chat_file_uploads::Entity::insert(chat_file_uploads::ActiveModel {
            chat_id: Set(chat_id),
            file_upload_id: Set(*id),
            ..Default::default()
        })
        .on_conflict_do_nothing()
        .exec_without_returning(tx)
        .await?;
        parts.push(if crate::models::message::is_image_file(&file.filename) {
            ContentPart::ImageFilePointer(ContentPartImageFilePointer {
                file_upload_id: *id,
                download_url: None,
                preview_url: None,
            })
        } else {
            ContentPart::TextFilePointer(ContentPartTextFilePointer {
                file_upload_id: *id,
            })
        });
    }
    Ok(parts)
}

pub async fn complete_continuation(
    db: &DatabaseConnection,
    attempt_id: Uuid,
    generation_id: Uuid,
    content: &[ContentPart],
    metadata: &crate::models::message::GenerationMetadata,
) -> Result<messages::Model, Report> {
    let tx = db.begin().await?;
    let row = attempts::Entity::find_by_id(attempt_id)
        .one(&tx)
        .await?
        .ok_or_else(|| eyre!("Operation not found"))?;
    lock_chat(&tx, row.chat_id, row.account_id).await?;
    let changed = tx.query_one_raw(statement("client_operations.complete", r#"
        UPDATE messages m SET raw_message = jsonb_set(m.raw_message, '{content}', $3), generation_metadata = $4
        FROM chats c WHERE m.id = $1 AND c.id = m.chat_id AND c.active_generation_id = $2
          AND c.generation_state = 'running'
          AND EXISTS (
              SELECT 1 FROM client_operation_attempts active
              WHERE active.message_id = m.id AND active.generation_id = $2
                AND active.state <> 'completed'
          )
        RETURNING m.*
    "#, vec![row.message_id.into(), generation_id.into(), serde_json::to_value(content)?.into(), serde_json::to_value(metadata)?.into()])).await?.ok_or_else(|| eyre!("Generation ownership changed"))?;
    tx.execute_raw(statement("client_operations.complete", "UPDATE client_operation_attempts SET state = 'completed' WHERE attempt_id = $1 AND generation_id = $2", vec![attempt_id.into(), generation_id.into()])).await?;
    let message = messages::Model::from_query_result(&changed, "")?;
    tx.commit().await?;
    Ok(message)
}

/// Ends a task's call whose continuation failed, while its generation still
/// holds the chat: the task's parent reads a completed call on a chat that is
/// no longer running as the run's end. Only calls with lineage: any client may
/// continue those, and would run a failing continuation again on every sweep.
pub async fn end_failed_continuation(
    db: &DatabaseConnection,
    attempt_id: Uuid,
    generation_id: Uuid,
) -> Result<bool, Report> {
    let tx = db.begin().await?;
    let Some(row) = attempts::Entity::find_by_id(attempt_id).one(&tx).await? else {
        return Ok(false);
    };
    lock_chat(&tx, row.chat_id, row.account_id).await?;
    let ended = tx
        .execute_raw(statement(
            "client_operations.fail",
            r#"
        UPDATE client_operation_attempts SET state = 'completed'
        WHERE attempt_id = $1 AND generation_id = $2 AND state = 'continuing'
          AND jsonb_typeof(request -> 'lineage') = 'object'
    "#,
            vec![attempt_id.into(), generation_id.into()],
        ))
        .await?;
    tx.commit().await?;
    Ok(ended.rows_affected() == 1)
}

/// A new user turn supersedes operations on the abandoned assistant message.
/// This runs inside the generation lease transaction and uses its chat lock.
pub async fn supersede_other_attempts<C: ConnectionTrait>(
    db: &C,
    chat_id: Uuid,
    retained_message: Uuid,
) -> Result<(), Report> {
    let rows = attempts::Model::find_by_statement(statement(
        "client_operations.supersede",
        r#"
        UPDATE client_operation_attempts SET state = 'completed'
        WHERE chat_id = $1 AND message_id <> $2 AND state <> 'completed' RETURNING *
    "#,
        vec![chat_id.into(), retained_message.into()],
    ))
    .all(db)
    .await?;
    for row in rows {
        let Some(message) = messages::Entity::find_by_id(row.message_id).one(db).await? else {
            continue;
        };
        let mut parsed = MessageSchema::validate(&message.raw_message)?;
        parsed.content.retain(|part| !matches!(part, ContentPart::ClientToolPending(pending) if pending.attempt_id == row.attempt_id));
        for part in &mut parsed.content {
            if let ContentPart::ToolUse(tool) = part
                && tool.tool_call_id == row.tool_call_id
                && tool.status == MessageToolCallStatus::InProgress
            {
                tool.status = MessageToolCallStatus::Error;
                tool.output = Some(serde_json::json!({"status":"cancelled","reason":"superseded"}));
                tool.ended_at = Some(Utc::now().to_rfc3339());
            }
        }
        db.execute_raw(statement(
            "client_operations.supersede",
            "UPDATE messages SET raw_message = $2 WHERE id = $1",
            vec![row.message_id.into(), serde_json::to_value(parsed)?.into()],
        ))
        .await?;
    }
    Ok(())
}

/// Persist replayable message parts and consumed allowances, fenced by both the
/// attempt and the chat generation. Called at dispatch boundaries on resumed
/// operations only; initial fast calls add no database round trips.
pub async fn save_progress(
    db: &DatabaseConnection,
    attempt_id: Uuid,
    generation_id: Uuid,
    content: &[ContentPart],
    consumption: &TurnConsumption,
) -> Result<(), Report> {
    let row = attempts::Entity::find_by_id(attempt_id)
        .one(db)
        .await?
        .ok_or_else(|| eyre!("Operation not found"))?;
    let tx = db.begin().await?;
    lock_chat(&tx, row.chat_id, row.account_id).await?;
    let updated = tx
        .execute_raw(statement(
            "client_operations.progress",
            r#"
        UPDATE messages m SET raw_message = jsonb_set(m.raw_message, '{content}', $3),
            generation_parameters = jsonb_set(m.generation_parameters, '{turn_consumption}', $4)
        FROM client_operation_attempts a JOIN chats c ON c.id = a.chat_id
        WHERE a.attempt_id = $1 AND a.generation_id = $2 AND a.state = 'continuing'
          AND c.active_generation_id = $2 AND m.id = a.message_id
    "#,
            vec![
                attempt_id.into(),
                generation_id.into(),
                serde_json::to_value(content)?.into(),
                serde_json::to_value(consumption)?.into(),
            ],
        ))
        .await?;
    if updated.rows_affected() != 1 {
        return Err(eyre!("Generation ownership changed"));
    }
    tx.commit().await?;
    Ok(())
}

pub async fn abort_chat(
    db: &DatabaseConnection,
    account_id: Uuid,
    chat_id: Uuid,
) -> Result<bool, Report> {
    let tx = db.begin().await?;
    lock_chat(&tx, chat_id, account_id).await?;
    let active = tx.query_one_raw(statement("client_operations.abort", "SELECT generation_id FROM client_operation_attempts WHERE chat_id = $1 AND account_id = $2 AND state <> 'completed' LIMIT 1", vec![chat_id.into(), account_id.into()])).await?;
    let Some(active) = active else {
        return Ok(false);
    };
    let generation_id: Uuid = active.try_get("", "generation_id")?;
    supersede_other_attempts(&tx, chat_id, Uuid::nil()).await?;
    tx.execute_raw(statement(
        "client_operations.abort",
        r#"
        UPDATE chats SET generation_state = 'completed', generation_ended_at = now()
        WHERE id = $1 AND active_generation_id = $2 AND generation_state = 'awaiting_approval'
    "#,
        vec![chat_id.into(), generation_id.into()],
    ))
    .await?;
    tx.commit().await?;
    Ok(true)
}
