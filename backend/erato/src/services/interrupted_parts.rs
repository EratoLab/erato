//! Settling tool-call placeholders that a dying process left behind.
//!
//! Every normal exit from a delegation batch goes through one
//! `drain_in_flight`, which settles the slot it launched and the queue behind
//! it. A hard crash has no such exit: the assistant row keeps whatever the
//! launch committed, so its `tool_use` parts stay `in_progress` with an
//! `output.status` of `working` (a run that started) or `queued` (a slot that
//! never got one). Nothing else will ever answer them — the process that
//! owed the answer is gone.
//!
//! Left alone those parts are not inert. The history walk replays an
//! `in_progress` part as a tool call the model was never given an answer to,
//! and the trace has to guess at a status for a call that never returned.
//!
//! This is the backstop that ends them, and it is deliberately the narrowest
//! thing that can: one scan, one rewrite per message, no generation lease, no
//! `AppState`, no model call. It runs from the cleanup worker's tick beside
//! [`crate::services::task_delivery::sweep_task_result_deliveries`], which is
//! crash recovery for the same class of failure.
//!
//! # What it must not touch
//!
//! An unsettled part is the *normal* state of plenty of healthy work, so the
//! sweep only acts on positive evidence that nothing is left to settle it:
//!
//! - **A busy origin.** `generation_unfinished_condition` is the one spelling
//!   of "this chat still owes an outcome": running with a fresh lease, or
//!   parked on an approval the user can still answer. A parked turn's queued
//!   siblings are unsettled on purpose and must survive the sweep.
//! - **A detached dispatch.** An `async`/`background` part is frozen at launch
//!   and carries no `status` at all, so it never matches the scan. Its result
//!   comes home as its own message, not by settling this part.
//! - **A live child.** Belt and braces for the wait path, where the child runs
//!   inside the origin's turn and so cannot outlive it: if the named child
//!   chat is somehow still writing, its slot is left alone.

use crate::metrics_constants::{
    POSTGRES_QUERY_INTERRUPTED_PARTS_LIVE_CHILDREN, POSTGRES_QUERY_INTERRUPTED_PARTS_SCAN,
    POSTGRES_QUERY_INTERRUPTED_PARTS_SETTLE,
};
use crate::models::chat::generation_unfinished_condition;
use crate::query_metrics::named_statement_from_sql_and_values;
use crate::services::delegation::{DelegationRunReason, DelegationRunStatus};
use sea_orm::prelude::Uuid;
use sea_orm::{ConnectionTrait, DatabaseConnection, TryGetable};
use serde_json::{Value as JsonValue, json};

/// How many messages one tick will rewrite. A crash-orphaned row is rare by
/// construction, and the tick repeats, so a bound costs nothing but keeps one
/// pathological restart from holding the worker.
const SWEEP_BATCH_LIMIT: i64 = 200;

/// `output.status` of a wait-path slot whose run had started.
const STATUS_WORKING: &str = "working";
/// `output.status` of a wait-path slot still waiting for a free one.
const STATUS_QUEUED: &str = "queued";

/// What one sweep did. Counted rather than logged per row: the interesting
/// signal is "this deployment is losing turns", which is a rate.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct InterruptedPartsOutcome {
    /// Assistant rows rewritten.
    pub messages: u64,
    /// Placeholders settled across those rows.
    pub parts: u64,
    /// Placeholders left alone because their child was still writing.
    pub live_children: u64,
}

impl InterruptedPartsOutcome {
    pub fn touched(&self) -> bool {
        self.messages > 0 || self.live_children > 0
    }
}

/// The containment probe for "this row still holds an unanswered tool call".
///
/// Bound as text and cast rather than handed over as a JSON value: it is a
/// literal this module builds, and text is the one binding every driver path
/// agrees about (the same reasoning as `find_delegation_tool_call`).
fn in_progress_probe() -> String {
    json!([{ "content_type": "tool_use", "status": "in_progress" }]).to_string()
}

/// Is this part a wait-path placeholder the sweep is allowed to end?
///
/// Keyed on `output.status` rather than on the tool name: the placeholder
/// shapes are what the pop loop writes, and a part that carries one of them
/// is by construction a slot that owed an answer. A detached dispatch carries
/// no `status` at all and so is never a match.
fn is_settleable_placeholder(part: &JsonValue) -> bool {
    if part.get("content_type").and_then(JsonValue::as_str) != Some("tool_use") {
        return false;
    }
    if part.get("status").and_then(JsonValue::as_str) != Some("in_progress") {
        return false;
    }
    matches!(
        part.get("output")
            .and_then(|output| output.get("status"))
            .and_then(JsonValue::as_str),
        Some(STATUS_WORKING | STATUS_QUEUED)
    )
}

