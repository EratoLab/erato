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
        read_only: false,
    }
}

/// What a call of an MCP tool shows wherever it appears: the tool's descriptor,
/// the server's name from the live config and the call's label, with the IDs
/// it names resolved from earlier results in the chat, stored with the call's
/// parts.
pub fn mcp_tool_call_display(
    config: &McpRuntimeConfig,
    server_id: &str,
    tool: &rmcp::model::Tool,
    arguments: &serde_json::Value,
    context: &label::ToolResultContext,
) -> ToolDisplayMetadata {
    // Names only add to a label, so a resolver bug costs the names, not the label.
    let label = label::guarded(|| {
        let mut label = label::mcp_call_label(server_id, tool, arguments);
        context.resolve(&mut label, arguments);
        label
    })
    .or_else(|| label::guarded(|| label::mcp_call_label(server_id, tool, arguments)))
    .or_else(|| label::guarded(|| label::generic_label(arguments)));
    ToolDisplayMetadata {
        server_name: Some(config.mcp_server_display_name(server_id)),
        label,
        read_only: shown_as_read_only(tool),
        ..tool_display_metadata(tool)
    }
}

/// What a call of one of Erato's own client tools shows: the label its
/// `[label]` table writes by hand. `None` for a tool without one, whose calls
/// show as before.
pub fn client_tool_call_display(
    config: &erato_config::config::ClientToolConfig,
    arguments: &serde_json::Value,
) -> Option<ToolDisplayMetadata> {
    let table = config.label.as_ref()?;
    own_tool_display(&config.name, arguments, || {
        label::own::own_label(
            &config.name,
            &label::own::client_tool_mapping(table),
            arguments,
        )
    })
}

/// What a `propose_client_action` call shows: the label of the action it
/// proposes, whose card carries the rest.
pub fn client_action_call_display(arguments: &serde_json::Value) -> Option<ToolDisplayMetadata> {
    use crate::services::client_actions::{CLIENT_ACTION_TOOL_NAME, client_action_label_mapping};
    own_tool_display(CLIENT_ACTION_TOOL_NAME, arguments, || {
        label::own::own_label(
            CLIENT_ACTION_TOOL_NAME,
            &client_action_label_mapping(arguments),
            arguments,
        )
    })
}

/// A labeller bug costs the call its label: the generic one, else the row as
/// it was before labels.
fn own_tool_display(
    name: &str,
    arguments: &serde_json::Value,
    labeller: impl FnOnce() -> crate::models::message::ToolCallLabel,
) -> Option<ToolDisplayMetadata> {
    let label =
        label::guarded(labeller).or_else(|| label::guarded(|| label::generic_label(arguments)))?;
    Some(ToolDisplayMetadata {
        title: name.to_string(),
        description: None,
        description_truncated: false,
        server_name: None,
        label: Some(label),
        read_only: false,
    })
}

/// A tool that says it is both read-only and destructive is shown as a write,
/// so the trace keeps its "ran without asking" note.
fn shown_as_read_only(tool: &rmcp::model::Tool) -> bool {
    crate::services::mcp_tool_approval::normalize_tool_annotations(tool).read_only_hint
        && tool
            .annotations
            .as_ref()
            .and_then(|annotations| annotations.destructive_hint)
            != Some(true)
}

