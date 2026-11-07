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

/// The notes tool's schema: only `status` lists its values.
fn notes_schema() -> JsonObject {
    object(json!({"type": "object", "properties": {
        "folder": {"type": "object", "properties": {"folder_id": {"type": "string"}}},
        "items": {"type": "array", "items": {"type": "object", "properties": {
            "name": {"type": "string"},
            "body": {"type": "string"},
            "status": {"type": "string", "enum": ["draft", "published"]},
        }}},
    }}))
}

fn object(value: Value) -> JsonObject {
    value.as_object().unwrap().clone()
}

fn no_schema() -> JsonObject {
    JsonObject::new()
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
    let request = build_request("notes-create-items", &notes_schema(), &notes_call()).unwrap();
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
        json!({"folder": {"folder_id": "<str len=2>"}, "items": [
            {"name": "<str len=4>", "body": "<str len=900>", "status": "draft"},
        ]})
    );
    assert!(!text.contains("Plan") && !text.contains("f1"), "{text}");
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
fn the_skeleton_sends_no_free_text_only_verb_fields_and_listed_values() {
    let rows: Vec<_> = (0..5).map(|index| json!({"n": index})).collect();
    let schema = object(json!({"type": "object", "properties": {
        "status": {"enum": ["open", "won", 7]},
        "priority": {"const": 2},
        "stage": {"$ref": "#/$defs/stage"},
        "owner": {"anyOf": [{"type": "null"}, {"$ref": "#/$defs/owner"}]},
        "tags": {"type": "array", "items": {"enum": ["red", "blue"]}},
        "pair": {"prefixItems": [{"enum": ["first"]}, {"enum": ["second"]}]},
        "extra": {"additionalProperties": {"enum": ["kept"]}},
        "wrong_place": {"type": "string"},
    }, "$defs": {
        "stage": {"enum": ["lead", "deal"]},
        "owner": {"type": "object", "properties": {"role": {"enum": ["admin"]}}},
    }}));
    let skeleton = skeleton(
        &schema,
        &json!({
            "mode": "upsert",
            "kind": "row\u{202E}",
            "op": "free text with spaces",
            "query": "Acme Corp quarterly numbers",
            "status": "won",
            "priority": 2,
            "stage": "deal",
            "owner": {"role": "admin", "name": "Ada Lovelace"},
            "tags": ["red", "green"],
            "pair": ["first", "first"],
            "extra": {"any": "kept", "other": "not kept"},
            "wrong_place": "open",
            "amount": 1234.5,
            "count": 7,
            "rows": rows,
            "flags": [true, null, false],
        }),
    )
    .unwrap();
    assert_eq!(
        skeleton,
        json!({
            "mode": "upsert",
            "kind": "<str len=4>",
            "op": "<str len=21>",
            "query": "<str len=27>",
            "status": "won",
            "priority": 2,
            "stage": "deal",
            "owner": {"role": "admin", "name": "<str len=12>"},
            "tags": ["red", "<str len=5>"],
            "pair": ["first", "<str len=5>"],
            "extra": {"any": "kept", "other": "<str len=8>"},
            "wrong_place": "<str len=4>",
            "amount": "<number>",
            "count": "<number>",
            "rows": [{"n": "<number>"}, {"n": "<number>"}, {"n": "<number>"}, "<+2 more>"],
            "flags": [true, null, false],
        })
    );
}

#[test]
fn a_listed_value_with_hidden_characters_or_past_the_cap_goes_as_its_length() {
    let long = "x".repeat(MAX_LISTED_CHARS + 1);
    let hidden = [
        "in\u{202E}voice",
        "tab\there",
        "zero\u{200B}width",
        "nul\u{0}",
    ];
    let options: Vec<Value> = hidden
        .iter()
        .map(|text| json!(text))
        .chain([json!(long.clone()), json!("x".repeat(MAX_LISTED_CHARS))])
        .collect();
    let schema = object(json!({"additionalProperties": {"enum": options}}));
    let mut arguments: serde_json::Map<String, Value> = hidden
        .iter()
        .enumerate()
        .map(|(index, text)| (format!("m{index}"), json!(text)))
        .collect();
    arguments.insert("long".into(), json!(long));
    arguments.insert("cap".into(), json!("x".repeat(MAX_LISTED_CHARS)));
    let shown = skeleton(&schema, &Value::Object(arguments)).unwrap();
    for index in 0..hidden.len() {
        assert!(
            shown[format!("m{index}")]
                .as_str()
                .unwrap()
                .starts_with("<str len="),
            "{shown}"
        );
    }
    assert_eq!(
        shown["long"],
        json!(format!("<str len={}>", MAX_LISTED_CHARS + 1))
    );
    assert_eq!(shown["cap"], json!("x".repeat(MAX_LISTED_CHARS)));
}

