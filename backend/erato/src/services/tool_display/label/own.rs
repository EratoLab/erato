//! Labels written by hand for Erato's own proposal tools: a client tool's
//! `[label]` table, and the action table of `propose_client_action`. They
//! name what a call proposes; nothing is written until the user confirms it
//! on the tool's own card.

use super::{ToolCallLabelItemMapping, ToolCallLabelMapping, filtered_label};
use crate::models::message::{
    ToolCallAction, ToolCallLabel, ToolCallLabelSource, ToolCallObjectKind,
};
use erato_config::config::{
    ClientToolLabelAction, ClientToolLabelConfig, ClientToolLabelObjectKind, parse_label_pointer,
};
use serde_json::Value;

impl From<ClientToolLabelAction> for ToolCallAction {
    fn from(action: ClientToolLabelAction) -> Self {
        match action {
            ClientToolLabelAction::Create => Self::Create,
            ClientToolLabelAction::Update => Self::Update,
            ClientToolLabelAction::Delete => Self::Delete,
            ClientToolLabelAction::Move => Self::Move,
            ClientToolLabelAction::Send => Self::Send,
            ClientToolLabelAction::Comment => Self::Comment,
        }
    }
}

impl From<ClientToolLabelObjectKind> for ToolCallObjectKind {
    fn from(kind: ClientToolLabelObjectKind) -> Self {
        match kind {
            ClientToolLabelObjectKind::Page => Self::Page,
            ClientToolLabelObjectKind::Row => Self::Row,
            ClientToolLabelObjectKind::Database => Self::Database,
            ClientToolLabelObjectKind::Folder => Self::Folder,
            ClientToolLabelObjectKind::Note => Self::Note,
            ClientToolLabelObjectKind::Comment => Self::Comment,
            ClientToolLabelObjectKind::Paragraph => Self::Paragraph,
            ClientToolLabelObjectKind::Document => Self::Document,
            ClientToolLabelObjectKind::Email => Self::Email,
            ClientToolLabelObjectKind::Message => Self::Message,
            ClientToolLabelObjectKind::Event => Self::Event,
            ClientToolLabelObjectKind::File => Self::File,
            ClientToolLabelObjectKind::Task => Self::Task,
            ClientToolLabelObjectKind::Other => Self::Other,
        }
    }
}

/// The mapping a client tool's `[label]` table gives its calls: one item
/// holding the table's fields, or none when it lists no field.
pub fn client_tool_mapping(config: &ClientToolLabelConfig) -> ToolCallLabelMapping {
    // Startup refuses a path that does not parse; one kept as written reaches
    // nothing.
    let fields: Vec<String> = config
        .fields
        .iter()
        .map(|path| parse_label_pointer(path).unwrap_or_else(|_| path.clone()))
        .collect();
    ToolCallLabelMapping {
        action: config.action.into(),
        object_kind: config.object_kind.into(),
        items: (!fields.is_empty())
            .then(|| ToolCallLabelItemMapping {
                fields,
                ..Default::default()
            })
            .into_iter()
            .collect(),
        source: ToolCallLabelSource::OwnMapping,
    }
}

/// What log lines about an own label name in place of an MCP server.
const OWN_ORIGIN: &str = "erato";

