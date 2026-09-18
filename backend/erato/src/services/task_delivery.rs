//! Getting a finished `async` task's result back into the chat it was started
//! from.
//!
//! Four independent steps, each idempotent, because any of them can be
//! interrupted by a process dying: record what is owed
//! ([`record_pending_delivery`]), take it ([`deliver_task_result`], behind two
//! compare-and-sets), look for anything owed to a chat that just went idle
//! ([`drain_pending_deliveries`]), and — when no request ever comes back to do
//! any of that — sweep ([`sweep_task_result_deliveries`]).
//!
//! The split is what makes a crash survivable. A run whose tail never got to
//! deliver still has its result recorded, and the next tail on the origin chat
//! — any tail, from any replica — finds it. The sweep is what covers the case
//! where there is no next tail: it runs from the cleanup worker's five-minute
//! tick, under nobody's request, with SQL and nothing else.

use crate::metrics_constants::{
    POSTGRES_QUERY_DELIVERY_CLAIM, POSTGRES_QUERY_DELIVERY_DUPLICATE_PROBE,
    POSTGRES_QUERY_DELIVERY_NEXT_PENDING, POSTGRES_QUERY_DELIVERY_RECORD,
    POSTGRES_QUERY_DELIVERY_STATE_SET, POSTGRES_QUERY_DELIVERY_SWEEP_CLAIM,
    POSTGRES_QUERY_DELIVERY_SWEEP_REQUEUE, POSTGRES_QUERY_DELIVERY_SWEEP_SCAN,
};
use crate::models::chat::{
    ChatProvenanceKind, DELIVERY_REASON_CHILD_ARCHIVED, DELIVERY_REASON_ORIGIN_ARCHIVED,
    DELIVERY_REASON_ORIGIN_MISSING, DELIVERY_REASON_OWNER_MISMATCH, ResultDelivery,
    ResultDeliveryState, generation_unfinished_condition, parse_chat_configuration,
};
use crate::models::message::ProvenanceRunMode;
use crate::policy::engine::PolicyEngine;
use crate::query_metrics::named_statement_from_sql_and_values;
use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use crate::services::background_tasks::Takeover;
use crate::services::delegation::{DelegationRunReason, DelegationRunStatus};
use crate::state::AppState;
use eyre::Report;
use sea_orm::prelude::Uuid;
use sea_orm::{ConnectionTrait, DatabaseConnection, EntityTrait, TransactionTrait, TryGetable};

/// How far one delivery attempt got.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliveryOutcome {
    /// The `task_result` row is in the conversation (and reacted to, unless the
    /// run asked for `silent`).
    Delivered,
    /// The origin was not free. The claim was released back to `pending`, and
    /// the next idle tail will find it.
    Deferred,
    /// Terminal without a row: the origin was archived, gone, or not ours.
    Closed,
    /// Nothing to do — no pending delivery here, or another process won it.
    Skipped,
}

/// Bounds one tail's work.
///
/// A tail is a request's last act, not a worker: it runs under a user's
/// request and must not turn into an unbounded queue drain. A backlog deeper
/// than this is the backstop sweep's job.
const MAX_DELIVERIES_PER_DRAIN: usize = 8;

/// Record, on the child, that its result is owed to the origin chat.
///
/// Returns the origin chat id so the caller can drain it. `None` when this run
/// owes nothing: not a delegated run, not `async`, or a delivery is already
/// recorded — which is what makes re-running a tail after a crash inert.
pub async fn record_pending_delivery(
    app_state: &AppState,
    child_chat_id: Uuid,
    child_assistant_message_id: Uuid,
    deadline_hit: bool,
    run_failed: bool,
    tool_budget_exhausted: bool,
) -> Option<Uuid> {
    let chat = crate::db::entity::prelude::Chats::find_by_id(child_chat_id)
        .one(&app_state.db)
        .await
        .ok()??;
    let configuration = parse_chat_configuration(&chat).ok()??;
    let provenance = configuration.provenance?;
    if provenance.kind != ChatProvenanceKind::Delegation
        || provenance.run_mode != Some(ProvenanceRunMode::Async)
    {
        return None;
    }
    // Already recorded: a re-run of this tail owes nothing. The CAS below would
    // refuse anyway; returning early keeps the envelope build off the path.
    if provenance.result_delivery.is_some() {
        return None;
    }
    let origin_chat_id = provenance.origin_chat_id?;
    let task = configuration.task.as_ref();
    let parent_tool_call_id = task
        .and_then(|task| task.parent_tool_call_id.clone())
        .unwrap_or_default();
    let scheduling = task.map(|task| task.scheduling).unwrap_or_default();
    let spawned_at = provenance.rebase_cutoff.unwrap_or(chat.created_at);

    // Probe the answer row before asking for an envelope. `build_result_envelope`
    // maps a missing answer to `completed` / `no_answer` — right for the awaited
    // path, where the delegate genuinely said nothing, and wrong here, where the
    // row is gone. Telling the origin model the task said nothing would invite
    // it to move on from work that in fact never reported.
    let answer_row = crate::db::entity::prelude::Messages::find_by_id(child_assistant_message_id)
        .one(&app_state.db)
        .await
        .ok()
        .flatten()
        .filter(|row| row.chat_id == child_chat_id && row.created_at > spawned_at);

    let delivery = if answer_row.is_none() {
        ResultDelivery {
            state: ResultDeliveryState::Pending,
            delivery_id: Uuid::new_v4(),
            result_message_id: None,
            status: DelegationRunStatus::Failed.as_str().to_string(),
            reason: Some(DelegationRunReason::ResultMissing.as_str().to_string()),
            claimed_by: None,
            claimed_at: None,
            message_id: None,
            reaction_message_id: None,
            attempts: 0,
            redeliveries: 0,
            redelivery_of: None,
            sequence: 0,
            at: sqlx::types::chrono::Utc::now().into(),
        }
    } else {
        let envelope = crate::services::delegation::build_result_envelope(
            &app_state.db,
            child_chat_id,
            child_assistant_message_id,
            spawned_at,
            chat.assistant_id,
            None,
            parent_tool_call_id.clone(),
            if run_failed {
                DelegationRunStatus::Failed
            } else if deadline_hit {
                DelegationRunStatus::Cancelled
            } else {
                DelegationRunStatus::Completed
            },
            deadline_hit.then_some(DelegationRunReason::Timeout),
            tool_budget_exhausted,
            app_state.config.delegation.result_max_chars,
        )
        .await;
        ResultDelivery {
            state: ResultDeliveryState::Pending,
            delivery_id: Uuid::new_v4(),
            result_message_id: Some(child_assistant_message_id),
            status: envelope.status.as_str().to_string(),
            reason: envelope.reason.map(|reason| reason.as_str().to_string()),
            claimed_by: None,
            claimed_at: None,
            message_id: None,
            reaction_message_id: None,
            attempts: 0,
            redeliveries: 0,
            redelivery_of: None,
            sequence: 0,
            at: sqlx::types::chrono::Utc::now().into(),
        }
    };

    let _ = scheduling;
    let payload = serde_json::to_value(&delivery).ok()?;
    // Path-scoped rather than a whole-envelope rewrite: the adoption path
    // replaces `assistant_configuration` wholesale from a possibly stale
    // in-memory row, and the two would otherwise erase each other. Conditional
    // on nothing being there yet, so a re-run writes no second delivery id.
    let rows = app_state
        .db
        .query_all_raw(named_statement_from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            POSTGRES_QUERY_DELIVERY_RECORD,
            r#"
            UPDATE "chats"
            SET "assistant_configuration" = jsonb_set(
                "assistant_configuration", '{provenance,result_delivery}', $2::jsonb, true)
            WHERE "id" = $1
              AND ("assistant_configuration" #> '{provenance,result_delivery}') IS NULL
            RETURNING "id"
            "#
            .to_string(),
            [child_chat_id.into(), payload.into()],
        ))
        .await
        .ok()?;
    if rows.is_empty() {
        // Someone else recorded it between our read and this write. Still owed,
        // so the origin is still worth draining.
        tracing::debug!(%child_chat_id, "A delivery was already recorded for this run");
    }

    Some(origin_chat_id)
}

