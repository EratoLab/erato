//! What earlier tool results in the chat say about the IDs a call names: the
//! name of the record an ID stands for, and the values its fields held. Read
//! by code from results. What the model wrote into a call never names a
//! record, a lookup's `name` included; the one exception is the name a create
//! call gave the record its result reports. Names stay with the MCP server
//! whose result gave them, and never reach a recipient, an address, a phone
//! number or a link.

use super::arguments::{MAX_ID_CHARS, looks_like_a_uuid, names_an_id};
use super::pointer;
use super::recipients::is_recipient_member;
use super::{MAX_LABEL_VALUE_BYTES, MAX_LABEL_VALUE_CHARS};
use crate::models::message::{
    ContentPart, GenerationInputMessages, MessageRole, ToolCallAction, ToolCallLabel,
    ToolCallStatus, ToolUse,
};
use crate::services::display_text::{MAX_DISPLAY_NAME_CHARS, sanitize_display_text};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::ops::ControlFlow;

/// Records kept for one turn; the ones seen least recently go first.
pub const MAX_RECORDS: usize = 500;
pub const MAX_RECORDS_PER_RESULT: usize = 200;
pub const MAX_FIELDS_PER_RECORD: usize = 32;
/// JSON nodes read from one result or one call's arguments; in a result an
/// object costs one per member and an array one per entry.
pub const MAX_NODES_PER_VALUE: usize = 5_000;
const MAX_DEPTH: usize = 8;
/// Longer text is not the short confirmation the create rule reads.
pub const MAX_CREATE_RESULT_CHARS: usize = 500;
/// The most recent calls a turn starts from; older results are misses, as
/// after a compaction.
pub const MAX_CALLS_READ: usize = 200;
/// What the index holds at most; the records seen least recently go first.
pub const MAX_INDEX_BYTES: usize = 2 * 1024 * 1024;
/// Resolved text one label carries; values past it stay unresolved.
pub const MAX_RESOLVED_BYTES: usize = MAX_LABEL_VALUE_BYTES;
/// IDs read from one call's arguments, and the longest string searched for
/// them; more, or a longer string, count as a cap reached.
const MAX_ARGUMENT_IDS: usize = 2 * MAX_NODES_PER_VALUE;
const MAX_ID_SCAN_BYTES: usize = 64 * 1024;
/// Text cleaned for one name or value: far more than its cap needs, so only
/// a long run of dropped characters can leave it short.
const MAX_CLEAN_BYTES: usize = 16 * 1024;
/// Words a read's arguments give the ID tie-break, from the start of each
/// string: a table name is a short word near the start of a query.
const MAX_WORDS: usize = 1_000;
const MAX_WORD_SCAN_BYTES: usize = 8 * 1024;
const NAME_KEYS: [&str; 4] = ["name", "title", "subject", "fullname"];
/// Where a link says its record lives.
const LINK_TYPE_KEYS: [&str; 4] = ["relatedTable", "LogicalName", "type", "@odata.type"];

/// Names and field values by ID, from the successful tool results of a chat.
/// Reads only settled calls: a call still waiting, such as a client tool
/// whose result is held for the user's review, has no output to read yet.
#[derive(Debug, Clone, Default)]
pub struct ToolResultContext {
    records: HashMap<RecordKey, Record>,
    order: VecDeque<RecordKey>,
    /// Calls already read, so the running turn's parts are read once.
    seen: HashSet<String>,
    /// Estimated size of `records`, kept under [`MAX_INDEX_BYTES`].
    bytes: usize,
}

/// A record as one MCP server reported it: `server` is the name its tool rows
/// carry, `id` the lookup key of its ID.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct RecordKey {
    server: String,
    id: String,
}

impl RecordKey {
    fn new(server: &str, id: String) -> Self {
        Self {
            server: server.to_string(),
            id,
        }
    }
}

#[derive(Debug, Clone, Default)]
struct Record {
    name: Option<String>,
    fields: HashMap<String, String>,
    /// A non-UUID ID that named two different things: it resolves to nothing.
    ambiguous: bool,
}

