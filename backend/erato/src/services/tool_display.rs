//! One projection of MCP-authored display text for the catalog and durable
//! approval requests. Clients render it as plain text, never as trusted markup.

pub mod label;

use crate::config::McpRuntimeConfig;
use crate::models::message::ToolDisplayMetadata;
use crate::services::display_text::{
    MAX_DISPLAY_DESCRIPTION_CHARS, MAX_DISPLAY_NAME_CHARS, sanitize_display_text,
};

pub fn tool_display_metadata(tool: &rmcp::model::Tool) -> ToolDisplayMetadata {
    let title = [
        tool.title.as_deref(),
        tool.annotations
            .as_ref()
            .and_then(|annotations| annotations.title.as_deref()),
    ]
    .into_iter()
    .flatten()
    .map(|candidate| sanitize_display_text(candidate, MAX_DISPLAY_NAME_CHARS).text)
    .find(|candidate| !candidate.is_empty())
    .unwrap_or_else(|| sanitize_display_text(tool.name.as_ref(), MAX_DISPLAY_NAME_CHARS).text);
    let description = tool
        .description
        .as_deref()
        .map(|value| sanitize_display_text(value, MAX_DISPLAY_DESCRIPTION_CHARS))
        .filter(|value| !value.text.is_empty());
    ToolDisplayMetadata {
        title,
        description_truncated: description.as_ref().is_some_and(|value| value.truncated),
        description: description.map(|value| value.text),
        server_name: None,
        label: None,
    }
}

/// What a call of an MCP tool shows wherever it appears: the tool's descriptor,
/// the server's name from the live config and the call's label, stored with
/// the call's parts. `approval_argument` is the tool's consent argument, which
/// the label leaves out.
pub fn mcp_tool_call_display(
    config: &McpRuntimeConfig,
    server_id: &str,
    tool: &rmcp::model::Tool,
    arguments: &serde_json::Value,
    approval_argument: Option<&str>,
) -> ToolDisplayMetadata {
    let arguments = without_approval_argument(arguments, approval_argument);
    ToolDisplayMetadata {
        server_name: Some(config.mcp_server_display_name(server_id)),
        label: label::guarded(|| label::generic_label(&arguments)),
        ..tool_display_metadata(tool)
    }
}

/// Erato sets the consent argument from the user's decision at dispatch, so a
/// value the model sent there is not what the call writes.
fn without_approval_argument<'a>(
    arguments: &'a serde_json::Value,
    approval_argument: Option<&str>,
) -> std::borrow::Cow<'a, serde_json::Value> {
    match (arguments, approval_argument) {
        (serde_json::Value::Object(members), Some(name)) if members.contains_key(name) => {
            std::borrow::Cow::Owned(serde_json::Value::Object(
                members
                    .iter()
                    .filter(|(key, _)| key.as_str() != name)
                    .map(|(key, value)| (key.clone(), value.clone()))
                    .collect(),
            ))
        }
        _ => std::borrow::Cow::Borrowed(arguments),
    }
}

