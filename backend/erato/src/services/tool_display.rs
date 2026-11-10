//! One projection of MCP-authored display text for the catalog and durable
//! approval requests. Clients render it as plain text, never as trusted markup.

pub mod label;

use crate::config::McpRuntimeConfig;
use crate::models::message::{ToolCallLabelWarning, ToolDisplayMetadata};
use crate::services::display_text::{
    MAX_DISPLAY_DESCRIPTION_CHARS, MAX_DISPLAY_NAME_CHARS, sanitize_display_text,
};
use crate::services::mcp_tool_annotations::McpToolAnnotationSource;

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

/// What a call of an MCP tool shows wherever it appears, labelled by the rules
/// alone, for a tool whose hints are its server's own; see
/// [`mcp_tool_call_display_from`], which takes who set them.
pub fn mcp_tool_call_display(
    config: &McpRuntimeConfig,
    server_id: &str,
    tool: &rmcp::model::Tool,
    arguments: &serde_json::Value,
    approval_argument: Option<&str>,
    context: &label::ToolResultContext,
) -> ToolDisplayMetadata {
    let labelled = LabelledArguments::new(config, server_id, arguments, approval_argument);
    let rules = label::guarded_rules(tool, &labelled.arguments, labelled.consent);
    labelled_display(
        config,
        server_id,
        tool,
        McpToolAnnotationSource::ServerSupplied,
        &labelled,
        &rules.mapping,
        context,
    )
}

/// The mapping a call of an MCP tool is labelled from: the rules', or a
/// model's this user's earlier call of the same shape got where they are
/// unsure; see [`label::mcp_call_mapping`].
pub async fn mcp_tool_call_mapping(
    cache: Option<&label::cache::ToolLabelCache>,
    user_id: &str,
    config: &McpRuntimeConfig,
    server_id: &str,
    tool: &rmcp::model::Tool,
    arguments: &serde_json::Value,
    approval_argument: Option<&str>,
) -> label::McpCallMapping {
    let labelled = LabelledArguments::new(config, server_id, arguments, approval_argument);
    label::mcp_call_mapping(
        cache,
        user_id,
        server_id,
        tool,
        &labelled.arguments,
        labelled.consent,
    )
    .await
}

/// What a call of an MCP tool shows wherever it appears: the tool's descriptor,
/// the server's name from the live config and the label `mapping` gives once
/// the cross-check agrees with it, with the IDs it names resolved from earlier
/// results in the chat, stored with the call's parts. `approval_argument` is
/// the tool's consent argument, which the label leaves out; the server's
/// configured one is a consent flag on any tool. `destructive_hint_source`
/// says who set the tool's destructive hint.
#[allow(clippy::too_many_arguments)]
pub fn mcp_tool_call_display_from(
    config: &McpRuntimeConfig,
    server_id: &str,
    tool: &rmcp::model::Tool,
    destructive_hint_source: McpToolAnnotationSource,
    arguments: &serde_json::Value,
    approval_argument: Option<&str>,
    mapping: &label::ToolCallLabelMapping,
    context: &label::ToolResultContext,
) -> ToolDisplayMetadata {
    let labelled = LabelledArguments::new(config, server_id, arguments, approval_argument);
    labelled_display(
        config,
        server_id,
        tool,
        destructive_hint_source,
        &labelled,
        mapping,
        context,
    )
}

/// A call's arguments as its label reads them, and the consent argument the
/// label treats as a flag: the tool's, else the server's configured one.
struct LabelledArguments<'a> {
    arguments: std::borrow::Cow<'a, serde_json::Value>,
    /// The arguments as stored, which a readable view's paths must reach;
    /// `None` when they are `arguments`.
    stored: Option<std::borrow::Cow<'a, serde_json::Value>>,
    consent: Option<&'a str>,
}

impl<'a> LabelledArguments<'a> {
    fn new(
        config: &'a McpRuntimeConfig,
        server_id: &str,
        arguments: &'a serde_json::Value,
        approval_argument: Option<&'a str>,
    ) -> Self {
        let (arguments, stored) = labelled_read(arguments, approval_argument);
        Self {
            arguments,
            stored,
            consent: label_consent_argument(config, server_id, approval_argument),
        }
    }
}

/// A call's arguments as its label reads them and a model labelling it sees
/// them: without the tool's consent argument, which Erato sets at dispatch,
/// and with the members a string holds as JSON read as members.
pub fn labelled_arguments(
    arguments: &serde_json::Value,
    approval_argument: Option<&str>,
) -> serde_json::Value {
    labelled_read(arguments, approval_argument).0.into_owned()
}

