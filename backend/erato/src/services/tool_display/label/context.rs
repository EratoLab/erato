//! What earlier tool results in the chat say about the IDs a call names: the
//! name of the record an ID stands for, and the values its fields held. Read
//! by code from results. What the model wrote into a call never names a
//! record, a lookup's `name` included; the one exception is the name a create
//! call gave the record its result reports.

use super::MAX_LABEL_VALUE_CHARS;
use super::arguments::{MAX_ID_CHARS, looks_like_a_uuid, names_an_id};
use super::pointer;
use crate::models::message::{
    ContentPart, GenerationInputMessages, MessageRole, ToolCallAction, ToolCallLabel,
    ToolCallStatus, ToolUse,
};
use crate::services::display_text::{MAX_DISPLAY_NAME_CHARS, sanitize_display_text};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet, VecDeque};

/// Records kept for one turn; the ones seen least recently go first.
pub const MAX_RECORDS: usize = 500;
pub const MAX_RECORDS_PER_RESULT: usize = 200;
pub const MAX_FIELDS_PER_RECORD: usize = 32;
/// JSON nodes read from one result or one call's arguments.
pub const MAX_NODES_PER_VALUE: usize = 5_000;
const MAX_DEPTH: usize = 8;
/// Longer text is not the short confirmation the create rule reads.
pub const MAX_CREATE_RESULT_CHARS: usize = 500;
const NAME_KEYS: [&str; 4] = ["name", "title", "subject", "fullname"];
/// Where a link says its record lives.
const LINK_TYPE_KEYS: [&str; 4] = ["relatedTable", "LogicalName", "type", "@odata.type"];

/// Names and field values by ID, from the successful tool results of a chat.
#[derive(Debug, Clone, Default)]
pub struct ToolResultContext {
    records: HashMap<String, Record>,
    order: VecDeque<String>,
    /// Calls already read, so the running turn's parts are read once.
    seen: HashSet<String>,
}

#[derive(Debug, Clone, Default)]
struct Record {
    name: Option<String>,
    fields: HashMap<String, String>,
    /// A non-UUID ID that named two different things: it resolves to nothing.
    ambiguous: bool,
}

impl ToolResultContext {
    /// The tool results a turn's generation input replays. After a chat-history
    /// compaction none are left, so names read before it are misses.
    pub fn from_messages(source: &GenerationInputMessages) -> Self {
        let mut context = Self::default();
        for message in &source.messages {
            if let (MessageRole::Tool, ContentPart::ToolUse(tool)) =
                (&message.role, &message.content)
            {
                context.read(tool);
            }
        }
        context
    }

    /// Reads the running turn's calls that have settled since the last look.
    pub fn observe(&mut self, content: &[ContentPart]) {
        for part in content {
            if let ContentPart::ToolUse(tool) = part {
                self.read(tool);
            }
        }
    }

    /// Fills `resolved` on the label's values: the record name for `id`,
    /// `target` and `before`, and on an update each field's earlier value,
    /// read from the one record the item's `id` names. A miss stays `None`.
    pub fn resolve(&self, label: &mut ToolCallLabel, arguments: &Value) {
        let update = label.action == ToolCallAction::Update;
        for item in &mut label.items {
            for slot in [&mut item.id, &mut item.target, &mut item.before]
                .into_iter()
                .flatten()
            {
                for value in &mut slot.values {
                    value.resolved = self
                        .record_at(arguments, &value.path)
                        .and_then(|record| record.name.clone());
                }
            }
            if !update {
                continue;
            }
            let record = item
                .id
                .as_ref()
                .filter(|slot| slot.omitted == 0)
                .and_then(|slot| match slot.values.as_slice() {
                    [only] => self.record_at(arguments, &only.path),
                    _ => None,
                });
            let Some(record) = record else {
                continue;
            };
            for field in &mut item.fields {
                for value in &mut field.values {
                    value.resolved = field_member(&value.path).and_then(|member| {
                        let earlier = record.fields.get(&member)?;
                        // A status `1` is a value; a link's earlier ID only
                        // shows as its record's name, never as the raw ID.
                        if looks_like_a_uuid(earlier) || names_an_id(&member) {
                            let lookup = self.record(&text_key(earlier)?)?;
                            lookup.name.clone()
                        } else {
                            Some(earlier.clone())
                        }
                    });
                }
            }
        }
    }

