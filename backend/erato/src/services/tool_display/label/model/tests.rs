use super::*;
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
}

#[test]
fn a_request_shows_the_tool_and_a_skeleton_and_asks_only_for_a_verb_and_kind() {
    let request = build_request("notes-create-items", &notes_schema(), &notes_call()).unwrap();
    let text = user_text(&request);
    let lines: Vec<_> = text.lines().collect();
    assert_eq!(lines.len(), 2, "{text}");
    assert_eq!(lines[0], "TOOL: notes-create-items");
    let shown: Value = serde_json::from_str(lines[1].strip_prefix("ARGUMENTS: ").unwrap()).unwrap();
    assert_eq!(
        shown,
        json!({"folder": {"folder_id": "<str len=2>"}, "items": [
            {"name": "<str len=4>", "body": "<str len=900>", "status": "draft"},
        ]})
    );
    assert!(!text.contains("Plan") && !text.contains("f1"), "{text}");
    let system = &request.chat_request.messages[0];
    assert_eq!(system.role, ChatRole::System);
    assert_eq!(system.content.first_text(), Some(LABEL_PROMPT));
    assert_eq!(request.chat_request.messages.len(), 2);
    assert_eq!(
        request.schema["properties"]["action"]["enum"],
        json!(ACTIONS.map(wire_name))
    );
    assert_eq!(request.schema["required"], json!(["action", "object_kind"]));
    assert_eq!(request.schema["properties"].as_object().unwrap().len(), 2);
    assert_eq!(request.schema["additionalProperties"], false);
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
fn a_call_too_large_to_send_is_not_sent() {
    assert!(build_request("crm_records", &no_schema(), &json!({})).is_some());
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
fn a_reply_gives_a_verb_and_a_kind_and_nothing_else() {
    let mapping = parse_reply(r#"{"action":"update","object_kind":"row"}"#).unwrap();
    assert_eq!(
        mapping,
        ToolCallLabelMapping {
            action: ToolCallAction::Update,
            object_kind: ToolCallObjectKind::Row,
            items: Vec::new(),
            source: ToolCallLabelSource::Model,
        }
    );
    let fenced =
        parse_reply("```json\n{\"action\":\"share\",\"object_kind\":\"file\"}\n```").unwrap();
    assert_eq!(fenced.action, ToolCallAction::Share);
    // A verb alone is an answer; a kind alone is one too.
    assert!(parse_reply(r#"{"action":"delete","object_kind":"other"}"#).is_ok());
    assert!(parse_reply(r#"{"action":"other","object_kind":"task"}"#).is_ok());
}

#[test]
fn a_reply_off_the_lists_or_with_more_than_a_verb_and_kind_is_rejected() {
    for (reply, why) in [
        (
            r#"{"action":"teleport","object_kind":"row"}"#,
            "off the list",
        ),
        (
            r#"{"action":"update","object_kind":"spreadsheet"}"#,
            "off the list",
        ),
        (
            r#"{"action":"other","object_kind":"other"}"#,
            "says nothing",
        ),
        (r#"{"action":"update"}"#, "no kind"),
        (
            r#"{"action":"update","object_kind":"row","items":[]}"#,
            "more than asked",
        ),
        ("Sure! Here is the label.", "not JSON"),
        ("", "empty"),
    ] {
        assert!(parse_reply(reply).is_err(), "{why}: {reply}");
    }
    let long = format!(
        "{}{{\"action\":\"update\",\"object_kind\":\"row\"}}",
        " ".repeat(MAX_REPLY_BYTES)
    );
    assert!(parse_reply(&long).is_err());
}
