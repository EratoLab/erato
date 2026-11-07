use super::*;
use crate::models::message::{
    ToolCallLabelItem, ToolCallLabelSlot, ToolCallLabelSource, ToolCallObjectKind,
    ToolDisplayMetadata,
};
use crate::services::prompt_composition::transforms::replay_assistant_content;
use crate::services::tool_display::label::{
    ToolCallLabelItemMapping, ToolCallLabelMapping, generic_label, resolve_label,
};
use serde_json::json;

const OPPORTUNITY: &str = "5f0c2a10-0000-4000-8000-00000000a001";
const ACCOUNT: &str = "5f0c2a10-0000-4000-8000-00000000c001";
const CONTACT: &str = "5f0c2a10-0000-4000-8000-00000000b001";
const OTHER_CONTACT: &str = "5f0c2a10-0000-4000-8000-00000000b002";
const OWNER: &str = "5f0c2a10-0000-4000-8000-00000000f001";
const TASK: &str = "5f0c2a10-0000-4000-8000-00000000d001";

fn call(id: &str, tool: &str, input: Value, output: Value) -> ToolUse {
    ToolUse {
        tool_call_id: id.into(),
        status: ToolCallStatus::Success,
        tool_name: tool.into(),
        input: Some(input),
        output: Some(output),
        ..Default::default()
    }
}

/// The context a turn starts with when `calls` ran in earlier turns.
fn after(calls: Vec<ToolUse>) -> ToolResultContext {
    let messages = calls
        .into_iter()
        .flat_map(|tool| {
            replay_assistant_content(&MessageRole::Assistant, vec![ContentPart::ToolUse(tool)])
        })
        .collect();
    ToolResultContext::from_messages(&GenerationInputMessages { messages })
}

fn item(
    context: &ToolResultContext,
    action: ToolCallAction,
    mapping: ToolCallLabelItemMapping,
    arguments: &Value,
) -> ToolCallLabelItem {
    let mapping = ToolCallLabelMapping {
        action,
        object_kind: ToolCallObjectKind::Row,
        items: vec![mapping],
        source: ToolCallLabelSource::Rules,
    };
    let mut label = resolve_label(&mapping, arguments).unwrap();
    context.resolve(&mut label, arguments);
    label.items.remove(0)
}

fn resolved(slot: &ToolCallLabelSlot) -> Vec<Option<&str>> {
    slot.values
        .iter()
        .map(|value| value.resolved.as_deref())
        .collect()
}

/// What the context calls `id` when a call names it.
fn name(context: &ToolResultContext, id: Value) -> Option<String> {
    let arguments = json!({ "recordId": id });
    let mapping = ToolCallLabelItemMapping {
        id: Some("/recordId".into()),
        ..Default::default()
    };
    let item = item(context, ToolCallAction::Delete, mapping, &arguments);
    item.id.unwrap().values[0].resolved.clone()
}

/// What an update shows as the old value of `field` on record `id`.
fn earlier(context: &ToolResultContext, id: &str, field: &str, value: Value) -> Option<String> {
    let arguments = json!({ "recordId": id, "item": { field: value } });
    let mapping = ToolCallLabelItemMapping {
        id: Some("/recordId".into()),
        fields: vec![format!("/item/{field}")],
        ..Default::default()
    };
    let item = item(context, ToolCallAction::Update, mapping, &arguments);
    item.fields[0].values[0].resolved.clone()
}

fn read_query(id: &str, query: &str, rows: Value) -> ToolUse {
    call(id, "read_query", json!({ "querytext": query }), rows)
}

