//! What earlier tool results in the chat say about the IDs a call names: the
//! name of the record an ID stands for, and the values its fields held. Read
//! by code from results. What the model wrote into a call never names a
//! record, a lookup's `name` included; the one exception is the name a create
//! call gave the record its result reports. Names stay with the MCP server
//! whose result gave them, and never reach a recipient, an address, a phone
//! number or a link.

use super::arguments::{MAX_ID_CHARS, MAX_LIST_ENTRIES, looks_like_a_uuid, names_an_id};
use super::change::{Unwrapped, is_plural, unwrap};
use super::pointer;
use super::recipients::{is_phone_shaped, is_recipient_member};
use super::rules;
use super::{MAX_LABEL_VALUE_BYTES, MAX_LABEL_VALUE_CHARS};
use crate::models::message::{
    ContentPart, GenerationInputMessages, MessageRole, ToolCallAction, ToolCallLabel,
    ToolCallLabelItem, ToolCallStatus, ToolUse,
};
use crate::services::display_text::{MAX_DISPLAY_NAME_CHARS, sanitize_display_text};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::ops::ControlFlow;
use std::sync::Arc;
use unicode_normalization::UnicodeNormalization;

/// Records kept for one turn; the ones seen least recently go first.
pub const MAX_RECORDS: usize = 500;
pub const MAX_RECORDS_PER_RESULT: usize = 200;
pub const MAX_FIELDS_PER_RECORD: usize = 64;
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
    /// Calls whose latest decision part in the stored row is an approval.
    approved: HashSet<String>,
    /// Estimated size of `records`, kept under [`MAX_INDEX_BYTES`].
    bytes: usize,
    /// Who counts as inside the organisation for this chat's user.
    organization: Option<OrganizationDomains>,
}

/// Mail providers anyone can sign up with: an address there says nothing about
/// which organisation a person belongs to.
const PUBLIC_MAIL_DOMAINS: [&str; 20] = [
    "gmail.com",
    "googlemail.com",
    "outlook.com",
    "hotmail.com",
    "live.com",
    "msn.com",
    "yahoo.com",
    "icloud.com",
    "me.com",
    "mac.com",
    "aol.com",
    "proton.me",
    "protonmail.com",
    "gmx.de",
    "gmx.net",
    "web.de",
    "t-online.de",
    "mail.com",
    "yandex.com",
    "zoho.com",
];

fn normalized_domain(domain: &str) -> String {
    domain
        .trim()
        .trim_start_matches('@')
        .trim_matches('.')
        .to_ascii_lowercase()
}

/// The signed-in user's email domain and the operator's extra ones.
#[derive(Debug, Clone, Default)]
struct OrganizationDomains {
    domains: Vec<String>,
}

impl OrganizationDomains {
    /// A subdomain counts: only the domain's owner can issue one.
    fn holds(&self, domain: &str) -> bool {
        let domain = normalized_domain(domain);
        self.domains.iter().any(|known| {
            domain == *known
                || domain
                    .strip_suffix(known.as_str())
                    .is_some_and(|rest| rest.ends_with('.'))
        })
    }
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
pub(super) struct Record {
    name: Option<String>,
    fields: HashMap<String, String>,
    /// Fields that held a list.
    lists: HashMap<String, RecordList>,
    /// A non-UUID ID that named two different things: it resolves to nothing.
    ambiguous: bool,
}

impl Record {
    pub(super) fn field(&self, member: &str) -> Option<String> {
        self.fields.get(member).cloned()
    }

    pub(super) fn list(&self, member: &str) -> Option<&RecordList> {
        self.lists.get(member)
    }
}

/// A list a result showed. `complete` says every entry was read.
#[derive(Debug, Clone, Default)]
pub(super) struct RecordList {
    pub entries: Vec<ListEntry>,
    pub complete: bool,
}

/// One entry of a list, by what a person calls it and, where it has one, by
/// its own ID, so a list of names compares with a list of IDs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ListEntry {
    pub text: String,
    pub id: Option<String>,
}

const LIST_NAME_KEYS: [&str; 8] = [
    "name",
    "title",
    "label",
    "displayname",
    "login",
    "key",
    "value",
    "email",
];

