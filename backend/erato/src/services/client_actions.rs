//! Client-action proposal tool for action facets.
//!
//! Action facets may declare a fixed set of `client_actions`. When such a
//! facet is active on a request, the model is offered a single synthetic tool
//! through which it can propose exactly one of those actions. The tool is
//! never executed server-side: the resulting `ToolUse` content part is
//! consumed by the client application, which validates the proposal and only
//! performs the action after user confirmation.

use genai::chat::Tool as GenaiTool;
use genai::chat::ToolName as GenaiToolName;
use serde_json::{Value, json};

/// Name of the synthetic tool offered to the model when the active action
/// facet declares `client_actions`.
pub const CLIENT_ACTION_TOOL_NAME: &str = "propose_client_action";

/// Build the synthetic client-action tool with an enum-constrained input
/// schema, so the model can only select one of the configured actions.
pub fn build_client_action_tool(client_actions: &[String], omit_tool_strict: bool) -> GenaiTool {
    GenaiTool {
        name: GenaiToolName::Custom(CLIENT_ACTION_TOOL_NAME.to_string()),
        description: Some(
            "Propose a single client-side action for the user to confirm in their application. \
             The action is NOT executed by calling this tool: the user's application validates \
             the proposal and performs the action only after the user confirms it. Call this \
             tool at most once per response and only with one of the allowed actions."
                .to_string(),
        ),
        schema: Some(json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": client_actions,
                    "description": "The client-side action to propose to the user.",
                }
            },
            "required": ["action"],
            "additionalProperties": false,
        })),
        strict: if omit_tool_strict { None } else { Some(false) },
        config: None,
    }
}

/// Extract the allowed actions back out of the prepared request's tool set.
/// The tool schema is the single source of truth for what was offered to the
/// model on this request.
pub fn allowed_client_actions_from_tools(tools: Option<&Vec<GenaiTool>>) -> Vec<String> {
    tools
        .into_iter()
        .flatten()
        .find(|tool| tool.name.to_string() == CLIENT_ACTION_TOOL_NAME)
        .and_then(|tool| tool.schema.as_ref())
        .and_then(|schema| schema.pointer("/properties/action/enum"))
        .and_then(|actions| actions.as_array())
        .map(|actions| {
            actions
                .iter()
                .filter_map(|action| action.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// Validate the model-provided tool input against the allowed actions.
/// Returns the selected action on success, or a model-facing error message.
pub fn validate_client_action_input(input: &Value, allowed: &[String]) -> Result<String, String> {
    let action = input
        .get("action")
        .and_then(Value::as_str)
        .ok_or_else(|| "missing required string field 'action'".to_string())?;
    if allowed
        .iter()
        .any(|allowed_action| allowed_action == action)
    {
        Ok(action.to_string())
    } else {
        Err(format!(
            "action '{}' is not allowed; allowed actions: {}",
            action,
            allowed.join(", ")
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn actions() -> Vec<String> {
        vec!["outlook.reply".to_string(), "outlook.reply_all".to_string()]
    }

    #[test]
    fn builds_tool_with_enum_schema_and_roundtrips_allowed_actions() {
        let tool = build_client_action_tool(&actions(), false);
        assert_eq!(tool.name.to_string(), CLIENT_ACTION_TOOL_NAME);
        let tools = vec![tool];
        assert_eq!(allowed_client_actions_from_tools(Some(&tools)), actions());
    }

    #[test]
    fn allowed_actions_empty_when_tool_absent() {
        assert!(allowed_client_actions_from_tools(None).is_empty());
        assert!(allowed_client_actions_from_tools(Some(&vec![])).is_empty());
    }

    #[test]
    fn validates_allowed_action() {
        let input = json!({"action": "outlook.reply_all"});
        assert_eq!(
            validate_client_action_input(&input, &actions()).unwrap(),
            "outlook.reply_all"
        );
    }

    #[test]
    fn rejects_unknown_action() {
        let input = json!({"action": "outlook.delete_mailbox"});
        let err = validate_client_action_input(&input, &actions()).unwrap_err();
        assert!(err.contains("not allowed"));
    }

    #[test]
    fn rejects_missing_or_non_string_action() {
        assert!(validate_client_action_input(&json!({}), &actions()).is_err());
        assert!(validate_client_action_input(&json!({"action": 42}), &actions()).is_err());
        assert!(validate_client_action_input(&json!("reply"), &actions()).is_err());
    }
}
