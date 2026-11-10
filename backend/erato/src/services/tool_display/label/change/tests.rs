use super::*;
use crate::models::message::{
    ContentPart, GenerationInputMessages, MessageRole, ToolCallLabelSource, ToolCallObjectKind,
    ToolCallStatus, ToolDisplayMetadata, ToolUse,
};
use crate::models::message::{ToolCallValueMeaning, ToolCallValueMeaningSource};
use crate::services::mcp_tool_annotations::McpToolAnnotationSource;
use crate::services::prompt_composition::transforms::replay_assistant_content;
use crate::services::tool_display::label::arguments::MAX_LIST_ENTRIES;
use crate::services::tool_display::label::rules::rules_label;
use crate::services::tool_display::label::{ToolCallLabelMapping, checked_label};
use rmcp::model::{JsonObject, Tool, ToolAnnotations};
use serde_json::json;

const RECORD: &str = "5f0c2a10-0000-4000-8000-00000000a001";
const ACCOUNT: &str = "5f0c2a10-0000-4000-8000-00000000c001";
const SERVER: &str = "CRM";

fn tool(name: &str, description: &str, destructive: Option<bool>) -> Tool {
    let mut tool = Tool::new(name.to_string(), description.to_string(), JsonObject::new());
    tool.annotations =
        destructive.map(|hint| ToolAnnotations::from_raw(None, None, Some(hint), None, None));
    tool
}

fn earlier(results: Vec<(&str, Value, Value)>) -> ToolResultContext {
    let messages = results
        .into_iter()
        .enumerate()
        .flat_map(|(index, (name, input, output))| {
            replay_assistant_content(
                &MessageRole::Assistant,
                vec![ContentPart::ToolUse(ToolUse {
                    tool_call_id: format!("read-{index}"),
                    status: ToolCallStatus::Success,
                    tool_name: name.into(),
                    display: Some(ToolDisplayMetadata {
                        title: "Read".into(),
                        description: None,
                        description_truncated: false,
                        server_name: Some(SERVER.into()),
                        label: None,
                        read_only: false,
                    }),
                    input: Some(input),
                    output: Some(output),
                    ..Default::default()
                })],
            )
        })
        .collect();
    ToolResultContext::from_messages(&GenerationInputMessages { messages })
}

fn labelled(tool: &Tool, arguments: &Value, context: &ToolResultContext) -> ToolCallLabel {
    let rules = rules_label(&tool.name, arguments, tool.annotations.as_ref(), None);
    let mut label = checked_label(SERVER, tool, arguments, &rules.mapping, None);
    context.resolve(&mut label, arguments, SERVER);
    label
}

fn change_with(
    tool: &Tool,
    arguments: Value,
    context: &ToolResultContext,
) -> (ToolCallChange, bool) {
    let label = labelled(tool, &arguments, context);
    describe(
        &label,
        ChangeFacts {
            tool,
            arguments: &arguments,
            approval_argument: None,
            context,
            server: Some(SERVER),
            rules_action: label.action,
            glossary: None,
            destructive_hint_source: Default::default(),
        },
    )
    .expect("a labelled call has a change description")
}

fn change_of(name: &str, arguments: Value) -> ToolCallChange {
    change_with(
        &tool(name, "", None),
        arguments,
        &ToolResultContext::default(),
    )
    .0
}

fn effect<'a>(change: &'a ToolCallChange, name: &str) -> &'a ToolCallEffect {
    change
        .effects
        .iter()
        .find(|effect| effect.raw_name == name)
        .unwrap_or_else(|| panic!("no effect for {name}: {change:#?}"))
}

fn texts(values: &[ToolCallEffectValue]) -> Vec<&str> {
    values.iter().map(|value| value.text.as_str()).collect()
}

#[test]
fn a_call_with_no_verb_has_no_change_description() {
    let label = ToolCallLabel {
        action: ToolCallAction::Other,
        object_kind: ToolCallObjectKind::Other,
        items: Vec::new(),
        arguments: None,
        warnings: Vec::new(),
        source: ToolCallLabelSource::Rules,
        change: None,
    };
    let arguments = json!({});
    let context = ToolResultContext::default();
    assert!(
        describe(
            &label,
            ChangeFacts {
                tool: &tool("x", "", None),
                arguments: &arguments,
                approval_argument: None,
                context: &context,
                server: None,
                rules_action: label.action,
                glossary: None,
                destructive_hint_source: Default::default(),
            },
        )
        .is_none()
    );
}

#[test]
fn names_are_readable_and_a_prefix_only_goes_when_most_keys_share_it() {
    let change = change_of(
        "update_record",
        json!({
            "id": "r1",
            "fields": {
                "ppt_cx_reach_out_timing": 3,
                "ppt_renewal_due_on": "2026-12-31",
                "ppt_lic_seat_cnt": 250,
                "other": "x",
            },
        }),
    );
    assert_eq!(
        effect(&change, "ppt_cx_reach_out_timing").name,
        "Cx reach out timing"
    );
    assert_eq!(effect(&change, "ppt_renewal_due_on").name, "Renewal due on");
    assert_eq!(effect(&change, "other").name, "Other");

    let notify = change_of(
        "bulk_update_contacts",
        json!({"where": {"stage": "lead"}, "set": {"owner_id": "u1"}, "notify_owners": false, "note": "x"}),
    );
    assert_eq!(effect(&notify, "notify_owners").name, "Notify owners");

    let spaces = change_of(
        "update_record",
        json!({"id": "r1", "properties": {"Förderbetrag (€)": 12000, "Due date": "2026-01-01"}}),
    );
    assert_eq!(effect(&spaces, "Förderbetrag (€)").name, "Förderbetrag (€)");
    assert_eq!(effect(&spaces, "Due date").name, "Due date");
    let camel = change_of(
        "update_record",
        json!({"id": "r1", "renewalDueOn": "x", "ownerId": "abc"}),
    );
    assert_eq!(effect(&camel, "renewalDueOn").name, "Renewal due on");
    assert_eq!(effect(&camel, "ownerId").name, "Owner ID");
}

#[test]
fn every_value_says_what_happens_to_it() {
    let change = change_of(
        "update_record",
        json!({
            "id": "r1",
            "fields": {
                "a": null, "b": "", "c": [], "d": {},
                "stage": "won", "labels": ["x"], "single": [{"text": {"content": "y"}}],
            },
        }),
    );
    for name in ["a", "b", "c", "d"] {
        assert_eq!(
            effect(&change, name).effect,
            ToolCallEffectKind::Emptied,
            "{name}"
        );
    }
    assert_eq!(effect(&change, "stage").effect, ToolCallEffectKind::Set);
    assert_eq!(
        effect(&change, "labels").effect,
        ToolCallEffectKind::ListReplaced
    );
    assert_eq!(effect(&change, "single").effect, ToolCallEffectKind::Set);
    assert_eq!(texts(&effect(&change, "single").values), ["y"]);
    assert_eq!(
        (
            change.counts.emptied,
            change.counts.list_replaced,
            change.counts.set
        ),
        (4, 1, 2)
    );
    assert!(change.complete);
    assert!(
        change
            .notes
            .contains(&ToolCallChangeNote::ListReplaceUnknown)
    );
}

#[test]
fn a_create_never_empties_anything() {
    let change = change_of("create_task", json!({"title": "New", "due": null}));
    assert_eq!(effect(&change, "due").effect, ToolCallEffectKind::Set);
    assert_eq!(change.counts.emptied, 0);
}

#[test]
fn wrapped_values_read_as_what_they_hold() {
    let change = change_of(
        "API-patch-page",
        json!({
            "page_id": RECORD,
            "properties": {
                "Stage": {"select": {"name": "Abgelehnt"}},
                "Förderbetrag (€)": {"number": 12000},
                "Owner": {"people": []},
                "Due date": {"date": null},
                "Title": {"title": [{"text": {"content": "Antrag"}}]},
            },
        }),
    );
    assert_eq!(texts(&effect(&change, "Stage").values), ["Abgelehnt"]);
    assert_eq!(
        texts(&effect(&change, "Förderbetrag (€)").values),
        ["12000"]
    );
    assert_eq!(effect(&change, "Owner").effect, ToolCallEffectKind::Emptied);
    assert_eq!(
        effect(&change, "Due date").effect,
        ToolCallEffectKind::Emptied
    );
    assert_eq!(texts(&effect(&change, "Title").values), ["Antrag"]);
}

#[test]
fn a_nested_object_is_named_after_where_it_sits_and_past_the_depth_is_unreadable() {
    let change = change_of(
        "update_record",
        json!({"id": "r1", "address": {"street": "Main", "city": "Berlin"}}),
    );
    assert_eq!(effect(&change, "street").name, "Address · Street");
    let mut deep = json!({"leaf1": 1, "leaf2": 2});
    for _ in 0..10 {
        deep = json!({"level1": deep, "level2": 2});
    }
    let change = change_of("update_record", json!({"id": "r1", "deep": deep}));
    assert!(change.counts.unreadable > 0);
    assert!(
        change.complete,
        "the unreadable value is counted, nothing is unread"
    );
}

#[test]
fn machine_ids_never_carry_their_text_and_show_a_known_name() {
    let context = earlier(vec![(
        "read_account",
        json!({}),
        json!({"id": ACCOUNT, "name": "Contoso"}),
    )]);
    let (change, _) = change_with(
        &tool("update_record", "", None),
        json!({
            "id": "r1",
            "fields": {
                "ownerid": RECORD,
                "accountid": ACCOUNT,
                "parentaccountid@odata.bind": format!("/accounts({ACCOUNT})"),
                "ref": "#4211",
                "email": "ana@contoso.example",
            },
        }),
        &context,
    );
    let owner = effect(&change, "ownerid");
    assert!(owner.values[0].machine_id);
    assert_eq!(owner.values[0].text, "");
    let account = effect(&change, "accountid");
    assert!(account.values[0].machine_id);
    assert_eq!(account.values[0].text, "Contoso");
    let bind = effect(&change, "parentaccountid@odata.bind");
    assert!(bind.link);
    assert!(bind.values[0].machine_id);
    assert_eq!(bind.values[0].text, "Contoso");
    assert_eq!(bind.name, "Parent account ID");
    assert_eq!(texts(&effect(&change, "ref").values), ["#4211"]);
    assert!(!effect(&change, "ref").values[0].machine_id);
}

#[test]
fn recipients_count_everyone_and_name_only_who_is_outside() {
    let context = ToolResultContext::default()
        .with_organization(Some("me@contoso.example"), &["partner.example".to_string()]);
    let (change, _) = change_with(
        &tool("send_email", "", None),
        json!({
            "to": ["a@contoso.example", "b@mail.contoso.example", "ana@fabrikam.example"],
            "cc": ["c@partner.example", {"emailAddress": {"address": "d@contoso.example.evil.test"}}],
            "subject": "Hello",
            "body": "Hi",
        }),
        &context,
    );
    let recipients = change.recipients.expect("recipients");
    assert_eq!(recipients.total, 5);
    assert_eq!(recipients.groups.len(), 2);
    assert_eq!(recipients.groups[0].count, 3);
    assert_eq!(recipients.groups[1].count, 2);
    assert!(recipients.outside_known);
    assert_eq!(
        recipients.outside,
        ["ana@fabrikam.example", "d@contoso.example.evil.test"]
    );

    // No user domain: nothing is claimed, whatever is configured.
    let unknown =
        ToolResultContext::default().with_organization(None, &["contoso.example".to_string()]);
    let (change, _) = change_with(
        &tool("send_email", "", None),
        json!({"to": "ana@fabrikam.example", "subject": "x", "body": "y"}),
        &unknown,
    );
    let recipients = change.recipients.expect("recipients");
    assert!(!recipients.outside_known);
    assert!(recipients.outside.is_empty());
    assert_eq!(recipients.total, 1);
}

#[test]
fn recipients_that_are_ids_or_numbers_are_counted_but_not_listed_or_checked() {
    let context = ToolResultContext::default().with_organization(Some("me@contoso.example"), &[]);
    let (change, _) = change_with(
        &tool("send_message", "", None),
        json!({"recipients": ["U012AB3CD", "+49 170 1234567"], "text": "hello there"}),
        &context,
    );
    let recipients = change.recipients.expect("recipients");
    assert_eq!(recipients.total, 2);
    assert_eq!(recipients.groups[0].values, ["+49 170 1234567"]);
    assert_eq!(recipients.unchecked, 2);
    assert!(recipients.outside.is_empty());
}

#[test]
fn an_emptied_recipient_list_on_an_update_is_a_loss() {
    let change = change_of(
        "update_issue_assignees",
        json!({"issue_number": 4, "assignees": [], "state": "open"}),
    );
    assert_eq!(change.recipients, None);
    let _ = effect(&change, "state");
}

#[test]
fn a_filter_reads_in_words_and_an_empty_one_means_every_record() {
    let change = change_of(
        "bulk_update_contacts",
        json!({"where": {"lifecycle_stage": "lead", "last_activity_before": "2025-01-01"}, "set": {"owner": "ana"}}),
    );
    let filter = change.filter.expect("filter");
    assert!(!filter.every_record);
    assert_eq!(filter.parts.len(), 2);
    assert_eq!(filter.parts[0].name, "Lifecycle stage");
    assert_eq!(filter.parts[0].value.text, "lead");
    assert_eq!(filter.parts[1].name, "Last activity before");
    assert!(change.notes.contains(&ToolCallChangeNote::RowCountUnknown));

    let every = change_of(
        "bulk_update_contacts",
        json!({"where": {}, "set": {"owner": "ana"}}),
    );
    assert!(every.filter.expect("filter").every_record);

    let text = change_of(
        "delete_rows",
        json!({"filter": "status = 'open'", "table": "x"}),
    );
    assert_eq!(
        text.filter.expect("filter").text.expect("text").text,
        "status = 'open'"
    );
}

#[test]
fn behaviour_flags_are_listed_only_when_set() {
    let change = change_of(
        "delete_folder",
        json!({"path": "/srv/x", "recursive": true, "force": true, "verbose": true, "overwrite": false}),
    );
    let names: Vec<_> = change
        .flags
        .iter()
        .map(|flag| flag.raw_name.as_str())
        .collect();
    assert_eq!(names, ["recursive", "force"]);
    let dry = change_of(
        "edit_file",
        json!({"path": "/x", "dryRun": true, "content": "y"}),
    );
    assert_eq!(dry.flags[0].raw_name, "dryRun");
    assert!(dry.flags[0].dry_run);
    let validate = change_of("create_issue", json!({"title": "x", "validate_only": true}));
    assert!(validate.flags[0].dry_run);
}

