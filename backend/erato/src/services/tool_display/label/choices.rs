//! What a choice value such as `2` means, read from the tool's own schema: an
//! enum with names, a list of constants with titles, or an explicit list in a
//! description such as `0 = None, 1 = Urgent` or `None (0), Urgent (1)`.
//! Server text is only ever a claim the card marks as the tool's, so it is
//! capped and never interpreted; a list that contradicts itself says nothing,
//! and nothing is guessed.

use super::context::text_prefix;
use super::machine_id::is_machine_id;
use super::recipients::is_phone_shaped;
use crate::services::display_text::sanitize_display_text;
use rmcp::model::JsonObject;
use serde_json::{Map, Value};
use std::collections::HashSet;

pub(super) use erato_config::config::MAX_CHOICE_LABEL_CHARS;
const MAX_DESCRIPTION_BYTES: usize = 2 * 1024;
const MAX_LIST_ENTRIES: usize = 64;
/// Parts of a text looked at for a `Label (code)` list, prose before it included.
const MAX_LIST_PARTS: usize = 1_024;
/// Digits a `Label (code)` code has at most: option values such as
/// `727000001` run to nine.
const MAX_LABELLED_CODE_DIGITS: usize = 10;
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
    if found.is_some() {
        return found;
    }
    // Variants may each number the member their own way: only one that is
    // alone in holding it says what it is.
    let mut held = ["allOf", "anyOf", "oneOf"]
        .iter()
        .filter_map(|combiner| object.get(*combiner)?.as_array())
        .flat_map(|variants| variants.iter().take(MAX_VARIANTS))
        .filter_map(Value::as_object)
        .filter_map(|variant| member_of(variant, segment));
    match (held.next(), held.next()) {
        (Some(only), None) => Some(only),
        _ => None,
    }
}

fn same_choice(value: &Value, code: &str) -> bool {
    match value {
        Value::String(text) => text == code,
        Value::Number(number) => number.to_string() == code,
        _ => false,
    }
}

/// A label a card may show beside its code: short, with no hidden
/// characters, and never a machine ID, a phone number, a link or an address.
/// Anything else says nothing; it is never cut or cleaned into a label.
pub(super) fn choice_label(text: &str) -> Option<String> {
    let cleaned = sanitize_display_text(text_prefix(text, 512), MAX_CHOICE_LABEL_CHARS);
    let label = cleaned.text.trim();
    let usable = !cleaned.hidden_characters
        && !cleaned.truncated
        && !label.is_empty()
        && !is_machine_id(label)
        && !is_phone_shaped(label)
        && !label.contains('@')
        && !label.contains("://")
        && label
            .get(..4)
            .is_none_or(|start| !start.eq_ignore_ascii_case("www."));
    usable.then(|| label.to_string())
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
            return names.get(at)?.as_str().and_then(choice_label);
        }
    }
    let mut titled = ["oneOf", "anyOf"]
        .iter()
        .filter_map(|combiner| property.get(*combiner)?.as_array())
        .flat_map(|variants| variants.iter().take(MAX_VARIANTS))
        .filter_map(Value::as_object)
        .filter(|variant| constant_of(variant).is_some_and(|value| same_choice(value, code)))
        .map(|variant| {
            variant
                .get("title")
                .or_else(|| variant.get("description"))
                .and_then(Value::as_str)
                .and_then(choice_label)
        });
    match (titled.next(), titled.next()) {
        (Some(only), None) => only,
        _ => None,
    }
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
    let part = without_bullet(part);
    let code_end = part
        .find(|c: char| !c.is_ascii_digit())
        .filter(|end| (1..=6).contains(end))?;
    let (code, rest) = part.split_at(code_end);
    let label = rest.trim_start().strip_prefix(['=', ':'])?.trim();
    // Past this no first sentence is short enough to be a label.
    let label = text_prefix(label, 1024);
    let label = label
        .split(". ")
        .next()
        .unwrap_or(label)
        .trim_end_matches('.');
    let label = choice_label(label.trim())?;
    (!label.contains(['=', ':']) && label.chars().any(char::is_alphabetic)).then_some((code, label))
}

/// `part` without a leading `- ` or `* `. A `-` right before a digit is the
/// number's sign.
fn without_bullet(part: &str) -> &str {
    let part = part.trim_start();
    match part.strip_prefix(['-', '*']) {
        Some(rest) if rest.starts_with(char::is_whitespace) => rest.trim_start(),
        _ => part,
    }
}

/// The code's label in the description's explicit list.
fn described_choice(description: &str, code: &str) -> Option<String> {
    let text = text_prefix(description, MAX_DESCRIPTION_BYTES);
    described_list(text, MAX_LIST_ENTRIES)?
        .into_iter()
        .find(|(listed, _)| listed == code)
        .map(|(_, label)| label)
}