/// Deliver everything owed to one origin chat, oldest claim first.
///
/// A loop, never recursion: [`deliver_task_result`] runs a whole generation
/// inside itself, and a delivery that drained again would nest the streaming
/// machinery in its own future — the recursive-sizing problem
/// `run_delegated_child` already boxes around.
pub async fn drain_pending_deliveries(
    app_state: &AppState,
    policy: &PolicyEngine,
    me_user: &MeProfile,
    origin_chat_id: Uuid,
) {
    if !app_state.config.delegation.tasks.enabled
        || !app_state
            .config
            .delegation
            .tasks
            .run_modes
            .contains(&erato_config::config::TaskRunMode::Async)
    {
        return;
    }
    for _ in 0..MAX_DELIVERIES_PER_DRAIN {
        let Some(child_id) = next_pending_delivery(app_state, origin_chat_id, &me_user.id).await
        else {
            break;
        };
        // Boxed for the same reason `run_delegated_child` is: this call
        // sequences a whole `stream_generate_chat_completion` into a future
        // that, at four of the five tails, has already held one.
        let outcome = Box::pin(deliver_task_result(app_state, policy, me_user, child_id)).await;
        if outcome == DeliveryOutcome::Deferred {
            // The origin is busy again — a later tail finds the rest.
            break;
        }
    }
}

