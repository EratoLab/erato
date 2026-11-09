//! What a choice value such as `2` means, read from the tool's own schema: an
//! enum with names, a list of constants with titles, or an explicit list in a
//! description such as `0 = None, 1 = Urgent`. Server text is only ever a
//! claim the card marks as the tool's, so it is capped and never interpreted;
//! a list that contradicts itself says nothing, and nothing is guessed.

use super::context::text_prefix;
use super::machine_id::is_machine_id;
use super::recipients::is_phone_shaped;
use crate::services::display_text::sanitize_display_text;
use rmcp::model::JsonObject;
use serde_json::{Map, Value};

/// A label longer than this is a sentence, not the name of a choice.
pub(super) const MAX_CHOICE_LABEL_CHARS: usize = 64;
const MAX_DESCRIPTION_BYTES: usize = 2 * 1024;
const MAX_LIST_ENTRIES: usize = 64;
const MAX_SCHEMA_DEPTH: usize = 8;
const MAX_VARIANTS: usize = 32;

/// Whether a value can be a choice code at all. Recipients, addresses, phone
/// numbers and machine IDs never get a meaning.
pub(super) fn is_choice_code(code: &str) -> bool {
    code.len() <= 64
        && !code.is_empty()
        && !code.contains(char::is_whitespace)
        && !code.contains(['@', '/'])
        && !is_machine_id(code)
        && !is_phone_shaped(code)
}

/// What the tool's own schema says `code` means for the member at `path`.
pub(super) fn schema_choice_label(schema: &JsonObject, path: &str, code: &str) -> Option<String> {
    let property = property_at(schema, path)?;
    listed_choice(property, code)
        .or_else(|| described_choice(property.get("description")?.as_str()?, code))
}

fn property_at<'a>(schema: &'a Map<String, Value>, path: &str) -> Option<&'a Map<String, Value>> {
    let mut current = schema;
    for (depth, segment) in path.strip_prefix('/')?.split('/').enumerate() {
        if depth >= MAX_SCHEMA_DEPTH {
            return None;
        }
        current = member_of(current, segment)?;
    }
    Some(current)
}

/// The schema of `segment` under `object`, through `anyOf` and the like, or
/// of an array's items when `segment` is an index.
fn member_of<'a>(object: &'a Map<String, Value>, segment: &str) -> Option<&'a Map<String, Value>> {
    let name = segment.replace("~1", "/").replace("~0", "~");
    let found = object
        .get("properties")
        .and_then(Value::as_object)
        .and_then(|properties| properties.get(&name))
        .and_then(Value::as_object)
        .or_else(|| {
            let is_index = segment.chars().all(|c| c.is_ascii_digit());
            is_index
                .then(|| object.get("items").and_then(Value::as_object))
                .flatten()
        });
    found.or_else(|| {
        ["allOf", "anyOf", "oneOf"].iter().find_map(|combiner| {
            object
                .get(*combiner)?
                .as_array()?
                .iter()
                .take(MAX_VARIANTS)
                .filter_map(Value::as_object)
                .find_map(|variant| member_of(variant, segment))
        })
    })
}

fn same_choice(value: &Value, code: &str) -> bool {
    match value {
        Value::String(text) => text == code,
        Value::Number(number) => number.to_string() == code,
        _ => false,
    }
}

fn label_from(text: &str) -> Option<String> {
    let cleaned = sanitize_display_text(text_prefix(text, 512), MAX_CHOICE_LABEL_CHARS);
    (!cleaned.hidden_characters && !cleaned.truncated && !cleaned.text.trim().is_empty())
        .then_some(cleaned.text)
}