#[test]
fn any_schema_or_arguments_give_a_bounded_skeleton_or_none() {
    let nested = |depth: usize| (0..depth).fold(json!("leaf"), |inner, _| json!({"next": inner}));
    let huge_enum: Vec<Value> = (0..200_000).map(|n| json!(format!("v{n}"))).collect();
    let hostile_schemas = [
        object(json!({"$ref": "#"})),
        object(json!({"properties": {"a": {"$ref": "#/properties/a"}}})),
        object(json!({"allOf": [{"$ref": "#"}, {"$ref": "#"}], "anyOf": [{"$ref": "#"}]})),
        object(json!({"$ref": format!("#/{}", "x/".repeat(10_000))})),
        object(json!({"$ref": "https://example.com/schema.json"})),
        object(json!({"properties": "not an object", "items": 5, "enum": "nope"})),
        object(json!({"additionalProperties": {"enum": huge_enum}})),
        object(json!({"properties": {"next": nested(200)}})),
    ];
    let hostile_arguments = [
        json!("not json {"),
        json!(null),
        json!(42),
        json!([]),
        nested(500),
        json!({"a/b": {"~0": "\u{202E}"}, "\u{0}": [], "": {"": null}, "\u{202E}": 1}),
        json!({"a": (0..100_000).map(|n| format!("v{n}")).collect::<Vec<_>>()}),
    ];
    for schema in &hostile_schemas {
        for arguments in &hostile_arguments {
            let shown = skeleton(schema, arguments);
            let text = serde_json::to_string(&shown).unwrap();
            assert!(!text.contains("v99999"), "{:.200}", text);
            assert!(text.len() < 64 * 1024, "{} bytes", text.len());
        }
    }
    let deep = skeleton(&no_schema(), &nested(500)).unwrap();
    let mut depth = 0;
    let mut level = &deep;
    while let Some(next) = level.get("next") {
        depth += 1;
        level = next;
    }
    assert_eq!(depth, MAX_SKELETON_DEPTH);
    assert_eq!(level, &json!("<object>"));

    let wide: serde_json::Map<_, _> = (0..MAX_WALK_VALUES + 1)
        .map(|index| (format!("m{index}"), json!(index)))
        .collect();
    assert_eq!(skeleton(&no_schema(), &Value::Object(wide)), None);
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
    assert!(build_request("crm_records", &no_schema(), &json!({})).is_none());
    assert!(build_request("crm_records", &no_schema(), &json!("text")).is_none());
    let wide: serde_json::Map<_, _> = (0..2_000)
        .map(|index| (format!("member_{index}"), json!(index)))
        .collect();
    assert!(build_request("crm_records", &no_schema(), &Value::Object(wide)).is_none());
    let request = build_request(
        "crm\u{202E}records\n",
        &no_schema(),
        &json!({"recordId": "rec-1"}),
    )
    .unwrap();
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
fn a_reply_too_long_too_deep_or_pointing_past_any_path_is_rejected_unread() {
    let arguments = json!({"name": "Plan", "rows": [{"id": 1}]});
    let padded = format!(
        r#"{{"action":"create","object_kind":"note","items":[{{"title":"/name","fields":[],"id":null,"target":null,"before":null,"after":null}}]}}{}"#,
        " ".repeat(MAX_REPLY_BYTES)
    );
    assert!(parse(padded.trim_end(), &arguments).is_ok());
    assert!(parse(&padded, &arguments).is_err());
    let deep = format!("{}{}", "[".repeat(10_000), "]".repeat(10_000));
    assert!(parse(&deep, &arguments).is_err());
    let long = format!("/rows/{}/id", "0".repeat(MAX_POINTER_BYTES));
    let reply = format!(
        r#"{{"action":"update","object_kind":"row","items":[{{"title":null,"fields":[],"id":"{long}","target":null,"before":null,"after":null}}]}}"#
    );
    assert!(parse(&reply, &arguments).is_err());
    let many = format!(
        r#"{{"action":"update","object_kind":"row","items":[{}]}}"#,
        [r#"{"id":"/rows/0/id"}"#; 1_000].join(",")
    );
    assert!(parse(&many, &arguments).is_err());
    for text in [
        "null",
        "[]",
        "7",
        "\"text\"",
        r#"{"action":7}"#,
        "\u{202E}{}",
    ] {
        assert!(parse(text, &arguments).is_err(), "{text}");
    }
    assert_eq!(traced_reply(&padded).len(), MAX_REPLY_BYTES);
    assert_eq!(
        traced_reply(&"ä".repeat(MAX_REPLY_BYTES)).len(),
        MAX_REPLY_BYTES
    );
}

#[test]
fn a_reply_on_a_huge_batch_is_read_from_a_sample_of_it() {
    let rows: Vec<_> = (0..200_000).map(|n| json!({"id": n})).collect();
    let arguments = json!({"rows": rows, "name": "Plan"});
    let paths = argument_paths(&arguments);
    assert_eq!(paths, ["/name", "/rows", "/rows/*", "/rows/*/id"]);
    let item = r#"{"title":"/name","fields":["/rows/199999/id","/rows/7/id","/rows/0/id"],"id":"/rows/5/id","target":null,"before":null,"after":null}"#;
    let reply = format!(
        r#"{{"action":"update","object_kind":"row","items":[{}]}}"#,
        [item; 60].join(",")
    );
    assert!(reply.len() <= MAX_REPLY_BYTES);
    let mapping = parse(&reply, &arguments).unwrap();
    assert_eq!(mapping.items.len(), MAX_LABEL_ITEMS);
    assert_eq!(mapping.items[0].id.as_deref(), Some("/rows/*/id"));
    assert_eq!(mapping.items[0].fields, ["/rows/*/id"]);
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
            let Some(request) = build_request(&case.tool, &no_schema(), &case.arguments) else {
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