    fn record(&self, key: &str) -> Option<&Record> {
        self.records.get(key).filter(|record| !record.ambiguous)
    }

    fn record_at(&self, arguments: &Value, path: &str) -> Option<&Record> {
        let reached = pointer::resolve(arguments, path).into_iter().next()?;
        self.record(&id_key(reached.value)?)
    }

    fn read(&mut self, tool: &ToolUse) {
        if !matches!(tool.status, ToolCallStatus::Success | ToolCallStatus::Error)
            || self.seen.contains(&tool.tool_call_id)
        {
            return;
        }
        if !tool.tool_call_id.is_empty() {
            self.seen.insert(tool.tool_call_id.clone());
        }
        if is_refused_by_erato(tool) {
            return;
        }
        // Whatever a call named may have changed, failed calls included, so
        // the values read before it no longer count as the earlier ones.
        if let Some(arguments) = &tool.input {
            match argument_ids(arguments, true) {
                Some(keys) => {
                    for key in keys {
                        if let Some(record) = self.records.get_mut(&key) {
                            record.fields.clear();
                        }
                    }
                }
                // Some IDs went unread, so any record may be among them.
                None => {
                    for record in self.records.values_mut() {
                        record.fields.clear();
                    }
                }
            }
        }
        if tool.status != ToolCallStatus::Success {
            return;
        }
        match &tool.output {
            Some(Value::String(text)) => self.read_created(tool, text),
            Some(output) => {
                let words = words(tool.input.as_ref());
                let mut walk = Walk {
                    nodes: MAX_NODES_PER_VALUE,
                    records: MAX_RECORDS_PER_RESULT,
                };
                self.read_node(output, &words, &mut walk, 0);
            }
            None => {}
        }
    }

    fn read_node(&mut self, value: &Value, words: &HashSet<String>, walk: &mut Walk, depth: usize) {
        if walk.nodes == 0 || walk.records == 0 || depth > MAX_DEPTH {
            return;
        }
        walk.nodes -= 1;
        match value {
            Value::Object(object) => {
                if let Some((member, key)) = own_id(object, words) {
                    let name = name_of(object);
                    let fields = fields_of(object, member, words);
                    if name.is_some() || !fields.is_empty() {
                        walk.records -= 1;
                        self.merge(key, name, fields);
                    }
                }
                for child in object.values() {
                    self.read_node(child, words, walk, depth + 1);
                }
            }
            Value::Array(entries) => {
                for entry in entries {
                    self.read_node(entry, words, walk, depth + 1);
                }
            }
            _ => {}
        }
    }

    /// A create whose short text result holds exactly one ID: the record
    /// takes the name the call gave it.
    fn read_created(&mut self, tool: &ToolUse, text: &str) {
        if text.chars().nth(MAX_CREATE_RESULT_CHARS).is_some() || !is_create(tool) {
            return;
        }
        let mut ids = uuid_keys(text).collect::<HashSet<_>>().into_iter();
        let (Some(key), None, Some(arguments)) = (ids.next(), ids.next(), tool.input.as_ref())
        else {
            return;
        };
        // A record that did not exist yet cannot be in its own create's
        // arguments: an ID there is the parent's or a linked record's.
        if argument_ids(arguments, false).is_none_or(|named| named.contains(&key)) {
            return;
        }
        if let Some(name) = created_name(arguments) {
            self.merge(key, Some(name), HashMap::new());
        }
    }

