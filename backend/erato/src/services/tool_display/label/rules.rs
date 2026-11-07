//! Generic rules: a label from a tool's name and the shape of its arguments,
//! with no knowledge of any one server. They are the first label source and
//! say when they are unsure, so a model can step in there. The verb comes
//! from a verb field or the tool's name, never from other argument text, and
//! every pointer is one the arguments were searched for, so it resolves.
//!
//! The cross-check holds a label from any source against the tool's name and
//! its resolved annotations.

use super::arguments::{MAX_INLINE_CHARS, MAX_LIST_ENTRIES, names_an_id};
use super::context::{is_id_member, is_link, is_lookup, link_id_member, name_words};
use super::pointer::{self, escape};
use super::{MAX_LABEL_FIELDS, ToolCallLabelItemMapping, ToolCallLabelMapping};
use crate::models::message::{ToolCallAction, ToolCallLabelSource, ToolCallObjectKind};
use rmcp::model::{JsonObject, Tool, ToolAnnotations};
use serde_json::Value;
use std::collections::{HashMap, VecDeque};

/// Members whose value names the operation (`command: "update_content"`,
/// `op: "add"`), read up to four levels deep. A verb they give wins over the
/// tool's name when the tool's input schema declares them.
pub const VERB_FIELDS: [&str; 6] = ["command", "op", "kind", "action", "mode", "operation"];
/// Objects below the arguments' top whose verb fields still count.
const VERB_FIELD_DEPTH: usize = 3;
/// A verb field's value counts only when it reads as an identifier, such as
/// `update_content` or `word.apply_edits`, never as free text.
const MAX_VERB_VALUE_CHARS: usize = 40;
/// Values one search visits, so a large batch costs no more than this.
const MAX_SEARCH_VALUES: usize = 5_000;
const MAX_SEARCH_DEPTH: usize = 6;
const MAX_FIELD_DEPTH: usize = 4;

const VERBS: [(ToolCallAction, &[&str]); 6] = [
    (
        ToolCallAction::Create,
        &[
            "create",
            "add",
            "new",
            "post",
            "insert",
            "append",
            "upload",
            "duplicate",
        ],
    ),
    (
        ToolCallAction::Update,
        &[
            "update", "edit", "patch", "set", "rename", "modify", "change", "replace", "apply",
            "resolve", "reopen", "accept", "submit", "pull", "push",
        ],
    ),
    (
        ToolCallAction::Delete,
        &["delete", "remove", "trash", "archive", "cancel", "clear"],
    ),
    (ToolCallAction::Move, &["move"]),
    (
        ToolCallAction::Send,
        &["send", "reply", "forward", "share", "publish"],
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
const TARGET_MEMBERS: [&str; 11] = [
    "parent",
    "new_parent",
    "folder_id",
    "parent_id",
    "destination",
    "to",
    "channel",
    "teamid",
    "calendar_id",
    "snapshot",
    "anchor",
];
const ID_MEMBERS: [&str; 16] = [
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
];
const BEFORE_MEMBERS: [&str; 4] = ["old_str", "old_text", "old", "before"];
const AFTER_MEMBERS: [&str; 9] = [
    "new_str", "new_text", "new", "after", "text", "content", "body", "markdown", "message",
];
/// Where a created item's text sits when none of the above holds it.
const CREATED_TEXT_MEMBER: &str = "description";
/// Members naming the table or type a record lives in: its kind.
const TABLE_MEMBERS: [&str; 8] = [
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

/// Why the rules would rather a model labelled a call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RulesUnsure {
    /// No verb for a call that is not a read, or a tool name whose words name
    /// more than one.
    NoClearVerb,
    /// A write whose item has neither a title nor an ID.
    NothingNamed,
}

/// Why a label's verb was not trusted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CrossCheckFlag {
    /// The resolved `readOnlyHint` is true, but the label writes.
    ReadOnlyAnnotation,
    /// The resolved `destructiveHint` is true, but the label only adds.
    DestructiveAnnotation,
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
            Self::DestructiveAnnotation => "destructive_annotation",
            Self::ReadName => "read_name",
            Self::NameVerb => "name_verb",
            Self::FieldVerb => "field_verb",
        }
    }
}

