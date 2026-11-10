use super::*;
use crate::models::message::{
    ContentPartText, InputMessage, ToolAllowedBy, ToolCallLabelItem, ToolCallLabelSlot,
    ToolCallLabelSource, ToolCallObjectKind, ToolDisplayMetadata,
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
/// The server every call here ran on, unless a test says otherwise.
const SERVER: &str = "CRM";

fn on(server: Option<&str>) -> Option<ToolDisplayMetadata> {
    Some(ToolDisplayMetadata {
        title: "A tool".into(),
        description: None,
        description_truncated: false,
        server_name: server.map(str::to_string),
        label: None,
        read_only: false,
    })
}

fn call(id: &str, tool: &str, input: Value, output: Value) -> ToolUse {
    ToolUse {
        tool_call_id: id.into(),
        status: ToolCallStatus::Success,
        tool_name: tool.into(),
        display: on(Some(SERVER)),
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
    item_on(context, SERVER, action, mapping, arguments)
}

/// The label item of a call of `server`.
fn item_on(
    context: &ToolResultContext,
    server: &str,
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
    let mut label = resolve_label(&mapping, arguments, None).unwrap();
    context.resolve(&mut label, arguments, server);
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
    name_on(context, SERVER, id)
}

/// What the context calls `id` when a call of `server` names it.
fn name_on(context: &ToolResultContext, server: &str, id: Value) -> Option<String> {
    let arguments = json!({ "recordId": id });
    let mapping = ToolCallLabelItemMapping {
        id: Some("/recordId".into()),
        ..Default::default()
    };
    let item = item_on(context, server, ToolCallAction::Delete, mapping, &arguments);
    item.id?.values.first()?.resolved.clone()
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

    // The one ID in the result is the record the call linked to.
    let read = read_query(
        "read",
        "SELECT name, opportunityid FROM opportunity",
        json!([{ "name": "Line 4 retrofit", "opportunityid": OPPORTUNITY }]),
    );
    let linked = format!("Task created and linked to {OPPORTUNITY}.");
    for input in [
        json!({ "title": "Follow up", "regarding_id": OPPORTUNITY }),
        json!({ "item": { "subject": "Follow up", "regardingobjectid": { "recordId": OPPORTUNITY } } }),
    ] {
        let create = call("create", "create_task", input, json!(linked));
        assert_eq!(name(&after(vec![create.clone()]), json!(OPPORTUNITY)), None);
        assert_eq!(
            name(&after(vec![read.clone(), create]), json!(OPPORTUNITY)).as_deref(),
            Some("Line 4 retrofit")
        );
    }

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
        server_name: Some(SERVER.into()),
        label: Some(label),
        read_only: false,
    });
    assert_eq!(
        name(&after(vec![labelled]), json!(TASK)).as_deref(),
        Some("Kick-off")
    );
}

/// A call labelled as `action`, as every MCP call's row is once it ran.
fn labelled_as(action: ToolCallAction, tool: ToolUse) -> ToolUse {
    let mut label = generic_label(&json!({}));
    label.action = action;
    ToolUse {
        display: Some(ToolDisplayMetadata {
            label: Some(label),
            ..on(Some(SERVER)).unwrap()
        }),
        ..tool
    }
}

