//! Background task manager for long-running streaming operations.
//!
//! This module provides infrastructure for managing long-running message generation
//! tasks that can continue in the background even if the client disconnects.
//! Clients can resume streaming from any point by reconnecting.

use crate::config::GenerationStatusConfig;
use crate::metrics_constants::{
    POSTGRES_QUERY_DELEGATION_TIMEOUT_BACKSTOP, POSTGRES_QUERY_GENERATION_CLEANUP,
    POSTGRES_QUERY_GENERATION_FINISH, POSTGRES_QUERY_GENERATION_HEARTBEAT,
    POSTGRES_QUERY_GENERATION_REAP, POSTGRES_QUERY_GENERATION_SHARED_CLEANUP,
    POSTGRES_QUERY_GENERATION_SHARED_COMMAND, POSTGRES_QUERY_GENERATION_SHARED_COMMAND_CONSUME,
    POSTGRES_QUERY_GENERATION_SHARED_COMMANDS, POSTGRES_QUERY_GENERATION_SHARED_EVENTS,
    POSTGRES_QUERY_GENERATION_SHARED_FINISH, POSTGRES_QUERY_GENERATION_SHARED_START,
    POSTGRES_QUERY_GENERATION_START,
};
use crate::models::message::ContentPart;
use crate::query_metrics::named_statement_from_sql_and_values;
use crate::server::api::v1beta::ChatMessage;
use sea_orm::{ConnectionTrait, DatabaseConnection, JsonValue};
use serde::{Deserialize, Serialize};
use sqlx::types::Uuid;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tokio::sync::{Notify, RwLock, broadcast, oneshot};
use tokio::task::JoinHandle;

use crate::services::client_tools::{ClientToolDelivery, ClientToolOutcome};

/// Maximum number of events to store in history per task
const MAX_EVENT_HISTORY: usize = 10_000;
const SHARED_COMMAND_POLL_INTERVAL: Duration = Duration::from_millis(100);

fn owner_pod() -> String {
    std::env::var("POD_NAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "local".to_string())
}

/// Terminal outcome of a generation, persisted as the chat's generation state.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TaskOutcome {
    Completed,
    Errored,
    /// The generation finished by stopping on an MCP tool approval awaiting
    /// the user's decision. Unlike the terminal outcomes this state has no
    /// retention window: the reaper and cleanup only touch 'running',
    /// 'completed' and 'errored', so a parked chat stays marked until a later
    /// generation (usually the approval's continuation) takes over the lease.
    AwaitingApproval,
}

impl TaskOutcome {
    fn as_db_str(self) -> &'static str {
        match self {
            TaskOutcome::Completed => "completed",
            TaskOutcome::Errored => "errored",
            TaskOutcome::AwaitingApproval => "awaiting_approval",
        }
    }

    /// State written to `temp_chat_generations`, which tracks the live stream
    /// lifecycle rather than the chat. A parked generation's stream did
    /// complete, and mapping it to 'completed' keeps the shared rows eligible
    /// for retention cleanup.
    fn as_stream_db_str(self) -> &'static str {
        match self {
            TaskOutcome::AwaitingApproval => "completed",
            other => other.as_db_str(),
        }
    }
}

/// Manager for background streaming tasks
#[derive(Clone, Debug)]
pub struct BackgroundTaskManager {
    /// Map of chat_id to streaming task
    /// Public for testing purposes
    pub tasks: Arc<RwLock<HashMap<Uuid, Arc<StreamingTask>>>>,
    /// Persists per-chat generation state when present; `None` keeps the
    /// manager purely in-memory (no DB writes, no heartbeat/reaper).
    db: Option<DatabaseConnection>,
    /// Handle to the heartbeat/reaper task, kept alive with the manager.
    _maintenance_task: Option<Arc<JoinHandle<()>>>,
}

impl BackgroundTaskManager {
    /// Create a new background task manager.
    ///
    /// `delegation_run_timeout_secs` arms the maintenance loop's timeout
    /// backstop for delegated runs; `None` (delegation not configured) leaves
    /// it off.
    pub fn new(
        db: Option<DatabaseConnection>,
        config: GenerationStatusConfig,
        delegation_run_timeout_secs: Option<u64>,
    ) -> Self {
        let tasks: Arc<RwLock<HashMap<Uuid, Arc<StreamingTask>>>> =
            Arc::new(RwLock::new(HashMap::new()));

        let maintenance_task = db.clone().map(|db| {
            let tasks = Arc::clone(&tasks);
            Arc::new(tokio::spawn(async move {
                Self::run_maintenance_task(db, tasks, config, delegation_run_timeout_secs).await;
            }))
        });

        Self {
            tasks,
            db,
            _maintenance_task: maintenance_task,
        }
    }

