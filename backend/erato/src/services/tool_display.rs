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
/// the server's name from the live config and the call's label, with the IDs
/// it names resolved from earlier results in the chat, stored with the call's
/// parts. `approval_argument` is the tool's consent argument, which the label
/// leaves out; the server's configured one is a consent flag on any tool.
pub fn mcp_tool_call_display(
    config: &McpRuntimeConfig,
    server_id: &str,
    tool: &rmcp::model::Tool,
    arguments: &serde_json::Value,
    approval_argument: Option<&str>,
    context: &label::ToolResultContext,
) -> ToolDisplayMetadata {
    let arguments = without_approval_argument(arguments, approval_argument);
    let consent = approval_argument.or_else(|| {
        config
            .mcp_servers
            .get(server_id)
            .and_then(|server| server.approval_argument.as_deref())
    });
    let scope = names_scope(config, server_id);
    // Names only add to a label, so a resolver bug costs the names, not the label.
    let label = label::guarded(|| {
        let mut label = label::mcp_call_label(server_id, tool, &arguments, consent);
        if let Some(server) = &scope {
            context.resolve(&mut label, &arguments, server);
        }
        label
    })
    .or_else(|| label::guarded(|| label::mcp_call_label(server_id, tool, &arguments, consent)))
    .or_else(|| label::guarded(|| label::generic_label(&arguments)));
    ToolDisplayMetadata {
        server_name: Some(config.mcp_server_display_name(server_id)),
        label,
        ..tool_display_metadata(tool)
    }
}

