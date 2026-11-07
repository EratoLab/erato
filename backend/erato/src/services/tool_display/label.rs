//! The label a tool call shows: what it does to what, and where. A mapping
//! only names pointers into the call's arguments and picks from closed lists;
//! code reads every value through those pointers, so whoever wrote the mapping
//! (by hand, by rules or a model) cannot put text of its own on the card.

mod arguments;
pub mod cache;
pub mod context;
pub mod own;
pub mod pointer;
pub mod rules;

pub use arguments::readable_arguments;
pub use context::ToolResultContext;

use crate::models::message::{
    ToolCallAction, ToolCallLabel, ToolCallLabelItem, ToolCallLabelSlot, ToolCallLabelSource,
    ToolCallLabelValue, ToolCallLabelWarning, ToolCallObjectKind,
};
use crate::services::display_text::{MAX_DISPLAY_NAME_CHARS, sanitize_display_text};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const MAX_LABEL_ITEMS: usize = 3;
pub const MAX_LABEL_FIELDS: usize = erato_config::config::MAX_CLIENT_TOOL_LABEL_FIELDS;
/// Values kept per pointer; a wildcard over a large batch counts the rest.
pub const MAX_SLOT_VALUES: usize = 10;
/// A value longer than this is cut; the full value stays in the input.
pub const MAX_LABEL_VALUE_CHARS: usize = 200;

/// Where a label's parts sit in a call's arguments: pointers and closed-list
/// choices, never values, so one mapping fits every call of the same shape
/// and holds nothing of any one call.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, erato_memory::HeapSize)]
pub struct ToolCallLabelMapping {
    pub action: ToolCallAction,
    pub object_kind: ToolCallObjectKind,
    #[serde(default)]
    pub items: Vec<ToolCallLabelItemMapping>,
    pub source: ToolCallLabelSource,
}

/// Pointers for one item. `title`, `id`, `target`, `before` and `after` are
/// core: each one set must reach a value.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, erato_memory::HeapSize)]
#[serde(default)]
pub struct ToolCallLabelItemMapping {
    pub title: Option<String>,
    pub id: Option<String>,
    pub target: Option<String>,
    pub before: Option<String>,
    pub after: Option<String>,
    pub fields: Vec<String>,
}

/// The core pointer of a mapping that reached nothing in a call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UnresolvedPointer {
    pub item: usize,
    pub part: &'static str,
}

/// The label any call can have: no claim about what the call does, only its
/// arguments in readable form.
pub fn generic_label(arguments: &Value) -> ToolCallLabel {
    let (view, truncated) = readable_arguments(arguments);
    ToolCallLabel {
        action: ToolCallAction::Other,
        object_kind: ToolCallObjectKind::Other,
        items: Vec::new(),
        arguments: Some(view),
        warnings: truncated
            .then_some(ToolCallLabelWarning::ArgumentsTruncated)
            .into_iter()
            .collect(),
        source: ToolCallLabelSource::Generic,
    }
}

/// The mapping an MCP call is labelled from: the rules', unless they are
/// unsure and a model mapped a call of the same shape for this user before.
/// `tool` carries the resolved annotations.
pub async fn mcp_call_mapping(
    cache: &cache::ToolLabelCache,
    user_id: &str,
    server_id: &str,
    tool: &rmcp::model::Tool,
    arguments: &Value,
) -> ToolCallLabelMapping {
    let rules = rules::rules_label(&tool.name, arguments, tool.annotations.as_ref());
    if rules.unsure.is_none() {
        return rules.mapping;
    }
    let key = cache::ToolLabelCacheKey::new(user_id, server_id, tool, arguments);
    match cache.lookup(&key, arguments).await {
        Some(mapping) if rules::cross_check(tool, arguments, mapping.action).is_empty() => mapping,
        // For one key only the annotations can change the verdict, so the
        // entry would be rejected on every later call too.
        Some(_) => {
            cache.forget(&key).await;
            rules.mapping
        }
        None => rules.mapping,
    }
}