/// An enum with names beside it, or constants with titles.
fn listed_choice(property: &Map<String, Value>, code: &str) -> Option<String> {
    if let Some(values) = property.get("enum").and_then(Value::as_array) {
        let names = ["enumNames", "x-enumNames"]
            .iter()
            .find_map(|key| property.get(*key)?.as_array());
        let at = values.iter().position(|value| same_choice(value, code));
        if let (Some(names), Some(at)) = (names, at)
            && names.len() == values.len()
        {
            return names.get(at)?.as_str().and_then(label_from);
        }
    }
    ["oneOf", "anyOf"].iter().find_map(|combiner| {
        property
            .get(*combiner)?
            .as_array()?
            .iter()
            .take(MAX_VARIANTS)
            .filter_map(Value::as_object)
            .find(|variant| constant_of(variant).is_some_and(|value| same_choice(value, code)))
            .and_then(|variant| {
                variant
                    .get("title")
                    .or_else(|| variant.get("description"))
                    .and_then(Value::as_str)
            })
            .and_then(label_from)
    })
}

fn constant_of(variant: &Map<String, Value>) -> Option<&Value> {
    variant
        .get("const")
        .or_else(|| match variant.get("enum")?.as_array()?.as_slice() {
            [only] => Some(only),
            _ => None,
        })
}

/// One entry of `0 = None, 1 = Urgent` or `1: Urgent`, its label cut before
/// any sentence that follows it.
fn entry_of(part: &str) -> Option<(&str, String)> {
    let part = part.trim_start_matches(|c: char| c.is_whitespace() || matches!(c, '-' | '*'));
    let code_end = part
        .find(|c: char| !c.is_ascii_digit())
        .filter(|end| (1..=6).contains(end))?;
    let (code, rest) = part.split_at(code_end);
    let label = rest.trim_start().strip_prefix(['=', ':'])?.trim();
    let label = label
        .split(". ")
        .next()
        .unwrap_or(label)
        .trim_end_matches('.');
    let label = label_from(label.trim())?;
    (!label.contains(['=', ':']) && label.chars().any(char::is_alphabetic)).then_some((code, label))
}

/// The code's label in the description's explicit list. A list needs two
/// entries, every part of it must read as an entry, and a code listed twice
/// with different labels makes the whole list say nothing.
fn described_choice(description: &str, code: &str) -> Option<String> {
    let text = text_prefix(description, MAX_DESCRIPTION_BYTES);
    let start = list_start(text)?;
    let mut entries: Vec<(&str, String)> = Vec::new();
    for part in text[start..].split([',', ';', '\n']).take(MAX_LIST_ENTRIES) {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        let Some(entry) = entry_of(part) else {
            break;
        };
        entries.push(entry);
    }
    if entries.len() < 2 {
        return None;
    }
    let mut found = None;
    for (listed, label) in &entries {
        if entries
            .iter()
            .any(|(other, other_label)| other == listed && other_label != label)
        {
            return None;
        }
        if *listed == code {
            found = Some(label.clone());
        }
    }
    found
}

