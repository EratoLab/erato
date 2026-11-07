use super::*;
use crate::services::tool_display::label::pointer;
use genai::chat::ChatRole;

fn user_text(request: &LabelRequest) -> String {
    let message = request
        .chat_request
        .messages
        .iter()
        .find(|message| message.role == ChatRole::User)
        .unwrap();
    message.content.first_text().unwrap().to_string()
}

fn notes_call() -> Value {
    json!({
        "folder": {"folder_id": "f1"},
        "items": [{"name": "Plan", "body": format!("# Plan\n{}", "x".repeat(893)), "status": "draft"}],
    })
}

fn example_reply() -> &'static str {
    r#"{"action":"create","object_kind":"note","items":[{"title":"/items/*/name","fields":["/items/*/status"],"id":null,"target":"/folder/folder_id","before":null,"after":"/items/*/body"}]}"#
}

fn example_mapping() -> ToolCallLabelMapping {
    ToolCallLabelMapping {
        action: ToolCallAction::Create,
        object_kind: ToolCallObjectKind::Note,
        items: vec![ToolCallLabelItemMapping {
            title: Some("/items/*/name".into()),
            target: Some("/folder/folder_id".into()),
            after: Some("/items/*/body".into()),
            fields: vec!["/items/*/status".into()],
            ..Default::default()
        }],
        source: ToolCallLabelSource::Model,
    }
}

fn parse(reply: &str, arguments: &Value) -> Result<ToolCallLabelMapping, Report> {
    parse_reply(reply, arguments, &argument_paths(arguments))
}

#[test]
fn the_prompt_offers_exactly_the_closed_lists() {
    let actions = ACTIONS.map(wire_name).join(" | ");
    let kinds = OBJECT_KINDS.map(wire_name).join(" | ");
    assert!(
        LABEL_PROMPT.contains(&format!("action: {actions}.")),
        "{actions}"
    );
    assert!(
        LABEL_PROMPT.contains(&format!("object_kind: {kinds}.")),
        "{kinds}"
    );
    assert!(LABEL_PROMPT.contains(&format!("up to {MAX_LABEL_FIELDS} pointers")));
    assert!(LABEL_PROMPT.contains(&format!("at most {MAX_LABEL_ITEMS}")));
}

#[test]
fn a_request_shows_the_tool_a_skeleton_and_the_real_paths_and_no_description() {
    let request = build_request("notes-create-items", &notes_call()).unwrap();
    assert_eq!(
        request.paths,
        [
            "/folder",
            "/items",
            "/folder/folder_id",
            "/items/*",
            "/items/*/body",
            "/items/*/name",
            "/items/*/status",
        ]
    );
    let text = user_text(&request);
    let lines: Vec<_> = text.lines().collect();
    assert_eq!(lines.len(), 3, "{text}");
    assert_eq!(lines[0], "TOOL: notes-create-items");
    let shown: Value = serde_json::from_str(lines[1].strip_prefix("ARGUMENTS: ").unwrap()).unwrap();
    assert_eq!(
        shown,
        json!({"folder": {"folder_id": "f1"}, "items": [
            {"name": "Plan", "body": r"<str len=900 start='# Plan\nxxxxx'>", "status": "draft"},
        ]})
    );
    let offered: Vec<String> =
        serde_json::from_str(lines[2].strip_prefix("PATHS: ").unwrap()).unwrap();
    assert_eq!(offered, request.paths);
    let system = &request.chat_request.messages[0];
    assert_eq!(system.role, ChatRole::System);
    assert_eq!(system.content.first_text(), Some(LABEL_PROMPT));
    assert_eq!(request.chat_request.messages.len(), 2);

    let item = &request.schema["properties"]["items"]["items"]["properties"];
    for part in ["title", "id", "target", "before", "after"] {
        assert_eq!(
            item[part]["anyOf"][0]["enum"],
            json!(request.paths),
            "{part}"
        );
    }
    assert_eq!(item["fields"]["items"]["enum"], json!(request.paths));
    assert_eq!(item["fields"]["maxItems"], MAX_LABEL_FIELDS);
    assert_eq!(
        request.schema["properties"]["action"]["enum"],
        json!(ACTIONS.map(wire_name))
    );
}

#[test]
fn the_skeleton_keeps_short_values_and_cuts_long_text_and_arrays() {
    let rows: Vec<_> = (0..5).map(|index| json!({"n": index})).collect();
    let skeleton = skeleton(&json!({
        "short": "exactly twenty-four char",
        "long": "exactly twenty-five chars",
        "quote": "it's a \\ path and a longer text",
        "rows": rows,
        "flags": [true, null, 1.5],
    }));
    assert_eq!(
        skeleton,
        json!({
            "short": "exactly twenty-four char",
            "long": "<str len=25 start='exactly twen'>",
            "quote": r"<str len=31 start='it\'s a \\ pat'>",
            "rows": [{"n": 0}, {"n": 1}, {"n": 2}, "<+2 more>"],
            "flags": [true, null, 1.5],
        })
    );
}