/// The explicit list of codes and labels `text` holds, as `0 = None, 1 =
/// Urgent` or as `None (0), Urgent (1)`. A text holding both says nothing:
/// which one the member follows is not known.
pub(super) fn described_list(text: &str, max_entries: usize) -> Option<Vec<(String, String)>> {
    match (
        equals_list(text, max_entries),
        labelled_list(text, max_entries),
    ) {
        (Some(list), None) | (None, Some(list)) => Some(list),
        _ => None,
    }
}

/// A `0 = None, 1 = Urgent` list. It needs two entries, every part of it
/// must read as an entry, and a code listed twice with different labels makes
/// the whole list say nothing.
fn equals_list(text: &str, max_entries: usize) -> Option<Vec<(String, String)>> {
    let start = list_start(text)?;
    let mut entries: Vec<(&str, String)> = Vec::new();
    for part in text[start..].split([',', ';', '\n']).take(max_entries) {
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
    for (listed, label) in &entries {
        if entries
            .iter()
            .any(|(other, other_label)| other == listed && other_label != label)
        {
            return None;
        }
    }
    Some(
        entries
            .into_iter()
            .map(|(code, label)| (code.to_string(), label))
            .collect(),
    )
}

/// One part of a `Low (0), Normal (1), High (2)` list.
struct LabelledEntry {
    code: String,
    label: String,
    /// Text before the label ends in `:` or `(`, as in `(Options: Low (0)`:
    /// a list starts here.
    opens: bool,
    /// A bracket after the code closes the list, as in `High (2))`.
    closes: bool,
}

/// `Label (code)`, its code an integer, its label after any `:` or `(` that
/// opens the list.
fn labelled_entry(part: &str) -> Option<LabelledEntry> {
    let part = part.trim().trim_end_matches('.').trim_end();
    let inner = part.strip_suffix(')')?;
    let unclosed = inner.trim_end_matches(')');
    let closes = unclosed.len() < inner.len();
    let open = unclosed.rfind('(')?;
    let code = unclosed[open + 1..].trim();
    let digits = code.strip_prefix('-').unwrap_or(code);
    if digits.is_empty()
        || digits.len() > MAX_LABELLED_CODE_DIGITS
        || !digits.bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    let code = code.parse::<i64>().ok()?.to_string();
    let before = unclosed[..open].trim_end();
    let intro = before.rfind([':', '(']);
    let label = match intro {
        Some(at) => &before[at + 1..],
        None => without_bullet(before),
    }
    .trim();
    // `https://…` holds a `:` that opens no list.
    if label.contains(['=', ':', '(', ')'])
        || label.starts_with('/')
        || !label.chars().any(char::is_alphabetic)
    {
        return None;
    }
    Some(LabelledEntry {
        code,
        label: choice_label(label)?,
        opens: intro.is_some(),
        closes,
    })
}

/// The first `Label (code)` list in `text`: two or more entries in a row,
/// the first right after a `:` or `(` or alone on its line, the list ending
/// at the bracket that closes it or the first part that is no entry. Prose
/// such as `the count (0), or an error (1)` opens no list, and a code listed
/// twice makes the list say nothing.
fn labelled_list(text: &str, max_entries: usize) -> Option<Vec<(String, String)>> {
    let mut run: Vec<(String, String)> = Vec::new();
    let mut line_start = true;
    let mut rest = text;
    for _ in 0..MAX_LIST_PARTS {
        let end = rest.find([',', ';', '\n']).unwrap_or(rest.len());
        let (part, separator) = (&rest[..end], rest[end..].chars().next());
        if !part.trim().is_empty() {
            let whole_line = line_start && separator.is_none_or(|c| c == '\n');
            match labelled_entry(part) {
                Some(entry) if !entry.opens && !run.is_empty() => {
                    run.push((entry.code, entry.label));
                    if entry.closes {
                        break;
                    }
                }
                Some(entry) if entry.opens || whole_line => {
                    if run.len() >= 2 {
                        break;
                    }
                    run = vec![(entry.code, entry.label)];
                    if entry.closes {
                        run.clear();
                    }
                }
                _ if run.len() >= 2 => break,
                _ => run.clear(),
            }
            if run.len() > max_entries {
                return None;
            }
        }
        line_start = separator == Some('\n');
        match separator {
            Some(separator) => rest = &rest[end + separator.len_utf8()..],
            None => break,
        }
    }
    let mut codes = HashSet::new();
    (run.len() >= 2 && run.iter().all(|(code, _)| codes.insert(code.as_str()))).then_some(run)
}

/// Where the list starts: the first `<number> =` or `<number>:` that follows
/// a space or the start of the text. Each part's end is found once, so a long
/// line of digits costs its length, not its square.
fn list_start(text: &str) -> Option<usize> {
    let mut part_end = 0;
    for (at, c) in text.char_indices() {
        if at >= part_end {
            part_end = text[at..]
                .find([',', ';', '\n'])
                .map_or(text.len(), |end| at + end.max(1));
        }
        if !c.is_ascii_digit() {
            continue;
        }
        let standalone = text[..at]
            .chars()
            .next_back()
            .is_none_or(|before| before.is_whitespace() || before == '(');
        let part = &text[at..part_end.max(at)];
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
    fn variants_that_number_a_member_differently_say_nothing() {
        let schema = json!({"properties": {"either": {"oneOf": [
            {"properties": {"priority": {"description": "1=Blocker, 2=Minor"}}},
            {"properties": {"priority": {"description": "1=Low, 2=High"}}},
        ]}}})
        .as_object()
        .unwrap()
        .clone();
        assert_eq!(schema_choice_label(&schema, "/either/priority", "1"), None);
        let twice = json!({"oneOf": [
            {"const": 1, "title": "Urgent"},
            {"const": 1, "title": "Low"},
        ]});
        assert_eq!(label_of(twice, "1"), None);
    }

    #[test]
    fn a_minus_before_a_digit_is_its_sign_and_no_bullet() {
        let property = json!({"description": "-1 = Inherit, 0 = None, 2 = High"});
        assert_eq!(label_of(property.clone(), "1"), None);
        assert_eq!(label_of(property, "2").as_deref(), Some("High"));
        let bullets = json!({"description": "* 1: Urgent\n*  2: High"});
        assert_eq!(label_of(bullets, "2").as_deref(), Some("High"));
    }

    #[test]
    fn a_list_of_labels_with_their_codes_gives_the_meaning() {
        for description in [
            "Priority (Options: Low (0), Normal (1), High (2))",
            "Priority. Valid options: Low (0), Normal (1), High (2).",
            "Low (1)\nNormal (2)",
            "One of:\n- Low (1)\n- Normal (2)\n- High (3)",
        ] {
            let property = json!({"type": "integer", "description": description});
            assert_eq!(
                label_of(property, "1").as_deref(),
                Some(if description.contains("(0)") {
                    "Normal"
                } else {
                    "Low"
                }),
                "{description}"
            );
        }
        let signed = json!({"description": "Inherit (-1), None (0), Medium (727000001)"});
        assert_eq!(label_of(signed.clone(), "-1"), None);
        let signed = json!({"description": "Set: Inherit (-1), None (0), Medium (727000001)"});
        assert_eq!(label_of(signed.clone(), "-1").as_deref(), Some("Inherit"));
        assert_eq!(label_of(signed, "727000001").as_deref(), Some("Medium"));
    }

    #[test]
    fn labels_with_codes_say_nothing_without_a_real_list() {
        for description in [
            "Options: Low (0)",
            "Returns the count (0), or an error (1)",
            "Options: Low (1), High (1)",
            "Options: Low (1), Urgent (2); 1 = High, 2 = Low",
            "Options: Low (1.5), High (2.5)",
        ] {
            let property = json!({"description": description});
            assert_eq!(label_of(property, "1"), None, "{description}");
        }
        // A list ends at the bracket that closes it.
        let lines =
            "CHOICE (Options: Low (0), High (1)),\n  other INT (Valid Options: Off (0), On (1))";
        assert_eq!(
            described_list(lines, MAX_LIST_ENTRIES),
            Some(vec![
                ("0".to_string(), "Low".to_string()),
                ("1".to_string(), "High".to_string()),
            ])
        );
    }

    #[test]
    fn a_label_that_is_an_id_a_link_a_number_or_hidden_text_is_no_label() {
        let long = "x".repeat(MAX_CHOICE_LABEL_CHARS + 1);
        for bad in [
            long.as_str(),
            "aaaaaaaa-0000-4000-8000-0000000000a1",
            "+49 30 5550100",
            "helpdesk@example.com",
            "https://example.com/x",
            "www.example.com",
            "Hi\u{202E}gh",
            " ",
        ] {
            assert_eq!(choice_label(bad), None, "{bad}");
            let description = format!("Options: {bad} (1), Low (2), High (3)");
            assert_eq!(label_of(json!({"description": description}), "1"), None);
        }
        assert_eq!(choice_label(" In Review ").as_deref(), Some("In Review"));
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