    fn merge(&mut self, key: String, name: Option<String>, fields: HashMap<String, String>) {
        // Every server numbers its own records, and `ToolUse` does not say
        // which server a result came from, so `7` could be anything.
        if key.bytes().all(|byte| byte.is_ascii_digit()) {
            return;
        }
        if let Some(record) = self.records.get_mut(&key) {
            if let Some(at) = self.order.iter().position(|seen| *seen == key) {
                let seen = self.order.remove(at);
                self.order.extend(seen);
            }
            if record.ambiguous {
                return;
            }
            // A UUID names one thing everywhere, so a new name is a rename.
            if record.name.is_some()
                && name.is_some()
                && record.name != name
                && !looks_like_a_uuid(&key)
            {
                *record = Record {
                    ambiguous: true,
                    ..Record::default()
                };
                return;
            }
            if name.is_some() {
                record.name = name;
            }
            for (member, value) in fields {
                if record.fields.len() < MAX_FIELDS_PER_RECORD
                    || record.fields.contains_key(&member)
                {
                    record.fields.insert(member, value);
                }
            }
            return;
        }
        if self.order.len() == MAX_RECORDS
            && let Some(oldest) = self.order.pop_front()
        {
            self.records.remove(&oldest);
        }
        self.order.push_back(key.clone());
        self.records.insert(
            key,
            Record {
                name,
                fields,
                ambiguous: false,
            },
        );
    }
}

struct Walk {
    nodes: usize,
    records: usize,
}

/// How an ID is looked up: UUIDs in any spelling as bare lowercase hex,
/// other IDs as written.
fn id_key(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => text_key(text),
        Value::Number(number) if number.is_u64() => Some(number.to_string()),
        _ => None,
    }
}

fn text_key(text: &str) -> Option<String> {
    if text.is_empty() || text.len() > MAX_ID_CHARS || text.chars().any(char::is_whitespace) {
        return None;
    }
    Some(if looks_like_a_uuid(text) {
        text.chars()
            .filter(char::is_ascii_hexdigit)
            .map(|c| c.to_ascii_lowercase())
            .collect()
    } else {
        text.to_string()
    })
}

/// The member that holds an object's own ID: `id`, else its only `*id`
/// member, else the one whose stem is a word in the arguments of the call
/// that read it. Rows also carry the IDs of the records they link to, so
/// anything else is skipped rather than guessed.
fn own_id<'a>(
    object: &'a Map<String, Value>,
    words: &HashSet<String>,
) -> Option<(&'a str, String)> {
    if let Some(found) = object
        .iter()
        .find(|(member, _)| member.eq_ignore_ascii_case("id"))
        .and_then(|(member, value)| Some((member.as_str(), id_key(value)?)))
    {
        return Some(found);
    }
    let candidates: Vec<_> = object
        .iter()
        .filter(|(member, value)| is_id_member(member, value))
        .filter_map(|(member, value)| Some((member.as_str(), id_key(value)?)))
        .collect();
    if let [only] = candidates.as_slice() {
        return Some(only.clone());
    }
    let mut named = candidates
        .into_iter()
        .filter(|(member, _)| words.contains(&stem(member)));
    match (named.next(), named.next()) {
        (Some(found), None) => Some(found),
        _ => None,
    }
}

/// `opportunityid`, `page_id` or `recordId` holding an ID; not `paid: "yes"`.
pub(super) fn is_id_member(member: &str, value: &Value) -> bool {
    member.len() > 2
        && member.to_ascii_lowercase().ends_with("id")
        && match value {
            Value::String(text) => names_an_id(member) || looks_like_a_uuid(text),
            Value::Number(number) => number.is_u64() && names_an_id(member),
            _ => false,
        }
}

/// `opportunityid` → `opportunity`, `page_id` → `page`.
fn stem(member: &str) -> String {
    let lower = member.to_ascii_lowercase();
    lower
        .strip_suffix("id")
        .unwrap_or(&lower)
        .trim_end_matches(['_', '-'])
        .to_string()
}

/// The lowercase words of a call's string arguments, such as the table in a
/// query's `FROM`.
fn words(arguments: Option<&Value>) -> HashSet<String> {
    fn collect(value: &Value, words: &mut HashSet<String>, nodes: &mut usize, depth: usize) {
        if *nodes == 0 || depth > MAX_DEPTH {
            return;
        }
        *nodes -= 1;
        match value {
            Value::String(text) => words.extend(
                text.split(|c: char| !(c.is_alphanumeric() || c == '_'))
                    .filter(|word| !word.is_empty())
                    .map(str::to_lowercase),
            ),
            Value::Object(object) => {
                for child in object.values() {
                    collect(child, words, nodes, depth + 1);
                }
            }
            Value::Array(entries) => {
                for entry in entries {
                    collect(entry, words, nodes, depth + 1);
                }
            }
            _ => {}
        }
    }
    let mut words = HashSet::new();
    let mut nodes = MAX_NODES_PER_VALUE;
    if let Some(arguments) = arguments {
        collect(arguments, &mut words, &mut nodes, 0);
    }
    words
}