#[test]
fn a_row_is_named_by_id_by_its_only_id_or_by_the_table_its_read_named() {
    let context = after(vec![
        call(
            "folders",
            "list_meeting_folders",
            json!({}),
            json!({"folders": [{"id": "fld_1", "title": "Customer calls", "visibility": "private"}]}),
        ),
        read_query(
            "accounts",
            "SELECT name, accountid FROM account",
            json!([{ "name": "Example Industries", "accountid": ACCOUNT }]),
        ),
        read_query(
            "opportunities",
            "SELECT name, opportunityid, customerid, ownerid FROM opportunity",
            json!([{
                "name": "Line 4 retrofit",
                "customerid": ACCOUNT,
                "ownerid": OWNER,
                "opportunityid": OPPORTUNITY,
            }]),
        ),
        // Neither ID's table is in the query, and either could be the row's own.
        read_query(
            "unnamed",
            "SELECT * FROM view_17",
            json!([{ "name": "Ana Example", "contactid": CONTACT, "ownerid": OWNER }]),
        ),
        // Both stems are words of the query: no single winner.
        read_query(
            "both",
            "SELECT * FROM task JOIN owner",
            json!([{ "subject": "Call", "taskid": TASK, "ownerid": OWNER }]),
        ),
    ]);
    assert_eq!(
        name(&context, json!("fld_1")).as_deref(),
        Some("Customer calls")
    );
    assert_eq!(
        name(&context, json!(ACCOUNT)).as_deref(),
        Some("Example Industries")
    );
    assert_eq!(
        name(&context, json!(OPPORTUNITY)).as_deref(),
        Some("Line 4 retrofit")
    );
    for unnamed in [CONTACT, OWNER, TASK] {
        assert_eq!(name(&context, json!(unnamed)), None, "{unnamed}");
    }
}

#[test]
fn nested_lookups_name_their_own_records_and_count_as_the_row_field() {
    let context = after(vec![call(
        "describe",
        "describe",
        json!({ "path": format!("tables/opportunity/records/{OPPORTUNITY}") }),
        json!({"text": {"Attributes": [
            {"Key": "name", "Value": "Line 4 retrofit"},
            {"Key": "parentcustomerid", "Value": {"Id": ACCOUNT, "Name": "Example Industries", "LogicalName": "account"}},
        ]}}),
    )]);
    assert_eq!(
        name(&context, json!(ACCOUNT)).as_deref(),
        Some("Example Industries")
    );

    let context = after(vec![call(
        "fetch",
        "fetch_page",
        json!({ "id": OPPORTUNITY }),
        json!({
            "id": OPPORTUNITY,
            "title": "Line 4 retrofit",
            "owner": { "id": CONTACT, "name": "Ana Example" },
            "properties": { "Status": "Lead", "Seats": 12 },
        }),
    )]);
    assert_eq!(
        earlier(&context, OPPORTUNITY, "owner", json!(OTHER_CONTACT)).as_deref(),
        Some("Ana Example")
    );
    assert_eq!(
        earlier(&context, OPPORTUNITY, "Status", json!("Customer")).as_deref(),
        Some("Lead")
    );
    assert_eq!(
        earlier(&context, OPPORTUNITY, "Seats", json!(14)).as_deref(),
        Some("12")
    );
}

#[test]
fn a_lookup_name_the_model_typed_never_names_a_record() {
    let lookup = json!({ "name": "Typed by the model", "recordId": OPPORTUNITY, "relatedTable": "opportunity" });
    let context = after(vec![
        call(
            "create",
            "create_record",
            json!({ "tablename": "task", "item": { "subject": "Call back", "regardingobjectid": lookup } }),
            json!(format!("Created record with ID {TASK}.")),
        ),
        call(
            "search",
            "search_records",
            json!({ "filter": { "id": ACCOUNT, "name": "Typed as well" } }),
            json!({ "results": [] }),
        ),
    ]);
    assert_eq!(name(&context, json!(TASK)).as_deref(), Some("Call back"));
    assert_eq!(name(&context, json!(OPPORTUNITY)), None);
    assert_eq!(name(&context, json!(ACCOUNT)), None);

    let arguments = json!({ "item": { "regardingobjectid": lookup } });
    let target = item(
        &context,
        ToolCallAction::Create,
        ToolCallLabelItemMapping {
            target: Some("/item/regardingobjectid/recordId".into()),
            ..Default::default()
        },
        &arguments,
    )
    .target
    .unwrap();
    assert_eq!(resolved(&target), [None]);
}

