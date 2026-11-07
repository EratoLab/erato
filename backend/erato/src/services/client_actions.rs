//! Client-action proposal tool for action facets.
//!
//! Action facets may declare a fixed set of `client_actions`. When such a
//! facet is active on a request, the model is offered a single synthetic tool
//! through which it can propose exactly one of those actions. The tool is
//! never executed server-side: the resulting `ToolUse` content part is
//! consumed by the client application, which validates the proposal and only
//! performs the action after user confirmation.

use crate::models::message::{ToolCallAction, ToolCallLabelSource, ToolCallObjectKind};
use crate::services::tool_display::label::ToolCallLabelMapping;
use genai::chat::Tool as GenaiTool;
use genai::chat::ToolName as GenaiToolName;
use serde_json::{Value, json};

/// Name of the synthetic tool offered to the model when the active action
/// facet declares `client_actions`.
pub use erato_config::config::CLIENT_ACTION_TOOL_NAME;

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
        custom_format: None,
        cache_control: None,
        eager_input_streaming: None,
    }
}

/// What each client action proposes, for the line its call shows in the
/// chat. The action's own card carries the details.
const CLIENT_ACTION_LABELS: &[(&str, ToolCallAction, ToolCallObjectKind)] = {
    use ToolCallAction::{Comment, Create, Send, Update};
    use ToolCallObjectKind as Kind;
    &[
        ("outlook.reply", Send, Kind::Email),
        ("outlook.reply_all", Send, Kind::Email),
        ("outlook.create_appointment", Create, Kind::Event),
        ("word.apply_edits", Update, Kind::Document),
        ("word.replace_selection", Update, Kind::Document),
        ("word.insert_at_cursor", Update, Kind::Document),
        ("word.apply_document_plan", Update, Kind::Document),
        ("word.add_comments", Comment, Kind::Comment),
        ("word.respond_to_comments", Comment, Kind::Comment),
        ("word.modify_comments", Update, Kind::Comment),
    ]
};

/// The label mapping of a `propose_client_action` call, from the action it
/// names. An id missing from the table, such as one a release has since
/// dropped, reads as a proposal of some action: `other`.
pub fn client_action_label_mapping(input: &Value) -> ToolCallLabelMapping {
    let action = input.get("action").and_then(Value::as_str);
    let (action, object_kind) = CLIENT_ACTION_LABELS
        .iter()
        .find(|(id, _, _)| Some(*id) == action)
        .map_or(
            (ToolCallAction::Other, ToolCallObjectKind::Other),
            |(_, action, kind)| (*action, *kind),
        );
    ToolCallLabelMapping {
        action,
        object_kind,
        items: Vec::new(),
        source: ToolCallLabelSource::OwnMapping,
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

    #[test]
    fn recorded_actions_name_what_they_propose_and_others_stay_unnamed() {
        let label = |input: Value| {
            let mapping = client_action_label_mapping(&input);
            assert_eq!(mapping.source, ToolCallLabelSource::OwnMapping);
            assert!(mapping.items.is_empty());
            (mapping.action, mapping.object_kind)
        };
        use ToolCallAction::*;
        use ToolCallObjectKind as Kind;
        for (action, expected) in [
            ("outlook.reply", (Send, Kind::Email)),
            ("outlook.reply_all", (Send, Kind::Email)),
            ("outlook.create_appointment", (Create, Kind::Event)),
            ("word.apply_edits", (Update, Kind::Document)),
            ("word.apply_document_plan", (Update, Kind::Document)),
            ("word.replace_selection", (Update, Kind::Document)),
            ("word.apply_ooxml_package", (Other, Kind::Other)),
        ] {
            assert_eq!(label(json!({ "action": action })), expected, "{action}");
        }
        assert_eq!(label(json!({})), (Other, Kind::Other));
        assert_eq!(label(json!({"action": 42})), (Other, Kind::Other));
        for odd in [
            json!(null),
            json!("outlook.reply"),
            json!(["outlook.reply"]),
            json!({"action": null}),
            json!({"action": ["outlook.reply"]}),
            json!({"action": {"id": "outlook.reply"}}),
            json!({"action": " outlook.reply"}),
            json!({"action": "OUTLOOK.REPLY"}),
            json!({"action": "outlook.reply\u{202E}"}),
            json!({"action": "outlook/reply"}),
            json!({"action": "x".repeat(1024 * 1024)}),
            json!({"Action": "outlook.reply"}),
        ] {
            assert_eq!(label(odd.clone()), (Other, Kind::Other), "{odd}");
        }
    }
}
