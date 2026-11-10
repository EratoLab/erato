//! What earlier tool results in the chat say about the IDs a call names: the
//! name of the record an ID stands for, and the values its fields held. Read
//! by code from results. What the model wrote into a call never names a
//! record, a lookup's `name` included; the one exception is the name a create
//! call gave the record its result reports. Names stay with the MCP server
//! whose result gave them, and never reach a recipient, an address, a phone
//! number or a link.

use super::arguments::{MAX_ID_CHARS, MAX_LIST_ENTRIES, looks_like_a_uuid, names_an_id};
use super::change::{Unwrapped, is_plural, unwrap, wrapped_value};
use super::choices::{Said, choice_label, described_list, is_choice_code};
use super::machine_id::{id_inside_a_link_path, is_machine_id};
use super::pointer;
use super::recipients::{is_phone_shaped, is_recipient_member};
use super::rules;
use super::{MAX_LABEL_VALUE_BYTES, MAX_LABEL_VALUE_CHARS};
use crate::models::message::{
    ContentPart, GenerationInputMessages, MessageRole, ToolCallAction, ToolCallLabel,
    ToolCallLabelItem, ToolCallStatus, ToolUse,
};
use crate::services::display_text::{MAX_DISPLAY_NAME_CHARS, sanitize_display_text};
use crate::services::prompt_composition::replay_policy;
use serde_json::{Map, Value};
use std::collections::{BTreeSet, HashMap, HashSet, VecDeque};
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
    /// Which read a record's values came from, so a code's label is only taken
    /// from the same read: another table may number its choices differently.
    reads: u32,
    /// Every ID any successful result in the chat held, as a hash of its
    /// lookup key, whether or not the index keeps a record for it.
    seen_ids: HashSet<u64>,
    /// Some result went unread or was read only in part, so an ID missing
    /// from `seen_ids` may still have been read.
    partial: bool,
    /// Labels reads gave codes outside any record, oldest first.
    vocabularies: VecDeque<Vocabulary>,
    /// Estimated size of `vocabularies`, kept under [`MAX_VOCABULARY_BYTES`].
    vocabulary_bytes: usize,
    /// The tables this chat's calls named, lower case: a read naming one of
    /// them besides a write's own table may be about either.
    tables: HashSet<String>,
}

/// Labels for codes a read listed apart from any record: a table's option
/// sets, from a description of the table or its field metadata, or a list of
/// options such as the transitions an issue can take.
#[derive(Debug, Clone)]
struct Vocabulary {
    server: String,
    scope: VocabularyScope,
    /// Code to label by member; a list of options keeps its labels under
    /// the empty member. `None` where one read gave a member two lists.
    members: HashMap<String, Option<HashMap<String, String>>>,
    bytes: usize,
}

/// Which calls a vocabulary speaks for.
#[derive(Debug, Clone, PartialEq, Eq)]
enum VocabularyScope {
    /// The words of the read's arguments: a call's table must be one of them.
    Table(BTreeSet<String>),
    /// The read's arguments, which a call must repeat, and the nouns its
    /// name and list wrapper end in, one of which must name the call's member.
    List {
        arguments: Vec<(String, String)>,
        nouns: Vec<String>,
    },
}

/// Vocabularies kept for one turn and what they may hold; the oldest go first.
const MAX_VOCABULARIES: usize = 32;
const MAX_VOCABULARY_BYTES: usize = 512 * 1024;
const MAX_VOCABULARY_MEMBERS: usize = 512;
/// Options a member or a list may have; a longer list says nothing.
const MAX_OPTIONS: usize = 256;
/// Bytes of a text result read for option sets, and of one line of it.
const MAX_DESCRIBED_BYTES: usize = 128 * 1024;
const MAX_DESCRIBED_LINE_BYTES: usize = 16 * 1024;
/// A read naming more words than this is no read of one table, and one with
/// more arguments than this no list for one place.
const MAX_SCOPE_WORDS: usize = 64;
const MAX_LIST_ARGUMENTS: usize = 16;
const MAX_TABLES: usize = 256;
/// Members a table names its option sets by in field metadata, and holds them in.
const OPTION_FIELD_NAME_KEYS: [&str; 4] = ["name", "logicalname", "apiname", "key"];
const OPTION_SET_KEYS: [&str; 4] = ["options", "picklistvalues", "choices", "enum"];
/// An entry of a list of options: one code, one label, and nothing but
/// these besides.
const OPTION_CODE_KEYS: [&str; 4] = ["id", "code", "value", "key"];
const OPTION_LABEL_KEYS: [&str; 3] = ["name", "label", "title"];
const OPTION_EXTRA_KEYS: [&str; 4] = ["color", "description", "type", "order"];
/// What a row calls a column's label beside the column `X` itself.
const LABEL_SIBLING_SUFFIXES: [&str; 5] = [
    "name",
    "_name",
    "label",
    "_label",
    "@odata.community.display.v1.formattedvalue",
];

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
    /// Fields written as a label with its code, such as `{"name": "Low", "value": 4}`.
    coded: HashMap<String, CodedValue>,
    /// A non-UUID ID that named two different things: it resolves to nothing.
    ambiguous: bool,
    /// The read that last reported this record.
    read: u32,
}

/// A field's value as an earlier result wrote it with its label.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct CodedValue {
    pub code: String,
    pub label: String,
    /// The result wrote the code as a JSON number.
    pub numeric: bool,
}

impl Record {
    pub(super) fn list(&self, member: &str) -> Option<&RecordList> {
        self.lists.get(member)
    }

    pub(super) fn coded(&self, member: &str) -> Option<&CodedValue> {
        self.coded.get(member)
    }