    /// Start a new background task for the given chat
    ///
    /// If a task already exists for this chat, it will be replaced.
    /// Returns a receiver for live events and the task handle.
    pub async fn start_task(
        &self,
        chat_id: Uuid,
        message_id: Uuid,
    ) -> (broadcast::Receiver<StreamingEvent>, Arc<StreamingTask>) {
        // Create a new streaming task
        let generation_id = Uuid::new_v4();
        let task = Arc::new(
            StreamingTask::new(message_id, generation_id)
                .with_shared_state(self.db.clone(), chat_id),
        );
        let receiver = task.subscribe();

        // Insert into the map, replacing any existing task
        {
            let mut tasks = self.tasks.write().await;
            tasks.insert(chat_id, Arc::clone(&task));
        }

        // Best-effort lease claim: a failed status write must never fail a
        // healthy generation.
        if let Some(db) = &self.db {
            let delete_statement = named_statement_from_sql_and_values(
                sea_orm::DatabaseBackend::Postgres,
                POSTGRES_QUERY_GENERATION_SHARED_START,
                "DELETE FROM temp_chat_generations WHERE chat_id = $1",
                [chat_id.into()],
            );
            if let Err(err) = db.execute_raw(delete_statement).await {
                tracing::warn!(chat_id = %chat_id, error = %err, "Failed to clear previous shared generation");
            }

            let shared_statement = named_statement_from_sql_and_values(
                sea_orm::DatabaseBackend::Postgres,
                POSTGRES_QUERY_GENERATION_SHARED_START,
                r#"
                INSERT INTO temp_chat_generations
                    (generation_id, chat_id, message_id, owner_pod)
                VALUES ($1, $2, $3, $4)
                "#,
                [
                    task.generation_id.into(),
                    chat_id.into(),
                    message_id.into(),
                    owner_pod().into(),
                ],
            );
            if let Err(err) = db.execute_raw(shared_statement).await {
                tracing::warn!(chat_id = %chat_id, error = %err, "Failed to persist shared generation start");
            }

            let statement = named_statement_from_sql_and_values(
                sea_orm::DatabaseBackend::Postgres,
                POSTGRES_QUERY_GENERATION_START,
                r#"
                UPDATE chats
                SET active_generation_id = $1,
                    generation_state = 'running',
                    generation_started_at = now(),
                    generation_heartbeat_at = now(),
                    generation_ended_at = NULL
                WHERE id = $2
                "#,
                [task.generation_id.into(), chat_id.into()],
            );
            if let Err(err) = db.execute_raw(statement).await {
                tracing::warn!(
                    chat_id = %chat_id,
                    error = %err,
                    "Failed to persist generation start"
                );
            }

            let task_for_commands = Arc::clone(&task);
            let db_for_commands = db.clone();
            tokio::spawn(async move {
                Self::run_command_listener(db_for_commands, task_for_commands).await;
            });
        }

        (receiver, task)
    }

    /// Get an existing task for the given chat
    ///
    /// Returns None if no task exists for this chat.
    pub async fn get_task(&self, chat_id: &Uuid) -> Option<Arc<StreamingTask>> {
        let tasks = self.tasks.read().await;
        tasks.get(chat_id).map(Arc::clone)
    }

    /// Remove a completed task from the manager and persist its terminal
    /// outcome. Gated on `generation_id` so a stale wrapper finishing late
    /// cannot remove (or mark terminal) a replacement generation.
    pub async fn remove_task(&self, chat_id: &Uuid, generation_id: Uuid, outcome: TaskOutcome) {
        {
            let mut tasks = self.tasks.write().await;
            if tasks
                .get(chat_id)
                .is_some_and(|task| task.generation_id == generation_id)
            {
                tasks.remove(chat_id);
            }
        }

        if let Some(db) = &self.db {
            let shared_statement = named_statement_from_sql_and_values(
                sea_orm::DatabaseBackend::Postgres,
                POSTGRES_QUERY_GENERATION_SHARED_FINISH,
                r#"
                UPDATE temp_chat_generations
                SET state = $1, ended_at = now(), heartbeat_at = now()
                WHERE generation_id = $2 AND state = 'running'
                "#,
                [outcome.as_stream_db_str().into(), generation_id.into()],
            );
            if let Err(err) = db.execute_raw(shared_statement).await {
                tracing::warn!(chat_id = %chat_id, error = %err, "Failed to persist shared generation outcome");
            }

            let statement = named_statement_from_sql_and_values(
                sea_orm::DatabaseBackend::Postgres,
                POSTGRES_QUERY_GENERATION_FINISH,
                r#"
                UPDATE chats
                SET generation_state = $1, generation_ended_at = now()
                WHERE id = $2
                  AND active_generation_id = $3
                  AND generation_state = 'running'
                "#,
                [
                    outcome.as_db_str().into(),
                    (*chat_id).into(),
                    generation_id.into(),
                ],
            );
            if let Err(err) = db.execute_raw(statement).await {
                tracing::warn!(
                    chat_id = %chat_id,
                    error = %err,
                    "Failed to persist generation outcome"
                );
            }
        }
    }

    async fn run_command_listener(db: DatabaseConnection, task: Arc<StreamingTask>) {
        loop {
            if task.is_completed() {
                return;
            }

            let statement = named_statement_from_sql_and_values(
                sea_orm::DatabaseBackend::Postgres,
                POSTGRES_QUERY_GENERATION_SHARED_COMMANDS,
                r#"
                SELECT command_id, command_type, tool_call_id, payload
                FROM temp_chat_generation_commands
                WHERE generation_id = $1 AND consumed_at IS NULL
                ORDER BY command_id
                "#,
                [task.generation_id.into()],
            );

            match db.query_all_raw(statement).await {
                Ok(commands) => {
                    for command in commands {
                        let command_id = match command.try_get::<i64>("", "command_id") {
                            Ok(value) => value,
                            Err(err) => {
                                tracing::warn!(error = %err, "Invalid shared generation command id");
                                continue;
                            }
                        };
                        let command_type = match command.try_get::<String>("", "command_type") {
                            Ok(value) => value,
                            Err(err) => {
                                tracing::warn!(error = %err, "Invalid shared generation command type");
                                continue;
                            }
                        };

                        if command_type == "abort" {
                            task.request_abort();
                        } else if command_type == "client_tool_result" {
                            let tool_call_id =
                                match command.try_get::<Option<String>>("", "tool_call_id") {
                                    Ok(Some(value)) => value,
                                    _ => continue,
                                };
                            let payload = command
                                .try_get::<Option<JsonValue>>("", "payload")
                                .ok()
                                .flatten()
                                .unwrap_or(JsonValue::Null);
                            let outcome = match payload {
                                JsonValue::Object(ref object) if object.get("error").is_some() => {
                                    ClientToolOutcome::Error(
                                        object
                                            .get("error")
                                            .and_then(|value| value.as_str())
                                            .unwrap_or("client tool failed")
                                            .to_string(),
                                    )
                                }
                                JsonValue::Object(ref object) if object.get("result").is_some() => {
                                    ClientToolOutcome::Result(
                                        object.get("result").cloned().unwrap_or(JsonValue::Null),
                                    )
                                }
                                _ => ClientToolOutcome::Error(
                                    "client tool returned neither a result nor an error"
                                        .to_string(),
                                ),
                            };
                            let _ = task
                                .deliver_client_tool_result(&tool_call_id, outcome)
                                .await;
                        }

                        let consume_statement = named_statement_from_sql_and_values(
                            sea_orm::DatabaseBackend::Postgres,
                            POSTGRES_QUERY_GENERATION_SHARED_COMMAND_CONSUME,
                            "UPDATE temp_chat_generation_commands SET consumed_at = now() WHERE command_id = $1 AND consumed_at IS NULL",
                            [command_id.into()],
                        );
                        if let Err(err) = db.execute_raw(consume_statement).await {
                            tracing::warn!(error = %err, "Failed to consume shared generation command");
                        }
                    }
                }
                Err(err) => {
                    tracing::warn!(error = %err, "Failed to poll shared generation commands")
                }
            }

            tokio::time::sleep(SHARED_COMMAND_POLL_INTERVAL).await;
        }
    }

