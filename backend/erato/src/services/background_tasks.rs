//! Background task manager for long-running streaming operations.
//!
//! This module provides infrastructure for managing long-running message generation
//! tasks that can continue in the background even if the client disconnects.
//! Clients can resume streaming from any point by reconnecting.

use crate::models::message::ContentPart;
use crate::server::api::v1beta::ChatMessage;
use sea_orm::JsonValue;
use serde::{Deserialize, Serialize};
use sqlx::types::Uuid;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::{RwLock, broadcast};

/// Maximum number of events to store in history per task
const MAX_EVENT_HISTORY: usize = 10_000;

/// Manager for background streaming tasks
#[derive(Clone, Debug)]
pub struct BackgroundTaskManager {
    /// Map of chat_id to streaming task
    /// Public for testing purposes
    pub tasks: Arc<RwLock<HashMap<Uuid, Arc<StreamingTask>>>>,
}

impl BackgroundTaskManager {
    /// Create a new background task manager
    pub fn new() -> Self {
        Self {
            tasks: Arc::new(RwLock::new(HashMap::new())),
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
        let task = Arc::new(StreamingTask::new(message_id));
        let receiver = task.subscribe();

        // Insert into the map, replacing any existing task
        let mut tasks = self.tasks.write().await;
        tasks.insert(chat_id, Arc::clone(&task));

        (receiver, task)
    }

    /// Get an existing task for the given chat
    ///
    /// Returns None if no task exists for this chat.
    pub async fn get_task(&self, chat_id: &Uuid) -> Option<Arc<StreamingTask>> {
        let tasks = self.tasks.read().await;
        tasks.get(chat_id).map(Arc::clone)
    }

    /// Remove a completed task from the manager
    ///
    /// This should be called when a task completes to allow cleanup.
    pub async fn remove_task(&self, chat_id: &Uuid) {
        let mut tasks = self.tasks.write().await;
        tasks.remove(chat_id);
    }
}

impl Default for BackgroundTaskManager {
    fn default() -> Self {
        Self::new()
    }
}

/// A streaming task that manages event broadcasting and history
pub struct StreamingTask {
    /// The message ID being generated
    pub message_id: Uuid,
    /// Broadcast sender for live events
    event_tx: broadcast::Sender<StreamingEvent>,
    /// Storage for all events (for replay)
    event_history: Arc<RwLock<Vec<StreamingEvent>>>,
    /// Whether the generation is complete
    completed: Arc<AtomicBool>,
}

impl std::fmt::Debug for StreamingTask {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StreamingTask")
            .field("message_id", &self.message_id)
            .field("subscriber_count", &self.event_tx.receiver_count())
            .field("completed", &self.completed.load(Ordering::SeqCst))
            .finish()
    }
}

impl StreamingTask {
    /// Create a new streaming task
    fn new(message_id: Uuid) -> Self {
        // Create a broadcast channel with capacity for 1000 events
        let (event_tx, _) = broadcast::channel(1000);

        Self {
            message_id,
            event_tx,
            event_history: Arc::new(RwLock::new(Vec::new())),
            completed: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Subscribe to live events from this task
    pub fn subscribe(&self) -> broadcast::Receiver<StreamingEvent> {
        self.event_tx.subscribe()
    }

    /// Send an event to all subscribers and store it in history
    pub async fn send_event(&self, event: StreamingEvent) -> Result<(), String> {
        tracing::debug!("sending event to StreamingTask");
        // First, add to history
        let mut history = self.event_history.write().await;

        // Check if we've exceeded the maximum event history
        if history.len() >= MAX_EVENT_HISTORY {
            tracing::warn!(
                "Event history for message {} has reached maximum size of {}",
                self.message_id,
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

    /// Mark the task as completed
    pub fn mark_completed(&self) {
        self.completed.store(true, Ordering::SeqCst);
    }

    /// Check if the task is completed
    pub fn is_completed(&self) -> bool {
        self.completed.load(Ordering::SeqCst)
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
    /// Assistant message was completed
    #[serde(rename = "assistant_message_completed")]
    AssistantMessageCompleted {
        message_id: Uuid,
        content: Vec<ContentPart>,
        message: ChatMessage,
    },
    /// An error occurred during generation
    #[serde(rename = "generation_error")]
    GenerationError {
        message_id: Uuid,
        error_type: String,
        error_message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        retry_after: Option<u64>, // For rate limit errors, seconds to wait
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
        let manager = BackgroundTaskManager::new();
        let chat_id = Uuid::new_v4();
        let message_id = Uuid::new_v4();

        let (_receiver, task) = manager.start_task(chat_id, message_id).await;

        assert_eq!(task.message_id, message_id);
        assert!(!task.is_completed());
        assert_eq!(task.subscriber_count(), 1); // One receiver created
    }

    #[tokio::test]
    async fn test_event_storage_and_replay() {
        let manager = BackgroundTaskManager::new();
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
        let manager = BackgroundTaskManager::new();
        let chat_id = Uuid::new_v4();
        let message_id = Uuid::new_v4();

        let (_receiver, task) = manager.start_task(chat_id, message_id).await;

        assert!(!task.is_completed());
        task.mark_completed();
        assert!(task.is_completed());
    }

    #[tokio::test]
    async fn test_task_replacement() {
        let manager = BackgroundTaskManager::new();
        let chat_id = Uuid::new_v4();
        let message_id_1 = Uuid::new_v4();
        let message_id_2 = Uuid::new_v4();

        let (_receiver1, task1) = manager.start_task(chat_id, message_id_1).await;
        let (_receiver2, task2) = manager.start_task(chat_id, message_id_2).await;

        // Task 2 should have replaced task 1
        assert_ne!(task1.message_id, task2.message_id);

        // Getting the task should return task 2
        let retrieved = manager.get_task(&chat_id).await.unwrap();
        assert_eq!(retrieved.message_id, message_id_2);
    }

    #[tokio::test]
    async fn test_automatic_cleanup() {
        let manager = BackgroundTaskManager::new();
        let chat_id = Uuid::new_v4();
        let message_id = Uuid::new_v4();

        {
            let (_receiver, _task) = manager.start_task(chat_id, message_id).await;
            // Task exists here
            assert!(manager.get_task(&chat_id).await.is_some());
        }

        // After dropping receiver and task, the Arc should still be in the manager
        assert!(manager.get_task(&chat_id).await.is_some());

        // Remove the task manually
        manager.remove_task(&chat_id).await;
        assert!(manager.get_task(&chat_id).await.is_none());
    }
}
