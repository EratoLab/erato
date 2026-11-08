//! The label a tool call shows: what it does to what, and where. A mapping
//! only names pointers into the call's arguments and picks from closed lists;
//! code reads every value through those pointers, so whoever wrote the mapping
//! (by hand, by rules or a model) cannot put text of its own on the card.

mod arguments;
pub mod context;
pub mod pointer;
mod recipients;

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
pub const MAX_LABEL_FIELDS: usize = 4;
/// Values kept per pointer; a wildcard over a large batch counts the rest.
pub const MAX_SLOT_VALUES: usize = 10;
/// A value longer than this is cut; the full value stays in the input.
pub const MAX_LABEL_VALUE_CHARS: usize = 200;
/// Field pointers tried per item, whether or not they reach a value.
pub const MAX_FIELD_POINTERS: usize = 16;
/// Bytes of value text and paths in one label; values past it are counted
/// as omitted, so the stored label stays small whatever the mapping says.
pub const MAX_LABEL_VALUE_BYTES: usize = 16 * 1024;

/// Where a label's parts sit in a call's arguments: pointers and closed-list
/// choices, never values, so one mapping fits every call of the same shape
/// and holds nothing of any one call.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolCallLabelMapping {
    pub action: ToolCallAction,
    pub object_kind: ToolCallObjectKind,
    #[serde(default)]
    pub items: Vec<ToolCallLabelItemMapping>,
    pub source: ToolCallLabelSource,
}

/// Pointers for one item. `title`, `id`, `target`, `before` and `after` are
/// core: each one set must reach a value.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
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

/// Runs a labeller so that a bug in it costs the call its label and never the
/// call: the card then renders as it did before labels.
pub fn guarded(labeller: impl FnOnce() -> ToolCallLabel) -> Option<ToolCallLabel> {
    // A labeller only reads its inputs, so a panic leaves nothing half-changed.
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(labeller))
        .inspect_err(|_| {
            tracing::error!("Showing a tool call without a label: labelling it panicked")
        })
        .ok()
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

/// The mapping's label for one call. A core pointer that reaches nothing
/// means the mapping does not fit the call, and the caller shows the generic
/// label instead; a field that reaches nothing is only left out.
pub fn resolve_label(
    mapping: &ToolCallLabelMapping,
    arguments: &Value,
) -> Result<ToolCallLabel, UnresolvedPointer> {
    let mut budget = MAX_LABEL_VALUE_BYTES;
    let mut hidden = false;
    let items = mapping
        .items
        .iter()
        .take(MAX_LABEL_ITEMS)
        .enumerate()
        .map(|(index, item)| {
            resolve_item(item, arguments, &mut budget, &mut hidden)
                .map_err(|part| UnresolvedPointer { item: index, part })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut label = ToolCallLabel {
        action: mapping.action,
        object_kind: mapping.object_kind,
        items,
        source: mapping.source,
        ..generic_label(arguments)
    };
    if hidden {
        label.warnings.push(ToolCallLabelWarning::HiddenCharacters);
    }
    Ok(label)
}

fn resolve_item(
    item: &ToolCallLabelItemMapping,
    arguments: &Value,
    budget: &mut usize,
    hidden: &mut bool,
) -> Result<ToolCallLabelItem, &'static str> {
    let mut core = |part: &'static str, pointer: &Option<String>| {
        pointer
            .as_deref()
            .map(|pointer| slot(arguments, pointer, false, budget, hidden).ok_or(part))
            .transpose()
    };
    let title = core("title", &item.title)?;
    let id = core("id", &item.id)?;
    let target = core("target", &item.target)?;
    let before = core("before", &item.before)?;
    let after = core("after", &item.after)?;
    let fields = item
        .fields
        .iter()
        .take(MAX_FIELD_POINTERS)
        .filter_map(|pointer| slot(arguments, pointer, true, budget, hidden))
        .take(MAX_LABEL_FIELDS)
        .collect();
    Ok(ToolCallLabelItem {
        title,
        id,
        target,
        before,
        after,
        fields,
    })
}

