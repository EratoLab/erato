//! Generic rules: a label from a tool's name and the shape of its arguments,
//! with no knowledge of any one server. They are the first label source and
//! say when they are unsure, so a model can step in there. The verb comes
//! from a verb field or the tool's name, never from other argument text, and
//! every pointer is one the arguments were searched for, so it resolves.
//!
//! The cross-check holds a label from any source against the tool's name and
//! its resolved annotations.

use super::arguments::{MAX_INLINE_CHARS, MAX_LIST_ENTRIES, names_an_id};
use super::change::is_sql_statement;
use super::context::{
    is_id_member, is_link, is_lookup, is_name_member, link_id_member, name_words, text_prefix,
};
use super::machine_id::is_machine_id;
use super::pointer::{self, MAX_POINTER_BYTES, escape};
use super::recipients::{
    ADDRESS_MEMBERS, COPY_RECIPIENT_MEMBERS, RECIPIENT_MEMBERS, RECIPIENT_NUMBER_WORDS,
    bare_member, is_contact_number_member, is_phone_shaped,
};
use super::{
    MAX_FIELD_POINTERS, MAX_LABEL_FIELDS, MAX_LABEL_ITEMS, ToolCallLabelItemMapping,
    ToolCallLabelMapping,
};
use crate::models::message::{
    ToolCallAction, ToolCallLabel, ToolCallLabelSource, ToolCallObjectKind,
};
use rmcp::model::{JsonObject, Tool, ToolAnnotations};
use serde_json::Value;
use std::collections::{HashMap, VecDeque};

/// Members whose value names the operation (`command: "update_content"`,
/// `op: "add"`), read up to four levels deep. A verb they give wins over the
/// tool's name when the tool's input schema declares them.
pub const VERB_FIELDS: [&str; 7] = [
    "command",
    "op",
    "kind",
    "action",
    "mode",
    "operation",
    "method",
];
/// Objects below the arguments' top whose verb fields still count.
const VERB_FIELD_DEPTH: usize = 3;
/// A verb field's value counts only when it reads as an identifier, such as
/// `update_content` or `word.apply_edits`, never as free text.
const MAX_VERB_VALUE_CHARS: usize = 40;
/// Values and members one search visits, so a large batch or a huge object
/// costs no more than this.
const MAX_SEARCH_VALUES: usize = 5_000;
/// The start of a tool name or table name that is read for words; MCP names
/// are far shorter, and a server can send any length.
pub(super) const MAX_NAME_BYTES: usize = 256;
/// Verb fields read from one call's arguments.
const MAX_VERB_FIELDS: usize = 32;
const MAX_SEARCH_DEPTH: usize = 6;
const MAX_FIELD_DEPTH: usize = 4;

const VERBS: [(ToolCallAction, &[&str]); 11] = [
    (
        ToolCallAction::Create,
        &[
            "create",
            "add",
            "new",
            "post",
            "insert",
            "append",
            "duplicate",
            "fork",
        ],
    ),
    (
        ToolCallAction::Update,
        &[
            "update",
            "edit",
            "patch",
            "set",
            "rename",
            "modify",
            "change",
            "replace",
            "apply",
            "resolve",
            "reopen",
            "accept",
            "submit",
            "pull",
            "push",
            "write",
            "overwrite",
            "merge",
            "transition",
            "assign",
            "close",
            "lock",
            "unlock",
            "reset",
            "revert",
            "scale",
            "deploy",
            "enable",
            "disable",
        ],
    ),
    (
        ToolCallAction::Delete,
        &[
            "delete",
            "remove",
            "cancel",
            "clear",
            "purge",
            "drop",
            "destroy",
            "revoke",
            "terminate",
            "wipe",
            "erase",
        ],
    ),
    (ToolCallAction::Archive, &["archive", "trash"]),
    (ToolCallAction::Move, &["move"]),
    (
        ToolCallAction::Send,
        &["send", "reply", "forward", "publish", "invite"],
    ),
    (ToolCallAction::Share, &["share", "grant"]),
    (ToolCallAction::Upload, &["upload"]),
    (ToolCallAction::Upsert, &["upsert"]),
    (
        ToolCallAction::Run,
        &[
            "run", "exec", "execute", "eval", "evaluate", "invoke", "trigger", "act",
        ],
    ),
    (ToolCallAction::Comment, &["comment", "annotate"]),
];
const READ_VERBS: [&str; 11] = [
    "get", "list", "search", "fetch", "read", "query", "find", "retrieve", "view", "download",
    "describe",
];
/// Words that, next to `comment`, mean writing one.
const ADD_VERBS: [&str; 4] = ["add", "reply", "create", "post"];
const COMMENT_NOUNS: [&str; 2] = ["comment", "comments"];
const MESSAGE_NOUNS: [&str; 3] = ["message", "messages", "chat"];
/// Names that create or update depending on whether the arguments carry an ID.
const SAVE_VERBS: [&str; 3] = ["save", "put", "sync"];