#[test]
fn opaque_content_is_found_and_never_becomes_the_verb() {
    let change = change_of(
        "execute_sql",
        json!({"project_id": "prj1", "query": "WITH gone AS (DELETE FROM audit_log RETURNING id)\nSELECT count(*) FROM gone;"}),
    );
    let opaque = &change.opaque[0];
    assert_eq!(opaque.kind, ToolCallOpaqueKind::Sql);
    assert_eq!(opaque.found, ["DELETE"]);
    assert!(opaque.write_inside_read);
    assert_eq!(opaque.lines, 2);
    assert_eq!(change.place.as_deref(), Some("prj1"));
    assert!(change.notes.contains(&ToolCallChangeNote::RowCountUnknown));

    let shell = change_of("run_shell", json!({"command": "rm -rf /tmp/x"}));
    assert_eq!(shell.opaque[0].kind, ToolCallOpaqueKind::Shell);
    assert_eq!(shell.opaque[0].found, ["rm"]);

    let args_list = change_of(
        "pods_exec",
        json!({"namespace": "n", "name": "p", "command": ["rm", "-rf", "/x"]}),
    );
    assert_eq!(args_list.opaque[0].text, "rm -rf /x");

    let code = change_of(
        "deploy_function",
        json!({"code": "await fetch('https://x')"}),
    );
    assert_eq!(code.opaque[0].kind, ToolCallOpaqueKind::Code);
    assert_eq!(code.opaque[0].found, ["fetch"]);

    let instruction = change_of(
        "run_agent_task",
        json!({"instruction": "Clean up the CRM."}),
    );
    assert_eq!(instruction.opaque[0].kind, ToolCallOpaqueKind::Instruction);
    assert!(
        instruction
            .notes
            .contains(&ToolCallChangeNote::InstructionOutcomeUnknown)
    );

    let act = change_of("act", json!({"action": "click the delete button"}));
    assert_eq!(act.opaque[0].kind, ToolCallOpaqueKind::Instruction);

    // A plain search term is a value, not a statement.
    let plain = change_of(
        "update_filter",
        json!({"id": "v1", "query": "open invoices"}),
    );
    assert!(plain.opaque.is_empty());
    assert_eq!(texts(&effect(&plain, "query").values), ["open invoices"]);
    // An identifier in a verb field is never read as an instruction.
    let verb = change_of("update_thing", json!({"id": "v1", "action": "noop"}));
    assert!(verb.opaque.is_empty());
}

#[test]
fn long_text_is_measured_and_stored_only_up_to_its_start() {
    let body = format!("{}\nsecond line", "x".repeat(10_000));
    let change = change_of(
        "update_issue_body",
        json!({"issue_number": 3, "body": body}),
    );
    let text = &change.texts[0];
    assert_eq!(text.lines, 2);
    assert_eq!(text.chars, 10_012);
    assert!(text.truncated);
    assert_eq!(text.text.chars().count(), 4_000);
}

#[test]
fn a_batch_of_identical_rows_collapses_to_one_statement() {
    let rows: Vec<_> = (0..200)
        .map(|index| json!({"Id": format!("{RECORD}"), "Name": format!("row {index}"), "StageName": "Closed", "Loss_Reason__c": "No budget"}))
        .collect();
    let change = change_of(
        "salesforce_dml_records",
        json!({"operation": "update", "objectName": "Opportunity", "records": rows}),
    );
    let batch = change.batch.expect("batch");
    assert_eq!(batch.total, 200);
    assert!(batch.same_change);
    assert_eq!(batch.shared.len(), 2);
    assert_eq!(batch.rows.len(), 50);
    assert!(batch.read_all);
    assert_eq!(batch.rows_emptying, 0);
    assert_eq!(
        (change.place, change.table.as_deref()),
        (None, Some("Opportunity"))
    );
}

#[test]
fn a_batch_of_different_rows_keeps_deletions_first_and_counts_operations() {
    let change = change_of(
        "mutate",
        json!({"ops": [
            {"op": "update", "path": "/customers/c1", "value": {"tier": "gold"}},
            {"op": "delete", "path": "/customers/c2"},
            {"op": "create", "path": "/customers", "value": {"name": "Contoso"}},
            {"op": "delete", "path": "/customers/c3"},
            {"op": "update", "path": "/customers/c4", "value": {"owner": null}},
        ]}),
    );
    let batch = change.batch.expect("batch");
    assert!(!batch.same_change);
    assert_eq!(batch.deletions, 2);
    assert_eq!(batch.rows[0].action, Some(ToolCallAction::Delete));
    assert_eq!(batch.rows[0].name.as_deref(), Some("/customers/c2"));
    assert_eq!(batch.rows[1].name.as_deref(), Some("/customers/c3"));
    assert_eq!(batch.rows[2].number, 1);
    let totals: Vec<_> = batch
        .operations
        .iter()
        .map(|op| (op.action, op.count))
        .collect();
    assert_eq!(
        totals,
        [
            (ToolCallAction::Create, 1),
            (ToolCallAction::Update, 2),
            (ToolCallAction::Delete, 2)
        ]
    );
    assert_eq!(batch.rows_emptying, 1);
}

#[test]
fn rows_named_only_by_a_machine_id_stay_unnamed_so_they_are_numbered() {
    let rows: Vec<_> = (0..3)
        .map(|i| json!({"Id": RECORD, "Rating": format!("R{i}")}))
        .collect();
    let change = change_of(
        "salesforce_dml_records",
        json!({"operation": "update", "records": rows}),
    );
    let batch = change.batch.expect("batch");
    assert!(batch.rows.iter().all(|row| row.name.is_none()));
    assert_eq!(batch.rows[0].number, 1);
}

#[test]
fn a_batch_of_old_and_new_text_edits_shows_old_to_new() {
    let change = change_of(
        "edit_file",
        json!({"path": "/x", "edits": [
            {"oldText": "a", "newText": "b"},
            {"oldText": "c", "newText": "d"},
        ]}),
    );
    let batch = change.batch.expect("batch");
    let edit = &batch.rows[0].effects[0];
    assert_eq!(edit.effect, ToolCallEffectKind::Changed);
    assert_eq!(texts(&edit.values), ["b"]);
    assert_eq!(edit.old.as_ref().unwrap().text, "a");
}

#[test]
fn a_list_of_links_is_a_list_not_a_batch_and_one_record_in_a_list_is_that_record() {
    let change = change_of(
        "update_issue",
        json!({"issue_number": 1, "assignees": [{"id": "u_1"}, {"id": "u_2"}]}),
    );
    assert_eq!(change.batch, None);
    assert_eq!(texts(&effect(&change, "assignees").values), ["u_1", "u_2"]);

    let single = change_of(
        "salesforce_dml_records",
        json!({"operation": "update", "records": [{"Id": RECORD, "Rating": "Hot"}]}),
    );
    assert_eq!(single.batch, None);
    assert_eq!(texts(&effect(&single, "Rating").values), ["Hot"]);
}

#[test]
fn consent_flags_are_left_out_and_said_so_lookup_names_stay_out() {
    let (change, _) = change_with(
        &tool("update_record", "", None),
        json!({"id": "r1", "hasUserApproved": true, "status": "x", "parent": {"name": "Typed", "recordId": RECORD, "relatedTable": "account"}}),
        &ToolResultContext::default(),
    );
    assert!(change.consent_left_out);
    assert!(
        change
            .effects
            .iter()
            .all(|effect| effect.raw_name != "hasUserApproved")
    );
    assert!(
        change
            .effects
            .iter()
            .all(|effect| effect.raw_name != "name")
    );
}

#[test]
fn notes_say_what_the_tool_says_and_what_nobody_knows() {
    let deleted = change_with(
        &tool("delete_page", "", Some(true)),
        json!({"page_id": "p1"}),
        &ToolResultContext::default(),
    )
    .0;
    assert!(
        deleted
            .notes
            .contains(&ToolCallChangeNote::MarkedDestructive)
    );
    assert!(
        deleted
            .notes
            .contains(&ToolCallChangeNote::DeleteOutcomeUnknown)
    );

    let permanent = change_with(
        &tool("delete_page", "Permanently removes the page.", None),
        json!({"page_id": "p1"}),
        &ToolResultContext::default(),
    )
    .0;
    assert!(
        permanent
            .notes
            .contains(&ToolCallChangeNote::ToolSaysPermanent)
    );
    assert!(
        !permanent
            .notes
            .contains(&ToolCallChangeNote::DeleteOutcomeUnknown)
    );

    let restorable = change_with(
        &tool(
            "trash_page",
            "Moves the page to the trash. It can be restored.",
            None,
        ),
        json!({"page_id": "p1"}),
        &ToolResultContext::default(),
    )
    .0;
    assert!(
        restorable
            .notes
            .contains(&ToolCallChangeNote::ToolSaysRestorable)
    );

    let created = change_with(
        &tool("create_record", "", Some(true)),
        json!({"name": "x"}),
        &ToolResultContext::default(),
    )
    .0;
    assert_eq!(created.notes, [ToolCallChangeNote::MarkedDestructive]);

    let replaces = change_with(
        &tool("set_labels", "This replaces the current labels.", None),
        json!({"issue_number": 1, "labels": ["a"]}),
        &ToolResultContext::default(),
    )
    .0;
    assert!(
        replaces
            .notes
            .contains(&ToolCallChangeNote::ToolSaysReplacesList)
    );
    let adds = change_with(
        &tool(
            "update_labels",
            "Only adds, existing labels are never removed.",
            None,
        ),
        json!({"issue_number": 1, "labels": ["a"]}),
        &ToolResultContext::default(),
    )
    .0;
    assert!(adds.notes.contains(&ToolCallChangeNote::ToolSaysAddsToList));
    assert_eq!(effect(&adds, "labels").effect, ToolCallEffectKind::Set);
    assert_eq!(adds.counts.list_replaced, 0);
}

#[test]
fn hidden_characters_in_a_value_or_name_are_reported() {
    let (_, hidden) = change_with(
        &tool("update_record", "", None),
        json!({"id": "r1", "stage": "wo\u{200B}n"}),
        &ToolResultContext::default(),
    );
    assert!(hidden);
    let (_, hidden) = change_with(
        &tool("update_record", "", None),
        json!({"id": "r1", "sta\u{202E}ge": "won"}),
        &ToolResultContext::default(),
    );
    assert!(hidden);
    let (_, clean) = change_with(
        &tool("update_record", "", None),
        json!({"id": "r1", "stage": "won"}),
        &ToolResultContext::default(),
    );
    assert!(!clean);
}

#[test]
fn a_hostile_call_stays_small_and_says_it_is_incomplete() {
    let huge: serde_json::Map<String, Value> = (0..3000)
        .map(|index| (format!("field_{index:04}"), json!("v".repeat(150))))
        .collect();
    let (change, _) = change_with(
        &tool("update_record", "", None),
        json!({"id": "r1", "fields": huge}),
        &ToolResultContext::default(),
    );
    assert_eq!(change.effects.len(), MAX_EFFECTS);
    assert_eq!(change.counts.set, 3000);
    // Past the stored cap everything was still read and counted.
    assert!(change.complete);
    assert!(serde_json::to_string(&change).unwrap().len() < 100_000);

    let too_much: serde_json::Map<String, Value> = (0..30_000)
        .map(|index| (format!("field_{index:05}"), json!("v")))
        .collect();
    let (change, _) = change_with(
        &tool("update_record", "", None),
        json!({"id": "r1", "fields": too_much}),
        &ToolResultContext::default(),
    );
    assert!(!change.complete);
    assert!(serde_json::to_string(&change).unwrap().len() < 100_000);

    let mut loss_after_values: serde_json::Map<String, Value> = (0..3000)
        .map(|index| (format!("field_{index:04}"), json!("v".repeat(150))))
        .collect();
    loss_after_values.insert("zz_lost".to_string(), Value::Null);
    let (change, _) = change_with(
        &tool("update_record", "", None),
        json!({"id": "r1", "fields": loss_after_values}),
        &ToolResultContext::default(),
    );
    assert_eq!(
        effect(&change, "zz_lost").effect,
        ToolCallEffectKind::Emptied
    );

    let with_empties: serde_json::Map<String, Value> = (0..200)
        .map(|index| (format!("zf_{index:04}"), Value::Null))
        .collect();
    let (change, _) = change_with(
        &tool("update_record", "", None),
        json!({"id": "r1", "fields": with_empties}),
        &ToolResultContext::default(),
    );
    assert!(
        change
            .effects
            .iter()
            .all(|effect| effect.effect == ToolCallEffectKind::Emptied)
    );
    assert_eq!(change.counts.emptied, 200);
}

#[test]
fn nothing_panics_on_odd_arguments() {
    for arguments in [
        json!(null),
        json!("text"),
        json!([1, 2, 3]),
        json!({"": {"": [[], [[]], {"": null}]}}),
        json!({"id": "r1", "weird/name~with": "slashes", "*": [{}]}),
    ] {
        let tool = tool("update_record", "", None);
        let context = ToolResultContext::default();
        let label = labelled(&tool, &arguments, &context);
        let _ = describe(
            &label,
            ChangeFacts {
                tool: &tool,
                arguments: &arguments,
                approval_argument: None,
                context: &context,
                server: Some(SERVER),
                rules_action: label.action,
                glossary: None,
                destructive_hint_source: Default::default(),
            },
        );
    }
}

#[test]
fn forgetting_earlier_results_drops_old_values_and_names_but_keeps_what_the_call_writes() {
    let context = earlier(vec![(
        "read_record",
        json!({"id": RECORD}),
        json!({"id": RECORD, "stage": "open", "accountid": ACCOUNT, "name": "Rec"}),
    )]);
    let (mut change, _) = change_with(
        &tool("update_record", "", None),
        json!({"id": RECORD, "stage": "won", "accountid": RECORD, "note": "same"}),
        &context,
    );
    assert_eq!(effect(&change, "stage").effect, ToolCallEffectKind::Changed);
    assert!(
        change
            .notes
            .contains(&ToolCallChangeNote::OldValuesFromEarlier)
    );
    let before = change.counts;
    forget_earlier(&mut change);
    assert_eq!(effect(&change, "stage").effect, ToolCallEffectKind::Set);
    assert!(effect(&change, "stage").old.is_none());
    assert!(
        !change
            .notes
            .contains(&ToolCallChangeNote::OldValuesFromEarlier)
    );
    assert_eq!(change.counts.set, before.changed + before.set);
}

#[test]
fn a_mapping_from_any_source_is_described_the_same_way() {
    let tool = tool("update_record", "", None);
    let arguments = json!({"id": "r1", "stage": "won"});
    let context = ToolResultContext::default();
    let mapping = ToolCallLabelMapping {
        action: ToolCallAction::Update,
        object_kind: ToolCallObjectKind::Row,
        items: Vec::new(),
        source: ToolCallLabelSource::Model,
    };
    let label = checked_label(SERVER, &tool, &arguments, &mapping, None);
    let (change, _) = describe(
        &label,
        ChangeFacts {
            tool: &tool,
            arguments: &arguments,
            approval_argument: None,
            context: &context,
            server: None,
            rules_action: label.action,
            glossary: None,
            destructive_hint_source: Default::default(),
        },
    )
    .unwrap();
    assert_eq!(effect(&change, "stage").effect, ToolCallEffectKind::Set);
}