/// The arguments a label reads and, when reading JSON inside strings changed
/// them, the arguments as stored.
fn labelled_read<'a>(
    arguments: &'a serde_json::Value,
    approval_argument: Option<&str>,
) -> (
    std::borrow::Cow<'a, serde_json::Value>,
    Option<std::borrow::Cow<'a, serde_json::Value>>,
) {
    let stored = without_approval_argument(arguments, approval_argument);
    match label::json_strings_read(&stored) {
        Some(read) => (std::borrow::Cow::Owned(read), Some(stored)),
        None => (stored, None),
    }
}

/// The consent argument a call's label treats as a flag: the tool's
/// `approval_argument`, else the server's configured one.
pub fn label_consent_argument<'a>(
    config: &'a McpRuntimeConfig,
    server_id: &str,
    approval_argument: Option<&'a str>,
) -> Option<&'a str> {
    approval_argument.or_else(|| {
        config
            .mcp_servers
            .get(server_id)
            .and_then(|server| server.approval_argument.as_deref())
    })
}

fn labelled_display(
    config: &McpRuntimeConfig,
    server_id: &str,
    tool: &rmcp::model::Tool,
    destructive_hint_source: McpToolAnnotationSource,
    labelled: &LabelledArguments<'_>,
    mapping: &label::ToolCallLabelMapping,
    context: &label::ToolResultContext,
) -> ToolDisplayMetadata {
    let (arguments, consent) = (&*labelled.arguments, labelled.consent);
    let scope = names_scope(config, server_id);
    // Names only add to a label, so a resolver bug costs the names, not the label.
    let label = label::guarded(|| {
        let mut label = label::checked_label(server_id, tool, arguments, mapping, consent);
        if let Some(server) = &scope {
            context.resolve(&mut label, arguments, server);
        }
        // The view's paths reach the input as stored.
        if let Some(stored) = &labelled.stored {
            label.arguments = Some(label::readable_arguments(stored).0);
        }
        let rules_action = label::guarded_rules(tool, arguments, consent)
            .mapping
            .action;
        let facts = label::change::ChangeFacts {
            tool,
            arguments,
            approval_argument: consent,
            context,
            server: scope.as_deref(),
            rules_action,
            glossary: config
                .mcp_servers
                .get(server_id)
                .map(|server| &server.glossary),
            destructive_hint_source,
        };
        if let Some((change, hidden)) =
            label::change::guarded_describe(|| label::change::describe(&label, facts))
        {
            label.change = Some(change);
            if hidden
                && !label
                    .warnings
                    .contains(&ToolCallLabelWarning::HiddenCharacters)
            {
                label.warnings.push(ToolCallLabelWarning::HiddenCharacters);
            }
        }
        label
    })
    .or_else(|| {
        label::guarded(|| label::checked_label(server_id, tool, arguments, mapping, consent))
    })
    .or_else(|| label::guarded(|| label::generic_label(arguments)));
    ToolDisplayMetadata {
        server_name: Some(config.mcp_server_display_name(server_id)),
        label,
        // The annotation is the server's word; a name that says something is
        // lost wins over it.
        read_only: shown_as_read_only(tool)
            && !label::rules::sounds_like_a_loss(&tool.name, arguments),
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
    fn a_server_glossary_and_who_marked_the_tool_destructive_reach_the_card() {
        let config: McpRuntimeConfig = serde_json::from_value(serde_json::json!({
            "mcp_servers": {
                "records": {
                    "transport_type": "streamable_http",
                    "url": "http://localhost/mcp",
                    "glossary": {
                        "field_names": {"prio": "Priority"},
                        "choice_labels": {"prio": {"2": "High"}},
                    },
                    "tools": {
                        "create_record": {
                            "override_tool_annotations": {"destructive_hint": true},
                        },
                    },
                },
                "plain": {
                    "transport_type": "streamable_http",
                    "url": "http://localhost/mcp",
                    "default_tool_annotations": {"destructive_hint": true},
                },
            }
        }))
        .unwrap();
        let mut tool = Tool::new("create_record", "Creates a record.", JsonObject::new());
        tool.annotations = Some(ToolAnnotations::from_raw(
            None,
            None,
            Some(true),
            None,
            None,
        ));
        let arguments = serde_json::json!({"tablename": "t", "item": {"name": "n", "prio": 2}});
        let change_on = |server_id: &str| {
            let resolved = crate::services::mcp_tool_annotations::resolve_tool_annotations(
                tool.clone(),
                &config.mcp_servers[server_id],
                &config.mcp_servers_global.default_tool_annotations,
                &config.mcp_servers_global.override_tool_annotations,
            );
            let mapping = label::guarded_rules(&resolved.tool, &arguments, None).mapping;
            mcp_tool_call_display_from(
                &config,
                server_id,
                &resolved.tool,
                resolved.sources.destructive_hint,
                &arguments,
                None,
                &mapping,
                &Default::default(),
            )
            .label
            .and_then(|label| label.change)
            .expect("a create has a change description")
        };
        let change = change_on("records");
        let priority = change
            .effects
            .iter()
            .find(|effect| effect.raw_name == "prio")
            .expect("the field is on the card");
        assert_eq!(priority.name, "Priority (prio)");
        assert_eq!(
            priority.values[0]
                .meaning
                .as_ref()
                .map(|meaning| meaning.label.as_str()),
            Some("High")
        );
        assert_eq!(
            change.notes,
            [crate::models::message::ToolCallChangeNote::OperatorMarkedDestructive]
        );
        // The tool declared the hint, so the operator's default never applied.
        assert_eq!(
            change_on("plain").notes,
            [crate::models::message::ToolCallChangeNote::MarkedDestructive]
        );
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
                None,
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
        assert!(item.target.is_none());
        assert_eq!(item.fields[0].pointer, "/item/parentaccountid");
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

    #[tokio::test]
    async fn a_cached_mapping_is_found_and_checked_on_the_arguments_the_label_reads() {
        use label::cache::{ToolLabelCache, ToolLabelCacheKey};
        let server = |approval_argument: &str| {
            serde_json::json!({
                "transport_type": "streamable_http",
                "url": "http://localhost/mcp",
                "approval_argument": approval_argument,
            })
        };
        let config: McpRuntimeConfig = serde_json::from_value(serde_json::json!({
            "mcp_servers": {"dv": server("hasUserApproved"), "crm": server("userConfirmed")}
        }))
        .unwrap();
        let tool = Tool::new("crm_records", "Works on CRM records.", JsonObject::new());
        let cache = ToolLabelCache::default();
        let model = label::ToolCallLabelMapping {
            action: ToolCallAction::Update,
            object_kind: ToolCallObjectKind::Row,
            items: vec![label::ToolCallLabelItemMapping {
                id: Some("/recordId".into()),
                fields: vec!["/stage".into()],
                ..Default::default()
            }],
            source: ToolCallLabelSource::Model,
        };
        let earlier = serde_json::json!({"recordId": "rec-1", "stage": "won"});
        let key = ToolLabelCacheKey::new("user-a", "dv", &tool, &earlier);
        let model_mapping = model.clone();
        cache
            .get_or_compute(key, &tool, &earlier, Some("hasUserApproved"), async {
                Some(model_mapping)
            })
            .await
            .unwrap();

        // The tool's consent argument the model sent anyway changes no shape.
        let call =
            serde_json::json!({"recordId": "rec-2", "stage": "lost", "hasUserApproved": true});
        let approval_argument = Some("hasUserApproved");
        let mapping = mcp_tool_call_mapping(
            Some(&cache),
            "user-a",
            &config,
            "dv",
            &tool,
            &call,
            approval_argument,
        )
        .await;
        assert_eq!(
            mapping,
            label::McpCallMapping {
                mapping: label::with_model_verb(
                    label::rules::rules_label(
                        &tool.name,
                        &serde_json::json!({"recordId": "rec-2", "stage": "lost"}),
                        None,
                        approval_argument,
                    )
                    .mapping,
                    &model,
                ),
                unlabelled: None,
            }
        );
        let mapping = mapping.mapping;
        let label = mcp_tool_call_display_from(
            &config,
            "dv",
            &tool,
            McpToolAnnotationSource::ServerSupplied,
            &call,
            approval_argument,
            &mapping,
            &Default::default(),
        )
        .label
        .unwrap();
        assert_eq!(label.source, ToolCallLabelSource::Model);
        assert_eq!(
            label.arguments,
            label::generic_label(&serde_json::json!({"recordId": "rec-2", "stage": "lost"}))
                .arguments
        );

        // Kept before the operator configured the consent argument this tool
        // does not declare.
        let confirm = label::ToolCallLabelMapping {
            items: vec![label::ToolCallLabelItemMapping {
                id: Some("/recordId".into()),
                title: Some("/userConfirmed".into()),
                ..Default::default()
            }],
            ..model
        };
        let flagged = serde_json::json!({"recordId": "rec-3", "userConfirmed": "yes"});
        let key = ToolLabelCacheKey::new("user-a", "crm", &tool, &flagged);
        cache
            .get_or_compute(key.clone(), &tool, &flagged, None, async { Some(confirm) })
            .await
            .unwrap();
        let rules = label::guarded_rules(&tool, &flagged, Some("userConfirmed"));
        assert!(rules.unsure.is_some(), "{rules:?}");
        assert_eq!(
            mcp_tool_call_mapping(
                Some(&cache),
                "user-a",
                &config,
                "crm",
                &tool,
                &flagged,
                None
            )
            .await,
            label::McpCallMapping {
                mapping: rules.mapping,
                unlabelled: Some(key.clone()),
            }
        );
        assert!(cache.entries().get(&key).await.is_none());
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