    /// Return the active shared generation for a chat, if one is registered.
    pub async fn get_shared_generation(&self, chat_id: &Uuid) -> Option<(Uuid, Option<Uuid>)> {
        let db = self.db.as_ref()?;
        let statement = named_statement_from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            POSTGRES_QUERY_GENERATION_SHARED_START,
            "SELECT generation_id, message_id FROM temp_chat_generations WHERE chat_id = $1 AND state = 'running'",
            [(*chat_id).into()],
        );
        let row = db.query_one_raw(statement).await.ok().flatten()?;
        Some((
            row.try_get("", "generation_id").ok()?,
            row.try_get("", "message_id").ok()?,
        ))
    }

    /// Read persisted events after the given global event id.
    pub async fn get_shared_events(
        &self,
        generation_id: Uuid,
        after_event_id: i64,
    ) -> Result<Vec<(i64, StreamingEvent)>, String> {
        let db = self
            .db
            .as_ref()
            .ok_or_else(|| "database unavailable".to_string())?;
        let statement = named_statement_from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            POSTGRES_QUERY_GENERATION_SHARED_EVENTS,
            "SELECT event_id, event FROM temp_chat_generation_events WHERE generation_id = $1 AND event_id > $2 ORDER BY event_id",
            [generation_id.into(), after_event_id.into()],
        );
        let rows = db
            .query_all_raw(statement)
            .await
            .map_err(|err| err.to_string())?;
        rows.into_iter()
            .map(|row| {
                let event_id = row.try_get("", "event_id").map_err(|err| err.to_string())?;
                let payload: JsonValue = row.try_get("", "event").map_err(|err| err.to_string())?;
                let event = serde_json::from_value(payload).map_err(|err| err.to_string())?;
                Ok((event_id, event))
            })
            .collect()
    }

    pub async fn enqueue_abort(&self, generation_id: Uuid) -> Result<(), String> {
        self.enqueue_command(generation_id, "abort", None, None)
            .await
    }

    pub async fn enqueue_client_tool_result(
        &self,
        generation_id: Uuid,
        tool_call_id: &str,
        payload: JsonValue,
    ) -> Result<(), String> {
        self.enqueue_command(
            generation_id,
            "client_tool_result",
            Some(tool_call_id),
            Some(payload),
        )
        .await
    }

    async fn enqueue_command(
        &self,
        generation_id: Uuid,
        command_type: &str,
        tool_call_id: Option<&str>,
        payload: Option<JsonValue>,
    ) -> Result<(), String> {
        let db = self
            .db
            .as_ref()
            .ok_or_else(|| "database unavailable".to_string())?;
        let statement = named_statement_from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            POSTGRES_QUERY_GENERATION_SHARED_COMMAND,
            "INSERT INTO temp_chat_generation_commands (generation_id, command_type, tool_call_id, payload) VALUES ($1, $2, $3, $4)",
            [
                generation_id.into(),
                command_type.into(),
                tool_call_id.map(|value| value.to_string()).into(),
                payload.into(),
            ],
        );
        db.execute_raw(statement)
            .await
            .map_err(|err| err.to_string())?;
        Ok(())
    }

    /// Periodically heartbeat all in-flight generations and reap rows whose
    /// heartbeat went stale (e.g. after a process died mid-generation).
    async fn run_maintenance_task(
        db: DatabaseConnection,
        tasks: Arc<RwLock<HashMap<Uuid, Arc<StreamingTask>>>>,
        config: GenerationStatusConfig,
        delegation_run_timeout_secs: Option<u64>,
    ) {
        let mut interval =
            tokio::time::interval(Duration::from_secs(config.heartbeat_interval_secs.max(1)));

        loop {
            // The first tick completes immediately, so rows left 'running' by a
            // previous process are reaped right at startup.
            interval.tick().await;

            let (chat_ids, generation_ids): (Vec<Uuid>, Vec<Uuid>) = {
                let tasks = tasks.read().await;
                tasks
                    .iter()
                    .map(|(chat_id, task)| (*chat_id, task.generation_id))
                    .unzip()
            };

            if !chat_ids.is_empty() {
                // The heartbeat also re-asserts the lease: two same-chat
                // starts can race their start UPDATEs, and the map is this
                // process's source of truth.
                let statement = named_statement_from_sql_and_values(
                    sea_orm::DatabaseBackend::Postgres,
                    POSTGRES_QUERY_GENERATION_HEARTBEAT,
                    r#"
                    UPDATE chats
                    SET generation_heartbeat_at = now(),
                        active_generation_id = active.generation_id
                    FROM (
                        SELECT unnest($1::uuid[]) AS chat_id,
                               unnest($2::uuid[]) AS generation_id
                    ) active
                    WHERE chats.id = active.chat_id
                      AND chats.generation_state = 'running'
                    "#,
                    [chat_ids.into(), generation_ids.clone().into()],
                );
                if let Err(err) = db.execute_raw(statement).await {
                    tracing::warn!(error = %err, "Failed to heartbeat running generations");
                }

                let shared_statement = named_statement_from_sql_and_values(
                    sea_orm::DatabaseBackend::Postgres,
                    POSTGRES_QUERY_GENERATION_HEARTBEAT,
                    r#"
                    UPDATE temp_chat_generations
                    SET heartbeat_at = now()
                    WHERE generation_id = ANY($1::uuid[]) AND state = 'running'
                    "#,
                    [generation_ids.clone().into()],
                );
                if let Err(err) = db.execute_raw(shared_statement).await {
                    tracing::warn!(error = %err, "Failed to heartbeat shared generations");
                }
            }

            let statement = named_statement_from_sql_and_values(
                sea_orm::DatabaseBackend::Postgres,
                POSTGRES_QUERY_GENERATION_REAP,
                r#"
                UPDATE chats
                SET generation_state = 'errored', generation_ended_at = now()
                WHERE generation_state = 'running'
                  AND generation_heartbeat_at < now() - make_interval(secs => $1::double precision)
                "#,
                [(config.stale_after_secs as f64).into()],
            );
            if let Err(err) = db.execute_raw(statement).await {
                tracing::warn!(error = %err, "Failed to reap stale generations");
            }

            let shared_reap_statement = named_statement_from_sql_and_values(
                sea_orm::DatabaseBackend::Postgres,
                POSTGRES_QUERY_GENERATION_REAP,
                r#"
                UPDATE temp_chat_generations
                SET state = 'errored', ended_at = now()
                WHERE state = 'running'
                  AND heartbeat_at < now() - make_interval(secs => $1::double precision)
                "#,
                [(config.stale_after_secs as f64).into()],
            );
            if let Err(err) = db.execute_raw(shared_reap_statement).await {
                tracing::warn!(error = %err, "Failed to reap stale shared generations");
            }

            // Clear terminal rows once past the retention window, so the
            // partial index only ever covers currently relevant rows.
            let statement = named_statement_from_sql_and_values(
                sea_orm::DatabaseBackend::Postgres,
                POSTGRES_QUERY_GENERATION_CLEANUP,
                r#"
                UPDATE chats
                SET active_generation_id = NULL,
                    generation_state = NULL,
                    generation_started_at = NULL,
                    generation_heartbeat_at = NULL,
                    generation_ended_at = NULL
                WHERE generation_state IN ('completed', 'errored')
                  AND generation_ended_at < now() - make_interval(secs => $1::double precision)
                "#,
                [(config.terminal_retention_secs as f64).into()],
            );
            if let Err(err) = db.execute_raw(statement).await {
                tracing::warn!(error = %err, "Failed to clean up expired generation rows");
            }

            let shared_cleanup_statement = named_statement_from_sql_and_values(
                sea_orm::DatabaseBackend::Postgres,
                POSTGRES_QUERY_GENERATION_SHARED_CLEANUP,
                r#"
                DELETE FROM temp_chat_generations
                WHERE state IN ('completed', 'errored')
                  AND ended_at < now() - make_interval(secs => $1::double precision)
                "#,
                [(config.terminal_retention_secs as f64).into()],
            );
            if let Err(err) = db.execute_raw(shared_cleanup_statement).await {
                tracing::warn!(error = %err, "Failed to clean up shared generation rows");
            }

            if let Some(run_timeout_secs) = delegation_run_timeout_secs {
                // Two heartbeat intervals of grace keep the in-task timer
                // winning normally; the backstop only fires when it
                // demonstrably did not.
                let overdue_after_secs =
                    (run_timeout_secs + 2 * config.heartbeat_interval_secs) as f64;
                match Self::enqueue_overdue_delegated_run_aborts(&db, overdue_after_secs).await {
                    Ok(0) => {}
                    Ok(enqueued) => {
                        tracing::warn!(enqueued, "Aborted delegated runs past their deadline")
                    }
                    Err(err) => {
                        tracing::warn!(error = %err, "Failed to abort overdue delegated runs")
                    }
                }
            }
        }
    }

    /// Enqueue an abort for every delegated run whose generation is still live
    /// past its deadline — the backstop for a replica that is wedged rather
    /// than dead (a dead one stops heartbeating and is reaped above). The abort
    /// command is cooperative and idempotent, so runs owned by this process are
    /// not filtered out, and a pending unconsumed abort is simply not stacked
    /// onto. Returns the number of aborts enqueued.
    pub async fn enqueue_overdue_delegated_run_aborts(
        db: &DatabaseConnection,
        overdue_after_secs: f64,
    ) -> Result<u64, String> {
        let statement = named_statement_from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            POSTGRES_QUERY_DELEGATION_TIMEOUT_BACKSTOP,
            r#"
            -- An adopted run is no longer the dispatch's artifact: the
            -- owner's own turns in it get no deadline, same as any
            -- interactive chat.
            INSERT INTO temp_chat_generation_commands (generation_id, command_type)
            SELECT g.generation_id, 'abort'
            FROM temp_chat_generations g
            JOIN chats c ON c.id = g.chat_id
            WHERE g.state = 'running'
              AND (c.assistant_configuration #>> '{provenance,kind}') = 'delegation'
              AND (c.assistant_configuration #>> '{provenance,adopted_at}') IS NULL
              AND g.started_at < now() - make_interval(secs => $1::double precision)
              AND NOT EXISTS (
                  SELECT 1
                  FROM temp_chat_generation_commands pending
                  WHERE pending.generation_id = g.generation_id
                    AND pending.command_type = 'abort'
                    AND pending.consumed_at IS NULL
              )
            "#,
            [overdue_after_secs.into()],
        );
        let result = db
            .execute_raw(statement)
            .await
            .map_err(|err| err.to_string())?;
        Ok(result.rows_affected())
    }
}