/// What a parent chat keeps of the display a delegated child's call carries:
/// the label's pointers and values as written, without the names and old
/// values the child chat's results gave them.
pub fn child_approval_display(display: &ToolDisplayMetadata) -> ToolDisplayMetadata {
    let mut display = display.clone();
    if let Some(label) = display.label.as_mut() {
        label::context::forget_resolved(label);
    }
    display
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
    use crate::models::message::{ToolCallAction, ToolCallLabelSource, ToolCallObjectKind};
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
        let display =
            mcp_tool_call_display(&config, "dynamics", &tool, &arguments, &Default::default());
        assert_eq!(display.server_name.as_deref(), Some("Dynamics 365"));
        assert_eq!(display.title, "create_record");
        assert_eq!(
            mcp_tool_call_display(
                &config,
                "web_access",
                &tool,
                &arguments,
                &Default::default()
            )
            .server_name
            .as_deref(),
            Some("Web access")
        );
        assert_eq!(
            mcp_tool_call_display(
                &config,
                "removed-since",
                &tool,
                &arguments,
                &Default::default()
            )
            .server_name
            .as_deref(),
            Some("Removed since")
        );
        assert_eq!(tool_display_metadata(&tool).server_name, None);
    }

    #[test]
    fn a_call_is_read_only_only_when_its_annotations_say_so() {
        let shown = |hint: Option<bool>, destructive: Option<bool>| {
            let mut tool = Tool::new("tool", "", JsonObject::new());
            if hint.is_some() || destructive.is_some() {
                tool.annotations = Some(ToolAnnotations::from_raw(
                    None,
                    hint,
                    destructive,
                    None,
                    None,
                ));
            }
            let display = mcp_tool_call_display(
                &McpRuntimeConfig::default(),
                "server",
                &tool,
                &serde_json::json!({}),
                &Default::default(),
            );
            (display.read_only, serde_json::to_value(&display).unwrap())
        };
        for destructive in [None, Some(false)] {
            let (flag, json) = shown(Some(true), destructive);
            assert!(flag);
            assert_eq!(json["read_only"], true);
        }
        // Contradictory hints read as a write.
        for (hint, destructive) in [
            (Some(false), None),
            (None, None),
            (Some(true), Some(true)),
            (None, Some(false)),
        ] {
            let (flag, json) = shown(hint, destructive);
            assert!(!flag, "{hint:?} {destructive:?}");
            assert!(json.get("read_only").is_none());
        }
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
            &Default::default(),
        );
        let rules = display.label.as_ref().unwrap();
        assert_eq!(
            (rules.action, rules.object_kind, rules.source),
            (
                ToolCallAction::Create,
                ToolCallObjectKind::Row,
                ToolCallLabelSource::Rules
            )
        );
        let item = &rules.items[0];
        assert_eq!(item.title.as_ref().unwrap().values[0].text, "Contoso");
        assert_eq!(
            item.target.as_ref().unwrap().pointer,
            "/item/parentaccountid"
        );
        assert_eq!(rules.arguments, label::generic_label(&arguments).arguments);
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
    fn erato_tools_show_their_hand_written_label_and_unlabelled_ones_show_as_before() {
        let mut config: erato_config::config::ClientToolConfig =
            serde_json::from_value(serde_json::json!({
                "name": "word_submit_comment_changes",
                "namespace": "word",
                "description": "Stage comment changes.",
                "parameters": "{}",
            }))
            .unwrap();
        let arguments = serde_json::json!({"changes": [{"op": "resolve", "thread": "t_1"}]});
        assert_eq!(client_tool_call_display(&config, &arguments), None);
        config.label = Some(
            serde_json::from_value(serde_json::json!({
                "action": "comment",
                "object_kind": "comment",
                "fields": ["$.changes[*].op"],
            }))
            .unwrap(),
        );
        let display = client_tool_call_display(&config, &arguments).unwrap();
        assert_eq!(display.title, "word_submit_comment_changes");
        assert_eq!((display.server_name, display.description), (None, None));
        let label = display.label.unwrap();
        assert_eq!(
            (label.action, label.source),
            (ToolCallAction::Comment, ToolCallLabelSource::OwnMapping)
        );
        assert_eq!(label.items[0].fields[0].values[0].text, "resolve");

        let proposal =
            client_action_call_display(&serde_json::json!({"action": "outlook.reply"})).unwrap();
        assert_eq!(proposal.title, "propose_client_action");
        let label = proposal.label.unwrap();
        assert_eq!(
            (label.action, label.object_kind, label.source),
            (
                ToolCallAction::Send,
                ToolCallObjectKind::Email,
                ToolCallLabelSource::OwnMapping
            )
        );
    }

    #[test]
    fn an_own_labeller_that_panics_costs_the_call_only_its_label() {
        let arguments = serde_json::json!({"action": "outlook.reply", "body": "Hi"});
        let display = own_tool_display("propose_client_action", &arguments, || {
            panic!("labeller bug")
        })
        .unwrap();
        assert_eq!(display.title, "propose_client_action");
        assert_eq!(display.label, Some(label::generic_label(&arguments)));

        let config: erato_config::config::ClientToolConfig =
            serde_json::from_value(serde_json::json!({
                "name": "word_submit_document_plan",
                "namespace": "word",
                "description": "Stage a plan.",
                "parameters": "{}",
                "label": {"action": "update", "object_kind": "document"},
            }))
            .unwrap();
        for arguments in [
            serde_json::json!(null),
            serde_json::json!("not json {"),
            serde_json::json!([{"action": "outlook.reply"}]),
            serde_json::json!({"action": {"nested": [1, 2, 3]}, "to": "x".repeat(1024 * 1024)}),
        ] {
            for display in [
                client_tool_call_display(&config, &arguments),
                client_action_call_display(&arguments),
            ] {
                let display = display.expect("an own tool always keeps a display");
                assert_eq!(
                    display.label.as_ref().map(|label| label.source),
                    Some(ToolCallLabelSource::OwnMapping)
                );
                assert!(serde_json::to_string(&display).unwrap().len() < 4 * 1024);
            }
        }
    }

    #[test]
    fn a_hostile_descriptor_changes_neither_the_label_nor_its_size() {
        let arguments = serde_json::json!({"title": "Plan", "parent_id": "p1"});
        let config = McpRuntimeConfig::default();
        let plain = Tool::new("publish", "Publishes.", JsonObject::new());
        let expected =
            mcp_tool_call_display(&config, "notion", &plain, &arguments, &Default::default()).label;
        assert_eq!(
            expected.as_ref().map(|label| label.source),
            Some(crate::models::message::ToolCallLabelSource::Rules)
        );

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
        annotations.idempotent_hint = Some(false);
        hostile.annotations = Some(annotations.clone());
        hostile.title = Some("\u{200B}\u{FEFF}".into());
        let display =
            mcp_tool_call_display(&config, "notion", &hostile, &arguments, &Default::default());
        assert_eq!(display.label, expected);
        annotations.read_only_hint = Some(true);
        annotations.destructive_hint = Some(true);
        hostile.annotations = Some(annotations);
        let display =
            mcp_tool_call_display(&config, "notion", &hostile, &arguments, &Default::default());
        assert_eq!(display.label, Some(label::generic_label(&arguments)));
        assert_eq!(display.title, "publish");
        assert!(display.description_truncated);
        assert!(serde_json::to_string(&display).unwrap().len() < 32 * 1024);
        assert_eq!(
            mcp_tool_call_display(
                &config,
                "notion",
                &hostile,
                &serde_json::json!("not json {"),
                &Default::default(),
            )
            .label
            .map(|label| label.source),
            Some(crate::models::message::ToolCallLabelSource::Generic)
        );
    }

    #[test]
    fn a_mail_card_names_every_recipient_and_no_claim_the_model_made() {
        let config = McpRuntimeConfig::default();
        let tool = Tool::new("send_email", "Sends an email.", JsonObject::new());
        let arguments = serde_json::json!({
            "to": ["ann@example.com"],
            "cc": ["bob@example.com"],
            "bcc": ["cy@example.com"],
            "subject": "Q3",
            "body": "Numbers attached.",
            "hasUserApproved": true,
            "account": {"recordId": "a_1", "relatedTable": "account", "name": "Typed name"},
        });
        let label = mcp_tool_call_display(&config, "mail", &tool, &arguments, &Default::default())
            .label
            .unwrap();
        assert_eq!(
            (label.action, label.source),
            (ToolCallAction::Send, ToolCallLabelSource::Rules)
        );
        let item = &label.items[0];
        let shown: Vec<_> = [&item.title, &item.target, &item.after]
            .into_iter()
            .flatten()
            .chain(&item.fields)
            .map(|slot| (slot.pointer.as_str(), slot.values[0].text.as_str()))
            .collect();
        assert_eq!(
            shown,
            [
                ("/subject", "Q3"),
                ("/to", "ann@example.com"),
                ("/body", "Numbers attached."),
                ("/cc", "bob@example.com"),
                ("/bcc", "cy@example.com"),
            ]
        );
        let stored = serde_json::to_string(&label).unwrap();
        assert!(!stored.contains("Typed name"), "{stored}");
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

    #[test]
    fn a_childs_display_reaches_the_parent_with_its_values_as_written_only() {
        use crate::models::message::{ToolCallAction, ToolCallLabelSource, ToolCallObjectKind};
        use label::{ToolCallLabelItemMapping, ToolCallLabelMapping, resolve_label};
        let arguments = serde_json::json!({
            "title": "Plan", "id": "rec-1", "parent": "p1", "from": "a", "to": "b", "status": "done",
        });
        let mapping = ToolCallLabelMapping {
            action: ToolCallAction::Update,
            object_kind: ToolCallObjectKind::Row,
            items: vec![ToolCallLabelItemMapping {
                title: Some("/title".into()),
                id: Some("/id".into()),
                target: Some("/parent".into()),
                before: Some("/from".into()),
                after: Some("/to".into()),
                fields: vec!["/status".into()],
            }],
            source: ToolCallLabelSource::Rules,
        };
        let written = resolve_label(&mapping, &arguments).unwrap();
        let mut resolved = written.clone();
        let item = &mut resolved.items[0];
        let mut set = 0;
        for slot in [
            &mut item.title,
            &mut item.id,
            &mut item.target,
            &mut item.before,
            &mut item.after,
        ]
        .into_iter()
        .flatten()
        .chain(&mut item.fields)
        {
            for value in &mut slot.values {
                value.resolved = Some("From the child's results".into());
                set += 1;
            }
        }
        assert_eq!(set, 6);
        let child = ToolDisplayMetadata {
            title: "Update record".into(),
            description: Some("Updates a record.".into()),
            description_truncated: false,
            server_name: Some("Dynamics 365".into()),
            label: Some(resolved),
            read_only: false,
        };
        assert_eq!(
            child_approval_display(&child),
            ToolDisplayMetadata {
                label: Some(written),
                ..child.clone()
            }
        );
        let unlabelled = ToolDisplayMetadata {
            label: None,
            ..child
        };
        assert_eq!(child_approval_display(&unlabelled), unlabelled);
    }
}