fn read_of(tool_name: &str, input: Value, output: Value) -> ToolResultContext {
    earlier(vec![(tool_name, input, output)])
}

#[test]
fn old_values_show_what_changes_and_what_stays_the_same() {
    let context = read_of(
        "read_company",
        json!({"id": RECORD}),
        json!({"id": RECORD, "name": "Tailspin", "city": "Berlin", "stage": "lead", "seats": 120}),
    );
    let (change, _) = change_with(
        &tool("update_company", "", None),
        json!({"id": RECORD, "properties": {"city": "Berlin", "stage": "customer", "seats": 120, "phone": null}}),
        &context,
    );
    assert_eq!(
        effect(&change, "city").effect,
        ToolCallEffectKind::Unchanged
    );
    let stage = effect(&change, "stage");
    assert_eq!(stage.effect, ToolCallEffectKind::Changed);
    assert_eq!(stage.old.as_ref().unwrap().text, "lead");
    assert_eq!(
        effect(&change, "seats").effect,
        ToolCallEffectKind::Unchanged
    );
    assert!(
        change
            .notes
            .contains(&ToolCallChangeNote::OldValuesFromEarlier)
    );
    assert!(!change.notes.contains(&ToolCallChangeNote::NothingChanges));
}

#[test]
fn wrapped_old_values_are_read_like_wrapped_new_ones() {
    let context = read_of(
        "read_page",
        json!({"page_id": RECORD}),
        json!({"id": RECORD, "properties": {
            "Stage": {"select": {"name": "Prüfung"}},
            "Förderbetrag (€)": {"number": 9000},
            "Owner": {"people": [{"name": "Tess Tester"}]},
            "Due date": {"date": {"start": "2026-11-30"}},
        }}),
    );
    let (change, _) = change_with(
        &tool("API-patch-page", "", None),
        json!({"page_id": RECORD, "properties": {
            "Stage": {"select": {"name": "Abgelehnt"}},
            "Förderbetrag (€)": {"number": 12000},
            "Owner": {"people": []},
            "Due date": {"date": null},
        }}),
        &context,
    );
    assert_eq!(
        effect(&change, "Stage").old.as_ref().unwrap().text,
        "Prüfung"
    );
    assert_eq!(
        effect(&change, "Förderbetrag (€)")
            .old
            .as_ref()
            .unwrap()
            .text,
        "9000"
    );
    assert_eq!(
        effect(&change, "Due date").effect,
        ToolCallEffectKind::Emptied
    );
    assert_eq!(
        effect(&change, "Due date").old.as_ref().unwrap().text,
        "2026-11-30"
    );
    assert_eq!(effect(&change, "Owner").effect, ToolCallEffectKind::Emptied);
}

#[test]
fn a_replaced_list_says_what_goes_and_what_stays() {
    let read = |labels: Value| {
        read_of(
            "get_issue",
            json!({"owner": "contoso", "repo": "uploader", "issue_number": 4211}),
            json!({"id": 99, "number": 4211, "title": "Upload fails", "labels": labels}),
        )
    };
    let description = "This replaces the current labels.";
    let call =
        json!({"owner": "contoso", "repo": "uploader", "issue_number": 4211, "labels": ["bug"]});
    let labels = json!([{"name": "bug"}, {"name": "p1"}, {"name": "backend"}]);
    let (change, _) = change_with(
        &tool("update_issue_labels", description, None),
        call.clone(),
        &read(labels),
    );
    let row = effect(&change, "labels");
    assert_eq!(row.effect, ToolCallEffectKind::ListReplaced);
    assert_eq!(texts(&row.removed), ["p1", "backend"]);
    assert_eq!(texts(&row.kept), ["bug"]);
    assert!(
        change
            .notes
            .contains(&ToolCallChangeNote::ToolSaysReplacesList)
    );
    assert!(
        change
            .notes
            .contains(&ToolCallChangeNote::OldValuesFromEarlier)
    );

    // A list that loses nothing and changes nothing says so.
    let (same, _) = change_with(
        &tool("update_issue_labels", description, None),
        call.clone(),
        &read(json!([{"name": "bug"}])),
    );
    assert_eq!(
        effect(&same, "labels").effect,
        ToolCallEffectKind::Unchanged
    );

    // Only adding removes nothing: it is a change, not a loss.
    let (added, _) = change_with(
        &tool("update_issue_labels", description, None),
        call,
        &read(json!([])),
    );
    assert_eq!(effect(&added, "labels").effect, ToolCallEffectKind::Changed);
    assert!(effect(&added, "labels").removed.is_empty());
}

#[test]
fn a_read_of_another_place_or_member_says_nothing_about_this_record() {
    let context = read_of(
        "get_issue",
        json!({"owner": "contoso", "repo": "uploader", "issue_number": 4211}),
        json!({"number": 4211, "title": "Upload fails", "state": "open"}),
    );
    let other_repo = change_with(
        &tool("update_issue", "", None),
        json!({"owner": "contoso", "repo": "other", "issue_number": 4211, "state": "closed"}),
        &context,
    )
    .0;
    assert_eq!(effect(&other_repo, "state").effect, ToolCallEffectKind::Set);
    let other_member = change_with(
        &tool("update_project", "", None),
        json!({"owner": "contoso", "repo": "uploader", "pull_number": 4211, "state": "closed"}),
        &context,
    )
    .0;
    assert_eq!(
        effect(&other_member, "state").effect,
        ToolCallEffectKind::Set
    );
    let same = change_with(
        &tool("update_issue", "", None),
        json!({"owner": "contoso", "repo": "uploader", "issue_number": 4211, "state": "closed"}),
        &context,
    )
    .0;
    assert_eq!(effect(&same, "state").old.as_ref().unwrap().text, "open");
}

#[test]
fn a_call_that_names_a_record_retires_what_a_read_said_about_it() {
    let context = earlier(vec![
        (
            "get_issue",
            json!({"repo": "uploader", "issue_number": 4211}),
            json!({"title": "Upload fails", "state": "open", "labels": ["bug"]}),
        ),
        (
            "other_call",
            json!({"note": "touches 4211", "issue_number": 4211}),
            json!({}),
        ),
    ]);
    let change = change_with(
        &tool("update_issue", "", None),
        json!({"repo": "uploader", "issue_number": 4211, "state": "closed", "labels": ["x"]}),
        &context,
    )
    .0;
    assert_eq!(effect(&change, "state").effect, ToolCallEffectKind::Set);
    assert!(effect(&change, "labels").removed.is_empty());
}

#[test]
fn every_value_equal_to_what_was_read_is_said_once() {
    let context = read_of(
        "get_issue",
        json!({"repo": "uploader", "issue_number": 7}),
        json!({"number": 7, "state": "open", "title": "A", "labels": ["bug"]}),
    );
    let same = change_with(
        &tool("issue_write", "", None),
        json!({"method": "update", "repo": "uploader", "issue_number": 7, "state": "open", "title": "A", "labels": ["bug"]}),
        &context,
    )
    .0;
    assert!(
        same.notes.contains(&ToolCallChangeNote::NothingChanges),
        "{same:#?}"
    );
}

#[test]
fn a_phone_shaped_or_recipient_id_never_gets_a_read_record() {
    let context = read_of(
        "get_contact",
        json!({"contact_id": "+49 170 1234567"}),
        json!({"name": "Mallory", "state": "open"}),
    );
    let change = change_with(
        &tool("update_contact", "", None),
        json!({"contact_id": "+49 170 1234567", "state": "closed"}),
        &context,
    )
    .0;
    assert_eq!(effect(&change, "state").effect, ToolCallEffectKind::Set);
    assert_eq!(context.name_of_id(SERVER, "+49 170 1234567"), None);
}

#[test]
fn a_batch_says_per_field_what_all_its_rows_do_and_whether_any_row_loses_something() {
    let rows: Vec<_> = (0..200)
        .map(|index| {
            json!({
                "Id": RECORD,
                "Stage": if index < 3 { "Won" } else { "Lost" },
                "Owner": if index < 7 { Value::Null } else { json!("ana") },
                "Tags": if index == 0 { json!(["a"]) } else { json!(null) },
            })
        })
        .collect();
    let change = change_of(
        "salesforce_dml_records",
        json!({"operation": "update", "objectName": "Opportunity", "records": rows}),
    );
    let batch = change.batch.expect("batch");
    assert!(!batch.same_change);
    assert_eq!(batch.rows.len(), 50);
    let stage = batch
        .fields
        .iter()
        .find(|field| field.raw_name == "Stage")
        .unwrap();
    assert_eq!((stage.rows, stage.distinct, stage.emptied), (200, 2, 0));
    assert_eq!(texts(&stage.samples), ["Won", "Lost"]);
    let owner = batch
        .fields
        .iter()
        .find(|field| field.raw_name == "Owner")
        .unwrap();
    assert_eq!((owner.rows, owner.emptied), (200, 7));
    assert_eq!(batch.rows_emptying, 200);

    // A row past every stored one still counts.
    let mut late: Vec<_> = (0..120)
        .map(|index| json!({"Name": format!("row {index}"), "Stage": "Open"}))
        .collect();
    late.push(json!({"Name": "last", "Stage": null}));
    let change = change_of("update_rows", json!({"table": "x", "rows": late}));
    let batch = change.batch.expect("batch");
    assert_eq!(batch.rows_emptying, 1);
    let stage = batch
        .fields
        .iter()
        .find(|field| field.raw_name == "Stage")
        .unwrap();
    assert_eq!(stage.emptied, 1);
    assert!(batch.read_all);
}

#[test]
fn a_tools_read_only_claim_never_overrules_a_name_that_says_something_is_lost() {
    use crate::services::tool_display::label::rules::{cross_check, sounds_like_a_loss};
    let claims_reads = Some(ToolAnnotations::from_raw(
        None,
        Some(true),
        None,
        None,
        None,
    ));
    let mut purge = tool("purge_user_data", "Only reads.", None);
    purge.annotations = claims_reads.clone();
    assert!(cross_check(&purge, &json!({"scope": "all"}), ToolCallAction::Delete).is_empty());
    let (change, _) = change_with(
        &purge,
        json!({"scope": "all"}),
        &ToolResultContext::default(),
    );
    assert!(
        change
            .notes
            .iter()
            .all(|note| !format!("{note:?}").contains("ReadOnly"))
    );
    assert!(sounds_like_a_loss("purge_user_data", &json!({})));
    assert!(sounds_like_a_loss(
        "refresh_cache",
        &json!({"purge_user_data": true})
    ));
    assert!(!sounds_like_a_loss(
        "refresh_cache",
        &json!({"purge_user_data": false})
    ));
    assert!(!sounds_like_a_loss("list_records", &json!({"limit": 3})));

    // Agreement between the verb and the claim is still a disagreement to flag.
    let mut write = tool("update_record", "", None);
    write.annotations = claims_reads;
    assert!(!cross_check(&write, &json!({"id": "r1"}), ToolCallAction::Update).is_empty());
}

#[test]
fn findings_are_only_for_real_statements() {
    // A search box stays a value, even when its words sound like a statement.
    for query in [
        "delete pages about Q4",
        "update pricing page",
        "drop in sales",
        "select the best one",
    ] {
        let plain = change_of("update_filter", json!({"id": "v1", "query": query}));
        assert!(plain.opaque.is_empty(), "{query}");
    }
    let change = change_of(
        "execute_sql",
        json!({"query": "delete from pages where id = 1"}),
    );
    assert_eq!(change.opaque[0].found, ["DELETE"]);
    let select = change_of(
        "execute_sql",
        json!({"query": "select count(*) from pages"}),
    );
    assert_eq!(select.opaque[0].kind, ToolCallOpaqueKind::Sql);
    assert!(select.opaque[0].found.is_empty());

    // A named statement member stays opaque, with findings only for a statement.
    let named = change_of("execute_sql", json!({"sql": "delete pages about Q4"}));
    assert_eq!(named.opaque[0].kind, ToolCallOpaqueKind::Sql);
    assert!(named.opaque[0].found.is_empty());

    // A code member that holds a plain value is a value.
    let codes = change_of(
        "update_record",
        json!({"id": "r1", "country_code": "DE", "promo_code": "SAVE20"}),
    );
    assert!(codes.opaque.is_empty());
    assert_eq!(texts(&effect(&codes, "promo_code").values), ["SAVE20"]);
    let code = change_of("deploy_function", json!({"code": "delete_all();"}));
    assert_eq!(code.opaque[0].kind, ToolCallOpaqueKind::Code);

    // Prose under a command member is shown but not searched for risky words.
    let prose = change_of("run_shell", json!({"command": "kill the old processes"}));
    assert_eq!(prose.opaque[0].kind, ToolCallOpaqueKind::Shell);
    assert!(prose.opaque[0].found.is_empty());
    let shell = change_of("run_shell", json!({"command": "rm foo bar baz"}));
    assert_eq!(shell.opaque[0].found, ["rm"]);
}

#[test]
fn words_about_restoring_count_only_when_nothing_negates_them() {
    let note = |description: &str| {
        let (change, _) = change_with(
            &tool("delete_record", description, None),
            json!({"id": "r1"}),
            &ToolResultContext::default(),
        );
        change.notes
    };
    for negated in [
        "There is no way to restore it.",
        "Deleted items cannot be recovered.",
        "Deleted items can't be restored.",
        "It can not be restored.",
        "This never goes to the trash.",
    ] {
        let notes = note(negated);
        assert!(
            !notes.contains(&ToolCallChangeNote::ToolSaysRestorable),
            "{negated}: {notes:?}"
        );
        assert!(
            notes.contains(&ToolCallChangeNote::DeleteOutcomeUnknown),
            "{negated}: {notes:?}"
        );
    }
    let notes = note("Deletes the row. It can be restored from the bin.");
    assert!(
        notes.contains(&ToolCallChangeNote::ToolSaysRestorable),
        "{notes:?}"
    );
    let notes = note("Deletes the row. To restore a row, call another tool.");
    assert!(
        !notes.contains(&ToolCallChangeNote::ToolSaysRestorable),
        "{notes:?}"
    );
}

#[test]
fn only_an_explicit_claim_makes_a_list_an_addition_and_the_card_says_whose_claim_it_is() {
    let change_for = |description: &str| {
        change_with(
            &tool("update_record", description, None),
            json!({"id": "r1", "labels": ["a"]}),
            &ToolResultContext::default(),
        )
        .0
    };
    let never_removed = change_for("Labels are never removed.");
    assert_eq!(
        effect(&never_removed, "labels").effect,
        ToolCallEffectKind::ListReplaced
    );
    assert!(
        !never_removed
            .notes
            .contains(&ToolCallChangeNote::ToolSaysAddsToList)
    );
    for claim in ["This list is append-only.", "It only adds labels."] {
        let change = change_for(claim);
        assert_eq!(effect(&change, "labels").effect, ToolCallEffectKind::Set);
        assert!(effect(&change, "labels").list);
        assert!(
            change
                .notes
                .contains(&ToolCallChangeNote::ToolSaysAddsToList),
            "{claim}"
        );
    }
}