#[test]
fn a_record_renamed_in_this_chat_is_named_by_its_new_name_and_never_its_old_one() {
    let read = read_query(
        "read",
        "SELECT subject, opportunityid FROM opportunity",
        json!([{ "subject": "Card check task", "opportunityid": OPPORTUNITY }]),
    );
    let update = |id: &str, status, item: Value| ToolUse {
        status,
        ..labelled_as(
            ToolCallAction::Update,
            call(
                id,
                "update_record",
                json!({ "tablename": "task", "recordId": OPPORTUNITY, "item": item }),
                json!("Record updated successfully."),
            ),
        )
    };
    let renamed = update(
        "rename",
        ToolCallStatus::Success,
        json!({ "subject": "Card check task v2", "description": "Updated" }),
    );
    let context = after(vec![read.clone(), renamed.clone()]);
    assert_eq!(
        name(&context, json!(OPPORTUNITY)).as_deref(),
        Some("Card check task v2")
    );
    let mut running = ToolResultContext::default();
    running.observe(&[
        ContentPart::ToolUse(read.clone()),
        ContentPart::ToolUse(renamed),
    ]);
    assert_eq!(
        name(&running, json!(OPPORTUNITY)).as_deref(),
        Some("Card check task v2")
    );
    let new_member = update(
        "rename",
        ToolCallStatus::Success,
        json!({ "newSubject": "Card check task v3" }),
    );
    assert_eq!(
        name(&after(vec![read.clone(), new_member]), json!(OPPORTUNITY)).as_deref(),
        Some("Card check task v3")
    );

    // A failed or denied write changes nothing, and neither does one that
    // leaves the name's member alone.
    let failed = update(
        "failed",
        ToolCallStatus::Error,
        json!({ "subject": "Card check task v2" }),
    );
    let denied = ToolUse {
        output: Some(json!({ "status": "rejected", "error": "The user denied this tool call." })),
        ..update(
            "denied",
            ToolCallStatus::Error,
            json!({ "subject": "Card check task v2" }),
        )
    };
    let other_field = update(
        "other",
        ToolCallStatus::Success,
        json!({ "description": "Card check task v2" }),
    );
    for write in [failed, denied, other_field] {
        assert_eq!(
            name(&after(vec![read.clone(), write]), json!(OPPORTUNITY)).as_deref(),
            Some("Card check task"),
        );
    }

    // When it is not certain what the record is called now, it has no name.
    for item in [
        json!({ "subject": null }),
        json!({ "subject": "ana@example.com" }),
        json!({ "subject": "One", "newSubject": "Two" }),
    ] {
        let write = update("unsure", ToolCallStatus::Success, item.clone());
        assert_eq!(
            name(&after(vec![read.clone(), write]), json!(OPPORTUNITY)),
            None,
            "{item}"
        );
    }
    let batch = labelled_as(
        ToolCallAction::Update,
        call(
            "batch",
            "update_records",
            json!({ "records": [
                { "opportunityid": OPPORTUNITY, "subject": "One", "risklevel": 1 },
                { "opportunityid": "5f0c2a10-0000-4000-8000-00000000a002", "subject": "Two", "risklevel": 2 },
            ] }),
            json!("Updated 2 records."),
        ),
    );
    assert_eq!(
        name(&after(vec![read.clone(), batch]), json!(OPPORTUNITY)),
        None
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
    let denied = ToolUse {
        output: Some(json!({ "status": "rejected", "error": "The user denied this tool call." })),
        ..update("denied", ToolCallStatus::Error)
    };
    let context = after(vec![read.clone(), denied]);
    assert_eq!(
        earlier(&context, OPPORTUNITY, "risklevel", json!(3)).as_deref(),
        Some("1")
    );
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

    let other = read_query(
        "other",
        "SELECT fullname, contactid, jobtitle FROM contact",
        json!([{ "fullname": "Ana Example", "contactid": CONTACT, "jobtitle": "Buyer" }]),
    );
    let keyed = call(
        "keyed",
        "update_records",
        json!({ "updates": { OPPORTUNITY: { "risklevel": 3 } } }),
        json!("Updated 1 record."),
    );
    let context = after(vec![read.clone(), other.clone(), keyed]);
    assert_eq!(earlier(&context, OPPORTUNITY, "risklevel", json!(3)), None);
    assert_eq!(
        earlier(&context, CONTACT, "jobtitle", json!("Lead")).as_deref(),
        Some("Buyer")
    );

    // Past a cap the call's IDs are not all read, so no old value counts.
    let bulk: Vec<_> = (0..MAX_NODES_PER_VALUE)
        .map(|i| json!({ "id": format!("row{i}"), "status": "done" }))
        .chain([json!({ "id": OPPORTUNITY, "risklevel": 3 })])
        .collect();
    let mut deep = json!({ "recordId": OPPORTUNITY, "risklevel": 3 });
    for _ in 0..MAX_DEPTH {
        deep = json!({ "batch": deep });
    }
    for (case, arguments) in [("bulk", json!({ "records": bulk })), ("deep", deep)] {
        let write = call(case, "update_records", arguments, json!("Done."));
        let context = after(vec![read.clone(), other.clone(), write]);
        assert_eq!(
            earlier(&context, OPPORTUNITY, "risklevel", json!(3)),
            None,
            "{case}"
        );
        assert_eq!(
            earlier(&context, CONTACT, "jobtitle", json!("Lead")),
            None,
            "{case}"
        );
        assert_eq!(
            name(&context, json!(OPPORTUNITY)).as_deref(),
            Some("Line 4 retrofit"),
            "{case}"
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
fn a_label_job_keeps_the_index_its_call_saw_while_the_turn_reads_on() {
    let read = read_query(
        "read",
        "SELECT name, opportunityid, risklevel FROM opportunity",
        json!([{ "name": "Line 4 retrofit", "opportunityid": OPPORTUNITY, "risklevel": 1 }]),
    );
    let mut turn = std::sync::Arc::new(after(vec![read.clone()]));
    let job = std::sync::Arc::clone(&turn);

    let running = ToolUse {
        status: ToolCallStatus::InProgress,
        ..call(
            "update",
            "update_record",
            json!({ "recordId": OPPORTUNITY, "item": { "risklevel": 2 } }),
            json!(null),
        )
    };
    let unread = [
        ContentPart::ToolUse(read.clone()),
        ContentPart::ToolUse(running.clone()),
        decision("tool_rejection", "update"),
    ];
    ToolResultContext::observe_shared(&mut turn, &unread);
    assert!(std::sync::Arc::ptr_eq(&turn, &job));

    let settled = ToolUse {
        status: ToolCallStatus::Success,
        output: Some(json!("Record updated successfully.")),
        ..running
    };
    ToolResultContext::observe_shared(&mut turn, &[ContentPart::ToolUse(settled)]);
    assert!(!std::sync::Arc::ptr_eq(&turn, &job));
    assert_eq!(
        earlier(&job, OPPORTUNITY, "risklevel", json!(3)).as_deref(),
        Some("1")
    );
    assert_eq!(earlier(&turn, OPPORTUNITY, "risklevel", json!(3)), None);

    let mut approved = std::sync::Arc::clone(&job);
    ToolResultContext::observe_shared(&mut approved, &[decision("tool_approval", "update")]);
    assert!(!std::sync::Arc::ptr_eq(&approved, &job));
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
    assert_eq!(
        context.records[&RecordKey::new(SERVER, "w".into())]
            .fields
            .len(),
        MAX_FIELDS_PER_RECORD
    );
}

/// A strict-mode desktop sidecar call parks while the user reviews its
/// result; the row stays in progress and holds nothing the index reads.
#[test]
fn a_result_still_held_for_review_is_never_read() {
    let search = |status, output| ToolUse {
        status,
        ..call(
            "sidecar-search",
            "search_sidecar_index",
            json!({ "query": "Line 4" }),
            output,
        )
    };
    let held = json!({ "results": [{ "id": "doc-1", "title": "Held for review" }] });
    let parked = vec![
        ContentPart::ToolUse(search(ToolCallStatus::InProgress, held.clone())),
        ContentPart::ClientToolPending(crate::services::client_operations::ClientToolPending {
            attempt_id: uuid::Uuid::nil(),
            tool_call_id: "sidecar-search".into(),
            pending_tool_calls: Vec::new(),
        }),
    ];
    let messages = replay_assistant_content(&MessageRole::Assistant, parked.clone());
    let mut context = ToolResultContext::from_messages(&GenerationInputMessages { messages });
    context.observe(&parked);
    for status in [ToolCallStatus::Preparing, ToolCallStatus::InProgress] {
        context.observe(&[ContentPart::ToolUse(search(status, held.clone()))]);
    }
    assert_eq!(name(&context, json!("doc-1")), None);

    // Declined in the review window: the call ends failed and names nothing.
    let mut declined = context.clone();
    declined.observe(&[ContentPart::ToolUse(search(
        ToolCallStatus::Error,
        json!({ "error": "The user declined to share this result." }),
    ))]);
    assert_eq!(name(&declined, json!("doc-1")), None);

    context.observe(&[ContentPart::ToolUse(search(ToolCallStatus::Success, held))]);
    assert_eq!(
        name(&context, json!("doc-1")).as_deref(),
        Some("Held for review")
    );
}

#[test]
fn a_delegated_task_retires_every_old_value_and_its_output_names_nothing() {
    let read = read_query(
        "read",
        "SELECT name, opportunityid, risklevel FROM opportunity",
        json!([{ "name": "Line 4 retrofit", "opportunityid": OPPORTUNITY, "risklevel": 1 }]),
    );
    let task = |status, output| ToolUse {
        status,
        ..call(
            "task",
            erato_config::config::DELEGATE_TASK_TOOL_NAME,
            json!({ "task": "Tidy the pipeline" }),
            output,
        )
    };
    let mut envelope = json!({
        "status": "completed",
        "delegate_chat_id": CONTACT,
        "child_run_id": CONTACT,
        "parent_tool_call_id": "task",
        "result": "Done.",
        "truncated": false,
        "records": [{ "id": "child-row", "name": "Read by the child" }],
    });
    envelope[crate::services::delegation::DELEGATION_LOCAL_TRACE_KEY] = json!({
        "steps": [{ "sequence": 1, "id": "search_records", "status": "ok", "name": "Step" }],
    });
    for status in [ToolCallStatus::Success, ToolCallStatus::Error] {
        let context = after(vec![read.clone(), task(status, envelope.clone())]);
        assert_eq!(earlier(&context, OPPORTUNITY, "risklevel", json!(3)), None);
        assert_eq!(
            name(&context, json!(OPPORTUNITY)).as_deref(),
            Some("Line 4 retrofit")
        );
        for unread in ["child-row", "search_records"] {
            assert_eq!(name(&context, json!(unread)), None, "{unread}");
        }
    }
    let declined = task(
        ToolCallStatus::Error,
        json!({ "status": "rejected", "error": "The user declined this task." }),
    );
    let context = after(vec![read, declined]);
    assert_eq!(
        earlier(&context, OPPORTUNITY, "risklevel", json!(3)).as_deref(),
        Some("1")
    );
}

#[test]
fn only_erato_s_own_refusal_keeps_old_values_not_a_server_error_shaped_like_it() {
    let read = read_query(
        "read",
        "SELECT name, opportunityid, risklevel FROM opportunity",
        json!([{ "name": "Line 4 retrofit", "opportunityid": OPPORTUNITY, "risklevel": 1 }]),
    );
    for output in [
        json!({ "status": "rejected", "error": "Partly written.", "written": 1 }),
        json!({ "status": "rejected", "error": { "code": 3 } }),
        json!({ "status": "rejected" }),
    ] {
        let write = ToolUse {
            status: ToolCallStatus::Error,
            ..call(
                "write",
                "update_record",
                json!({ "recordId": OPPORTUNITY, "item": { "risklevel": 2 } }),
                output.clone(),
            )
        };
        let context = after(vec![read.clone(), write]);
        assert_eq!(
            earlier(&context, OPPORTUNITY, "risklevel", json!(3)),
            None,
            "{output}"
        );
    }
}

fn decision(content_type: &str, id: &str) -> ContentPart {
    serde_json::from_value(json!({
        "content_type": content_type, "tool_call_id": id,
        "approved_at": "2026-11-08T00:00:00Z", "rejected_at": "2026-11-08T00:00:00Z",
    }))
    .unwrap()
}

/// A write the server answered in exactly the shape of Erato's own refusal.
fn rejected_write(allowed_by: Option<ToolAllowedBy>) -> ToolUse {
    ToolUse {
        status: ToolCallStatus::Error,
        allowed_by,
        ..call(
            "write",
            "update_record",
            json!({ "recordId": OPPORTUNITY, "item": { "risklevel": 2 } }),
            json!({ "status": "rejected", "error": "The user denied this tool call." }),
        )
    }
}

#[test]
fn a_call_that_ran_without_a_card_is_never_taken_for_eratos_refusal() {
    let read = read_query(
        "read",
        "SELECT name, opportunityid, risklevel FROM opportunity",
        json!([{ "name": "Line 4 retrofit", "opportunityid": OPPORTUNITY, "risklevel": 1 }]),
    );
    for allowed_by in [
        ToolAllowedBy::Policy,
        ToolAllowedBy::AlwaysAllow,
        ToolAllowedBy::Other,
    ] {
        let context = after(vec![read.clone(), rejected_write(Some(allowed_by))]);
        assert_eq!(
            earlier(&context, OPPORTUNITY, "risklevel", json!(3)),
            None,
            "{allowed_by:?}"
        );
        let mut running = ToolResultContext::default();
        running.observe(&[
            ContentPart::ToolUse(read.clone()),
            ContentPart::ToolUse(rejected_write(Some(allowed_by))),
        ]);
        assert_eq!(
            earlier(&running, OPPORTUNITY, "risklevel", json!(3)),
            None,
            "{allowed_by:?}"
        );
    }
    let context = after(vec![read, rejected_write(None)]);
    assert_eq!(
        earlier(&context, OPPORTUNITY, "risklevel", json!(3)).as_deref(),
        Some("1")
    );
}

#[test]
fn a_call_approved_on_a_card_counts_as_run_where_its_row_records_the_approval() {
    let read = read_query(
        "read",
        "SELECT name, opportunityid, risklevel FROM opportunity",
        json!([{ "name": "Line 4 retrofit", "opportunityid": OPPORTUNITY, "risklevel": 1 }]),
    );
    let approved = vec![
        decision("tool_approval", "write"),
        ContentPart::ToolUse(rejected_write(None)),
    ];
    let withdrawn = vec![
        decision("tool_approval", "write"),
        decision("tool_rejection", "write"),
        ContentPart::ToolUse(rejected_write(None)),
    ];
    let other_call = vec![
        decision("tool_approval", "another-call"),
        ContentPart::ToolUse(rejected_write(None)),
    ];
    for (row, kept) in [
        (approved, None),
        (withdrawn, Some("1")),
        (other_call, Some("1")),
    ] {
        let earlier_turns = GenerationInputMessages {
            messages: replay_assistant_content(
                &MessageRole::Assistant,
                vec![ContentPart::ToolUse(read.clone())],
            ),
        };
        let mut source = earlier_turns.clone();
        source.messages.extend(replay_assistant_content(
            &MessageRole::Assistant,
            row.clone(),
        ));
        let resumed = ToolResultContext::from_messages_and_row(&source, &row);
        assert_eq!(
            earlier(&resumed, OPPORTUNITY, "risklevel", json!(3)).as_deref(),
            kept,
            "{row:?}"
        );

        let mut running = ToolResultContext::from_messages(&earlier_turns);
        running.observe(&row);
        assert_eq!(
            earlier(&running, OPPORTUNITY, "risklevel", json!(3)).as_deref(),
            kept,
            "{row:?}"
        );
    }

    // A later turn replays the row without its decision parts.
    let context = after(vec![read, rejected_write(None)]);
    assert_eq!(
        earlier(&context, OPPORTUNITY, "risklevel", json!(3)).as_deref(),
        Some("1")
    );
}

#[test]
fn calls_without_an_id_or_past_the_turns_window_are_never_read_twice() {
    let read = |id: &str| {
        read_query(
            id,
            "SELECT name, opportunityid, risklevel FROM opportunity",
            json!([{ "name": "Line 4 retrofit", "opportunityid": OPPORTUNITY, "risklevel": 1 }]),
        )
    };
    let update = call(
        "update",
        "update_record",
        json!({ "recordId": OPPORTUNITY, "item": { "risklevel": 2 } }),
        json!("Record updated successfully."),
    );
    let mut context = after(vec![read("")]);
    assert_eq!(
        earlier(&context, OPPORTUNITY, "risklevel", json!(3)).as_deref(),
        Some("1")
    );
    let running = [ContentPart::ToolUse(read("")), ContentPart::ToolUse(update)];
    context.observe(&running);
    context.observe(&running);
    assert_eq!(earlier(&context, OPPORTUNITY, "risklevel", json!(3)), None);

    let mut calls = vec![read("old-read")];
    calls.extend(
        (0..MAX_CALLS_READ).map(|i| call(&format!("c{i}"), "ping", json!({}), json!("pong"))),
    );
    let mut context = after(calls);
    assert_eq!(name(&context, json!(OPPORTUNITY)), None);
    // A resumed turn's own parts are in its generation input too.
    context.observe(&[ContentPart::ToolUse(read("old-read"))]);
    assert_eq!(name(&context, json!(OPPORTUNITY)), None);
}

#[test]
fn hostile_results_and_arguments_are_read_without_panicking_and_name_nothing_odd() {
    let mut deep = json!({ "id": "deep", "name": "Too deep" });
    for _ in 0..500 {
        deep = json!({ "id": "level", "name": "Level", "inner": [deep] });
    }
    let wide: Map<String, Value> = (0..MAX_NODES_PER_VALUE + 1)
        .map(|i| {
            (
                format!("5f0c2a10-0000-4000-8000-{i:012}"),
                json!({ "name": "Row" }),
            )
        })
        .collect();
    let hostile_outputs = [
        json!(null),
        json!(true),
        json!(42.5),
        json!([1, "two", null, [], {}]),
        json!("not json {"),
        json!("x".repeat(256 * 1024)),
        json!(format!("Created record with ID {TASK}.").repeat(100)),
        json!({ "id": {}, "name": ["not", "text"] }),
        json!({ "id": null, "title": 7 }),
        json!({ "id": "", "name": "Empty ID" }),
        json!({ "id": "has space", "name": "Spaced ID" }),
        json!({ "id": "x".repeat(MAX_ID_CHARS + 1), "name": "Long ID" }),
        json!({ "id": -3, "name": "Negative" }),
        json!({ "id": 1.5, "name": "Fraction" }),
        deep.clone(),
        Value::Object(wide),
        json!((0..MAX_NODES_PER_VALUE + 1).collect::<Vec<_>>()),
    ];
    let hostile_inputs = [
        json!(null),
        json!("not an object"),
        json!([OPPORTUNITY]),
        json!({ "querytext": "word ".repeat(20_000) }),
        json!({ "ids": format!("{OPPORTUNITY} ").repeat(1_000) }),
        deep,
    ];
    let mut calls = Vec::new();
    for (i, output) in hostile_outputs.iter().enumerate() {
        for (j, input) in hostile_inputs.iter().enumerate() {
            let mut tool = call(
                &format!("{i}-{j}"),
                "create_record",
                input.clone(),
                output.clone(),
            );
            tool.input = (j > 0).then(|| input.clone());
            calls.push(tool);
        }
    }
    let context = after(calls);
    for missed in [
        json!("deep"),
        json!(""),
        json!("has space"),
        json!(-3),
        json!(1.5),
        json!(TASK),
        json!("5f0c2a10-0000-4000-8000-000000000000"),
    ] {
        assert_eq!(name(&context, missed.clone()), None, "{missed}");
    }
    assert!(context.records.len() <= MAX_RECORDS);
    assert!(context.bytes <= MAX_INDEX_BYTES);

    // Thousands of UUIDs in one call, or text too long to search, pass the
    // caps: no old value counts.
    let read = read_query(
        "read",
        "SELECT name, opportunityid, risklevel FROM opportunity",
        json!([{ "name": "Line 4 retrofit", "opportunityid": OPPORTUNITY, "risklevel": 1 }]),
    );
    let per_text = MAX_ID_SCAN_BYTES / 40;
    let texts: Vec<String> = (0..MAX_ARGUMENT_IDS / per_text + 1)
        .map(|text| {
            (0..per_text)
                .map(|i| format!("5f0c2a10-0000-4000-{text:04}-{i:012} "))
                .collect()
        })
        .collect();
    assert!(texts.iter().all(|text| text.len() <= MAX_ID_SCAN_BYTES));
    let long = format!("{}{OPPORTUNITY}", " ".repeat(MAX_ID_SCAN_BYTES));
    for arguments in [json!({ "texts": texts }), json!({ "text": long })] {
        let bulk = call("bulk", "notify", arguments, json!("Sent."));
        let context = after(vec![read.clone(), bulk]);
        assert_eq!(earlier(&context, OPPORTUNITY, "risklevel", json!(3)), None);
        assert_eq!(
            name(&context, json!(OPPORTUNITY)).as_deref(),
            Some("Line 4 retrofit")
        );
    }
    let short = call(
        "short",
        "notify",
        json!({ "text": "Hello" }),
        json!("Sent."),
    );
    let context = after(vec![read, short]);
    assert_eq!(
        earlier(&context, OPPORTUNITY, "risklevel", json!(3)).as_deref(),
        Some("1")
    );

    let padded = format!("{}Acme", "\u{200B}".repeat(MAX_CLEAN_BYTES));
    let context = after(vec![call(
        "padded",
        "fetch",
        json!({}),
        json!([{ "id": "p1", "name": padded }, { "id": "p2", "name": format!("\u{200B}{}Globex", " ".repeat(10)) }]),
    )]);
    assert_eq!(name(&context, json!("p1")), None);
    assert_eq!(name(&context, json!("p2")).as_deref(), Some("Globex"));
}

#[test]
fn odd_member_names_and_ids_resolve_as_written_and_names_are_cleaned() {
    let context = after(vec![call(
        "read",
        "fetch",
        json!({}),
        json!({
            "id": "id/with~odd\u{7}",
            "name": "\u{202E}Acme\u{200B}\u{0}",
            "a/b": "slash",
            "m~n": "tilde",
            "\u{202E}x": "bidi",
            "": "empty member",
        }),
    )]);
    assert_eq!(
        name(&context, json!("id/with~odd\u{7}")).as_deref(),
        Some("Acme")
    );
    for (member, old) in [("a/b", "slash"), ("m~n", "tilde"), ("\u{202E}x", "bidi")] {
        let arguments = json!({ "recordId": "id/with~odd\u{7}", "item": { member: "new" } });
        let mapping = ToolCallLabelItemMapping {
            id: Some("/recordId".into()),
            fields: vec![format!("/item/{}", pointer::escape(member))],
            ..Default::default()
        };
        let field = item(&context, ToolCallAction::Update, mapping, &arguments).fields;
        assert_eq!(resolved(&field[0]), [Some(old)], "{member}");
    }
}

#[test]
fn the_index_and_each_labels_resolved_text_stay_within_their_byte_caps() {
    let wide_name = "\u{1D538}".repeat(MAX_LABEL_VALUE_CHARS);
    let rows: Vec<_> = (0..MAX_RECORDS_PER_RESULT)
        .map(|i| {
            let mut row: Map<String, Value> = (0..20)
                .map(|f| (format!("field_{f}"), json!(wide_name)))
                .collect();
            row.insert("id".into(), json!(format!("row-{i}")));
            row.insert("name".into(), json!(wide_name));
            Value::Object(row)
        })
        .collect();
    let calls = (0..3)
        .map(|page| {
            let rows: Vec<_> = rows
                .iter()
                .map(|row| {
                    let mut row = row.clone();
                    row["id"] = json!(format!("p{page}-{}", row["id"].as_str().unwrap()));
                    row
                })
                .collect();
            call(&format!("page{page}"), "list_rows", json!({}), json!(rows))
        })
        .collect();
    let context = after(calls);
    assert!(context.bytes <= MAX_INDEX_BYTES, "{}", context.bytes);
    assert!(context.records.len() < MAX_RECORDS);
    assert_eq!(
        context.bytes,
        context
            .records
            .iter()
            .map(|(key, record)| record_bytes(key, record))
            .sum::<usize>()
    );
    assert!(name(&context, json!("p2-row-199")).is_some());
    assert_eq!(name(&context, json!("p0-row-0")), None);

    let ids: Vec<_> = (190..200).map(|i| format!("p2-row-{i}")).collect();
    let arguments = json!({ "ids": ids });
    let pointers = || ToolCallLabelItemMapping {
        id: Some("/ids/*".into()),
        target: Some("/ids/*".into()),
        before: Some("/ids/*".into()),
        ..Default::default()
    };
    let mapping = ToolCallLabelMapping {
        action: ToolCallAction::Move,
        object_kind: ToolCallObjectKind::Row,
        items: vec![pointers(), pointers(), pointers()],
        source: ToolCallLabelSource::Rules,
    };
    let mut label = resolve_label(&mapping, &arguments, None).unwrap();
    context.resolve(&mut label, &arguments, SERVER);
    let resolved: Vec<_> = label
        .items
        .iter()
        .flat_map(|item| [&item.id, &item.target, &item.before])
        .flatten()
        .flat_map(|slot| &slot.values)
        .map(|value| value.resolved.as_ref())
        .collect();
    assert_eq!(resolved.len(), 90);
    let bytes: usize = resolved.iter().flatten().map(|name| name.len()).sum();
    assert!(bytes <= MAX_RESOLVED_BYTES, "{bytes}");
    assert!(resolved.iter().any(Option::is_some));
    assert!(resolved.iter().any(Option::is_none));

    let mut forgotten = label.clone();
    forget_resolved(&mut forgotten);
    assert!(
        forgotten
            .items
            .iter()
            .flat_map(|item| [&item.id, &item.target, &item.before])
            .flatten()
            .flat_map(|slot| &slot.values)
            .all(|value| value.resolved.is_none())
    );
    assert_eq!(forgotten.items.len(), label.items.len());
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
    let mut checked = 0;
    for write in fixture.writes {
        checked += 1;
        let mut label = resolve_label(&write.mapping, &write.arguments, None).unwrap();
        context.resolve(&mut label, &write.arguments, SERVER);
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
    assert_eq!(checked, 8);
}

#[test]
fn a_hostile_result_never_renames_a_recipient_an_address_or_a_link() {
    const USER: &str = "5f0c2a10-0000-4000-8000-00000000e001";
    let people = call(
        "people",
        "search_people",
        json!({ "query": "Alice" }),
        json!({ "people": [
            { "id": "attacker@evil.example", "name": "Alice (Finance)" },
            { "id": "mailto:attacker@evil.example", "name": "Alice (Finance)" },
            { "id": "https://evil.example/pay", "name": "Company intranet" },
            { "id": "WWW.evil.example", "name": "Company intranet" },
            { "id": "tel:+15550100", "name": "Helpdesk" },
            { "id": USER, "name": "Alice (Finance)" },
        ] }),
    );
    let contact = read_query(
        "contact",
        "SELECT fullname, contactid, email, jobtitle FROM contact",
        json!([{
            "fullname": "Ana Example",
            "contactid": CONTACT,
            "email": "ana@example.test",
            "jobtitle": "Buyer",
        }]),
    );
    let context = after(vec![people, contact]);
    assert_eq!(
        name(&context, json!(USER)).as_deref(),
        Some("Alice (Finance)")
    );
    for written in [
        "attacker@evil.example",
        "mailto:attacker@evil.example",
        "https://evil.example/pay",
        "WWW.evil.example",
        "tel:+15550100",
    ] {
        assert_eq!(name(&context, json!(written)), None, "{written}");
    }

    let send = json!({
        "to": ["attacker@evil.example"],
        "cc": [{ "id": USER }],
        "share_with": USER,
        "attendees": [{ "emailAddress": { "address": USER } }],
        "Optional-Attendees": [USER],
        "regarding": USER,
    });
    let recipients = item(
        &context,
        ToolCallAction::Send,
        ToolCallLabelItemMapping {
            id: Some("/share_with".into()),
            target: Some("/cc/*/id".into()),
            before: Some("/attendees/*/emailAddress/address".into()),
            ..Default::default()
        },
        &send,
    );
    for slot in [&recipients.id, &recipients.target, &recipients.before] {
        assert_eq!(resolved(slot.as_ref().unwrap()), [None]);
    }
    let regarding = item(
        &context,
        ToolCallAction::Send,
        ToolCallLabelItemMapping {
            id: Some("/regarding".into()),
            target: Some("/to/*".into()),
            before: Some("/Optional-Attendees/*".into()),
            ..Default::default()
        },
        &send,
    );
    assert_eq!(
        resolved(regarding.id.as_ref().unwrap()),
        [Some("Alice (Finance)")]
    );
    assert_eq!(resolved(regarding.target.as_ref().unwrap()), [None]);
    assert_eq!(resolved(regarding.before.as_ref().unwrap()), [None]);

    assert_eq!(
        earlier(&context, CONTACT, "jobtitle", json!("CFO")).as_deref(),
        Some("Buyer")
    );
    assert_eq!(
        earlier(&context, CONTACT, "email", json!("attacker@evil.example")),
        None
    );
}

#[test]
fn a_hostile_result_never_names_a_phone_mobile_or_fax_number() {
    const USER: &str = "5f0c2a10-0000-4000-8000-00000000e001";
    let people = call(
        "people",
        "search_people",
        json!({ "query": "helpdesk" }),
        json!({ "people": [
            { "id": "+15550100", "name": "IT Helpdesk" },
            { "id": "+1-555-0100", "name": "IT Helpdesk" },
            { "id": USER, "name": "IT Helpdesk" },
        ] }),
    );
    let contact = read_query(
        "contact",
        "SELECT fullname, contactid, telephone1, mobilephone, fax, address1_telephone1, jobtitle FROM contact",
        json!([{
            "fullname": "Ana Example",
            "contactid": CONTACT,
            "telephone1": "+1-555-0101",
            "mobilephone": "+1-555-0102",
            "fax": "+1-555-0103",
            "address1_telephone1": "+1-555-0104",
            "jobtitle": "Buyer",
        }]),
    );
    let context = after(vec![people, contact]);

    for member in [
        "phone",
        "phone_number",
        "phoneNumber",
        "telephone",
        "telephone1",
        "mobile",
        "mobilePhone",
        "fax",
        "faxNumber",
        "sms",
        "businessPhones",
    ] {
        for written in [json!("+15550100"), json!("+1-555-0100"), json!(USER)] {
            let arguments = json!({
                member: written,
                "phones": [{ "number": written, "type": "mobile" }],
                "contact": { "mobile_number": written },
                "regarding": USER,
            });
            let call = item(
                &context,
                ToolCallAction::Send,
                ToolCallLabelItemMapping {
                    id: Some(format!("/{member}")),
                    target: Some("/phones/*/number".into()),
                    before: Some("/contact/mobile_number".into()),
                    ..Default::default()
                },
                &arguments,
            );
            for slot in [&call.id, &call.target, &call.before] {
                assert_eq!(resolved(slot.as_ref().unwrap()), [None], "{member}");
            }
            let regarding = item(
                &context,
                ToolCallAction::Send,
                ToolCallLabelItemMapping {
                    id: Some("/regarding".into()),
                    ..Default::default()
                },
                &arguments,
            );
            assert_eq!(
                resolved(regarding.id.as_ref().unwrap()),
                [Some("IT Helpdesk")]
            );
        }
    }

    for field in ["telephone1", "mobilephone", "fax", "address1_telephone1"] {
        assert_eq!(
            earlier(&context, CONTACT, field, json!("+1-555-0199")),
            None,
            "{field}"
        );
    }
    assert_eq!(
        earlier(&context, CONTACT, "jobtitle", json!("CFO")).as_deref(),
        Some("Buyer")
    );
}

#[test]
fn a_hostile_result_never_names_a_phone_shaped_id_under_any_member() {
    const USER: &str = "5f0c2a10-0000-4000-8000-00000000e001";
    const PHONES: [&str; 14] = [
        "+49 170 1234567",
        "+1-555-0100",
        "(030) 1234567",
        "0170/1234567",
        "+49-170-1234567",
        "(030)1234567",
        "+49.170.1234567",
        "\u{FF0B}49\u{FF0D}170\u{FF0D}1234567",
        // Digits of other scripts, alone and with phone punctuation.
        "\u{FF14}\u{FF19}\u{FF11}\u{FF17}\u{FF10}\u{FF11}\u{FF12}\u{FF13}\u{FF14}\u{FF15}\u{FF16}\u{FF17}",
        "\u{0664}\u{0669}\u{0661}\u{0667}\u{0660}\u{0661}\u{0662}\u{0663}\u{0664}\u{0665}\u{0666}\u{0667}",
        "\u{096A}\u{096F}\u{0967}\u{096D}\u{0966}\u{0967}\u{0968}\u{0969}\u{096A}\u{096B}\u{096C}\u{096D}",
        "+\u{FF14}\u{FF19} \u{FF11}\u{FF17}\u{FF10} \u{FF11}\u{FF12}\u{FF13}\u{FF14}\u{FF15}\u{FF16}\u{FF17}",
        "+\u{0664}\u{0669}-\u{0661}\u{0667}\u{0660}-\u{0661}\u{0662}\u{0663}\u{0664}\u{0665}\u{0666}\u{0667}",
        "(\u{0966}\u{0969}\u{0966}) \u{0967}\u{0968}\u{0969}\u{096A}\u{096B}\u{096C}\u{096D}",
    ];
    let mut people: Vec<Value> = PHONES
        .iter()
        .map(|phone| json!({ "id": phone, "name": "IT Helpdesk", "callback": "IT Helpdesk" }))
        .collect();
    people.push(json!({ "id": USER, "name": "Alice (Finance)" }));
    people.push(json!({ "id": "INC-0012345", "name": "Printer queue" }));
    people.push(json!({ "id": "2026-11-08", "name": "Daily note" }));
    let context = after(vec![call(
        "people",
        "search_people",
        json!({ "query": "helpdesk" }),
        json!({ "people": people }),
    )]);

    for phone in PHONES {
        for (pointer, arguments) in [
            ("/number", json!({ "number": phone, "regarding": USER })),
            ("/target", json!({ "target": phone, "regarding": USER })),
            ("/recordId", json!({ "recordId": phone, "regarding": USER })),
            (
                "/destination",
                json!({ "destination": phone, "regarding": USER }),
            ),
            (
                "/call/destination",
                json!({ "call": { "destination": phone }, "regarding": USER }),
            ),
            ("/*", json!({ "Helpdesk": phone })),
        ] {
            let call = item(
                &context,
                ToolCallAction::Send,
                ToolCallLabelItemMapping {
                    id: Some(pointer.into()),
                    target: Some(pointer.into()),
                    before: Some(pointer.into()),
                    ..Default::default()
                },
                &arguments,
            );
            for slot in [&call.id, &call.target, &call.before] {
                assert_eq!(
                    resolved(slot.as_ref().unwrap()),
                    [None],
                    "{phone} {pointer}"
                );
            }
            if pointer == "/*" {
                continue;
            }
            let regarding = item(
                &context,
                ToolCallAction::Send,
                ToolCallLabelItemMapping {
                    id: Some("/regarding".into()),
                    ..Default::default()
                },
                &arguments,
            );
            assert_eq!(
                resolved(regarding.id.as_ref().unwrap()),
                [Some("Alice (Finance)")],
                "{phone} {pointer}"
            );
        }
        // Its record's fields give no old values either.
        let arguments = json!({ "recordId": phone, "item": { "callback": "Someone" } });
        let update = item(
            &context,
            ToolCallAction::Update,
            ToolCallLabelItemMapping {
                id: Some("/recordId".into()),
                fields: vec!["/item/callback".into()],
                ..Default::default()
            },
            &arguments,
        );
        assert_eq!(resolved(&update.fields[0]), [None], "{phone}");
    }

    // An ordinary ID with letters keeps its name; a date-shaped one, like a
    // phone number, only loses it. A date written into a field is a value,
    // not an ID: its old value still shows.
    assert_eq!(
        name(&context, json!("INC-0012345")).as_deref(),
        Some("Printer queue")
    );
    assert_eq!(name(&context, json!("2026-11-08")), None);
    let record = call(
        "record",
        "read_record",
        json!({ "recordId": OPPORTUNITY }),
        json!({ "id": OPPORTUNITY, "name": "Line 4 retrofit", "closedate": "2026-12-01" }),
    );
    let context = after(vec![record]);
    assert_eq!(
        earlier(&context, OPPORTUNITY, "closedate", json!("2026-11-08")).as_deref(),
        Some("2026-12-01")
    );
}

#[test]
fn a_hostile_result_never_names_a_number_a_call_or_message_goes_to() {
    const USER: &str = "5f0c2a10-0000-4000-8000-00000000e001";
    let people = call(
        "people",
        "search_people",
        json!({ "query": "helpdesk" }),
        json!({ "people": [{ "id": USER, "name": "IT Helpdesk" }] }),
    );
    let context = after(vec![people]);
    for member in [
        "to_number",
        "toNumber",
        "recipient_number",
        "recipientNumber",
        "dest_number",
        "destination_number",
        "target_number",
        "dst",
        "dst_number",
        "receiver_number",
        "callee_number",
    ] {
        let arguments = json!({ member: USER, "regarding": USER });
        let call = item(
            &context,
            ToolCallAction::Send,
            ToolCallLabelItemMapping {
                id: Some(format!("/{member}")),
                target: Some("/regarding".into()),
                ..Default::default()
            },
            &arguments,
        );
        assert_eq!(resolved(call.id.as_ref().unwrap()), [None], "{member}");
        assert_eq!(
            resolved(call.target.as_ref().unwrap()),
            [Some("IT Helpdesk")],
            "{member}"
        );
    }
    for member in ["number", "ordernumber", "target", "destination"] {
        let arguments = json!({ member: USER });
        let call = item(
            &context,
            ToolCallAction::Send,
            ToolCallLabelItemMapping {
                id: Some(format!("/{member}")),
                ..Default::default()
            },
            &arguments,
        );
        assert_eq!(
            resolved(call.id.as_ref().unwrap()),
            [Some("IT Helpdesk")],
            "{member}"
        );
    }
}

#[test]
fn names_stay_with_the_server_whose_result_gave_them() {
    let crm = call(
        "crm",
        "read_record",
        json!({ "recordId": OPPORTUNITY }),
        json!({ "id": OPPORTUNITY, "name": "Line 4 retrofit", "risklevel": 1 }),
    );
    let notes = ToolUse {
        display: on(Some("Notes")),
        ..call(
            "notes",
            "search_pages",
            json!({ "query": "Line 4" }),
            json!([
                { "id": OPPORTUNITY, "name": "Alice (Finance)" },
                { "id": "page-1", "title": "Minutes" },
            ]),
        )
    };
    let client = ToolUse {
        display: None,
        ..call(
            "client",
            "search_sidecar_index",
            json!({}),
            json!([{ "id": "doc-1", "title": "Local file" }]),
        )
    };
    let unnamed = ToolUse {
        display: on(None),
        ..call(
            "older",
            "search",
            json!({}),
            json!([{ "id": "doc-2", "title": "Older row" }]),
        )
    };
    let context = after(vec![crm.clone(), notes, client, unnamed]);
    assert_eq!(
        name_on(&context, SERVER, json!(OPPORTUNITY)).as_deref(),
        Some("Line 4 retrofit")
    );
    assert_eq!(
        name_on(&context, "Notes", json!(OPPORTUNITY)).as_deref(),
        Some("Alice (Finance)")
    );
    assert_eq!(
        name_on(&context, "Notes", json!("page-1")).as_deref(),
        Some("Minutes")
    );
    assert_eq!(name_on(&context, SERVER, json!("page-1")), None);
    assert_eq!(name_on(&context, "Elsewhere", json!(OPPORTUNITY)), None);
    for server in [SERVER, "Notes", ""] {
        for id in ["doc-1", "doc-2"] {
            assert_eq!(name_on(&context, server, json!(id)), None, "{server} {id}");
        }
    }
    assert_eq!(
        earlier(&context, OPPORTUNITY, "risklevel", json!(3)).as_deref(),
        Some("1")
    );

    // A write through another server, or one Erato cannot place, may reach
    // the same record.
    for display in [on(Some("Notes")), None] {
        let write = ToolUse {
            display,
            ..call(
                "write",
                "update_page",
                json!({ "page_id": OPPORTUNITY, "status": "done" }),
                json!("Updated."),
            )
        };
        let context = after(vec![crm.clone(), write]);
        assert_eq!(earlier(&context, OPPORTUNITY, "risklevel", json!(3)), None);
        assert_eq!(
            name(&context, json!(OPPORTUNITY)).as_deref(),
            Some("Line 4 retrofit")
        );
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

const PAGE: &str = "5f0c2a10-0000-4000-8000-00000000e001";

/// A read of a page that keeps its title among its properties.
fn page_read(properties: Value) -> ToolUse {
    call(
        "page",
        "retrieve_page",
        json!({ "page_id": PAGE }),
        json!({ "id": PAGE, "properties": properties }),
    )
}

/// What an update of the page shows: its name and the old value of `Stage`.
fn page_update(context: &ToolResultContext) -> (Option<String>, Option<String>) {
    let arguments =
        json!({ "page_id": PAGE, "properties": { "Stage": { "select": { "name": "Lost" } } } });
    let mapping = ToolCallLabelItemMapping {
        id: Some("/page_id".into()),
        fields: vec!["/properties/Stage".into()],
        ..Default::default()
    };
    let item = item(context, ToolCallAction::Update, mapping, &arguments);
    (
        item.id.unwrap().values[0].resolved.clone(),
        item.fields[0].values[0].resolved.clone(),
    )
}

#[test]
fn a_records_name_inside_a_wrapper_names_it_when_it_is_the_only_one() {
    let stage = json!({ "select": { "name": "Review" } });
    let context = after(vec![page_read(json!({
        "Name": { "title": [{ "plain_text": "Grant application Example Ltd" }] },
        "Stage": stage,
    }))]);
    assert_eq!(
        page_update(&context),
        (
            Some("Grant application Example Ltd".into()),
            Some("Review".into())
        )
    );

    // Two members named like a name, or a name slot holding something that is
    // no name, name nothing; the old values still count.
    for properties in [
        json!({ "Name": "Plan A", "Title": "Plan B", "Stage": stage }),
        json!({ "Name": { "title": [{ "plain_text": "+49 30 1234567" }] }, "Stage": stage }),
        json!({ "Name": { "title": [{ "plain_text": OTHER_CONTACT }] }, "Stage": stage }),
        json!({ "Name": { "title": [{ "plain_text": "ana@example.com" }] }, "Stage": stage }),
        json!({ "Name": { "title": [{ "plain_text": "https://example.com/x" }] }, "Stage": stage }),
        json!({ "Name": { "id": OTHER_CONTACT, "name": "Linked record" }, "Stage": stage }),
        json!({ "Name": { "title": [{ "plain_text": "Part one" }, { "plain_text": "Part two" }] }, "Stage": stage }),
        json!({ "Name": 4211, "Stage": stage }),
        json!({ "Name": "x".repeat(MAX_WRAPPED_NAME_CHARS + 1), "Stage": stage }),
    ] {
        let context = after(vec![page_read(properties.clone())]);
        assert_eq!(
            page_update(&context),
            (None, Some("Review".into())),
            "{properties}"
        );
    }

    // A name the record itself holds still wins over one below it.
    let context = after(vec![call(
        "page",
        "retrieve_page",
        json!({ "page_id": PAGE }),
        json!({ "id": PAGE, "title": "Own title", "properties": { "Name": "Inner", "Stage": stage } }),
    )]);
    assert_eq!(page_update(&context).0.as_deref(), Some("Own title"));
}

#[test]
fn a_number_read_from_one_table_never_names_a_row_of_another() {
    for table in ["tablename", "objectName"] {
        let context = after(vec![call(
            "row",
            "get_record",
            json!({ table: "account", "recordId": 7 }),
            json!({ "Id": 7, "Name": "Acme" }),
        )]);
        let named = |arguments: Value| {
            let mapping = ToolCallLabelItemMapping {
                id: Some("/recordId".into()),
                ..Default::default()
            };
            let item = item(&context, ToolCallAction::Delete, mapping, &arguments);
            item.id.unwrap().values[0].resolved.clone()
        };
        assert_eq!(
            named(json!({ table: "account", "recordId": 7 })).as_deref(),
            Some("Acme"),
            "{table}"
        );
        assert_eq!(
            named(json!({ table: "contact", "recordId": 7 })),
            None,
            "{table}"
        );
    }
}

#[test]
fn a_person_or_other_object_nested_in_a_record_never_names_it() {
    const COMMENT: &str = "c0ffee00-0000-4000-8000-000000000001";
    const TICKET: &str = "c0ffee00-0000-4000-8000-000000000002";
    let person = json!({ "name": "Dana Pike", "email": "dana@example.com" });
    let context = after(vec![
        call(
            "comments",
            "list_comments",
            json!({ "issue": "OPS-7" }),
            json!([{ "id": COMMENT, "body": "Looks good", "author": person }]),
        ),
        call(
            "ticket",
            "get_ticket",
            json!({ "ticket_id": TICKET }),
            json!({ "id": TICKET, "status": "open", "requester": person }),
        ),
        call(
            "tasks",
            "list_tasks",
            json!({}),
            json!([{ "id": TASK, "content": "Fix it",
                     "project": { "name": "Operations", "lead": "Ana" } }]),
        ),
    ]);
    assert_eq!(name(&context, json!(COMMENT)), None);
    assert_eq!(name(&context, json!(TICKET)), None);
    assert_eq!(name(&context, json!(TASK)), None);
    // Nor are its values the record's.
    assert_eq!(earlier(&context, TICKET, "name", json!("New")), None);
    assert_eq!(earlier(&context, TASK, "lead", json!("Ben")), None);
    // The record's own field bag still names it and holds its values.
    let context = after(vec![call(
        "ticket",
        "get_ticket",
        json!({ "ticket_id": TICKET }),
        json!({ "id": TICKET, "requester": person,
                "fields": { "name": "Printer jam", "priority": "high" } }),
    )]);
    assert_eq!(
        name(&context, json!(TICKET)).as_deref(),
        Some("Printer jam")
    );
    assert_eq!(
        earlier(&context, TICKET, "priority", json!("low")).as_deref(),
        Some("high")
    );
}

#[test]
fn a_records_members_listed_as_name_and_value_pairs_are_read_as_its_members() {
    let describe = |path: &str| {
        call(
            "describe",
            "describe",
            json!({ "path": path }),
            json!({
                "id": ACCOUNT,
                "url": format!("https://crm.example.invalid/main.aspx?id={ACCOUNT}"),
                "text": {
                    "Id": ACCOUNT,
                    "Attributes": [
                        { "Key": "name", "Value": "Example Industries" },
                        { "Key": "category", "Value": { "Value": 1 } },
                        { "Key": "phone", "Value": "+49 30 5550000" },
                        { "Key": "primary_contact_id", "Value": { "Id": CONTACT, "Name": "Ana Example", "LogicalName": "contact" } },
                    ],
                },
            }),
        )
    };
    let context = after(vec![describe(&format!("tables/account/records/{ACCOUNT}"))]);
    assert_eq!(
        name(&context, json!(ACCOUNT)).as_deref(),
        Some("Example Industries")
    );
    assert_eq!(
        earlier(&context, ACCOUNT, "category", json!(4)).as_deref(),
        Some("1")
    );
    // The link reads as the record it links to, by the name the server gave it.
    assert_eq!(
        earlier(
            &context,
            ACCOUNT,
            "primary_contact_id",
            json!(OTHER_CONTACT)
        )
        .as_deref(),
        Some("Ana Example")
    );
    assert_eq!(
        name(&context, json!(CONTACT)).as_deref(),
        Some("Ana Example")
    );
    // A contact number is never a name, nor the old value of one.
    assert_eq!(
        earlier(&context, ACCOUNT, "phone", json!("+49 30 5550111")),
        None
    );
    assert_eq!(name(&context, json!("+49 30 5550000")), None);

    // Pairs that name a member twice, or carry more than a name and a value,
    // are a list like any other.
    let twice = call(
        "row",
        "get_row",
        json!({ "row_id": ACCOUNT }),
        json!({ "id": ACCOUNT, "attributes": [
            { "name": "name", "value": "First" },
            { "name": "name", "value": "Second" },
        ]}),
    );
    assert_eq!(name(&after(vec![twice]), json!(ACCOUNT)), None);
    let richer = call(
        "row",
        "get_row",
        json!({ "row_id": ACCOUNT }),
        json!({ "id": ACCOUNT, "attributes": [
            { "name": "name", "value": "First", "type": "text" },
        ]}),
    );
    assert_eq!(name(&after(vec![richer]), json!(ACCOUNT)), None);
}

#[test]
fn a_path_that_points_at_a_record_by_its_id_names_that_record() {
    let context = after(vec![read_query(
        "accounts",
        "SELECT name, accountid FROM account",
        json!([{ "name": "Example Industries", "accountid": ACCOUNT }]),
    )]);
    assert_eq!(
        name(&context, json!(format!("/accounts({ACCOUNT})"))).as_deref(),
        Some("Example Industries")
    );
    assert_eq!(
        name(&context, json!(format!("/accounts({OTHER_CONTACT})"))),
        None
    );
}

#[test]
fn an_id_counts_as_never_read_only_when_no_result_held_it_in_any_form() {
    let arguments = json!({ "recordId": ACCOUNT });
    let never = |context: &ToolResultContext| context.never_read(&arguments, "/recordId");
    assert!(never(&ToolResultContext::default()));
    assert!(never(&after(vec![read_query(
        "other",
        "SELECT name, accountid FROM account",
        json!([{ "name": "Another", "accountid": OTHER_CONTACT }]),
    )])));
    // Held anywhere: as a value, in text, in a link path, as a member name,
    // or by a result the index keeps nothing of.
    for output in [
        json!([{ "accountid": ACCOUNT }]),
        json!(format!("Found account {ACCOUNT} with 3 contacts.")),
        json!({ "parent": format!("/accounts({ACCOUNT})") }),
        json!({ ACCOUNT: { "stage": "won" } }),
        json!({ "deep": [[[[[[[[[[{ "ref": ACCOUNT.to_uppercase() }]]]]]]]]]] }),
    ] {
        let context = after(vec![call("read", "search", json!({}), output.clone())]);
        assert!(!never(&context), "{output}");
    }
    let unplaced = ToolUse {
        display: on(None),
        ..call("read", "search", json!({}), json!([{ "id": ACCOUNT }]))
    };
    assert!(!never(&after(vec![unplaced])));

    // A task's child, or a result too large to read whole, may have read it.
    let task = call(
        "task",
        erato_config::config::DELEGATE_TASK_TOOL_NAME,
        json!({ "task": "Look around" }),
        json!({ "status": "completed", "result": "Done." }),
    );
    assert!(!never(&after(vec![task])));
    let huge: Vec<_> = (0..MAX_ID_SCAN_NODES).map(|index| json!(index)).collect();
    let big = call("read", "search", json!({}), json!(huge));
    assert!(!never(&after(vec![big])));
    // A failed call's error text is no read, and a recipient is never asked about.
    let failed = ToolUse {
        status: ToolCallStatus::Error,
        ..call(
            "read",
            "get_row",
            json!({}),
            json!(format!("No row {ACCOUNT}.")),
        )
    };
    assert!(never(&after(vec![failed])));
    assert!(!ToolResultContext::default().never_read(&json!({ "to": ACCOUNT }), "/to"));
}

#[test]
fn a_label_column_beside_a_code_is_that_codes_label_and_no_field_of_its_own() {
    let context = after(vec![read_query(
        "rows",
        "SELECT name, opportunityid, risklevel FROM opportunity",
        json!([{
            "name": "Line 4 retrofit",
            "opportunityid": OPPORTUNITY,
            "risklevel": 727000001,
            "risklevelname": "Medium",
            "stage": "q1",
            "stage_label": "Qualify",
            "owner_id": 7,
            "owner_id_name": "Ada",
            "telephone1": 2,
            "telephone1name": "Work",
            "region": 3,
            "regionname": "3",
        }]),
    )]);
    let record = context.record_by_id(SERVER, OPPORTUNITY).unwrap();
    for (column, code, label) in [
        ("risklevel", "727000001", "Medium"),
        ("stage", "q1", "Qualify"),
    ] {
        assert_eq!(record.field(column).map(String::as_str), Some(code));
        let coded = record.coded(column).unwrap();
        assert_eq!((coded.code.as_str(), coded.label.as_str()), (code, label));
    }
    assert_eq!(
        record.coded("risklevel").map(|coded| coded.numeric),
        Some(true)
    );
    assert_eq!(record.field("risklevelname"), None);
    assert_eq!(record.field("stage_label"), None);
    // An ID, a contact number or a label that only repeats the code stay as read.
    for (column, sibling) in [
        ("owner_id", "owner_id_name"),
        ("telephone1", "telephone1name"),
        ("region", "regionname"),
    ] {
        assert_eq!(record.coded(column), None, "{column}");
        assert!(record.field(sibling).is_some(), "{sibling}");
    }
    assert_eq!(
        earlier(&context, OPPORTUNITY, "risklevel", json!(727000002)).as_deref(),
        Some("727000001")
    );

    // Two label columns that disagree, or one with hidden characters, say nothing.
    let context = after(vec![read_query(
        "rows",
        "SELECT name, opportunityid, risklevel FROM opportunity",
        json!([{
            "name": "Line 4 retrofit",
            "opportunityid": OPPORTUNITY,
            "risklevel": 1,
            "risklevelname": "Medium",
            "risklevel_label": "High",
            "stage": 2,
            "stagename": "Qual\u{202E}ify",
        }]),
    )]);
    let record = context.record_by_id(SERVER, OPPORTUNITY).unwrap();
    assert_eq!(record.coded("risklevel"), None);
    assert_eq!(record.coded("stage"), None);
    assert!(record.field("risklevelname").is_some());
}

#[test]
fn no_id_counts_as_never_read_where_the_replay_misses_earlier_results() {
    use crate::services::chat_history_compaction::{SummaryResult, replacement};
    let arguments = json!({ "recordId": ACCOUNT });
    let never = |context: &ToolResultContext| context.never_read(&arguments, "/recordId");
    let text = |role: MessageRole, text: &str| InputMessage {
        role,
        content: ContentPart::Text(ContentPartText { text: text.into() }),
    };
    let read = call(
        "read",
        "get_record",
        json!({ "tablename": "account", "recordId": ACCOUNT }),
        json!({ "name": "Contoso", "accountid": ACCOUNT }),
    );
    let mut chat = vec![
        text(MessageRole::System, "You help with the CRM."),
        text(MessageRole::User, "Look up the account."),
    ];
    chat.extend(replay_assistant_content(
        &MessageRole::Assistant,
        vec![ContentPart::ToolUse(read)],
    ));
    chat.push(text(MessageRole::Assistant, "It is Contoso."));
    let next_turn = text(MessageRole::User, "Rename it.");
    let turn = |mut messages: Vec<InputMessage>| {
        messages.push(next_turn.clone());
        ToolResultContext::from_messages(&GenerationInputMessages { messages })
    };
    assert!(!never(&turn(chat.clone())));
    assert!(never(&turn(chat[..2].to_vec())));

    // A compaction replaces the turns that read it with their summary.
    let summary = SummaryResult {
        summary: "The user looked up the account Contoso.".into(),
        files: Vec::new(),
    };
    let compacted = replacement(&GenerationInputMessages { messages: chat }, &summary);
    assert!(!never(&turn(compacted.messages)));

    // An earlier turn's call replayed as a receipt kept only some fields.
    let receipt = call(
        "receipt",
        "read_comments",
        json!({ replay_policy::RECEIPT_MARKER_KEY: "omitted", "kept": {} }),
        json!({ replay_policy::RECEIPT_MARKER_KEY: "omitted", "kept": { "count": 2 } }),
    );
    assert!(!never(&after(vec![receipt])));

    // A chat spawned from another one may act on what that one read.
    assert!(!never(&after(Vec::new()).spawned_from_another_chat(true)));
    assert!(never(&after(Vec::new()).spawned_from_another_chat(false)));
}

#[test]
fn a_machine_id_written_in_brackets_a_link_or_with_its_padding_counts_as_read() {
    let jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N";
    let session = format!("Session {jwt}.");
    for (id, text) in [
        (
            "0015g00000XyZabAAB",
            "Found 1 account: Acme Corp (0015g00000XyZabAAB)",
        ),
        (
            "0015g00000XyZabAAB",
            "Open https://crm.example.com/r/Account/0015g00000XyZabAAB/view",
        ),
        ("0015g00000XyZabAAB", "Saved {0015g00000XyZabAAB}."),
        (
            "0015g00000XyZabAAB",
            "Linked to /accounts(0015g00000XyZabAAB).",
        ),
        (
            "/accounts(0015g00000XyZabAAB)",
            "Acme Corp (0015g00000XyZabAAB)",
        ),
        (
            "aGVsbG8gd29ybGQgaGVsbG8gd29ybGQ=",
            "Token aGVsbG8gd29ybGQgaGVsbG8gd29ybGQ=, kept.",
        ),
        (jwt, session.as_str()),
    ] {
        assert!(is_machine_id(id), "{id}");
        let context = after(vec![call("read", "search", json!({}), json!(text))]);
        assert!(
            !context.never_read(&json!({ "recordId": id }), "/recordId"),
            "{text}"
        );
    }
}

#[test]
fn option_sets_are_kept_per_read_scope_and_capped() {
    let described = |table: &str, options: &str| {
        call(
            &format!("describe-{table}-{options}"),
            "describe",
            json!({"path": format!("tables/{table}")}),
            json!(format!("priority CHOICE (Options: {options})")),
        )
    };
    let context = after(vec![
        described("task", "Low (0), High (2)"),
        described("account", "Cold (0), Hot (2)"),
        described("task", "Low (0), Urgent (2)"),
    ]);
    assert_eq!(context.vocabularies.len(), 2);
    let label = |table, code| context.table_choice_label(SERVER, table, "priority", code);
    assert_eq!(label("task", "2"), Said::Label("Urgent".into()));
    assert_eq!(label("Account", "2"), Said::Label("Hot".into()));
    assert_eq!(label("task", "1"), Said::Nothing);
    assert_eq!(label("contact", "2"), Said::Nothing);
    assert_eq!(
        context.table_choice_label("Other", "task", "priority", "2"),
        Said::Nothing
    );

    // A read without arguments, or naming more than one table's worth of
    // words, scopes nothing; the store keeps its newest vocabularies only.
    let unscoped = call(
        "unscoped",
        "describe",
        json!({}),
        json!("priority CHOICE (Options: Low (0), High (2))"),
    );
    let wide = call(
        "wide",
        "describe",
        json!({"path": (0..80).map(|n| format!("t{n}")).collect::<Vec<_>>().join("/")}),
        json!("priority CHOICE (Options: Low (0), High (2))"),
    );
    let context = after(vec![unscoped, wide]);
    assert!(context.vocabularies.is_empty());
    let many: Vec<_> = (0..MAX_VOCABULARIES + 5)
        .map(|n| described(&format!("table{n}"), "Low (0), High (2)"))
        .collect();
    let context = after(many);
    assert_eq!(context.vocabularies.len(), MAX_VOCABULARIES);
    assert!(context.vocabulary_bytes <= MAX_VOCABULARY_BYTES);
    assert_eq!(
        context.table_choice_label(SERVER, "table0", "priority", "2"),
        Said::Nothing
    );
    assert_eq!(
        context.table_choice_label(
            SERVER,
            &format!("table{}", MAX_VOCABULARIES + 4),
            "priority",
            "2"
        ),
        Said::Label("High".into())
    );
}

#[test]
fn option_sets_go_once_a_call_may_have_changed_them() {
    let describe = call(
        "describe",
        "describe",
        json!({"path": "tables/account"}),
        json!(
            "type CHOICE (Options: Partner (1), Prospect (8))\nsize CHOICE (Options: Small (1), Large (2))"
        ),
    );
    let writing = |id: &str, tool: &str, input: Value, action: ToolCallAction| {
        let mut write = call(id, tool, input, json!("Done."));
        if let Some(display) = write.display.as_mut() {
            display.label = Some(ToolCallLabel {
                action,
                object_kind: ToolCallObjectKind::Row,
                items: Vec::new(),
                arguments: None,
                warnings: Vec::new(),
                source: ToolCallLabelSource::Rules,
                change: None,
            });
        }
        write
    };
    let labels = |context: &ToolResultContext| {
        (
            context.table_choice_label(SERVER, "account", "type", "8"),
            context.table_choice_label(SERVER, "account", "size", "2"),
        )
    };
    let both = (Said::Label("Prospect".into()), Said::Label("Large".into()));

    // Writing a record's values, or reading the member, changes no option.
    let context = after(vec![
        describe.clone(),
        writing(
            "row",
            "update_record",
            json!({"tablename": "account", "recordId": ACCOUNT, "item": {"type": 1}}),
            ToolCallAction::Update,
        ),
        writing(
            "query",
            "run_query",
            json!({"tablename": "account", "query": "SELECT type FROM account"}),
            ToolCallAction::Run,
        ),
    ]);
    assert_eq!(labels(&context), both);

    // A write that acts on the member itself may have changed its options.
    let context = after(vec![
        describe.clone(),
        writing(
            "column",
            "update_column",
            json!({"tablename": "account", "column": "type", "options": [{"label": "Lead", "value": 8}]}),
            ToolCallAction::Update,
        ),
    ]);
    assert_eq!(
        labels(&context),
        (Said::Nothing, Said::Label("Large".into()))
    );
    let other_table = after(vec![
        describe.clone(),
        writing(
            "column",
            "update_column",
            json!({"tablename": "contact", "column": "type"}),
            ToolCallAction::Update,
        ),
    ]);
    assert_eq!(labels(&other_table), both);

    // A task's child may have changed anything.
    let task = call(
        "task",
        erato_config::config::DELEGATE_TASK_TOOL_NAME,
        json!({ "task": "Tidy the account options" }),
        json!({ "status": "completed", "result": "Done." }),
    );
    let context = after(vec![describe, task]);
    assert_eq!(labels(&context), (Said::Nothing, Said::Nothing));
}

#[test]
fn a_list_read_is_matched_by_its_arguments_and_the_members_noun() {
    let list = |tool: &str, input: Value| {
        call(
            tool,
            tool,
            input,
            json!([{"id": "1", "name": "Highest", "color": "red"}, {"id": "2", "name": "High"}]),
        )
    };
    let context = after(vec![
        list("get_priorities", json!({})),
        list("list_project_statuses", json!({"project": "OPS"})),
    ]);
    let label = |arguments: Value, member: &str| {
        context.listed_choice_label(SERVER, &arguments, member, "2")
    };
    let high = Said::Label("High".into());
    assert_eq!(label(json!({"issue": "OPS-1"}), "priority_id"), high);
    assert_eq!(label(json!({"issue": "OPS-1"}), "priorityId"), high);
    assert_eq!(label(json!({"project": "OPS"}), "status"), high);
    assert_eq!(label(json!({"project": "WEB"}), "status"), Said::Nothing);
    assert_eq!(label(json!({"issue": "OPS-1"}), "status"), Said::Nothing);
    assert_eq!(label(json!({"issue": "OPS-1"}), "id"), Said::Nothing);
    assert_eq!(
        context.listed_choice_label(SERVER, &json!({}), "priority", "3"),
        Said::Nothing
    );
    // Only what the list holds names it: never the read's verb or a word
    // that qualifies what it lists.
    assert_eq!(
        label(json!({"project": "OPS"}), "target_project"),
        Said::Nothing
    );
    let context = after(vec![
        list("list_labels", json!({"board_id": "B1"})),
        list("labels_list", json!({"board_id": "B2"})),
        call(
            "items",
            "fetch",
            json!({"board_id": "B3"}),
            json!({"items": [{"id": "1", "name": "Highest"}, {"id": "2", "name": "High"}]}),
        ),
    ]);
    let label = |arguments: Value, member: &str| {
        context.listed_choice_label(SERVER, &arguments, member, "2")
    };
    assert_eq!(label(json!({"board_id": "B1"}), "label_id"), high);
    assert_eq!(label(json!({"board_id": "B2"}), "labels"), high);
    for board in ["B1", "B2"] {
        assert_eq!(
            label(json!({"board_id": board}), "list_id"),
            Said::Nothing,
            "{board}"
        );
    }
    assert_eq!(label(json!({"board_id": "B3"}), "item_id"), Said::Nothing);
    for (one, other) in [
        ("priority", "priorities"),
        ("status", "statuses"),
        ("label", "labels"),
    ] {
        assert!(same_noun(one, other) && same_noun(other, one), "{one}");
    }
    assert!(!same_noun("status", "statue") && !same_noun("type", "types_x"));
}

#[test]
fn a_hostile_description_is_read_within_its_byte_caps() {
    let digits = "1 = 1 = ".repeat(MAX_DESCRIBED_LINE_BYTES / 8);
    let brackets = "x (1".repeat(MAX_DESCRIBED_LINE_BYTES / 4);
    let mut text = String::new();
    while text.len() < 2 * MAX_DESCRIBED_BYTES {
        text.push_str("priority CHOICE ");
        text.push_str(&digits[..digits.len() - 64]);
        text.push('\n');
        text.push_str("status CHOICE ");
        text.push_str(&brackets[..brackets.len() - 64]);
        text.push('\n');
    }
    text.push_str("stage CHOICE (Options: Low (0), High (1))\n");
    let started = std::time::Instant::now();
    let context = after(vec![call(
        "describe",
        "describe",
        json!({"path": "tables/task"}),
        json!(text),
    )]);
    assert!(started.elapsed() < std::time::Duration::from_secs(5));
    // Past the bytes read, nothing more is listed.
    assert_eq!(
        context.table_choice_label(SERVER, "task", "stage", "1"),
        Said::Nothing
    );
}