impl Default for BackgroundTaskManager {
    fn default() -> Self {
        Self::new(None, GenerationStatusConfig::default(), None)
    }
}

/// Removes a generation's task with an `Errored` outcome if its wrapper is
/// dropped without reaching the normal cleanup (i.e. it panicked), so the
/// maintenance loop cannot heartbeat the orphaned row forever.
pub struct TaskCleanupGuard {
    manager: BackgroundTaskManager,
    chat_id: Uuid,
    generation_id: Uuid,
    armed: bool,
}

impl TaskCleanupGuard {
    pub fn new(manager: BackgroundTaskManager, chat_id: Uuid, generation_id: Uuid) -> Self {
        Self {
            manager,
            chat_id,
            generation_id,
            armed: true,
        }
    }

    /// Call once the wrapper has handed cleanup to `remove_task` itself.
    pub fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for TaskCleanupGuard {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        tracing::error!(
            chat_id = %self.chat_id,
            generation_id = %self.generation_id,
            "Generation wrapper dropped without cleanup (panic?); removing task as errored"
        );
        let manager = self.manager.clone();
        let chat_id = self.chat_id;
        let generation_id = self.generation_id;
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                manager
                    .remove_task(&chat_id, generation_id, TaskOutcome::Errored)
                    .await;
            });
        }
    }
}