/// The oldest child of this origin whose result is still owed.
async fn next_pending_delivery(
    app_state: &AppState,
    origin_chat_id: Uuid,
    owner_user_id: &str,
) -> Option<Uuid> {
    let rows = app_state
        .db
        .query_all_raw(named_statement_from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            POSTGRES_QUERY_DELIVERY_NEXT_PENDING,
            format!(
                r#"
            SELECT "id" FROM "chats"
            WHERE "origin_chat_id" = $1::uuid
              AND "owner_user_id" = $2
              AND ("assistant_configuration" #>> '{{provenance,result_delivery,state}}') = '{pending}'
              -- Deliberately the same shape as `deliver_task_result`'s entry
              -- guard. A row this scan returns but that guard rejects is
              -- `Skipped` without a state change, so it would be re-selected
              -- on every iteration of every drain and starve everything
              -- behind it.
              AND ("assistant_configuration" #>> '{{provenance,kind}}') = '{delegation}'
              AND ("assistant_configuration" #>> '{{provenance,run_mode}}') = '{async_mode}'
            ORDER BY ("assistant_configuration" #>> '{{provenance,result_delivery,at}}') ASC
            LIMIT 1
            "#,
                pending = ResultDeliveryState::Pending.as_str(),
                delegation = ChatProvenanceKind::Delegation.as_str(),
                async_mode = ProvenanceRunMode::Async.as_str(),
            ),
            [origin_chat_id.into(), owner_user_id.into()],
        ))
        .await
        .ok()?;
    rows.first()
        .and_then(|row| Uuid::try_get(row, "", "id").ok())
}

/// Write a new delivery envelope, fenced on the state (and claim) we expect to
/// still be there.
///
/// The same path-scoped `jsonb_set` as the record step, so an adoption write
/// racing us cannot erase the delivery and we cannot erase an adoption.
async fn set_delivery_state(
    app_state: &AppState,
    child_chat_id: Uuid,
    delivery: &ResultDelivery,
    expect_state: ResultDeliveryState,
    expect_claim_token: Option<&str>,
) -> bool {
    set_delivery_state_in(
        &app_state.db,
        child_chat_id,
        delivery,
        expect_state,
        expect_claim_token,
    )
    .await
}

/// As [`set_delivery_state`], against a caller-owned connection.
///
/// The delivery runs its `claimed -> delivered` write inside the same
/// transaction as the append it describes, so it needs to pass a
/// `&DatabaseTransaction` here rather than reach for the pool.
async fn set_delivery_state_in<C: ConnectionTrait>(
    conn: &C,
    child_chat_id: Uuid,
    delivery: &ResultDelivery,
    expect_state: ResultDeliveryState,
    expect_claim_token: Option<&str>,
) -> bool {
    let Ok(payload) = serde_json::to_value(delivery) else {
        return false;
    };
    let mut sql = format!(
        r#"
        UPDATE "chats"
        SET "assistant_configuration" = jsonb_set(
            "assistant_configuration", '{{provenance,result_delivery}}', $2::jsonb, true)
        WHERE "id" = $1
          AND ("assistant_configuration" #>> '{{provenance,result_delivery,state}}') = '{expect}'
        "#,
        expect = expect_state.as_str(),
    );
    let mut values: Vec<sea_orm::Value> = vec![child_chat_id.into(), payload.into()];
    if let Some(token) = expect_claim_token {
        sql.push_str(
            "          AND (\"assistant_configuration\" #>> '{provenance,result_delivery,claimed_by}') = $3\n",
        );
        values.push(token.into());
    }
    sql.push_str("        RETURNING \"id\"\n");

    conn.query_all_raw(named_statement_from_sql_and_values(
        sea_orm::DatabaseBackend::Postgres,
        POSTGRES_QUERY_DELIVERY_STATE_SET,
        sql,
        values,
    ))
    .await
    .map(|rows| !rows.is_empty())
    .unwrap_or(false)
}

/// Deliver one child's recorded result. Never drains: see
/// [`drain_pending_deliveries`].
///
/// Every step is a compare-and-set because every step can be interrupted: the
/// claim, the origin's lease, the row's own idempotency probe and the two state
/// transitions all assume another replica may be doing the same thing.
pub async fn deliver_task_result(
    app_state: &AppState,
    policy: &PolicyEngine,
    me_user: &MeProfile,
    child_chat_id: Uuid,
) -> DeliveryOutcome {
    // 0. What is owed, and is it still ours to take.
    let Ok(Some(child)) = crate::db::entity::prelude::Chats::find_by_id(child_chat_id)
        .one(&app_state.db)
        .await
    else {
        return DeliveryOutcome::Skipped;
    };
    let Ok(Some(configuration)) = parse_chat_configuration(&child) else {
        return DeliveryOutcome::Skipped;
    };
    let Some(provenance) = configuration.provenance.clone() else {
        return DeliveryOutcome::Skipped;
    };
    if provenance.kind != ChatProvenanceKind::Delegation
        || provenance.run_mode != Some(ProvenanceRunMode::Async)
    {
        return DeliveryOutcome::Skipped;
    }
    let Some(delivery) = provenance.result_delivery.clone() else {
        return DeliveryOutcome::Skipped;
    };
    // `delivered` — the row is in the conversation but nothing has reacted yet
    // — is deliberately NOT resumed here. It is unreachable from the drain,
    // which scans `pending` only, and the reaction for it belongs to the
    // backstop sweep and `/react` (ERMAIN-781), or to the user's own next
    // message, which composes the result through history.
    if delivery.state != ResultDeliveryState::Pending {
        return DeliveryOutcome::Skipped;
    }
    let Some(origin_chat_id) = provenance.origin_chat_id else {
        return DeliveryOutcome::Skipped;
    };
    let task = configuration.task.clone();
    let scheduling = task
        .as_ref()
        .map(|task| task.scheduling)
        .unwrap_or_default();
    let parent_tool_call_id = task
        .as_ref()
        .and_then(|task| task.parent_tool_call_id.clone())
        .unwrap_or_default();

    // 1. CAS #1 — CLAIM.
    //
    // `claimed_by` is a fresh v4 per attempt, not a replica id: two attempts
    // from ONE process must not collide, which is exactly the case a pod name
    // cannot distinguish. It is the fence for every later write here, which
    // also leaves `claimed_at` free to mean only "when", so the backstop sweep
    // can use it as a staleness clock without the two jobs interfering.
    let claim_token = Uuid::new_v4().to_string();
    let mut claimed = delivery.clone();
    claimed.state = ResultDeliveryState::Claimed;
    claimed.claimed_by = Some(claim_token.clone());
    claimed.claimed_at = Some(sqlx::types::chrono::Utc::now().into());
    claimed.attempts = delivery.attempts.saturating_add(1);
    claimed.at = sqlx::types::chrono::Utc::now().into();
    let Ok(claim_payload) = serde_json::to_value(&claimed) else {
        return DeliveryOutcome::Skipped;
    };
    let claim_rows = app_state
        .db
        .query_all_raw(named_statement_from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            POSTGRES_QUERY_DELIVERY_CLAIM,
            format!(
                r#"
            UPDATE "chats"
            SET "assistant_configuration" = jsonb_set(
                "assistant_configuration", '{{provenance,result_delivery}}', $3::jsonb, true)
            WHERE "id" = $1
              AND ("assistant_configuration" #>> '{{provenance,result_delivery,state}}') = '{pending}'
              AND ("assistant_configuration" #>> '{{provenance,result_delivery,delivery_id}}') = $2
            RETURNING "id"
            "#,
                pending = ResultDeliveryState::Pending.as_str(),
            ),
            [
                child_chat_id.into(),
                delivery.delivery_id.to_string().into(),
                claim_payload.into(),
            ],
        ))
        .await;
    // Winning the CAS is what makes the token ours; zero rows means another
    // attempt got there first. The token itself never round-trips through the
    // database, so there is no serialization format to disagree about.
    match claim_rows {
        Ok(rows) if !rows.is_empty() => {}
        Ok(_) => return DeliveryOutcome::Skipped,
        Err(error) => {
            tracing::warn!(%error, %child_chat_id, "Failed to claim a task result delivery");
            return DeliveryOutcome::Skipped;
        }
    }

    // 2. Origin checks, read once.
    let origin = match crate::db::entity::prelude::Chats::find_by_id(origin_chat_id)
        .one(&app_state.db)
        .await
    {
        Ok(Some(origin)) => origin,
        Ok(None) => {
            let mut closed = claimed.clone();
            closed.state = ResultDeliveryState::Failed;
            closed.reason = Some(DELIVERY_REASON_ORIGIN_MISSING.to_string());
            closed.at = sqlx::types::chrono::Utc::now().into();
            set_delivery_state(
                app_state,
                child_chat_id,
                &closed,
                ResultDeliveryState::Claimed,
                Some(&claim_token),
            )
            .await;
            return DeliveryOutcome::Closed;
        }
        Err(error) => {
            tracing::warn!(%error, %origin_chat_id, "Failed to read the origin chat of a delivery");
            release_pending(app_state, child_chat_id, &claimed, &claim_token).await;
            return DeliveryOutcome::Deferred;
        }
    };
    // Writing into a chat whose owner differs from the run's is the ERMAIN-485
    // class; the refusal is the point, and it appends nothing.
    if origin.owner_user_id != child.owner_user_id {
        let mut closed = claimed.clone();
        closed.state = ResultDeliveryState::Failed;
        closed.reason = Some(DELIVERY_REASON_OWNER_MISMATCH.to_string());
        closed.at = sqlx::types::chrono::Utc::now().into();
        if !set_delivery_state(
            app_state,
            child_chat_id,
            &closed,
            ResultDeliveryState::Claimed,
            Some(&claim_token),
        )
        .await
        {
            tracing::warn!(
                %child_chat_id,
                "Lost the fence closing a delivery; another holder owns it now"
            );
        }
        return DeliveryOutcome::Closed;
    }
    if origin.archived_at.is_some() {
        let mut closed = claimed.clone();
        closed.state = ResultDeliveryState::Superseded;
        closed.reason = Some(DELIVERY_REASON_ORIGIN_ARCHIVED.to_string());
        closed.at = sqlx::types::chrono::Utc::now().into();
        if !set_delivery_state(
            app_state,
            child_chat_id,
            &closed,
            ResultDeliveryState::Claimed,
            Some(&claim_token),
        )
        .await
        {
            tracing::warn!(
                %child_chat_id,
                "Lost the fence closing a delivery; another holder owns it now"
            );
        }
        return DeliveryOutcome::Closed;
    }
    // A chat parked on an approval belongs to the person who has to answer it.
    // Dropping a result under a mounted approval card would move the card.
    if origin.generation_state.as_deref() == Some("awaiting_approval") {
        release_pending(app_state, child_chat_id, &claimed, &claim_token).await;
        return DeliveryOutcome::Deferred;
    }

    // 3. CAS #2 — the origin's generation lease. `RefuseParked`, because a
    //    system-initiated turn may not abandon a chat a person parked.
    let delivered_message_id = Uuid::new_v4();
    let Ok((_rx, task)) = app_state
        .background_tasks
        .try_start_task(
            origin_chat_id,
            delivered_message_id,
            Takeover::RefuseParked,
            app_state.config.generation_status.stale_after_secs,
        )
        .await
    else {
        release_pending(app_state, child_chat_id, &claimed, &claim_token).await;
        return DeliveryOutcome::Deferred;
    };

    // Armed the instant the lease is ours and disarmed only once something
    // else owns the release. Without it a panic anywhere below leaves the task
    // in the manager's map un-completed, so the heartbeat refreshes the row
    // forever, `stale_after_secs` never fires, and every write into the origin
    // chat 409s for the life of the process.
    let mut lease_guard = crate::services::background_tasks::TaskCleanupGuard::new(
        app_state.background_tasks.clone(),
        origin_chat_id,
        task.generation_id,
    );

    // Archiving never takes the lease, so the step-2 read can be stale by now.
    // Re-checked here, under the lease, because the whole point of the earlier
    // check is that nothing is appended to a chat the user has closed.
    if let Ok(Some(fresh)) = crate::db::entity::prelude::Chats::find_by_id(origin_chat_id)
        .one(&app_state.db)
        .await
        && fresh.archived_at.is_some()
    {
        let mut closed = claimed.clone();
        closed.state = ResultDeliveryState::Superseded;
        closed.reason = Some(DELIVERY_REASON_ORIGIN_ARCHIVED.to_string());
        closed.at = sqlx::types::chrono::Utc::now().into();
        set_delivery_state(
            app_state,
            child_chat_id,
            &closed,
            ResultDeliveryState::Claimed,
            Some(&claim_token),
        )
        .await;
        lease_guard.disarm();
        release_lease(app_state, &task, origin_chat_id).await;
        return DeliveryOutcome::Closed;
    }

    // 4-6. Probe, append and record — ONE transaction.
    //
    // They cannot be three. The fence on the `delivered` write only means
    // anything if the row it describes is not yet visible to anyone else: if
    // the append commits first, a sweeper that requeues this claim in between
    // hands it to a second holder whose probe now misses, and the same result
    // is appended twice — in the user's conversation. Committing all three
    // together makes losing the fence roll the row back with it.
    let (delivered_row, appended) = {
        let txn = match app_state.db.begin().await {
            Ok(txn) => txn,
            Err(error) => {
                tracing::warn!(%error, %origin_chat_id, "Failed to open the delivery transaction");
                lease_guard.disarm();
                release_lease(app_state, &task, origin_chat_id).await;
                release_pending(app_state, child_chat_id, &claimed, &claim_token).await;
                return DeliveryOutcome::Deferred;
            }
        };

        // A re-claim after a crash must not append the same result twice. The
        // error is NOT swallowed: "the query failed" read as "no row exists"
        // is precisely how the duplicate gets written.
        let probe = txn
            .query_all_raw(named_statement_from_sql_and_values(
                sea_orm::DatabaseBackend::Postgres,
                POSTGRES_QUERY_DELIVERY_DUPLICATE_PROBE,
                r#"
            SELECT "id" FROM "messages"
            WHERE "chat_id" = $1
              AND ("input_parameters" #>> '{task_result,delivery_id}') = $2
            LIMIT 1
            "#
                .to_string(),
                [
                    origin_chat_id.into(),
                    delivery.delivery_id.to_string().into(),
                ],
            ))
            .await;
        let existing = match probe {
            Ok(rows) => rows
                .first()
                .and_then(|row| Uuid::try_get(row, "", "id").ok()),
            Err(error) => {
                tracing::warn!(%error, %origin_chat_id, "The delivery duplicate probe failed");
                lease_guard.disarm();
                release_lease(app_state, &task, origin_chat_id).await;
                release_pending(app_state, child_chat_id, &claimed, &claim_token).await;
                return DeliveryOutcome::Deferred;
            }
        };

        let (row, appended) = match existing {
            Some(id) => {
                match crate::db::entity::prelude::Messages::find_by_id(id)
                    .one(&txn)
                    .await
                {
                    Ok(Some(row)) => (row, false),
                    _ => {
                        lease_guard.disarm();
                        release_lease(app_state, &task, origin_chat_id).await;
                        release_pending(app_state, child_chat_id, &claimed, &claim_token).await;
                        return DeliveryOutcome::Deferred;
                    }
                }
            }
            None => {
                let (summary, truncated) = child_answer_for_delivery(
                    &app_state.db,
                    app_state.config.delegation.result_max_chars,
                    child_chat_id,
                    &child,
                    &delivery,
                    provenance.rebase_cutoff.unwrap_or(child.created_at),
                    parent_tool_call_id.clone(),
                )
                .await;
                let part = crate::models::message::ContentPart::TaskResult(
                    crate::models::message::ContentPartTaskResult {
                        child_chat_id,
                        parent_tool_call_id: parent_tool_call_id.clone(),
                        status: delivery.status.clone(),
                        reason: delivery.reason.clone(),
                        summary,
                        truncated,
                        sequence: delivery.sequence,
                    },
                );
                // A failed read here is NOT `None`: `None` means "no anchor",
                // and `submit_message` reads that as "rebuild no lineage",
                // which deactivates every other row in the conversation.
                let tip = match crate::models::message::get_active_thread_tip(&txn, &origin_chat_id)
                    .await
                {
                    Ok(tip) => tip.map(|row| row.id),
                    Err(error) => {
                        tracing::warn!(%error, %origin_chat_id, "Failed to resolve the origin's active thread tip");
                        lease_guard.disarm();
                        release_lease(app_state, &task, origin_chat_id).await;
                        release_pending(app_state, child_chat_id, &claimed, &claim_token).await;
                        return DeliveryOutcome::Deferred;
                    }
                };
                let input_parameters = crate::models::message::InputParameters {
                    action_facet_id: None,
                    action_facet_args: None,
                    mentioned_assistant_ids: None,
                    delegation_run_mode: None,
                    task_result: Some(crate::models::message::TaskResultInput {
                        delivery_id: delivery.delivery_id,
                        child_chat_id,
                        result_message_id: delivery.result_message_id,
                        status: delivery.status.clone(),
                        reason: delivery.reason.clone(),
                        scheduling: scheduling.as_str().to_string(),
                        sequence: delivery.sequence,
                    }),
                };
                let raw_message = serde_json::json!({
                    "role": "user",
                    "content": [serde_json::to_value(&part).unwrap_or_default()],
                    "name": me_user.id,
                });
                // `append_message_unchecked` skips only the authorization
                // check, which this path has already made for itself: step 2
                // refuses outright unless the origin and the child have the
                // same owner, which is exactly what the `submit_message` rule
                // evaluates.
                match crate::models::message::append_message_unchecked(
                    &txn,
                    &origin_chat_id,
                    raw_message,
                    tip.as_ref(),
                    None,
                    None,
                    &[],
                    None,
                    None,
                    Some(serde_json::to_value(&input_parameters).unwrap_or_default()),
                )
                .await
                {
                    Ok(row) => (row, true),
                    Err(error) => {
                        tracing::warn!(%error, %origin_chat_id, "Failed to append a delivered task result");
                        lease_guard.disarm();
                        release_lease(app_state, &task, origin_chat_id).await;
                        release_pending(app_state, child_chat_id, &claimed, &claim_token).await;
                        return DeliveryOutcome::Deferred;
                    }
                }
            }
        };

        // CAS #3 — DELIVERED, fenced on our own claim token, in the same
        // transaction as the append above.
        let mut delivered = claimed.clone();
        delivered.state = ResultDeliveryState::Delivered;
        delivered.message_id = Some(row.id);
        delivered.at = sqlx::types::chrono::Utc::now().into();
        let fenced = set_delivery_state_in(
            &txn,
            child_chat_id,
            &delivered,
            ResultDeliveryState::Claimed,
            Some(&claim_token),
        )
        .await;
        if !fenced {
            // Reachable once the backstop sweep exists: it can requeue a claim
            // it judged stale between our claim and here. Rolling back takes
            // the appended row with it, so the next holder appends exactly one.
            tracing::warn!(
                %child_chat_id,
                delivery_id = %delivery.delivery_id,
                "Lost the delivery fence; rolling the appended result back"
            );
            let _ = txn.rollback().await;
            lease_guard.disarm();
            release_lease(app_state, &task, origin_chat_id).await;
            return DeliveryOutcome::Skipped;
        }

        if let Err(error) = txn.commit().await {
            tracing::warn!(%error, %origin_chat_id, "Failed to commit the delivery transaction");
            lease_guard.disarm();
            release_lease(app_state, &task, origin_chat_id).await;
            release_pending(app_state, child_chat_id, &claimed, &claim_token).await;
            return DeliveryOutcome::Deferred;
        }
        (row, appended)
    };

    // Announced only after the commit, so nobody is told about a row that
    // rolled back.
    if appended
        && let Err(error) =
            crate::server::api::v1beta::message_streaming::bg_stream_announce_user_row(
                &task,
                app_state,
                &delivered_row,
            )
            .await
    {
        tracing::warn!(%error, %origin_chat_id, "Failed to announce a delivered task result");
    }

    let mut delivered = claimed.clone();
    delivered.state = ResultDeliveryState::Delivered;
    delivered.message_id = Some(delivered_row.id);

    // 7. A silent result is stored, not answered: the user's next message
    //    composes it through history.
    if scheduling == erato_config::config::TaskScheduling::Silent {
        lease_guard.disarm();
        release_lease(app_state, &task, origin_chat_id).await;
        return DeliveryOutcome::Delivered;
    }

    // 8. The reaction turn, under the lease we already hold. The lifecycle
    //    broadcasts the closing frame and releases the lease, so a client can
    //    attach to this turn exactly as it attaches to a background submit.
    let selected_facet_ids = selected_facets_of_tip(app_state, origin_chat_id).await;
    let chat_provider_id =
        crate::models::chat::get_last_chat_provider_id(&app_state.db, &origin_chat_id)
            .await
            .ok()
            .flatten();
    let request =
        crate::server::api::v1beta::message_streaming::MessageSubmitRequest::for_result_delivery(
            origin_chat_id,
            chat_provider_id,
            selected_facet_ids,
            Some(delivered_row.id),
        );
    // The lifecycle owns the release from here, and installs its own guard.
    lease_guard.disarm();
    let reaction = crate::server::api::v1beta::message_streaming::with_generation_task_lifecycle(
        &app_state.background_tasks,
        &task,
        origin_chat_id,
        crate::server::api::v1beta::message_streaming::run_generation_after_user_message(
            &task,
            app_state,
            policy,
            me_user,
            &request,
            crate::models::message::GenerationRequestContext { platform: None },
            &origin,
            false,
            Vec::new(),
            &delivered_row,
            crate::server::api::v1beta::message_streaming::GenerationOrigin::TaskResultDelivery,
        ),
    )
    .await;
    if let Err(error) = reaction {
        tracing::warn!(%error, %origin_chat_id, "The reaction to a delivered task result failed");
        return DeliveryOutcome::Delivered;
    }

    // 9. CAS #4 — REACTED, fenced on our claim token like every other write.
    //    The token survives step 6 (that write carries it through), so an
    //    unfenced write here could stamp our stale envelope over a newer
    //    holder's — reverting `redeliveries` and re-arming the once-only
    //    requeue cap. A lost CAS is benign: the row and the reaction are both
    //    on disk and only the bookkeeping is stale.
    let mut reacted = delivered.clone();
    reacted.state = ResultDeliveryState::Reacted;
    reacted.reaction_message_id = Some(task.message_id());
    reacted.at = sqlx::types::chrono::Utc::now().into();
    if !set_delivery_state(
        app_state,
        child_chat_id,
        &reacted,
        ResultDeliveryState::Delivered,
        Some(&claim_token),
    )
    .await
    {
        tracing::warn!(
            %child_chat_id,
            "Could not mark a delivered task result as reacted; the reaction itself is on disk"
        );
    }
    DeliveryOutcome::Delivered
}

/// Put a claim back so the next idle tail finds it.
async fn release_pending(
    app_state: &AppState,
    child_chat_id: Uuid,
    claimed: &ResultDelivery,
    claim_token: &str,
) {
    let mut pending = claimed.clone();
    pending.state = ResultDeliveryState::Pending;
    pending.claimed_by = None;
    pending.claimed_at = None;
    pending.at = sqlx::types::chrono::Utc::now().into();
    if !set_delivery_state(
        app_state,
        child_chat_id,
        &pending,
        ResultDeliveryState::Claimed,
        Some(claim_token),
    )
    .await
    {
        tracing::warn!(%child_chat_id, "Could not release a task result claim back to pending");
    }
}

/// Release the origin's lease through the lifecycle rather than by hand.
///
/// That is what gives the identity-gated `remove_task` **and** the closing
/// frame for anyone attached to this lease; a hand-rolled `mark_completed` plus
/// `remove_task` would silently drop the frame.
async fn release_lease(
    app_state: &AppState,
    task: &std::sync::Arc<crate::services::background_tasks::StreamingTask>,
    origin_chat_id: Uuid,
) {
    let _ = crate::server::api::v1beta::message_streaming::with_generation_task_lifecycle(
        &app_state.background_tasks,
        task,
        origin_chat_id,
        async { Ok(()) },
    )
    .await;
}

/// The child's own answer, bounded, for the delivered content part.
///
/// Read at delivery time rather than stored on the envelope: the envelope is
/// state, and an answer is potentially large text with no business being
/// duplicated into a chat configuration column.
///
/// Goes through `build_result_envelope` rather than re-reading the row here, so
/// the bound, the truncation flag and the "what counts as the answer" rule
/// cannot drift from the awaited path's. A delivery with no answer row
/// (`result_missing`) never reaches this: it has nothing to read.
///
/// Generic over the connection, and taking `result_max_chars` as an argument
/// rather than reading it off an `AppState`, so the backstop sweep can call it
/// with its own transaction. That reuse is the point: a second truncation rule
/// for one field would drift from this one the first time either changed.
async fn child_answer_for_delivery<C: ConnectionTrait>(
    conn: &C,
    result_max_chars: usize,
    child_chat_id: Uuid,
    child: &crate::db::entity::chats::Model,
    delivery: &ResultDelivery,
    spawned_at: sea_orm::prelude::DateTimeWithTimeZone,
    parent_tool_call_id: String,
) -> (String, bool) {
    let Some(result_message_id) = delivery.result_message_id else {
        return (String::new(), false);
    };
    let envelope = crate::services::delegation::build_result_envelope(
        conn,
        child_chat_id,
        result_message_id,
        spawned_at,
        child.assistant_id,
        None,
        parent_tool_call_id,
        // The status was settled when the delivery was recorded; asking for it
        // again would let a re-read of the row change a result already
        // promised to the origin model.
        DelegationRunStatus::Completed,
        None,
        false,
        result_max_chars,
    )
    .await;
    (envelope.result.unwrap_or_default(), envelope.truncated)
}

/// The facets the origin chat's own last turn ran with, so a reaction speaks
/// with the same capabilities the conversation was using.
async fn selected_facets_of_tip(app_state: &AppState, origin_chat_id: Uuid) -> Vec<String> {
    let Ok(Some(tip)) =
        crate::models::message::get_active_thread_tip(&app_state.db, &origin_chat_id).await
    else {
        return Vec::new();
    };
    let Some(parameters) = tip.generation_parameters.as_ref() else {
        return Vec::new();
    };
    let Ok(parameters) =
        serde_json::from_value::<crate::models::message::GenerationParameters>(parameters.clone())
    else {
        return Vec::new();
    };
    parameters
        .selected_facets
        .into_iter()
        .filter_map(|(id, selected)| selected.then_some(id))
        .collect()
}

// ---------------------------------------------------------------------------
// The backstop sweep (ERMAIN-781-A)
// ---------------------------------------------------------------------------
//
// Everything above runs under somebody's request. This half runs under nobody's:
// it is the five-minute cleanup tick's first act, and it exists so that a
// delivery no request ever comes back to finish still lands. It shares the
// module deliberately — the state machine, the fence and the idempotency probe
// are the same ones, and a second module would be a second place for them to
// drift.

/// Bounds one pass. A deeper backlog is the next tick's, five minutes later.
///
/// `pub` only so the integration tests can stage exactly this many rows; there
/// is no runtime reason to read it from outside the crate.
pub const SWEEP_BATCH_LIMIT: u64 = 200;

/// What one pass did. Every counter but `requeued` is a terminal decision about
/// one child, so they sum to the number of children the scan returned.
#[derive(Debug, Default, Clone, Copy)]
pub struct SweepOutcome {
    /// Phase (i): claims whose holder went away, put back to `pending`.
    pub requeued: u64,
    pub delivered: u64,
    /// The origin was busy. Left `pending`, rotated to the back of the queue.
    pub deferred: u64,
    pub superseded: u64,
    pub failed: u64,
    /// Someone else had already moved it on, or the row is no longer a
    /// delegated async run at all.
    pub already_delivered: u64,
    pub errored: u64,
}

impl SweepOutcome {
    /// Whether this pass did anything worth a log line.
    pub fn touched(&self) -> bool {
        self.requeued
            + self.delivered
            + self.deferred
            + self.superseded
            + self.failed
            + self.already_delivered
            + self.errored
            > 0
    }
}

/// How far the sweep got with one child.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ChildSweepStep {
    Delivered,
    Deferred,
    Superseded,
    Failed,
    AlreadyDelivered,
    /// The row, its provenance or its delivery record was not there any more by
    /// the time we re-read it. Benign: the scan is not in a transaction with the
    /// per-child work, so a row can legitimately move between the two.
    Gone,
}

/// Deliver anything the live path dropped.
///
/// Never returns `Result`. It runs from a cron tick whose other half deletes
/// data behind `?`, and one unreachable child must not take the retention pass
/// down with it — nor must a retention failure ever skip the recovery of a
/// result. Per-child failures are a `warn!` and a counter.
///
/// Takes no generation lease and runs no model turn: it appends the result row
/// and stops. Reacting to that row is `/react` (ERMAIN-781-B) or the user's own
/// next message, which composes the result through history.
pub async fn sweep_task_result_deliveries(
    db: &DatabaseConnection,
    result_max_chars: usize,
    stale_after_secs: u64,
) -> SweepOutcome {
    let mut outcome = SweepOutcome::default();

    // Phase (i) — requeue claims that went stale.
    //
    // One set-based statement, and the only place in this module that merges
    // into the stored envelope rather than replacing it: there is no per-row
    // struct to serialize when the whole point is to touch every stranded row
    // at once. `COALESCE` is not optional — `x || jsonb_build_object(…)` is
    // NULL when `x` is NULL and `jsonb_set(…, NULL, …)` returns NULL, which
    // would blank the chat's whole `assistant_configuration` and with it its
    // assistant binding and provenance.
    //
    // `claimed_at` is read here purely as a clock. The fence is `claimed_by`,
    // and only `claimed_by`; keeping the two apart is what lets "is this claim
    // stale" and "is this claim mine" be different questions.
    //
    // `claimed_by` and `claimed_at` are deliberately left in place: they name
    // the process that stranded the row, which is the only diagnosis trail
    // there is. Leaving them is safe because the stalled holder's own
    // compare-and-set requires `state = 'claimed'` and now fails on the state
    // alone, and because a sweep that goes on to take the row overwrites the
    // whole envelope with a fresh token. This differs on purpose from
    // `release_pending`, which clears both: a holder voluntarily releasing a
    // claim it knows is dead is not the same act as an involuntary seizure.
    let requeue = db
        .query_all_raw(named_statement_from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            POSTGRES_QUERY_DELIVERY_SWEEP_REQUEUE,
            format!(
                r#"
            UPDATE "chats"
            SET "assistant_configuration" = jsonb_set(
                "assistant_configuration",
                '{{provenance,result_delivery}}',
                COALESCE("assistant_configuration" #> '{{provenance,result_delivery}}', '{{}}'::jsonb)
                    || jsonb_build_object('state', '{pending}'),
                false)
            WHERE ("assistant_configuration" #>> '{{provenance,kind}}') = '{delegation}'
              AND ("assistant_configuration" #>> '{{provenance,run_mode}}') = '{async_mode}'
              AND ("assistant_configuration" #>> '{{provenance,result_delivery,state}}') = '{claimed}'
              AND COALESCE(
                    "assistant_configuration" #>> '{{provenance,result_delivery,claimed_at}}',
                    "assistant_configuration" #>> '{{provenance,result_delivery,at}}',
                    'epoch'
                  )::timestamptz < now() - make_interval(secs => $1::double precision)
            RETURNING "id"
            "#,
                pending = ResultDeliveryState::Pending.as_str(),
                claimed = ResultDeliveryState::Claimed.as_str(),
                delegation = ChatProvenanceKind::Delegation.as_str(),
                async_mode = ProvenanceRunMode::Async.as_str(),
            ),
            [(stale_after_secs as f64).into()],
        ))
        .await;
    match requeue {
        Ok(rows) => {
            // Not bounded by the batch limit: `UPDATE … LIMIT` needs a
            // subquery in Postgres, and a stranded claim is rare by
            // construction — it takes a replica dying mid-delivery.
            outcome.requeued = rows.len() as u64;
            if outcome.requeued > 0 {
                tracing::warn!(
                    requeued = outcome.requeued,
                    "Requeued task result deliveries whose claim went stale"
                );
            }
        }
        Err(error) => {
            tracing::warn!(%error, "The delivery sweep could not requeue stale claims");
            return SweepOutcome::default();
        }
    }

    // Phase (ii) — deliver what is pending, in the same pass. Split across two
    // ticks, the worst case for a stranded result would be ten minutes.
    //
    // The predicate is exactly `deliver_one_child_db_only`'s own re-read guard.
    // A row this scan returns but that guard rejects is a no-op *without a
    // state change*, so it would be re-selected on every pass and starve
    // everything behind it.
    //
    // Deliberately no `updated_at > now() - <window>`: a pending row can sit
    // unmodified for as long as its origin stays busy, and ageing it out would
    // silently lose the result this sweep exists to save.
    let scan = db
        .query_all_raw(named_statement_from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            POSTGRES_QUERY_DELIVERY_SWEEP_SCAN,
            format!(
                r#"
            SELECT "id" FROM "chats"
            WHERE ("assistant_configuration" #>> '{{provenance,kind}}') = '{delegation}'
              AND ("assistant_configuration" #>> '{{provenance,run_mode}}') = '{async_mode}'
              AND ("assistant_configuration" #>> '{{provenance,result_delivery,state}}') = '{pending}'
            ORDER BY "updated_at" ASC
            LIMIT $1
            "#,
                pending = ResultDeliveryState::Pending.as_str(),
                delegation = ChatProvenanceKind::Delegation.as_str(),
                async_mode = ProvenanceRunMode::Async.as_str(),
            ),
            [(SWEEP_BATCH_LIMIT as i64).into()],
        ))
        .await;
    let children: Vec<Uuid> = match scan {
        Ok(rows) => rows
            .iter()
            .filter_map(|row| Uuid::try_get(row, "", "id").ok())
            .collect(),
        Err(error) => {
            tracing::warn!(%error, "The delivery sweep could not scan for pending deliveries");
            return SweepOutcome::default();
        }
    };

    for child_chat_id in children {
        match deliver_one_child_db_only(db, child_chat_id, result_max_chars, stale_after_secs).await
        {
            Ok(ChildSweepStep::Delivered) => outcome.delivered += 1,
            Ok(ChildSweepStep::Deferred) => outcome.deferred += 1,
            Ok(ChildSweepStep::Superseded) => outcome.superseded += 1,
            Ok(ChildSweepStep::Failed) => outcome.failed += 1,
            Ok(ChildSweepStep::AlreadyDelivered | ChildSweepStep::Gone) => {
                outcome.already_delivered += 1
            }
            Err(error) => {
                tracing::warn!(%error, %child_chat_id, "The delivery sweep could not deliver a task result");
                outcome.errored += 1;
            }
        }
    }

    outcome
}

/// One child, start to finish, without an `AppState`, a policy engine, a
/// profile, a generation lease or a model call.
///
/// The claim lives **inside** the transaction, which is where this path differs
/// from [`deliver_task_result`] — and it can, precisely because it runs no turn:
/// you cannot hold a Postgres transaction across a model call, but you can hold
/// one across four statements. The stronger shape is worth taking. A crash
/// anywhere below commits nothing, so the sweep can never strand a `claimed`
/// row of its own, and the corollary is that phase (i) only ever requeues the
/// live path's claims.
async fn deliver_one_child_db_only(
    db: &DatabaseConnection,
    child_chat_id: Uuid,
    result_max_chars: usize,
    stale_after_secs: u64,
) -> Result<ChildSweepStep, Report> {
    let txn = db.begin().await?;

    // 1-2. Re-read under the transaction. The scan is not in here with us, so
    //      a row can legitimately have moved on; that is `Gone`, not an error.
    let Some(child) = crate::db::entity::prelude::Chats::find_by_id(child_chat_id)
        .one(&txn)
        .await?
    else {
        return Ok(ChildSweepStep::Gone);
    };
    let Some(configuration) = parse_chat_configuration(&child)? else {
        return Ok(ChildSweepStep::Gone);
    };
    let Some(provenance) = configuration.provenance.clone() else {
        return Ok(ChildSweepStep::Gone);
    };
    if provenance.kind != ChatProvenanceKind::Delegation
        || provenance.run_mode != Some(ProvenanceRunMode::Async)
    {
        return Ok(ChildSweepStep::Gone);
    }
    let Some(delivery) = provenance.result_delivery.clone() else {
        return Ok(ChildSweepStep::Gone);
    };
    // 3. Another process took it between the scan and here.
    if delivery.state != ResultDeliveryState::Pending {
        return Ok(ChildSweepStep::AlreadyDelivered);
    }

    // Every terminal write below is fenced on the row still being `pending`,
    // with no claim token, because the sweep has not claimed it yet. A lost
    // fence means someone else owns the row now, which is `AlreadyDelivered`,
    // never an error.
    let close = |state: ResultDeliveryState, reason: &str| -> ResultDelivery {
        let mut closed = delivery.clone();
        closed.state = state;
        closed.reason = Some(reason.to_string());
        closed.at = sqlx::types::chrono::Utc::now().into();
        closed
    };

    // 4. An archived child. New with the sweep, and terminal: the archive pass
    //    skips runs whose generation has not finished, so an archived child IS
    //    finished, yet its delivery can still read `pending`. Left that way it
    //    would keep the origin's "runs in flight" indicator on forever, because
    //    that query deliberately does not exclude archived children — this is
    //    where that case is meant to be resolved.
    if child.archived_at.is_some() {
        let closed = close(
            ResultDeliveryState::Superseded,
            DELIVERY_REASON_CHILD_ARCHIVED,
        );
        return commit_terminal(txn, child_chat_id, &closed, ChildSweepStep::Superseded).await;
    }

    // 5. No origin recorded at all.
    let Some(origin_chat_id) = provenance.origin_chat_id else {
        let closed = close(ResultDeliveryState::Failed, DELIVERY_REASON_ORIGIN_MISSING);
        return commit_terminal(txn, child_chat_id, &closed, ChildSweepStep::Failed).await;
    };

    // 6. The origin row itself is gone. Provenance ids are plain values, never
    //    foreign keys, so a dangling one is expected rather than exceptional.
    let Some(origin) = crate::db::entity::prelude::Chats::find_by_id(origin_chat_id)
        .one(&txn)
        .await?
    else {
        let closed = close(ResultDeliveryState::Failed, DELIVERY_REASON_ORIGIN_MISSING);
        return commit_terminal(txn, child_chat_id, &closed, ChildSweepStep::Failed).await;
    };

    // 7. Archiving is the user saying they are done with that conversation.
    //    Appending to it afterwards would raise it in the listing over work
    //    they stopped caring about.
    if origin.archived_at.is_some() {
        let closed = close(
            ResultDeliveryState::Superseded,
            DELIVERY_REASON_ORIGIN_ARCHIVED,
        );
        return commit_terminal(txn, child_chat_id, &closed, ChildSweepStep::Superseded).await;
    }

    // 8. The inlined authorization rule. The sweep holds no `PolicyEngine` —
    //    it has no request and no subject to evaluate one against — so the
    //    `submit_message` rule is evaluated by hand. That rule is
    //    ownership-only, so origin owner == child owner is exactly what it
    //    would have decided. Writing into a chat whose owner differs is the
    //    ERMAIN-485 class, and the refusal appending nothing is the point.
    if origin.owner_user_id != child.owner_user_id {
        let closed = close(ResultDeliveryState::Failed, DELIVERY_REASON_OWNER_MISMATCH);
        return commit_terminal(txn, child_chat_id, &closed, ChildSweepStep::Failed).await;
    }

    // 9. CLAIM, `pending -> claimed`, fenced on the delivery id and gated on
    //    the origin's lease being free.
    //
    //    The free-lease test is an `EXISTS` subquery rather than a
    //    `SELECT … FOR UPDATE`: the heartbeat is one batched statement over all
    //    of a replica's running chats, so a row lock held here would block that
    //    whole statement, and past `stale_after_secs` another replica's reaper
    //    would flip *every* generation in the batch to `errored`. This is also
    //    why the sweep takes no lease of its own — it runs no turn and has
    //    nothing to hold one for.
    let claim_token = Uuid::new_v4().to_string();
    let mut claimed = delivery.clone();
    claimed.state = ResultDeliveryState::Claimed;
    claimed.claimed_by = Some(claim_token.clone());
    claimed.claimed_at = Some(sqlx::types::chrono::Utc::now().into());
    claimed.attempts = delivery.attempts.saturating_add(1);
    claimed.at = sqlx::types::chrono::Utc::now().into();
    let claim_payload = serde_json::to_value(&claimed)?;
    let claim_rows = txn
        .query_all_raw(named_statement_from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            POSTGRES_QUERY_DELIVERY_SWEEP_CLAIM,
            format!(
                r#"
            UPDATE "chats"
            SET "assistant_configuration" = jsonb_set(
                "assistant_configuration", '{{provenance,result_delivery}}', $3::jsonb, true)
            WHERE "id" = $1
              AND ("assistant_configuration" #>> '{{provenance,result_delivery,state}}') = '{pending}'
              AND ("assistant_configuration" #>> '{{provenance,result_delivery,delivery_id}}') = $2
              AND EXISTS (
                SELECT 1 FROM "chats" AS "o"
                WHERE "o"."id" = $4
                  AND "o"."archived_at" IS NULL
                  AND NOT {unfinished}
              )
            RETURNING "id"
            "#,
                pending = ResultDeliveryState::Pending.as_str(),
                // Emits a *bound* `$5::double precision`, so it is the fifth
                // parameter of this statement and not a literal.
                unfinished = generation_unfinished_condition("\"o\"", 5),
            ),
            [
                child_chat_id.into(),
                delivery.delivery_id.to_string().into(),
                claim_payload.into(),
                origin_chat_id.into(),
                (stale_after_secs as f64).into(),
            ],
        ))
        .await?;
    if claim_rows.is_empty() {
        // The origin is running with a fresh heartbeat, or parked on an
        // approval it is waiting for a person to answer, or it was archived
        // under us, or another process claimed first. Nothing is written in
        // this transaction.
        txn.rollback().await?;

        // 9b. Rotation — a separate, COMMITTED write, and load-bearing rather
        //     than bookkeeping. The scan orders by `updated_at` under a LIMIT,
        //     so a deferred child that wrote nothing keeps its old timestamp,
        //     sorts to the front of every future pass, and `SWEEP_BATCH_LIMIT`
        //     children whose origins are parked on an approval — which never
        //     ages out — would hide row 201 forever.
        //
        //     Guarded on `pending`, which makes it a harmless no-op in the case
        //     where the zero rows came from someone else claiming first.
        let mut rotated = delivery.clone();
        rotated.attempts = delivery.attempts.saturating_add(1);
        rotated.at = sqlx::types::chrono::Utc::now().into();
        set_delivery_state_in(
            db,
            child_chat_id,
            &rotated,
            ResultDeliveryState::Pending,
            None,
        )
        .await;
        return Ok(ChildSweepStep::Deferred);
    }

    // 10. Idempotency. A crash after the append but before the state write
    //     leaves the row in the conversation and the delivery `claimed`; phase
    //     (i) then requeues it and we arrive here with the row already there.
    //     The error is NOT folded into `None`: "the query failed" read as "no
    //     row exists" is precisely how the duplicate gets written.
    let probe = txn
        .query_all_raw(named_statement_from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            POSTGRES_QUERY_DELIVERY_DUPLICATE_PROBE,
            r#"
            SELECT "id" FROM "messages"
            WHERE "chat_id" = $1
              AND ("input_parameters" #>> '{task_result,delivery_id}') = $2
            LIMIT 1
            "#
            .to_string(),
            [
                origin_chat_id.into(),
                delivery.delivery_id.to_string().into(),
            ],
        ))
        .await?;
    let existing = probe
        .first()
        .and_then(|row| Uuid::try_get(row, "", "id").ok());

    let delivered_message_id = match existing {
        Some(id) => id,
        None => {
            // 11. The anchor. An `Err` here is NOT `None`: `None` means "no
            //     anchor", which `append_message_unchecked` reads as "rebuild
            //     no lineage" and which deactivates every other row in the
            //     conversation.
            let tip = crate::models::message::get_active_thread_tip(&txn, &origin_chat_id).await?;

            // 12. Build and append. Everything describing the result is copied
            //     off the stored envelope verbatim — the status was settled
            //     when the delivery was recorded, and re-deriving it would let
            //     a re-read change a result already promised to the origin
            //     model by the run's `{{result_disposition}}` preamble. That is
            //     also why a `failed` / `result_missing` delivery is appended
            //     rather than closed: an empty summary is news, silence is not.
            let task = configuration.task.as_ref();
            let parent_tool_call_id = task
                .and_then(|task| task.parent_tool_call_id.clone())
                .unwrap_or_default();
            let scheduling = task.map(|task| task.scheduling).unwrap_or_default();
            let (summary, truncated) = child_answer_for_delivery(
                &txn,
                result_max_chars,
                child_chat_id,
                &child,
                &delivery,
                provenance.rebase_cutoff.unwrap_or(child.created_at),
                parent_tool_call_id.clone(),
            )
            .await;
            let part = crate::models::message::ContentPart::TaskResult(
                crate::models::message::ContentPartTaskResult {
                    child_chat_id,
                    parent_tool_call_id,
                    status: delivery.status.clone(),
                    reason: delivery.reason.clone(),
                    summary,
                    truncated,
                    // Verbatim: the sequence is 0-based and already correct on
                    // the envelope.
                    sequence: delivery.sequence,
                },
            );
            let input_parameters = crate::models::message::InputParameters {
                action_facet_id: None,
                action_facet_args: None,
                mentioned_assistant_ids: None,
                delegation_run_mode: None,
                task_result: Some(crate::models::message::TaskResultInput {
                    delivery_id: delivery.delivery_id,
                    child_chat_id,
                    result_message_id: delivery.result_message_id,
                    status: delivery.status.clone(),
                    reason: delivery.reason.clone(),
                    // The field stays a string on the wire; the enum is the
                    // source of the spelling, never a literal.
                    scheduling: scheduling.as_str().to_string(),
                    sequence: delivery.sequence,
                }),
            };
            // The live path writes the requesting profile's id here. The sweep
            // has no profile, and does not need one: step 8 has just proved
            // the origin and the child share an owner, and the live path's
            // profile is always the origin's owner.
            let raw_message = serde_json::json!({
                "role": "user",
                "content": [serde_json::to_value(&part)?],
                "name": origin.owner_user_id,
            });
            // Nothing about a generation is recorded, because none happened:
            // this row is material that arrived, not a turn that ran.
            crate::models::message::append_message_unchecked(
                &txn,
                &origin_chat_id,
                raw_message,
                tip.as_ref().map(|row| &row.id),
                None,
                None,
                &[],
                None,
                None,
                Some(serde_json::to_value(&input_parameters)?),
            )
            .await?
            .id
        }
    };

    // 13. DELIVERED, fenced on our own claim token, in the same transaction as
    //     the append.
    //
    //     Our own fence cannot lose: the claim above is in this transaction and
    //     holds the row's lock, so no one else can be in between. It is the
    //     other direction that matters and that this uniformity buys — a
    //     stalled live delivery whose claim phase (i) requeued and this pass
    //     re-took finds its own `claimed -> delivered` fenced on a `claimed_by`
    //     that is no longer its token, and rolls its own insert back. That is
    //     what closes sweeper-versus-live-delivery.
    let mut delivered = claimed.clone();
    delivered.state = ResultDeliveryState::Delivered;
    delivered.message_id = Some(delivered_message_id);
    delivered.at = sqlx::types::chrono::Utc::now().into();
    if !set_delivery_state_in(
        &txn,
        child_chat_id,
        &delivered,
        ResultDeliveryState::Claimed,
        Some(&claim_token),
    )
    .await
    {
        txn.rollback().await?;
        return Err(eyre::eyre!(
            "lost the delivery fence for child {child_chat_id}; the appended result was rolled back"
        ));
    }

    // 14. One commit for the claim, the append and the state write together.
    //     A failure here leaves the row `pending` for the next tick.
    txn.commit().await?;
    Ok(ChildSweepStep::Delivered)
}

/// Write one terminal delivery state and commit, or report that someone else
/// owns the row now.
///
/// Guarded on `pending` with no claim token: these are the decisions the sweep
/// reaches *before* claiming, so there is no token to fence on yet and the row
/// must still be the one the scan saw.
async fn commit_terminal(
    txn: sea_orm::DatabaseTransaction,
    child_chat_id: Uuid,
    closed: &ResultDelivery,
    step: ChildSweepStep,
) -> Result<ChildSweepStep, Report> {
    if !set_delivery_state_in(
        &txn,
        child_chat_id,
        closed,
        ResultDeliveryState::Pending,
        None,
    )
    .await
    {
        txn.rollback().await?;
        return Ok(ChildSweepStep::AlreadyDelivered);
    }
    txn.commit().await?;
    Ok(step)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::ActiveValue;

    static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("../sqitch/deploy");

    fn claimed_delivery(token: &str) -> ResultDelivery {
        ResultDelivery {
            state: ResultDeliveryState::Claimed,
            delivery_id: Uuid::new_v4(),
            result_message_id: None,
            status: DelegationRunStatus::Completed.as_str().to_string(),
            reason: None,
            claimed_by: Some(token.to_string()),
            claimed_at: Some(sqlx::types::chrono::Utc::now().into()),
            message_id: None,
            reaction_message_id: None,
            attempts: 1,
            redeliveries: 0,
            redelivery_of: None,
            sequence: 0,
            at: sqlx::types::chrono::Utc::now().into(),
        }
    }

    async fn insert_child_holding(db: &DatabaseConnection, delivery: &ResultDelivery) -> Uuid {
        let id = Uuid::new_v4();
        let now: sea_orm::prelude::DateTimeWithTimeZone = sqlx::types::chrono::Utc::now().into();
        crate::db::entity::chats::Entity::insert(crate::db::entity::chats::ActiveModel {
            id: ActiveValue::Set(id),
            owner_user_id: ActiveValue::Set("owner".to_string()),
            assistant_configuration: ActiveValue::Set(Some(serde_json::json!({
                "provenance": {
                    "kind": ChatProvenanceKind::Delegation.as_str(),
                    "depth": 1,
                    "run_mode": ProvenanceRunMode::Async.as_str(),
                    "result_delivery": serde_json::to_value(delivery).unwrap(),
                },
            }))),
            created_at: ActiveValue::Set(now),
            updated_at: ActiveValue::Set(now),
            ..Default::default()
        })
        .exec(db)
        .await
        .expect("insert child");
        id
    }

    async fn stored_delivery(db: &DatabaseConnection, child_chat_id: Uuid) -> ResultDelivery {
        let chat = crate::db::entity::prelude::Chats::find_by_id(child_chat_id)
            .one(db)
            .await
            .unwrap()
            .unwrap();
        serde_json::from_value(
            chat.assistant_configuration.unwrap()["provenance"]["result_delivery"].clone(),
        )
        .unwrap()
    }

    /// T9. The delivery fence, asserted directly on the write that carries it.
    ///
    /// `claimed_by` is the token, and this is the only test in the stack that
    /// pins it. The case it protects is the one the backstop sweep creates:
    /// a live delivery stalls, the sweep judges its claim stale, requeues it and
    /// hands it to a later claimant — and the stalled holder then finishes its
    /// append against a stale snapshot. Its `claimed -> delivered` write must
    /// fail, which is what rolls its duplicate row back with it.
    ///
    /// Written here rather than in the integration suite because the fenced
    /// write is private to this module, and going through a public entry point
    /// would need a three-way interleaving to reach the same state.
    ///
    /// # Test Categories
    /// - `uses-db`
    #[sqlx::test(migrator = "MIGRATOR")]
    async fn fenced_delivered_cas_refuses_a_stale_claim(pool: sqlx::PgPool) {
        let db = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool);

        // Committed, and held by somebody else's token.
        let held = claimed_delivery("token-b");
        let child_chat_id = insert_child_holding(&db, &held).await;

        let mut delivered = held.clone();
        delivered.state = ResultDeliveryState::Delivered;
        delivered.message_id = Some(Uuid::new_v4());

        // The stalled holder, finishing under the token it was given.
        let txn = db.begin().await.unwrap();
        let won = set_delivery_state_in(
            &txn,
            child_chat_id,
            &delivered,
            ResultDeliveryState::Claimed,
            Some("token-a"),
        )
        .await;
        txn.rollback().await.unwrap();
        assert!(
            !won,
            "a claim that was requeued and re-taken must not be able to finish; \
             the state alone does not catch it, because the row is `claimed` either way"
        );

        let after = stored_delivery(&db, child_chat_id).await;
        assert_eq!(after.state, ResultDeliveryState::Claimed);
        assert_eq!(after.claimed_by.as_deref(), Some("token-b"));
        assert!(after.message_id.is_none());

        // The control: the same write, under the right token, wins. Without it
        // this test would pass against a compare-and-set that never matches.
        let txn = db.begin().await.unwrap();
        let won = set_delivery_state_in(
            &txn,
            child_chat_id,
            &delivered,
            ResultDeliveryState::Claimed,
            Some("token-b"),
        )
        .await;
        assert!(won, "the holder of the claim must be able to finish it");
        txn.commit().await.unwrap();
        assert_eq!(
            stored_delivery(&db, child_chat_id).await.state,
            ResultDeliveryState::Delivered
        );
    }
}