/// The child a placeholder launched, when it launched one.
///
/// A `queued` slot names none because none exists yet, and a reader has to be
/// able to tell that from a run that started.
fn placeholder_child(part: &JsonValue) -> Option<Uuid> {
    let output = part.get("output")?;
    output
        .get("delegate_chat_id")
        .or_else(|| output.get("child_run_id"))
        .and_then(JsonValue::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
}

/// Rewrite one placeholder into its terminal form, in place.
///
/// Everything already on the output is kept — the child ids, the assistant
/// identity, anything a later version added. Only the two keys that state the
/// outcome are written, so a settled part is the ordinary terminal shape and
/// nothing else about the row moves.
fn settle_part(part: &mut JsonValue) {
    if let Some(object) = part.as_object_mut() {
        // Not `success`: the call produced no result. The four-value tool
        // status has no `cancelled`, and the envelope below carries the finer
        // distinction for anyone who needs it.
        object.insert("status".to_string(), json!("error"));
        object
            .entry("ended_at")
            .or_insert_with(|| json!(chrono::Utc::now().to_rfc3339()));
    }
    if let Some(output) = part.get_mut("output").and_then(JsonValue::as_object_mut) {
        output.insert(
            "status".to_string(),
            json!(DelegationRunStatus::Cancelled.as_str()),
        );
        output.insert(
            "reason".to_string(),
            json!(DelegationRunReason::Interrupted.as_str()),
        );
    }
}

/// Which of `children` are still writing.
async fn live_children(
    db: &DatabaseConnection,
    children: &[Uuid],
    stale_after_secs: u64,
) -> Vec<Uuid> {
    if children.is_empty() {
        return Vec::new();
    }
    let statement = named_statement_from_sql_and_values(
        sea_orm::DatabaseBackend::Postgres,
        POSTGRES_QUERY_INTERRUPTED_PARTS_LIVE_CHILDREN,
        format!(
            r#"
            SELECT "chats"."id" AS "id"
            FROM "chats"
            WHERE "chats"."id" = ANY($1::uuid[])
              AND {unfinished}
            "#,
            unfinished = generation_unfinished_condition("\"chats\"", 2),
        ),
        [children.to_vec().into(), (stale_after_secs as f64).into()],
    );
    match db.query_all_raw(statement).await {
        Ok(rows) => rows
            .iter()
            .filter_map(|row| Uuid::try_get(row, "", "id").ok())
            .collect(),
        Err(error) => {
            // Fail closed: an unreadable child is treated as alive, so a
            // transient error can only ever delay a settle, never cause one
            // that should not have happened.
            tracing::warn!(%error, "Could not check delegated children for liveness");
            children.to_vec()
        }
    }
}

/// End every crash-orphaned placeholder whose origin chat has no writer left.
///
/// Returns rather than errors: this runs inside the cleanup tick beside the
/// delivery backstop, and one bad row must not take the rest of the tick — or
/// the retention pass behind it — down.
pub async fn sweep_interrupted_tool_parts(
    db: &DatabaseConnection,
    stale_after_secs: u64,
) -> InterruptedPartsOutcome {
    let mut outcome = InterruptedPartsOutcome::default();
    let probe = in_progress_probe();

    let statement = named_statement_from_sql_and_values(
        sea_orm::DatabaseBackend::Postgres,
        POSTGRES_QUERY_INTERRUPTED_PARTS_SCAN,
        format!(
            r#"
            SELECT "messages"."id" AS "id", "messages"."raw_message" AS "raw_message"
            FROM "messages"
            JOIN "chats" ON "chats"."id" = "messages"."chat_id"
            WHERE "messages"."raw_message" -> 'content' @> $1::jsonb
              AND NOT {unfinished}
            ORDER BY "messages"."updated_at" ASC
            LIMIT $3
            "#,
            unfinished = generation_unfinished_condition("\"chats\"", 2),
        ),
        [
            probe.clone().into(),
            (stale_after_secs as f64).into(),
            SWEEP_BATCH_LIMIT.into(),
        ],
    );

    let rows = match db.query_all_raw(statement).await {
        Ok(rows) => rows,
        Err(error) => {
            tracing::warn!(%error, "The interrupted-parts sweep could not scan for orphans");
            return outcome;
        }
    };

    for row in rows {
        let (Ok(message_id), Ok(mut raw_message)) = (
            Uuid::try_get(&row, "", "id"),
            JsonValue::try_get(&row, "", "raw_message"),
        ) else {
            continue;
        };

        let Some(content) = raw_message
            .get("content")
            .and_then(JsonValue::as_array)
            .cloned()
        else {
            continue;
        };

        // Two passes over the parts: gather the children first so their
        // liveness is one query per message rather than one per slot.
        let candidates: Vec<(usize, Option<Uuid>)> = content
            .iter()
            .enumerate()
            .filter(|(_, part)| is_settleable_placeholder(part))
            .map(|(index, part)| (index, placeholder_child(part)))
            .collect();
        if candidates.is_empty() {
            continue;
        }

        let children: Vec<Uuid> = candidates.iter().filter_map(|(_, child)| *child).collect();
        let alive = live_children(db, &children, stale_after_secs).await;

        let mut settled = 0u64;
        let Some(parts) = raw_message
            .get_mut("content")
            .and_then(JsonValue::as_array_mut)
        else {
            continue;
        };
        for (index, child) in candidates {
            if child.is_some_and(|id| alive.contains(&id)) {
                outcome.live_children += 1;
                continue;
            }
            let Some(part) = parts.get_mut(index) else {
                continue;
            };
            settle_part(part);
            settled += 1;
        }
        if settled == 0 {
            continue;
        }

        // Guarded by the same probe the scan used: if something settled this
        // row in between, the probe no longer matches and the write is a
        // no-op rather than a clobber. A full compare-and-set would be
        // stronger, but the sweep only ever runs on chats with no writer
        // left, so the window it is closing is already vanishingly small.
        let update = named_statement_from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            POSTGRES_QUERY_INTERRUPTED_PARTS_SETTLE,
            r#"
            UPDATE "messages"
            SET "raw_message" = $1::jsonb, "updated_at" = now()
            WHERE "id" = $2::uuid
              AND "raw_message" -> 'content' @> $3::jsonb
            "#,
            [
                raw_message.to_string().into(),
                message_id.into(),
                probe.clone().into(),
            ],
        );
        match db.execute_raw(update).await {
            Ok(result) if result.rows_affected() > 0 => {
                outcome.messages += 1;
                outcome.parts += settled;
            }
            Ok(_) => {}
            Err(error) => {
                tracing::warn!(
                    %error,
                    %message_id,
                    "Could not settle interrupted tool parts on a message"
                );
            }
        }
    }

    outcome
}