/// An entry of a list as text: an object by its name or label, a wrapper by
/// what it holds. `None` when it cannot be read.
pub(super) fn list_entry(value: &Value) -> Option<ListEntry> {
    if let Value::Object(members) = value {
        let scalar = |keys: &[&str]| {
            keys.iter().find_map(|key| {
                members
                    .iter()
                    .find(|(member, _)| member.eq_ignore_ascii_case(key))
                    .and_then(|(_, value)| scalar_text(value))
            })
        };
        let id = scalar(&["id"]);
        if let Some(text) = scalar(&LIST_NAME_KEYS) {
            return Some(ListEntry { text, id });
        }
        if let Some(text) = id {
            return Some(ListEntry {
                id: Some(text.clone()),
                text,
            });
        }
    }
    match unwrap(value, false) {
        Unwrapped::Scalar(scalar) => scalar_text(scalar).map(|text| ListEntry { text, id: None }),
        _ => None,
    }
}

/// Whether two list entries are the same thing, by name or by ID.
pub(super) fn list_entries_match(a: &ListEntry, b: &ListEntry) -> bool {
    a.text == b.text
        || a.id.is_some() && a.id == b.id
        || a.id.as_deref() == Some(b.text.as_str())
        || b.id.as_deref() == Some(a.text.as_str())
}

impl ToolResultContext {
    /// Records who counts as inside the organisation for this chat's user:
    /// `user_email`'s domain plus `extra_domains`. With no user domain, or one
    /// of a public mail provider, nothing is known, whatever is configured,
    /// so no card claims none are outside.
    pub fn with_organization(mut self, user_email: Option<&str>, extra_domains: &[String]) -> Self {
        let own = user_email
            .and_then(|email| email.rsplit_once('@'))
            .map(|(_, domain)| normalized_domain(domain))
            .filter(|domain| !domain.is_empty() && !PUBLIC_MAIL_DOMAINS.contains(&domain.as_str()));
        self.organization = own.map(|own| {
            let mut domains = vec![own];
            domains.extend(
                extra_domains
                    .iter()
                    .map(|domain| normalized_domain(domain))
                    .filter(|domain| !domain.is_empty()),
            );
            OrganizationDomains { domains }
        });
        self
    }

    pub(super) fn organization_domains(&self) -> Option<()> {
        self.organization.as_ref().map(|_| ())
    }

    /// Whether `domain` is the user's own or a configured one.
    pub(super) fn is_inside_organization(&self, domain: &str) -> bool {
        self.organization
            .as_ref()
            .is_some_and(|organization| organization.holds(domain))
    }

    /// The tool results a turn's generation input replays, the most recent
    /// [`MAX_CALLS_READ`] calls only. After a chat-history compaction none are
    /// left, so names read before it are misses.
    pub fn from_messages(source: &GenerationInputMessages) -> Self {
        Self::from_messages_and_row(source, &[])
    }