#[test]
fn a_create_names_the_one_id_in_its_short_result_from_its_own_arguments() {
    let created = |tool: &str, input: Value, output: String| {
        let context = after(vec![call("create", tool, input, json!(output))]);
        name(&context, json!(TASK))
    };
    let task = json!({ "tablename": "task", "item": { "subject": "Call back" } });
    let confirmation = format!("Created record with ID {TASK}.");
    assert_eq!(
        created("create_record", task.clone(), confirmation.clone()).as_deref(),
        Some("Call back")
    );
    assert_eq!(
        created(
            "createTask",
            json!({ "name": "Call back" }),
            format!("{{{TASK}}}")
        )
        .as_deref(),
        Some("Call back")
    );
    assert_eq!(
        created("update_record", task.clone(), confirmation.clone()),
        None
    );
    assert_eq!(
        created(
            "create_record",
            task.clone(),
            format!("Created {TASK} under {ACCOUNT}.")
        ),
        None
    );
    assert_eq!(
        created(
            "create_record",
            task.clone(),
            format!("{confirmation}{}", " ".repeat(MAX_CREATE_RESULT_CHARS))
        ),
        None
    );
    assert_eq!(
        created(
            "create_record",
            json!({ "name": "One", "item": { "subject": "Two" } }),
            confirmation.clone()
        ),
        None
    );
    assert_eq!(
        created(
            "create_records",
            json!({ "items": [{ "subject": "One" }] }),
            confirmation.clone()
        ),
        None
    );
    // The record's own name is not under a name member: the lookup's is the
    // only candidate, and it is the model's.
    for lookup in [
        json!({ "accountid": ACCOUNT, "name": "Typed by the model" }),
        json!({ "page_id": "page-1", "title": "Typed by the model" }),
    ] {
        let contact =
            json!({ "item": { "firstname": "Ana", "lastname": "Example", "company": lookup } });
        assert_eq!(
            created("create_record", contact, confirmation.clone()),
            None
        );
    }
    assert_eq!(
        created(
            "create_page",
            json!({ "parent_page_id": "page-1", "title": "Kick-off" }),
            confirmation.clone()
        )
        .as_deref(),
        Some("Kick-off")
    );

    let mut labelled = call(
        "add",
        "add_note",
        json!({ "title": "Kick-off" }),
        json!(confirmation),
    );
    let mut label = generic_label(&json!({}));
    label.action = ToolCallAction::Create;
    labelled.display = Some(ToolDisplayMetadata {
        title: "Add note".into(),
        description: None,
        description_truncated: false,
        server_name: None,
        label: Some(label),
        read_only: false,
    });
    assert_eq!(
        name(&after(vec![labelled]), json!(TASK)).as_deref(),
        Some("Kick-off")
    );
}

#[test]
fn old_values_are_read_by_the_items_one_id_and_only_on_updates() {
    let read = read_query(
        "read",
        "SELECT name, opportunityid, parentcontactid, customerid, risklevel, priority FROM opportunity",
        json!([{
            "name": "Line 4 retrofit",
            "opportunityid": OPPORTUNITY,
            "parentcontactid": CONTACT,
            "customerid": ACCOUNT,
            "risklevel": 1,
            "priority": "high",
        }]),
    );
    let contacts = read_query(
        "contacts",
        "SELECT fullname, contactid FROM contact",
        json!([{ "fullname": "Ana Example", "contactid": CONTACT }]),
    );
    let priorities = call(
        "priorities",
        "list_priorities",
        json!({}),
        json!([{ "id": "high", "name": "Priority high" }]),
    );
    let context = after(vec![read, contacts, priorities]);
    let arguments = json!({
        "recordId": OPPORTUNITY,
        "item": {
            "risklevel": 3,
            "parentcontactid": { "recordId": OTHER_CONTACT, "relatedTable": "contact", "name": "Typed" },
            "priority": "low",
            "customerid": OTHER_CONTACT,
        },
    });
    let mapping = ToolCallLabelItemMapping {
        id: Some("/recordId".into()),
        fields: vec![
            "/item/risklevel".into(),
            "/item/parentcontactid/recordId".into(),
            "/item/priority".into(),
            // The earlier account was never read: no raw ID as its old value.
            "/item/customerid".into(),
        ],
        ..Default::default()
    };
    let fields = |context: &ToolResultContext, action| {
        item(context, action, mapping.clone(), &arguments)
            .fields
            .iter()
            .map(|field| resolved(field)[0].map(str::to_string))
            .collect::<Vec<_>>()
    };
    assert_eq!(
        fields(&context, ToolCallAction::Update),
        [
            Some("1".to_string()),
            Some("Ana Example".to_string()),
            Some("high".to_string()),
            None,
        ]
    );
    assert_eq!(fields(&context, ToolCallAction::Delete), vec![None; 4]);

    let arguments = json!({ "recordIds": [OPPORTUNITY, OPPORTUNITY], "item": { "risklevel": 3 } });
    let both = item(
        &context,
        ToolCallAction::Update,
        ToolCallLabelItemMapping {
            id: Some("/recordIds/*".into()),
            fields: vec!["/item/risklevel".into()],
            ..Default::default()
        },
        &arguments,
    );
    assert_eq!(
        resolved(both.id.as_ref().unwrap()),
        [Some("Line 4 retrofit"); 2]
    );
    assert_eq!(resolved(&both.fields[0]), [None]);
}