/// A streaming task that manages event broadcasting and history
pub struct StreamingTask {
    /// Identity of this generation attempt, distinguishing it from other
    /// generations of the same chat in the map and the chats-row lease.
    pub generation_id: Uuid,
    chat_id: Uuid,
    db: Option<DatabaseConnection>,
    /// The id of the assistant message being generated. Set to a placeholder at
    /// construction (the real id is only known once the generation task creates
    /// the message) and updated via `set_message_id`. Behind a lock so it can be
    /// corrected after the task is shared. Read via `message_id()`.
    message_id: std::sync::RwLock<Uuid>,
    /// Broadcast sender for live events
    event_tx: broadcast::Sender<StreamingEvent>,
    /// Storage for all events (for replay)
    event_history: Arc<RwLock<Vec<StreamingEvent>>>,
    /// Whether any `Error` event was sent; tracked separately because
    /// `event_history` stops recording at `MAX_EVENT_HISTORY`.
    saw_error: Arc<AtomicBool>,
    /// Whether the generation finalized with a pending tool approval as its
    /// last content part; set by the completion paths, consumed by
    /// `derive_outcome`.
    awaiting_approval: Arc<AtomicBool>,
    /// Whether the generation is complete
    completed: Arc<AtomicBool>,
    /// Whether cancellation was requested by the user
    abort_requested: Arc<AtomicBool>,
    /// Notifies waiters when an abort is requested
    abort_notify: Arc<Notify>,
    /// Senders for in-flight client-executed tool calls, keyed by tool_call_id.
    /// The agentic loop registers an entry and awaits its receiver while the
    /// client executes the tool; the result endpoint delivers into it. Lives in
    /// memory only — a backend restart drops parked turns (returning client
    /// tools must be read/idempotent).
    pending_client_tools: Arc<RwLock<HashMap<String, oneshot::Sender<ClientToolOutcome>>>>,
}

impl std::fmt::Debug for StreamingTask {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StreamingTask")
            .field("message_id", &self.message_id())
            .field("subscriber_count", &self.event_tx.receiver_count())
            .field("completed", &self.completed.load(Ordering::SeqCst))
            .field(
                "abort_requested",
                &self.abort_requested.load(Ordering::SeqCst),
            )
            .finish()
    }
}