const TITLE_MEMBERS: [&str; 11] = [
    "title",
    "name",
    "subject",
    "summary",
    "heading",
    "label",
    "filename",
    "file_name",
    "fullname",
    "displayname",
    "display_name",
];
pub(super) const TARGET_MEMBERS: [&str; 12] = [
    "parent",
    "new_parent",
    "folder_id",
    "parent_id",
    "destination",
    "to",
    "channel",
    "channel_id",
    "teamid",
    "calendar_id",
    "snapshot",
    "anchor",
];
/// Where a record lives, most specific first, when no target names it; the
/// same words the change description reads as the card's place.
pub(super) const PLACE_MEMBERS: [&str; 10] = [
    "repo",
    "repository",
    "repo_path",
    "project_id",
    "project_key",
    "namespace",
    "objectname",
    "object_name",
    "branch",
    "organization",
];
pub(super) const ID_MEMBERS: [&str; 26] = [
    "id",
    "page_id",
    "note_id",
    "fileid",
    "discussion_id",
    "data_source_id",
    "draft_id",
    "thread",
    "target",
    "source",
    "sourceref",
    "external_id",
    "page_ids",
    "page_or_database_ids",
    "recordid",
    "recordids",
    "issue_number",
    "issuenumber",
    "pull_number",
    "pullnumber",
    "pr_number",
    "ticket_number",
    "number",
    "issue_key",
    "issuekey",
    "ticket_key",
];
/// A path names a file a write acts on; on a read it says nothing about a change.
const PATH_MEMBERS: [&str; 3] = ["path", "file_path", "filepath"];
const BEFORE_MEMBERS: [&str; 4] = ["old_str", "old_text", "old", "before"];
const AFTER_MEMBERS: [&str; 9] = [
    "new_str", "new_text", "new", "after", "text", "content", "body", "markdown", "message",
];
/// Recipient members read from one call: more than a card can show already
/// means the generic label.
const MAX_RECIPIENT_MEMBERS: usize = MAX_LABEL_FIELDS + 2;
/// Members of one recipient object searched for its address.
const MAX_RECIPIENT_OBJECT_MEMBERS: usize = 64;
/// Where a created item's text sits when none of the above holds it.
const CREATED_TEXT_MEMBER: &str = "description";
/// Members naming the table or type a record lives in: its kind.
pub(super) const TABLE_MEMBERS: [&str; 8] = [
    "tablename",
    "table",
    "table_name",
    "entity",
    "entityname",
    "entity_name",
    "object_type",
    "objecttype",
];
/// Words naming a kind, in tool names and table names. A record of any other
/// table is a row.
const KIND_WORDS: [(ToolCallObjectKind, &[&str]); 12] = [
    (ToolCallObjectKind::Page, &["page", "pages"]),
    (ToolCallObjectKind::Folder, &["folder", "folders"]),
    (ToolCallObjectKind::Note, &["note", "notes", "annotation"]),
    (
        ToolCallObjectKind::Comment,
        &["comment", "comments", "discussion", "discussions"],
    ),
    (ToolCallObjectKind::Database, &["database", "databases"]),
    (
        ToolCallObjectKind::Document,
        &["document", "documents", "plan"],
    ),
    (
        ToolCallObjectKind::Event,
        &[
            "event",
            "events",
            "appointment",
            "appointments",
            "phonecall",
            "meeting",
            "meetings",
        ],
    ),
    (
        ToolCallObjectKind::File,
        &["file", "files", "attachment", "upload"],
    ),
    (
        ToolCallObjectKind::Task,
        &["issue", "issues", "task", "tasks"],
    ),
    (
        ToolCallObjectKind::Message,
        &["message", "messages", "chat"],
    ),
    (
        ToolCallObjectKind::Email,
        &["mail", "email", "emails", "reply", "draft"],
    ),
    (
        ToolCallObjectKind::Row,
        &["record", "records", "row", "rows"],
    ),
];
/// In `add_note_to_folder` the note is what the call acts on.
const PREPOSITIONS: [&str; 7] = ["to", "from", "in", "into", "for", "on", "of"];

/// What the rules make of one call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RulesLabel {
    /// `generic` when the rules have nothing to say.
    pub mapping: ToolCallLabelMapping,
    pub unsure: Option<RulesUnsure>,
}

/// What a model may still supply for a call that is not a read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RulesUnsure {
    /// The rules found no verb.
    NoVerb,
    /// The rules have a verb but no kind for what it acts on.
    NoKind,
}

/// Why a label's verb was not trusted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CrossCheckFlag {
    /// The resolved `readOnlyHint` is true, but the label writes.
    ReadOnlyAnnotation,
    /// The tool's name reads, but the label does more than read.
    ReadName,
    /// The tool's name has verbs, and none of them is the label's.
    NameVerb,
    /// A verb field in the arguments names another verb than the label's.
    FieldVerb,
}

impl CrossCheckFlag {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ReadOnlyAnnotation => "read_only_annotation",
            Self::ReadName => "read_name",
            Self::NameVerb => "name_verb",
            Self::FieldVerb => "field_verb",
        }
    }
}

/// What a card never shows as a fact, whoever chose the label's pointers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Claim {
    /// A flag such as `hasUserApproved` states what the model says the user
    /// decided; only Erato's own approval says that.
    Consent,
    /// The name the model typed into a lookup next to the record's ID.
    LookupName,
}

impl Claim {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Consent => "consent_flag",
            Self::LookupName => "lookup_name",
        }
    }
}

/// A member of the arguments that names recipients or holds a contact
/// number: `member` is where it sits, `shown_at` the pointer a label shows it
/// through.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecipientMember {
    pub member: String,
    pub shown_at: String,
}

/// The rules' label for one call. `annotations` are the resolved hints, with
/// absent ones left absent; a read-only hint only tells a read apart from a
/// call with no verb. `approval_argument` is the server's consent argument.
pub fn rules_label(
    tool_name: &str,
    arguments: &Value,
    annotations: Option<&ToolAnnotations>,
    approval_argument: Option<&str>,
) -> RulesLabel {
    let name = name_words(text_prefix(tool_name, MAX_NAME_BYTES));
    let verb = verb(&name, Some(arguments));
    let action = verb.action;
    let (mut object_kind, table) = kind(&name, arguments);
    let mut item = ToolCallLabelItemMapping::default();
    let creates = matches!(
        action,
        ToolCallAction::Create | ToolCallAction::Upload | ToolCallAction::Upsert
    );
    if !creates && action != ToolCallAction::Run {
        item.id = id_pointer(arguments);
    }
    if item.id.is_none() && action != ToolCallAction::Other && !creates {
        item.id = find(
            arguments,
            Skip::Targets,
            id_member(|member| is_one_of(member, &PATH_MEMBERS)),
        );
    }
    item.target = target_pointer(arguments, action, item.id.as_deref());
    if creates || action == ToolCallAction::Send {
        item.title = title_pointer(arguments);
    }
    // A delete names what goes; on an update a `name` is a changed value.
    if item.id.is_none() && matches!(action, ToolCallAction::Delete | ToolCallAction::Archive) {
        item.title = title_pointer(arguments);
    }
    item.before = find(arguments, Skip::Lookups, text_member(&BEFORE_MEMBERS));
    if matches!(
        action,
        ToolCallAction::Create
            | ToolCallAction::Update
            | ToolCallAction::Comment
            | ToolCallAction::Send
            | ToolCallAction::Share
            | ToolCallAction::Upsert
            | ToolCallAction::Upload
    ) {
        item.after = find(arguments, Skip::Lookups, text_member(&AFTER_MEMBERS)).or_else(|| {
            (creates || action == ToolCallAction::Send)
                .then(|| {
                    find(
                        arguments,
                        Skip::Lookups,
                        text_member(&[CREATED_TEXT_MEMBER]),
                    )
                })
                .flatten()
        });
    }
    item.fields = fields(
        arguments,
        action,
        &item,
        table.as_deref(),
        approval_argument,
    );

    let claims_read = annotations.and_then(|hints| hints.read_only_hint) == Some(true);
    let unsure = if action == ToolCallAction::Other {
        (!has(&name, &READ_VERBS) && !claims_read).then_some(RulesUnsure::NoVerb)
    } else if object_kind == ToolCallObjectKind::Other {
        Some(RulesUnsure::NoKind)
    } else {
        None
    };

    if action == ToolCallAction::Comment
        && matches!(
            object_kind,
            ToolCallObjectKind::Comment | ToolCallObjectKind::Email
        )
    {
        object_kind = commented_on(item.id.as_deref());
    }

    let empty = item == ToolCallLabelItemMapping::default();
    let mapping = if action == ToolCallAction::Other && empty {
        ToolCallLabelMapping {
            action,
            object_kind: ToolCallObjectKind::Other,
            items: Vec::new(),
            source: ToolCallLabelSource::Generic,
        }
    } else {
        ToolCallLabelMapping {
            action,
            object_kind,
            items: if empty { Vec::new() } else { vec![item] },
            source: ToolCallLabelSource::Rules,
        }
    };
    RulesLabel { mapping, unsure }
}