#[test]
fn a_later_call_naming_the_record_retires_its_old_values_but_a_link_does_not() {
    let read = read_query(
        "read",
        "SELECT name, opportunityid, risklevel FROM opportunity",
        json!([{ "name": "Line 4 retrofit", "opportunityid": OPPORTUNITY, "risklevel": 1 }]),
    );
    let update = |id: &str, status| ToolUse {
        status,
        ..call(
            id,
            "update_record",
            json!({ "recordId": OPPORTUNITY, "item": { "risklevel": 2 } }),
            json!("Record updated successfully."),
        )
    };
    let link = call(
        "link",
        "create_record",
        json!({ "item": { "subject": "Call", "regardingobjectid": { "recordId": OPPORTUNITY } } }),
        json!(format!("Created record with ID {TASK}.")),
    );
    let page_link = call(
        "page",
        "notion-create-pages",
        json!({ "parent": { "type": "page_id", "page_id": OPPORTUNITY }, "pages": [{ "title": "Notes" }] }),
        json!("Created 1 page."),
    );

    let context = after(vec![read.clone(), link, page_link]);
    assert_eq!(
        earlier(&context, OPPORTUNITY, "risklevel", json!(3)).as_deref(),
        Some("1")
    );
    for status in [ToolCallStatus::Success, ToolCallStatus::Error] {
        let context = after(vec![read.clone(), update("update", status)]);
        assert_eq!(earlier(&context, OPPORTUNITY, "risklevel", json!(3)), None);
        assert_eq!(
            name(&context, json!(OPPORTUNITY)).as_deref(),
            Some("Line 4 retrofit")
        );
    }
    let reread = ToolUse {
        tool_call_id: "reread".into(),
        ..read.clone()
    };
    let context = after(vec![
        read,
        update("update", ToolCallStatus::Success),
        reread,
    ]);
    assert_eq!(
        earlier(&context, OPPORTUNITY, "risklevel", json!(3)).as_deref(),
        Some("1")
    );
}

#[test]
fn a_write_carrying_the_records_data_or_naming_it_in_text_retires_its_old_values() {
    let airtable_read = call(
        "read",
        "list_records",
        json!({ "table": "Tasks" }),
        json!({ "records": [{ "id": "recTask1", "fields": { "Name": "Ship", "Status": "Open" } }] }),
    );
    let airtable_update = call(
        "update",
        "update_records",
        json!({ "records": [{ "id": "recTask1", "fields": { "Status": "Done" } }] }),
        json!("Updated 1 record."),
    );
    let issue_read = call(
        "issue",
        "get_issue",
        json!({ "key": "ENG-5" }),
        json!({ "id": "ENG-5", "title": "Crash on save", "state": "open" }),
    );
    let issue_update = call(
        "close",
        "update_issue",
        json!({ "issue": { "id": "ENG-5", "state": "closed" } }),
        json!("Issue updated."),
    );
    let context = after(vec![airtable_read.clone(), issue_read.clone()]);
    assert_eq!(
        earlier(&context, "recTask1", "Status", json!("Blocked")).as_deref(),
        Some("Open")
    );
    assert_eq!(
        earlier(&context, "ENG-5", "state", json!("done")).as_deref(),
        Some("open")
    );
    let context = after(vec![
        airtable_read,
        issue_read,
        airtable_update,
        issue_update,
    ]);
    assert_eq!(
        earlier(&context, "recTask1", "Status", json!("Blocked")),
        None
    );
    assert_eq!(earlier(&context, "ENG-5", "state", json!("done")), None);

    let read = read_query(
        "read",
        "SELECT name, opportunityid, risklevel FROM opportunity",
        json!([{ "name": "Line 4 retrofit", "opportunityid": OPPORTUNITY, "risklevel": 1 }]),
    );
    for text in [
        format!("UPDATE opportunity SET risklevel = 3 WHERE opportunityid = '{OPPORTUNITY}'"),
        format!("update page {} set Status", OPPORTUNITY.replace('-', "")),
    ] {
        let write = call(
            "write",
            "execute",
            json!({ "statement": text }),
            json!("Done."),
        );
        let context = after(vec![read.clone(), write]);
        assert_eq!(
            earlier(&context, OPPORTUNITY, "risklevel", json!(3)),
            None,
            "{text}"
        );
    }
}