/// What a tool row and its live updates keep of a call's display. Only
/// approval cards show the description, and a row would repeat it per call.
pub fn tool_row_display(display: &ToolDisplayMetadata) -> ToolDisplayMetadata {
    ToolDisplayMetadata {
        description: None,
        description_truncated: false,
        ..display.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rmcp::model::{JsonObject, Tool, ToolAnnotations};

    #[test]
    fn titles_follow_mcp_precedence_and_clean_before_falling_back() {
        let mut tool = Tool::new(
            "arbitrary_new_tool",
            " description\u{202E} ",
            JsonObject::new(),
        );
        assert_eq!(tool_display_metadata(&tool).title, "arbitrary_new_tool");
        let mut annotations = ToolAnnotations::default();
        annotations.title = Some(" Annotated title ".into());
        tool.annotations = Some(annotations);
        assert_eq!(tool_display_metadata(&tool).title, "Annotated title");
        tool.title = Some(" Explicit\u{202E} title ".into());
        let display = tool_display_metadata(&tool);
        assert_eq!(display.title, "Explicit title");
        assert_eq!(display.description.as_deref(), Some("description"));
        tool.title = Some("\u{202E}".into());
        assert_eq!(tool_display_metadata(&tool).title, "Annotated title");
    }

    #[test]
    fn calls_carry_the_configured_server_name_or_the_tidied_id() {
        let config: McpRuntimeConfig = serde_json::from_value(serde_json::json!({
            "mcp_servers": {
                "dynamics": {
                    "display_name": "Dynamics 365",
                    "transport_type": "streamable_http",
                    "url": "http://localhost/mcp",
                },
                "web_access": {
                    "transport_type": "streamable_http",
                    "url": "http://localhost/mcp",
                },
            }
        }))
        .unwrap();
        let tool = Tool::new("create_record", "Creates a record.", JsonObject::new());
        let arguments = serde_json::json!({});
        let display = mcp_tool_call_display(&config, "dynamics", &tool, &arguments, None);
        assert_eq!(display.server_name.as_deref(), Some("Dynamics 365"));
        assert_eq!(display.title, "create_record");
        assert_eq!(
            mcp_tool_call_display(&config, "web_access", &tool, &arguments, None)
                .server_name
                .as_deref(),
            Some("Web access")
        );
        assert_eq!(
            mcp_tool_call_display(&config, "removed-since", &tool, &arguments, None)
                .server_name
                .as_deref(),
            Some("Removed since")
        );
        assert_eq!(tool_display_metadata(&tool).server_name, None);
    }

    #[test]
    fn every_call_is_labelled_from_its_own_arguments_and_the_catalog_is_not() {
        let tool = Tool::new("create_record", "Creates a record.", JsonObject::new());
        let arguments = serde_json::json!({
            "tablename": "account",
            "item": {"name": "Contoso", "parentaccountid": "9b1d5f2e-3c4a-4f88-a1b2-0c1d2e3f4a5b"},
        });
        let display = mcp_tool_call_display(
            &McpRuntimeConfig::default(),
            "dynamics",
            &tool,
            &arguments,
            None,
        );
        assert_eq!(display.label, Some(label::generic_label(&arguments)));
        let paths: Vec<_> = display
            .label
            .as_ref()
            .unwrap()
            .arguments
            .as_ref()
            .unwrap()
            .children
            .iter()
            .map(|node| node.path.as_str())
            .collect();
        assert_eq!(paths, ["/tablename", "/item"]);
        assert_eq!(tool_display_metadata(&tool).label, None);

        let row = tool_row_display(&display);
        assert_eq!(display.description.as_deref(), Some("Creates a record."));
        assert_eq!(
            row,
            ToolDisplayMetadata {
                description: None,
                description_truncated: false,
                ..display
            }
        );
    }

    #[test]
    fn the_consent_argument_is_never_part_of_the_label() {
        let tool = Tool::new("delete_record", "Deletes a record.", JsonObject::new());
        let config = McpRuntimeConfig::default();
        let arguments = serde_json::json!({
            "recordId": "r1",
            "hasUserApproved": true,
            "item": {"hasUserApproved": "a member of the record"},
            "zeta": 1,
        });
        let without = serde_json::json!({
            "recordId": "r1",
            "item": {"hasUserApproved": "a member of the record"},
            "zeta": 1,
        });
        let display =
            mcp_tool_call_display(&config, "dv", &tool, &arguments, Some("hasUserApproved"));
        assert_eq!(display.label, Some(label::generic_label(&without)));
        assert_eq!(
            mcp_tool_call_display(&config, "dv", &tool, &arguments, None).label,
            Some(label::generic_label(&arguments))
        );
        assert_ne!(
            label::generic_label(&arguments),
            label::generic_label(&without)
        );
        for unchanged in [
            serde_json::json!({"recordId": "r1"}),
            serde_json::json!("hasUserApproved"),
            serde_json::json!([{"hasUserApproved": true}]),
        ] {
            assert_eq!(
                mcp_tool_call_display(&config, "dv", &tool, &unchanged, Some("hasUserApproved"))
                    .label,
                Some(label::generic_label(&unchanged))
            );
        }

        let mapping = label::ToolCallLabelMapping {
            action: crate::models::message::ToolCallAction::Delete,
            object_kind: crate::models::message::ToolCallObjectKind::Row,
            items: vec![label::ToolCallLabelItemMapping {
                id: Some("/recordId".into()),
                fields: vec!["/*".into()],
                ..Default::default()
            }],
            source: crate::models::message::ToolCallLabelSource::Rules,
        };
        let shown = without_approval_argument(&arguments, Some("hasUserApproved"));
        let label = label::resolve_label(&mapping, &shown).unwrap();
        let paths: Vec<_> = label.items[0].fields[0]
            .values
            .iter()
            .map(|value| value.path.as_str())
            .collect();
        assert_eq!(paths, ["/recordId", "/item", "/zeta"]);
        let consent = label::ToolCallLabelMapping {
            items: vec![label::ToolCallLabelItemMapping {
                title: Some("/hasUserApproved".into()),
                ..Default::default()
            }],
            ..mapping
        };
        assert!(label::resolve_label(&consent, &shown).is_err());
    }

    #[test]
    fn a_hostile_descriptor_changes_neither_the_label_nor_its_size() {
        let arguments = serde_json::json!({"title": "Plan", "parent_id": "p1"});
        let config = McpRuntimeConfig::default();
        let plain = Tool::new("publish", "Publishes.", JsonObject::new());
        let expected = mcp_tool_call_display(&config, "notion", &plain, &arguments, None).label;
        assert_eq!(expected, Some(label::generic_label(&arguments)));

        let mut schema = JsonObject::new();
        schema.insert("type".into(), serde_json::json!(42));
        schema.insert(
            "properties".into(),
            serde_json::json!(["not", "an", "object"]),
        );
        schema.insert("required".into(), serde_json::json!({"title": true}));
        schema.insert("blob".into(), serde_json::json!("s".repeat(1024 * 1024)));
        let mut hostile = Tool::new("publish\u{202E}\u{200B}", "x".repeat(1024 * 1024), schema);
        let mut annotations = ToolAnnotations::default();
        annotations.title = Some("\u{E0041}".repeat(1_000));
        annotations.read_only_hint = Some(true);
        annotations.destructive_hint = Some(true);
        annotations.idempotent_hint = Some(false);
        hostile.annotations = Some(annotations);
        hostile.title = Some("\u{200B}\u{FEFF}".into());
        let display = mcp_tool_call_display(&config, "notion", &hostile, &arguments, None);
        assert_eq!(display.label, expected);
        assert_eq!(display.title, "publish");
        assert!(display.description_truncated);
        assert!(serde_json::to_string(&display).unwrap().len() < 32 * 1024);
        assert_eq!(
            mcp_tool_call_display(
                &config,
                "notion",
                &hostile,
                &serde_json::json!("not json {"),
                None,
            )
            .label
            .map(|label| label.source),
            Some(crate::models::message::ToolCallLabelSource::Generic)
        );
    }

    #[test]
    fn descriptions_are_bounded_inert_and_honest_about_truncation() {
        let mut tool = Tool::new(
            "a_tool",
            "[link](https://example.com) <b>text</b>",
            JsonObject::new(),
        );
        assert_eq!(
            tool_display_metadata(&tool).description.as_deref(),
            tool.description.as_deref()
        );
        tool.description = Some("ä".repeat(MAX_DISPLAY_DESCRIPTION_CHARS + 1).into());
        let display = tool_display_metadata(&tool);
        assert!(display.description_truncated);
        assert_eq!(
            display.description.unwrap().chars().count(),
            MAX_DISPLAY_DESCRIPTION_CHARS
        );
        tool.description = Some("\u{202E}".into());
        assert_eq!(tool_display_metadata(&tool).description, None);
    }
}
