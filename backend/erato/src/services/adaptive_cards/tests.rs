use super::*;
use crate::models::message::ToolCallStatus;
use serde_json::json;

const CALLS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../frontend/src/lib/toolCallGist/fixtures/spokenCards/calls.json"
));

#[derive(Deserialize)]
struct Fixtures {
    calls: Vec<Call>,
}

#[derive(Deserialize)]
struct Call {
    id: String,
    tool_name: String,
    server_id: String,
    input: Value,
    display: ToolDisplayMetadata,
}

const ELEMENT_TYPES: &[&str] = &[
    "RichTextBlock",
    "ColumnSet",
    "Column",
    "Container",
    "ActionSet",
];
const ACTION_TYPES: &[&str] = &["Action.ToggleVisibility", "Action.OpenUrl"];

/// Server text may only reach a card as a `TextRun`, which Teams never reads
/// as Markdown, and a link only as an https `Action.OpenUrl`.
fn assert_inert(value: &Value, path: &str) {
    match value {
        Value::Array(items) => items
            .iter()
            .enumerate()
            .for_each(|(i, item)| assert_inert(item, &format!("{path}[{i}]"))),
        Value::Object(map) => {
            if let Some(kind) = map.get("type").and_then(Value::as_str) {
                let allowed = ELEMENT_TYPES.contains(&kind)
                    || ACTION_TYPES.contains(&kind)
                    || kind == "TextRun";
                assert!(allowed, "{path}: {kind} is not an allowed element");
                if kind == "Action.OpenUrl" {
                    let url = map["url"].as_str().unwrap_or_default();
                    assert!(url.starts_with("https://"), "{path}: {url}");
                }
            }
            if map.contains_key("text") {
                assert_eq!(
                    map.get("type").and_then(Value::as_str),
                    Some("TextRun"),
                    "{path}"
                );
            }
            map.iter()
                .for_each(|(key, item)| assert_inert(item, &format!("{path}.{key}")));
        }
        _ => {}
    }
}

#[tokio::test]
async fn every_fixture_call_renders_as_the_web_card_in_english_and_german() {
    let fixtures: Fixtures = serde_json::from_str(CALLS).unwrap();
    assert!(fixtures.calls.len() >= 50);
    for locale in ["en", "de"] {
        for call in &fixtures.calls {
            let card = approval_item(&ApprovalItemRequest {
                locale,
                tool_name: &call.tool_name,
                display: Some(&call.display),
                input: &call.input,
                server_id: &call.server_id,
                id_prefix: "i0",
            })
            .await
            .unwrap_or_else(|error| panic!("{locale}/{}: {error}", call.id));
            assert_eq!(card.errors, Vec::<String>::new(), "{locale}/{}", call.id);
            assert_ne!(card.kind, CardKind::Legacy, "{locale}/{}", call.id);
            assert_eq!(card.locale, locale);
            assert!(!card.referent.is_empty(), "{locale}/{}", call.id);
            assert!(!card.summary.is_empty(), "{locale}/{}", call.id);
            assert_inert(&json!([card.referent, card.details]), &call.id);
        }
    }
}

#[tokio::test]
async fn a_german_card_asks_in_german() {
    let fixtures: Fixtures = serde_json::from_str(CALLS).unwrap();
    let call = fixtures
        .calls
        .iter()
        .find(|call| call.id == "update-06-many-fields")
        .unwrap();
    let card = approval_item(&ApprovalItemRequest {
        locale: "de",
        tool_name: &call.tool_name,
        display: Some(&call.display),
        input: &call.input,
        server_id: &call.server_id,
        id_prefix: "i0",
    })
    .await
    .unwrap();
    assert_eq!(card.question, "Aktion in Dynamics 365 ausführen?");
    assert_eq!(card.kind, CardKind::Gist);
    assert!(card.summary.contains("Line 4 Retrofit"), "{}", card.summary);
}

#[tokio::test]
async fn a_call_without_a_label_keeps_the_card_it_had() {
    let card = approval_item(&ApprovalItemRequest {
        locale: "en",
        tool_name: "search",
        display: None,
        input: &json!({"q": "x"}),
        server_id: "web",
        id_prefix: "i0",
    })
    .await
    .unwrap();
    assert_eq!(card.kind, CardKind::Legacy);
}

#[tokio::test]
async fn a_finished_call_reads_as_the_web_trace_row() {
    let fixtures: Fixtures = serde_json::from_str(CALLS).unwrap();
    let call = fixtures
        .calls
        .iter()
        .find(|call| call.id == "create-01-task-long-description")
        .unwrap();
    let part: ToolUse = serde_json::from_value(json!({
        "tool_call_id": "call-1",
        "status": "success",
        "tool_name": call.tool_name,
        "display": call.display,
        "progress_message": null,
        "input": call.input,
        "output": {"ok": true},
    }))
    .unwrap();
    assert_eq!(part.status, ToolCallStatus::Success);
    let row = result_row(&ResultRowRequest {
        locale: "en",
        part: &part,
        id_prefix: "r0",
    })
    .await
    .unwrap();
    assert_eq!(row.errors, Vec::<String>::new());
    let text = serde_json::to_string(&row.elements).unwrap();
    assert!(text.contains("Created task"), "{text}");
    assert_inert(&json!(row.elements), "row");
}

#[tokio::test]
async fn an_oversized_request_is_refused_before_it_reaches_the_renderer() {
    let huge = json!({"text": "x".repeat(MAX_REQUEST_BYTES)});
    let error = approval_item(&ApprovalItemRequest {
        locale: "en",
        tool_name: "t",
        display: None,
        input: &huge,
        server_id: "s",
        id_prefix: "i0",
    })
    .await
    .unwrap_err();
    assert_eq!(error, CardError::TooLarge);
}