/// A mapping's label, whatever its source, once the cross-check agrees with
/// its verb and its core pointers all reach a value; otherwise the generic
/// label and a log line that names the reason and no argument value.
pub fn checked_label(
    server_id: &str,
    tool: &rmcp::model::Tool,
    arguments: &Value,
    mapping: &ToolCallLabelMapping,
) -> ToolCallLabel {
    if mapping.source == ToolCallLabelSource::Generic {
        return generic_label(arguments);
    }
    let flags = rules::cross_check(tool, arguments, mapping.action);
    if !flags.is_empty() {
        let reasons = flags
            .iter()
            .map(|flag| flag.as_str())
            .collect::<Vec<_>>()
            .join(",");
        tracing::info!(
            server_id = %server_id,
            tool_name = %tool.name,
            action = ?mapping.action,
            source = ?mapping.source,
            reasons = %reasons,
            "Showing the generic label for a tool call: its verb disagrees with the tool's name or annotations"
        );
        return generic_label(arguments);
    }
    resolve_label(mapping, arguments).unwrap_or_else(|UnresolvedPointer { item, part }| {
        tracing::info!(
            server_id = %server_id,
            tool_name = %tool.name,
            source = ?mapping.source,
            item,
            part,
            "Showing the generic label for a tool call: a label pointer reaches nothing in its arguments"
        );
        generic_label(arguments)
    })
}

/// The mapping's label for one call. A core pointer that reaches nothing
/// means the mapping does not fit the call, and the caller shows the generic
/// label instead; a field that reaches nothing is only left out.
pub fn resolve_label(
    mapping: &ToolCallLabelMapping,
    arguments: &Value,
) -> Result<ToolCallLabel, UnresolvedPointer> {
    let items = mapping
        .items
        .iter()
        .take(MAX_LABEL_ITEMS)
        .enumerate()
        .map(|(index, item)| {
            resolve_item(item, arguments).map_err(|part| UnresolvedPointer { item: index, part })
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ToolCallLabel {
        action: mapping.action,
        object_kind: mapping.object_kind,
        items,
        source: mapping.source,
        ..generic_label(arguments)
    })
}

fn resolve_item(
    item: &ToolCallLabelItemMapping,
    arguments: &Value,
) -> Result<ToolCallLabelItem, &'static str> {
    let core = |part: &'static str, pointer: &Option<String>| {
        pointer
            .as_deref()
            .map(|pointer| slot(arguments, pointer, false).ok_or(part))
            .transpose()
    };
    Ok(ToolCallLabelItem {
        title: core("title", &item.title)?,
        id: core("id", &item.id)?,
        target: core("target", &item.target)?,
        before: core("before", &item.before)?,
        after: core("after", &item.after)?,
        fields: item
            .fields
            .iter()
            .filter_map(|pointer| slot(arguments, pointer, true))
            .take(MAX_LABEL_FIELDS)
            .collect(),
    })
}

/// `None` when the pointer reaches nothing. A null it reaches counts as
/// reached but shows no value.
fn slot(arguments: &Value, pointer: &str, field: bool) -> Option<ToolCallLabelSlot> {
    let reached = pointer::resolve(arguments, pointer);
    if reached.is_empty() {
        return None;
    }
    let mut slot = ToolCallLabelSlot {
        pointer: pointer.to_string(),
        name: field
            .then(|| pointer::last_name(pointer))
            .flatten()
            .map(|name| sanitize_display_text(&name, MAX_DISPLAY_NAME_CHARS).text),
        values: Vec::new(),
        omitted: 0,
    };
    let mut keep = |path: String, value: &Value| {
        if slot.values.len() == MAX_SLOT_VALUES {
            slot.omitted = slot.omitted.saturating_add(1);
        } else if let Some(value) = label_value(path, value) {
            slot.values.push(value);
        }
    };
    for pointer::Reached { path, value } in reached {
        // An array reached whole lists its entries, as `*` would.
        match value {
            Value::Array(entries) => {
                for (index, entry) in entries.iter().enumerate() {
                    keep(format!("{path}/{index}"), entry);
                }
            }
            value => keep(path, value),
        }
    }
    Some(slot)
}