#[test]
fn the_running_turn_is_read_once_per_call_and_only_once_settled() {
    let read = read_query(
        "read",
        "SELECT name, opportunityid, risklevel FROM opportunity",
        json!([{ "name": "Line 4 retrofit", "opportunityid": OPPORTUNITY, "risklevel": 1 }]),
    );
    let update = call(
        "update",
        "update_record",
        json!({ "recordId": OPPORTUNITY, "item": { "risklevel": 2 } }),
        json!("Record updated successfully."),
    );
    let mut context = after(vec![read.clone(), update]);
    // A resumed turn's content is also in its generation input.
    context.observe(&[ContentPart::ToolUse(read.clone())]);
    assert_eq!(earlier(&context, OPPORTUNITY, "risklevel", json!(3)), None);

    let mut running = ToolUse {
        tool_call_id: "contacts".into(),
        status: ToolCallStatus::InProgress,
        ..read_query(
            "contacts",
            "SELECT fullname, contactid FROM contact",
            json!([{ "fullname": "Ana Example", "contactid": CONTACT }]),
        )
    };
    let mut context = ToolResultContext::default();
    context.observe(&[ContentPart::ToolUse(running.clone())]);
    assert_eq!(name(&context, json!(CONTACT)), None);
    running.status = ToolCallStatus::Error;
    let mut failed = context.clone();
    failed.observe(&[ContentPart::ToolUse(running.clone())]);
    assert_eq!(name(&failed, json!(CONTACT)), None);
    running.status = ToolCallStatus::Success;
    context.observe(&[ContentPart::ToolUse(running)]);
    assert_eq!(
        name(&context, json!(CONTACT)).as_deref(),
        Some("Ana Example")
    );
}

#[test]
fn ids_match_in_any_uuid_spelling_and_numbers_or_short_ids_that_name_two_things_miss() {
    let braced = format!("{{{}}}", OPPORTUNITY.to_uppercase());
    let context = after(vec![call(
        "read",
        "fetch",
        json!({}),
        json!({ "id": braced, "name": "Line 4 retrofit" }),
    )]);
    let bare = OPPORTUNITY.replace('-', "");
    assert_eq!(
        name(&context, json!(bare)).as_deref(),
        Some("Line 4 retrofit")
    );
    assert_eq!(name(&context, json!("Line 4 retrofit")), None);

    let context = after(vec![
        // Comment 7 on another server is not project 7.
        call(
            "a",
            "list_projects",
            json!({}),
            json!([{ "id": 7, "name": "Alpha", "workspace_id": "ws_1" }]),
        ),
        call(
            "b",
            "list_labels",
            json!({}),
            json!([{ "id": "8", "name": "Beta" }]),
        ),
        call(
            "c",
            "list_labels",
            json!({}),
            json!([{ "id": "lbl_7", "name": "Beta" }]),
        ),
        call(
            "d",
            "list_labels",
            json!({}),
            json!([{ "id": "lbl_7", "name": "Gamma" }]),
        ),
        call(
            "e",
            "list_projects",
            json!({}),
            json!([{ "id": "prj_8", "name": "Delta" }]),
        ),
        call(
            "e2",
            "list_projects",
            json!({}),
            json!([{ "id": "prj_8", "name": "Delta" }]),
        ),
        call(
            "f",
            "fetch",
            json!({}),
            json!({ "id": OPPORTUNITY, "name": "Old name" }),
        ),
        call(
            "g",
            "fetch",
            json!({}),
            json!({ "id": OPPORTUNITY, "name": "New name" }),
        ),
    ]);
    for missed in [
        json!(7),
        json!("7"),
        json!("8"),
        json!("ws_1"),
        json!("lbl_7"),
    ] {
        assert_eq!(name(&context, missed.clone()), None, "{missed}");
    }
    assert_eq!(name(&context, json!("prj_8")).as_deref(), Some("Delta"));
    assert_eq!(
        name(&context, json!(OPPORTUNITY)).as_deref(),
        Some("New name")
    );
}