fn name_of(object: &Map<String, Value>) -> Option<String> {
    NAME_KEYS.iter().find_map(|key| {
        object
            .iter()
            .find(|(member, _)| member.eq_ignore_ascii_case(key))
            .and_then(|(_, value)| value.as_str())
            .map(clean)
            .filter(|name| !name.is_empty())
    })
}

/// A record's scalar members, the IDs of the records it links to, and the
/// scalar members of plain objects one level down (such as `properties`).
fn fields_of(
    object: &Map<String, Value>,
    id_member: &str,
    words: &HashSet<String>,
) -> HashMap<String, String> {
    let mut fields = HashMap::new();
    let mut nested = Vec::new();
    for (member, value) in object {
        if fields.len() == MAX_FIELDS_PER_RECORD {
            return fields;
        }
        if member == id_member || member.chars().nth(MAX_DISPLAY_NAME_CHARS).is_some() {
            continue;
        }
        let text = match value {
            Value::Object(inner) => match own_id(inner, words) {
                Some((link, _)) => scalar_text(&inner[link]),
                None => {
                    nested.push(inner);
                    None
                }
            },
            value => scalar_text(value),
        };
        if let Some(text) = text {
            fields.insert(member.clone(), text);
        }
    }
    for (member, value) in nested.into_iter().flatten() {
        if fields.len() == MAX_FIELDS_PER_RECORD {
            break;
        }
        if member.chars().nth(MAX_DISPLAY_NAME_CHARS).is_none()
            && !fields.contains_key(member)
            && let Some(text) = scalar_text(value)
        {
            fields.insert(member.clone(), text);
        }
    }
    fields
}

fn scalar_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(clean(text)).filter(|text| !text.is_empty()),
        Value::Number(_) | Value::Bool(_) => Some(value.to_string()),
        _ => None,
    }
}

fn clean(text: &str) -> String {
    sanitize_display_text(text, MAX_LABEL_VALUE_CHARS).text
}

/// An object that only points at a record: one ID member plus at most its
/// name and the table or type it lives in, such as a lookup
/// `{recordId, relatedTable, name}` or `{page_id}`. Its name is whatever the
/// model typed. `{id, fields: {...}}` carries data: it is the record itself.
pub(super) fn is_link(object: &Map<String, Value>) -> bool {
    let mut ids = 0;
    for (member, value) in object {
        if is_link_id(member, value) {
            ids += 1;
        } else if !NAME_KEYS
            .iter()
            .chain(&LINK_TYPE_KEYS)
            .any(|key| member.eq_ignore_ascii_case(key))
        {
            return false;
        }
    }
    ids == 1
}

/// A link that says it is one: it names the table or type it points into, or
/// its ID member is a bare `id` or `recordId`. `{name, parentaccountid}` may
/// as well be a record's own name next to its parent.
pub(super) fn is_lookup(object: &Map<String, Value>) -> bool {
    is_link(object)
        && object.keys().any(|member| {
            is_reference_member(member)
                || LINK_TYPE_KEYS
                    .iter()
                    .any(|key| member.eq_ignore_ascii_case(key))
        })
}

/// The member of a link that holds the ID of the record it points at.
pub(super) fn link_id_member(object: &Map<String, Value>) -> Option<&str> {
    is_link(object)
        .then(|| {
            object
                .iter()
                .find(|(member, value)| is_link_id(member, value))
        })
        .flatten()
        .map(|(member, _)| member.as_str())
}

fn is_link_id(member: &str, value: &Value) -> bool {
    (member.eq_ignore_ascii_case("id") && id_key(value).is_some()) || is_id_member(member, value)
}

fn is_reference_member(member: &str) -> bool {
    let bare: String = member.chars().filter(|c| !matches!(c, '_' | '-')).collect();
    bare.eq_ignore_ascii_case("id") || bare.eq_ignore_ascii_case("recordid")
}