fn label_value(path: String, value: &Value) -> Option<ToolCallLabelValue> {
    let raw = match value {
        Value::Null => return None,
        Value::String(text) => std::borrow::Cow::Borrowed(text.as_str()),
        Value::Bool(_) | Value::Number(_) | Value::Array(_) | Value::Object(_) => {
            std::borrow::Cow::Owned(value.to_string())
        }
    };
    let text = sanitize_display_text(&raw, MAX_LABEL_VALUE_CHARS);
    (!text.text.is_empty()).then_some(ToolCallLabelValue {
        path,
        text: text.text,
        truncated: text.truncated,
        resolved: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::message::{ToolArgumentKind, ToolDisplayMetadata};
    use serde_json::json;

    fn texts(slot: &ToolCallLabelSlot) -> Vec<&str> {
        slot.values
            .iter()
            .map(|value| value.text.as_str())
            .collect()
    }

    fn notion_batch() -> Value {
        json!({
            "parent": {"data_source_id": "9b1d5f2e-3c4a-4f88-a1b2-0c1d2e3f4a5b"},
            "pages": [
                {"properties": {"Name": "Acme", "Seats": 12, "Stage": "Lead"}, "content": "First call."},
                {"properties": {"Name": "Globex\u{202E}moc.evil", "Seats": null, "Stage": "Customer"}},
            ],
        })
    }

    fn create_rows() -> ToolCallLabelMapping {
        ToolCallLabelMapping {
            action: ToolCallAction::Create,
            object_kind: ToolCallObjectKind::Row,
            items: vec![ToolCallLabelItemMapping {
                title: Some("/pages/*/properties/Name".into()),
                target: Some("/parent".into()),
                fields: vec![
                    "/pages/*/properties/Seats".into(),
                    "/pages/*/properties/Missing".into(),
                    "/pages/*/properties/Stage".into(),
                ],
                ..Default::default()
            }],
            source: ToolCallLabelSource::Rules,
        }
    }

    #[test]
    fn values_are_read_through_wildcards_and_cleaned() {
        let arguments = notion_batch();
        let label = resolve_label(&create_rows(), &arguments).unwrap();
        assert_eq!(
            (label.action, label.object_kind, label.source),
            (
                ToolCallAction::Create,
                ToolCallObjectKind::Row,
                ToolCallLabelSource::Rules
            )
        );
        let item = &label.items[0];
        let title = item.title.as_ref().unwrap();
        assert_eq!(title.pointer, "/pages/*/properties/Name");
        assert_eq!(texts(title), ["Acme", "Globexmoc.evil"]);
        assert_eq!(title.values[1].path, "/pages/1/properties/Name");
        assert_eq!(title.name, None);
        assert!(title.values.iter().all(|value| value.resolved.is_none()));
        assert_eq!(
            texts(item.target.as_ref().unwrap()),
            [r#"{"data_source_id":"9b1d5f2e-3c4a-4f88-a1b2-0c1d2e3f4a5b"}"#]
        );
        let fields: Vec<_> = item
            .fields
            .iter()
            .map(|field| (field.name.as_deref().unwrap(), texts(field)))
            .collect();
        assert_eq!(
            fields,
            [("Seats", vec!["12"]), ("Stage", vec!["Lead", "Customer"])]
        );
        assert_eq!(label.arguments, generic_label(&arguments).arguments);
    }

    #[test]
    fn one_core_pointer_that_reaches_nothing_drops_the_label() {
        let arguments = notion_batch();
        for part in ["title", "id", "target", "before", "after"] {
            let mut mapping = create_rows();
            let item = &mut mapping.items[0];
            let pointer = Some("/pages/*/name".to_string());
            match part {
                "title" => item.title = pointer,
                "id" => item.id = pointer,
                "target" => item.target = pointer,
                "before" => item.before = pointer,
                _ => item.after = pointer,
            }
            assert_eq!(
                resolve_label(&mapping, &arguments),
                Err(UnresolvedPointer { item: 0, part })
            );
        }
        let mut mapping = create_rows();
        mapping.items.insert(0, ToolCallLabelItemMapping::default());
        mapping.items[1].after = Some("not a pointer".into());
        assert_eq!(
            resolve_label(&mapping, &arguments),
            Err(UnresolvedPointer {
                item: 1,
                part: "after"
            })
        );
        let mut mapping = create_rows();
        mapping.items[0].before = Some("/pages/1/properties/Seats".into());
        let label = resolve_label(&mapping, &arguments).unwrap();
        assert!(label.items[0].before.as_ref().unwrap().values.is_empty());
    }

    #[test]
    fn values_items_and_fields_are_capped() {
        let pages: Vec<_> = (0..MAX_SLOT_VALUES + 4)
            .map(|i| json!({ "title": format!("Page {i}") }))
            .collect();
        let long = "ä".repeat(MAX_LABEL_VALUE_CHARS + 1);
        let arguments =
            json!({"pages": pages, "to": ["a@example.com", "b@example.com"], "body": long});
        let mapping = ToolCallLabelMapping {
            action: ToolCallAction::Send,
            object_kind: ToolCallObjectKind::Email,
            items: vec![
                ToolCallLabelItemMapping {
                    title: Some("/pages/*/title".into()),
                    target: Some("/to".into()),
                    after: Some("/body".into()),
                    fields: vec!["/to".into(); MAX_LABEL_FIELDS + 2],
                    ..Default::default()
                };
                MAX_LABEL_ITEMS + 1
            ],
            source: ToolCallLabelSource::Model,
        };
        let label = resolve_label(&mapping, &arguments).unwrap();
        assert_eq!(label.items.len(), MAX_LABEL_ITEMS);
        let item = &label.items[0];
        let title = item.title.as_ref().unwrap();
        assert_eq!(title.values.len(), MAX_SLOT_VALUES);
        assert_eq!(title.omitted, 4);
        assert_eq!(
            texts(item.target.as_ref().unwrap()),
            ["a@example.com", "b@example.com"]
        );
        assert_eq!(item.target.as_ref().unwrap().values[1].path, "/to/1");
        let after = &item.after.as_ref().unwrap().values[0];
        assert!(after.truncated);
        assert_eq!(after.text.chars().count(), MAX_LABEL_VALUE_CHARS);
        assert_eq!(item.fields.len(), MAX_LABEL_FIELDS);
    }

    #[test]
    fn the_generic_label_claims_nothing_and_shows_the_arguments() {
        let label = generic_label(&notion_batch());
        assert_eq!(
            (label.action, label.object_kind, label.source),
            (
                ToolCallAction::Other,
                ToolCallObjectKind::Other,
                ToolCallLabelSource::Generic
            )
        );
        assert!(label.items.is_empty() && label.warnings.is_empty());
        let view = label.arguments.as_ref().unwrap();
        assert_eq!(view.children[0].children[0].kind, ToolArgumentKind::Id);

        let rows: Vec<_> = (0..100).map(|i| json!({ "n": i })).collect();
        assert_eq!(
            generic_label(&json!({ "rows": rows })).warnings,
            [ToolCallLabelWarning::ArgumentsTruncated]
        );
    }

    #[test]
    fn a_huge_key_cannot_make_the_label_larger_than_the_key() {
        let huge = "k".repeat(10_000);
        let row: serde_json::Map<_, _> = (0..9).map(|i| (format!("{huge}{i}"), json!(i))).collect();
        let mut nested = json!(vec![Value::Object(row); 25]);
        for _ in 0..3 {
            nested = Value::Object([(huge.clone(), nested)].into_iter().collect());
        }
        let label = generic_label(&json!({ "a": nested, "query": "q" }));
        let stored = serde_json::to_string(&label).unwrap();
        assert!(stored.len() < huge.len(), "{} bytes", stored.len());
        assert_eq!(label.warnings, [ToolCallLabelWarning::ArgumentsTruncated]);
    }

    #[test]
    fn stored_labels_round_trip_and_tolerate_newer_values() {
        let label = resolve_label(&create_rows(), &notion_batch()).unwrap();
        let display = ToolDisplayMetadata {
            title: "Create pages".into(),
            description: None,
            description_truncated: false,
            server_name: Some("Notion".into()),
            label: Some(label),
            read_only: false,
        };
        let json = serde_json::to_value(&display).unwrap();
        assert_eq!(json["label"]["action"], "create");
        assert_eq!(json["label"]["source"], "rules");
        assert_eq!(json["label"]["arguments"]["kind"], "group");
        assert!(json["label"]["items"][0].get("id").is_none());
        assert_eq!(
            serde_json::from_value::<ToolDisplayMetadata>(json.clone()).unwrap(),
            display
        );

        let mut newer = json;
        newer["label"]["action"] = json!("archive");
        newer["label"]["object_kind"] = json!("spreadsheet");
        newer["label"]["source"] = json!("cache");
        newer["label"]["warnings"] = json!(["shared_with_everyone"]);
        newer["label"]["arguments"]["kind"] = json!("date");
        let parsed: ToolDisplayMetadata = serde_json::from_value(newer).unwrap();
        let label = parsed.label.unwrap();
        assert_eq!(
            (label.action, label.object_kind, label.source),
            (
                ToolCallAction::Other,
                ToolCallObjectKind::Other,
                ToolCallLabelSource::Generic
            )
        );
        assert_eq!(label.warnings, [ToolCallLabelWarning::Other]);
        assert_eq!(label.arguments.unwrap().kind, ToolArgumentKind::Value);

        let older: ToolDisplayMetadata = serde_json::from_value(
            json!({"title": "Create pages", "description_truncated": false}),
        )
        .unwrap();
        assert_eq!(older.label, None);
    }

    #[derive(Clone, Default)]
    struct Capture(std::sync::Arc<std::sync::Mutex<Vec<u8>>>);

    impl std::io::Write for Capture {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(bytes);
            Ok(bytes.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    /// The label `run` computes and what it logged.
    fn logged(run: impl FnOnce() -> ToolCallLabel) -> (ToolCallLabel, String) {
        let capture = Capture::default();
        let writer = capture.clone();
        let subscriber = tracing_subscriber::fmt()
            .with_ansi(false)
            .with_writer(move || writer.clone())
            .finish();
        let label = tracing::subscriber::with_default(subscriber, run);
        let log = String::from_utf8(capture.0.lock().unwrap().clone()).unwrap();
        (label, log)
    }

    fn create_page(annotations: Option<rmcp::model::ToolAnnotations>) -> rmcp::model::Tool {
        let mut tool = rmcp::model::Tool::new(
            "create_page",
            "Creates a page.",
            rmcp::model::JsonObject::new(),
        );
        tool.annotations = annotations;
        tool
    }

    fn rules_checked(tool: &rmcp::model::Tool, arguments: &Value) -> ToolCallLabel {
        let rules = rules::rules_label(&tool.name, arguments, tool.annotations.as_ref());
        checked_label("notion", tool, arguments, &rules.mapping)
    }

    #[test]
    fn an_mcp_call_shows_the_rules_label_unless_its_resolved_hints_disagree() {
        let arguments = json!({"title": "Secret plan", "parent_id": "secret-parent"});
        let hints = |read_only, destructive| {
            Some(rmcp::model::ToolAnnotations::from_raw(
                None,
                read_only,
                destructive,
                None,
                None,
            ))
        };
        // An absent destructive hint says nothing; normalized, it would read
        // as destructive and flag every create.
        for annotations in [None, hints(Some(false), None)] {
            let (label, log) = logged(|| rules_checked(&create_page(annotations), &arguments));
            assert_eq!(
                (label.action, label.source),
                (ToolCallAction::Create, ToolCallLabelSource::Rules)
            );
            assert_eq!(
                texts(label.items[0].title.as_ref().unwrap()),
                ["Secret plan"]
            );
            assert!(log.is_empty(), "{log}");
        }

        let (label, log) =
            logged(|| rules_checked(&create_page(hints(Some(true), None)), &arguments));
        assert_eq!(label, generic_label(&arguments));
        for expected in ["notion", "create_page", "read_only_annotation", "Create"] {
            assert!(log.contains(expected), "{expected}: {log}");
        }
        assert!(
            !log.contains("Secret") && !log.contains("secret-parent"),
            "{log}"
        );
    }

    #[test]
    fn a_label_from_any_source_falls_back_to_generic_when_checks_fail() {
        let arguments = notion_batch();
        let tool = rmcp::model::Tool::new(
            "notion-create-pages",
            "Creates pages.",
            rmcp::model::JsonObject::new(),
        );
        let model = ToolCallLabelMapping {
            source: ToolCallLabelSource::Model,
            ..create_rows()
        };
        let (label, log) = logged(|| checked_label("notion", &tool, &arguments, &model));
        assert_eq!(label, resolve_label(&model, &arguments).unwrap());
        assert!(log.is_empty(), "{log}");

        let deleting = ToolCallLabelMapping {
            action: ToolCallAction::Delete,
            ..model.clone()
        };
        let (label, log) = logged(|| checked_label("notion", &tool, &arguments, &deleting));
        assert_eq!(label, generic_label(&arguments));
        assert!(log.contains("name_verb") && log.contains("Model"), "{log}");

        let mut missing = model.clone();
        missing.items[0].after = Some("/pages/*/body".into());
        let (label, log) = logged(|| checked_label("notion", &tool, &arguments, &missing));
        assert_eq!(label, generic_label(&arguments));
        assert!(
            log.contains("part=\"after\"") || log.contains("part=after"),
            "{log}"
        );
        assert!(!log.contains("Acme"), "{log}");

        let generic = ToolCallLabelMapping {
            source: ToolCallLabelSource::Generic,
            ..deleting
        };
        assert_eq!(
            checked_label("notion", &tool, &arguments, &generic),
            generic_label(&arguments)
        );

        let changes = json!({"changes": [{"op": "delete", "thread": "t_1"}]});
        let schema = json!({"type": "object", "properties": {"changes": {
            "type": "array",
            "items": {"type": "object", "properties": {"op": {"type": "string"}, "thread": {"type": "string"}}},
        }}});
        let word = rmcp::model::Tool::new(
            "word_submit_comment_changes",
            "Changes comments.",
            schema.as_object().unwrap().clone(),
        );
        let creating = ToolCallLabelMapping {
            action: ToolCallAction::Create,
            object_kind: ToolCallObjectKind::Comment,
            items: vec![ToolCallLabelItemMapping {
                id: Some("/changes/*/thread".into()),
                ..Default::default()
            }],
            source: ToolCallLabelSource::Model,
        };
        let (label, log) = logged(|| checked_label("word", &word, &changes, &creating));
        assert_eq!(label, generic_label(&changes));
        assert!(log.contains("field_verb"), "{log}");
    }

    #[tokio::test]
    async fn a_models_mapping_labels_a_call_only_where_the_rules_are_unsure_and_for_its_user() {
        let mut tool = rmcp::model::Tool::new(
            "crm_records",
            "Works on CRM records.",
            json!({"type": "object", "properties": {"recordId": {"type": "string"}}})
                .as_object()
                .unwrap()
                .clone(),
        );
        let first = json!({"recordId": "rec-1", "stage": "won"});
        let rules = rules::rules_label(&tool.name, &first, None);
        assert!(rules.unsure.is_some(), "{rules:?}");
        let model = ToolCallLabelMapping {
            action: ToolCallAction::Update,
            object_kind: ToolCallObjectKind::Row,
            items: vec![ToolCallLabelItemMapping {
                id: Some("/recordId".into()),
                fields: vec!["/stage".into()],
                ..Default::default()
            }],
            source: ToolCallLabelSource::Model,
        };
        let cache = cache::ToolLabelCache::default();
        let key = cache::ToolLabelCacheKey::new("user-a", "crm", &tool, &first);
        cache
            .get_or_compute(key, &first, async { Some(model.clone()) })
            .await;

        let second = json!({"recordId": "rec-2", "stage": "lost"});
        let mapping = mcp_call_mapping(&cache, "user-a", "crm", &tool, &second).await;
        assert_eq!(mapping, model);
        let label = checked_label("crm", &tool, &second, &mapping);
        assert_eq!(label.source, ToolCallLabelSource::Model);
        assert_eq!(texts(label.items[0].id.as_ref().unwrap()), ["rec-2"]);
        assert_eq!(
            mcp_call_mapping(&cache, "user-b", "crm", &tool, &second).await,
            rules::rules_label(&tool.name, &second, None).mapping
        );

        let hints = |read_only, destructive| {
            Some(rmcp::model::ToolAnnotations::from_raw(
                None,
                read_only,
                destructive,
                None,
                None,
            ))
        };
        tool.annotations = hints(Some(true), None);
        let read = mcp_call_mapping(&cache, "user-a", "crm", &tool, &second).await;
        assert_eq!(read.source, ToolCallLabelSource::Rules);
        tool.annotations = None;
        assert_eq!(
            mcp_call_mapping(&cache, "user-a", "crm", &tool, &second).await,
            model
        );

        // An operator's later override drops a mapping it rules out.
        let create = ToolCallLabelMapping {
            action: ToolCallAction::Create,
            ..model.clone()
        };
        let key = cache::ToolLabelCacheKey::new("user-c", "crm", &tool, &first);
        cache
            .get_or_compute(key.clone(), &first, async { Some(create.clone()) })
            .await;
        tool.annotations = hints(None, Some(true));
        let rules_mapping =
            rules::rules_label(&tool.name, &second, tool.annotations.as_ref()).mapping;
        assert_eq!(
            mcp_call_mapping(&cache, "user-c", "crm", &tool, &second).await,
            rules_mapping
        );
        assert!(cache.entries().get(&key).await.is_none());
        assert_eq!(
            checked_label("crm", &tool, &second, &rules_mapping).source,
            ToolCallLabelSource::Rules
        );
    }
}