/// Holds a label's verb against the tool's name and its resolved
/// annotations, operator overrides included; an absent hint says nothing. A
/// destructive hint is no disagreement: a card says it apart from the verb.
/// Any flag means the card shows the generic label. When verb fields the
/// tool's input schema declares set the verb, the name's verb steps back: it
/// describes the tool, the fields this call. The label must then agree with
/// the fields, and a read-named tool still never gets a write label.
pub fn cross_check(tool: &Tool, arguments: &Value, action: ToolCallAction) -> Vec<CrossCheckFlag> {
    let hint = |get: fn(&ToolAnnotations) -> Option<bool>| {
        tool.annotations.as_ref().and_then(get) == Some(true)
    };
    let name = name_words(text_prefix(&tool.name, MAX_NAME_BYTES));
    let verb = verb(&name, Some(arguments));
    let mut flags = Vec::new();
    // A read-only claim never overrules a name that says something is lost.
    let name_loses = matches!(action, ToolCallAction::Delete | ToolCallAction::Archive)
        && name_sounds_like_a_loss(&name);
    if hint(|hints| hints.read_only_hint) && action != ToolCallAction::Other && !name_loses {
        flags.push(CrossCheckFlag::ReadOnlyAnnotation);
    }
    let upsert_agrees = verb.action == ToolCallAction::Upsert
        && matches!(action, ToolCallAction::Create | ToolCallAction::Update);
    if verb.source == VerbSource::Field && verb.action != action && !upsert_agrees {
        flags.push(CrossCheckFlag::FieldVerb);
    }
    // A member the schema does not declare may be one the model made up.
    let declared = verb.source == VerbSource::Field
        && verb_fields(arguments)
            .into_iter()
            .all(|(member, _)| declares(&tool.input_schema, member));
    // "query" also names what a run runs.
    let names_a_run = action == ToolCallAction::Run
        && !name
            .iter()
            .any(|word| word != "query" && READ_VERBS.contains(&word.as_str()));
    if action != ToolCallAction::Other && !names_a_run && has(&name, &READ_VERBS) {
        flags.push(CrossCheckFlag::ReadName);
    }
    if declared {
        return flags;
    }
    let named = name_verbs(&name);
    if !named.is_empty() && !named.contains(&action) {
        flags.push(CrossCheckFlag::NameVerb);
    }
    flags
}

/// The values of the verb fields, top first.
pub fn verb_field_values(arguments: &Value) -> Vec<&str> {
    verb_fields(arguments)
        .into_iter()
        .map(|(_, value)| value)
        .collect()
}

/// The verb fields with an identifier for a value, as (member, value), at
/// most [`MAX_VERB_FIELDS`] of them.
pub fn verb_fields(arguments: &Value) -> Vec<(&str, &str)> {
    fn walk<'a>(
        value: &'a Value,
        depth: usize,
        budget: &mut usize,
        out: &mut Vec<(&'a str, &'a str)>,
    ) {
        if depth > VERB_FIELD_DEPTH || *budget == 0 || out.len() == MAX_VERB_FIELDS {
            return;
        }
        *budget -= 1;
        match value {
            Value::Object(members) => {
                let mut scanned = 0;
                for (member, value) in members {
                    if *budget == 0 || out.len() == MAX_VERB_FIELDS {
                        break;
                    }
                    *budget -= 1;
                    scanned += 1;
                    if is_one_of(member, &VERB_FIELDS)
                        && let Some(value) = value.as_str().filter(|value| is_identifier(value))
                    {
                        out.push((member.as_str(), value));
                    }
                }
                for child in members
                    .values()
                    .take(scanned)
                    .filter(|child| is_container(child))
                {
                    walk(child, depth + 1, budget, out);
                }
            }
            Value::Array(entries) => {
                for entry in entries {
                    walk(entry, depth + 1, budget, out);
                }
            }
            _ => {}
        }
    }
    let mut out = Vec::new();
    let mut budget = MAX_SEARCH_VALUES;
    walk(arguments, 0, &mut budget, &mut out);
    out
}

fn is_identifier(text: &str) -> bool {
    !text.chars().any(char::is_whitespace) && text.chars().nth(MAX_VERB_VALUE_CHARS).is_none()
}