impl StreamingTask {
    /// Create a new streaming task
    fn new(message_id: Uuid, generation_id: Uuid) -> Self {
        // Create a broadcast channel with capacity for 1000 events
        let (event_tx, _) = broadcast::channel(1000);

        Self {
            generation_id,
            chat_id: Uuid::nil(),
            db: None,
            message_id: std::sync::RwLock::new(message_id),
            event_tx,
            event_history: Arc::new(RwLock::new(Vec::new())),
            saw_error: Arc::new(AtomicBool::new(false)),
            awaiting_approval: Arc::new(AtomicBool::new(false)),
            completed: Arc::new(AtomicBool::new(false)),
            abort_requested: Arc::new(AtomicBool::new(false)),
            abort_notify: Arc::new(Notify::new()),
            pending_client_tools: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    fn with_shared_state(mut self, db: Option<DatabaseConnection>, chat_id: Uuid) -> Self {
        self.db = db;
        self.chat_id = chat_id;
        self
    }

    /// The id of the assistant message this task is generating.
    pub fn message_id(&self) -> Uuid {
        *self.message_id.read().expect("message_id lock poisoned")
    }

    /// Record the real assistant message id once the generation task has created
    /// it. Client-tool results are routed to a task by this id, so it must match
    /// the id the client received in the `client_tool_call` event.
    pub fn set_message_id(&self, message_id: Uuid) {
        *self.message_id.write().expect("message_id lock poisoned") = message_id;
    }

    /// Subscribe to live events from this task
    pub fn subscribe(&self) -> broadcast::Receiver<StreamingEvent> {
        self.event_tx.subscribe()
    }

    /// Send an event to all subscribers and store it in history
    pub async fn send_event(&self, event: StreamingEvent) -> Result<(), String> {
        tracing::debug!("sending event to StreamingTask");
        if matches!(event, StreamingEvent::Error { .. }) {
            self.saw_error.store(true, Ordering::SeqCst);
        }
        // First, add to history
        let mut history = self.event_history.write().await;

        // Check if we've exceeded the maximum event history
        if history.len() >= MAX_EVENT_HISTORY {
            tracing::warn!(
                "Event history for message {} has reached maximum size of {}",
                self.message_id(),
                MAX_EVENT_HISTORY
            );
            // Don't add more events to history, but still broadcast
        } else {
            history.push(event.clone());
        }
        drop(history); // Release lock before broadcasting

        // Then broadcast to live subscribers
        // If there are no subscribers, this will just drop the event
        let _ = self.event_tx.send(event.clone());

        self.persist_shared_event(&event).await;

        Ok(())
    }

    async fn persist_shared_event(&self, event: &StreamingEvent) {
        let Some(db) = &self.db else {
            return;
        };
        let payload = match serde_json::to_value(event) {
            Ok(payload) => payload,
            Err(err) => {
                tracing::warn!(generation_id = %self.generation_id, error = %err, "Failed to serialize shared generation event");
                return;
            }
        };
        let event_statement = named_statement_from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            crate::metrics_constants::POSTGRES_QUERY_GENERATION_SHARED_EVENT,
            "INSERT INTO temp_chat_generation_events (generation_id, event) VALUES ($1, $2)",
            [self.generation_id.into(), payload.into()],
        );
        if let Err(err) = db.execute_raw(event_statement).await {
            tracing::warn!(generation_id = %self.generation_id, error = %err, "Failed to persist shared generation event");
        }

        if let StreamingEvent::AssistantMessageStarted { message_id } = event {
            let message_statement = named_statement_from_sql_and_values(
                sea_orm::DatabaseBackend::Postgres,
                crate::metrics_constants::POSTGRES_QUERY_GENERATION_SHARED_EVENT,
                "UPDATE temp_chat_generations SET message_id = $1 WHERE generation_id = $2",
                [(*message_id).into(), self.generation_id.into()],
            );
            if let Err(err) = db.execute_raw(message_statement).await {
                tracing::warn!(chat_id = %self.chat_id, error = %err, "Failed to persist shared generation message id");
            }
        }
    }

    /// Get a copy of all events sent so far
    pub async fn get_event_history(&self) -> Vec<StreamingEvent> {
        let history = self.event_history.read().await;
        history.clone()
    }

    /// Record that the generation finalized on a pending tool approval, so
    /// its outcome parks the chat instead of completing it.
    pub fn mark_awaiting_approval(&self) {
        self.awaiting_approval.store(true, Ordering::SeqCst);
    }

    /// Derive the terminal outcome of this task. An abort is a user-initiated
    /// stop and deliberately counts as `Completed`; an error outranks a
    /// pending approval.
    pub fn derive_outcome(&self, generation_failed: bool) -> TaskOutcome {
        if generation_failed || self.saw_error.load(Ordering::SeqCst) {
            TaskOutcome::Errored
        } else if self.awaiting_approval.load(Ordering::SeqCst) {
            TaskOutcome::AwaitingApproval
        } else {
            TaskOutcome::Completed
        }
    }

    /// Mark the task as completed
    pub fn mark_completed(&self) {
        self.completed.store(true, Ordering::SeqCst);
    }

    /// Check if the task is completed
    pub fn is_completed(&self) -> bool {
        self.completed.load(Ordering::SeqCst)
    }

    /// Request cancellation of the active generation.
    pub fn request_abort(&self) {
        self.abort_requested.store(true, Ordering::SeqCst);
        self.abort_notify.notify_waiters();
    }

    /// Check whether cancellation was requested.
    pub fn is_abort_requested(&self) -> bool {
        self.abort_requested.load(Ordering::SeqCst)
    }

    /// Wait until cancellation has been requested.
    pub async fn wait_for_abort(&self) {
        // Register as a waiter BEFORE re-checking the flag. `request_abort` uses
        // `notify_waiters()`, which stores no permit, so an abort requested in
        // the gap between the check and the await would otherwise be lost.
        // `Notified::enable()` registers interest immediately, closing that
        // window — load-bearing for a long client-tool park, which (unlike the
        // streaming loop) does not re-poll `wait_for_abort` frequently.
        let notified = self.abort_notify.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        if self.is_abort_requested() {
            return;
        }
        notified.await;
    }

    /// Register interest in a client-executed tool's result, returning a
    /// receiver the agentic loop awaits while the client runs the tool. The
    /// matching sender is stored in `pending_client_tools` keyed by
    /// `tool_call_id` and consumed once by `deliver_client_tool_result`.
    pub async fn register_client_tool_call(
        &self,
        tool_call_id: String,
    ) -> oneshot::Receiver<ClientToolOutcome> {
        let (tx, rx) = oneshot::channel();
        self.pending_client_tools
            .write()
            .await
            .insert(tool_call_id, tx);
        rx
    }

    /// Deliver a client tool's result to the waiting loop. The pending entry is
    /// removed first (deliver-once), so duplicate or late POSTs are benign
    /// no-ops. The guard is dropped BEFORE the (synchronous) send so the result
    /// endpoint never holds the lock across delivery.
    pub async fn deliver_client_tool_result(
        &self,
        tool_call_id: &str,
        outcome: ClientToolOutcome,
    ) -> ClientToolDelivery {
        let sender = self.pending_client_tools.write().await.remove(tool_call_id);
        match sender {
            // Receiver dropped => the loop already gave up (timeout/abort); the
            // late result is harmless to discard.
            Some(sender) => match sender.send(outcome) {
                Ok(()) => ClientToolDelivery::Delivered,
                Err(_) => ClientToolDelivery::Unknown,
            },
            None => ClientToolDelivery::Unknown,
        }
    }

    /// Drop any pending entry for a client tool call (on timeout/abort) so a
    /// late client result cannot be delivered to a finished or replaced turn.
    pub async fn remove_pending_client_tool(&self, tool_call_id: &str) {
        self.pending_client_tools.write().await.remove(tool_call_id);
    }

    /// Get the number of active subscribers
    pub fn subscriber_count(&self) -> usize {
        self.event_tx.receiver_count()
    }
}

/// Events that can be streamed during message generation
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "message_type", rename_all = "snake_case")]
pub enum StreamingEvent {
    /// A new chat was created
    #[serde(rename = "chat_created")]
    ChatCreated { chat_id: Uuid },
    /// User message was saved
    #[serde(rename = "user_message_saved")]
    UserMessageSaved {
        message_id: Uuid,
        message: ChatMessage,
    },
    /// Assistant message generation started
    #[serde(rename = "assistant_message_started")]
    AssistantMessageStarted { message_id: Uuid },
    /// A text delta was generated
    #[serde(rename = "text_delta")]
    TextDelta {
        message_id: Uuid,
        content_index: usize,
        new_text: String,
    },
    /// A reasoning delta was generated
    #[serde(rename = "reasoning_delta")]
    ReasoningDelta {
        message_id: Uuid,
        content_index: usize,
        new_text: String,
    },
    /// A tool call was proposed by the LLM
    #[serde(rename = "tool_call_proposed")]
    ToolCallProposed {
        message_id: Uuid,
        content_index: usize,
        tool_call_id: String,
        tool_name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        input: Option<JsonValue>,
    },
    /// A tool call status update
    #[serde(rename = "tool_call_update")]
    ToolCallUpdate {
        message_id: Uuid,
        content_index: usize,
        tool_call_id: String,
        tool_name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        input: Option<JsonValue>,
        status: ToolCallStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        progress_message: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        output: Option<JsonValue>,
    },
    /// The model called a facet `client_tool`: the loop is now SUSPENDED
    /// awaiting the client to execute it and POST the result back. Distinct
    /// from `tool_call_proposed` (which fires for every proposed tool call):
    /// this signals the client to execute and that the turn is parked.
    #[serde(rename = "client_tool_call")]
    ClientToolCall {
        message_id: Uuid,
        content_index: usize,
        tool_call_id: String,
        tool_name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        input: Option<JsonValue>,
    },
    /// Assistant message was completed
    #[serde(rename = "assistant_message_completed")]
    AssistantMessageCompleted {
        message_id: Uuid,
        content: Vec<ContentPart>,
        message: ChatMessage,
    },
    /// An error occurred during message generation
    #[serde(rename = "error")]
    Error {
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<JsonValue>,
    },
    /// Stream has ended
    #[serde(rename = "stream_end")]
    StreamEnd,
}