#[test]
fn paths_are_shallow_first_real_and_capped() {
    let paths = argument_paths(&json!({
        "b": {"c/d": 1, "e~": []},
        "a": [[{"x": 1}], []],
        "empty": [],
    }));
    assert_eq!(
        paths,
        [
            "/a", "/b", "/empty", "/a/*", "/b/c~1d", "/b/e~0", "/a/*/*", "/a/*/*/x"
        ]
    );
    for path in &paths {
        assert!(
            !pointer::resolve(
                &json!({"b": {"c/d": 1, "e~": []}, "a": [[{"x": 1}], []], "empty": []}),
                path
            )
            .is_empty()
        );
    }

    let wide: serde_json::Map<_, _> = (0..MAX_PATHS + 20)
        .map(|index| (format!("m{index:03}"), json!(index)))
        .collect();
    let paths = argument_paths(&Value::Object(wide));
    assert_eq!(paths.len(), MAX_PATHS);
    assert_eq!(paths[0], "/m000");

    let huge = "k".repeat(MAX_PATH_BYTES);
    let paths = argument_paths(&json!({ huge.clone(): {"inner": 1}, "query": "q" }));
    assert_eq!(paths, ["/query"]);

    let long: serde_json::Map<_, _> = (0..MAX_PATHS)
        .map(|index| (format!("{index:03}{}", "p".repeat(150)), json!(index)))
        .collect();
    let paths = argument_paths(&Value::Object(long));
    assert!(paths.iter().map(String::len).sum::<usize>() <= MAX_PATHS_BYTES);
    assert!(paths.len() < MAX_PATHS);
}

#[test]
fn a_call_with_nothing_to_point_at_or_too_large_to_send_is_not_sent() {
    assert!(build_request("crm_records", &json!({})).is_none());
    assert!(build_request("crm_records", &json!("text")).is_none());
    let wide: serde_json::Map<_, _> = (0..2_000)
        .map(|index| (format!("member_{index}"), json!(index)))
        .collect();
    assert!(build_request("crm_records", &Value::Object(wide)).is_none());
    let request = build_request("crm\u{202E}records\n", &json!({"recordId": "rec-1"})).unwrap();
    assert!(user_text(&request).starts_with("TOOL: crmrecords\nARGUMENTS:"));
}

#[test]
fn a_reply_maps_to_pointers_from_the_calls_paths() {
    let arguments = notes_call();
    assert_eq!(
        parse(example_reply(), &arguments).unwrap(),
        example_mapping()
    );
    let indexed = example_reply().replace("/items/*/name", "/items/0/name");
    assert_eq!(parse(&indexed, &arguments).unwrap(), example_mapping());
    let fenced = format!("```json\n{}\n```", example_reply());
    assert_eq!(parse(&fenced, &arguments).unwrap(), example_mapping());

    let cells = json!({"cells": {"1": "x"}, "rows": [{"1": "y"}]});
    let mapping = parse(
        r#"{"action":"update","object_kind":"row","items":[{"title":null,"id":"/cells/1","target":"/rows/0/1","before":null,"after":null,"fields":[]}]}"#,
        &cells,
    )
    .unwrap();
    assert_eq!(mapping.items[0].id.as_deref(), Some("/cells/1"));
    assert_eq!(mapping.items[0].target.as_deref(), Some("/rows/*/1"));
}