/// The label of a call of one of Erato's own tools. No rule second-guesses a
/// verb written by hand next to the tool, but the checks every label passes
/// still apply: a consent flag or lookup name is never a field, and a call
/// that names recipients the label cannot all show gets the generic label.
/// Nothing shows a proposal's readable arguments, so its rows do not carry
/// them.
pub fn own_label(
    tool_name: &str,
    mapping: &ToolCallLabelMapping,
    arguments: &Value,
) -> ToolCallLabel {
    let label = filtered_label(OWN_ORIGIN, tool_name, arguments, mapping, None);
    if label.source == ToolCallLabelSource::Generic {
        return label;
    }
    ToolCallLabel {
        arguments: None,
        warnings: Vec::new(),
        ..label
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::tool_display::label::generic_label;
    use serde_json::json;

    fn comment_changes() -> ClientToolLabelConfig {
        ClientToolLabelConfig {
            action: ClientToolLabelAction::Comment,
            object_kind: ClientToolLabelObjectKind::Comment,
            fields: vec!["$.changes[*].op".into()],
        }
    }

    /// The recorded shapes of `word_submit_comment_changes`, every string
    /// replaced, plus a mixed batch.
    fn comment_change_calls() -> Vec<Value> {
        let change = |op: &str, anchor: Value, thread: Value, text: Value| json!({"op": op, "anchor": anchor, "thread": thread, "target": null, "text": text});
        vec![
            json!({"changes": [change("reply", json!(null), json!("t_1"), json!("Text A"))]}),
            json!({"changes": [change(
                "add",
                json!({"selection": true, "para": null, "through": null, "quote": null, "occurrence": null}),
                json!(null),
                json!("Text B"),
            )]}),
            json!({"changes": [change(
                "add",
                json!({"selection": null, "para": 3, "through": null, "quote": "Quote C", "occurrence": null}),
                json!(null),
                json!("Text C"),
            )]}),
            json!({"changes": [change("resolve", json!(null), json!("t_2"), json!(null))]}),
            json!({"changes": [
                change("reply", json!(null), json!("t_3"), json!("Text D")),
                change("resolve", json!(null), json!("t_4"), json!(null)),
                change("reopen", json!(null), json!("t_5"), json!(null)),
            ]}),
        ]
    }

    #[test]
    fn every_recorded_comment_change_shape_reads_its_operations() {
        let mapping = client_tool_mapping(&comment_changes());
        assert_eq!(mapping.items[0].fields, ["/changes/*/op"]);
        for arguments in comment_change_calls() {
            let label = own_label("word_submit_comment_changes", &mapping, &arguments);
            assert_eq!(
                (label.action, label.object_kind, label.source),
                (
                    ToolCallAction::Comment,
                    ToolCallObjectKind::Comment,
                    ToolCallLabelSource::OwnMapping
                )
            );
            let ops = &label.items[0].fields[0];
            assert_eq!(ops.name.as_deref(), Some("op"));
            assert_eq!(
                ops.values.len(),
                arguments["changes"].as_array().unwrap().len()
            );
            assert_eq!((label.arguments, label.warnings), (None, Vec::new()));
            let text = serde_json::to_string(&label.items).unwrap();
            assert!(!text.contains("Text") && !text.contains("Quote"), "{text}");
        }
    }

    #[test]
    fn a_table_without_fields_gives_the_verb_and_kind_alone() {
        let plan = ClientToolLabelConfig {
            action: ClientToolLabelAction::Update,
            object_kind: ClientToolLabelObjectKind::Document,
            fields: Vec::new(),
        };
        let label = own_label(
            "word_submit_document_plan",
            &client_tool_mapping(&plan),
            &json!({"version": 1, "snapshot": "s_1", "entries": []}),
        );
        assert_eq!(
            label,
            ToolCallLabel {
                action: ToolCallAction::Update,
                object_kind: ToolCallObjectKind::Document,
                items: Vec::new(),
                arguments: None,
                warnings: Vec::new(),
                source: ToolCallLabelSource::OwnMapping,
            }
        );
    }

    #[test]
    fn a_field_that_reaches_nothing_is_left_out_of_the_label() {
        let unparsed = ClientToolLabelConfig {
            fields: vec!["changes.op".into()],
            ..comment_changes()
        };
        for (config, arguments) in [
            (comment_changes(), json!({"changes": []})),
            (unparsed, json!({"changes": [{"op": "reply"}]})),
        ] {
            let label = own_label("submit_comments", &client_tool_mapping(&config), &arguments);
            assert_eq!(label.source, ToolCallLabelSource::OwnMapping);
            assert!(label.items[0].fields.is_empty(), "{arguments}");
        }
    }

    fn update_row(fields: &[&str]) -> ClientToolLabelConfig {
        ClientToolLabelConfig {
            action: ClientToolLabelAction::Update,
            object_kind: ClientToolLabelObjectKind::Row,
            fields: fields.iter().map(|field| field.to_string()).collect(),
        }
    }

    #[test]
    fn an_own_table_never_shows_a_consent_flag_or_a_lookup_s_name() {
        let arguments = json!({
            "hasUserApproved": true,
            "options": {"user_confirmed": "yes"},
            "item": {
                "statuscode": 2,
                "customer": {"recordId": "c_1", "relatedTable": "account", "name": "Typed by the model"},
            },
        });
        let table = update_row(&[
            "$.hasUserApproved",
            "$.options.user_confirmed",
            "$.item.customer.name",
            "$.item.statuscode",
        ]);
        let label = own_label("update_row", &client_tool_mapping(&table), &arguments);
        assert_eq!(label.source, ToolCallLabelSource::OwnMapping);
        let shown: Vec<_> = label.items[0]
            .fields
            .iter()
            .map(|field| field.pointer.as_str())
            .collect();
        assert_eq!(shown, ["/item/statuscode"]);
        let stored = serde_json::to_string(&label).unwrap();
        assert!(!stored.contains("Typed by the model"), "{stored}");
        assert!(!stored.contains("hasUserApproved"), "{stored}");
    }

    #[test]
    fn an_own_table_names_every_recipient_or_gives_the_generic_label() {
        let table = ClientToolLabelConfig {
            action: ClientToolLabelAction::Send,
            object_kind: ClientToolLabelObjectKind::Email,
            fields: vec!["$.subject".into()],
        };
        let mapping = client_tool_mapping(&table);
        let arguments =
            json!({"to": ["ann@example.com"], "cc": ["bob@example.com"], "subject": "Q3"});
        let label = own_label("stage_email", &mapping, &arguments);
        assert_eq!(label.source, ToolCallLabelSource::OwnMapping);
        let shown: Vec<_> = label.items[0]
            .fields
            .iter()
            .map(|field| field.pointer.as_str())
            .collect();
        for pointer in ["/to", "/cc", "/subject"] {
            assert!(shown.contains(&pointer), "{shown:?}");
        }
        assert_eq!(label.arguments, None);

        let crowded = json!({
            "to": ["a@example.com"],
            "cc": ["b@example.com"],
            "bcc": ["c@example.com"],
            "attendees": ["d@example.com"],
            "share_with": ["e@example.com"],
            "subject": "Q3",
        });
        let label = own_label("stage_email", &mapping, &crowded);
        assert_eq!(label, generic_label(&crowded));

        // A proposal line shows no values, so recipients leave it as it is.
        let proposal = own_label(
            "stage_email",
            &client_tool_mapping(&ClientToolLabelConfig {
                fields: Vec::new(),
                ..table
            }),
            &crowded,
        );
        assert_eq!(
            (proposal.source, proposal.items.len(), proposal.arguments),
            (ToolCallLabelSource::OwnMapping, 0, None)
        );
    }

    #[test]
    fn any_arguments_give_an_own_label_that_is_small_or_the_generic_one() {
        let mappings = [
            client_tool_mapping(&comment_changes()),
            client_tool_mapping(&update_row(&["$.rows[*].name", "$.next[*].next", "$.body"])),
            crate::services::client_actions::client_action_label_mapping(&json!({
                "action": "outlook.reply"
            })),
        ];
        for arguments in super::super::tests::hostile_arguments() {
            for mapping in &mappings {
                let label = super::super::guarded(|| own_label("tool", mapping, &arguments))
                    .expect("labelling never panics");
                let stored = serde_json::to_string(&label).unwrap().len();
                assert!(stored < 64 * 1024, "label of {stored} bytes");
                match label.source {
                    ToolCallLabelSource::OwnMapping => assert_eq!(label.arguments, None),
                    source => assert_eq!(source, ToolCallLabelSource::Generic),
                }
            }
        }
    }
}