/// Whether the schema has a property named `member` at any depth.
fn declares(schema: &JsonObject, member: &str) -> bool {
    let mut objects = vec![schema];
    let mut budget = MAX_SEARCH_VALUES;
    while let Some(object) = objects.pop() {
        if object
            .get("properties")
            .and_then(Value::as_object)
            .is_some_and(|properties| properties.contains_key(member))
        {
            return true;
        }
        for value in object.values() {
            if budget == 0 {
                return false;
            }
            budget -= 1;
            match value {
                Value::Object(inner) => objects.push(inner),
                Value::Array(entries) => {
                    for inner in entries.iter().filter_map(Value::as_object) {
                        if budget == 0 {
                            return false;
                        }
                        budget -= 1;
                        objects.push(inner);
                    }
                }
                _ => {}
            }
        }
    }
    false
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VerbSource {
    /// A verb field in the arguments.
    Field,
    /// The tool's name.
    Name,
    /// A name that creates or updates, decided by whether the arguments hold
    /// an ID.
    Arguments,
    None,
}

struct Verb {
    action: ToolCallAction,
    source: VerbSource,
}

fn verb(name: &[String], arguments: Option<&Value>) -> Verb {
    let fields: Vec<String> = arguments
        .map(verb_field_values)
        .unwrap_or_default()
        .into_iter()
        .flat_map(name_words)
        .collect();
    let found = |action, source| Verb { action, source };
    let field_actions = actions_of(&fields);
    // A batch of different operations changes the thing that holds them.
    if field_actions.len() > 1 {
        return found(ToolCallAction::Update, VerbSource::Field);
    }
    if let Some((action, source)) = compound(name, &fields) {
        return found(action, source);
    }
    if is_upsert_name(name) {
        let action = if arguments.is_some_and(holds_an_id) {
            ToolCallAction::Update
        } else {
            ToolCallAction::Upsert
        };
        return found(action, VerbSource::Arguments);
    }
    if let [action] = field_actions.as_slice() {
        return found(*action, VerbSource::Field);
    }
    if let Some(action) = actions_of(name).first() {
        return found(*action, VerbSource::Name);
    }
    // What a member is named says it holds a statement; the statement's own
    // words never pick a verb.
    if arguments.is_some_and(holds_a_statement)
        && !name
            .iter()
            .any(|word| word != "query" && READ_VERBS.contains(&word.as_str()))
    {
        return found(ToolCallAction::Run, VerbSource::Arguments);
    }
    if let (Some(first), Some(arguments)) = (name.first(), arguments)
        && arguments.is_object()
        && SAVE_VERBS.contains(&first.as_str())
    {
        let action = if holds_an_id(arguments) {
            ToolCallAction::Update
        } else {
            ToolCallAction::Create
        };
        return found(action, VerbSource::Arguments);
    }
    found(ToolCallAction::Other, VerbSource::None)
}

/// Words that only read as one verb together: `create_comment` comments,
/// `post_message` sends. A verb field that names no verb (`kind: "page"`)
/// leaves the name to decide.
fn compound(name: &[String], fields: &[String]) -> Option<(ToolCallAction, VerbSource)> {
    let no_field_verb = actions_of(fields).is_empty();
    if has(name, &COMMENT_NOUNS) {
        if has(fields, &ADD_VERBS) {
            return Some((ToolCallAction::Comment, VerbSource::Field));
        }
        if no_field_verb && has(name, &ADD_VERBS) {
            return Some((ToolCallAction::Comment, VerbSource::Name));
        }
    }
    (no_field_verb && has(name, &["post"]) && has(name, &MESSAGE_NOUNS))
        .then_some((ToolCallAction::Send, VerbSource::Name))
}

fn name_sounds_like_a_loss(name: &[String]) -> bool {
    actions_of(name)
        .iter()
        .any(|action| matches!(action, ToolCallAction::Delete | ToolCallAction::Archive))
}

/// Whether a tool's name or a flag it sets says something is lost, whatever
/// its annotations claim: such a call is never presented as a read.
pub fn sounds_like_a_loss(tool_name: &str, arguments: &Value) -> bool {
    if name_sounds_like_a_loss(&name_words(text_prefix(tool_name, MAX_NAME_BYTES))) {
        return true;
    }
    arguments.as_object().is_some_and(|members| {
        members
            .iter()
            .take(MAX_SEARCH_VALUES)
            .any(|(member, value)| {
                value == &Value::Bool(true)
                    && name_sounds_like_a_loss(&name_words(text_prefix(member, MAX_NAME_BYTES)))
            })
    })
}

/// A top-level member that by its name holds something to run.
fn holds_a_statement(arguments: &Value) -> bool {
    arguments.as_object().is_some_and(|members| {
        members
            .iter()
            .take(MAX_SEARCH_VALUES)
            .any(|(member, value)| {
                let bare = bare_member(member);
                let text = value.as_str().unwrap_or_default();
                match bare.as_str() {
                    "sql" | "statement" | "bash" | "shell" | "script" => !text.trim().is_empty(),
                    "command" => {
                        value.is_array()
                            || (!text.trim().is_empty() && text.contains(char::is_whitespace))
                    }
                    "query" => is_sql_statement(text),
                    _ => false,
                }
            })
    })
}

/// `upsert_contact` and `create_or_update_file`.
fn is_upsert_name(name: &[String]) -> bool {
    has(name, &["upsert"]) || (has(name, &["create"]) && has(name, &["update"]))
}

/// Every verb the tool's name allows.
fn name_verbs(name: &[String]) -> Vec<ToolCallAction> {
    if let Some((action, _)) = compound(name, &[]) {
        return vec![action];
    }
    let named = actions_of(name);
    let saves = named.is_empty()
        && name
            .first()
            .is_some_and(|first| SAVE_VERBS.contains(&first.as_str()));
    if is_upsert_name(name) || saves {
        return vec![
            ToolCallAction::Create,
            ToolCallAction::Update,
            ToolCallAction::Upsert,
        ];
    }
    named
}

/// What a verb field's value says a row does, if it names one verb.
pub(super) fn action_of(value: &str) -> Option<ToolCallAction> {
    match actions_of(&name_words(text_prefix(value, MAX_NAME_BYTES))).as_slice() {
        [action] => Some(*action),
        _ => None,
    }
}

/// The actions the words name, in the order of `VERBS`.
fn actions_of(words: &[String]) -> Vec<ToolCallAction> {
    VERBS
        .iter()
        .filter(|(_, verbs)| words.iter().any(|word| verbs.contains(&word.as_str())))
        .map(|(action, _)| *action)
        .collect()
}

fn has(words: &[String], any: &[&str]) -> bool {
    words.iter().any(|word| any.contains(&word.as_str()))
}

/// Only the record's own ID says it exists: another record's ID (`company_id`,
/// `parentId`) says where it goes, and a `source` or `thread` may hold no ID.
fn holds_an_id(arguments: &Value) -> bool {
    find(
        arguments,
        Skip::Targets,
        id_member(|member| is_one_of(member, &ID_MEMBERS) && names_an_id(member)),
    )
    .is_some()
}

/// The kind a table member names, else the head noun of the tool's name, and
/// the table member's pointer.
fn kind(name: &[String], arguments: &Value) -> (ToolCallObjectKind, Option<String>) {
    if let Value::Object(top) = arguments {
        let mut budget = MAX_SEARCH_VALUES;
        let nested = top.iter().filter_map(|(member, value)| match value {
            Value::Object(members) if !is_lookup(members) => {
                Some((child_pointer("", member)?, members))
            }
            _ => None,
        });
        for (base, members) in std::iter::once((String::new(), top)).chain(nested) {
            if budget == 0 {
                break;
            }
            for (member, value) in members {
                if budget == 0 {
                    break;
                }
                budget -= 1;
                if is_one_of(member, &TABLE_MEMBERS)
                    && let Some(table) = value.as_str()
                    && let Some(pointer) = child_pointer(&base, member)
                {
                    let words = name_words(text_prefix(table, MAX_NAME_BYTES));
                    let kind = kind_of(&words).unwrap_or(ToolCallObjectKind::Row);
                    return (kind, Some(pointer));
                }
            }
        }
    }
    (kind_of(name).unwrap_or(ToolCallObjectKind::Other), None)
}

/// What a comment is on, by the member that names it (`issueId`, `task_id`,
/// `page_id`, `thread`): the comment itself is what the call makes, not what
/// it is on. An ID that names no kind leaves the neutral `Other`.
fn commented_on(id_pointer: Option<&str>) -> ToolCallObjectKind {
    let words = id_pointer
        .and_then(|pointer| pointer::member_names(pointer).into_iter().last())
        .map(|member| name_words(text_prefix(&member, MAX_NAME_BYTES)))
        .unwrap_or_default();
    if words.iter().any(|word| word == "thread") {
        return ToolCallObjectKind::Comment;
    }
    kind_of(&words).unwrap_or(ToolCallObjectKind::Other)
}

fn kind_of(words: &[String]) -> Option<ToolCallObjectKind> {
    let mut found = None;
    for word in words {
        if found.is_some() && PREPOSITIONS.contains(&word.as_str()) {
            break;
        }
        if let Some((kind, _)) = KIND_WORDS
            .iter()
            .find(|(_, names)| names.contains(&word.as_str()))
        {
            found = Some(*kind);
        }
    }
    found
}

fn title_pointer(arguments: &Value) -> Option<String> {
    find(arguments, Skip::Lookups, |pointer, member, values| {
        (is_one_of(member, &TITLE_MEMBERS) && values.iter().copied().any(is_text_or_number))
            .then(|| pointer.to_string())
    })
    .or_else(|| {
        find(arguments, Skip::Lookups, |pointer, member, values| {
            let lower = member.to_ascii_lowercase();
            let camel = member
                .strip_suffix("Name")
                .and_then(|stem| stem.chars().last())
                .is_some_and(|last| last.is_ascii_lowercase() || last.is_ascii_digit());
            let named = lower.ends_with("_name") || camel || lower == "lastname";
            (named
                && values
                    .iter()
                    .any(|value| value.as_str().is_some_and(|text| !text.is_empty())))
            .then(|| pointer.to_string())
        })
    })
}

fn id_pointer(arguments: &Value) -> Option<String> {
    find(
        arguments,
        Skip::Targets,
        id_member(|member| is_one_of(member, &ID_MEMBERS)),
    )
    .or_else(|| {
        find(
            arguments,
            Skip::Targets,
            id_member(|member| names_an_id(member) && !is_one_of(member, &TARGET_MEMBERS)),
        )
    })
    .or_else(|| find(arguments, Skip::Targets, id_member(names_an_id)))
}

/// A member `named` holding an ID, or a list of them; never a recipient.
fn id_member(named: fn(&str) -> bool) -> impl FnMut(&str, &str, &[&Value]) -> Option<String> {
    move |pointer, member, values| {
        if !named(member) || recipients_in(member, values).is_some() {
            return None;
        }
        if values.iter().copied().any(is_text_or_number) {
            return Some(pointer.to_string());
        }
        values
            .iter()
            .any(|value| {
                value.as_array().is_some_and(|entries| {
                    !entries.is_empty() && entries.iter().all(is_text_or_number)
                })
            })
            .then(|| format!("{pointer}/*"))
    }
}

/// Where the item goes or lives: a parent, folder, channel or recipient
/// (copies only when no one else is named), then on a create the first record
/// it links to, since a record being created has no ID of its own yet. On an
/// update a link is a changed field.
fn target_pointer(arguments: &Value, action: ToolCallAction, id: Option<&str>) -> Option<String> {
    let not_the_id = |pointer: &str| {
        id.is_none_or(|id| id != pointer && !id.starts_with(&format!("{pointer}/")))
    };
    let found = find(arguments, Skip::Nothing, |pointer, member, values| {
        if !not_the_id(pointer) {
            return None;
        }
        match recipients_in(member, values) {
            Some(Recipients::To) => recipient_at(pointer, values),
            Some(Recipients::Copy | Recipients::Number) => None,
            None if is_one_of(member, &TARGET_MEMBERS) => target_at(pointer, values),
            None => None,
        }
    })
    .or_else(|| {
        find(arguments, Skip::Nothing, |pointer, member, values| {
            (recipients_in(member, values) == Some(Recipients::Copy) && not_the_id(pointer))
                .then(|| recipient_at(pointer, values))
                .flatten()
        })
    });
    let found = found.or_else(|| place_pointer(arguments, id));
    if found.is_some()
        || !matches!(
            action,
            ToolCallAction::Create | ToolCallAction::Upload | ToolCallAction::Upsert
        )
    {
        return found;
    }
    find(arguments, Skip::Nothing, |pointer, member, values| {
        (member.to_ascii_lowercase().starts_with("parent")
            && recipients_in(member, values).is_none())
        .then(|| target_at(pointer, values))
        .flatten()
    })
    .or_else(|| {
        find(arguments, Skip::Nothing, |pointer, member, values| {
            if recipients_in(member, values).is_some() {
                return None;
            }
            let links = values.iter().any(|value| match value {
                Value::Object(members) => is_link(members),
                Value::Array(entries) => all_links(entries),
                _ => false,
            });
            if links {
                return target_at(pointer, values);
            }
            values
                .iter()
                .any(|value| is_id_member(member, value))
                .then(|| pointer.to_string())
        })
    })
}

/// The most specific member naming where a record lives, for a call with no
/// parent, folder or channel to go by.
fn place_pointer(arguments: &Value, id: Option<&str>) -> Option<String> {
    PLACE_MEMBERS.iter().find_map(|place| {
        find(arguments, Skip::Lookups, |pointer, member, values| {
            (member.eq_ignore_ascii_case(place)
                && id != Some(pointer)
                && values.iter().copied().any(is_text_or_number))
            .then(|| pointer.to_string())
        })
    })
}

/// A link points at its ID member, a list of links at theirs; anything else
/// is shown whole. The first value that is not null decides.
fn target_at(pointer: &str, values: &[&Value]) -> Option<String> {
    let inside = |suffix: String| Some(fitting(format!("{pointer}{suffix}"), pointer));
    match values.iter().find(|value| !value.is_null())? {
        Value::Object(members) => match link_id_member(members) {
            Some(id) => inside(format!("/{}", escape(id))),
            None => Some(pointer.to_string()),
        },
        Value::Array(entries) if entries.is_empty() => None,
        Value::Array(entries) => match entries
            .first()
            .and_then(Value::as_object)
            .and_then(link_id_member)
            .filter(|_| all_links(entries))
        {
            Some(id) => inside(format!("/*/{}", escape(id))),
            None => Some(pointer.to_string()),
        },
        _ => Some(pointer.to_string()),
    }
}

/// `pointer` when it fits the resolver's cap, else `whole`, which does.
fn fitting(pointer: String, whole: &str) -> String {
    if pointer.len() <= MAX_POINTER_BYTES {
        pointer
    } else {
        whole.to_string()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Recipients {
    /// Who a message, invite or share is addressed to.
    To,
    /// Who gets a copy.
    Copy,
    /// A phone, mobile, fax or pager number: always shown, but a contact's
    /// `telephone1` is not where the contact goes, so never the target. A
    /// phone number under a target member or a bare recipient word
    /// (`destination`, `target`, `callee`) counts too: it shows as written,
    /// never as a record a result's name could stand in for.
    Number,
}

/// What a member holding `values` says about recipients. Without values only
/// its name counts. `to` also names destinations (`copy_object`, branches), so
/// it counts only for a value that holds an address; the other recipient
/// names only need a value that could hold one, not a count or a flag.
pub(super) fn recipients_in(member: &str, values: &[&Value]) -> Option<Recipients> {
    let bare = bare_member(member);
    let addressed =
        |test: fn(&Value) -> bool| values.is_empty() || values.iter().copied().any(test);
    if RECIPIENT_MEMBERS.contains(&bare.as_str())
        && addressed(if bare == "to" {
            holds_an_address_or_nobody
        } else {
            may_hold_an_address
        })
    {
        Some(Recipients::To)
    } else if COPY_RECIPIENT_MEMBERS.contains(&bare.as_str()) && addressed(may_hold_an_address) {
        Some(Recipients::Copy)
    } else if is_contact_number_member(member)
        || (names_where_it_goes(member) && values.iter().copied().any(holds_a_phone_number))
    {
        Some(Recipients::Number)
    } else {
        None
    }
}

/// A value that names no one stays a recipient member that names no one.
fn holds_an_address_or_nobody(value: &Value) -> bool {
    !names_someone(value) || holds_an_address(value)
}

/// An email address, a phone number, a machine ID standing for a person, a
/// recipient object, or a list holding one.
fn holds_an_address(value: &Value) -> bool {
    let one = |value: &Value| match value {
        Value::String(text) => text.contains('@') || is_phone_shaped(text) || is_machine_id(text),
        Value::Object(members) => !members.is_empty(),
        _ => false,
    };
    match value {
        Value::Array(entries) => entries.iter().take(MAX_LIST_ENTRIES).any(one),
        value => one(value),
    }
}

/// Anything but a count or a flag.
fn may_hold_an_address(value: &Value) -> bool {
    match value {
        Value::Array(entries) => {
            entries.is_empty()
                || entries
                    .iter()
                    .take(MAX_SEARCH_VALUES)
                    .any(may_hold_an_address)
        }
        Value::Number(_) | Value::Bool(_) => false,
        _ => true,
    }
}

fn names_where_it_goes(member: &str) -> bool {
    is_one_of(member, &TARGET_MEMBERS)
        || RECIPIENT_NUMBER_WORDS.contains(&bare_member(member).as_str())
}

/// A phone-shaped text, or a list holding one.
fn holds_a_phone_number(value: &Value) -> bool {
    let phone = |value: &Value| value.as_str().is_some_and(is_phone_shaped);
    match value {
        Value::Array(entries) => entries.iter().take(MAX_LIST_ENTRIES).any(phone),
        value => phone(value),
    }
}

/// Whether a recipient member's value names anyone: not null, empty text,
/// an empty list or a list of nothing.
fn names_someone(value: &Value) -> bool {
    let one = |value: &Value| match value {
        Value::String(text) => !text.trim().is_empty(),
        Value::Number(_) => true,
        Value::Object(members) => !members.is_empty(),
        _ => false,
    };
    match value {
        Value::Array(entries) => entries.iter().take(MAX_SEARCH_VALUES).any(one),
        value => one(value),
    }
}

/// How a recipient member is shown: a list's every entry, each user by the
/// ID of the record it links to or the address it holds; anything else
/// whole. Every entry must hold it the same way, so none is left out.
fn recipient_at(pointer: &str, values: &[&Value]) -> Option<String> {
    let values: Vec<&Value> = values
        .iter()
        .copied()
        .filter(|value| names_someone(value))
        .collect();
    let list = values.first()?.is_array();
    if values.iter().any(|value| value.is_array() != list) {
        return Some(pointer.to_string());
    }
    let mut entries: Vec<&Value> = Vec::new();
    for value in &values {
        match value {
            Value::Array(list) => {
                let room = MAX_SEARCH_VALUES + 1 - entries.len();
                entries.extend(list.iter().filter(|entry| !entry.is_null()).take(room));
            }
            value => entries.push(value),
        }
        if entries.len() > MAX_SEARCH_VALUES {
            return Some(pointer.to_string());
        }
    }
    let inside = |entry: &&Value| {
        let object = entry.as_object()?;
        match link_id_member(object) {
            Some(id) => Some(format!("/{}", escape(id))),
            None => address_in(object),
        }
    };
    let mut each = entries.iter().map(inside);
    if let Some(Some(first)) = each.next()
        && each.all(|other| other.as_ref() == Some(&first))
    {
        let wildcard = if list { "/*" } else { "" };
        return Some(fitting(format!("{pointer}{wildcard}{first}"), pointer));
    }
    Some(pointer.to_string())
}

/// Where a recipient object says the person is reached, below it: its
/// address, else its one contact number. An object with an address and a
/// number, or with several numbers, is shown whole: any of them may be used.
fn address_in(object: &serde_json::Map<String, Value>) -> Option<String> {
    let is_address = |member: &str| ADDRESS_MEMBERS.contains(&bare_member(member).as_str());
    let text = |value: &Value| value.as_str().is_some_and(|text| !text.trim().is_empty());
    let mut address = None;
    let mut numbers = Vec::new();
    for (member, value) in object.iter().take(MAX_RECIPIENT_OBJECT_MEMBERS) {
        if is_contact_number_member(member) {
            if names_someone(value) {
                numbers.push(member);
            }
            continue;
        }
        if address.is_some() || !is_address(member) {
            continue;
        }
        if text(value) {
            address = Some(format!("/{}", escape(member)));
        } else if let Value::Object(inner) = value
            && let Some((inner_address, _)) = inner
                .iter()
                .take(MAX_RECIPIENT_OBJECT_MEMBERS)
                .find(|(inner, value)| is_address(inner) && text(value))
        {
            address = Some(format!("/{}/{}", escape(member), escape(inner_address)));
        }
    }
    match (address, numbers.as_slice()) {
        (Some(address), []) => Some(address),
        (None, [number]) => Some(format!("/{}", escape(number))),
        _ => None,
    }
}

/// Every member naming recipients or holding a contact number, shallowest
/// first, at most [`MAX_RECIPIENT_MEMBERS`] of them.
pub fn recipient_members(arguments: &Value) -> Vec<RecipientMember> {
    let mut found = Vec::new();
    find(arguments, Skip::Targets, |pointer, member, values| {
        if found.len() < MAX_RECIPIENT_MEMBERS
            && recipients_in(member, values).is_some()
            && let Some(shown_at) = recipient_at(pointer, values)
        {
            found.push(RecipientMember {
                member: pointer.to_string(),
                shown_at,
            });
        }
        None
    });
    found
}

/// Whether one of `pointers` shows the whole of `member`: the member itself,
/// a link or address inside every entry, never a single entry such as `/to/0`.
fn shows_whole(pointers: &[&str], member: &str) -> bool {
    pointers.iter().any(|pointer| {
        pointer == &member
            || pointer
                .strip_prefix(member)
                .and_then(|rest| rest.strip_prefix('/'))
                .is_some_and(|rest| {
                    let next = rest.split('/').next().unwrap_or_default();
                    next.is_empty() || !next.bytes().all(|byte| byte.is_ascii_digit())
                })
    })
}

/// The pointers of a mapping that a label reads; later items and fields are
/// never shown.
fn mapping_pointers(mapping: &ToolCallLabelMapping) -> Vec<&str> {
    mapping
        .items
        .iter()
        .take(MAX_LABEL_ITEMS)
        .flat_map(|item| {
            [
                &item.title,
                &item.id,
                &item.target,
                &item.before,
                &item.after,
            ]
            .into_iter()
            .flatten()
            .chain(item.fields.iter().take(MAX_FIELD_POINTERS))
        })
        .map(String::as_str)
        .collect()
}

/// The mapping with every recipient member shown: those its own pointers
/// leave out go first among the first item's fields, so a label never names
/// only `to` while copies go to others.
pub fn with_every_recipient(
    mapping: &ToolCallLabelMapping,
    recipients: &[RecipientMember],
) -> ToolCallLabelMapping {
    let mut mapping = mapping.clone();
    let shown = mapping_pointers(&mapping);
    let missing: Vec<String> = recipients
        .iter()
        .filter(|recipient| !shows_whole(&shown, &recipient.member))
        .map(|recipient| recipient.shown_at.clone())
        .collect();
    if let Some(item) = mapping.items.first_mut()
        && !missing.is_empty()
    {
        item.fields.splice(0..0, missing);
    }
    mapping
}

/// Whether a label with items shows every recipient member, so a cap that
/// cut one off means the generic label.
pub fn shows_every_recipient(label: &ToolCallLabel, recipients: &[RecipientMember]) -> bool {
    if label.items.is_empty() {
        return true;
    }
    let shown: Vec<&str> = label
        .items
        .iter()
        .flat_map(|item| {
            [
                &item.title,
                &item.id,
                &item.target,
                &item.before,
                &item.after,
            ]
            .into_iter()
            .flatten()
            .chain(&item.fields)
        })
        .map(|slot| slot.pointer.as_str())
        .collect();
    recipients.len() < MAX_RECIPIENT_MEMBERS
        && recipients
            .iter()
            .all(|recipient| shows_whole(&shown, &recipient.member))
}

fn all_links(entries: &[Value]) -> bool {
    !entries.is_empty()
        && entries
            .iter()
            .all(|entry| entry.as_object().is_some_and(is_link))
}

/// Values worth showing next to the item: first every recipient the target
/// leaves out, then on a create or send the short members beside its title,
/// on an update or comment the members it changes, a link as its ID. Never
/// the parts the item already shows, the table, or a consent flag such as
/// `hasUserApproved`.
fn fields(
    arguments: &Value,
    action: ToolCallAction,
    item: &ToolCallLabelItemMapping,
    table: Option<&str>,
    approval_argument: Option<&str>,
) -> Vec<String> {
    let mut used: Vec<&str> = [
        &item.title,
        &item.id,
        &item.target,
        &item.before,
        &item.after,
    ]
    .into_iter()
    .flatten()
    .map(String::as_str)
    .chain(table)
    .collect();
    let recipients = recipient_members(arguments);
    let mut out: Vec<String> = recipients
        .iter()
        .filter(|recipient| !shows_whole(&used, &recipient.member))
        .map(|recipient| recipient.shown_at.clone())
        .collect();
    used.extend(recipients.iter().map(|recipient| recipient.member.as_str()));
    let mut budget = MAX_SEARCH_VALUES;
    match action {
        ToolCallAction::Create
        | ToolCallAction::Send
        | ToolCallAction::Share
        | ToolCallAction::Upsert
        | ToolCallAction::Upload => {
            let Some((parent, _)) = item
                .title
                .as_deref()
                .and_then(|title| title.rsplit_once('/'))
            else {
                return out;
            };
            let objects: Vec<&Value> = if parent.is_empty() {
                vec![arguments]
            } else {
                pointer::resolve(arguments, parent)
                    .into_iter()
                    .map(|reached| reached.value)
                    .collect()
            };
            for (member, values) in members(&objects, &mut budget) {
                if out.len() >= MAX_LABEL_FIELDS {
                    break;
                }
                let Some(pointer) = child_pointer(parent, member) else {
                    continue;
                };
                // Recipients that name no one are no field beside the title.
                if covers(&used, &pointer)
                    || is_consent_member(member, approval_argument)
                    || recipients_in(member, &values).is_some()
                {
                    continue;
                }
                if values.iter().copied().any(is_short_scalar) {
                    out.push(pointer);
                }
            }
        }
        ToolCallAction::Update | ToolCallAction::Comment => {
            changed_members(
                "",
                &[arguments],
                0,
                &used,
                approval_argument,
                &mut budget,
                &mut out,
            );
        }
        _ => {}
    }
    out
}

/// Whether a part already shown is `pointer` or lies inside it.
fn covers(used: &[&str], pointer: &str) -> bool {
    used.iter().any(|used| {
        used.strip_prefix(pointer)
            .is_some_and(|rest| rest.is_empty() || rest.starts_with('/'))
    })
}

fn changed_members(
    pointer: &str,
    values: &[&Value],
    depth: usize,
    used: &[&str],
    approval_argument: Option<&str>,
    budget: &mut usize,
    out: &mut Vec<String>,
) {
    if depth > MAX_FIELD_DEPTH {
        return;
    }
    for (member, values) in members(values, budget) {
        if out.len() >= MAX_LABEL_FIELDS {
            return;
        }
        let Some(path) = child_pointer(pointer, member) else {
            continue;
        };
        if used.contains(&path.as_str()) || is_consent_member(member, approval_argument) {
            continue;
        }
        if let Some(id) = values.iter().find_map(|value| {
            value
                .as_object()
                .filter(|members| is_lookup(members))
                .and_then(link_id_member)
        }) {
            if let Some(link) = child_pointer(&path, id)
                && !used.contains(&link.as_str())
            {
                out.push(link);
            }
            continue;
        }
        if values.iter().copied().any(is_short_scalar) {
            out.push(path);
            continue;
        }
        let objects: Vec<&Value> = values
            .iter()
            .copied()
            .filter(|value| value.is_object())
            .collect();
        let entries: Vec<&Value> = values
            .iter()
            .filter_map(|value| value.as_array())
            .flat_map(|entries| entries.iter().take(MAX_LIST_ENTRIES))
            .collect();
        if !objects.is_empty() {
            changed_members(
                &path,
                &objects,
                depth + 1,
                used,
                approval_argument,
                budget,
                out,
            );
        }
        if !entries.is_empty()
            && let Some(each) = child_pointer(&path, "*")
        {
            changed_members(
                &each,
                &entries,
                depth + 1,
                used,
                approval_argument,
                budget,
                out,
            );
        }
    }
}

/// One level of the arguments' shape: every value one pointer reaches, with
/// `*` for the entries of lists.
struct Level<'a> {
    pointer: String,
    values: Vec<&'a Value>,
    depth: usize,
}

/// What a search does not look inside.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Skip {
    Nothing,
    /// Lookups, whose members only describe another record, and recipients,
    /// whose names and texts describe people.
    Lookups,
    /// Parents, folders and recipients, whose IDs are where an item goes.
    Targets,
}

impl Skip {
    fn skips_member(self, member: &str) -> bool {
        match self {
            Skip::Nothing => false,
            Skip::Lookups => recipients_in(member, &[]).is_some(),
            Skip::Targets => {
                is_one_of(member, &TARGET_MEMBERS) || recipients_in(member, &[]).is_some()
            }
        }
    }

    fn skips_value(self, value: &Value) -> bool {
        self == Skip::Lookups && value.as_object().is_some_and(is_lookup)
    }
}

/// The first member, breadth first, that `accept` takes, given its pointer,
/// its name and the values it holds across a batch; `accept` returns the
/// pointer to use. Members whose pointer would not resolve are passed over.
fn find<'a>(
    arguments: &'a Value,
    skip: Skip,
    mut accept: impl FnMut(&str, &str, &[&'a Value]) -> Option<String>,
) -> Option<String> {
    let mut queue = VecDeque::from([Level {
        pointer: String::new(),
        values: vec![arguments],
        depth: 0,
    }]);
    let mut budget = MAX_SEARCH_VALUES;
    while let Some(level) = queue.pop_front() {
        budget = budget.checked_sub(level.values.len())?;
        let members: Vec<_> = members(&level.values, &mut budget)
            .into_iter()
            .filter_map(|(member, values)| {
                Some((child_pointer(&level.pointer, member)?, member, values))
            })
            .collect();
        for (pointer, member, values) in &members {
            if let Some(found) = accept(pointer, member, values) {
                return Some(found);
            }
        }
        if level.depth == MAX_SEARCH_DEPTH {
            continue;
        }
        for (pointer, member, values) in members {
            if skip.skips_member(member) {
                continue;
            }
            let nested: Vec<&Value> = values
                .into_iter()
                .filter(|value| is_container(value) && !skip.skips_value(value))
                .collect();
            if !nested.is_empty() {
                queue.push_back(Level {
                    pointer,
                    values: nested,
                    depth: level.depth + 1,
                });
            }
        }
        let entries: Vec<&Value> = level
            .values
            .iter()
            .filter_map(|value| value.as_array())
            .flat_map(|entries| entries.iter().take(MAX_LIST_ENTRIES))
            .filter(|entry| !skip.skips_value(entry))
            .collect();
        if !entries.is_empty()
            && let Some(pointer) = child_pointer(&level.pointer, "*")
        {
            queue.push_back(Level {
                pointer,
                values: entries,
                depth: level.depth + 1,
            });
        }
    }
    None
}

/// `base` with `member` appended, or `None` when the pointer would pass the
/// resolver's cap and so reach nothing.
fn child_pointer(base: &str, member: &str) -> Option<String> {
    if base.len() + 1 + member.len() > MAX_POINTER_BYTES {
        return None;
    }
    let pointer = format!("{base}/{}", escape(member));
    (pointer.len() <= MAX_POINTER_BYTES).then_some(pointer)
}

/// The members of the objects among `values`, in the order first seen, each
/// with the values it holds; each member read costs one of `budget`.
fn members<'a>(values: &[&'a Value], budget: &mut usize) -> Vec<(&'a str, Vec<&'a Value>)> {
    let mut members: Vec<(&'a str, Vec<&'a Value>)> = Vec::new();
    let mut index: HashMap<&str, usize> = HashMap::new();
    for object in values.iter().filter_map(|value| value.as_object()) {
        for (member, value) in object {
            if *budget == 0 {
                return members;
            }
            *budget -= 1;
            match index.get(member.as_str()) {
                Some(&at) => members[at].1.push(value),
                None => {
                    index.insert(member.as_str(), members.len());
                    members.push((member.as_str(), vec![value]));
                }
            }
        }
    }
    members
}