#[test]
fn nothing_changes_only_when_nothing_else_is_said_and_all_was_read() {
    let context = read_of(
        "get_issue",
        json!({"issue_number": 7}),
        json!({"number": 7, "state": "open"}),
    );
    let says_nothing_changes = |extra: Value| {
        let mut arguments = json!({"issue_number": 7, "state": "open"});
        arguments
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        let (change, _) = change_with(&tool("update_issue", "", None), arguments, &context);
        change.notes.contains(&ToolCallChangeNote::NothingChanges)
    };
    assert!(says_nothing_changes(json!({})));
    for extra in [
        json!({"force": true}),
        json!({"where": {"status": "open"}}),
        json!({"to": ["a@b.example"]}),
        json!({"hasUserApproved": true}),
        json!({"sql": "UPDATE t SET a = 1"}),
    ] {
        assert!(!says_nothing_changes(extra.clone()), "{extra}");
    }
}

#[test]
fn an_earlier_list_reads_entries_by_name_and_a_partial_one_claims_nothing() {
    let call = |output: Value, members: Value| {
        let mut record = json!({"number": 7});
        record
            .as_object_mut()
            .unwrap()
            .extend(output.as_object().unwrap().clone());
        let context = read_of("get_issue", json!({"issue_number": 7}), record);
        change_with(
            &tool("update_issue", "", None),
            json!({"issue_number": 7, "assignees": members}),
            &context,
        )
        .0
    };
    let change = call(
        json!({"assignees": [{"login": "ann", "id": 11}, {"login": "bob", "id": 12}]}),
        json!(["ann", "carl"]),
    );
    let assignees = effect(&change, "assignees");
    assert_eq!(texts(&assignees.removed), ["bob"]);
    assert_eq!(texts(&assignees.kept), ["ann"]);
    assert_eq!(texts(&assignees.added), ["carl"]);

    // Entries by the same ID are the same entries, however they are written.
    let change = call(
        json!({"assignees": [{"name": "Ann", "id": "u-1"}, {"name": "Bob", "id": "u-2"}]}),
        json!([{"id": "u-1"}]),
    );
    let assignees = effect(&change, "assignees");
    assert_eq!(texts(&assignees.removed), ["Bob"]);
    assert_eq!(texts(&assignees.kept), ["Ann"]);

    for partial in [
        json!({"assignees": [{"login": "ann"}, {"a": {"x": 1}, "b": {"y": 2}}]}),
        json!({"assignees": (0..MAX_LIST_ENTRIES + 1).map(|index| format!("u{index}")).collect::<Vec<_>>()}),
    ] {
        let change = call(partial, json!(["ann"]));
        let assignees = effect(&change, "assignees");
        assert_eq!(
            assignees.effect,
            ToolCallEffectKind::ListReplaced,
            "{assignees:?}"
        );
        assert!(assignees.removed.is_empty(), "{assignees:?}");
        assert!(assignees.kept.is_empty(), "{assignees:?}");
        assert!(assignees.added.is_empty(), "{assignees:?}");
        assert!(!change.notes.contains(&ToolCallChangeNote::NothingChanges));
    }
}

#[test]
fn a_new_list_entry_that_cannot_be_read_ends_the_comparison() {
    let context = read_of(
        "get_issue",
        json!({"issue_number": 7}),
        json!({"number": 7, "assignees": ["ann"]}),
    );
    let (change, _) = change_with(
        &tool("update_issue", "", None),
        json!({"issue_number": 7, "assignees": ["ann", {"a": {"x": 1}, "b": {"y": 2}}]}),
        &context,
    );
    let assignees = effect(&change, "assignees");
    assert_eq!(assignees.effect, ToolCallEffectKind::ListReplaced);
    assert!(assignees.kept.is_empty());
}

#[test]
fn a_list_that_only_gains_entries_says_what_it_gains_and_loses_nothing() {
    let context = read_of(
        "get_issue",
        json!({"issue_number": 7}),
        json!({"number": 7, "labels": ["bug"]}),
    );
    let (change, _) = change_with(
        &tool("update_issue", "", None),
        json!({"issue_number": 7, "labels": ["bug", "docs"]}),
        &context,
    );
    let labels = effect(&change, "labels");
    assert_eq!(labels.effect, ToolCallEffectKind::Changed);
    assert_eq!(texts(&labels.added), ["docs"]);
    assert!(labels.removed.is_empty());
}

#[test]
fn an_empty_name_on_a_row_is_an_emptied_value_not_the_rows_label() {
    let change = change_of(
        "update_rows",
        json!({"rows": [
            {"id": "r1", "name": ""},
            {"id": "r2", "title": null},
            {"id": "r3", "summary": "   "},
            {"id": "r4", "key": ""},
        ]}),
    );
    let batch = change.batch.expect("batch");
    assert_eq!(batch.rows_emptying, 4);
    let names: Vec<_> = batch.rows.iter().map(|row| row.name.clone()).collect();
    assert_eq!(
        names,
        [
            Some("r1".into()),
            Some("r2".into()),
            Some("r3".into()),
            Some("r4".into())
        ]
    );
    let emptied: Vec<_> = batch
        .fields
        .iter()
        .map(|field| (field.raw_name.as_str(), field.emptied))
        .collect();
    assert_eq!(
        emptied,
        [("name", 1), ("title", 1), ("summary", 1), ("key", 1)]
    );
}

#[test]
fn a_batch_promises_nothing_about_rows_it_did_not_fully_read() {
    let batch_of = |arguments: Value| change_of("update_rows", arguments).batch.expect("batch");
    let row = |index: usize| json!({"id": format!("r{index}"), "state": "x"});
    assert!(batch_of(json!({"rows": [row(0), row(1)]})).read_all);

    let too_many: Vec<_> = (0..MAX_ROWS_READ + 1).map(row).collect();
    assert!(!batch_of(json!({"rows": too_many})).read_all);

    let two_lists = change_of(
        "update_rows",
        json!({"rows": [row(0), row(1)], "records": [row(2), row(3)]}),
    );
    assert!(!two_lists.batch.expect("batch").read_all);
    assert!(!two_lists.complete);

    let wide_rows: Vec<_> = (0..1500)
        .map(|index| {
            let members: serde_json::Map<String, Value> = (0..20)
                .map(|field| (format!("f{field}"), json!(index)))
                .collect();
            Value::Object(members)
        })
        .collect();
    assert!(!batch_of(json!({"rows": wide_rows})).read_all);

    // A null inside a nested value would escape the row's own emptied check.
    let nested = batch_of(json!({"rows": [{"id": "r1", "meta": {"owner": null, "x": 1}}, row(2)]}));
    assert!(!nested.read_all);
}

#[test]
fn caps_are_counted_and_the_description_says_it_is_incomplete() {
    let conditions: serde_json::Map<String, Value> = (0..MAX_FILTER_PARTS + 3)
        .map(|index| (format!("c{index}"), json!("v")))
        .collect();
    let filtered = change_of("delete_rows", json!({"where": conditions}));
    let filter = filtered.filter.as_ref().expect("filter");
    assert_eq!(filter.parts.len(), MAX_FILTER_PARTS);
    assert_eq!(filter.omitted, 3);
    assert!(!filtered.complete);

    let statements: serde_json::Map<String, Value> = (0..MAX_OPAQUE + 2)
        .map(|index| (format!("step{index}_sql"), json!("UPDATE t SET a = 1")))
        .collect();
    let opaque = change_of("run_statements", Value::Object(statements));
    assert_eq!(opaque.opaque.len(), MAX_OPAQUE);
    assert_eq!(opaque.opaque_omitted, 2);
    assert!(!opaque.complete);

    let long: serde_json::Map<String, Value> = (0..MAX_TEXTS + 2)
        .map(|index| (format!("t{index}"), json!("line\nline")))
        .collect();
    let texts_past = change_of("update_page", Value::Object(long));
    assert_eq!(texts_past.texts.len(), MAX_TEXTS);
    assert_eq!(texts_past.texts_omitted, 2);
    assert!(!texts_past.complete);
}