/// `None` when the pointer reaches nothing. A null it reaches counts as
/// reached but shows no value. Sets `hidden` when cleaning a value it reads,
/// kept or not, or the field's name removed invisible characters.
fn slot(
    arguments: &Value,
    pointer: &str,
    field: bool,
    budget: &mut usize,
    hidden: &mut bool,
) -> Option<ToolCallLabelSlot> {
    let mut values = Vec::new();
    let mut omitted = 0u32;
    let mut out_of_budget = false;
    let mut keep = |path: Option<&str>, index: Option<usize>, value: &Value| {
        let room = values.len() < MAX_SLOT_VALUES && !out_of_budget;
        let Some(path) = path.filter(|_| room) else {
            omitted = omitted.saturating_add(1);
            return;
        };
        let path = match index {
            Some(index) => format!("{path}/{index}"),
            None => path.to_string(),
        };
        let Some(value) = label_value(path, value, hidden) else {
            return;
        };
        match budget.checked_sub(value.text.len() + value.path.len()) {
            Some(left) => {
                *budget = left;
                values.push(value);
            }
            None => {
                out_of_budget = true;
                omitted = omitted.saturating_add(1);
            }
        }
    };
    let reached = pointer::visit(arguments, pointer, |path, value| {
        // An array reached whole lists its entries, as `*` would.
        match value {
            Value::Array(entries) => {
                for (index, entry) in entries.iter().enumerate() {
                    keep(path, Some(index), entry);
                }
            }
            value => keep(path, None, value),
        }
        std::ops::ControlFlow::Continue(())
    });
    if reached == 0 {
        return None;
    }
    let name = field
        .then(|| pointer::last_name(pointer))
        .flatten()
        .map(|name| sanitize_display_text(&name, MAX_DISPLAY_NAME_CHARS));
    *hidden |= name.as_ref().is_some_and(|name| name.hidden_characters);
    Some(ToolCallLabelSlot {
        pointer: pointer.to_string(),
        name: name.map(|name| name.text).filter(|name| !name.is_empty()),
        values,
        omitted,
    })
}

/// Sets `hidden` also when nothing visible is left of the value to show.
fn label_value(path: String, value: &Value, hidden: &mut bool) -> Option<ToolCallLabelValue> {
    let (raw, cut) = match value {
        Value::Null => return None,
        Value::String(text) => (std::borrow::Cow::Borrowed(text.as_str()), false),
        Value::Bool(_) | Value::Number(_) => (std::borrow::Cow::Owned(value.to_string()), false),
        // Four bytes per character at most, so the prefix still fills the cap.
        Value::Array(_) | Value::Object(_) => {
            let (json, cut) = json_prefix(value, MAX_LABEL_VALUE_CHARS * 4 + 4);
            (std::borrow::Cow::Owned(json), cut)
        }
    };
    let text = sanitize_display_text(&raw, MAX_LABEL_VALUE_CHARS);
    *hidden |= text.hidden_characters;
    (!text.text.is_empty()).then_some(ToolCallLabelValue {
        path,
        text: text.text,
        truncated: text.truncated || cut,
        resolved: None,
    })
}