impl ToolResultContext {
    /// The tool results a turn's generation input replays, the most recent
    /// [`MAX_CALLS_READ`] calls only. After a chat-history compaction none are
    /// left, so names read before it are misses.
    pub fn from_messages(source: &GenerationInputMessages) -> Self {
        let mut context = Self::default();
        let calls: Vec<&ToolUse> = source
            .messages
            .iter()
            .filter_map(|message| match (&message.role, &message.content) {
                (MessageRole::Tool, ContentPart::ToolUse(tool)) => Some(tool),
                _ => None,
            })
            .collect();
        let first_read = calls.len().saturating_sub(MAX_CALLS_READ);
        for (index, tool) in calls.into_iter().enumerate() {
            if index >= first_read {
                context.read(tool);
            } else if is_settled(tool) && !tool.tool_call_id.is_empty() {
                // Read later, after newer calls, an old read would bring back
                // values a newer write retired.
                context.seen.insert(tool.tool_call_id.clone());
            }
        }
        context
    }

    /// Reads the running turn's calls that have settled since the last look.
    pub fn observe(&mut self, content: &[ContentPart]) {
        for part in content {
            // A call without an ID cannot be told from one read before, and
            // reading it again would bring back values a later write retired.
            if let ContentPart::ToolUse(tool) = part
                && !tool.tool_call_id.is_empty()
            {
                self.read(tool);
            }
        }
    }

    /// Fills `resolved` on the label's values: the record name for `id`,
    /// `target` and `before`, and on an update each field's earlier value,
    /// read from the one record the item's `id` names. Only results of
    /// `server`, the name the call's own tool rows carry, are used. A miss
    /// stays `None`, and so does every value below a recipient member and
    /// every value past [`MAX_RESOLVED_BYTES`] of resolved text.
    pub fn resolve(&self, label: &mut ToolCallLabel, arguments: &Value, server: &str) {
        let update = label.action == ToolCallAction::Update;
        let mut budget = MAX_RESOLVED_BYTES;
        let mut kept = |found: Option<String>| {
            let found = found?;
            budget = budget.checked_sub(found.len())?;
            Some(found)
        };
        for item in &mut label.items {
            for slot in [&mut item.id, &mut item.target, &mut item.before]
                .into_iter()
                .flatten()
            {
                for value in &mut slot.values {
                    value.resolved = kept(
                        self.record_at(arguments, &value.path, server)
                            .and_then(|record| record.name.clone()),
                    );
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
                    [only] => self.record_at(arguments, &only.path, server),
                    _ => None,
                });
            let Some(record) = record else {
                continue;
            };
            for field in &mut item.fields {
                for value in &mut field.values {
                    let member = Some(&value.path)
                        .filter(|path| !below_a_recipient(path))
                        .and_then(|path| field_member(path));
                    value.resolved = kept(member.and_then(|member| {
                        let earlier = record.fields.get(&member)?;
                        // A status `1` is a value; a link's earlier ID only
                        // shows as its record's name, never as the raw ID.
                        if looks_like_a_uuid(earlier) || names_an_id(&member) {
                            let lookup = self.record(server, text_key(earlier)?)?;
                            lookup.name.clone()
                        } else {
                            Some(earlier.clone())
                        }
                    }));
                }
            }
        }
    }

    fn record(&self, server: &str, id: String) -> Option<&Record> {
        if !indexable(&id) {
            return None;
        }
        self.records
            .get(&RecordKey::new(server, id))
            .filter(|record| !record.ambiguous)
    }

    fn record_at(&self, arguments: &Value, path: &str, server: &str) -> Option<&Record> {
        if below_a_recipient(path) {
            return None;
        }
        let mut reached = None;
        pointer::visit(arguments, path, |_, value| {
            reached = Some(value);
            ControlFlow::Break(())
        });
        self.record(server, id_key(reached?)?)
    }

