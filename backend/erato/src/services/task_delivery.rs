//! Getting a finished `async` task's result back into the chat it was started
//! from.
//!
//! Three independent steps, each idempotent, because any of them can be
//! interrupted by a process dying: record what is owed
//! ([`record_pending_delivery`]), take it ([`deliver_task_result`], behind two
//! compare-and-sets), and look for anything owed to a chat that just went idle
//! ([`drain_pending_deliveries`]).
//!
//! The split is what makes a crash survivable. A run whose tail never got to
//! deliver still has its result recorded, and the next tail on the origin chat
//! — any tail, from any replica — finds it.

use crate::metrics_constants::{
    POSTGRES_QUERY_DELIVERY_CLAIM, POSTGRES_QUERY_DELIVERY_DUPLICATE_PROBE,
    POSTGRES_QUERY_DELIVERY_NEXT_PENDING, POSTGRES_QUERY_DELIVERY_RECORD,
    POSTGRES_QUERY_DELIVERY_STATE_SET,
};
use crate::models::chat::{
    ChatProvenanceKind, ResultDelivery, ResultDeliveryState, parse_chat_configuration,
};
use crate::models::message::ProvenanceRunMode;
use crate::policy::engine::PolicyEngine;
use crate::query_metrics::named_statement_from_sql_and_values;
use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use crate::services::background_tasks::Takeover;
use crate::services::delegation::{DelegationRunReason, DelegationRunStatus};
use crate::state::AppState;
use sea_orm::prelude::Uuid;
use sea_orm::{ConnectionTrait, EntityTrait, TransactionTrait, TryGetable};

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
            app_state,
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
            closed.reason = Some("origin_missing".to_string());
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
        closed.reason = Some("owner_mismatch".to_string());
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
        closed.reason = Some("origin_archived".to_string());
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
        closed.reason = Some("origin_archived".to_string());
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
                    app_state,
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
async fn child_answer_for_delivery(
    app_state: &AppState,
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
        app_state,
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
        app_state.config.delegation.result_max_chars,
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
