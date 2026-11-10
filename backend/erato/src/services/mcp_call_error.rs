//! What became of an MCP tool call that ended without a result.

use crate::models::message::{ToolCallFailure, ToolResultDetails};
use eyre::Report;
use serde_json::{Value, json};

/// What Erato knows of an MCP tool call that ended without a result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum McpCallFailure {
    /// The server answered the call with an error, a JSON-RPC error or an
    /// HTTP status, and with its own text when it sent one.
    Returned(Option<String>),
    /// Erato never sent the call.
    NotSent,
    /// The server answered with something that is no tool result.
    Unreadable,
    /// No answer came back, or Erato cannot tell whether one did: the call
    /// may have run.
    NoAnswer,
}

/// An error that says what became of the call; it reads as `text`.
#[derive(Debug)]
pub struct McpCallError {
    pub failure: McpCallFailure,
    text: String,
}

impl McpCallError {
    pub fn report(failure: McpCallFailure, text: impl std::fmt::Display) -> Report {
        Report::new(Self {
            failure,
            text: text.to_string(),
        })
    }
}

impl std::fmt::Display for McpCallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.text)
    }
}

impl std::error::Error for McpCallError {}

/// What became of a call whose error is `error`; an error that does not say
/// leaves the call with no answer.
pub fn failure_of(error: &Report) -> McpCallFailure {
    error
        .downcast_ref::<McpCallError>()
        .map_or(McpCallFailure::NoAnswer, |error| error.failure.clone())
}

/// A failed call's row output and details. An error the server returned is
/// its own word, so it carries no failure of Erato's; otherwise the row
/// holds Erato's text and how the call failed.
pub fn failed_call_row(error: &Report) -> (Value, ToolResultDetails) {
    let failure = match failure_of(error) {
        McpCallFailure::Returned(message) => {
            return (
                json!({ "status": "error", "error": message }),
                ToolResultDetails::default(),
            );
        }
        McpCallFailure::NotSent => ToolCallFailure::NotRun,
        McpCallFailure::Unreadable => ToolCallFailure::AnswerUnreadable,
        McpCallFailure::NoAnswer => ToolCallFailure::NoAnswer,
    };
    (
        json!({ "status": "error", "error": format!("Failed to call MCP tool: {error}") }),
        ToolResultDetails::failed(failure),
    )
}