fn text_member(names: &[&str]) -> impl FnMut(&str, &str, &[&Value]) -> Option<String> {
    move |pointer, member, values| {
        (is_one_of(member, names) && values.iter().any(|value| value.is_string()))
            .then(|| pointer.to_string())
    }
}

fn is_one_of(member: &str, names: &[&str]) -> bool {
    names.iter().any(|name| member.eq_ignore_ascii_case(name))
}

fn is_container(value: &Value) -> bool {
    value.is_object() || value.is_array()
}

fn is_text_or_number(value: &Value) -> bool {
    match value {
        Value::String(text) => !text.is_empty(),
        Value::Number(_) => true,
        _ => false,
    }
}

fn is_short_scalar(value: &Value) -> bool {
    match value {
        Value::String(text) => !text.contains('\n') && text.chars().nth(MAX_INLINE_CHARS).is_none(),
        Value::Number(_) | Value::Bool(_) => true,
        _ => false,
    }
}

/// A member that holds what the model says the user decided: the server's
/// configured approval argument, or `hasUserApproved` in any letter case
/// with or without `_` or `-`. A name that only mentions consent or approval,
/// such as `marketing_consent` or `approved`, is data the call writes.
fn is_consent_member(member: &str, approval_argument: Option<&str>) -> bool {
    const FLAGS: [&str; 1] = ["hasuserapproved"];
    if approval_argument == Some(member) {
        return true;
    }
    if member.len() > 32 {
        return false;
    }
    let bare: String = member
        .chars()
        .filter(|c| !matches!(c, '_' | '-'))
        .map(|c| c.to_ascii_lowercase())
        .collect();
    FLAGS.contains(&bare.as_str())
}

/// The claim the value at `path` in the arguments would make on a card: a
/// consent flag at or above it, whatever it holds, or a lookup's name. The
/// arguments' top is the call itself and never a lookup.
pub fn claim(arguments: &Value, path: &str, approval_argument: Option<&str>) -> Option<Claim> {
    if path.len() > pointer::MAX_PATH_BYTES {
        return None;
    }
    if pointer::member_names(path)
        .iter()
        .any(|member| is_consent_member(member, approval_argument))
    {
        return Some(Claim::Consent);
    }
    let mut rest = path;
    let (holder, member) = loop {
        let (head, token) = rest.rsplit_once('/')?;
        if token.is_empty() || !token.bytes().all(|byte| byte.is_ascii_digit()) {
            break (head, token);
        }
        rest = head;
    };
    if holder.is_empty() || !is_name_member(member) {
        return None;
    }
    // A literal JSON pointer: `*` here is a key, not a wildcard.
    arguments
        .pointer(holder)
        .and_then(Value::as_object)
        .is_some_and(is_lookup)
        .then_some(Claim::LookupName)
}

#[cfg(test)]
mod tests;