#[test]
fn a_reply_with_a_pointer_outside_the_paths_or_off_the_lists_is_rejected() {
    let arguments = json!({"folder": {"folder_id": "f1"}, "items": [], "name": "Plan"});
    let reply = |action: &str, kind: &str, title: &str| {
        format!(
            r#"{{"action":"{action}","object_kind":"{kind}","items":[{{"title":{title},"fields":[],"id":null,"target":null,"before":null,"after":null}}]}}"#
        )
    };
    assert!(parse(&reply("create", "note", r#""/name""#), &arguments).is_ok());
    for (reply, why) in [
        (reply("create", "note", r#""/title""#), "an invented path"),
        (reply("create", "note", r#""/items/*""#), "an empty array"),
        (reply("create", "note", r#""name""#), "not a pointer"),
        (
            reply("create", "note", r#""/folder/folder_id/x""#),
            "below a value",
        ),
        (
            reply("archive", "note", r#""/name""#),
            "an action off the list",
        ),
        (
            reply("create", "spreadsheet", r#""/name""#),
            "a kind off the list",
        ),
        (reply("Create", "note", r#""/name""#), "a misspelt action"),
        (reply("other", "note", "null"), "nothing labelled"),
        (
            reply("create", "note", r#""/name""#)
                .replace("\"after\":null", "\"after\":null,\"why\":\"x\""),
            "an unknown member",
        ),
        (
            reply("create", "note", r#""/name""#)
                .replace("\"fields\":[]", "\"fields\":[\"/nope\"]"),
            "an invented field",
        ),
        ("Sure! Here is the label.".to_string(), "not JSON"),
        ("".to_string(), "empty"),
    ] {
        assert!(parse(&reply, &arguments).is_err(), "{why}: {reply}");
    }
}

#[test]
fn a_reply_keeps_no_more_items_and_fields_than_a_label_shows() {
    let arguments = json!({"a": 1, "b": 2, "c": 3, "d": 4, "e": 5, "f": 6});
    let item = r#"{"title":"/a","fields":["/b","/b","/c","/d","/e","/f"],"id":"","target":null,"before":null,"after":null}"#;
    let empty = r#"{"title":null,"fields":[],"id":null,"target":null,"before":null,"after":null}"#;
    let reply = format!(
        r#"{{"action":"update","object_kind":"row","items":[{empty},{}]}}"#,
        [item; MAX_LABEL_ITEMS + 2].join(",")
    );
    let mapping = parse(&reply, &arguments).unwrap();
    assert_eq!(mapping.items.len(), MAX_LABEL_ITEMS);
    assert_eq!(mapping.items[0].fields, ["/b", "/c", "/d", "/e"]);
    assert_eq!(mapping.items[0].id, None);
    assert_eq!(mapping.items[0].title.as_deref(), Some("/a"));
}

#[derive(Debug, Deserialize)]
struct Case {
    id: String,
    tool: String,
    arguments: Value,
    expected: Expected,
}

#[derive(Debug, Deserialize)]
struct Expected {
    action: ToolCallAction,
    object_kind: ToolCallObjectKind,
    items: Vec<ToolCallLabelItemMapping>,
}

/// Every probe case's expected label is one the model can give: each of its
/// pointers is among the paths the call offers, and a reply naming them
/// parses back to that label.
#[test]
fn every_probe_label_can_be_given_from_the_calls_paths() {
    let mut cases = 0;
    for fixture in [
        include_str!("../rules/fixtures/testset.jsonl"),
        include_str!("../rules/fixtures/testset_dynamics.jsonl"),
    ] {
        for line in fixture.lines().filter(|line| !line.trim().is_empty()) {
            let case: Case = serde_json::from_str(line).unwrap();
            cases += 1;
            let named_nothing = case
                .expected
                .items
                .iter()
                .all(|item| *item == ToolCallLabelItemMapping::default());
            let Some(request) = build_request(&case.tool, &case.arguments) else {
                assert!(
                    named_nothing && argument_paths(&case.arguments).is_empty(),
                    "{}: not sent",
                    case.id
                );
                continue;
            };
            let reply = json!({
                "action": wire_name(case.expected.action),
                "object_kind": wire_name(case.expected.object_kind),
                "items": case.expected.items.iter().map(|item| json!({
                    "title": item.title, "id": item.id, "target": item.target,
                    "before": item.before, "after": item.after, "fields": item.fields,
                })).collect::<Vec<_>>(),
            });
            let parsed = parse_reply(&reply.to_string(), &case.arguments, &request.paths);
            if case.expected.action == ToolCallAction::Other && named_nothing {
                assert!(parsed.is_err(), "{}", case.id);
                continue;
            }
            let mapping = parsed.unwrap_or_else(|error| panic!("{}: {error}", case.id));
            assert_eq!(
                (mapping.action, mapping.object_kind, mapping.source),
                (
                    case.expected.action,
                    case.expected.object_kind,
                    ToolCallLabelSource::Model
                ),
                "{}",
                case.id
            );
            let want: Vec<_> = case
                .expected
                .items
                .iter()
                .filter(|item| **item != ToolCallLabelItemMapping::default())
                .take(MAX_LABEL_ITEMS)
                .map(|item| ToolCallLabelItemMapping {
                    title: item
                        .title
                        .as_deref()
                        .map(|p| with_wildcards(p, &case.arguments)),
                    id: item
                        .id
                        .as_deref()
                        .map(|p| with_wildcards(p, &case.arguments)),
                    target: item
                        .target
                        .as_deref()
                        .map(|p| with_wildcards(p, &case.arguments)),
                    before: item
                        .before
                        .as_deref()
                        .map(|p| with_wildcards(p, &case.arguments)),
                    after: item
                        .after
                        .as_deref()
                        .map(|p| with_wildcards(p, &case.arguments)),
                    fields: item
                        .fields
                        .iter()
                        .map(|p| with_wildcards(p, &case.arguments))
                        .take(MAX_LABEL_FIELDS)
                        .collect(),
                })
                .collect();
            assert_eq!(mapping.items, want, "{}", case.id);
            assert!(user_text(&request).len() <= MAX_INPUT_BYTES, "{}", case.id);
        }
    }
    assert_eq!(cases, 96);
}