/// The rules' label for one call. `annotations` are the resolved hints, with
/// absent ones left absent; a read-only hint only tells a read apart from a
/// call with no verb.
pub fn rules_label(
    tool_name: &str,
    arguments: &Value,
    annotations: Option<&ToolAnnotations>,
) -> RulesLabel {
    let name = name_words(tool_name);
    let verb = verb(&name, Some(arguments));
    let action = verb.action;
    let (object_kind, table) = kind(&name, arguments);
    let mut item = ToolCallLabelItemMapping::default();
    if action != ToolCallAction::Create {
        item.id = id_pointer(arguments);
    }
    item.target = target_pointer(arguments, action, item.id.as_deref());
    if matches!(action, ToolCallAction::Create | ToolCallAction::Send) {
        item.title = title_pointer(arguments);
    }
    item.before = find(arguments, Skip::Lookups, text_member(&BEFORE_MEMBERS));
    if matches!(
        action,
        ToolCallAction::Create
            | ToolCallAction::Update
            | ToolCallAction::Comment
            | ToolCallAction::Send
    ) {
        item.after = find(arguments, Skip::Lookups, text_member(&AFTER_MEMBERS)).or_else(|| {
            matches!(action, ToolCallAction::Create | ToolCallAction::Send)
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
    item.fields = fields(arguments, action, &item, table.as_deref());

    let read = has(&name, &READ_VERBS);
    let unsure = if action == ToolCallAction::Other {
        (!read && annotations.and_then(|hints| hints.read_only_hint) != Some(true))
            .then_some(RulesUnsure::NoClearVerb)
    } else if verb.source == VerbSource::Name && (name_verbs(&name).len() > 1 || read) {
        Some(RulesUnsure::NoClearVerb)
    } else {
        (item.title.is_none() && item.id.is_none()).then_some(RulesUnsure::NothingNamed)
    };

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
/// annotations, operator overrides included; an absent hint says nothing.
/// Any flag means the card shows the generic label. When verb fields the
/// tool's input schema declares set the verb, the name steps back: it
/// describes the tool, the fields this call. The label must then agree with
/// the fields.
pub fn cross_check(tool: &Tool, arguments: &Value, action: ToolCallAction) -> Vec<CrossCheckFlag> {
    let hint = |get: fn(&ToolAnnotations) -> Option<bool>| {
        tool.annotations.as_ref().and_then(get) == Some(true)
    };
    let name = name_words(&tool.name);
    let verb = verb(&name, Some(arguments));
    let mut flags = Vec::new();
    if hint(|hints| hints.read_only_hint) && action != ToolCallAction::Other {
        flags.push(CrossCheckFlag::ReadOnlyAnnotation);
    }
    if hint(|hints| hints.destructive_hint)
        && !matches!(
            action,
            ToolCallAction::Delete
                | ToolCallAction::Update
                | ToolCallAction::Move
                | ToolCallAction::Other
        )
    {
        flags.push(CrossCheckFlag::DestructiveAnnotation);
    }
    if verb.source == VerbSource::Field && verb.action != action {
        flags.push(CrossCheckFlag::FieldVerb);
    }
    // A member the schema does not declare may be one the model made up.
    let declared = verb.source == VerbSource::Field
        && verb_fields(arguments)
            .into_iter()
            .all(|(member, _)| declares(&tool.input_schema, member));
    if declared {
        return flags;
    }
    if action != ToolCallAction::Other && has(&name, &READ_VERBS) {
        flags.push(CrossCheckFlag::ReadName);
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

/// The verb fields with an identifier for a value, as (member, value).
pub fn verb_fields(arguments: &Value) -> Vec<(&str, &str)> {
    fn walk<'a>(
        value: &'a Value,
        depth: usize,
        budget: &mut usize,
        out: &mut Vec<(&'a str, &'a str)>,
    ) {
        if depth > VERB_FIELD_DEPTH || *budget == 0 {
            return;
        }
        *budget -= 1;
        match value {
            Value::Object(members) => {
                out.extend(
                    members
                        .iter()
                        .filter(|(member, _)| is_one_of(member, &VERB_FIELDS))
                        .filter_map(|(member, value)| Some((member.as_str(), value.as_str()?)))
                        .filter(|(_, value)| is_identifier(value)),
                );
                for child in members.values().filter(|child| is_container(child)) {
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
                    objects.extend(entries.iter().filter_map(Value::as_object))
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
    if has(name, &["upsert"]) {
        let action = if arguments.is_some_and(holds_an_id) {
            ToolCallAction::Update
        } else {
            ToolCallAction::Create
        };
        return found(action, VerbSource::Arguments);
    }
    if let [action] = field_actions.as_slice() {
        return found(*action, VerbSource::Field);
    }
    if let Some(action) = actions_of(name).first() {
        return found(*action, VerbSource::Name);
    }
    if let (Some(first), Some(Value::Object(members))) = (name.first(), arguments)
        && SAVE_VERBS.contains(&first.as_str())
    {
        let action = if members.get("id").is_some_and(is_text_or_number) {
            ToolCallAction::Update
        } else {
            ToolCallAction::Create
        };
        return found(action, VerbSource::Arguments);
    }
    found(ToolCallAction::Other, VerbSource::None)
}

/// Words that only read as one verb together: `create_comment` comments,
/// `post_message` sends.
fn compound(name: &[String], fields: &[String]) -> Option<(ToolCallAction, VerbSource)> {
    if has(name, &COMMENT_NOUNS) {
        if has(fields, &ADD_VERBS) {
            return Some((ToolCallAction::Comment, VerbSource::Field));
        }
        if fields.is_empty() && has(name, &ADD_VERBS) {
            return Some((ToolCallAction::Comment, VerbSource::Name));
        }
    }
    (fields.is_empty() && has(name, &["post"]) && has(name, &MESSAGE_NOUNS))
        .then_some((ToolCallAction::Send, VerbSource::Name))
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
    if has(name, &["upsert"]) || saves {
        return vec![ToolCallAction::Create, ToolCallAction::Update];
    }
    named
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

/// A parent's or folder's ID says where an item goes, not that it exists.
fn holds_an_id(arguments: &Value) -> bool {
    find(
        arguments,
        Skip::Targets,
        id_member(|member| names_an_id(member) && !is_one_of(member, &TARGET_MEMBERS)),
    )
    .is_some()
}

/// The kind a table member names, else the head noun of the tool's name, and
/// the table member's pointer.
fn kind(name: &[String], arguments: &Value) -> (ToolCallObjectKind, Option<String>) {
    if let Value::Object(top) = arguments {
        let nested = top.iter().filter_map(|(member, value)| match value {
            Value::Object(members) if !is_lookup(members) => {
                Some((format!("/{}", escape(member)), members))
            }
            _ => None,
        });
        for (base, members) in std::iter::once((String::new(), top)).chain(nested) {
            for (member, value) in members {
                if is_one_of(member, &TABLE_MEMBERS)
                    && let Some(table) = value.as_str()
                {
                    let kind = kind_of(&name_words(table)).unwrap_or(ToolCallObjectKind::Row);
                    return (kind, Some(format!("{base}/{}", escape(member))));
                }
            }
        }
    }
    (kind_of(name).unwrap_or(ToolCallObjectKind::Other), None)
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

/// A member `named` holding an ID, or a list of them.
fn id_member(named: fn(&str) -> bool) -> impl FnMut(&str, &str, &[&Value]) -> Option<String> {
    move |pointer, member, values| {
        if !named(member) {
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

/// Where the item goes or lives: a parent, folder, channel or recipient, then
/// on a create the first record it links to, since a record being created
/// has no ID of its own yet. On an update a link is a changed field.
fn target_pointer(arguments: &Value, action: ToolCallAction, id: Option<&str>) -> Option<String> {
    let not_the_id = |pointer: &str| {
        id.is_none_or(|id| id != pointer && !id.starts_with(&format!("{pointer}/")))
    };
    let found = find(arguments, Skip::Nothing, |pointer, member, values| {
        (is_one_of(member, &TARGET_MEMBERS) && not_the_id(pointer))
            .then(|| target_at(pointer, values))
            .flatten()
    });
    if found.is_some() || action != ToolCallAction::Create {
        return found;
    }
    find(arguments, Skip::Nothing, |pointer, member, values| {
        member
            .to_ascii_lowercase()
            .starts_with("parent")
            .then(|| target_at(pointer, values))
            .flatten()
    })
    .or_else(|| {
        find(arguments, Skip::Nothing, |pointer, member, values| {
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

/// A link points at its ID member, a list of links at theirs; anything else
/// is shown whole. The first value that is not null decides.
fn target_at(pointer: &str, values: &[&Value]) -> Option<String> {
    match values.iter().find(|value| !value.is_null())? {
        Value::Object(members) => Some(match link_id_member(members) {
            Some(id) => format!("{pointer}/{}", escape(id)),
            None => pointer.to_string(),
        }),
        Value::Array(entries) if entries.is_empty() => None,
        Value::Array(entries) => Some(
            match entries
                .first()
                .and_then(Value::as_object)
                .and_then(link_id_member)
                .filter(|_| all_links(entries))
            {
                Some(id) => format!("{pointer}/*/{}", escape(id)),
                None => pointer.to_string(),
            },
        ),
        _ => Some(pointer.to_string()),
    }
}

fn all_links(entries: &[Value]) -> bool {
    !entries.is_empty()
        && entries
            .iter()
            .all(|entry| entry.as_object().is_some_and(is_link))
}

/// Values worth showing next to the item: on a create or send the short
/// members beside its title, on an update or comment the members it changes,
/// a link as its ID. Never the parts the item already shows, the table, or a
/// consent flag such as `hasUserApproved`.
fn fields(
    arguments: &Value,
    action: ToolCallAction,
    item: &ToolCallLabelItemMapping,
    table: Option<&str>,
) -> Vec<String> {
    let used: Vec<&str> = [
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
    let mut out = Vec::new();
    match action {
        ToolCallAction::Create | ToolCallAction::Send => {
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
            for (member, values) in members(&objects) {
                let pointer = format!("{parent}/{}", escape(member));
                let inside_used = used.iter().any(|used| {
                    used.strip_prefix(pointer.as_str())
                        .is_some_and(|rest| rest.starts_with('/'))
                });
                if used.contains(&pointer.as_str()) || inside_used || is_consent(member, &values) {
                    continue;
                }
                if values.iter().copied().any(is_short_scalar) {
                    out.push(pointer);
                    if out.len() == MAX_LABEL_FIELDS {
                        break;
                    }
                }
            }
        }
        ToolCallAction::Update | ToolCallAction::Comment => {
            changed_members(String::new(), &[arguments], 0, &used, &mut out);
        }
        _ => {}
    }
    out
}

fn changed_members(
    pointer: String,
    values: &[&Value],
    depth: usize,
    used: &[&str],
    out: &mut Vec<String>,
) {
    if depth > MAX_FIELD_DEPTH {
        return;
    }
    for (member, values) in members(values) {
        if out.len() == MAX_LABEL_FIELDS {
            return;
        }
        let path = format!("{pointer}/{}", escape(member));
        if used.contains(&path.as_str()) || is_consent(member, &values) {
            continue;
        }
        if let Some(id) = values.iter().find_map(|value| {
            value
                .as_object()
                .filter(|members| is_lookup(members))
                .and_then(link_id_member)
        }) {
            let link = format!("{path}/{}", escape(id));
            if !used.contains(&link.as_str()) {
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
            changed_members(path.clone(), &objects, depth + 1, used, out);
        }
        if !entries.is_empty() {
            changed_members(format!("{path}/*"), &entries, depth + 1, used, out);
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
    /// Lookups, whose members only describe another record.
    Lookups,
    /// Parents, folders and recipients, whose IDs are where an item goes.
    Targets,
}

/// The first member, breadth first, that `accept` takes, given its pointer,
/// its name and the values it holds across a batch; `accept` returns the
/// pointer to use.
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
        let members = members(&level.values);
        for (member, values) in &members {
            let pointer = format!("{}/{}", level.pointer, escape(member));
            if let Some(found) = accept(&pointer, member, values) {
                return Some(found);
            }
        }
        if level.depth == MAX_SEARCH_DEPTH {
            continue;
        }
        for (member, values) in members {
            if skip == Skip::Targets && is_one_of(member, &TARGET_MEMBERS) {
                continue;
            }
            let nested: Vec<&Value> = values
                .into_iter()
                .filter(|value| match value {
                    Value::Object(members) => skip != Skip::Lookups || !is_lookup(members),
                    Value::Array(_) => true,
                    _ => false,
                })
                .collect();
            if !nested.is_empty() {
                queue.push_back(Level {
                    pointer: format!("{}/{}", level.pointer, escape(member)),
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
            .collect();
        if !entries.is_empty() {
            queue.push_back(Level {
                pointer: format!("{}/*", level.pointer),
                values: entries,
                depth: level.depth + 1,
            });
        }
    }
    None
}

/// The members of the objects among `values`, in the order first seen, each
/// with the values it holds.
fn members<'a>(values: &[&'a Value]) -> Vec<(&'a str, Vec<&'a Value>)> {
    let mut members: Vec<(&'a str, Vec<&'a Value>)> = Vec::new();
    let mut index: HashMap<&str, usize> = HashMap::new();
    for object in values.iter().filter_map(|value| value.as_object()) {
        for (member, value) in object {
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

/// `hasUserApproved: true` or `user_confirmed: true` says what the model
/// claims about the user, never what the call does. `approved: true` on an
/// expense is the change itself.
fn is_consent(member: &str, values: &[&Value]) -> bool {
    let lower = member.to_ascii_lowercase();
    lower.contains("user")
        && (lower.contains("approv") || lower.contains("confirm"))
        && values.iter().any(|value| value.is_boolean())
}

#[cfg(test)]
mod tests;
