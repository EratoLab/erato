//! Labels written by hand for Erato's own proposal tools: a client tool's
//! `[label]` table, and the action table of `propose_client_action`. They
//! name what a call proposes; nothing is written until the user confirms it
//! on the tool's own card.

use super::{
    ToolCallLabelItemMapping, ToolCallLabelMapping, UnresolvedPointer, generic_label, resolve_label,
};
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
/// when the table sets any pointer, none otherwise.
pub fn client_tool_mapping(config: &ClientToolLabelConfig) -> ToolCallLabelMapping {
    // Startup refuses a pointer that does not parse; one kept as written
    // reaches nothing.
    let pointer = |path: &String| parse_label_pointer(path).unwrap_or_else(|_| path.clone());
    let item = ToolCallLabelItemMapping {
        title: config.title.as_ref().map(pointer),
        id: config.id.as_ref().map(pointer),
        target: config.target.as_ref().map(pointer),
        before: config.before.as_ref().map(pointer),
        after: config.after.as_ref().map(pointer),
        fields: config.fields.iter().map(pointer).collect(),
    };
    ToolCallLabelMapping {
        action: config.action.into(),
        object_kind: config.object_kind.into(),
        items: config
            .pointers()
            .next()
            .is_some()
            .then_some(item)
            .into_iter()
            .collect(),
        source: ToolCallLabelSource::OwnMapping,
    }
}

/// The label of a call of one of Erato's own tools. No rule second-guesses a
/// verb written by hand next to the tool; a core pointer that reaches nothing
/// still shows the generic label, with a log line that names no value.
pub fn own_label(
    tool_name: &str,
    mapping: &ToolCallLabelMapping,
    arguments: &Value,
) -> ToolCallLabel {
    resolve_label(mapping, arguments).unwrap_or_else(|UnresolvedPointer { item, part }| {
        tracing::info!(
            tool_name = %tool_name,
            item,
            part,
            "Showing the generic label for a call of an Erato tool: a label pointer reaches nothing in its arguments"
        );
        generic_label(arguments)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn comment_changes() -> ClientToolLabelConfig {
        ClientToolLabelConfig {
            action: ClientToolLabelAction::Comment,
            object_kind: ClientToolLabelObjectKind::Comment,
            title: None,
            id: None,
            target: None,
            before: None,
            after: None,
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
            let text = serde_json::to_string(&label.items).unwrap();
            assert!(!text.contains("Text") && !text.contains("Quote"), "{text}");
        }
    }

    #[test]
    fn a_table_without_pointers_gives_the_verb_and_kind_alone() {
        let plan = ClientToolLabelConfig {
            action: ClientToolLabelAction::Update,
            object_kind: ClientToolLabelObjectKind::Document,
            fields: Vec::new(),
            ..comment_changes()
        };
        let arguments = json!({"version": 1, "snapshot": "s_1", "entries": []});
        let label = own_label(
            "submit_document_plan",
            &client_tool_mapping(&plan),
            &arguments,
        );
        assert_eq!(
            (label.action, label.object_kind, label.source),
            (
                ToolCallAction::Update,
                ToolCallObjectKind::Document,
                ToolCallLabelSource::OwnMapping
            )
        );
        assert!(label.items.is_empty());
        assert_eq!(label.arguments, generic_label(&arguments).arguments);
    }

    #[test]
    fn a_core_pointer_that_reaches_nothing_shows_the_generic_label() {
        let config = ClientToolLabelConfig {
            id: Some("$.changes[*].thread".into()),
            ..comment_changes()
        };
        let mapping = client_tool_mapping(&config);
        let arguments = json!({"changes": []});
        assert_eq!(
            own_label("word_submit_comment_changes", &mapping, &arguments),
            generic_label(&arguments)
        );
        let unparsed = ClientToolLabelConfig {
            id: Some("changes.thread".into()),
            ..comment_changes()
        };
        let arguments = json!({"changes": [{"thread": "t_1"}]});
        assert_eq!(
            own_label(
                "word_submit_comment_changes",
                &client_tool_mapping(&unparsed),
                &arguments
            ),
            generic_label(&arguments)
        );
    }
}