    /// The field an earlier result kept under exactly `member`. Another
    /// field is never taken for it: a call's `state` may be an address's
    /// state as well as a record's `status`.
    pub(super) fn field(&self, member: &str) -> Option<&String> {
        self.fields.get(member)
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
    /// left, so names read before it are misses, and no ID counts as never
    /// read.
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
        context.partial |= first_read > 0 || opens_after_the_first_turn(source);
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

    /// Marks a chat spawned from another one, such as a task's run, whose
    /// cards the other chat may show: what that chat read is not in this
    /// one's replay, so no ID counts as never read.
    pub fn spawned_from_another_chat(mut self, spawned: bool) -> Self {
        self.partial |= spawned;
        self
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

    /// The label `code` has for `member` in the read that reported `record`.
    /// Scoped to one read: another table may number the same member
    /// differently. Two labels for the code in that read are a conflict.
    pub(super) fn earlier_choice_label(
        &self,
        server: &str,
        record: &Record,
        member: &str,
        code: &str,
    ) -> Said {
        let mut said = Said::Nothing;
        for (key, other) in &self.records {
            if key.server != server || other.read != record.read {
                continue;
            }
            if let Some(coded) = other.coded.get(member).filter(|coded| coded.code == code) {
                said = said.and(Said::Label(coded.label.clone()));
            }
        }
        said
    }

    /// What the newest read about `table` that listed `member`'s options says
    /// `code` means: a read of `server` whose arguments hold the table as a
    /// word and no other table this chat's calls named.
    pub(super) fn table_choice_label(
        &self,
        server: &str,
        table: &str,
        member: &str,
        code: &str,
    ) -> Said {
        let table = table.to_lowercase();
        for vocabulary in self.vocabularies.iter().rev() {
            let VocabularyScope::Table(words) = &vocabulary.scope else {
                continue;
            };
            let about_the_table = vocabulary.server == server
                && words.contains(&table)
                && !words
                    .iter()
                    .any(|word| *word != table && self.tables.contains(word));
            if !about_the_table {
                continue;
            }
            if let Some(options) = vocabulary.members.get(member) {
                return match options {
                    Some(options) => Said::from(options.get(code).cloned()),
                    None => Said::Conflict,
                };
            }
        }
        Said::Nothing
    }

    /// What the lists of options a read of `server` returned say `code` of
    /// `member` means for a call with `arguments`: lists whose read's every
    /// argument the call repeats with the same value, and whose read's name
    /// or list wrapper ends in what the member picks, `transitions` for
    /// `transition_id`. Lists that disagree say nothing.
    pub(super) fn listed_choice_label(
        &self,
        server: &str,
        arguments: &Value,
        member: &str,
        code: &str,
    ) -> Said {
        let (Some(noun), Some(call)) = (member_noun(member), arguments.as_object()) else {
            return Said::Nothing;
        };
        let mut said = Said::Nothing;
        for vocabulary in &self.vocabularies {
            let VocabularyScope::List {
                arguments: read,
                nouns,
            } = &vocabulary.scope
            else {
                continue;
            };
            let repeated = read
                .iter()
                .all(|(name, value)| call.get(name).and_then(scalar_text).as_ref() == Some(value));
            if vocabulary.server != server
                || !repeated
                || !nouns.iter().any(|word| same_noun(word, &noun))
            {
                continue;
            }
            if let Some(Some(options)) = vocabulary.members.get("") {
                said = said.and(Said::from(options.get(code).cloned()));
            }
        }
        said
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
            self.vocabularies.clear();
            self.vocabulary_bytes = 0;
            self.partial = true;
        }
    }

    /// Whether no result in this chat held the ID at `path`, as far as every
    /// result was read whole: only then may a card say the record it names
    /// was not read here. A value below a recipient is never such an ID.
    pub(super) fn never_read(&self, arguments: &Value, path: &str) -> bool {
        if self.partial || below_a_recipient(path) {
            return false;
        }
        let mut reached = None;
        pointer::visit(arguments, path, |_, value| {
            reached = Some(value);
            ControlFlow::Break(())
        });
        reached
            .and_then(id_key)
            .is_some_and(|key| !self.seen_ids.contains(&id_hash(&key)))
    }

    /// Notes every ID a result holds, in its values, its member names and
    /// the text it holds, so a card never says an ID was not read when a
    /// result showed it in any form.
    fn note_seen_ids(&mut self, output: &Value) {
        let mut scan = IdScan {
            nodes: MAX_ID_SCAN_NODES,
            bytes: MAX_ID_SCAN_TOTAL_BYTES,
        };
        let mut found = Vec::new();
        let whole = result_ids(output, &mut found, &mut scan, 0);
        for key in found {
            if self.seen_ids.len() >= MAX_SEEN_IDS {
                self.partial = true;
                return;
            }
            self.seen_ids.insert(id_hash(&key));
        }
        self.partial |= !whole;
    }

    fn read_settled(&mut self, tool: &ToolUse) {
        self.note_table(tool.input.as_ref());
        // A receipt keeps a few fields of what the result held; an ID it
        // dropped may have been read.
        self.partial |= tool.output.as_ref().is_some_and(is_a_receipt);
        if self.is_refused_by_erato(tool) {
            return;
        }
        self.reads = self.reads.wrapping_add(1);
        // A task's child may have changed any record, and what its tools
        // returned stays in the child's chat.
        if crate::services::delegation::is_delegation_tool_name(&tool.tool_name) {
            self.retire_all();
            self.partial = true;
            return;
        }
        if tool.status == ToolCallStatus::Success
            && let Some(output) = &tool.output
        {
            self.note_seen_ids(output);
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
            Some(Value::String(text)) => {
                self.read_created(tool, text, server);
                self.read_described_options(tool, text, server);
            }
            Some(output) => {
                let words = words(tool.input.as_ref());
                let mut walk = Walk {
                    nodes: MAX_NODES_PER_VALUE,
                    records: MAX_RECORDS_PER_RESULT,
                };
                self.read_node(output, server, &words, &mut walk, 0);
                self.read_named_record(tool.input.as_ref(), output, server, &mut walk);
                self.read_option_list(tool, output, server);
                self.read_field_options(tool, output, server);
            }
            None => {}
        }
    }

    /// Notes the table a call names, as [`call_table`] reads it.
    fn note_table(&mut self, arguments: Option<&Value>) {
        if self.tables.len() < MAX_TABLES
            && let Some(table) = arguments.and_then(call_table)
        {
            self.tables.insert(table);
        }
    }

    /// Option sets a text result lists one per line, as a table description's
    /// `priority CHOICE (Options: Low (0), Normal (1), High (2))`: a line
    /// opening with the member's name, the codes and labels after it.
    fn read_described_options(&mut self, tool: &ToolUse, text: &str, server: &str) {
        let Some(words) = table_scope(tool.input.as_ref()) else {
            return;
        };
        let mut members = HashMap::new();
        for line in text_prefix(text, MAX_DESCRIBED_BYTES).lines() {
            if line.len() > MAX_DESCRIBED_LINE_BYTES {
                continue;
            }
            let Some((member, rest)) = leading_member(line) else {
                continue;
            };
            if let Some(options) = described_list(rest, MAX_OPTIONS) {
                add_options(&mut members, member, options);
            }
        }
        self.keep_vocabulary(server, VocabularyScope::Table(words), members);
    }

    /// Option sets a JSON result holds as field metadata, an object naming
    /// its member beside `options`, `picklistValues`, `choices` or `enum`
    /// that list `{value, label}` entries.
    fn read_field_options(&mut self, tool: &ToolUse, output: &Value, server: &str) {
        fn walk(
            value: &Value,
            members: &mut HashMap<String, Option<HashMap<String, String>>>,
            nodes: &mut usize,
            depth: usize,
        ) {
            if *nodes == 0 || depth > MAX_DEPTH {
                return;
            }
            *nodes -= 1;
            match value {
                Value::Object(object) => {
                    // Every member is looked at, so an object costs its width.
                    let Some(left) = nodes.checked_sub(object.len()) else {
                        *nodes = 0;
                        return;
                    };
                    *nodes = left;
                    if let Some((member, options)) = field_options(object) {
                        add_options(members, member, options);
                        return;
                    }
                    for child in object.values().filter(|child| is_container(child)) {
                        walk(child, members, nodes, depth + 1);
                    }
                }
                Value::Array(entries) => {
                    for entry in entries.iter().filter(|entry| is_container(entry)) {
                        walk(entry, members, nodes, depth + 1);
                    }
                }
                _ => {}
            }
        }
        let Some(words) = table_scope(tool.input.as_ref()) else {
            return;
        };
        let mut members = HashMap::new();
        let mut nodes = MAX_NODES_PER_VALUE;
        walk(output, &mut members, &mut nodes, 0);
        self.keep_vocabulary(server, VocabularyScope::Table(words), members);
    }

    /// A result that is a list of options, or one member holding one: two or
    /// more small objects, each one code and one label, such as an issue's
    /// `[{"id": "31", "name": "Done"}]` transitions.
    fn read_option_list(&mut self, tool: &ToolUse, output: &Value, server: &str) {
        let (wrapper, entries) = match output {
            Value::Array(entries) => (None, entries),
            Value::Object(object) if object.len() == 1 => match object.iter().next() {
                Some((wrapper, Value::Array(entries))) => (Some(wrapper.as_str()), entries),
                _ => return,
            },
            _ => return,
        };
        let Some(options) = option_list(entries) else {
            return;
        };
        let arguments = match tool.input.as_ref() {
            None => Vec::new(),
            Some(Value::Object(input)) if input.len() <= MAX_LIST_ARGUMENTS => {
                let read: Option<Vec<_>> = input
                    .iter()
                    .map(|(name, value)| {
                        let text = match value {
                            Value::String(_) | Value::Number(_) | Value::Bool(_) => {
                                scalar_text(value)?
                            }
                            _ => return None,
                        };
                        (text.len() <= MAX_ID_CHARS).then(|| (name.clone(), text))
                    })
                    .collect();
                let Some(read) = read else {
                    return;
                };
                read
            }
            Some(_) => return,
        };
        // What the list holds, never the read's verb or what qualifies it:
        // `statuses` in `list_project_statuses`, not `list` or `project`. A
        // wrapper such as `items` or `data` says only that it holds a list.
        let mut nouns: Vec<String> = head_noun(&tool.tool_name).into_iter().collect();
        nouns.extend(wrapper.and_then(head_noun).filter(|noun| {
            !rules::WRAPPER_MEMBERS
                .iter()
                .any(|bag| same_noun(bag, noun))
        }));
        nouns.sort_unstable();
        nouns.dedup();
        let members = HashMap::from([(String::new(), Some(options))]);
        self.keep_vocabulary(server, VocabularyScope::List { arguments, nouns }, members);
    }

    /// Keeps what one read listed, in place of what an older read listed for
    /// the same scope.
    fn keep_vocabulary(
        &mut self,
        server: &str,
        scope: VocabularyScope,
        members: HashMap<String, Option<HashMap<String, String>>>,
    ) {
        if members.is_empty() {
            return;
        }
        if let Some(at) = self
            .vocabularies
            .iter()
            .position(|kept| kept.server == server && kept.scope == scope)
            && let Some(old) = self.vocabularies.remove(at)
        {
            self.vocabulary_bytes = self.vocabulary_bytes.saturating_sub(old.bytes);
        }
        let bytes = vocabulary_bytes(server, &scope, &members);
        self.vocabularies.push_back(Vocabulary {
            server: server.to_string(),
            scope,
            members,
            bytes,
        });
        self.vocabulary_bytes = self.vocabulary_bytes.saturating_add(bytes);
        while self.vocabularies.len() > MAX_VOCABULARIES
            || (self.vocabulary_bytes > MAX_VOCABULARY_BYTES && self.vocabularies.len() > 1)
        {
            if let Some(oldest) = self.vocabularies.pop_front() {
                self.vocabulary_bytes = self.vocabulary_bytes.saturating_sub(oldest.bytes);
            }
        }
        if self.vocabulary_bytes > MAX_VOCABULARY_BYTES {
            self.vocabularies.clear();
            self.vocabulary_bytes = 0;
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
        let values = values_of(object, "", walk);
        let name = name_of(object).or_else(|| values.wrapped_name());
        if name.is_some() || !values.is_empty() {
            self.merge(RecordKey::new(server, key), name, values);
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
                    let values = values_of(object, member, walk);
                    let name = name_of(object).or_else(|| values.wrapped_name());
                    if name.is_some() || !values.is_empty() {
                        walk.records -= 1;
                        self.merge(RecordKey::new(server, key), name, values);
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
                record.coded.clear();
                let after = record_bytes(key, record);
                self.bytes = self.bytes.saturating_sub(before - after);
            }
        }
    }

    fn retire_all(&mut self) {
        for record in self.records.values_mut() {
            record.fields.clear();
            record.lists.clear();
            record.coded.clear();
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
                ReadValues::default(),
            );
        }
    }

    fn merge(&mut self, key: RecordKey, name: Option<String>, values: ReadValues) {
        if !indexable(&key.id) {
            return;
        }
        let ReadValues {
            fields,
            lists,
            coded,
            ..
        } = values;
        let read = self.reads;
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
                    // A code an older read gave a field would stand beside
                    // the value this read gives it.
                    for member in fields.keys().chain(lists.keys()) {
                        if !coded.contains_key(member) {
                            record.coded.remove(member);
                        }
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
                    for (member, value) in coded {
                        if record.coded.len() < MAX_FIELDS_PER_RECORD
                            || record.coded.contains_key(&member)
                        {
                            record.coded.insert(member, value);
                        }
                    }
                    record.read = read;
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
                    coded,
                    ambiguous: false,
                    read,
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
    let coded: usize = record
        .coded
        .iter()
        .map(|(member, value)| OVERHEAD + member.len() + value.code.len() + value.label.len())
        .sum();
    OVERHEAD
        + key.server.len()
        + key.id.len()
        + record.name.as_ref().map_or(0, String::len)
        + fields
        + lists
        + coded
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

/// What an earlier turn's call replays as when only a few of its fields are
/// kept; see [`replay_policy`].
fn is_a_receipt(output: &Value) -> bool {
    output
        .as_object()
        .is_some_and(|output| output.contains_key(replay_policy::RECEIPT_MARKER_KEY))
}

/// Whether the replay starts after the chat's first turn. A compaction puts
/// the summary of the turns it replaced, an assistant's text, ahead of every
/// user message, and their results are gone.
fn opens_after_the_first_turn(source: &GenerationInputMessages) -> bool {
    source
        .messages
        .iter()
        .find(|message| match message.role {
            MessageRole::User => true,
            MessageRole::Assistant => matches!(message.content, ContentPart::Text(_)),
            _ => false,
        })
        .is_some_and(|first| first.role == MessageRole::Assistant)
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

/// A path such as `/accounts(<id>)` is looked up by the ID inside it.
fn text_key(text: &str) -> Option<String> {
    if text.is_empty() || text.len() > MAX_ID_CHARS || text.chars().any(char::is_whitespace) {
        return None;
    }
    if let Some(inner) = id_inside_a_link_path(text) {
        return text_key(inner);
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

/// A record's values, by member: scalars and lists, read through the wrappers
/// servers put around them, the IDs of the records it links to, and the
/// members of its own field bag, such as `properties` or `fields`. Any other
/// object in it, such as an `author` or a `project`, is someone or something
/// else, whose name and values are not the record's. A list of name and
/// value pairs holds members of the record it sits in. Each object member
/// costs the walk its width, as it is read here too, and each pair one.
fn values_of(object: &Map<String, Value>, id_member: &str, walk: &mut Walk) -> ReadValues {
    let mut read = ReadValues::default();
    let labelled = LabelledColumns::of(object, id_member);
    let mut nested = Vec::new();
    'members: for (member, value) in object {
        if member == id_member || labelled.siblings.contains(member.as_str()) {
            continue;
        }
        if let Some(coded) = labelled.coded.get(member.as_str()) {
            if read.is_full() {
                break;
            }
            // The code is the value compared; the label only stands beside it.
            read.fields.insert(member.clone(), coded.code.clone());
            read.coded.insert(member.clone(), coded.clone());
            continue;
        }
        if let Some(pairs) = attribute_pairs(value) {
            for (key, value) in pairs {
                if read.is_full() || !walk.take(1) || !read.top_member(key, value, walk, None) {
                    break 'members;
                }
            }
            continue;
        }
        if read.is_full() || !read.top_member(member, value, walk, Some(&mut nested)) {
            break;
        }
    }
    'nested: for (member, value) in nested.into_iter().flatten() {
        if let Some(pairs) = attribute_pairs(value) {
            for (key, value) in pairs {
                if read.is_full() || !walk.take(1) {
                    break 'nested;
                }
                read.nested_member(key, value);
            }
            continue;
        }
        if read.is_full() {
            break;
        }
        read.nested_member(member, value);
    }
    read
}

/// Columns a row writes as a code with its label in a column beside it, as
/// `statecode: 0` beside `statecodename: "Open"`, and those label columns.
#[derive(Default)]
struct LabelledColumns<'a> {
    coded: HashMap<&'a str, CodedValue>,
    siblings: HashSet<&'a str>,
}

impl<'a> LabelledColumns<'a> {
    /// A column `X` holding a short code, and every column beside it named
    /// `X` plus a label suffix holding the same usable label. Never for the
    /// row's ID, a name, an ID, a recipient or a contact number.
    fn of(object: &'a Map<String, Value>, id_member: &str) -> Self {
        let mut labels: HashMap<String, Vec<(&'a str, &'a Value)>> = HashMap::new();
        for (member, value) in object {
            if member.chars().nth(MAX_DISPLAY_NAME_CHARS).is_some() {
                continue;
            }
            let lower = member.to_lowercase();
            for suffix in LABEL_SIBLING_SUFFIXES {
                if let Some(column) = lower
                    .strip_suffix(suffix)
                    .filter(|column| !column.is_empty())
                {
                    labels
                        .entry(column.to_string())
                        .or_default()
                        .push((member.as_str(), value));
                }
            }
        }
        let mut columns = Self::default();
        if labels.is_empty() {
            return columns;
        }
        for (member, value) in object {
            let Some(siblings) = labels.get(&member.to_lowercase()) else {
                continue;
            };
            let code = match value {
                Value::String(text) => text.clone(),
                Value::Number(number) => number.to_string(),
                _ => continue,
            };
            if member == id_member
                || names_an_id(member)
                || is_name_member(member)
                || is_recipient_member(member)
                || !is_choice_code(&code)
            {
                continue;
            }
            let mut said = Said::Nothing;
            for (_, label) in siblings {
                said = said.and(match label.as_str().and_then(choice_label) {
                    Some(label) => Said::Label(label),
                    None => Said::Conflict,
                });
            }
            let Said::Label(label) = said else {
                continue;
            };
            if label.eq_ignore_ascii_case(&code) {
                continue;
            }
            columns
                .siblings
                .extend(siblings.iter().map(|(sibling, _)| *sibling));
            columns.coded.insert(
                member.as_str(),
                CodedValue {
                    code,
                    label,
                    numeric: value.is_number(),
                },
            );
        }
        columns
    }
}

/// What one result said about one record.
#[derive(Default)]
struct ReadValues {
    fields: HashMap<String, String>,
    lists: HashMap<String, RecordList>,
    coded: HashMap<String, CodedValue>,
    /// What each member named like a name holds, as [`name_text`] reads it.
    names: Vec<Option<String>>,
}

impl ReadValues {
    fn is_empty(&self) -> bool {
        self.fields.is_empty() && self.lists.is_empty()
    }

    fn is_full(&self) -> bool {
        self.fields.len() >= MAX_FIELDS_PER_RECORD
    }

    /// Reads one member of the record itself; the record's own field bag,
    /// such as `properties`, goes to `nested`, when given, unless one of the
    /// shapes this reads holds it. `false` once the walk ends.
    fn top_member<'v>(
        &mut self,
        member: &str,
        value: &'v Value,
        walk: &mut Walk,
        nested: Option<&mut Vec<&'v Map<String, Value>>>,
    ) -> bool {
        if member.chars().nth(MAX_DISPLAY_NAME_CHARS).is_some() {
            return true;
        }
        self.note_name(member, value);
        let Value::Object(inner) = value else {
            if let Some(value) = record_value(member, value) {
                value.keep(member, &mut self.fields, &mut self.lists);
            }
            return true;
        };
        if !walk.take(inner.len()) {
            return false;
        }
        if self.keep_coded(member, inner) {
            return true;
        }
        // Only a pure link stands for its ID: `properties` holding one
        // `*_id` among its values is the record's values, not a link.
        match link_id_member(inner) {
            Some(link) => {
                if let Some(text) = inner.get(link).and_then(scalar_text) {
                    self.fields.insert(member.to_string(), text);
                }
            }
            None => match record_value(member, value) {
                Some(RecordValue::Unread) | None => {
                    if is_any_of(member, &rules::WRAPPER_MEMBERS) {
                        nested.into_iter().for_each(|n| n.push(inner));
                    }
                }
                Some(value) => value.keep(member, &mut self.fields, &mut self.lists),
            },
        }
        true
    }

    /// Reads one member of the record's field bag, unless the record itself
    /// holds a member of that name.
    fn nested_member(&mut self, member: &str, value: &Value) {
        if member.chars().nth(MAX_DISPLAY_NAME_CHARS).is_some()
            || self.fields.contains_key(member)
            || self.lists.contains_key(member)
        {
            return;
        }
        self.note_name(member, value);
        if value
            .as_object()
            .is_some_and(|inner| self.keep_coded(member, inner))
        {
            return;
        }
        if let Some(value) = record_value(member, value) {
            value.keep(member, &mut self.fields, &mut self.lists);
        }
    }

    fn note_name(&mut self, member: &str, value: &Value) {
        if is_name_member(member)
            && let Some(name) = name_text(value)
        {
            self.names.push(name);
        }
    }

    /// The record's name where it sits below a wrapper, as in
    /// `properties.Name.title[].plain_text`: the one member named like a name,
    /// when it holds plain, short text. Two such members, or one holding a
    /// link, a number, a machine ID, a phone number or an address, give none.
    fn wrapped_name(&self) -> Option<String> {
        match self.names.as_slice() {
            [Some(name)] if is_plain_name(name) => Some(name.clone()),
            _ => None,
        }
    }

    /// Keeps a label with its code, as a field that reads as the label, or a
    /// name with a text value as a field that reads as the value.
    fn keep_coded(&mut self, member: &str, value: &Map<String, Value>) -> bool {
        if let Some(pair) = coded_pair(value) {
            self.fields.insert(member.to_string(), pair.label.clone());
            self.coded.insert(member.to_string(), pair);
            return true;
        }
        if let Some(text) = named_text(value) {
            self.fields.insert(member.to_string(), text);
            return true;
        }
        false
    }
}

/// Longer text in a name member is a description, not what anyone calls the record.
const MAX_WRAPPED_NAME_CHARS: usize = 120;

/// What a member named like a name holds: `None` when it holds nothing, the
/// text it holds through wrappers that hold only it, or `Some(None)` for
/// anything else, a link's ID and a number included.
fn name_text(value: &Value) -> Option<Option<String>> {
    let mut current = value;
    for _ in 0..MAX_DEPTH {
        match current {
            Value::Null => return None,
            Value::String(text) if text.trim().is_empty() => return None,
            Value::String(text) if text.chars().nth(MAX_WRAPPED_NAME_CHARS).is_some() => {
                return Some(None);
            }
            Value::String(text) => return Some(Some(clean(text)).filter(|name| !name.is_empty())),
            Value::Array(entries) => match entries.as_slice() {
                [] => return None,
                [only] => current = only,
                _ => return Some(None),
            },
            Value::Object(members) if members.is_empty() => return None,
            Value::Object(members) if link_id_member(members).is_some() => return Some(None),
            Value::Object(members) => match wrapped_value(members) {
                Some(inner) => current = inner,
                None => return Some(None),
            },
            Value::Number(_) | Value::Bool(_) => return Some(None),
        }
    }
    Some(None)
}

/// A name a card may show for a record: no machine ID, phone number,
/// address or link.
fn is_plain_name(name: &str) -> bool {
    !is_machine_id(name)
        && !is_phone_shaped(name)
        && !name.contains('@')
        && !name.contains("://")
        && name
            .get(..4)
            .is_none_or(|start| !start.eq_ignore_ascii_case("www."))
}

/// The members a record lists as name and value pairs, as
/// `[{"Key": "name", "Value": "Example Ltd"}]` or a mail's `[{"name":
/// "Subject", "value": "Hi"}]`: every entry exactly a short name and a value,
/// and no name twice. Anything else is a list.
fn attribute_pairs(value: &Value) -> Option<Vec<(&str, &Value)>> {
    const PAIR_NAME_MEMBERS: [&str; 2] = ["key", "name"];
    let entries = value
        .as_array()
        .filter(|entries| !entries.is_empty() && entries.len() <= MAX_NODES_PER_VALUE)?;
    let mut seen = HashSet::new();
    entries
        .iter()
        .map(|entry| {
            let pair = entry.as_object().filter(|pair| pair.len() == 2)?;
            let name = member_in(pair, &PAIR_NAME_MEMBERS)?
                .as_str()
                .filter(|name| {
                    !name.trim().is_empty() && name.chars().nth(MAX_DISPLAY_NAME_CHARS).is_none()
                })?;
            let value = member_in(pair, &["value"])?;
            seen.insert(name).then_some((name, value))
        })
        .collect()
}

const LABEL_KEYS: [&str; 4] = ["name", "label", "title", "displayname"];
/// Under `value` only a number is a code: `{"name": "Region", "value": "EMEA"}`
/// names an attribute as often as it labels a choice.
const STRING_CODE_KEYS: [&str; 2] = ["code", "key"];

fn member_in<'a>(object: &'a Map<String, Value>, names: &[&str]) -> Option<&'a Value> {
    object
        .iter()
        .find(|(member, _)| is_any_of(member, names))
        .map(|(_, value)| value)
}

/// A label with the short code it stands for: `{"name": "Low", "value": 4}`
/// or `{"label": "Low", "code": "4"}`. Exactly those two members, so a link's
/// `{id, name}` or anything richer stays what it was.
fn coded_pair(object: &Map<String, Value>) -> Option<CodedValue> {
    if object.len() != 2 {
        return None;
    }
    let label = clean(member_in(object, &LABEL_KEYS)?.as_str()?);
    let (code, numeric) = match (
        member_in(object, &["value"]),
        member_in(object, &STRING_CODE_KEYS),
    ) {
        (Some(Value::Number(number)), None) | (None, Some(Value::Number(number))) => {
            (number.to_string(), true)
        }
        (None, Some(Value::String(text))) => (text.clone(), false),
        _ => return None,
    };
    let usable = super::choices::is_choice_code(&code)
        && !label.is_empty()
        && label.chars().count() <= super::choices::MAX_CHOICE_LABEL_CHARS
        && !is_machine_id(&label);
    usable.then_some(CodedValue {
        code,
        label,
        numeric,
    })
}

/// The text value of `{"name": "Region", "value": "EMEA"}`: what a call
/// writing the field compares with, whether the name is the value's label or
/// the attribute's.
fn named_text(object: &Map<String, Value>) -> Option<String> {
    if object.len() != 2 || !member_in(object, &LABEL_KEYS)?.is_string() {
        return None;
    }
    match member_in(object, &["value"])? {
        Value::String(text) => Some(clean(text)).filter(|text| !text.is_empty()),
        _ => None,
    }
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

/// IDs one chat's results are noted for; past this an ID missing among them
/// may have been read.
const MAX_SEEN_IDS: usize = 50_000;
/// What one result's IDs are read from at most: far more than the index
/// reads of it, as an ID anywhere counts.
const MAX_ID_SCAN_NODES: usize = 100_000;
const MAX_ID_SCAN_DEPTH: usize = 64;
const MAX_ID_SCAN_TOTAL_BYTES: usize = 4 * 1024 * 1024;

fn id_hash(key: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    key.hash(&mut hasher);
    hasher.finish()
}

/// What reading one result's IDs may still spend.
struct IdScan {
    nodes: usize,
    bytes: usize,
}

/// Every ID a result holds, as lookup keys: values and member names as
/// [`argument_ids`] reads them, and machine IDs written inside text. `false`
/// when a cap left some of it unread.
fn result_ids(value: &Value, keys: &mut Vec<String>, scan: &mut IdScan, depth: usize) -> bool {
    if scan.nodes == 0 || depth > MAX_ID_SCAN_DEPTH || keys.len() > MAX_SEEN_IDS {
        return false;
    }
    scan.nodes -= 1;
    match value {
        Value::Object(object) => object.iter().all(|(member, child)| {
            text_ids(member, keys, scan) && result_ids(child, keys, scan, depth + 1)
        }),
        Value::Array(entries) => entries
            .iter()
            .all(|entry| result_ids(entry, keys, scan, depth + 1)),
        Value::String(text) => text_ids(text, keys, scan),
        value => {
            keys.extend(id_key(value));
            true
        }
    }
}

/// What a machine ID may hold besides letters and digits, by how it is
/// written: plainly, as base64 with its padding, or as dotted segments. Each
/// is read apart, so an ID in brackets, in a link's path or at a sentence's
/// end is still found; a path such as `/accounts(<id>)` is looked up by the
/// ID inside it anyway.
const ID_TOKEN_CHARS: [&[char]; 3] = [
    &['_', '-'],
    &['_', '-', '+', '/', '='],
    &['_', '-', '+', '/', '=', '.'],
];

/// The IDs a text is or holds: itself, the UUIDs in it, and its words that
/// are machine IDs, written in any of [`ID_TOKEN_CHARS`].
fn text_ids(text: &str, keys: &mut Vec<String>, scan: &mut IdScan) -> bool {
    let Some(left) = scan.bytes.checked_sub(text.len()) else {
        return false;
    };
    scan.bytes = left;
    let mut found: HashSet<String> = text_key(text).into_iter().chain(uuid_keys(text)).collect();
    for extra in ID_TOKEN_CHARS {
        found.extend(
            text.split(|c: char| !(c.is_alphanumeric() || extra.contains(&c)))
                .map(|token| token.trim_end_matches('.'))
                .filter(|token| token.len() <= MAX_ID_CHARS && is_machine_id(token))
                .filter_map(text_key),
        );
    }
    keys.extend(found);
    true
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

/// The table a call names, lower case: a short word at its top level under a
/// table member such as `tablename`, or an `objectName`.
pub(super) fn call_table(arguments: &Value) -> Option<String> {
    const MAX_TABLE_CHARS: usize = 64;
    arguments
        .as_object()?
        .iter()
        .find(|(member, _)| {
            is_any_of(member, &rules::TABLE_MEMBERS)
                || is_any_of(member, &["objectname", "object_name"])
        })
        .and_then(|(_, value)| value.as_str())
        .map(str::trim)
        .filter(|table| {
            !table.is_empty()
                && table.chars().count() <= MAX_TABLE_CHARS
                && table.chars().all(|c| c.is_alphanumeric() || c == '_')
        })
        .map(str::to_lowercase)
}

/// The words of a read's arguments that a vocabulary is scoped by: none for a
/// read without any, and none past [`MAX_SCOPE_WORDS`].
fn table_scope(input: Option<&Value>) -> Option<BTreeSet<String>> {
    let words = words(input);
    (!words.is_empty() && words.len() <= MAX_SCOPE_WORDS).then(|| words.into_iter().collect())
}

/// The member name a line opens with, as `priority` in `priority CHOICE
/// (…)`, after a bullet and in backticks or not, and the rest of the line.
fn leading_member(line: &str) -> Option<(&str, &str)> {
    let line = line.trim_start();
    let line = match line.strip_prefix(['-', '*']) {
        Some(rest) if rest.starts_with(char::is_whitespace) => rest.trim_start(),
        _ => line,
    };
    let (ticked, line) = match line.strip_prefix('`') {
        Some(rest) => (true, rest),
        None => (false, line),
    };
    let end = line
        .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
        .unwrap_or(line.len());
    let member = &line[..end];
    if !member.starts_with(|c: char| c.is_ascii_alphabetic() || c == '_')
        || member.len() > MAX_DISPLAY_NAME_CHARS
    {
        return None;
    }
    let rest = &line[end..];
    let rest = if ticked {
        rest.strip_prefix('`')?
    } else {
        rest
    };
    rest.starts_with(char::is_whitespace)
        .then_some((member, rest))
}

/// Adds one member's options; a member listed again with other options
/// says nothing.
fn add_options(
    members: &mut HashMap<String, Option<HashMap<String, String>>>,
    member: &str,
    options: Vec<(String, String)>,
) {
    if members.len() >= MAX_VOCABULARY_MEMBERS && !members.contains_key(member) {
        return;
    }
    let options: HashMap<String, String> = options.into_iter().collect();
    match members.get_mut(member) {
        Some(kept) => {
            if kept.as_ref() != Some(&options) {
                *kept = None;
            }
        }
        None => {
            members.insert(member.to_string(), Some(options));
        }
    }
}

/// The one member of `object` named any of `names`; `None` for none or two.
fn one_member_in<'a>(object: &'a Map<String, Value>, names: &[&str]) -> Option<&'a Value> {
    let mut found = object
        .iter()
        .filter(|(member, _)| is_any_of(member, names))
        .map(|(_, value)| value);
    match (found.next(), found.next()) {
        (Some(only), None) => Some(only),
        _ => None,
    }
}

/// A code as an option list writes it: a short string or a number, never
/// an ID, an address or a phone number.
fn option_code(value: &Value) -> Option<String> {
    let code = match value {
        Value::String(text) => text.clone(),
        Value::Number(number) => number.to_string(),
        _ => return None,
    };
    is_choice_code(&code).then_some(code)
}

/// Field metadata naming one member and listing its options as `{value,
/// label}`, as `{"name": "Industry", "picklistValues": [...]}`.
fn field_options(object: &Map<String, Value>) -> Option<(&str, Vec<(String, String)>)> {
    let member = one_member_in(object, &OPTION_FIELD_NAME_KEYS)?
        .as_str()
        .filter(|member| {
            !member.trim().is_empty() && member.chars().nth(MAX_DISPLAY_NAME_CHARS).is_none()
        })?;
    let entries = one_member_in(object, &OPTION_SET_KEYS)?
        .as_array()
        .filter(|entries| (2..=MAX_OPTIONS).contains(&entries.len()))?;
    let mut codes = HashSet::new();
    let mut options = Vec::new();
    for entry in entries {
        let entry = entry.as_object()?;
        let code = option_code(one_member_in(entry, &["value"])?)?;
        let label = choice_label(one_member_in(entry, &["label"])?.as_str()?)?;
        if !codes.insert(code.clone()) {
            return None;
        }
        options.push((code, label));
    }
    Some((member, options))
}

/// Code to label of a list of options: two or more objects, each exactly one
/// code member and one label member and at most a color, description, type
/// or order besides. Any other entry, or a code listed twice, and the list
/// says nothing.
fn option_list(entries: &[Value]) -> Option<HashMap<String, String>> {
    if !(2..=MAX_OPTIONS).contains(&entries.len()) {
        return None;
    }
    let mut options = HashMap::new();
    for entry in entries {
        let entry = entry.as_object()?;
        let (mut code, mut label) = (None, None);
        for (member, value) in entry {
            let slot = if is_any_of(member, &OPTION_CODE_KEYS) {
                &mut code
            } else if is_any_of(member, &OPTION_LABEL_KEYS) {
                &mut label
            } else if is_any_of(member, &OPTION_EXTRA_KEYS) {
                continue;
            } else {
                return None;
            };
            if slot.replace(value).is_some() {
                return None;
            }
        }
        let code = option_code(code?)?;
        let label = choice_label(label?.as_str()?)?;
        if options.insert(code, label).is_some() {
            return None;
        }
    }
    Some(options)
}

/// Shorter words name too little to tie a member to a list.
const MIN_NOUN_CHARS: usize = 3;

/// The noun a name ends in, past any read verb after it: `transitions` in
/// `get_transitions` and `labels` in `labels_list`.
fn head_noun(name: &str) -> Option<String> {
    let mut words = name_words(name);
    while words
        .last()
        .is_some_and(|word| rules::READ_VERBS.contains(&word.as_str()))
    {
        words.pop();
    }
    words
        .pop()
        .filter(|word| word.chars().count() >= MIN_NOUN_CHARS)
}

/// What a member's code stands for, by its name: `transition_id` →
/// `transition`, `statusCode` → `status`.
fn member_noun(member: &str) -> Option<String> {
    let mut words = name_words(member);
    while words.last().is_some_and(|word| {
        matches!(
            word.as_str(),
            "id" | "ids" | "code" | "codes" | "key" | "keys"
        )
    }) {
        words.pop();
    }
    words
        .pop()
        .filter(|word| word.chars().count() >= MIN_NOUN_CHARS)
}

/// One noun in the singular or the plural: `transition` and `transitions`,
/// `status` and `statuses`, `priority` and `priorities`.
fn same_noun(a: &str, b: &str) -> bool {
    fn plural_of(singular: &str, plural: &str) -> bool {
        plural
            .strip_prefix(singular)
            .is_some_and(|ending| matches!(ending, "s" | "es"))
            || singular
                .strip_suffix('y')
                .and_then(|stem| plural.strip_prefix(stem))
                == Some("ies")
    }
    a == b || plural_of(a, b) || plural_of(b, a)
}

/// What a vocabulary costs, roughly: its text plus a fixed overhead per entry.
fn vocabulary_bytes(
    server: &str,
    scope: &VocabularyScope,
    members: &HashMap<String, Option<HashMap<String, String>>>,
) -> usize {
    const OVERHEAD: usize = 64;
    let scope = match scope {
        VocabularyScope::Table(words) => words.iter().map(|word| OVERHEAD + word.len()).sum(),
        VocabularyScope::List { arguments, nouns } => {
            arguments
                .iter()
                .map(|(name, value)| OVERHEAD + name.len() + value.len())
                .sum::<usize>()
                + nouns
                    .iter()
                    .map(|noun| OVERHEAD + noun.len())
                    .sum::<usize>()
        }
    };
    let members: usize = members
        .iter()
        .map(|(member, options)| {
            OVERHEAD
                + member.len()
                + options
                    .iter()
                    .flatten()
                    .map(|(code, label)| OVERHEAD + code.len() + label.len())
                    .sum::<usize>()
        })
        .sum();
    OVERHEAD + server.len() + scope + members
}

#[cfg(test)]
mod tests;