/// Every ID a call's arguments hold, UUIDs written inside text included
/// (`WHERE opportunityid = '…'`) and IDs used as member names. With
/// `skip_links`, a link's ID is left out: it only points at its record, so
/// the call did not change it. `None` when a cap left some unread.
fn argument_ids(arguments: &Value, skip_links: bool) -> Option<Vec<String>> {
    fn collect(
        value: &Value,
        skip_links: bool,
        keys: &mut Vec<String>,
        nodes: &mut usize,
        depth: usize,
    ) -> bool {
        if *nodes == 0 || depth > MAX_DEPTH {
            return false;
        }
        *nodes -= 1;
        match value {
            Value::Object(object) if skip_links && depth > 0 && is_link(object) => true,
            Value::Object(object) => object.iter().all(|(member, child)| {
                keys.extend(text_key(member));
                keys.extend(uuid_keys(member));
                collect(child, skip_links, keys, nodes, depth + 1)
            }),
            Value::Array(entries) => entries
                .iter()
                .all(|entry| collect(entry, skip_links, keys, nodes, depth + 1)),
            Value::String(text) => {
                keys.extend(id_key(value));
                keys.extend(uuid_keys(text));
                true
            }
            value => {
                keys.extend(id_key(value));
                true
            }
        }
    }
    let mut keys = Vec::new();
    let mut nodes = MAX_NODES_PER_VALUE;
    collect(arguments, skip_links, &mut keys, &mut nodes, 0).then_some(keys)
}

/// A call Erato itself turned down (the user denied it, a gate refused it,
/// the budget ran out) never reached its server.
fn is_refused_by_erato(tool: &ToolUse) -> bool {
    tool.status == ToolCallStatus::Error
        && tool
            .output
            .as_ref()
            .and_then(|output| output.get("status"))
            .and_then(Value::as_str)
            == Some("rejected")
}

/// The UUIDs written anywhere in `text`, as lookup keys.
fn uuid_keys(text: &str) -> impl Iterator<Item = String> + '_ {
    text.split(|c: char| !(c.is_ascii_hexdigit() || matches!(c, '-' | '{' | '}')))
        .filter(|token| looks_like_a_uuid(token))
        .filter_map(text_key)
}

/// What a field is called in the record: its last member, or for a
/// reference's ID (`/item/parentcontactid/recordId`) the member holding it.
fn field_member(path: &str) -> Option<String> {
    let members = pointer::member_names(path);
    let member = match members.as_slice() {
        [.., holder, last] if is_reference_member(last) => holder,
        [.., last] => last,
        [] => return None,
    };
    Some(member.to_string())
}

fn is_create(tool: &ToolUse) -> bool {
    tool.display
        .as_ref()
        .and_then(|display| display.label.as_ref())
        .is_some_and(|label| label.action == ToolCallAction::Create)
        || name_words(&tool.tool_name)
            .iter()
            .any(|word| word == "create")
}

/// `notion-create-pages`, `create_record` and `createIssue` all hold `create`.
pub(super) fn name_words(name: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut word = String::new();
    let mut after_lower = false;
    for c in name.chars() {
        if !c.is_alphanumeric() || (c.is_uppercase() && after_lower) {
            words.extend((!word.is_empty()).then(|| std::mem::take(&mut word)));
        }
        if c.is_alphanumeric() {
            word.extend(c.to_lowercase());
        }
        after_lower = c.is_lowercase() || c.is_ascii_digit();
    }
    words.extend((!word.is_empty()).then_some(word));
    words
}

/// The one name a create call gave its record. Lists (several records) and
/// links to other records are left out; two candidates give none.
fn created_name(arguments: &Value) -> Option<String> {
    fn collect(value: &Value, names: &mut HashSet<String>, depth: usize) {
        let Value::Object(object) = value else {
            return;
        };
        if depth > 3 || (depth > 0 && is_link(object)) {
            return;
        }
        names.extend(name_of(object));
        for child in object.values() {
            collect(child, names, depth + 1);
        }
    }
    let mut names = HashSet::new();
    collect(arguments, &mut names, 0);
    let mut names = names.into_iter();
    match (names.next(), names.next()) {
        (Some(name), None) => Some(name),
        _ => None,
    }
}

#[cfg(test)]
mod tests;
