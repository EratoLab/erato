//! Background task manager for long-running streaming operations.
//!
//! This module provides infrastructure for managing long-running message generation
//! tasks that can continue in the background even if the client disconnects.
//! Clients can resume streaming from any point by reconnecting.

use crate::config::GenerationStatusConfig;
use crate::metrics_constants::{
    POSTGRES_QUERY_GENERATION_FINISH, POSTGRES_QUERY_GENERATION_HEARTBEAT,
    POSTGRES_QUERY_GENERATION_REAP, POSTGRES_QUERY_GENERATION_START,
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

/// Terminal outcome of a generation, persisted as the chat's generation state.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TaskOutcome {
    Completed,
    Errored,
}

impl TaskOutcome {
    fn as_db_str(self) -> &'static str {
        match self {
            TaskOutcome::Completed => "completed",
            TaskOutcome::Errored => "errored",
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
    /// Create a new background task manager
    pub fn new(db: Option<DatabaseConnection>, config: GenerationStatusConfig) -> Self {
        let tasks: Arc<RwLock<HashMap<Uuid, Arc<StreamingTask>>>> =
            Arc::new(RwLock::new(HashMap::new()));

        let maintenance_task = db.clone().map(|db| {
            let tasks = Arc::clone(&tasks);
            Arc::new(tokio::spawn(async move {
                Self::run_maintenance_task(db, tasks, config).await;
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
        let task = Arc::new(StreamingTask::new(message_id, Uuid::new_v4()));
        let receiver = task.subscribe();

        // Insert into the map, replacing any existing task
        {
            let mut tasks = self.tasks.write().await;
            tasks.insert(chat_id, Arc::clone(&task));
        }

        // Claim the chats-row lease for this generation. Best-effort: a failed
        // status write must never fail a healthy generation.
        if let Some(db) = &self.db {
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
    /// outcome.
    ///
    /// Both the in-map removal and the DB write are gated on `generation_id`:
    /// `start_task` replaces the map entry when a chat starts a new
    /// generation, so a stale wrapper finishing late must not remove (or mark
    /// terminal) the replacement generation.
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

    /// Periodically heartbeat all in-flight generations and reap rows whose
    /// heartbeat went stale (e.g. after a process died mid-generation).
    async fn run_maintenance_task(
        db: DatabaseConnection,
        tasks: Arc<RwLock<HashMap<Uuid, Arc<StreamingTask>>>>,
        config: GenerationStatusConfig,
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
                // The map is this process's source of truth, so the heartbeat
                // also re-asserts the lease: two same-chat starts can race
                // their start UPDATEs so the row's lease points at the losing
                // generation, and without re-assertion the winner would never
                // heartbeat and get reaped mid-run.
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
                    [chat_ids.into(), generation_ids.into()],
                );
                if let Err(err) = db.execute_raw(statement).await {
                    tracing::warn!(error = %err, "Failed to heartbeat running generations");
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
        }
    }
}

impl Default for BackgroundTaskManager {
    fn default() -> Self {
        Self::new(None, GenerationStatusConfig::default())
    }
}

/// Removes a generation's task with an `Errored` outcome if its wrapper is
/// dropped without reaching the normal cleanup, i.e. it panicked. Without
/// this, a panicked wrapper leaves its map entry behind and the maintenance
/// loop heartbeats the orphaned row as 'running' forever.
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
    /// Identity of this generation attempt. Distinguishes this task from an
    /// earlier/later task for the same chat, both in the manager's map and in
    /// the persisted chats-row lease.
    pub generation_id: Uuid,
    /// The id of the assistant message being generated. Set to a placeholder at
    /// construction (the real id is only known once the generation task creates
    /// the message) and updated via `set_message_id`. Behind a lock so it can be
    /// corrected after the task is shared. Read via `message_id()`.
    message_id: std::sync::RwLock<Uuid>,
    /// Broadcast sender for live events
    event_tx: broadcast::Sender<StreamingEvent>,
    /// Storage for all events (for replay)
    event_history: Arc<RwLock<Vec<StreamingEvent>>>,
    /// Whether any `Error` event was sent. Tracked separately from
    /// `event_history`, which stops recording at `MAX_EVENT_HISTORY` while
    /// events keep broadcasting — a trailing error must still count.
    saw_error: Arc<AtomicBool>,
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
            message_id: std::sync::RwLock::new(message_id),
            event_tx,
            event_history: Arc::new(RwLock::new(Vec::new())),
            saw_error: Arc::new(AtomicBool::new(false)),
            completed: Arc::new(AtomicBool::new(false)),
            abort_requested: Arc::new(AtomicBool::new(false)),
            abort_notify: Arc::new(Notify::new()),
            pending_client_tools: Arc::new(RwLock::new(HashMap::new())),
        }
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
        let _ = self.event_tx.send(event);

        Ok(())
    }

    /// Get a copy of all events sent so far
    pub async fn get_event_history(&self) -> Vec<StreamingEvent> {
        let history = self.event_history.read().await;
        history.clone()
    }

    /// Derive the terminal outcome of this task from the wrapper result
    /// (`generation_failed`) and whether any `Error` event was sent. An abort
    /// is a user-initiated stop and deliberately counts as `Completed`.
    pub async fn derive_outcome(&self, generation_failed: bool) -> TaskOutcome {
        if generation_failed || self.saw_error.load(Ordering::SeqCst) {
            TaskOutcome::Errored
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
        let manager = BackgroundTaskManager::new(None, GenerationStatusConfig::default());
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
        let manager = BackgroundTaskManager::new(None, GenerationStatusConfig::default());
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
        let manager = BackgroundTaskManager::new(None, GenerationStatusConfig::default());
        let chat_id = Uuid::new_v4();
        let message_id = Uuid::new_v4();

        let (_receiver, task) = manager.start_task(chat_id, message_id).await;

        assert!(!task.is_completed());
        task.mark_completed();
        assert!(task.is_completed());
    }

    #[tokio::test]
    async fn test_task_replacement() {
        let manager = BackgroundTaskManager::new(None, GenerationStatusConfig::default());
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
        let manager = BackgroundTaskManager::new(None, GenerationStatusConfig::default());
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
        let manager = BackgroundTaskManager::new(None, GenerationStatusConfig::default());
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
        assert_eq!(task.derive_outcome(true).await, TaskOutcome::Errored);
    }

    #[tokio::test]
    async fn derive_outcome_maps_error_event_to_errored() {
        let task = StreamingTask::new(Uuid::new_v4(), Uuid::new_v4());
        task.send_event(StreamingEvent::Error { error: None })
            .await
            .unwrap();
        assert_eq!(task.derive_outcome(false).await, TaskOutcome::Errored);
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
        assert_eq!(task.derive_outcome(false).await, TaskOutcome::Completed);
    }

    #[tokio::test]
    async fn derive_outcome_maps_abort_to_completed() {
        let task = StreamingTask::new(Uuid::new_v4(), Uuid::new_v4());
        task.request_abort();
        assert_eq!(task.derive_outcome(false).await, TaskOutcome::Completed);
    }

    #[tokio::test]
    async fn test_task_abort_request() {
        let manager = BackgroundTaskManager::new(None, GenerationStatusConfig::default());
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