    fn read(&mut self, tool: &ToolUse) {
        if !is_settled(tool) || self.seen.contains(&tool.tool_call_id) {
            return;
        }
        if !tool.tool_call_id.is_empty() {
            self.seen.insert(tool.tool_call_id.clone());
        }
        // A bug in reading one result costs the names, never the turn.
        let read =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| self.read_settled(tool)));
        if read.is_err() {
            tracing::error!("Dropping the names read from tool results: reading one panicked");
            self.records.clear();
            self.order.clear();
            self.bytes = 0;
        }
    }

    fn read_settled(&mut self, tool: &ToolUse) {
        if is_refused_by_erato(tool) {
            return;
        }
        // A task's child may have changed any record, and what its tools
        // returned stays in the child's chat.
        if crate::services::delegation::is_delegation_tool_name(&tool.tool_name) {
            self.retire_all();
            return;
        }
        // Whatever a call named may have changed, failed calls included, so
        // the values read before it no longer count as the earlier ones. On
        // every server: a call of another server, or of none, can reach the
        // same record.
        if let Some(arguments) = &tool.input {
            match argument_ids(arguments, true) {
                Some(keys) => self.retire(&keys.into_iter().collect()),
                // Some IDs went unread, so any record may be among them.
                None => self.retire_all(),
            }
        }
        let Some(server) = result_server(tool) else {
            return;
        };
        if tool.status != ToolCallStatus::Success {
            return;
        }
        match &tool.output {
            Some(Value::String(text)) => self.read_created(tool, text, server),
            Some(output) => {
                let words = words(tool.input.as_ref());
                let mut walk = Walk {
                    nodes: MAX_NODES_PER_VALUE,
                    records: MAX_RECORDS_PER_RESULT,
                };
                self.read_node(output, server, &words, &mut walk, 0);
            }
            None => {}
        }
    }

    fn read_node(
        &mut self,
        value: &Value,
        server: &str,
        words: &HashSet<String>,
        walk: &mut Walk,
        depth: usize,
    ) {
        if walk.records == 0 || depth > MAX_DEPTH {
            return;
        }
        match value {
            Value::Object(object) => {
                // Every member is looked at below, so an object costs its width.
                if !walk.take(object.len()) {
                    return;
                }
                if let Some((member, key)) = own_id(object, words) {
                    let name = name_of(object);
                    let fields = fields_of(object, member, words, walk);
                    if name.is_some() || !fields.is_empty() {
                        walk.records -= 1;
                        self.merge(RecordKey::new(server, key), name, fields);
                    }
                }
                for child in object.values().filter(|child| is_container(child)) {
                    if walk.nodes == 0 || walk.records == 0 {
                        break;
                    }
                    self.read_node(child, server, words, walk, depth + 1);
                }
            }
            Value::Array(entries) => {
                for entry in entries {
                    if walk.records == 0 || !walk.take(1) {
                        break;
                    }
                    if is_container(entry) {
                        self.read_node(entry, server, words, walk, depth + 1);
                    }
                }
            }
            _ => {}
        }
    }

    fn retire(&mut self, ids: &HashSet<String>) {
        if ids.is_empty() {
            return;
        }
        for (key, record) in &mut self.records {
            if !record.fields.is_empty() && ids.contains(&key.id) {
                let before = record_bytes(key, record);
                record.fields.clear();
                let after = record_bytes(key, record);
                self.bytes = self.bytes.saturating_sub(before - after);
            }
        }
    }

    fn retire_all(&mut self) {
        for record in self.records.values_mut() {
            record.fields.clear();
        }
        self.bytes = self
            .records
            .iter()
            .map(|(key, record)| record_bytes(key, record))
            .sum();
    }

    /// A create whose short text result holds exactly one ID: the record
    /// takes the name the call gave it.
    fn read_created(&mut self, tool: &ToolUse, text: &str, server: &str) {
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
            self.merge(RecordKey::new(server, key), Some(name), HashMap::new());
        }
    }

    fn merge(&mut self, key: RecordKey, name: Option<String>, fields: HashMap<String, String>) {
        if !indexable(&key.id) {
            return;
        }
        let record = match self.records.remove(&key) {
            Some(mut record) => {
                self.bytes = self.bytes.saturating_sub(record_bytes(&key, &record));
                if let Some(at) = self.order.iter().position(|seen| *seen == key) {
                    let seen = self.order.remove(at);
                    self.order.extend(seen);
                }
                // A UUID names one thing everywhere, so a new name is a rename.
                let named_twice = record.name.is_some()
                    && name.is_some()
                    && record.name != name
                    && !looks_like_a_uuid(&key.id);
                if named_twice {
                    record = Record {
                        ambiguous: true,
                        ..Record::default()
                    };
                } else if !record.ambiguous {
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
                }
                record
            }
            None => {
                if self.order.len() >= MAX_RECORDS {
                    self.evict_oldest();
                }
                self.order.push_back(key.clone());
                Record {
                    name,
                    fields,
                    ambiguous: false,
                }
            }
        };
        self.bytes = self.bytes.saturating_add(record_bytes(&key, &record));
        self.records.insert(key, record);
        while self.bytes > MAX_INDEX_BYTES && self.order.len() > 1 {
            self.evict_oldest();
        }
    }

    fn evict_oldest(&mut self) {
        if let Some(oldest) = self.order.pop_front()
            && let Some(record) = self.records.remove(&oldest)
        {
            self.bytes = self.bytes.saturating_sub(record_bytes(&oldest, &record));
        }
    }
}

