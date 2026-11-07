//! Labels written by hand for Erato's own proposal tools: a client tool's
//! `[label]` table, and the action table of `propose_client_action`. They
//! name what a call proposes; nothing is written until the user confirms it
//! on the tool's own card.

use super::{ToolCallLabelItemMapping, ToolCallLabelMapping, generic_label, resolve_label};
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

/// The label of a call of one of Erato's own tools. No rule second-guesses a
/// verb written by hand next to the tool, and nothing shows a proposal's
/// readable arguments, so its rows do not carry them.
pub fn own_label(mapping: &ToolCallLabelMapping, arguments: &Value) -> ToolCallLabel {
    match resolve_label(mapping, arguments) {
        Ok(label) => ToolCallLabel {
            arguments: None,
            warnings: Vec::new(),
            ..label
        },
        // Not reached: own mappings set only fields, and a field that reaches
        // nothing is left out.
        Err(_) => generic_label(arguments),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
            let label = own_label(&mapping, &arguments);
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
            let label = own_label(&client_tool_mapping(&config), &arguments);
            assert_eq!(label.source, ToolCallLabelSource::OwnMapping);
            assert!(label.items[0].fields.is_empty(), "{arguments}");
        }
    }
}