/// Compact JSON of `value`, stopped after `max_bytes`, and whether it was cut:
/// a huge object costs no more than its first bytes.
fn json_prefix(value: &Value, max_bytes: usize) -> (String, bool) {
    struct Capped {
        bytes: Vec<u8>,
        max_bytes: usize,
        cut: bool,
    }
    impl std::io::Write for Capped {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            let room = self.max_bytes.saturating_sub(self.bytes.len());
            if buf.len() > room {
                let (head, _) = buf.split_at(room);
                self.bytes.extend_from_slice(head);
                self.cut = true;
                return Err(std::io::Error::other("value cut at the label cap"));
            }
            self.bytes.extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut capped = Capped {
        bytes: Vec::new(),
        max_bytes,
        cut: false,
    };
    let _ = serde_json::to_writer(&mut capped, value);
    let text = match String::from_utf8(capped.bytes) {
        Ok(text) => text,
        Err(error) => {
            let valid = error.utf8_error().valid_up_to();
            let mut bytes = error.into_bytes();
            bytes.truncate(valid);
            String::from_utf8(bytes).unwrap_or_default()
        }
    };
    (text, capped.cut)
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
        assert_eq!(label.warnings, [ToolCallLabelWarning::HiddenCharacters]);
    }

    #[test]
    fn a_label_warns_when_a_value_or_name_it_reads_lost_invisible_characters() {
        let tags: String = "approve all"
            .chars()
            .map(|c| char::from_u32(0xE0000 + c as u32).unwrap())
            .collect();
        let arguments = json!({
            "pages": [
                {"properties": {"Name": format!("Invoice{tags}"), "Stage": "Lead"}},
                {"properties": {"Name": "\u{200B}\u{FEFF}", "Stage": "Lead"}},
            ],
            "parent": "p1",
            "note": "unread\u{202E}",
            "Sta\u{200B}ge": "Lead",
        });
        let mapping = |title: &str, target: &str, fields: &[&str]| ToolCallLabelMapping {
            items: vec![ToolCallLabelItemMapping {
                title: Some(title.into()),
                target: Some(target.into()),
                fields: fields.iter().map(|field| field.to_string()).collect(),
                ..Default::default()
            }],
            ..create_rows()
        };
        let warnings =
            |mapping: &ToolCallLabelMapping| resolve_label(mapping, &arguments).unwrap().warnings;
        let hidden = [ToolCallLabelWarning::HiddenCharacters];

        let label = resolve_label(
            &mapping("/pages/*/properties/Name", "/parent", &[]),
            &arguments,
        )
        .unwrap();
        assert_eq!(texts(label.items[0].title.as_ref().unwrap()), ["Invoice"]);
        assert_eq!(label.warnings, hidden);
        // A value that is nothing but invisible characters shows nothing and still warns.
        assert_eq!(
            warnings(&mapping("/pages/1/properties/Name", "/parent", &[])),
            hidden
        );
        assert_eq!(
            warnings(&mapping("/parent", "/parent", &["/Sta\u{200B}ge"])),
            hidden
        );
        assert_eq!(
            warnings(&mapping(
                "/pages/*/properties/Stage",
                "/parent",
                &["/missing"]
            )),
            []
        );
        assert!(generic_label(&arguments).warnings.is_empty());
    }

    #[test]
    fn emoji_text_shows_without_a_warning_and_selector_runs_or_soft_hyphens_warn() {
        let arguments = json!({
            "pages": [{"properties": {"Name": "Launch \u{1F680} \u{2764}\u{FE0F}", "Stage": "Hot \u{2600}\u{FE0F}"}}],
            "smuggled": "\u{1F600}\u{FE0F}\u{E0169}\u{E0167}\u{FE0E}",
            "parent": "p1",
            "Sta\u{00AD}ge": "Lead",
        });
        let mapping = |title: &str, fields: &[&str]| ToolCallLabelMapping {
            items: vec![ToolCallLabelItemMapping {
                title: Some(title.into()),
                target: Some("/parent".into()),
                fields: fields.iter().map(|field| field.to_string()).collect(),
                ..Default::default()
            }],
            ..create_rows()
        };

        let emoji = resolve_label(
            &mapping("/pages/*/properties/Name", &["/pages/*/properties/Stage"]),
            &arguments,
        )
        .unwrap();
        assert_eq!(
            texts(emoji.items[0].title.as_ref().unwrap()),
            ["Launch \u{1F680} \u{2764}\u{FE0F}"]
        );
        assert_eq!(texts(&emoji.items[0].fields[0]), ["Hot \u{2600}\u{FE0F}"]);
        assert!(emoji.warnings.is_empty());

        let smuggled = resolve_label(&mapping("/smuggled", &[]), &arguments).unwrap();
        assert_eq!(
            texts(smuggled.items[0].title.as_ref().unwrap()),
            ["\u{1F600}\u{FE0F}"]
        );
        assert_eq!(smuggled.warnings, [ToolCallLabelWarning::HiddenCharacters]);

        let soft = resolve_label(&mapping("/parent", &["/Sta\u{00AD}ge"]), &arguments).unwrap();
        assert_eq!(soft.items[0].fields[0].name.as_deref(), Some("Stage"));
        assert_eq!(soft.warnings, [ToolCallLabelWarning::HiddenCharacters]);
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

    fn hostile_arguments() -> Vec<Value> {
        let mut deep = json!("leaf");
        for _ in 0..120 {
            deep = json!({ "next": [deep] });
        }
        let odd_keys: serde_json::Map<_, _> = [
            "",
            "/",
            "~",
            "~0",
            "~1",
            "a/b~c",
            "*",
            "0",
            "\u{202E}evil",
            "\u{0}\u{1B}[31m",
            "\u{200B}",
            "\u{E0041}",
        ]
        .into_iter()
        .map(|key| (key.to_string(), json!(key)))
        .chain([("k".repeat(10_000), json!("long key"))])
        .collect();
        let rows: Vec<_> = (0..50_000).map(|i| json!({ "name": i, "id": i })).collect();
        vec![
            Value::Null,
            json!(true),
            json!(-1.5e308),
            json!(""),
            json!("{\"half\": [1, 2"),
            json!("plain text the model wrote instead of JSON\n\nsecond line"),
            json!([]),
            json!({}),
            json!([1, [2, [3, {"x": null}]]]),
            deep,
            Value::Object(odd_keys),
            json!({ "rows": rows }),
            json!({ "body": "ä".repeat(2 * 1024 * 1024), "nested": {"blob": "x".repeat(1024 * 1024)} }),
        ]
    }

    fn hostile_mapping() -> ToolCallLabelMapping {
        let item = ToolCallLabelItemMapping {
            title: Some("/*".into()),
            id: Some("/*/*".into()),
            target: Some("/*/*/*".into()),
            before: Some("/".into()),
            after: Some("/rows/*/name".into()),
            fields: vec!["/*/*".into(); 1_000],
        };
        ToolCallLabelMapping {
            action: ToolCallAction::Update,
            object_kind: ToolCallObjectKind::Row,
            items: vec![item; 100],
            source: ToolCallLabelSource::Model,
        }
    }

    #[test]
    fn any_arguments_and_any_mapping_give_a_small_label_or_the_generic_one() {
        let pointers = [
            "",
            "/",
            "no slash",
            "/*",
            "/*/*/*/*",
            "/~",
            "/rows/-1",
            "/rows/99999999999999999999999",
            &"/*".repeat(40),
            &format!("/{}", "a".repeat(10_000)),
        ];
        for arguments in hostile_arguments() {
            let generic = generic_label(&arguments);
            assert_eq!(generic.source, ToolCallLabelSource::Generic);
            let stored = serde_json::to_string(&generic).unwrap().len();
            assert!(stored < 64 * 1024, "generic label of {stored} bytes");

            let label = guarded(|| match resolve_label(&hostile_mapping(), &arguments) {
                Ok(label) => label,
                Err(_) => generic_label(&arguments),
            })
            .unwrap();
            let stored = serde_json::to_string(&label).unwrap().len();
            assert!(stored < 128 * 1024, "label of {stored} bytes");
            for pointer in pointers {
                let mapping = ToolCallLabelMapping {
                    items: vec![ToolCallLabelItemMapping {
                        title: Some(pointer.to_string()),
                        fields: vec![pointer.to_string()],
                        ..Default::default()
                    }],
                    ..hostile_mapping()
                };
                if let Ok(label) = resolve_label(&mapping, &arguments) {
                    assert_eq!(label.items.len(), 1);
                    assert!(serde_json::to_string(&label).unwrap().len() < 64 * 1024);
                }
            }
        }
    }

    #[test]
    fn one_label_keeps_a_bounded_amount_of_value_text() {
        let pages: Vec<_> = (0..40)
            .map(|i| json!({ "title": format!("{i:03}{}", "w".repeat(MAX_LABEL_VALUE_CHARS)) }))
            .collect();
        let arguments = json!({ "pages": pages });
        let label = resolve_label(&hostile_mapping(), &arguments);
        assert_eq!(
            label,
            Err(UnresolvedPointer {
                item: 0,
                part: "before"
            })
        );

        let item = ToolCallLabelItemMapping {
            title: Some("/pages/*/title".into()),
            id: Some("/pages".into()),
            target: Some("/pages/*/title".into()),
            fields: vec!["/pages/*/title".into(); MAX_LABEL_FIELDS],
            ..Default::default()
        };
        let mapping = ToolCallLabelMapping {
            items: vec![item; MAX_LABEL_ITEMS],
            ..create_rows()
        };
        let label = resolve_label(&mapping, &arguments).unwrap();
        let slots: Vec<_> = label
            .items
            .iter()
            .flat_map(|item| {
                [&item.title, &item.id, &item.target]
                    .into_iter()
                    .flatten()
                    .chain(&item.fields)
            })
            .collect();
        let kept: usize = slots
            .iter()
            .flat_map(|slot| &slot.values)
            .map(|value| value.text.len() + value.path.len())
            .sum();
        assert!(kept <= MAX_LABEL_VALUE_BYTES, "{kept}");
        let shown: usize = slots.iter().map(|slot| slot.values.len()).sum();
        let omitted: u32 = slots.iter().map(|slot| slot.omitted).sum();
        assert_eq!(shown + omitted as usize, slots.len() * 40);
        assert!(slots.last().unwrap().values.is_empty());
        let first = label.items[0].title.as_ref().unwrap();
        assert_eq!(first.values.len(), MAX_SLOT_VALUES);
        assert!(first.values.iter().all(|value| value.truncated));
        let id = label.items[0].id.as_ref().unwrap();
        assert!(id.values[0].text.starts_with(r#"{"title":"000"#));
    }

    #[test]
    fn whole_objects_are_cut_before_they_are_written_out() {
        let big = json!({ "a": "x".repeat(4 * 1024 * 1024), "b": [1, 2, 3] });
        let (json, cut) = json_prefix(&big, 100);
        assert!(cut && json.len() == 100 && json.starts_with(r#"{"a":"xxx"#));
        let (json, cut) = json_prefix(&json!({"name": "ä€😀"}), 13);
        assert_eq!((json.as_str(), cut), (r#"{"name":"ä"#, true));
        let (json, cut) = json_prefix(&json!([1, {"b": null}]), 100);
        assert_eq!((json.as_str(), cut), (r#"[1,{"b":null}]"#, false));

        let value = label_value("/blob".into(), &big, &mut false).unwrap();
        assert!(value.truncated);
        assert_eq!(value.text.chars().count(), MAX_LABEL_VALUE_CHARS);
        let hidden =
            json!({ "k": format!("{}visible", "\u{200B}".repeat(MAX_LABEL_VALUE_CHARS * 4)) });
        let value = label_value("/k".into(), &hidden, &mut false).unwrap();
        assert!(value.truncated && !value.text.contains('\u{200B}'));
    }

    #[test]
    fn field_pointers_and_names_are_bounded_and_never_blank() {
        let arguments = json!({ "": "empty key", "\u{200B}": "invisible key", "stage": "Lead" });
        let mut fields = vec!["/missing".to_string(); MAX_FIELD_POINTERS];
        fields.push("/stage".into());
        let mapping = ToolCallLabelMapping {
            items: vec![ToolCallLabelItemMapping {
                fields,
                ..Default::default()
            }],
            ..create_rows()
        };
        let label = resolve_label(&mapping, &arguments).unwrap();
        assert!(label.items[0].fields.is_empty());

        let mapping = ToolCallLabelMapping {
            items: vec![ToolCallLabelItemMapping {
                fields: vec!["/".into(), "/\u{200B}".into(), "/stage".into()],
                ..Default::default()
            }],
            ..create_rows()
        };
        let label = resolve_label(&mapping, &arguments).unwrap();
        let names: Vec<_> = label.items[0]
            .fields
            .iter()
            .map(|field| field.name.as_deref())
            .collect();
        assert_eq!(names, [None, None, Some("stage")]);
        assert_eq!(texts(&label.items[0].fields[1]), ["invisible key"]);
        assert_eq!(label.warnings, [ToolCallLabelWarning::HiddenCharacters]);
    }

    #[test]
    fn a_labeller_that_panics_costs_only_the_label() {
        let arguments = json!({"title": "Plan"});
        assert_eq!(
            guarded(|| generic_label(&arguments)),
            Some(generic_label(&arguments))
        );
        assert_eq!(guarded(|| panic!("a labeller bug")), None);
    }

    #[test]
    fn a_stored_label_this_version_cannot_read_drops_only_the_label() {
        for broken in [
            json!("a string"),
            json!(42),
            json!([]),
            json!({}),
            json!({"action": "create", "object_kind": "row", "source": "rules", "items": {"a": 1}}),
            json!({"action": "create", "object_kind": "row", "source": "rules",
                   "items": [{"title": {"pointer": "/t", "values": [{"path": "/t", "text": 5}]}}]}),
            json!({"action": "other", "object_kind": "other", "source": "generic",
                   "arguments": {"path": "", "kind": "group", "omitted": -1}}),
            json!({"action": ["create"], "object_kind": "row", "source": "rules"}),
        ] {
            let parsed: ToolDisplayMetadata = serde_json::from_value(json!({
                "title": "Create pages",
                "description_truncated": false,
                "server_name": "Notion",
                "label": broken,
            }))
            .unwrap_or_else(|error| panic!("{broken}: {error}"));
            assert_eq!(parsed.label, None, "{broken}");
            assert_eq!(parsed.server_name.as_deref(), Some("Notion"));
        }
        let null: ToolDisplayMetadata = serde_json::from_value(
            json!({"title": "Create pages", "description_truncated": false, "label": null}),
        )
        .unwrap();
        assert_eq!(null.label, None);
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
}