/// Where the list starts: the first `<number> =` or `<number>:` that follows
/// a space or the start of the text.
fn list_start(text: &str) -> Option<usize> {
    for (at, c) in text.char_indices() {
        if !c.is_ascii_digit() {
            continue;
        }
        let standalone = text[..at]
            .chars()
            .next_back()
            .is_none_or(|before| before.is_whitespace() || matches!(before, '(' | '-' | '*'));
        let part = text[at..]
            .split([',', ';', '\n'])
            .next()
            .unwrap_or_default();
        if standalone && entry_of(part).is_some() {
            return Some(at);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn schema_with(property: Value) -> JsonObject {
        json!({"type": "object", "properties": {"priority": property}})
            .as_object()
            .unwrap()
            .clone()
    }

    fn label_of(property: Value, code: &str) -> Option<String> {
        schema_choice_label(&schema_with(property), "/priority", code)
    }

    #[test]
    fn an_enum_with_names_gives_the_meaning() {
        let property = json!({"enum": [0, 1, 2], "enumNames": ["None", "Urgent", "High"]});
        assert_eq!(label_of(property.clone(), "1").as_deref(), Some("Urgent"));
        assert_eq!(label_of(property, "7"), None);
        let mismatched = json!({"enum": [0, 1], "enumNames": ["None"]});
        assert_eq!(label_of(mismatched, "0"), None);
        let strings = json!({"enum": ["open", "done"], "x-enumNames": ["Open", "Done"]});
        assert_eq!(label_of(strings, "done").as_deref(), Some("Done"));
    }

    #[test]
    fn constants_with_titles_give_the_meaning() {
        let property = json!({"oneOf": [
            {"const": 1, "title": "Urgent"},
            {"enum": [2], "title": "High"},
            {"const": 3},
        ]});
        assert_eq!(label_of(property.clone(), "2").as_deref(), Some("High"));
        assert_eq!(label_of(property, "3"), None);
    }

    #[test]
    fn an_explicit_list_in_the_description_gives_the_meaning() {
        for description in [
            "0=None, 1=Urgent, 2=High, 3=Medium, 4=Low",
            "Priority level: 0 = None, 1 = Urgent, 2 = High",
            "- 1: Urgent\n- 2: High\n- 0: None",
        ] {
            let property = json!({"type": "number", "description": description});
            assert_eq!(
                label_of(property, "1").as_deref(),
                Some("Urgent"),
                "{description}"
            );
        }
    }

    #[test]
    fn a_description_that_is_no_explicit_list_says_nothing() {
        for description in [
            "Priority from 0 to 4",
            "1 = Urgent",
            "Use 1 for urgent and 2 for high",
            "Between 1: and 2: values",
            "Set 4 = Low. Other values are ignored. 2 = High.",
        ] {
            let property = json!({"description": description});
            assert_eq!(label_of(property, "2"), None, "{description}");
        }
        let contradicting = json!({"description": "0 = None, 1 = Urgent, 0 = Blocker"});
        assert_eq!(label_of(contradicting.clone(), "0"), None);
        assert_eq!(label_of(contradicting, "1"), None);
    }

    #[test]
    fn hidden_characters_or_sentences_are_no_labels() {
        let hidden = json!({"description": "1 = Ur\u{202E}gent, 2 = High"});
        assert_eq!(label_of(hidden, "1"), None);
        let long = "x".repeat(MAX_CHOICE_LABEL_CHARS + 1);
        let property = json!({"enum": [1], "enumNames": [long]});
        assert_eq!(label_of(property, "1"), None);
    }

    #[test]
    fn nested_and_array_members_are_found_through_the_schema() {
        let schema = json!({"properties": {
            "item": {"properties": {"priority": {"description": "1=Urgent, 2=High"}}},
            "rows": {"items": {"properties": {"priority": {"enum": [1], "enumNames": ["Urgent"]}}}},
            "either": {"anyOf": [{"properties": {"priority": {"enum": [9], "enumNames": ["Nine"]}}}]},
        }})
        .as_object()
        .unwrap()
        .clone();
        assert_eq!(
            schema_choice_label(&schema, "/item/priority", "2").as_deref(),
            Some("High")
        );
        assert_eq!(
            schema_choice_label(&schema, "/rows/3/priority", "1").as_deref(),
            Some("Urgent")
        );
        assert_eq!(
            schema_choice_label(&schema, "/either/priority", "9").as_deref(),
            Some("Nine")
        );
        assert_eq!(schema_choice_label(&schema, "/missing/priority", "1"), None);
    }

    #[test]
    fn ids_addresses_and_phone_numbers_are_no_codes() {
        assert!(is_choice_code("4"));
        assert!(is_choice_code("open"));
        assert!(!is_choice_code("aaaaaaaa-0000-4000-8000-0000000000a1"));
        assert!(!is_choice_code("a@example.com"));
        assert!(!is_choice_code("+49 170 1234567"));
        assert!(!is_choice_code("with space"));
        assert!(!is_choice_code(""));
    }
}