/// Status of a tool call
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ToolCallStatus {
    InProgress,
    Success,
    Error,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_task_creation_and_subscription() {
        let manager = BackgroundTaskManager::new(None, GenerationStatusConfig::default(), None);
        let chat_id = Uuid::new_v4();
        let message_id = Uuid::new_v4();

        let (_receiver, task) = manager.start_task(chat_id, message_id).await;

        assert_eq!(task.message_id(), message_id);
        assert!(!task.is_completed());
        assert_eq!(task.subscriber_count(), 1); // One receiver created
        assert!(!task.is_abort_requested());
    }

    #[tokio::test]
    async fn test_event_storage_and_replay() {
        let manager = BackgroundTaskManager::new(None, GenerationStatusConfig::default(), None);
        let chat_id = Uuid::new_v4();
        let message_id = Uuid::new_v4();

        let (_receiver, task) = manager.start_task(chat_id, message_id).await;

        // Send some events
        task.send_event(StreamingEvent::AssistantMessageStarted { message_id })
            .await
            .unwrap();
        task.send_event(StreamingEvent::TextDelta {
            message_id,
            content_index: 0,
            new_text: "Hello".to_string(),
        })
        .await
        .unwrap();

        // Check history
        let history = task.get_event_history().await;
        assert_eq!(history.len(), 2);
    }

    #[tokio::test]
    async fn test_task_completion() {
        let manager = BackgroundTaskManager::new(None, GenerationStatusConfig::default(), None);
        let chat_id = Uuid::new_v4();
        let message_id = Uuid::new_v4();

        let (_receiver, task) = manager.start_task(chat_id, message_id).await;

        assert!(!task.is_completed());
        task.mark_completed();
        assert!(task.is_completed());
    }

    #[tokio::test]
    async fn test_task_replacement() {
        let manager = BackgroundTaskManager::new(None, GenerationStatusConfig::default(), None);
        let chat_id = Uuid::new_v4();
        let message_id_1 = Uuid::new_v4();
        let message_id_2 = Uuid::new_v4();

        let (_receiver1, task1) = manager.start_task(chat_id, message_id_1).await;
        let (_receiver2, task2) = manager.start_task(chat_id, message_id_2).await;

        // Task 2 should have replaced task 1
        assert_ne!(task1.message_id(), task2.message_id());

        // Getting the task should return task 2
        let retrieved = manager.get_task(&chat_id).await.unwrap();
        assert_eq!(retrieved.message_id(), message_id_2);
    }

    #[tokio::test]
    async fn test_automatic_cleanup() {
        let manager = BackgroundTaskManager::new(None, GenerationStatusConfig::default(), None);
        let chat_id = Uuid::new_v4();
        let message_id = Uuid::new_v4();

        let generation_id = {
            let (_receiver, task) = manager.start_task(chat_id, message_id).await;
            // Task exists here
            assert!(manager.get_task(&chat_id).await.is_some());
            task.generation_id
        };

        // After dropping receiver and task, the Arc should still be in the manager
        assert!(manager.get_task(&chat_id).await.is_some());

        // Remove the task manually
        manager
            .remove_task(&chat_id, generation_id, TaskOutcome::Completed)
            .await;
        assert!(manager.get_task(&chat_id).await.is_none());
    }

    #[tokio::test]
    async fn remove_task_is_gated_on_generation_identity() {
        let manager = BackgroundTaskManager::new(None, GenerationStatusConfig::default(), None);
        let chat_id = Uuid::new_v4();

        let (_receiver1, task1) = manager.start_task(chat_id, Uuid::new_v4()).await;
        let (_receiver2, task2) = manager.start_task(chat_id, Uuid::new_v4()).await;

        // A stale wrapper removing with the replaced generation's id must not
        // evict the replacement task.
        manager
            .remove_task(&chat_id, task1.generation_id, TaskOutcome::Errored)
            .await;
        let retrieved = manager
            .get_task(&chat_id)
            .await
            .expect("replacement task should survive a stale removal");
        assert_eq!(retrieved.generation_id, task2.generation_id);

        // Removing with the current generation's id evicts it.
        manager
            .remove_task(&chat_id, task2.generation_id, TaskOutcome::Completed)
            .await;
        assert!(manager.get_task(&chat_id).await.is_none());
    }

    #[tokio::test]
    async fn derive_outcome_maps_wrapper_error_to_errored() {
        let task = StreamingTask::new(Uuid::new_v4(), Uuid::new_v4());
        assert_eq!(task.derive_outcome(true), TaskOutcome::Errored);
    }

    #[tokio::test]
    async fn derive_outcome_maps_error_event_to_errored() {
        let task = StreamingTask::new(Uuid::new_v4(), Uuid::new_v4());
        task.send_event(StreamingEvent::Error { error: None })
            .await
            .unwrap();
        assert_eq!(task.derive_outcome(false), TaskOutcome::Errored);
    }

    #[tokio::test]
    async fn derive_outcome_maps_clean_finish_to_completed() {
        let task = StreamingTask::new(Uuid::new_v4(), Uuid::new_v4());
        task.send_event(StreamingEvent::TextDelta {
            message_id: Uuid::new_v4(),
            content_index: 0,
            new_text: "Hello".to_string(),
        })
        .await
        .unwrap();
        assert_eq!(task.derive_outcome(false), TaskOutcome::Completed);
    }

    #[tokio::test]
    async fn derive_outcome_maps_abort_to_completed() {
        let task = StreamingTask::new(Uuid::new_v4(), Uuid::new_v4());
        task.request_abort();
        assert_eq!(task.derive_outcome(false), TaskOutcome::Completed);
    }

    #[tokio::test]
    async fn test_task_abort_request() {
        let manager = BackgroundTaskManager::new(None, GenerationStatusConfig::default(), None);
        let chat_id = Uuid::new_v4();
        let message_id = Uuid::new_v4();

        let (_receiver, task) = manager.start_task(chat_id, message_id).await;
        assert!(!task.is_abort_requested());

        task.request_abort();

        assert!(task.is_abort_requested());
    }

    #[tokio::test]
    async fn set_message_id_updates_the_routing_id() {
        let task = StreamingTask::new(Uuid::new_v4(), Uuid::new_v4());
        let real_id = Uuid::new_v4();
        task.set_message_id(real_id);
        assert_eq!(task.message_id(), real_id);
    }

    #[tokio::test]
    async fn client_tool_result_delivery_round_trip() {
        let task = StreamingTask::new(Uuid::new_v4(), Uuid::new_v4());
        let mut rx = task.register_client_tool_call("call-1".to_string()).await;

        let delivery = task
            .deliver_client_tool_result(
                "call-1",
                ClientToolOutcome::Result(serde_json::json!({ "ok": true })),
            )
            .await;
        assert_eq!(delivery, ClientToolDelivery::Delivered);
        match rx.try_recv() {
            Ok(ClientToolOutcome::Result(value)) => {
                assert_eq!(value, serde_json::json!({ "ok": true }))
            }
            other => panic!("expected the delivered result, got {other:?}"),
        }

        // Deliver-once: a second delivery for the same id is a benign no-op.
        let again = task
            .deliver_client_tool_result("call-1", ClientToolOutcome::Error("late".to_string()))
            .await;
        assert_eq!(again, ClientToolDelivery::Unknown);
    }

    #[tokio::test]
    async fn deliver_unknown_tool_call_id_is_noop() {
        let task = StreamingTask::new(Uuid::new_v4(), Uuid::new_v4());
        let delivery = task
            .deliver_client_tool_result(
                "never-registered",
                ClientToolOutcome::Error("x".to_string()),
            )
            .await;
        assert_eq!(delivery, ClientToolDelivery::Unknown);
    }

    #[tokio::test]
    async fn remove_pending_client_tool_drops_the_waiter() {
        let task = StreamingTask::new(Uuid::new_v4(), Uuid::new_v4());
        let mut rx = task.register_client_tool_call("call-1".to_string()).await;
        task.remove_pending_client_tool("call-1").await;
        // The sender was dropped, so the receiver observes a closed channel and a
        // later delivery finds nothing to deliver to.
        assert!(rx.try_recv().is_err());
        let delivery = task
            .deliver_client_tool_result("call-1", ClientToolOutcome::Error("x".to_string()))
            .await;
        assert_eq!(delivery, ClientToolDelivery::Unknown);
    }
}