#[test]
fn each_address_in_a_string_is_counted_and_checked_as_written() {
    let context = ToolResultContext::default().with_organization(Some("me@contoso.example"), &[]);
    let recipients = |to: Value| {
        change_with(
            &tool("send_email", "", None),
            json!({"to": to, "subject": "x", "body": "y"}),
            &context,
        )
        .0
        .recipients
        .expect("recipients")
    };
    let mixed = recipients(json!(
        r#"a@contoso.example, "Doe, Jo" <b@fabrikam.example>; c@contoso.example"#
    ));
    assert_eq!(mixed.total, 3);
    assert_eq!(mixed.outside, [r#""Doe, Jo" <b@fabrikam.example>"#]);
    assert_eq!(mixed.unchecked, 0);

    // A domain the card could only show cut still decides who is outside.
    let long = format!("{}@fabrikam.example", "a".repeat(600));
    let cut = recipients(json!(long));
    assert_eq!(cut.total, 1);
    assert_eq!(
        cut.outside.len() + cut.outside_omitted as usize,
        1,
        "{cut:?}"
    );
    assert_eq!(cut.unchecked, 0);

    for broken in [
        "Mallory <mallory@contoso.example",
        "mallory@contoso.example\u{200b}@evil.example",
        "\"unterminated@contoso.example",
        "a@contoso.example@evil.example",
    ] {
        let found = recipients(json!(broken));
        assert_eq!(
            found.unchecked + u32::try_from(found.outside.len()).unwrap(),
            found.total,
            "{broken}: {found:?}"
        );
    }
}

#[test]
fn recipient_groups_know_whether_they_are_to_cc_or_bcc() {
    let (change, _) = change_with(
        &tool("send_email", "", None),
        json!({"to": ["a@b.example"], "cc": ["c@d.example"], "bccRecipients": ["e@f.example"], "subject": "x", "body": "y"}),
        &ToolResultContext::default(),
    );
    let kinds: Vec<_> = change
        .recipients
        .expect("recipients")
        .groups
        .iter()
        .map(|group| group.kind)
        .collect();
    assert_eq!(
        kinds,
        [
            ToolCallRecipientKind::To,
            ToolCallRecipientKind::Cc,
            ToolCallRecipientKind::Bcc
        ]
    );
}

#[test]
fn an_emptied_row_is_not_one_more_value_of_its_field() {
    let batch = change_of(
        "update_rows",
        json!({"rows": [
            {"id": "r1", "due": "2026-12-31"},
            {"id": "r2", "due": "2026-12-31"},
            {"id": "r3", "due": null},
        ]}),
    )
    .batch
    .expect("batch");
    let due = &batch.fields[0];
    assert_eq!((due.rows, due.emptied, due.distinct), (3, 1, 1));
    assert_eq!(texts(&due.samples), ["2026-12-31"]);
}

#[test]
fn a_row_compares_only_with_a_read_of_that_row() {
    let context = read_of(
        "get_record",
        json!({"id": RECORD}),
        json!({"id": RECORD, "name": "Parent", "state": "open"}),
    );
    let row_effect = |context: &ToolResultContext| {
        let (change, _) = change_with(
            &tool("update_records", "", None),
            json!({"id": RECORD, "rows": [{"id": "row-2", "state": "open"}, {"id": "row-3", "state": "open"}]}),
            context,
        );
        let batch = change.batch.expect("batch");
        batch.rows[0].effects[0].clone()
    };
    let unrelated = row_effect(&context);
    assert_eq!(unrelated.effect, ToolCallEffectKind::Set);
    assert!(unrelated.old.is_none());

    let own_read = read_of(
        "list_records",
        json!({"table": "t"}),
        json!({"items": [{"id": "row-2", "name": "Row two", "state": "closed"}]}),
    );
    let own = row_effect(&own_read);
    assert_eq!(own.effect, ToolCallEffectKind::Changed);
    assert_eq!(own.old.as_ref().unwrap().text, "closed");
}

#[test]
fn objects_never_read_as_json_and_machine_ids_stay_out_of_values_and_names() {
    let mark = HIDDEN_ID_MARK.to_string();
    let filtered = change_of(
        "delete_rows",
        json!({"where": [{"owner": RECORD, "state": null}]}),
    );
    let text = filtered.filter.unwrap().text.expect("text").text;
    assert!(!text.contains(['{', '"']), "{text}");
    assert!(text.contains(&mark), "{text}");
    assert!(!text.contains(RECORD), "{text}");

    let batch = change_of(
        "update_rows",
        json!({"rows": [{"id": "r1", "meta": {"owner_id": RECORD}}, {"id": "r2", "meta": {"owner_id": RECORD}}]}),
    )
    .batch
    .expect("batch");
    let sample = &batch.fields[0].samples[0].text;
    assert!(!sample.contains(['{', '"']), "{sample}");
    assert!(sample.contains(&mark), "{sample}");

    // Inside an object an ID never takes a name, so copying a card forgets nothing.
    let named = read_of(
        "get_contact",
        json!({"id": ACCOUNT}),
        json!({"id": ACCOUNT, "name": "Ada Lovelace"}),
    );
    let (nested, _) = change_with(
        &tool("delete_rows", "", None),
        json!({"where": [{"owner": ACCOUNT, "state": "open"}]}),
        &named,
    );
    let text = nested.filter.unwrap().text.expect("text").text;
    assert!(text.contains(&mark) && !text.contains("Ada"), "{text}");

    let change = change_of("update_record", json!({"id": "r1", RECORD: "x"}));
    let named = change
        .effects
        .iter()
        .find(|effect| effect.values.iter().any(|value| value.text == "x"))
        .expect("the value");
    assert_eq!(named.name, mark);
    assert_eq!(named.raw_name, "");

    let spoofed = change_of(
        "update_record",
        json!({"id": "r1", "state": format!("a{mark}b")}),
    );
    assert_eq!(effect(&spoofed, "state").values[0].text, "ab");

    let context = read_of(
        "get_issue",
        json!({"issue_number": 7}),
        json!({"number": 7, "owners": [ACCOUNT, "bob"]}),
    );
    let (change, _) = change_with(
        &tool("update_issue", "", None),
        json!({"issue_number": 7, "owners": ["bob", ACCOUNT, "carl"]}),
        &context,
    );
    let owners = effect(&change, "owners");
    assert_eq!(owners.effect, ToolCallEffectKind::Changed);
    assert!(owners.old.is_none(), "{owners:?}");
}

#[test]
fn a_crafted_200_kb_call_stays_under_the_stored_bound() {
    const STORED_BOUND: usize = 72 * 1024;
    let text = "line\n".repeat(400);
    let mut arguments = serde_json::Map::new();
    arguments.insert("old_str".to_string(), json!(text.clone()));
    arguments.insert("new_str".to_string(), json!(text.clone()));
    for index in 0..30 {
        arguments.insert(format!("text_{index}"), json!(text.clone()));
        arguments.insert(
            format!("step{index}_sql"),
            json!(format!("UPDATE t SET a = '{text}'")),
        );
    }
    for index in 0..200 {
        arguments.insert(
            format!("{}_{index}", "n".repeat(200)),
            json!("v".repeat(300)),
        );
    }
    arguments.insert(
        "rows".to_string(),
        json!((0..2000).map(|index| json!({"id": format!("row-{index}"), "note": "x".repeat(100), "gone": null})).collect::<Vec<_>>()),
    );
    let arguments = Value::Object(arguments);
    assert!(serde_json::to_string(&arguments).unwrap().len() > 200 * 1024);
    let (change, _) = change_with(
        &tool("update_record", "", None),
        arguments,
        &ToolResultContext::default(),
    );
    let stored = serde_json::to_string(&change).unwrap().len();
    assert!(stored < STORED_BOUND, "{stored}");
    assert!(!change.complete);
    assert!(
        change
            .texts
            .iter()
            .filter(|text| text.before.is_some())
            .count()
            <= 1
    );
}

#[test]
fn a_read_that_does_not_echo_the_id_says_nothing_about_that_id() {
    let context = read_of(
        "get_record",
        json!({"record_id": "rec-7"}),
        json!({"name": "Someone else", "state": "open", "number": 8}),
    );
    let (change, _) = change_with(
        &tool("update_record", "", None),
        json!({"record_id": "rec-7", "state": "closed"}),
        &context,
    );
    assert_eq!(effect(&change, "state").effect, ToolCallEffectKind::Set);
    assert!(effect(&change, "state").old.is_none());
    assert!(
        !change
            .notes
            .contains(&ToolCallChangeNote::OldValuesFromEarlier)
    );
}

#[test]
fn the_models_verb_only_words_the_headline_and_never_decides_what_is_lost() {
    let tool = tool("outbox", "", None);
    let arguments = json!({"stage": null, "labels": ["a"]});
    let context = ToolResultContext::default();
    let mapping = ToolCallLabelMapping {
        action: ToolCallAction::Update,
        object_kind: ToolCallObjectKind::Row,
        items: Vec::new(),
        source: ToolCallLabelSource::Model,
    };
    let label = checked_label(SERVER, &tool, &arguments, &mapping, None);
    assert_eq!(label.action, ToolCallAction::Update);
    let rules_action = rules_label(&tool.name, &arguments, None, None)
        .mapping
        .action;
    assert_eq!(rules_action, ToolCallAction::Other);
    let described = describe(
        &label,
        ChangeFacts {
            tool: &tool,
            arguments: &arguments,
            approval_argument: None,
            context: &context,
            server: None,
            rules_action,
            glossary: None,
            destructive_hint_source: Default::default(),
        },
    );
    assert!(described.is_none(), "{described:?}");
}

#[test]
fn a_call_with_no_verb_still_says_what_reaches_past_its_values_and_claims_no_loss() {
    let context = ToolResultContext::default().with_organization(Some("me@contoso.example"), &[]);
    let (change, _) = change_with(
        &tool("outbox", "", None),
        json!({"to": ["ana@fabrikam.example"], "stage": null}),
        &context,
    );
    assert_eq!(
        change.recipients.as_ref().unwrap().outside,
        ["ana@fabrikam.example"]
    );
    assert_eq!(change.counts.emptied, 0);
    for arguments in [
        json!({"where": {"a": 1}}),
        json!({"force": true}),
        json!({"sql": "DROP TABLE t"}),
        json!({"body": "line\nline"}),
        json!({"rows": [{"id": "r1", "a": null}, {"id": "r2", "a": null}]}),
    ] {
        let (change, _) = change_with(&tool("outbox", "", None), arguments.clone(), &context);
        assert_eq!(change.counts.emptied, 0, "{arguments}");
        if let Some(batch) = change.batch {
            assert_eq!(batch.rows_emptying, 0, "{arguments}");
            assert!(!batch.read_all, "{arguments}");
        }
    }
}

#[test]
fn a_row_past_its_field_cap_counts_them_and_claims_no_shared_change() {
    let wide = |index: usize| {
        let mut members: serde_json::Map<String, Value> = (0..MAX_ROW_EFFECTS + 3)
            .map(|field| (format!("f{field}"), json!("x")))
            .collect();
        members.insert("id".to_string(), json!(format!("r{index}")));
        Value::Object(members)
    };
    let batch = change_of("update_rows", json!({"rows": [wide(0), wide(1)]}))
        .batch
        .expect("batch");
    assert_eq!(batch.rows[0].effects.len(), MAX_ROW_EFFECTS);
    assert_eq!(batch.rows[0].effects_omitted, 3);
    assert!(!batch.same_change);
    assert!(batch.shared.is_empty());
}

#[test]
fn rows_with_different_operations_never_change_the_same_way() {
    let batch = change_of(
        "update_rows",
        json!({"rows": [{"action": "update", "id": "r1", "a": 1}, {"action": "delete", "id": "r2", "a": 1}]}),
    )
    .batch
    .expect("batch");
    assert!(!batch.same_change);
}

#[test]
fn forgetting_covers_counts_past_the_cap_filters_rows_and_samples() {
    let fields: serde_json::Map<String, Value> = (0..100)
        .map(|index| (format!("f{index}"), json!("same")))
        .collect();
    let mut read = serde_json::Map::new();
    read.insert("number".to_string(), json!(7));
    read.insert("labels".to_string(), json!(["a"]));
    read.extend(fields.clone());
    let context = read_of("get_issue", json!({"issue_number": 7}), Value::Object(read));
    let mut arguments = serde_json::Map::new();
    arguments.insert("issue_number".to_string(), json!(7));
    arguments.insert("labels".to_string(), json!(["a", "b"]));
    arguments.extend(fields);
    let (mut many, _) = change_with(
        &tool("update_issue", "", None),
        Value::Object(arguments),
        &context,
    );
    let before = many.counts;
    assert!(before.unchanged > MAX_EFFECTS as u32 / 2, "{before:?}");
    assert_eq!(before.changed, 1);
    forget_earlier(&mut many);
    assert_eq!(many.counts.unchanged, 0);
    assert_eq!(many.counts.changed, 0);
    assert_eq!(many.counts.set, before.set + before.unchanged);
    assert_eq!(many.counts.list_replaced, 1);
    assert_eq!(
        effect(&many, "labels").effect,
        ToolCallEffectKind::ListReplaced
    );
    assert!(effect(&many, "labels").added.is_empty());

    let named = read_of(
        "get_contact",
        json!({"id": ACCOUNT}),
        json!({"id": ACCOUNT, "name": "Ada Lovelace"}),
    );
    let (mut filtered, _) = change_with(
        &tool("delete_rows", "", None),
        json!({"where": {"owner": ACCOUNT}}),
        &named,
    );
    assert_eq!(
        filtered.filter.as_ref().unwrap().parts[0].value.text,
        "Ada Lovelace"
    );
    forget_earlier(&mut filtered);
    assert_eq!(filtered.filter.as_ref().unwrap().parts[0].value.text, "");

    let (mut rows, _) = change_with(
        &tool("update_rows", "", None),
        json!({"rows": [{"id": ACCOUNT, "owner": ACCOUNT}, {"id": "r2", "owner": ACCOUNT}]}),
        &named,
    );
    let batch = rows.batch.as_ref().unwrap();
    assert_eq!(batch.rows[0].name.as_deref(), Some("Ada Lovelace"));
    assert_eq!(batch.rows[1].name.as_deref(), Some("r2"));
    forget_earlier(&mut rows);
    let batch = rows.batch.as_ref().unwrap();
    assert_eq!(batch.rows[0].name, None);
    assert_eq!(batch.rows[1].name.as_deref(), Some("r2"));
}

#[test]
fn the_argument_view_flags_a_member_named_by_a_machine_id() {
    let tool = tool("update_record", "", None);
    let arguments = json!({"id": "r1", RECORD: "x"});
    let label = labelled(&tool, &arguments, &ToolResultContext::default());
    let view = serde_json::to_value(label.arguments.expect("a view")).unwrap();
    let children = view["children"].as_array().expect("children");
    let flagged = |path: &str| {
        children
            .iter()
            .find(|child| child["path"] == path)
            .unwrap_or_else(|| panic!("{view}"))["machine_name"]
            == json!(true)
    };
    assert!(flagged(&format!("/{RECORD}")));
    assert!(!flagged("/id"));
}

#[test]
fn a_crash_while_describing_only_loses_the_description() {
    assert!(guarded_describe(|| panic!("a bug")).is_none());
}

#[test]
fn organization_domains_ignore_dots_and_a_public_mail_user_has_none() {
    let outside = |user: &str, extra: &[&str], to: &str| {
        let extra: Vec<String> = extra.iter().map(|domain| domain.to_string()).collect();
        let context = ToolResultContext::default().with_organization(Some(user), &extra);
        change_with(
            &tool("send_email", "", None),
            json!({"to": to, "subject": "x", "body": "y"}),
            &context,
        )
        .0
        .recipients
        .expect("recipients")
    };
    assert!(
        outside(
            "me@contoso.example",
            &[".partner.example."],
            "a@partner.example"
        )
        .outside
        .is_empty()
    );
    assert!(
        outside(
            "me@contoso.example",
            &["partner.example"],
            "a@partner.example."
        )
        .outside
        .is_empty()
    );
    let public = outside("me@gmail.com", &[], "a@fabrikam.example");
    assert!(!public.outside_known);
    assert!(public.outside.is_empty());
}

#[test]
fn trash_is_restorable_and_a_negated_permanently_is_no_claim() {
    let trash = change_with(
        &tool(
            "trash_file",
            "Moves a file to the user's trash. It does not permanently delete the file.",
            None,
        ),
        json!({"fileId": "f_1"}),
        &ToolResultContext::default(),
    )
    .0;
    assert!(
        trash
            .notes
            .contains(&ToolCallChangeNote::ToolSaysRestorable)
    );
    assert!(!trash.notes.contains(&ToolCallChangeNote::ToolSaysPermanent));
}

#[test]
fn an_address_counts_as_reach_only_on_a_send_or_share() {
    let context = ToolResultContext::default().with_organization(Some("me@contoso.example"), &[]);
    let shared = change_with(
        &tool("share_file", "", None),
        json!({"fileId": "f_1", "role": "writer", "emailAddress": "ana@fabrikam.example"}),
        &context,
    )
    .0;
    assert_eq!(shared.recipients.unwrap().outside, ["ana@fabrikam.example"]);

    let record = change_with(
        &tool("update_company", "", None),
        json!({"id": "c1", "properties": {"phone": "+49 30 000000", "email": "a@x.example"}}),
        &context,
    )
    .0;
    assert_eq!(record.recipients, None);
    assert_eq!(texts(&effect(&record, "phone").values), ["+49 30 000000"]);
}

#[test]
fn a_member_named_add_says_it_only_adds_and_a_path_names_what_a_write_acts_on() {
    let add = change_of("save_issue", json!({"id": "ENG-1", "addLabels": ["x"]}));
    assert_eq!(effect(&add, "addLabels").effect, ToolCallEffectKind::Set);

    let rules = rules_label(
        "write_file",
        &json!({"path": "/srv/a", "content": "x"}),
        None,
        None,
    );
    assert_eq!(rules.mapping.items[0].id.as_deref(), Some("/path"));
    let read = rules_label("read_file", &json!({"path": "/srv/a"}), None, None);
    assert!(read.mapping.items.is_empty());
}

#[test]
fn a_statement_member_makes_a_query_tool_a_run_but_never_a_read_tool() {
    let run = rules_label(
        "query",
        &json!({"sql": "select pg_terminate_backend(1)"}),
        None,
        None,
    );
    assert_eq!(run.mapping.action, ToolCallAction::Run);
    let read = rules_label("read_query", &json!({"sql": "select 1"}), None, None);
    assert_eq!(read.mapping.action, ToolCallAction::Other);
    let search = rules_label(
        "search",
        &json!({"query": "delete pages about Q4"}),
        None,
        None,
    );
    assert_eq!(search.mapping.action, ToolCallAction::Other);
}

#[test]
fn a_delete_without_an_id_names_what_goes() {
    let rules = rules_label(
        "resources_delete",
        &json!({"apiVersion": "v1", "kind": "Namespace", "name": "shop"}),
        None,
        None,
    );
    assert_eq!(rules.mapping.items[0].title.as_deref(), Some("/name"));
}

#[test]
fn one_old_and_new_text_edit_in_a_list_reads_old_to_new() {
    let change = change_of(
        "edit_file",
        json!({"path": "/x", "edits": [{"oldText": "a", "newText": "b"}]}),
    );
    let edit = effect(&change, "newText");
    assert_eq!(edit.effect, ToolCallEffectKind::Changed);
    assert_eq!(edit.old.as_ref().unwrap().text, "a");
}

fn with_change(
    tool: &Tool,
    arguments: Value,
    context: &ToolResultContext,
    destructive_hint_source: McpToolAnnotationSource,
) -> ToolCallChange {
    let label = labelled(tool, &arguments, context);
    describe(
        &label,
        ChangeFacts {
            tool,
            arguments: &arguments,
            approval_argument: None,
            context,
            server: Some(SERVER),
            rules_action: label.action,
            glossary: None,
            destructive_hint_source,
        },
    )
    .expect("a labelled call has a change description")
    .0
}

fn with_glossary(
    tool: &Tool,
    arguments: Value,
    glossary: &erato_config::config::McpGlossaryConfig,
) -> ToolCallChange {
    let context = ToolResultContext::default();
    let label = labelled(tool, &arguments, &context);
    describe(
        &label,
        ChangeFacts {
            tool,
            arguments: &arguments,
            approval_argument: None,
            context: &context,
            server: Some(SERVER),
            rules_action: label.action,
            glossary: Some(glossary),
            destructive_hint_source: Default::default(),
        },
    )
    .expect("a labelled call has a change description")
    .0
}

fn tool_with_schema(name: &str, description: &str, schema: Value) -> Tool {
    Tool::new(
        name.to_string(),
        description.to_string(),
        schema.as_object().unwrap().clone(),
    )
}

fn read_issue(priority: Value) -> ToolResultContext {
    read_of(
        "get_issue",
        json!({"id": RECORD}),
        json!({"id": RECORD, "title": "Upload fails", "priority": priority}),
    )
}

#[test]
fn a_coded_old_value_compares_in_the_same_form_as_the_new_one() {
    let context = read_issue(json!({"name": "Low", "value": 4}));
    let update = tool("update_issue", "", None);

    let (changed, _) = change_with(&update, json!({"id": RECORD, "priority": 2}), &context);
    let row = effect(&changed, "priority");
    assert_eq!(row.effect, ToolCallEffectKind::Changed);
    let old = row.old.as_ref().unwrap();
    assert_eq!(old.text, "4");
    assert_eq!(
        old.meaning.as_ref().unwrap(),
        &ToolCallValueMeaning {
            label: "Low".into(),
            source: ToolCallValueMeaningSource::Earlier,
        }
    );
    assert_eq!(row.values[0].text, "2");
    assert_eq!(row.values[0].meaning, None);

    // The same code and the same label are both "the same value".
    for same in [json!(4), json!("Low"), json!("4")] {
        let (kept, _) = change_with(&update, json!({"id": RECORD, "priority": same}), &context);
        assert_eq!(
            effect(&kept, "priority").effect,
            ToolCallEffectKind::Unchanged,
            "{same}"
        );
    }

    // Against a label, the old value stays a label.
    let (relabelled, _) = change_with(&update, json!({"id": RECORD, "priority": "High"}), &context);
    let old = effect(&relabelled, "priority").old.as_ref().unwrap();
    assert_eq!((old.text.as_str(), &old.meaning), ("Low", &None));
}

#[test]
fn a_label_with_a_string_code_works_the_same_and_a_link_is_no_pair() {
    let context = read_issue(json!({"label": "Blocked", "code": "blocked"}));
    let (same, _) = change_with(
        &tool("update_issue", "", None),
        json!({"id": RECORD, "priority": "blocked"}),
        &context,
    );
    let row = effect(&same, "priority");
    assert_eq!(row.effect, ToolCallEffectKind::Unchanged);
    assert_eq!(row.old.as_ref().unwrap().text, "blocked");

    // {id, name} is a link to a record, whose earlier value is its ID.
    let context = read_issue(json!({"id": "9", "name": "Tess"}));
    let (linked, _) = change_with(
        &tool("update_issue", "", None),
        json!({"id": RECORD, "priority": "9"}),
        &context,
    );
    let row = effect(&linked, "priority");
    assert_eq!(row.effect, ToolCallEffectKind::Unchanged);
    assert_eq!(row.old.as_ref().unwrap().meaning, None);
}

#[test]
fn a_field_only_compares_with_the_field_of_the_same_name() {
    let context = read_of(
        "get_contact",
        json!({"id": RECORD}),
        json!({"id": RECORD, "name": "Ada", "status": "active"}),
    );
    let (change, _) = change_with(
        &tool("update_contact", "", None),
        json!({"id": RECORD, "state": "CA"}),
        &context,
    );
    let row = effect(&change, "state");
    assert_eq!(row.effect, ToolCallEffectKind::Set);
    assert_eq!(row.old, None);
}

#[test]
fn a_newer_read_without_the_code_retires_the_code_an_older_read_gave() {
    let context = earlier(vec![
        (
            "get_issue",
            json!({"id": RECORD}),
            json!({"id": RECORD, "title": "Upload fails", "priority": {"name": "Low", "value": 4}}),
        ),
        (
            "list_issues",
            json!({}),
            json!([{"id": RECORD, "title": "Upload fails", "priority": 2}]),
        ),
    ]);
    let update = tool("update_issue", "", None);
    let (back, _) = change_with(&update, json!({"id": RECORD, "priority": 4}), &context);
    let row = effect(&back, "priority");
    assert_eq!(row.effect, ToolCallEffectKind::Changed);
    assert_eq!(row.old.as_ref().unwrap().text, "2");
    assert_eq!(row.old.as_ref().unwrap().meaning, None);
    assert!(!back.notes.contains(&ToolCallChangeNote::NothingChanges));

    let (other, _) = change_with(&update, json!({"id": RECORD, "priority": 3}), &context);
    assert_eq!(effect(&other, "priority").old.as_ref().unwrap().text, "2");
}

#[test]
fn a_coded_earlier_value_never_shows_a_contact_number_or_an_id_as_its_label() {
    let context = read_of(
        "get_contact",
        json!({"id": RECORD}),
        json!({"id": RECORD, "name": "Ada", "phone": {"label": "Mobile", "value": 4915112345678u64}}),
    );
    let (change, _) = change_with(
        &tool("update_contact", "", None),
        json!({"id": RECORD, "phone": 4915112345679u64}),
        &context,
    );
    assert_eq!(effect(&change, "phone").old, None);

    let context = read_issue(json!({"name": "5f0c2a10-0000-4000-8000-00000000d001", "value": 4}));
    let (change, _) = change_with(
        &tool("update_issue", "", None),
        json!({"id": RECORD, "priority": 3}),
        &context,
    );
    let old = effect(&change, "priority").old.as_ref().unwrap();
    assert_eq!(old.meaning, None);
    assert!(old.machine_id && old.text.is_empty(), "{old:?}");
}

#[test]
fn the_same_number_as_an_integer_or_a_float_is_the_same_code() {
    let context = read_issue(json!({"name": "Low", "value": 4.0}));
    let update = tool("update_issue", "", None);
    let (same, _) = change_with(&update, json!({"id": RECORD, "priority": 4}), &context);
    assert_eq!(
        effect(&same, "priority").effect,
        ToolCallEffectKind::Unchanged
    );
    let (other, _) = change_with(&update, json!({"id": RECORD, "priority": 4.5}), &context);
    assert_eq!(
        effect(&other, "priority").effect,
        ToolCallEffectKind::Changed
    );
}

#[test]
fn a_name_beside_a_text_value_is_no_label_and_the_value_is_compared() {
    let context = read_issue(json!({"name": "Region", "value": "EMEA"}));
    let update = tool("update_issue", "", None);
    let (same, _) = change_with(&update, json!({"id": RECORD, "priority": "EMEA"}), &context);
    let row = effect(&same, "priority");
    assert_eq!(row.effect, ToolCallEffectKind::Unchanged);
    let old = row.old.as_ref().unwrap();
    assert_eq!((old.text.as_str(), &old.meaning), ("EMEA", &None));

    let (other, _) = change_with(&update, json!({"id": RECORD, "priority": "APAC"}), &context);
    let row = effect(&other, "priority");
    assert_eq!(row.effect, ToolCallEffectKind::Changed);
    assert_eq!(row.old.as_ref().unwrap().text, "EMEA");
}

#[test]
fn a_code_means_something_only_when_someone_says_so() {
    let schema = json!({"type": "object", "properties": {
        "id": {"type": "string"},
        "priority": {"type": "number", "description": "0=None, 1=Urgent, 2=High, 3=Medium, 4=Low"},
        "phone": {"type": "string", "description": "1=Home, 2=Work"},
    }});
    let update = tool_with_schema("update_issue", "", schema);

    let (nothing, _) = change_with(
        &tool("update_issue", "", None),
        json!({"id": RECORD, "priority": 4}),
        &ToolResultContext::default(),
    );
    assert_eq!(effect(&nothing, "priority").values[0].meaning, None);

    let context = read_issue(json!({"name": "Low", "value": 4}));
    let (change, _) = change_with(&update, json!({"id": RECORD, "priority": 2}), &context);
    let row = effect(&change, "priority");
    assert_eq!(
        row.values[0].meaning.as_ref().unwrap(),
        &ToolCallValueMeaning {
            label: "High".into(),
            source: ToolCallValueMeaningSource::Tool,
        }
    );
    assert_eq!(
        row.old.as_ref().unwrap().meaning.as_ref().unwrap().label,
        "Low"
    );

    // A plain earlier number gets the schema's meaning, on both sides.
    let plain = read_issue(json!(3));
    let (known, _) = change_with(&update, json!({"id": RECORD, "priority": 1}), &plain);
    let row = effect(&known, "priority");
    let old = row.old.as_ref().unwrap();
    assert_eq!(
        (
            old.text.as_str(),
            old.meaning.as_ref().unwrap().label.as_str()
        ),
        ("3", "Medium")
    );

    // The earlier read and the schema agree: the read's word wins.
    let (agreed, _) = change_with(&update, json!({"id": RECORD, "priority": 4}), &context);
    assert_eq!(
        effect(&agreed, "priority").values[0]
            .meaning
            .as_ref()
            .unwrap()
            .source,
        ToolCallValueMeaningSource::Earlier
    );

    // A schema that disagrees with what was read says nothing about the code.
    let disagreeing = read_issue(json!({"name": "Custom", "value": 2}));
    let (conflict, _) = change_with(&update, json!({"id": RECORD, "priority": 2}), &disagreeing);
    assert_eq!(effect(&conflict, "priority").values[0].meaning, None);

    // A recipient or a phone-shaped value never gets a meaning.
    let (reach, _) = change_with(
        &update,
        json!({"id": RECORD, "phone": "+49 30 1234567", "priority": 1}),
        &context,
    );
    assert_eq!(effect(&reach, "phone").values[0].meaning, None);
}

#[test]
fn a_label_from_a_read_only_counts_for_records_of_that_read() {
    let list = json!([
        {"id": RECORD, "name": "A", "priority": {"name": "Low", "value": 4}},
        {"id": ACCOUNT, "name": "B", "priority": {"name": "Urgent", "value": 1}},
    ]);
    let context = earlier(vec![
        ("list_issues", json!({}), list),
        (
            "list_tasks",
            json!({}),
            json!([{"id": "t1", "name": "C", "priority": {"name": "Blocker", "value": 1}}]),
        ),
    ]);
    let update = tool("update_issue", "", None);
    let (change, _) = change_with(&update, json!({"id": RECORD, "priority": 1}), &context);
    let row = effect(&change, "priority");
    // "1" means Urgent in the read that returned this record, whatever
    // another table called it.
    assert_eq!(row.old.as_ref().unwrap().text, "4");
    assert_eq!(row.values[0].meaning.as_ref().unwrap().label, "Urgent");
    assert_eq!(
        row.values[0].meaning.as_ref().unwrap().source,
        ToolCallValueMeaningSource::Earlier
    );

    // Two labels for one code in that read: nothing is claimed.
    let context = read_of(
        "list_issues",
        json!({}),
        json!([
            {"id": RECORD, "name": "A", "priority": {"name": "Low", "value": 4}},
            {"id": ACCOUNT, "name": "B", "priority": {"name": "Urgent", "value": 1}},
            {"id": "t2", "name": "C", "priority": {"name": "Blocker", "value": 1}},
        ]),
    );
    let (ambiguous, _) = change_with(&update, json!({"id": RECORD, "priority": 1}), &context);
    assert_eq!(effect(&ambiguous, "priority").values[0].meaning, None);
}

#[test]
fn the_glossary_names_fields_and_values_with_the_raw_name_beside_it() {
    let glossary: erato_config::config::McpGlossaryConfig = serde_json::from_value(json!({
        "field_names": {"itemtypecode": "Item type"},
        "choice_labels": {"itemtypecode": {"8": "Spare part"}},
    }))
    .unwrap();
    let change = with_glossary(
        &tool("update_record", "", None),
        json!({"id": RECORD, "fields": {"itemtypecode": 8, "expectedenddate": "2026-01-01"}}),
        &glossary,
    );
    let row = effect(&change, "itemtypecode");
    assert_eq!(row.name, "Item type (itemtypecode)");
    assert_eq!(
        row.values[0].meaning.as_ref().unwrap(),
        &ToolCallValueMeaning {
            label: "Spare part".into(),
            source: ToolCallValueMeaningSource::Glossary,
        }
    );
    assert_eq!(effect(&change, "expectedenddate").name, "Expected end date");
}

#[test]
fn a_glossary_label_the_tool_or_a_read_contradicts_says_nothing() {
    let glossary: erato_config::config::McpGlossaryConfig = serde_json::from_value(json!({
        "choice_labels": {"priority": {"2": "Won", "1": "low"}},
    }))
    .unwrap();
    let schema = json!({"type": "object", "properties": {
        "id": {"type": "string"},
        "priority": {"type": "number", "description": "1=Low, 2=High"},
    }});
    let update = tool_with_schema("update_issue", "", schema);
    let meaning_with = |code: i64, context: &ToolResultContext| {
        let arguments = json!({"id": RECORD, "priority": code});
        let label = labelled(&update, &arguments, context);
        let change = describe(
            &label,
            ChangeFacts {
                tool: &update,
                arguments: &arguments,
                approval_argument: None,
                context,
                server: Some(SERVER),
                rules_action: label.action,
                glossary: Some(&glossary),
                destructive_hint_source: Default::default(),
            },
        )
        .unwrap()
        .0;
        effect(&change, "priority").values[0].meaning.clone()
    };
    let nothing_read = ToolResultContext::default();
    assert_eq!(meaning_with(2, &nothing_read), None);
    assert_eq!(
        meaning_with(1, &nothing_read),
        Some(ToolCallValueMeaning {
            label: "low".into(),
            source: ToolCallValueMeaningSource::Glossary,
        })
    );
    let plain = tool("update_issue", "", None);
    let arguments = json!({"id": RECORD, "priority": 2});
    let read = read_issue(json!({"name": "Lost", "value": 2}));
    let label = labelled(&plain, &arguments, &read);
    let change = describe(
        &label,
        ChangeFacts {
            tool: &plain,
            arguments: &arguments,
            approval_argument: None,
            context: &read,
            server: Some(SERVER),
            rules_action: label.action,
            glossary: Some(&glossary),
            destructive_hint_source: Default::default(),
        },
    )
    .unwrap()
    .0;
    assert_eq!(effect(&change, "priority").values[0].meaning, None);
}

#[test]
fn a_glossary_never_names_a_machine_id_field_or_a_recipient() {
    let glossary: erato_config::config::McpGlossaryConfig = serde_json::from_value(json!({
        "field_names": {RECORD: "Secret name", "to": "Audience"},
        "choice_labels": {"to": {"a@example.com": "Everyone"}},
    }))
    .unwrap();
    let change = with_glossary(
        &tool("send_email", "", None),
        json!({"subject": "Hi", "to": "a@example.com", "metadata": {RECORD: "x"}}),
        &glossary,
    );
    let recipients = change.recipients.as_ref().unwrap();
    assert_eq!(recipients.groups[0].values, ["a@example.com"]);
    assert!(
        change
            .effects
            .iter()
            .all(|effect| !effect.name.contains("Secret name"))
    );
}

#[test]
fn the_destructive_note_follows_the_verb_and_who_set_the_hint_never_the_name() {
    let context = ToolResultContext::default();
    let notes = |name: &str, arguments: Value, source: McpToolAnnotationSource| {
        with_change(&tool(name, "", Some(true)), arguments, &context, source).notes
    };
    let tool_said = McpToolAnnotationSource::ServerSupplied;
    let marked = ToolCallChangeNote::MarkedDestructive;
    let operator = ToolCallChangeNote::OperatorMarkedDestructive;
    for (name, arguments) in [
        ("create_record", json!({"name": "x"})),
        ("send_email", json!({"subject": "x", "to": "a@b.example"})),
        ("delete_page", json!({"page_id": "p1"})),
        ("delete_sync_job", json!({"job_id": "j1"})),
        ("run_sync", json!({"source": "s1"})),
        ("save_record", json!({"name": "x"})),
    ] {
        let found = notes(name, arguments, tool_said);
        assert!(found.contains(&marked), "{name}: {found:?}");
    }
    for (name, arguments) in [
        ("update_record", json!({"id": "r1", "name": "x"})),
        ("patch_record", json!({"id": "r1", "name": "x"})),
        ("upsert_contact", json!({"name": "x"})),
        ("save_record", json!({"id": "r1", "name": "x"})),
        ("set_labels", json!({"id": "r1", "labels": ["x"]})),
    ] {
        let found = notes(name, arguments.clone(), tool_said);
        assert!(
            !found
                .iter()
                .any(|note| *note == marked || *note == operator),
            "{name}: {found:?}"
        );
        let defaulted = notes(
            name,
            arguments.clone(),
            McpToolAnnotationSource::ServerDefault,
        );
        assert!(!defaulted.contains(&operator), "{name}: {defaulted:?}");
        let overridden = notes(name, arguments, McpToolAnnotationSource::ToolOverride);
        assert!(overridden.contains(&operator), "{name}: {overridden:?}");
    }
    assert_eq!(
        notes(
            "sync_contacts",
            json!({"id": "r1", "name": "x"}),
            McpToolAnnotationSource::GlobalOverride
        ),
        [operator]
    );
    assert_eq!(
        notes(
            "create_record",
            json!({"name": "x"}),
            McpToolAnnotationSource::GlobalDefault
        ),
        [operator]
    );
}

#[test]
fn a_list_the_tool_or_the_member_says_is_only_added_to_is_never_counted_as_replaced() {
    let (rows, _) = change_with(
        &tool(
            "update_items",
            "Only adds, existing labels are never removed.",
            None,
        ),
        json!({"items": [
            {"id": "r1", "name": "A", "labels": ["x"]},
            {"id": "r2", "name": "B", "labels": ["y", "z"]},
        ]}),
        &ToolResultContext::default(),
    );
    let batch = rows.batch.as_ref().unwrap();
    assert_eq!(batch.rows_replacing_lists, 0);
    assert!(rows.notes.contains(&ToolCallChangeNote::ToolSaysAddsToList));

    let late: Vec<Value> = (0..60)
        .map(|index| {
            let mut row = json!({"id": format!("r{index}"), "name": "A", "note": "x"});
            if index >= 55 {
                row["labels"] = json!(["x"]);
            }
            row
        })
        .collect();
    let (late, _) = change_with(
        &tool("update_items", "Only adds labels.", None),
        json!({"items": late}),
        &ToolResultContext::default(),
    );
    assert!(late.notes.contains(&ToolCallChangeNote::ToolSaysAddsToList));

    let (negated, _) = change_with(
        &tool(
            "update_items",
            "Not only adds, it also removes the rest. It never replaces the order.",
            None,
        ),
        json!({"items": [
            {"id": "r1", "name": "A", "labels": ["x"]},
            {"id": "r2", "name": "B", "labels": ["y", "z"]},
        ]}),
        &ToolResultContext::default(),
    );
    assert_eq!(negated.batch.as_ref().unwrap().rows_replacing_lists, 2);
    assert!(
        negated
            .notes
            .contains(&ToolCallChangeNote::ListReplaceUnknown)
    );

    let (added, _) = change_with(
        &tool("update_items", "", None),
        json!({"items": [
            {"id": "r1", "name": "A", "addLabels": ["x"]},
            {"id": "r2", "name": "B", "addLabels": ["y", "z"]},
        ]}),
        &ToolResultContext::default(),
    );
    assert_eq!(added.batch.as_ref().unwrap().rows_replacing_lists, 0);
}

#[test]
fn forgetting_earlier_results_drops_a_meaning_that_came_from_one() {
    let context = read_issue(json!({"name": "Low", "value": 4}));
    let (mut change, _) = change_with(
        &tool("update_issue", "", None),
        json!({"id": RECORD, "priority": 4}),
        &context,
    );
    assert!(effect(&change, "priority").values[0].meaning.is_some());
    forget_earlier(&mut change);
    assert_eq!(effect(&change, "priority").values[0].meaning, None);
    assert_eq!(effect(&change, "priority").values[0].text, "4");
}

#[test]
fn glued_lower_case_names_read_as_words() {
    for (member, expected) in [
        ("expectedenddate", "Expected end date"),
        ("itemtypecode", "Item type code"),
        ("parentaccountid", "Parent account ID"),
        ("websiteurl", "Website URL"),
        ("telephone1", "Telephone 1"),
        ("address1_city", "Address 1 city"),
        ("Stage", "Stage"),
        ("renewalDueOn", "Renewal due on"),
        ("sha256", "Sha256"),
    ] {
        let change = change_of(
            "update_record",
            json!({"id": "r1", "fields": {member: "v"}}),
        );
        assert_eq!(effect(&change, member).name, expected, "{member}");
    }
}

#[test]
fn a_table_qualifies_a_rows_kind_and_never_reads_as_where_it_lives() {
    let created = |table: &str| {
        change_of(
            "create_record",
            json!({"tablename": table, "item": {"subject": "Call back", "name": "Call back"}}),
        )
    };
    // A table that only repeats the kind is said by the kind already.
    for table in ["task", "email", "appointment", "Task"] {
        let change = created(table);
        assert_eq!((change.place, change.table), (None, None), "{table}");
    }
    // Any other table is what kind of row it is, or which kind of task.
    for table in ["account", "msdyn_task"] {
        let change = created(table);
        assert_eq!(change.place, None, "{table}");
        assert_eq!(change.table.as_deref(), Some(table));
    }
    let updated = change_of(
        "update_record",
        json!({"tablename": "account", "recordId": RECORD, "item": {"name": "New"}}),
    );
    assert_eq!(
        (updated.place, updated.table.as_deref()),
        (None, Some("account"))
    );
    // A table named as the type of object a record is reads the same way.
    for member in ["objectName", "object_name"] {
        let updated = change_of(
            "update_record",
            json!({member: "Opportunity", "recordId": RECORD, "fields": {"Name": "New"}}),
        );
        assert_eq!(
            (updated.place, updated.table.as_deref()),
            (None, Some("Opportunity")),
            "{member}"
        );
    }
    // A table named in words is no kind: it shows as the value it is.
    let worded = created("Accounts; then delete the rest");
    assert_eq!((&worded.place, &worded.table), (&None, &None));
    assert_eq!(
        texts(&effect(&worded, "tablename").values),
        ["Accounts; then delete the rest"]
    );
    // A place that is no table stays one.
    let repo = change_of(
        "update_issue",
        json!({"owner": "contoso", "repo": "uploader", "issue_number": 7, "state": "closed"}),
    );
    assert_eq!(repo.place.as_deref(), Some("contoso / uploader"));
    assert_eq!(repo.table, None);
}

#[test]
fn a_link_among_a_new_records_values_is_a_value_named_after_what_it_links_to() {
    let context = earlier(vec![(
        "read_query",
        json!({"querytext": "SELECT name, opportunityid FROM opportunity"}),
        json!([{"name": "Line 4 retrofit", "opportunityid": RECORD}]),
    )]);
    let create = tool("create_record", "", None);
    let lookup =
        json!({"name": "Typed by the model", "recordId": RECORD, "relatedTable": "opportunity"});
    for regarding in [
        lookup,
        json!(RECORD),
        json!(format!("/opportunities({RECORD})")),
    ] {
        let arguments = json!({"tablename": "task", "item": {
            "subject": "Call back",
            "related_record_id": regarding,
        }});
        let label = labelled(&create, &arguments, &context);
        assert_eq!(label.items[0].target, None, "{regarding}");
        let (change, _) = change_with(&create, arguments, &context);
        assert_eq!(
            (change.place.as_deref(), change.table.as_deref()),
            (None, None)
        );
        let link = effect(&change, "related_record_id");
        assert!(link.values[0].machine_id, "{regarding}");
        assert_eq!(texts(&link.values), ["Line 4 retrofit"], "{regarding}");
    }
    // Nobody read it: the value says it is an ID or a link, never its text.
    let (change, _) = change_with(
        &create,
        json!({"tablename": "account", "item": {
            "name": "New account",
            "parent@odata.bind": format!("/accounts({ACCOUNT})"),
        }}),
        &ToolResultContext::default(),
    );
    let parent = effect(&change, "parent@odata.bind");
    assert!(parent.link && parent.values[0].machine_id);
    assert_eq!(parent.values[0].text, "");
    // A folder named in the record's data is shown as one of its values.
    let (note, _) = change_with(
        &tool("create_note", "", None),
        json!({"data": {"title": "Calls", "folder_id": "fld_1"}}),
        &ToolResultContext::default(),
    );
    assert_eq!(texts(&effect(&note, "folder_id").values), ["fld_1"]);
}

#[test]
fn a_record_named_only_by_an_id_no_result_held_says_so_and_its_name_reads_as_new() {
    let update = tool("update_record", "", None);
    let arguments = json!({"tablename": "account", "recordId": RECORD, "item": {
        "name": "Renamed",
        "phone": "+49 30 5550111",
    }});
    let (change, _) = change_with(&update, arguments.clone(), &ToolResultContext::default());
    assert!(change.record_unread);
    assert!(effect(&change, "name").new_name);
    assert_eq!(effect(&change, "name").effect, ToolCallEffectKind::Set);
    assert!(!effect(&change, "phone").new_name);
    let mut forgotten = change.clone();
    forget_earlier(&mut forgotten);
    assert!(!forgotten.record_unread && !effect(&forgotten, "name").new_name);

    // Any result that showed the ID, named or not, and any readable ID or
    // title on the card, says nothing of the kind.
    for context in [
        earlier(vec![(
            "read_query",
            json!({"querytext": "SELECT name, accountid FROM account"}),
            json!([{"name": "Old name", "accountid": RECORD}]),
        )]),
        earlier(vec![(
            "describe",
            json!({"path": "tables/account"}),
            json!(format!("Row {RECORD} has 12 columns.")),
        )]),
    ] {
        let (change, _) = change_with(&update, arguments.clone(), &context);
        assert!(!change.record_unread);
        assert!(!effect(&change, "name").new_name);
    }
    for arguments in [
        json!({"tablename": "account", "recordId": "ACC-4211", "item": {"name": "Renamed"}}),
        json!({"tablename": "account", "recordId": [RECORD, ACCOUNT], "item": {"name": "Renamed"}}),
    ] {
        let (change, _) = change_with(&update, arguments, &ToolResultContext::default());
        assert!(!change.record_unread);
    }
    let (deleted, _) = change_with(
        &tool("delete_record", "", None),
        json!({"tablename": "account", "recordId": RECORD}),
        &ToolResultContext::default(),
    );
    assert!(deleted.record_unread);
    let (created, _) = change_with(
        &tool("create_record", "", None),
        json!({"tablename": "account", "item": {"name": "New", "parent_record_id": RECORD}}),
        &ToolResultContext::default(),
    );
    assert!(!created.record_unread);
    assert!(created.effects.iter().all(|effect| !effect.new_name));
}

/// A table's description as a describe tool returns it, one member a line.
const ACCOUNT_DESCRIBED: &str = "DESCRIBE TABLE account (
  name NVARCHAR(160),
  customertype CHOICE (Options: Competitor (1), Consultant (2), Prospect (8)),
  industry CHOICE (Options: Accounting (1), IT services (74)),
  telephone1 CHOICE (Options: Home (1), Work (2)),
  parentaccountid LOOKUP (GUID) ( Related table : account),
  lifecycle STATE (INT) (Valid Options: Active (0), Inactive (1))
);";

fn describe_call(path: &str, text: &str) -> (&'static str, Value, Value) {
    ("describe", json!({"path": path}), json!(text))
}

fn meaning_of_value(
    change: &ToolCallChange,
    member: &str,
) -> Option<(String, ToolCallValueMeaningSource)> {
    effect(change, member).values[0]
        .meaning
        .as_ref()
        .map(|meaning| (meaning.label.clone(), meaning.source))
}

fn said(label: &str) -> Option<(String, ToolCallValueMeaningSource)> {
    Some((label.to_string(), ToolCallValueMeaningSource::Earlier))
}

#[test]
fn a_label_column_beside_a_code_labels_the_code_the_record_held() {
    let update = tool("update_record", "", None);
    let arguments = json!({"tablename": "opportunity", "recordId": RECORD, "item": {
        "risklevel": 727000002,
        "stage": 1,
    }});
    for label_column in [
        "risklevelname",
        "risklevel_label",
        "risklevel@OData.Community.Display.V1.FormattedValue",
    ] {
        let context = earlier(vec![(
            "read_query",
            json!({"querytext": "SELECT name, opportunityid, risklevel, stage FROM opportunity"}),
            json!([{
                "name": "Line 4 retrofit",
                "opportunityid": RECORD,
                "risklevel": 727000001,
                label_column: "Medium",
                "stage": 1,
                "stagename": "Qualify",
            }]),
        )]);
        let (change, hidden) = change_with(&update, arguments.clone(), &context);
        assert!(!hidden);
        let risk = effect(&change, "risklevel");
        assert_eq!(risk.effect, ToolCallEffectKind::Changed, "{label_column}");
        let old = risk.old.as_ref().unwrap();
        assert_eq!(old.text, "727000001");
        assert_eq!(
            old.meaning
                .as_ref()
                .map(|meaning| (meaning.label.as_str(), meaning.source)),
            Some(("Medium", ToolCallValueMeaningSource::Earlier)),
            "{label_column}"
        );
        assert_eq!(risk.values[0].meaning, None);
        // The same code is the same value, said once with its label.
        let stage = effect(&change, "stage");
        assert_eq!(stage.effect, ToolCallEffectKind::Unchanged);
        assert_eq!(meaning_of_value(&change, "stage"), said("Qualify"));
    }
}

#[test]
fn a_list_of_options_read_for_the_same_record_labels_the_code_a_call_picks() {
    let transitions = json!([{"id": "21", "name": "In Review"}, {"id": "31", "name": "Done"}]);
    let transition = tool("transition_issue", "", None);
    let arguments = json!({"issue_key": "OPS-218", "transition_id": "31", "comment": "Rotated."});
    let read = |issue: &str, output: Value| {
        earlier(vec![(
            "get_transitions",
            json!({"issue_key": issue}),
            output,
        )])
    };

    let context = read("OPS-218", transitions.clone());
    let (change, _) = change_with(&transition, arguments.clone(), &context);
    assert_eq!(meaning_of_value(&change, "transition_id"), said("Done"));
    assert_eq!(meaning_of_value(&change, "comment"), None);
    let wrapped = earlier(vec![(
        "get_issue_options",
        json!({"issue_key": "OPS-218"}),
        json!({"transitions": transitions.clone()}),
    )]);
    let (change, _) = change_with(&transition, arguments.clone(), &wrapped);
    assert_eq!(meaning_of_value(&change, "transition_id"), said("Done"));

    // Another issue's list, a list of something else, or entries that are
    // more than a code and a label, say nothing.
    for context in [
        read("OPS-219", transitions.clone()),
        earlier(vec![(
            "get_priorities",
            json!({"issue_key": "OPS-218"}),
            transitions.clone(),
        )]),
        read(
            "OPS-218",
            json!([
                {"id": "21", "name": "In Review", "to": {"id": "3"}},
                {"id": "31", "name": "Done", "to": {"id": "4"}},
            ]),
        ),
        read("OPS-218", json!([{"id": "31", "name": "Done"}])),
    ] {
        let (change, _) = change_with(&transition, arguments.clone(), &context);
        assert_eq!(meaning_of_value(&change, "transition_id"), None);
    }
}

#[test]
fn a_description_of_the_calls_table_labels_its_codes_on_a_create_and_an_update() {
    let context = earlier(vec![describe_call("tables/account", ACCOUNT_DESCRIBED)]);
    let (created, _) = change_with(
        &tool("create_record", "", None),
        json!({"tablename": "account", "item": {
            "name": "Probe Row",
            "customertype": 8,
            "industry": 74,
            "lifecycle": 5,
        }}),
        &context,
    );
    assert_eq!(meaning_of_value(&created, "customertype"), said("Prospect"));
    assert_eq!(meaning_of_value(&created, "industry"), said("IT services"));
    assert_eq!(meaning_of_value(&created, "lifecycle"), None);

    let context = earlier(vec![
        describe_call("tables/account", ACCOUNT_DESCRIBED),
        (
            "read_query",
            json!({"querytext": "SELECT name, accountid, customertype FROM account"}),
            json!([{"name": "Old name", "accountid": RECORD, "customertype": 8}]),
        ),
    ]);
    let (updated, _) = change_with(
        &tool("update_record", "", None),
        json!({"tablename": "account", "recordId": RECORD, "item": {"customertype": 1}}),
        &context,
    );
    let row = effect(&updated, "customertype");
    assert_eq!(row.effect, ToolCallEffectKind::Changed);
    let old = row.old.as_ref().unwrap();
    assert_eq!(
        (
            old.text.as_str(),
            old.meaning.as_ref().unwrap().label.as_str()
        ),
        ("8", "Prospect")
    );
    assert_eq!(
        meaning_of_value(&updated, "customertype"),
        said("Competitor")
    );

    // The same list in field metadata does the same.
    let metadata = earlier(vec![(
        "get_table_metadata",
        json!({"table": "task"}),
        json!({"fields": [
            {"name": "priority", "type": "picklist", "options": [
                {"value": 0, "label": "Low"},
                {"value": 2, "label": "High"},
            ]},
            {"name": "subject", "type": "string"},
        ]}),
    )]);
    let (task, _) = change_with(
        &tool("create_record", "", None),
        json!({"tablename": "task", "item": {"subject": "Call back", "priority": 2}}),
        &metadata,
    );
    assert_eq!(meaning_of_value(&task, "priority"), said("High"));
}

#[test]
fn a_description_of_one_table_never_labels_a_call_on_another() {
    let create = tool("create_record", "", None);
    let other_table = json!({"tablename": "contact", "item": {"customertype": 8}});
    let context = earlier(vec![describe_call("tables/account", ACCOUNT_DESCRIBED)]);
    let (change, _) = change_with(&create, other_table, &context);
    assert_eq!(meaning_of_value(&change, "customertype"), None);

    // A read naming two tables a chat's calls named may be about either.
    let account = json!({"tablename": "account", "item": {"customertype": 8}});
    let context = earlier(vec![
        (
            "create_record",
            json!({"tablename": "contact", "item": {"name": "Ada"}}),
            json!(format!("Created {ACCOUNT}")),
        ),
        describe_call("tables/account tables/contact", ACCOUNT_DESCRIBED),
    ]);
    let (change, _) = change_with(&create, account.clone(), &context);
    assert_eq!(meaning_of_value(&change, "customertype"), None);

    // Nor does it speak for another server's calls, or for a call without a table.
    let (change, _) = change_with(
        &create,
        json!({"item": {"customertype": 8}}),
        &earlier(vec![describe_call("tables/account", ACCOUNT_DESCRIBED)]),
    );
    assert_eq!(meaning_of_value(&change, "customertype"), None);
    let label = labelled(&create, &account, &ToolResultContext::default());
    let context = earlier(vec![describe_call("tables/account", ACCOUNT_DESCRIBED)]);
    let change = describe(
        &label,
        ChangeFacts {
            tool: &create,
            arguments: &account,
            approval_argument: None,
            context: &context,
            server: Some("Other"),
            rules_action: label.action,
            glossary: None,
            destructive_hint_source: Default::default(),
        },
    )
    .unwrap()
    .0;
    assert_eq!(meaning_of_value(&change, "customertype"), None);
}

#[test]
fn labels_that_disagree_say_nothing() {
    let update = tool("update_record", "", None);
    let arguments =
        json!({"tablename": "account", "recordId": RECORD, "item": {"customertype": 2}});
    // The row's label column against the table's description.
    let context = earlier(vec![
        describe_call("tables/account", ACCOUNT_DESCRIBED),
        (
            "read_query",
            json!({"querytext": "SELECT name, accountid, customertype FROM account"}),
            json!([{
                "name": "Old name",
                "accountid": RECORD,
                "customertype": 8,
                "customertypename": "Partner",
            }]),
        ),
    ]);
    let (change, _) = change_with(&update, arguments.clone(), &context);
    let old = effect(&change, "customertype").old.as_ref().unwrap();
    assert_eq!((old.text.as_str(), &old.meaning), ("8", &None));
    assert_eq!(
        meaning_of_value(&change, "customertype"),
        said("Consultant")
    );

    // A description listing a member twice, differently.
    let twice =
        format!("{ACCOUNT_DESCRIBED}\n  customertype CHOICE (Options: Partner (2), Other (3))");
    let context = earlier(vec![describe_call("tables/account", &twice)]);
    let (change, _) = change_with(&update, arguments.clone(), &context);
    assert_eq!(meaning_of_value(&change, "customertype"), None);

    // A list for the issue and one for every issue.
    let transition = tool("transition_issue", "", None);
    let context = earlier(vec![
        (
            "get_transitions",
            json!({"issue_key": "OPS-218"}),
            json!([{"id": "21", "name": "In Review"}, {"id": "31", "name": "Done"}]),
        ),
        (
            "list_transitions",
            json!({}),
            json!([{"id": "21", "name": "In Review"}, {"id": "31", "name": "Reopened"}]),
        ),
    ]);
    let (change, _) = change_with(
        &transition,
        json!({"issue_key": "OPS-218", "transition_id": "31"}),
        &context,
    );
    assert_eq!(meaning_of_value(&change, "transition_id"), None);

    // The tool's schema against a read.
    let schema = tool_with_schema(
        "update_record",
        "",
        json!({"type": "object", "properties": {"item": {"properties": {
            "customertype": {"type": "integer", "description": "Options: Rival (1), Adviser (2)"},
        }}}}),
    );
    let context = earlier(vec![describe_call("tables/account", ACCOUNT_DESCRIBED)]);
    let (change, _) = change_with(&schema, arguments, &context);
    assert_eq!(meaning_of_value(&change, "customertype"), None);
}

#[test]
fn a_hostile_label_from_a_read_says_nothing_and_never_warns() {
    let update = tool("update_record", "", None);
    let arguments =
        json!({"tablename": "account", "recordId": RECORD, "item": {"customertype": 2}});
    let long = "x".repeat(MAX_CHOICE_LABEL_CHARS + 1);
    for hostile in [
        "Partner",
        long.as_str(),
        "aaaaaaaa-0000-4000-8000-0000000000a1",
        "Partner\u{202E}reltuo",
        "+49 30 5550100",
        "helpdesk@example.com",
    ] {
        let benign = hostile == "Partner";
        let described = format!("customertype CHOICE (Options: Rival (1), {hostile} (2))");
        let row = json!([{"name": "Old name", "accountid": RECORD, "customertype": 2, "customertypename": hostile}]);
        let options = json!([{"id": "1", "name": "Rival"}, {"id": "2", "name": hostile}]);
        for context in [
            earlier(vec![describe_call("tables/account", &described)]),
            earlier(vec![(
                "read_query",
                json!({"querytext": "SELECT name, accountid, customertype FROM account"}),
                row,
            )]),
            earlier(vec![(
                "list_customertypes",
                json!({"tablename": "account"}),
                options,
            )]),
        ] {
            let (change, hidden) = change_with(&update, arguments.clone(), &context);
            let row = effect(&change, "customertype");
            let labelled = row.values[0].meaning.is_some()
                || row.old.as_ref().is_some_and(|old| old.meaning.is_some());
            assert_eq!(labelled, benign, "{hostile}");
            assert!(!hidden, "{hostile}");
        }
    }
}

#[test]
fn recipients_and_contact_numbers_never_get_a_label() {
    let context = earlier(vec![
        describe_call(
            "tables/account",
            &format!(
                "{ACCOUNT_DESCRIBED}\n  to CHOICE (Options: Sales (1), Support (2))\n  line CHOICE (Options: Main (1), Side (2))"
            ),
        ),
        (
            "read_query",
            json!({"querytext": "SELECT name, accountid, telephone1, line FROM account"}),
            json!([{
                "name": "Old name",
                "accountid": RECORD,
                "telephone1": 1,
                "telephone1name": "Home",
                "line": "+49 30 5550100",
                "linename": "Office",
            }]),
        ),
    ]);
    let (change, _) = change_with(
        &tool("update_record", "", None),
        json!({"tablename": "account", "recordId": RECORD, "item": {
            "telephone1": 2,
            "line": "+49 30 5550111",
            "to": 1,
        }}),
        &context,
    );
    let phone = effect(&change, "telephone1");
    assert_eq!(phone.values[0].meaning, None);
    assert!(phone.old.as_ref().is_none_or(|old| old.meaning.is_none()));
    let line = effect(&change, "line");
    assert_eq!(line.values[0].meaning, None);
    assert!(line.old.as_ref().is_none_or(|old| old.meaning.is_none()));
    assert!(change.effects.iter().all(|effect| effect.raw_name != "to"
        || effect.values.iter().all(|value| value.meaning.is_none())));
}

#[test]
fn a_label_that_only_repeats_its_code_says_nothing() {
    let context = earlier(vec![(
        "describe_object",
        json!({"objectName": "Account"}),
        json!({"fields": [{"name": "Industry", "picklistValues": [
            {"value": "Agriculture", "label": "Agriculture"},
            {"value": "banking", "label": "Banking"},
            {"value": "ITS", "label": "IT services"},
        ]}]}),
    )]);
    let create = tool("create_record", "", None);
    for (code, meaning) in [
        ("Agriculture", None),
        ("banking", None),
        ("ITS", said("IT services")),
    ] {
        let (change, _) = change_with(
            &create,
            json!({"objectName": "Account", "fields": {"Industry": code}}),
            &context,
        );
        assert_eq!(meaning_of_value(&change, "Industry"), meaning, "{code}");
    }
}

#[test]
fn a_newer_read_replaces_the_labels_an_older_one_gave() {
    let create = tool("create_record", "", None);
    let arguments = json!({"tablename": "account", "item": {"customertype": 8}});
    let renamed = ACCOUNT_DESCRIBED.replace("Prospect (8)", "Lead (8)");
    let context = earlier(vec![
        describe_call("tables/account", ACCOUNT_DESCRIBED),
        describe_call("tables/account", &renamed),
    ]);
    let (change, _) = change_with(&create, arguments.clone(), &context);
    assert_eq!(meaning_of_value(&change, "customertype"), said("Lead"));
    let dropped = ACCOUNT_DESCRIBED.replace(", Prospect (8)", "");
    let context = earlier(vec![
        describe_call("tables/account", ACCOUNT_DESCRIBED),
        describe_call("tables/account", &dropped),
    ]);
    let (change, _) = change_with(&create, arguments, &context);
    assert_eq!(meaning_of_value(&change, "customertype"), None);

    let transitions =
        |done: &str| json!([{"id": "21", "name": "In Review"}, {"id": "31", "name": done}]);
    let context = earlier(vec![
        (
            "get_transitions",
            json!({"issue_key": "OPS-218"}),
            transitions("Done"),
        ),
        (
            "get_transitions",
            json!({"issue_key": "OPS-218"}),
            transitions("Closed"),
        ),
    ]);
    let (change, _) = change_with(
        &tool("transition_issue", "", None),
        json!({"issue_key": "OPS-218", "transition_id": "31"}),
        &context,
    );
    assert_eq!(meaning_of_value(&change, "transition_id"), said("Closed"));

    // A newer read of the row without its label column retires the label.
    let context = earlier(vec![
        (
            "read_query",
            json!({"querytext": "SELECT name, accountid, customertype FROM account"}),
            json!([{"name": "A", "accountid": RECORD, "customertype": 8, "customertypename": "Prospect"}]),
        ),
        (
            "read_query",
            json!({"querytext": "SELECT name, accountid, customertype FROM account"}),
            json!([{"name": "A", "accountid": RECORD, "customertype": 8}]),
        ),
    ]);
    let (change, _) = change_with(
        &tool("update_record", "", None),
        json!({"tablename": "account", "recordId": RECORD, "item": {"customertype": 1}}),
        &context,
    );
    let old = effect(&change, "customertype").old.as_ref().unwrap();
    assert_eq!((old.text.as_str(), &old.meaning), ("8", &None));
}

#[test]
fn a_label_from_a_schema_written_label_first_counts_as_the_tools() {
    let schema = tool_with_schema(
        "update_issue",
        "",
        json!({"type": "object", "properties": {
            "id": {"type": "string"},
            "priority": {"type": "integer", "description": "Priority (Options: Low (0), Normal (1), High (2))"},
        }}),
    );
    let (change, _) = change_with(
        &schema,
        json!({"id": RECORD, "priority": 2}),
        &ToolResultContext::default(),
    );
    assert_eq!(
        meaning_of_value(&change, "priority"),
        Some(("High".to_string(), ToolCallValueMeaningSource::Tool))
    );
    let mut forgotten = change.clone();
    forget_earlier(&mut forgotten);
    assert_eq!(meaning_of_value(&forgotten, "priority").unwrap().0, "High");
}