#[test]
fn names_are_cleaned_and_results_and_the_index_are_capped() {
    let context = after(vec![call(
        "read",
        "fetch",
        json!({}),
        json!({ "id": "p1", "title": format!("Globex\u{202E}{}", "x".repeat(MAX_LABEL_VALUE_CHARS)) }),
    )]);
    let cleaned = name(&context, json!("p1")).unwrap();
    assert!(cleaned.starts_with("Globexx"));
    assert_eq!(cleaned.chars().count(), MAX_LABEL_VALUE_CHARS);

    let rows: Vec<_> = (0..MAX_RECORDS_PER_RESULT + 5)
        .map(|i| json!({ "id": format!("r{i}"), "name": format!("Row {i}") }))
        .collect();
    let context = after(vec![call("list", "list_rows", json!({}), json!(rows))]);
    assert_eq!(name(&context, json!("r0")).as_deref(), Some("Row 0"));
    assert_eq!(
        name(&context, json!(format!("r{MAX_RECORDS_PER_RESULT}"))),
        None
    );

    let mut pages: Vec<_> = (0..3)
        .map(|page| {
            let rows: Vec<_> = (0..MAX_RECORDS_PER_RESULT)
                .map(|i| json!({ "id": format!("p{page}-{i}"), "name": "Row" }))
                .collect();
            call(&format!("page{page}"), "list_rows", json!({}), json!(rows))
        })
        .collect();
    let reread = call(
        "reread",
        "fetch",
        json!({}),
        json!({ "id": "p0-0", "name": "Row" }),
    );
    pages.insert(2, reread);
    let context = after(pages);
    assert_eq!(context.records.len(), MAX_RECORDS);
    assert_eq!(name(&context, json!("p0-0")).as_deref(), Some("Row"));
    assert_eq!(name(&context, json!("p0-1")), None);
    assert_eq!(name(&context, json!("p2-0")).as_deref(), Some("Row"));

    let wide: Map<String, Value> = (0..MAX_FIELDS_PER_RECORD + 10)
        .map(|i| (format!("f{i}"), json!(i)))
        .chain([("id".to_string(), json!("w"))])
        .collect();
    let context = after(vec![call("wide", "fetch", json!({}), Value::Object(wide))]);
    assert_eq!(context.records["w"].fields.len(), MAX_FIELDS_PER_RECORD);
}

#[derive(serde::Deserialize)]
struct Fixture {
    history: Vec<FixtureCall>,
    writes: Vec<FixtureWrite>,
}

#[derive(serde::Deserialize)]
struct FixtureCall {
    tool_name: String,
    input: Value,
    output: Value,
}

#[derive(serde::Deserialize)]
struct FixtureWrite {
    case: String,
    arguments: Value,
    mapping: ToolCallLabelMapping,
    expect: Expected,
}

#[derive(serde::Deserialize, Default)]
#[serde(default)]
struct Expected {
    id: Option<Vec<Option<String>>>,
    target: Option<Vec<Option<String>>>,
    fields: Vec<Vec<Option<String>>>,
}

/// Synthetic values in the shapes a Dataverse chat produced: reads and a
/// create, then the writes that followed them, labelled as rules would.
#[test]
fn a_dataverse_style_chat_resolves_its_writes_from_its_reads() {
    let fixture: Fixture =
        serde_json::from_str(include_str!("fixtures/dataverse_chat.json")).unwrap();
    let context = after(
        fixture
            .history
            .into_iter()
            .enumerate()
            .map(|(index, step)| {
                call(
                    &format!("call-{index}"),
                    &step.tool_name,
                    step.input,
                    step.output,
                )
            })
            .collect(),
    );
    for write in fixture.writes {
        let mut label = resolve_label(&write.mapping, &write.arguments).unwrap();
        context.resolve(&mut label, &write.arguments);
        let item = &label.items[0];
        let owned = |slot: &Option<ToolCallLabelSlot>| {
            slot.as_ref().map(|slot| {
                resolved(slot)
                    .into_iter()
                    .map(|value| value.map(str::to_string))
                    .collect::<Vec<_>>()
            })
        };
        assert_eq!(owned(&item.id), write.expect.id, "{}", write.case);
        assert_eq!(owned(&item.target), write.expect.target, "{}", write.case);
        let fields: Vec<_> = item
            .fields
            .iter()
            .map(|field| owned(&Some(field.clone())).unwrap())
            .collect();
        assert_eq!(fields, write.expect.fields, "{}", write.case);
    }
}

#[test]
fn tool_names_split_into_words() {
    assert_eq!(
        name_words("notion-create-pages"),
        ["notion", "create", "pages"]
    );
    assert_eq!(name_words("createIssue"), ["create", "issue"]);
    assert_eq!(
        name_words("crm.records.upsert"),
        ["crm", "records", "upsert"]
    );
    assert_eq!(name_words("recreate_x"), ["recreate", "x"]);
}