/// What a record costs the index, roughly: its text plus a fixed overhead
/// per entry.
fn record_bytes(key: &RecordKey, record: &Record) -> usize {
    const OVERHEAD: usize = 64;
    let fields: usize = record
        .fields
        .iter()
        .map(|(member, value)| OVERHEAD + member.len() + value.len())
        .sum();
    OVERHEAD
        + key.server.len()
        + key.id.len()
        + record.name.as_ref().map_or(0, String::len)
        + fields
}

/// Drops what a chat's results said about a label's values, keeping the
/// values as the call wrote them.
pub fn forget_resolved(label: &mut ToolCallLabel) {
    for item in &mut label.items {
        let slots = [
            &mut item.title,
            &mut item.id,
            &mut item.target,
            &mut item.before,
            &mut item.after,
        ];
        for slot in slots.into_iter().flatten().chain(&mut item.fields) {
            for value in &mut slot.values {
                value.resolved = None;
            }
        }
    }
}

/// The MCP server a result came from, as its tool row names it. Rows without
/// one (client tools, rows older than server names) give no names.
fn result_server(tool: &ToolUse) -> Option<&str> {
    tool.display
        .as_ref()?
        .server_name
        .as_deref()
        .filter(|name| !name.is_empty())
}

/// IDs the index never holds. Digits: every table numbers its own records,
/// so `7` could be anything. Addresses and links: a call writing one must
/// show it as written, never as a name a result gave it.
fn indexable(id: &str) -> bool {
    const LINK_PREFIXES: [&str; 6] = ["mailto:", "tel:", "sms:", "data:", "javascript:", "www."];
    let link_prefix = |prefix: &&str| {
        id.get(..prefix.len())
            .is_some_and(|start| start.eq_ignore_ascii_case(prefix))
    };
    !id.bytes().all(|byte| byte.is_ascii_digit())
        && !id.contains('@')
        && !id.contains("://")
        && !LINK_PREFIXES.iter().any(link_prefix)
}

/// Whether a value's path passes through a recipient, address or contact
/// number member. A path too long to read counts as one.
fn below_a_recipient(path: &str) -> bool {
    path.len() > pointer::MAX_PATH_BYTES
        || pointer::member_names(path)
            .iter()
            .any(|member| is_recipient_member(member))
}

fn is_settled(tool: &ToolUse) -> bool {
    matches!(tool.status, ToolCallStatus::Success | ToolCallStatus::Error)
}

fn is_container(value: &Value) -> bool {
    matches!(value, Value::Object(_) | Value::Array(_))
}

struct Walk {
    nodes: usize,
    records: usize,
}

