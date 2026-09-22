//! Durable local delegation. The authenticated frontend is the only uploader.
//! Checkpoints and continuation leases never carry backend access/refresh tokens.
pub mod contract;
pub mod signing;
pub mod store;
pub mod tool;
pub mod uploads;

use crate::models::message::{ContentPart, GenerationMetadata};
use serde::{Deserialize, Serialize};

/// Counters travel with the checkpoint, including completed sibling tool calls.
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Consumption {
    pub model_turns: u32,
    pub tool_calls: u32,
    pub server_tool_calls: u32,
    pub client_tool_calls: u32,
    pub submission_attempts: std::collections::BTreeMap<String, u32>,
    pub client_action_already_proposed: bool,
}
impl Consumption {
    pub fn preserves(&self, previous: &Self) -> bool {
        self.model_turns >= previous.model_turns
            && self.tool_calls >= previous.tool_calls
            && self.server_tool_calls >= previous.server_tool_calls
            && self.client_tool_calls >= previous.client_tool_calls
            && (!previous.client_action_already_proposed || self.client_action_already_proposed)
            && previous.submission_attempts.iter().all(|(name, count)| {
                self.submission_attempts
                    .get(name)
                    .is_some_and(|next| next >= count)
            })
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Checkpoint {
    pub version: u32,
    pub selected_facets: Vec<String>,
    pub max_tool_calls: u32,
    pub max_model_turns: u32,
    pub result_applied: bool,
    pub model_finished: bool,
    pub request: genai::chat::ChatRequest,
    pub content: Vec<ContentPart>,
    pub pending_calls: Vec<genai::chat::ToolCall>,
    pub consumption: Consumption,
    pub generation_metadata: Option<GenerationMetadata>,
    pub allowed_tools: Vec<String>,
    pub model_id: String,
    pub origin_user_message_id: Option<sea_orm::prelude::Uuid>,
    pub task_server_budget: Option<u32>,
    pub task_client_budget: Option<u32>,
}