/// The server name a call's tool rows carry, under which the context keeps
/// the names that server's results gave. `None`, and so no names, for a
/// server the config does not hold or whose name another server shares.
fn names_scope(config: &McpRuntimeConfig, server_id: &str) -> Option<String> {
    if !config.mcp_servers.contains_key(server_id) {
        return None;
    }
    let name = config.mcp_server_display_name(server_id);
    let shared = config
        .mcp_servers
        .keys()
        .any(|other| other != server_id && config.mcp_server_display_name(other) == name);
    (!shared).then_some(name)
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
        let display = mcp_tool_call_display(
            &config,
            "dynamics",
            &tool,
            &arguments,
            None,
            &Default::default(),
        );
        assert_eq!(display.server_name.as_deref(), Some("Dynamics 365"));
        assert_eq!(display.title, "create_record");
        assert_eq!(
            mcp_tool_call_display(
                &config,
                "web_access",
                &tool,
                &arguments,
                None,
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
                None,
                &Default::default()
            )
            .server_name
            .as_deref(),
            Some("Removed since")
        );
        assert_eq!(tool_display_metadata(&tool).server_name, None);
    }

    #[test]
    fn names_come_only_from_a_configured_server_whose_name_no_other_shares() {
        let server = |display_name: Option<&str>| {
            let mut server = serde_json::json!({
                "transport_type": "streamable_http",
                "url": "http://localhost/mcp",
            });
            if let Some(name) = display_name {
                server["display_name"] = name.into();
            }
            server
        };
        let config: McpRuntimeConfig = serde_json::from_value(serde_json::json!({
            "mcp_servers": {
                "dynamics": server(Some("CRM")),
                "notes": server(Some("Notes")),
                "notes_mirror": server(Some(" Notes ")),
                "web_access": server(None),
                "crawler": server(Some("Web access")),
                "files": server(None),
            }
        }))
        .unwrap();
        let tool = Tool::new("search", "Searches.", JsonObject::new());
        for (server_id, expected) in [("dynamics", "CRM"), ("files", "Files")] {
            let stored = mcp_tool_call_display(
                &config,
                server_id,
                &tool,
                &serde_json::json!({}),
                None,
                &Default::default(),
            )
            .server_name;
            assert_eq!(stored.as_deref(), Some(expected));
            assert_eq!(names_scope(&config, server_id), stored);
        }
        for server_id in ["notes", "notes_mirror", "web_access", "crawler", "removed"] {
            assert_eq!(names_scope(&config, server_id), None, "{server_id}");
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
            None,
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
        let label_of = |arguments: &serde_json::Value, approval_argument| {
            mcp_tool_call_display(
                &config,
                "dv",
                &tool,
                arguments,
                approval_argument,
                &Default::default(),
            )
            .label
            .unwrap()
        };
        let shown = label_of(&arguments, Some("hasUserApproved"));
        assert_eq!(
            (
                shown.action,
                shown.items[0].id.as_ref().unwrap().pointer.as_str()
            ),
            (ToolCallAction::Delete, "/recordId")
        );
        assert_eq!(shown.arguments, label::generic_label(&without).arguments);
        let kept = label_of(&arguments, None);
        assert_eq!(kept.items, shown.items);
        assert_eq!(kept.arguments, label::generic_label(&arguments).arguments);
        assert_ne!(
            label::generic_label(&arguments).arguments,
            label::generic_label(&without).arguments
        );
        for unchanged in [
            serde_json::json!({"recordId": "r1"}),
            serde_json::json!("hasUserApproved"),
            serde_json::json!([{"hasUserApproved": true}]),
        ] {
            assert_eq!(
                label_of(&unchanged, Some("hasUserApproved")).arguments,
                label::generic_label(&unchanged).arguments
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
        let label = label::resolve_label(&mapping, &shown, None).unwrap();
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
        assert!(label::resolve_label(&consent, &shown, None).is_err());
    }

    #[test]
    fn the_server_s_approval_argument_is_a_consent_flag_on_every_tool() {
        let server = |approval_argument: Option<&str>| {
            let mut server = serde_json::json!({
                "transport_type": "streamable_http",
                "url": "http://localhost/mcp",
            });
            if let Some(name) = approval_argument {
                server["approval_argument"] = name.into();
            }
            server
        };
        let config: McpRuntimeConfig = serde_json::from_value(serde_json::json!({
            "mcp_servers": {
                "dv": server(Some("userConfirmed")),
                "crm": server(None),
            }
        }))
        .unwrap();
        // The tool does not declare the argument, so the call keeps it.
        let tool = Tool::new("update_record", "Updates a record.", JsonObject::new());
        let arguments = serde_json::json!({
            "recordId": "r1",
            "userConfirmed": true,
            "marketing_consent": true,
            "statuscode": 2,
        });
        let fields = |server_id: &str| {
            let label = mcp_tool_call_display(
                &config,
                server_id,
                &tool,
                &arguments,
                None,
                &Default::default(),
            )
            .label
            .unwrap();
            assert_eq!(label.arguments, label::generic_label(&arguments).arguments);
            label.items[0]
                .fields
                .iter()
                .map(|field| field.pointer.clone())
                .collect::<Vec<_>>()
        };
        assert_eq!(fields("dv"), ["/marketing_consent", "/statuscode"]);
        assert_eq!(
            fields("crm"),
            ["/userConfirmed", "/marketing_consent", "/statuscode"]
        );
    }

    #[test]
    fn a_hostile_descriptor_changes_neither_the_label_nor_its_size() {
        let arguments = serde_json::json!({"title": "Plan", "parent_id": "p1"});
        let config = McpRuntimeConfig::default();
        let plain = Tool::new("publish", "Publishes.", JsonObject::new());
        let expected = mcp_tool_call_display(
            &config,
            "notion",
            &plain,
            &arguments,
            None,
            &Default::default(),
        )
        .label;
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
        let display = mcp_tool_call_display(
            &config,
            "notion",
            &hostile,
            &arguments,
            None,
            &Default::default(),
        );
        assert_eq!(display.label, expected);
        annotations.read_only_hint = Some(true);
        annotations.destructive_hint = Some(true);
        hostile.annotations = Some(annotations);
        let display = mcp_tool_call_display(
            &config,
            "notion",
            &hostile,
            &arguments,
            None,
            &Default::default(),
        );
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
                None,
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
        let label = mcp_tool_call_display(
            &config,
            "mail",
            &tool,
            &arguments,
            None,
            &Default::default(),
        )
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
        let written = resolve_label(&mapping, &arguments, None).unwrap();
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