impl Walk {
    /// Spends `cost` nodes, or ends the walk when fewer are left.
    fn take(&mut self, cost: usize) -> bool {
        match self.nodes.checked_sub(cost.max(1)) {
            Some(left) => {
                self.nodes = left;
                true
            }
            None => {
                self.nodes = 0;
                false
            }
        }
    }
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
fn is_id_member(member: &str, value: &Value) -> bool {
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
        if *nodes == 0 || depth > MAX_DEPTH || words.len() >= MAX_WORDS {
            return;
        }
        *nodes -= 1;
        match value {
            Value::String(text) => {
                let scanned = text_prefix(text, MAX_WORD_SCAN_BYTES)
                    .split(|c: char| !(c.is_alphanumeric() || c == '_'))
                    .filter(|word| !word.is_empty() && word.len() <= MAX_ID_CHARS);
                for word in scanned {
                    if words.len() >= MAX_WORDS {
                        break;
                    }
                    words.insert(word.to_lowercase());
                }
            }
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

/// At most the first `max_bytes` of `text`, cut at a character boundary.
fn text_prefix(text: &str, max_bytes: usize) -> &str {
    let mut end = max_bytes.min(text.len());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
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
/// Each object member costs the walk its width, as it is read here too.
fn fields_of(
    object: &Map<String, Value>,
    id_member: &str,
    words: &HashSet<String>,
    walk: &mut Walk,
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
            Value::Object(inner) => {
                if !walk.take(inner.len()) {
                    break;
                }
                match own_id(inner, words) {
                    Some((link, _)) => inner.get(link).and_then(scalar_text),
                    None => {
                        nested.push(inner);
                        None
                    }
                }
            }
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
    sanitize_display_text(text_prefix(text, MAX_CLEAN_BYTES), MAX_LABEL_VALUE_CHARS).text
}

/// An object that only points at a record: one ID member plus at most its
/// name and the table or type it lives in, such as a lookup
/// `{recordId, relatedTable, name}` or `{page_id}`. Its name is whatever the
/// model typed. `{id, fields: {...}}` carries data: it is the record itself.
fn is_link(object: &Map<String, Value>) -> bool {
    if object.len() > 1 + NAME_KEYS.len() + LINK_TYPE_KEYS.len() {
        return false;
    }
    let mut ids = 0;
    for (member, value) in object {
        if (member.eq_ignore_ascii_case("id") && id_key(value).is_some())
            || is_id_member(member, value)
        {
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

fn is_reference_member(member: &str) -> bool {
    let bare: String = member.chars().filter(|c| !matches!(c, '_' | '-')).collect();
    bare.eq_ignore_ascii_case("id") || bare.eq_ignore_ascii_case("recordid")
}

/// Every ID a call's arguments hold, UUIDs written inside text included
/// (`WHERE opportunityid = '…'`) and IDs used as member names. With
/// `skip_links`, a link's ID is left out: it only points at its record, so
/// the call did not change it. `None` when a cap left some unread.
fn argument_ids(arguments: &Value, skip_links: bool) -> Option<Vec<String>> {
    /// Adds `found` unless that passes [`MAX_ARGUMENT_IDS`].
    fn add(keys: &mut Vec<String>, found: impl IntoIterator<Item = String>) -> bool {
        for key in found {
            if keys.len() == MAX_ARGUMENT_IDS {
                return false;
            }
            keys.push(key);
        }
        true
    }
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
                member.len() <= MAX_ID_SCAN_BYTES
                    && add(keys, text_key(member))
                    && add(keys, uuid_keys(member))
                    && collect(child, skip_links, keys, nodes, depth + 1)
            }),
            Value::Array(entries) => entries
                .iter()
                .all(|entry| collect(entry, skip_links, keys, nodes, depth + 1)),
            Value::String(text) => {
                text.len() <= MAX_ID_SCAN_BYTES
                    && add(keys, id_key(value))
                    && add(keys, uuid_keys(text))
            }
            value => add(keys, id_key(value)),
        }
    }
    let mut keys = Vec::new();
    let mut nodes = MAX_NODES_PER_VALUE;
    collect(arguments, skip_links, &mut keys, &mut nodes, 0).then_some(keys)
}

/// A call Erato itself turned down (the user denied it, a gate refused it,
/// the budget ran out) never reached its server. Erato writes exactly
/// `{status: "rejected", error: <text>}`.
fn is_refused_by_erato(tool: &ToolUse) -> bool {
    tool.status == ToolCallStatus::Error
        && tool
            .output
            .as_ref()
            .and_then(Value::as_object)
            .is_some_and(|output| {
                output.len() == 2
                    && output.get("status").and_then(Value::as_str) == Some("rejected")
                    && output.get("error").is_some_and(Value::is_string)
            })
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
fn name_words(name: &str) -> Vec<String> {
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
    /// False once a second name turns up or the members read pass the cap.
    fn collect(
        value: &Value,
        names: &mut HashSet<String>,
        nodes: &mut usize,
        depth: usize,
    ) -> bool {
        let Value::Object(object) = value else {
            return true;
        };
        if depth > 3 || (depth > 0 && is_link(object)) {
            return true;
        }
        let Some(left) = nodes.checked_sub(object.len()) else {
            return false;
        };
        *nodes = left;
        names.extend(name_of(object));
        names.len() < 2
            && object
                .values()
                .all(|child| collect(child, names, nodes, depth + 1))
    }
    let mut names = HashSet::new();
    let mut nodes = MAX_NODES_PER_VALUE;
    if !collect(arguments, &mut names, &mut nodes, 0) {
        return None;
    }
    names.into_iter().next()
}

#[cfg(test)]
mod tests;