    /// As [`Self::from_messages`], for a `source` that ends with the replay of
    /// the stored `row`. Replay drops the row's decision parts, which tell a
    /// call approved on a card from one Erato refused, so they come from `row`.
    pub fn from_messages_and_row(source: &GenerationInputMessages, row: &[ContentPart]) -> Self {
        let mut context = Self::default();
        context.note_decisions(row);
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

    /// As [`Self::observe`] on an index label jobs may share: copied only
    /// when `content` holds something unread, so each job keeps the index
    /// as its call saw it.
    pub fn observe_shared(context: &mut Arc<Self>, content: &[ContentPart]) {
        if context.has_unread(content) {
            Arc::make_mut(context).observe(content);
        }
    }

    /// Whether [`Self::observe`] would change anything for `content`.
    fn has_unread(&self, content: &[ContentPart]) -> bool {
        content.iter().any(|part| match part {
            ContentPart::ToolApproval(approval) => !self.approved.contains(&approval.tool_call_id),
            ContentPart::ToolRejection(rejection) => {
                self.approved.contains(&rejection.tool_call_id)
            }
            ContentPart::ToolUse(tool) => {
                !tool.tool_call_id.is_empty()
                    && is_settled(tool)
                    && !self.seen.contains(&tool.tool_call_id)
            }
            _ => false,
        })
    }

    /// Reads the running turn's calls that have settled since the last look.
    pub fn observe(&mut self, content: &[ContentPart]) {
        self.note_decisions(content);
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
    /// stays `None`, and so does every value below a recipient member, every
    /// ID shaped like a phone number and every value past
    /// [`MAX_RESOLVED_BYTES`] of resolved text.
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

    /// The one record an item's `id` names, if a result reported it.
    pub(super) fn record_of_item(
        &self,
        item: &ToolCallLabelItem,
        arguments: &Value,
        server: &str,
    ) -> Option<&Record> {
        item.id
            .as_ref()
            .filter(|slot| slot.omitted == 0)
            .and_then(|slot| match slot.values.as_slice() {
                [only] => self.record_at(arguments, &only.path, server),
                _ => None,
            })
    }

    /// The record a result reported under `id` itself.
    pub(super) fn record_by_id(&self, server: &str, id: &str) -> Option<&Record> {
        self.record(server, text_key(id)?)
    }

    /// What a result calls the record `id` stands for.
    pub(super) fn name_of_id(&self, server: &str, id: &str) -> Option<&str> {
        self.record(server, text_key(id)?)?.name.as_deref()
    }

    fn note_decisions(&mut self, content: &[ContentPart]) {
        for part in content {
            match part {
                ContentPart::ToolApproval(approval) => {
                    self.approved.insert(approval.tool_call_id.clone());
                }
                ContentPart::ToolRejection(rejection) => {
                    self.approved.remove(&rejection.tool_call_id);
                }
                _ => {}
            }
        }
    }

    /// A call Erato itself turned down (the user denied it, a gate refused it,
    /// the budget ran out) never reached its server. Erato writes exactly
    /// `{status: "rejected", error: <text>}`, never with `allowed_by`. A call
    /// that ran may get the same shape from its server: with `allowed_by` or
    /// an approval it counts as ran. Earlier turns replay without their
    /// decision parts, so there a card-approved call stays ambiguous and
    /// counts as refused.
    fn is_refused_by_erato(&self, tool: &ToolUse) -> bool {
        tool.allowed_by.is_none()
            && !self.approved.contains(&tool.tool_call_id)
            && tool.status == ToolCallStatus::Error
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
        let reached = reached?;
        self.record(server, id_key(reached)?)
            .or_else(|| self.read_record(arguments, path, reached, server))
    }

    /// The record an earlier read of this same member and value, in the same
    /// place, returned: `get_issue {repo, issue_number: 4211}` is about the
    /// record `update_issue {repo, issue_number: 4211}` changes, though a bare
    /// 4211 could be anything.
    fn read_record(
        &self,
        arguments: &Value,
        path: &str,
        id: &Value,
        server: &str,
    ) -> Option<&Record> {
        let member = pointer::member_names(path);
        let [member] = member.as_slice() else {
            return None;
        };
        self.records
            .get(&RecordKey::new(
                server,
                qualified_key(arguments, member, id)?,
            ))
            .filter(|record| !record.ambiguous)
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
        if self.is_refused_by_erato(tool) {
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
                self.read_named_record(tool.input.as_ref(), output, server, &mut walk);
            }
            None => {}
        }
    }

    /// A read that names one record by one ID, and returns one object: that
    /// object is the record, under the ID as the read named it.
    fn read_named_record(
        &mut self,
        input: Option<&Value>,
        output: &Value,
        server: &str,
        walk: &mut Walk,
    ) {
        let (Some(input), Some(mut object)) = (input, output.as_object()) else {
            return;
        };
        if let [only] = object.values().collect::<Vec<_>>().as_slice()
            && let Some(inner) = only.as_object()
        {
            object = inner;
        }
        let Some((id, key)) = one_named_id(input) else {
            return;
        };
        // Without the ID echoed back, the object may be about anything else.
        if !object
            .values()
            .any(|value| id_key(value).as_deref() == Some(id.as_str()))
        {
            return;
        }
        let name = name_of(object);
        let (fields, lists) = values_of(object, "", walk);
        if name.is_some() || !fields.is_empty() || !lists.is_empty() {
            self.merge(RecordKey::new(server, key), name, fields, lists);
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
                    let (fields, lists) = values_of(object, member, walk);
                    if name.is_some() || !fields.is_empty() || !lists.is_empty() {
                        walk.records -= 1;
                        self.merge(RecordKey::new(server, key), name, fields, lists);
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
            let named = ids.contains(&key.id)
                || qualified_value(&key.id).is_some_and(|id| ids.contains(id));
            if (!record.fields.is_empty() || !record.lists.is_empty()) && named {
                let before = record_bytes(key, record);
                record.fields.clear();
                record.lists.clear();
                let after = record_bytes(key, record);
                self.bytes = self.bytes.saturating_sub(before - after);
            }
        }
    }

    fn retire_all(&mut self) {
        for record in self.records.values_mut() {
            record.fields.clear();
            record.lists.clear();
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
            self.merge(
                RecordKey::new(server, key),
                Some(name),
                HashMap::new(),
                HashMap::new(),
            );
        }
    }

    fn merge(
        &mut self,
        key: RecordKey,
        name: Option<String>,
        fields: HashMap<String, String>,
        lists: HashMap<String, RecordList>,
    ) {
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
                    for (member, entries) in lists {
                        if record.lists.len() < MAX_FIELDS_PER_RECORD
                            || record.lists.contains_key(&member)
                        {
                            record.lists.insert(member, entries);
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
                    lists,
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
    let lists: usize = record
        .lists
        .iter()
        .map(|(member, list)| {
            OVERHEAD
                + member.len()
                + list
                    .entries
                    .iter()
                    .map(|entry| entry.text.len() + entry.id.as_ref().map_or(0, String::len))
                    .sum::<usize>()
        })
        .sum();
    OVERHEAD
        + key.server.len()
        + key.id.len()
        + record.name.as_ref().map_or(0, String::len)
        + fields
        + lists
}

/// Separates the parts of a member-qualified record key; no ID holds it.
const QUALIFIED_SEPARATOR: char = '\u{1f}';

/// The ID a call's arguments name a record by, when they name just one, and
/// the key that record is kept under. Members naming a place are the key's
/// scope; a recipient, address or phone number is never an ID.
fn one_named_id(arguments: &Value) -> Option<(String, String)> {
    let top = arguments.as_object()?;
    let mut ids = top.iter().filter(|(member, value)| {
        matches!(value, Value::String(_) | Value::Number(_))
            && (names_an_id(member) || is_any_of(member, &rules::ID_MEMBERS))
            && !is_any_of(member, &rules::TARGET_MEMBERS)
            && !is_any_of(member, &rules::PLACE_MEMBERS)
            && !is_recipient_member(member)
    });
    let (member, value) = ids.next()?;
    if ids.next().is_some() {
        return None;
    }
    Some((id_key(value)?, qualified_key(arguments, member, value)?))
}

fn is_any_of(member: &str, names: &[&str]) -> bool {
    names.iter().any(|name| member.eq_ignore_ascii_case(name))
}

fn qualified_key(arguments: &Value, member: &str, id: &Value) -> Option<String> {
    if is_recipient_member(member) {
        return None;
    }
    let id = id_key(id)?;
    if is_phone_shaped(&id) || id.contains('@') || id.contains("://") {
        return None;
    }
    let top = arguments.as_object()?;
    let mut scope: Vec<String> = top
        .iter()
        .filter(|(name, _)| {
            name.as_str() != member
                && (is_any_of(name, &rules::PLACE_MEMBERS)
                    || is_any_of(name, &rules::TARGET_MEMBERS)
                    || name.eq_ignore_ascii_case("owner"))
        })
        .filter_map(|(name, value)| {
            Some(format!(
                "{}={}",
                name.to_ascii_lowercase(),
                scalar_text(value)?
            ))
        })
        .collect();
    scope.sort_unstable();
    Some(format!(
        "{}{sep}{id}{sep}{}",
        member.to_ascii_lowercase(),
        scope.join("&"),
        sep = QUALIFIED_SEPARATOR
    ))
}

/// The ID inside a member-qualified key.
fn qualified_value(key: &str) -> Option<&str> {
    let mut parts = key.split(QUALIFIED_SEPARATOR);
    parts.next();
    let id = parts.next()?;
    parts.next().map(|_| id)
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
    if let Some(change) = label.change.as_mut() {
        super::change::forget_earlier(change);
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

/// IDs the index never holds. Digits, of any script: every table numbers its
/// own records, so `7` could be anything. Addresses, phone numbers and links:
/// a call writing one must show it as written, never as a name a result gave
/// it.
fn indexable(id: &str) -> bool {
    const LINK_PREFIXES: [&str; 6] = ["mailto:", "tel:", "sms:", "data:", "javascript:", "www."];
    let link_prefix = |prefix: &&str| {
        id.get(..prefix.len())
            .is_some_and(|start| start.eq_ignore_ascii_case(prefix))
    };
    !id.nfkc().all(char::is_numeric)
        && !is_phone_shaped(id)
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
pub(super) fn text_prefix(text: &str, max_bytes: usize) -> &str {
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
/// A record's values, by member: scalars and lists, read through the wrappers
/// servers put around them, and one level of nested objects such as
/// `properties` or `fields`.
fn values_of(
    object: &Map<String, Value>,
    id_member: &str,
    walk: &mut Walk,
) -> (HashMap<String, String>, HashMap<String, RecordList>) {
    let mut fields = HashMap::new();
    let mut lists = HashMap::new();
    let mut nested = Vec::new();
    for (member, value) in object {
        if fields.len() == MAX_FIELDS_PER_RECORD {
            return (fields, lists);
        }
        if member == id_member || member.chars().nth(MAX_DISPLAY_NAME_CHARS).is_some() {
            continue;
        }
        if let Value::Object(inner) = value {
            if !walk.take(inner.len()) {
                break;
            }
            // Only a pure link stands for its ID: `properties` holding one
            // `*_id` among its values is the record's values, not a link.
            match link_id_member(inner) {
                Some(link) => {
                    if let Some(text) = inner.get(link).and_then(scalar_text) {
                        fields.insert(member.clone(), text);
                    }
                }
                None => match record_value(member, value) {
                    Some(RecordValue::Unread) | None => nested.push(inner),
                    Some(read) => read.keep(member, &mut fields, &mut lists),
                },
            }
            continue;
        }
        if let Some(read) = record_value(member, value) {
            read.keep(member, &mut fields, &mut lists);
        }
    }
    for (member, value) in nested.into_iter().flatten() {
        if fields.len() == MAX_FIELDS_PER_RECORD {
            break;
        }
        if member.chars().nth(MAX_DISPLAY_NAME_CHARS).is_none()
            && !fields.contains_key(member)
            && !lists.contains_key(member)
            && let Some(read) = record_value(member, value)
        {
            read.keep(member, &mut fields, &mut lists);
        }
    }
    (fields, lists)
}

/// One value of a record, past its wrappers.
enum RecordValue {
    Text(String),
    List(RecordList),
    /// An object or list none of whose shapes this reads.
    Unread,
}

impl RecordValue {
    fn keep(
        self,
        member: &str,
        fields: &mut HashMap<String, String>,
        lists: &mut HashMap<String, RecordList>,
    ) {
        match self {
            Self::Text(text) => {
                fields.insert(member.to_string(), text);
            }
            Self::List(entries) => {
                lists.insert(member.to_string(), entries);
            }
            Self::Unread => {}
        }
    }
}

fn record_value(member: &str, value: &Value) -> Option<RecordValue> {
    match unwrap(value, is_plural(member)) {
        Unwrapped::Empty if value.is_array() => Some(RecordValue::List(RecordList {
            entries: Vec::new(),
            complete: true,
        })),
        Unwrapped::Empty => None,
        Unwrapped::Scalar(scalar) => scalar_text(scalar).map(RecordValue::Text),
        Unwrapped::List(entries) => {
            let total = entries.len();
            let read: Vec<ListEntry> = entries
                .into_iter()
                .take(MAX_LIST_ENTRIES)
                .filter_map(list_entry)
                .collect();
            Some(RecordValue::List(RecordList {
                complete: read.len() == total,
                entries: read,
            }))
        }
        Unwrapped::Other => Some(RecordValue::Unread),
    }
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
pub(super) fn is_link(object: &Map<String, Value>) -> bool {
    if object.len() > 1 + NAME_KEYS.len() + LINK_TYPE_KEYS.len() {
        return false;
    }
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

/// A member that names the record a link points at, such as a lookup's `name`.
pub(super) fn is_name_member(member: &str) -> bool {
    NAME_KEYS.iter().any(|key| member.eq_ignore_ascii_case(key))
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
