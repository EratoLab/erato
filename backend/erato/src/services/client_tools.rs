//! Client-executed tools for action facets.
//!
//! An action facet may declare `client_tools`: tools the model can CALL whose
//! result is fed back into the SAME agentic turn — like an MCP tool, but
//! executed on the client (the Outlook add-in / web app) rather than on the
//! backend. This is distinct from `client_actions` (terminal, one-way,
//! user-confirmed mutations proposed via `propose_client_action`): a client
//! tool returns a result and the turn continues.
//!
//! Returning client tools MUST be read-only / idempotent: a backend restart
//! drops the parked turn, so a client may re-execute on recovery. Mutations
//! must use the terminal `client_actions` path.

use genai::chat::Tool as GenaiTool;
use genai::chat::ToolName as GenaiToolName;
use serde_json::Value;

/// Build a genai tool for a facet-declared client tool. `schema` is the parsed
/// JSON-Schema object for the tool's input parameters (validated as a JSON
/// object at config load). Mirrors `client_actions::build_client_action_tool`'s
/// shape, including the `strict` / `compat_omit_strict` handling.
pub fn build_client_tool(
    name: &str,
    description: &str,
    schema: Value,
    omit_tool_strict: bool,
) -> GenaiTool {
    GenaiTool {
        name: GenaiToolName::Custom(name.to_string()),
        description: Some(description.to_string()),
        schema: Some(schema),
        strict: if omit_tool_strict { None } else { Some(false) },
        config: None,
    }
}

/// The result of a client-executed tool, delivered back to the suspended
/// agentic loop. Either a successful JSON result (becomes the tool response the
/// model reasons over) or an error message (the model sees it and can recover).
#[derive(Debug, Clone)]
pub enum ClientToolOutcome {
    Result(Value),
    Error(String),
}

/// Outcome of attempting to deliver a client-tool result into a parked loop.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClientToolDelivery {
    /// The result was handed to the waiting loop.
    Delivered,
    /// No loop is waiting for this tool_call_id — already delivered, timed out,
    /// aborted, or never issued. The delivery is a benign no-op (idempotent).
    Unknown,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn build_client_tool_sets_name_description_and_schema() {
        let schema = json!({ "type": "object", "properties": {} });
        let tool = build_client_tool(
            "outlook.fetch_availability",
            "Fetch the user's free/busy.",
            schema.clone(),
            false,
        );
        match &tool.name {
            GenaiToolName::Custom(name) => assert_eq!(name, "outlook.fetch_availability"),
            other => panic!("expected a custom tool name, got {other:?}"),
        }
        assert_eq!(
            tool.description.as_deref(),
            Some("Fetch the user's free/busy.")
        );
        assert_eq!(tool.schema, Some(schema));
        assert_eq!(tool.strict, Some(false));
    }

    #[test]
    fn build_client_tool_omits_strict_when_requested() {
        let tool = build_client_tool("t", "d", json!({ "type": "object" }), true);
        assert_eq!(tool.strict, None);
    }
}
