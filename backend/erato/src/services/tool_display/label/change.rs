//! What a call changes, described the same way for every server: what each
//! value does, how far the call reaches, what is lost, what the card cannot
//! read and what nobody can know. Computed next to the label from the call's
//! real arguments, the tool's own annotations and words, and earlier results
//! in the chat; never from anything a model wrote. Words a tool says about
//! itself only ever pick a closed sentence the card marks as the tool's claim.

use super::MAX_LABEL_VALUE_CHARS;
use super::arguments::names_an_id;
use super::choices::{
    MAX_CHOICE_LABEL_CHARS, Said, choice_label, is_choice_code, schema_choice_label,
};
use super::context::{
    CodedValue, ListEntry, ToolResultContext, call_table, is_link, link_id_member,
    list_entries_match, list_entry, name_words, text_prefix,
};
use super::machine_id::{id_inside_a_link_path, is_machine_id};
use super::pointer::escape;
use super::recipients::{ADDRESS_MEMBERS, bare_member, is_phone_shaped};
use super::rules::{
    self, Claim, PLACE_MEMBERS, Recipients, TABLE_MEMBERS, TITLE_MEMBERS, WRAPPER_MEMBERS,
    recipients_in,
};
use crate::models::message::{
    ToolCallAction, ToolCallBatch, ToolCallBatchField, ToolCallBatchOperation, ToolCallBatchRow,
    ToolCallChange, ToolCallChangeNote, ToolCallEffect, ToolCallEffectKind, ToolCallEffectValue,
    ToolCallFilter, ToolCallFilterPart, ToolCallFlag, ToolCallLabel, ToolCallLabelItem,
    ToolCallLabelSource, ToolCallObjectKind, ToolCallOpaque, ToolCallOpaqueKind,
    ToolCallRecipientGroup, ToolCallRecipientKind, ToolCallTextChange, ToolCallValueMeaning,
    ToolCallValueMeaningSource,
};
use crate::services::display_text::{MAX_DISPLAY_NAME_CHARS, sanitize_display_text};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use unicode_normalization::UnicodeNormalization;

/// Values kept in a description; `counts` counts them all, and what is lost
/// is kept first.
const MAX_EFFECTS: usize = 64;
const MAX_LOSS_EFFECTS: usize = 128;
/// JSON nodes one description reads.
const MAX_NODES: usize = 20_000;
/// Bytes one description stores, values, names, paths and the cost of each
/// stored entry alike, so a huge call stores little.
const MAX_CHANGE_BYTES: usize = 48 * 1024;
/// What is lost still gets stored once everything else has used its share.
const LOSS_RESERVE_BYTES: usize = 8 * 1024;
/// What one stored effect or row costs beyond its text, as JSON.
const ENTRY_OVERHEAD_BYTES: usize = 96;
const MAX_TEXTS: usize = 8;
const MAX_FLAGS: usize = 16;
const MAX_PLACES: usize = 6;
/// Members or entries an object or list value reads out before the rest are
/// dropped from its readable form.
const MAX_READABLE_ENTRIES: usize = 8;
const MAX_READABLE_DEPTH: usize = 3;
/// A machine ID inside a value or name no result gives a name for. The card
/// shows a phrase in its own language where this stands.
pub(super) const HIDDEN_ID_MARK: char = '\u{E002}';
const MAX_DEPTH: usize = 4;
const MAX_LIST_VALUES: usize = 50;
const MAX_RECIPIENT_VALUES: usize = 200;
const MAX_OUTSIDE: usize = 50;
const MAX_FILTER_PARTS: usize = 8;
const MAX_OPAQUE: usize = 4;
/// Characters of a long text or statement stored; the card reads the rest
/// from the input.
const MAX_STORED_TEXT_CHARS: usize = 4_000;
const MAX_FOUND_WORDS: usize = 8;
/// Bytes of a statement searched for risky words.
const MAX_SCAN_BYTES: usize = 64 * 1024;
/// A batch row stored, and rows read to tell whether all change the same way.
const MAX_BATCH_ROWS: usize = 50;
const MAX_ROWS_READ: usize = 2_000;
const MAX_ROW_EFFECTS: usize = 12;
/// Fields of a batch stated one by one in its first view.
const MAX_BATCH_FIELDS: usize = 32;
/// Different values kept as examples of what a batch's field is set to.
const MAX_FIELD_SAMPLES: usize = 3;
/// Different values of one field counted; more just reads as "many".
const MAX_DISTINCT_TRACKED: usize = 1_000;
/// A string this long, or any with a line break, is a block of text.
const LONG_TEXT_CHARS: usize = 240;
/// Bytes of a tool's description read for what it says about itself.
const MAX_DESCRIPTION_BYTES: usize = 8 * 1024;

const FILTER_MEMBERS: [&str; 9] = [
    "where",
    "filter",
    "filters",
    "condition",
    "conditions",
    "criteria",
    "selector",
    "labelselector",
    "fieldselector",
];
const BODY_MEMBERS: [&str; 11] = [
    "body",
    "content",
    "text",
    "html",
    "htmlbody",
    "markdown",
    "description",
    "message",
    "new_content",
    "textcontent",
    "note",
];
const BEFORE_TEXT_MEMBERS: [&str; 4] = ["old_str", "old_text", "oldtext", "old_string"];
const AFTER_TEXT_MEMBERS: [&str; 4] = ["new_str", "new_text", "newtext", "new_string"];
/// What a member's words name, in identifiers.
const SQL_MEMBERS: [&str; 3] = ["sql", "query", "statement"];
const SHELL_MEMBERS: [&str; 5] = ["command", "cmd", "shell", "bash", "script"];
const CODE_MEMBERS: [&str; 6] = [
    "code",
    "python",
    "javascript",
    "program",
    "manifest",
    "resource",
];
const INSTRUCTION_MEMBERS: [&str; 5] = ["instruction", "instructions", "prompt", "task", "action"];
/// What `DROP`, `CREATE` and `ALTER` act on in a statement.
const SQL_OBJECTS: [&str; 16] = [
    "table",
    "database",
    "index",
    "view",
    "schema",
    "function",
    "procedure",
    "trigger",
    "sequence",
    "type",
    "role",
    "user",
    "extension",
    "policy",
    "materialized",
    "unique",
];
/// Words a person writes and a command rarely holds.
const PROSE_WORDS: [&str; 12] = [
    "the", "a", "an", "all", "of", "for", "to", "about", "please", "and", "with", "old",
];
const SQL_READ_STARTS: [&str; 4] = ["select", "with", "explain", "show"];
const SQL_WRITE_WORDS: [&str; 11] = [
    "DELETE", "DROP", "TRUNCATE", "UPDATE", "ALTER", "INSERT", "GRANT", "REVOKE", "REPLACE",
    "MERGE", "CREATE",
];
const SHELL_WORDS: [&str; 14] = [
    "rm", "mkfs", "dd", "kill", "pkill", "shutdown", "reboot", "chmod", "chown", "sudo", "curl",
    "wget", "truncate", "mv",
];
const CODE_WORDS: [&str; 10] = [
    "delete", "remove", "drop", "truncate", "fetch", "http", "send", "exec", "eval", "system",
];
/// Words in a boolean member's name that say it changes what the call does.
const FLAG_WORDS: [&str; 15] = [
    "force",
    "recursive",
    "overwrite",
    "purge",
    "cascade",
    "notify",
    "hard",
    "permanent",
    "delete",
    "drop",
    "push",
    "production",
    "publish",
    "live",
    "replace",
];
const DRY_RUN_WORDS: [&str; 4] = ["dry", "dryrun", "simulate", "preview"];

/// What a description is computed from.
pub struct ChangeFacts<'a> {
    pub tool: &'a rmcp::model::Tool,
    pub arguments: &'a Value,
    pub approval_argument: Option<&'a str>,
    pub context: &'a ToolResultContext,
    /// The verb the rules found. It alone decides what counts as emptied or
    /// replaced; a model's verb only words the headline.
    pub rules_action: ToolCallAction,
    /// The server whose earlier results may name this call's IDs.
    pub server: Option<&'a str>,
    /// The operator's words for this server's field names and choice values.
    pub glossary: Option<&'a erato_config::config::McpGlossaryConfig>,
    /// Who set the tool's destructive hint: its server, or the operator's
    /// configuration.
    pub destructive_hint_source: crate::services::mcp_tool_annotations::McpToolAnnotationSource,
}

/// The call's change description, and whether cleaning a value or name it
/// holds removed invisible characters. A call with no verb claims no losses,
/// and gets a description only for what reaches past its plain values.
pub fn describe(label: &ToolCallLabel, facts: ChangeFacts<'_>) -> Option<(ToolCallChange, bool)> {
    let action = if label.source == ToolCallLabelSource::Generic {
        ToolCallAction::Other
    } else {
        facts.rules_action
    };
    let item = label.items.first();
    let mut walk = Walk::new(action, label.object_kind, item, &facts);
    if let Value::Object(members) = facts.arguments {
        walk.members(members, "", 0, false, "");
    }
    let (change, hidden) = walk.finish(&facts);
    let says_something = action != ToolCallAction::Other
        || change.recipients.is_some()
        || change.filter.is_some()
        || !change.flags.is_empty()
        || !change.opaque.is_empty()
        || !change.texts.is_empty()
        || change.batch.is_some();
    says_something.then_some((change, hidden))
}

/// Runs a description so that a bug in it costs the call only the description,
/// and never the label or the names already on it.
pub fn guarded_describe(
    describe: impl FnOnce() -> Option<(ToolCallChange, bool)>,
) -> Option<(ToolCallChange, bool)> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(describe))
        .inspect_err(|_| {
            tracing::error!(
                "Showing a tool call without a change description: describing it panicked"
            )
        })
        .ok()
        .flatten()
}

#[derive(PartialEq)]
enum Pushed {
    Stored,
    PastCountCap,
    NoRoom,
}

struct Walk<'a> {
    facts: &'a ChangeFacts<'a>,
    action: ToolCallAction,
    /// What the label says the record is; a table that only repeats it is
    /// left out.
    kind: ToolCallObjectKind,
    /// See [`ToolCallChange::record_unread`].
    record_unread: bool,
    /// Paths the line names: the record, its title, where it goes.
    named: HashSet<&'a str>,
    /// Those of them whose value the line can show, a machine ID only by name.
    named_shown: HashSet<&'a str>,
    /// The text the call says it replaces and the text it writes, by path.
    before: Option<&'a str>,
    after: HashSet<&'a str>,
    earlier: Option<EarlierRecord<'a>>,
    /// The table the call names, which earlier descriptions of it speak for.
    table: Option<String>,
    change: ToolCallChange,
    places: Vec<(usize, String)>,
    nodes: usize,
    bytes: usize,
    hidden: bool,
    consent_left_out: bool,
    complete: bool,
    says: ToolText,
    before_stored: bool,
    saw_list: bool,
    /// A value was compared with what an earlier result showed.
    used_earlier: bool,
}

struct EarlierRecord<'a> {
    record: &'a super::context::Record,
    server: &'a str,
}

/// One field of the record, as an earlier read wrote it.
struct EarlierField {
    text: String,
    coded: Option<CodedValue>,
}

impl<'a> Walk<'a> {
    fn new(
        action: ToolCallAction,
        kind: ToolCallObjectKind,
        item: Option<&'a ToolCallLabelItem>,
        facts: &'a ChangeFacts<'a>,
    ) -> Self {
        let record_unread =
            action != ToolCallAction::Other && item.is_some_and(|item| record_unread(item, facts));
        let named_values = item
            .into_iter()
            .flat_map(|item| [&item.id, &item.title, &item.target])
            .flatten()
            .flat_map(|slot| &slot.values);
        let named = named_values
            .clone()
            .map(|value| value.path.as_str())
            .collect();
        let named_shown = named_values
            .filter(|value| !value.machine_id || value.resolved.is_some())
            .map(|value| value.path.as_str())
            .collect();
        let after = item
            .and_then(|item| item.after.as_ref())
            .into_iter()
            .flat_map(|slot| &slot.values)
            .map(|value| value.path.as_str())
            .collect();
        let before = item
            .and_then(|item| item.before.as_ref())
            .and_then(|slot| slot.values.first())
            .map(|value| value.path.as_str());
        let earlier = item.zip(facts.server).and_then(|(item, server)| {
            is_update_like(action)
                .then(|| facts.context.record_of_item(item, facts.arguments, server))
                .flatten()
                .map(|record| EarlierRecord { record, server })
        });
        Self {
            facts,
            action,
            kind,
            record_unread,
            named,
            named_shown,
            before,
            after,
            earlier,
            table: call_table(facts.arguments),
            change: ToolCallChange::default(),
            places: Vec::new(),
            nodes: MAX_NODES,
            bytes: MAX_CHANGE_BYTES,
            hidden: false,
            consent_left_out: false,
            complete: true,
            says: ToolText::read(facts.tool.description.as_deref()),
            before_stored: false,
            saw_list: false,
            used_earlier: false,
        }
    }

    /// Reads one object's members. `flat` keeps a wrapper's members under
    /// their own names; `prefix` names a nested object's members after it.
    fn members(
        &mut self,
        members: &'a Map<String, Value>,
        base: &str,
        depth: usize,
        flat: bool,
        prefix: &str,
    ) {
        let shared = shared_prefix(members);
        for (member, value) in members {
            if self.nodes == 0 {
                self.complete = false;
                return;
            }
            self.nodes -= 1;
            let path = format!("{base}/{}", escape(member));
            let name = self.member_name(member, shared.as_deref(), prefix);
            self.member(member, value, &path, name, depth, flat);
        }
    }

    fn member(
        &mut self,
        member: &'a str,
        value: &'a Value,
        path: &str,
        name: String,
        depth: usize,
        flat: bool,
    ) {
        let arguments = self.facts.arguments;
        match rules::claim(arguments, path, self.facts.approval_argument) {
            Some(Claim::Consent) => {
                self.consent_left_out = true;
                return;
            }
            Some(Claim::LookupName) => return,
            None => {}
        }
        if is_verb_field(member, value) {
            return;
        }
        if self.counts_as_recipient(member, value) {
            self.recipients(member, value, path);
            return;
        }
        if is_one_of(member, &TABLE_MEMBERS) && value.as_str().is_some_and(is_table_name) {
            self.table(value);
            return;
        }
        if depth == 0 && is_scalar(value) && self.is_place(member) {
            self.place(member, value);
            return;
        }
        if self.before.is_some_and(|before| before == path) {
            return;
        }
        if self.after.contains(path) {
            self.text(member, value, path, &name);
            return;
        }
        if self.is_named(path, value) {
            return;
        }
        if is_one_of(member, &FILTER_MEMBERS) {
            self.filter(value, path);
            return;
        }
        if let Value::Bool(flag) = value {
            let dry_run = is_dry_run(member);
            if *flag && (dry_run || is_behaviour_flag(member)) {
                self.flag(member, path, name, dry_run);
                return;
            }
        }
        if self.opaque(member, value, path, &name) {
            return;
        }
        match value {
            Value::String(text) if self.is_long_text(member, text) => {
                self.text(member, value, path, &name);
            }
            Value::Array(entries) if is_batch(entries) => {
                self.batch(entries, path, &name);
            }
            Value::Array(entries) if entries.len() == 1 && is_record(&entries[0]) => {
                // One record sent as a list is that record.
                if let Value::Object(row) = &entries[0] {
                    let base = format!("{path}/0");
                    if let Some((before, after)) = text_edit(row) {
                        let after_path = format!("{base}/{}", escape(after));
                        let effect = self.text_edit_effect(
                            after,
                            before,
                            row,
                            &row[after],
                            &after_path,
                            name,
                        );
                        self.push(effect);
                    } else {
                        self.members(row, &base, depth + 1, true, "");
                    }
                }
            }
            Value::Object(inner) if !flat && is_one_of(member, &WRAPPER_MEMBERS) => {
                self.members(inner, path, depth + 1, true, "");
            }
            Value::Object(inner) => {
                self.object(member, value, inner, path, &name, depth);
            }
            value => self.value(member, value, path, name),
        }
    }

    fn object(
        &mut self,
        member: &'a str,
        value: &'a Value,
        inner: &'a Map<String, Value>,
        path: &str,
        name: &str,
        depth: usize,
    ) {
        match unwrap(value, false) {
            Unwrapped::Other if depth + 1 < MAX_DEPTH && !inner.is_empty() => {
                let prefix = format!("{name} · ");
                self.members(inner, path, depth + 1, false, &prefix);
            }
            _ => self.value(member, value, path, name.to_string()),
        }
    }

    /// What a member reads as on the card: the operator's name with the raw
    /// one beside it, else the member in words.
    fn member_name(&self, member: &str, shared: Option<&str>, prefix: &str) -> String {
        match self.glossary_name(member) {
            Some(name) => format!("{prefix}{name} ({member})"),
            None => readable_name(member, shared, prefix),
        }
    }

    fn glossary_name(&self, member: &str) -> Option<&'a str> {
        if is_machine_id(member) {
            return None;
        }
        self.facts
            .glossary?
            .field_names
            .get(member)
            .map(String::as_str)
    }

    fn is_named(&self, path: &str, value: &Value) -> bool {
        if self.named.contains(path) {
            return true;
        }
        let inside = format!("{path}/");
        match value {
            Value::Array(entries)
                if entries
                    .iter()
                    .all(|entry| matches!(unwrap(entry, false), Unwrapped::Scalar(_))) =>
            {
                self.named.iter().any(|named| named.starts_with(&inside))
            }
            // A link whose record the line names by a known name is said already.
            Value::Object(members) => link_id_member(members)
                .is_some_and(|id| self.named_shown.contains(format!("{inside}{id}").as_str())),
            _ => false,
        }
    }

    /// Who a call reaches: members that name recipients, and on a send or a
    /// share the address or number it goes to. A record's phone field is a value.
    fn counts_as_recipient(&self, member: &str, value: &Value) -> bool {
        let reaches = matches!(self.action, ToolCallAction::Send | ToolCallAction::Share);
        match recipients_in(member, &[value]) {
            Some(Recipients::To | Recipients::Copy) => true,
            Some(Recipients::Number) => reaches,
            None => {
                reaches
                    && ADDRESS_MEMBERS.contains(&bare_member(member).as_str())
                    && value.as_str().is_some_and(|text| text.contains('@'))
            }
        }
    }

    /// `owner` names a place only beside a repository; alone it is a field.
    fn is_place(&self, member: &str) -> bool {
        is_one_of(member, &PLACE_MEMBERS)
            || (member.eq_ignore_ascii_case("owner")
                && self.facts.arguments.as_object().is_some_and(|top| {
                    top.keys()
                        .any(|key| is_one_of(key, &["repo", "repository"]))
                }))
    }

    fn place(&mut self, member: &str, value: &Value) {
        if self.places.len() == MAX_PLACES {
            return;
        }
        if let Some(text) = scalar_text(value) {
            let cleaned = self.clean(&text);
            if !cleaned.is_empty() && !is_machine_id(&cleaned) && self.take_bytes(&cleaned) {
                self.places.push((place_order(member), cleaned));
            }
        }
    }

    /// The table a record is one of qualifies its kind, unless its name only
    /// repeats the kind; the first one the call names counts.
    fn table(&mut self, value: &Value) {
        let Some(text) = value.as_str() else {
            return;
        };
        let cleaned = self.clean(text);
        if cleaned.is_empty()
            || is_machine_id(&cleaned)
            || self.change.table.is_some()
            || rules::table_repeats_kind(&cleaned, self.kind)
            || !self.take_bytes(&cleaned)
        {
            return;
        }
        self.change.table = Some(cleaned);
    }

    fn clean(&mut self, text: &str) -> String {
        let cleaned = sanitize_display_text(
            text_prefix(text, MAX_LABEL_VALUE_CHARS * 8),
            MAX_LABEL_VALUE_CHARS,
        );
        self.hidden |= cleaned.hidden_characters;
        cleaned.text
    }

    /// A member as written, shown under See more. A machine ID is never shown.
    fn raw_name(&mut self, member: &str) -> String {
        if is_machine_id(member) {
            return String::new();
        }
        self.display_name(member)
    }

    fn display_name(&mut self, name: &str) -> String {
        let cleaned = sanitize_display_text(
            text_prefix(name, MAX_DISPLAY_NAME_CHARS * 8),
            MAX_DISPLAY_NAME_CHARS,
        );
        self.hidden |= cleaned.hidden_characters;
        cleaned.text
    }

    fn take_bytes(&mut self, text: &str) -> bool {
        match self.bytes.checked_sub(text.len()) {
            Some(left) => {
                self.bytes = left;
                true
            }
            None => {
                self.complete = false;
                false
            }
        }
    }

    /// One value as a card shows it, a machine ID as its name if known.
    fn shown(&mut self, value: &Value, path: &str) -> Option<ToolCallEffectValue> {
        let raw = match value {
            Value::String(text) => std::borrow::Cow::Owned(without_mark(text)),
            Value::Bool(_) | Value::Number(_) => std::borrow::Cow::Owned(value.to_string()),
            Value::Null => return None,
            other => std::borrow::Cow::Owned(self.readable_form(other, 0)),
        };
        let cleaned = sanitize_display_text(
            text_prefix(&raw, MAX_LABEL_VALUE_CHARS * 8),
            MAX_LABEL_VALUE_CHARS,
        );
        self.hidden |= cleaned.hidden_characters;
        if is_machine_id(&cleaned.text) {
            return Some(ToolCallEffectValue {
                text: self.name_of_id(&cleaned.text, path).unwrap_or_default(),
                truncated: false,
                machine_id: true,
                meaning: None,
            });
        }
        if cleaned.text.is_empty() {
            return None;
        }
        if !self.take_bytes(&cleaned.text) {
            // Out of room: the card says the value is cut, never shows nothing.
            return Some(ToolCallEffectValue {
                text: String::new(),
                truncated: true,
                machine_id: false,
                meaning: None,
            });
        }
        Some(ToolCallEffectValue {
            truncated: cleaned.truncated,
            text: cleaned.text,
            machine_id: false,
            meaning: None,
        })
    }

    /// An object or list as `Key: value, Key: value`, never as JSON text. A
    /// machine ID reads as a mark the card turns into words: its name would
    /// outlive the chat that gave it if the label were copied elsewhere.
    fn readable_form(&mut self, value: &Value, depth: usize) -> String {
        if depth >= MAX_READABLE_DEPTH {
            return "\u{2026}".to_string();
        }
        match value {
            Value::Object(members) => {
                let shared = shared_prefix(members);
                let mut parts = Vec::new();
                for (member, inner) in members.iter().take(MAX_READABLE_ENTRIES) {
                    let text = self.readable_form(inner, depth + 1);
                    parts.push(format!(
                        "{}: {text}",
                        readable_name(member, shared.as_deref(), "")
                    ));
                }
                if members.len() > MAX_READABLE_ENTRIES {
                    parts.push("\u{2026}".to_string());
                }
                parts.join(", ")
            }
            Value::Array(entries) => {
                let mut parts = Vec::new();
                for entry in entries.iter().take(MAX_READABLE_ENTRIES) {
                    parts.push(self.readable_form(entry, depth + 1));
                }
                if entries.len() > MAX_READABLE_ENTRIES {
                    parts.push("\u{2026}".to_string());
                }
                parts.join(", ")
            }
            Value::String(text) if is_machine_id(text) => HIDDEN_ID_MARK.to_string(),
            Value::String(text) => without_mark(text),
            Value::Number(number) if is_machine_id(&number.to_string()) => {
                HIDDEN_ID_MARK.to_string()
            }
            Value::Number(_) | Value::Bool(_) => value.to_string(),
            Value::Null => "\u{2013}".to_string(),
        }
    }

    fn name_of_id(&self, id: &str, path: &str) -> Option<String> {
        if below_a_recipient(path) {
            return None;
        }
        self.facts
            .context
            .name_of_id(self.facts.server?, id)
            .map(|name| name.to_string())
    }

    fn is_long_text(&self, member: &str, text: &str) -> bool {
        (is_one_of(member, &BODY_MEMBERS)
            && !is_update_like(self.action)
            && !text.trim().is_empty())
            || text.contains('\n')
            || text.chars().nth(LONG_TEXT_CHARS).is_some()
    }

    fn value(&mut self, member: &str, value: &Value, path: &str, name: String) {
        let (bytes, complete) = (self.bytes, self.complete);
        let effect = self.effect(member, value, path, name);
        if self.push(effect) == Pushed::PastCountCap {
            // Counted but not stored, so it costs no room and hides nothing.
            self.bytes = bytes;
            self.complete = complete;
        }
    }

    fn effect(&mut self, member: &str, value: &Value, path: &str, name: String) -> ToolCallEffect {
        let name = self.display_name(&name);
        let raw_name = self.raw_name(member);
        let update_like = is_update_like(self.action);
        let mut effect = ToolCallEffect {
            path: path.to_string(),
            name,
            raw_name,
            effect: ToolCallEffectKind::Set,
            values: Vec::new(),
            omitted: 0,
            old: None,
            removed: Vec::new(),
            kept: Vec::new(),
            added: Vec::new(),
            list: false,
            link: false,
            new_name: false,
        };
        match unwrap(value, is_plural(member)) {
            Unwrapped::Empty => {
                if update_like {
                    effect.effect = ToolCallEffectKind::Emptied;
                    self.fill_old(member, path, &mut effect);
                }
            }
            Unwrapped::Scalar(scalar) => {
                effect.link = is_link_shaped(member, value);
                let shown = self
                    .shown(scalar, path)
                    .map(|value| self.with_meaning(value, member, path, scalar));
                effect.values.extend(shown);
                self.classify_scalar(member, path, scalar, &mut effect);
                effect.new_name = self.record_unread
                    && update_like
                    && effect.effect == ToolCallEffectKind::Set
                    && !effect.link
                    && is_one_of(member, &TITLE_MEMBERS);
            }
            Unwrapped::List(entries) => {
                effect.list = true;
                self.list_values(&entries, path, &mut effect);
                if update_like && !only_adds(member) {
                    self.saw_list = true;
                    if !self.says.adds_to_list {
                        effect.effect = ToolCallEffectKind::ListReplaced;
                        self.diff_list(member, path, &entries, &mut effect);
                    }
                }
            }
            Unwrapped::Other => {
                effect.effect = ToolCallEffectKind::Unreadable;
                effect.values.extend(self.shown(value, path));
            }
        }
        effect
    }

    /// `value` with what its code means, where someone has said so. The
    /// glossary is the operator's word; the tool's schema and earlier reads
    /// count only when they all agree, and a card marks theirs as the tool's
    /// claim beside the code.
    fn with_meaning(
        &self,
        mut value: ToolCallEffectValue,
        member: &str,
        path: &str,
        scalar: &Value,
    ) -> ToolCallEffectValue {
        if value.machine_id || value.truncated || value.text.is_empty() {
            return value;
        }
        let code = match scalar {
            Value::String(_) | Value::Number(_) => value.text.as_str(),
            _ => return value,
        };
        if !is_choice_code(code) || below_a_recipient(path) {
            return value;
        }
        value.meaning = self.meaning_of(member, path, code);
        value
    }

    fn meaning_of(&self, member: &str, path: &str, code: &str) -> Option<ToolCallValueMeaning> {
        let meaning = |label: &str, source| {
            if source != ToolCallValueMeaningSource::Glossary {
                // A server's words are never an ID, a number to call, a
                // link or an address, however they reached the index.
                return choice_label(label).map(|label| ToolCallValueMeaning { label, source });
            }
            let cleaned = sanitize_display_text(label, MAX_CHOICE_LABEL_CHARS);
            (!cleaned.text.is_empty() && !cleaned.truncated && !is_machine_id(&cleaned.text))
                .then_some(ToolCallValueMeaning {
                    label: cleaned.text,
                    source,
                })
        };
        let schema = Said::from(schema_choice_label(
            &self.facts.tool.input_schema,
            path,
            code,
        ));
        let read = self.read_meaning(member, code);
        if let Some(label) = self
            .facts
            .glossary
            .and_then(|glossary| glossary.choice_labels.get(member)?.get(code))
        {
            // A glossary entry holds for every table of the server; a tool
            // or a read that numbers this field otherwise is about another.
            return (schema.allows(label) && read.allows(label))
                .then(|| meaning(label, ToolCallValueMeaningSource::Glossary))
                .flatten();
        }
        let source = if matches!(read, Said::Label(_)) {
            ToolCallValueMeaningSource::Earlier
        } else {
            ToolCallValueMeaningSource::Tool
        };
        match read.and(schema) {
            Said::Label(label) => meaning(&label, source),
            Said::Nothing | Said::Conflict => None,
        }
    }

    /// What earlier reads of the call's server say `code` of `member` means:
    /// the read that reported the record, the newest description of the
    /// call's table, and lists of options read for the same place.
    fn read_meaning(&self, member: &str, code: &str) -> Said {
        let Some(server) = self.facts.server else {
            return Said::Nothing;
        };
        let context = self.facts.context;
        let record = self.earlier.as_ref().map_or(Said::Nothing, |earlier| {
            context.earlier_choice_label(earlier.server, earlier.record, member, code)
        });
        let table = self.table.as_deref().map_or(Said::Nothing, |table| {
            context.table_choice_label(server, table, member, code)
        });
        let listed = context.listed_choice_label(server, self.facts.arguments, member, code);
        record.and(table).and(listed)
    }

    fn classify_scalar(
        &mut self,
        member: &str,
        path: &str,
        scalar: &Value,
        effect: &mut ToolCallEffect,
    ) {
        if !is_update_like(self.action) {
            return;
        }
        let Some(earlier) = self.earlier_field(member) else {
            return;
        };
        let new = scalar_text(scalar).unwrap_or_default();
        let coded = earlier.coded.as_ref();
        let same_code = coded.is_some_and(|coded| {
            coded.code == new || (coded.numeric && same_number(&coded.code, scalar))
        });
        effect.effect = if earlier.text == new || same_code {
            ToolCallEffectKind::Unchanged
        } else {
            ToolCallEffectKind::Changed
        };
        let compared_as_code = same_code || (coded.is_some() && scalar_is_number(scalar, &new));
        effect.old = match coded.filter(|_| compared_as_code && !below_a_recipient(path)) {
            Some(coded) => Some(self.old_code_shown(member, path, coded)),
            None => self.old_shown(member, &earlier.text, path).map(|mut old| {
                if old.meaning.is_none()
                    && !old.machine_id
                    && !old.truncated
                    && is_choice_code(&old.text)
                    && !below_a_recipient(path)
                {
                    old.meaning = self.meaning_of(member, path, &old.text);
                }
                old
            }),
        };
        self.used_earlier = true;
    }

    fn fill_old(&mut self, member: &str, path: &str, effect: &mut ToolCallEffect) {
        if let Some(earlier) = self.earlier_field(member) {
            effect.old = self.old_shown(member, &earlier.text, path);
            self.used_earlier = true;
        }
    }

    fn earlier_field(&self, member: &str) -> Option<EarlierField> {
        let record = self.earlier.as_ref()?.record;
        Some(EarlierField {
            text: record.field(member)?.clone(),
            coded: record.coded(member).cloned(),
        })
    }

    /// An earlier value in the form it was compared in: its code, with what
    /// the result said it means unless another source says otherwise.
    fn old_code_shown(&self, member: &str, path: &str, coded: &CodedValue) -> ToolCallEffectValue {
        let cleaned = sanitize_display_text(&coded.code, MAX_DISPLAY_NAME_CHARS);
        ToolCallEffectValue {
            text: cleaned.text,
            truncated: cleaned.truncated,
            machine_id: false,
            meaning: self.meaning_of(member, path, &coded.code),
        }
    }

    /// An earlier ID shows as its record's name, never as the raw ID.
    fn old_shown(
        &mut self,
        member: &str,
        earlier: &str,
        path: &str,
    ) -> Option<ToolCallEffectValue> {
        if below_a_recipient(path) {
            return None;
        }
        if is_machine_id(earlier) || names_an_id(member) {
            let name = self
                .earlier
                .as_ref()
                .and_then(|record| self.facts.context.name_of_id(record.server, earlier));
            return Some(match name {
                Some(name) => ToolCallEffectValue {
                    text: name.to_string(),
                    truncated: false,
                    machine_id: true,
                    meaning: None,
                },
                None if is_machine_id(earlier) => ToolCallEffectValue {
                    text: String::new(),
                    truncated: false,
                    machine_id: true,
                    meaning: None,
                },
                None => ToolCallEffectValue {
                    text: self.clean(earlier),
                    truncated: false,
                    machine_id: false,
                    meaning: None,
                },
            });
        }
        let cleaned = sanitize_display_text(
            text_prefix(earlier, MAX_LABEL_VALUE_CHARS * 8),
            MAX_LABEL_VALUE_CHARS,
        );
        Some(ToolCallEffectValue {
            truncated: cleaned.truncated,
            text: cleaned.text,
            machine_id: false,
            meaning: None,
        })
    }

    fn list_values(&mut self, entries: &[&Value], path: &str, effect: &mut ToolCallEffect) {
        for (index, entry) in entries.iter().enumerate() {
            if effect.values.len() == MAX_LIST_VALUES {
                effect.omitted = u32::try_from(entries.len() - index).unwrap_or(u32::MAX);
                break;
            }
            let entry_path = format!("{path}/{index}");
            let shown = match unwrap(entry, false) {
                Unwrapped::Scalar(scalar) => self.shown(scalar, &entry_path),
                Unwrapped::Empty => None,
                _ => self.shown(entry, &entry_path),
            };
            effect.values.extend(shown);
        }
    }

    /// What a replaced list loses, keeps and gains, where an earlier result
    /// showed the whole list. A list known only in part proves nothing, and a
    /// list that loses nothing replaces nothing.
    fn diff_list(
        &mut self,
        member: &str,
        path: &str,
        entries: &[&Value],
        effect: &mut ToolCallEffect,
    ) {
        let Some(old) = self
            .earlier
            .as_ref()
            .and_then(|earlier| earlier.record.list(member))
            .filter(|old| old.complete)
            .map(|old| old.entries.clone())
        else {
            return;
        };
        let Some(new) = entries
            .iter()
            .map(|entry| list_entry(entry))
            .collect::<Option<Vec<ListEntry>>>()
        else {
            return;
        };
        self.used_earlier = true;
        let mut old_shown = Vec::new();
        for entry in &old {
            let Some(shown) = self.shown(&Value::String(entry.text.clone()), path) else {
                continue;
            };
            old_shown.push(shown.clone());
            if new
                .iter()
                .any(|candidate| list_entries_match(candidate, entry))
            {
                effect.kept.push(shown);
            } else {
                effect.removed.push(shown);
            }
        }
        for entry in &new {
            if !old
                .iter()
                .any(|candidate| list_entries_match(candidate, entry))
            {
                effect
                    .added
                    .extend(self.shown(&Value::String(entry.text.clone()), path));
            }
        }
        if !effect.removed.is_empty() {
            return;
        }
        effect.effect = if effect.added.is_empty() {
            ToolCallEffectKind::Unchanged
        } else {
            ToolCallEffectKind::Changed
        };
        // A machine ID nobody named would have to show raw: no old value then.
        effect.old = old_shown
            .iter()
            .all(|value| !(value.machine_id && value.text.is_empty()))
            .then(|| ToolCallEffectValue {
                text: old_shown
                    .iter()
                    .map(|value| value.text.as_str())
                    .collect::<Vec<_>>()
                    .join(", "),
                truncated: old_shown.iter().any(|value| value.truncated),
                machine_id: false,
                meaning: None,
            });
    }

    fn push(&mut self, effect: ToolCallEffect) -> Pushed {
        let counts = &mut self.change.counts;
        let count = match effect.effect {
            ToolCallEffectKind::Emptied => &mut counts.emptied,
            ToolCallEffectKind::ListReplaced => &mut counts.list_replaced,
            ToolCallEffectKind::Changed => &mut counts.changed,
            ToolCallEffectKind::Set => &mut counts.set,
            ToolCallEffectKind::Unchanged => &mut counts.unchanged,
            ToolCallEffectKind::Unreadable => &mut counts.unreadable,
        };
        *count = count.saturating_add(1);
        let is_loss = matches!(
            effect.effect,
            ToolCallEffectKind::Emptied
                | ToolCallEffectKind::ListReplaced
                | ToolCallEffectKind::Unreadable
        );
        let cap = if is_loss {
            MAX_LOSS_EFFECTS
        } else {
            MAX_EFFECTS
        };
        // A value past the count cap was read and counted, so nothing about
        // it is unknown; only a loss that cannot be stored is.
        if self.change.effects.len() >= cap {
            self.complete &= !is_loss;
            return if is_loss {
                Pushed::NoRoom
            } else {
                Pushed::PastCountCap
            };
        }
        if self.afford(&effect, is_loss) {
            self.change.effects.push(effect);
            Pushed::Stored
        } else {
            self.complete = false;
            Pushed::NoRoom
        }
    }

    /// Whether an effect's path and names still fit what a description stores.
    fn afford(&mut self, effect: &ToolCallEffect, is_loss: bool) -> bool {
        let cost =
            ENTRY_OVERHEAD_BYTES + effect.path.len() + effect.name.len() + effect.raw_name.len();
        let reserve = if is_loss { 0 } else { LOSS_RESERVE_BYTES };
        if self.bytes.saturating_sub(reserve) < cost {
            return false;
        }
        self.bytes -= cost;
        true
    }

    fn flag(&mut self, member: &str, path: &str, name: String, dry_run: bool) {
        if self.change.flags.len() == MAX_FLAGS {
            self.complete = false;
            return;
        }
        let name = self.display_name(&name);
        let raw_name = self.raw_name(member);
        self.change.flags.push(ToolCallFlag {
            name,
            raw_name,
            path: path.to_string(),
            dry_run,
        });
    }

    fn filter(&mut self, value: &'a Value, path: &str) {
        let mut filter = ToolCallFilter {
            path: path.to_string(),
            every_record: false,
            parts: Vec::new(),
            text: None,
            omitted: 0,
        };
        match value {
            Value::Null => filter.every_record = true,
            Value::String(text) if text.trim().is_empty() => filter.every_record = true,
            Value::String(_) | Value::Number(_) | Value::Bool(_) => {
                filter.text = self.shown(value, path);
            }
            Value::Array(entries) if entries.is_empty() => filter.every_record = true,
            Value::Object(members) if members.is_empty() => filter.every_record = true,
            Value::Object(members) => {
                let shared = shared_prefix(members);
                for (member, inner) in members.iter().take(MAX_FILTER_PARTS) {
                    let inner_path = format!("{path}/{}", escape(member));
                    let name = self.member_name(member, shared.as_deref(), "");
                    let name = self.display_name(&name);
                    let is_empty = matches!(unwrap(inner, false), Unwrapped::Empty);
                    let value = if is_empty {
                        Some(ToolCallEffectValue {
                            text: String::new(),
                            truncated: false,
                            machine_id: false,
                            meaning: None,
                        })
                    } else {
                        self.shown(inner, &inner_path)
                    };
                    if let Some(value) = value {
                        filter.parts.push(ToolCallFilterPart {
                            name,
                            value,
                            is_empty,
                        });
                    }
                }
                filter.omitted = u32::try_from(members.len().saturating_sub(MAX_FILTER_PARTS))
                    .unwrap_or(u32::MAX);
                self.complete &= filter.omitted == 0;
            }
            other => filter.text = self.shown(other, path),
        }
        self.change.filter = Some(filter);
    }

    fn recipients(&mut self, member: &str, value: &'a Value, path: &str) {
        let name = readable_name(member, None, "");
        let name = self.display_name(&name);
        let raw_name = self.raw_name(member);
        let kind = match recipients_in(member, &[value]) {
            Some(Recipients::Copy) if bare_member(member).contains("bcc") => {
                ToolCallRecipientKind::Bcc
            }
            Some(Recipients::Copy) => ToolCallRecipientKind::Cc,
            _ => ToolCallRecipientKind::To,
        };
        let entries: Vec<&Value> = match value {
            Value::Array(entries) => entries.iter().collect(),
            value if is_nobody(value) => Vec::new(),
            value => vec![value],
        };
        if entries.is_empty() {
            if is_update_like(self.action) {
                self.value(member, value, path, name);
            }
            return;
        }
        let addresses: Vec<Option<String>> = entries
            .into_iter()
            .flat_map(|entry| match recipient_text(entry) {
                Some(text) => split_addresses(&text).into_iter().map(Some).collect(),
                None => vec![None],
            })
            .collect();
        let count = u32::try_from(addresses.len()).unwrap_or(u32::MAX);
        let known = self.facts.context.organization_domains().is_some();
        let change = self.change.recipients.get_or_insert_with(Default::default);
        change.outside_known = known;
        change.total = change.total.saturating_add(count);
        let mut group = ToolCallRecipientGroup {
            name,
            raw_name,
            kind,
            count,
            values: Vec::new(),
            omitted: 0,
        };
        for address in addresses {
            match address {
                Some(address) if !is_machine_id(&address) => {
                    // Checked as written, so a shortened copy never decides.
                    self.check_outside(&address);
                    let shown = self.display_name(&address);
                    if group.values.len() < MAX_RECIPIENT_VALUES && self.take_bytes(&shown) {
                        group.values.push(shown);
                    } else {
                        group.omitted = group.omitted.saturating_add(1);
                    }
                }
                _ => self.note_unchecked(),
            }
        }
        if let Some(change) = self.change.recipients.as_mut() {
            change.groups.push(group);
        }
    }

    fn note_unchecked(&mut self) {
        if let Some(change) = self.change.recipients.as_mut() {
            change.unchecked = change.unchecked.saturating_add(1);
        }
    }

    fn check_outside(&mut self, address: &str) {
        let Some(domain) = email_domain(address) else {
            self.note_unchecked();
            return;
        };
        let known = self.facts.context.organization_domains().is_some();
        if !known || self.facts.context.is_inside_organization(domain) {
            return;
        }
        let shown = self.display_name(address);
        let fits = self.take_bytes(&shown);
        let Some(change) = self.change.recipients.as_mut() else {
            return;
        };
        if change.outside.len() < MAX_OUTSIDE && fits {
            change.outside.push(shown);
        } else {
            change.outside_omitted = change.outside_omitted.saturating_add(1);
        }
    }

    fn opaque(&mut self, member: &str, value: &'a Value, path: &str, name: &str) -> bool {
        let Some((kind, text)) = opaque_kind(member, value) else {
            return false;
        };
        if self.change.opaque.len() == MAX_OPAQUE {
            self.change.opaque_omitted = self.change.opaque_omitted.saturating_add(1);
            self.complete = false;
            return true;
        }
        let raw = text.as_ref();
        let found = findings(kind, raw);
        let write_inside_read = kind == ToolCallOpaqueKind::Sql
            && !found.is_empty()
            && SQL_READ_STARTS.contains(&first_word(raw).as_str());
        let cleaned = sanitize_display_text(
            text_prefix(raw, MAX_STORED_TEXT_CHARS * 8),
            MAX_STORED_TEXT_CHARS,
        );
        self.hidden |= cleaned.hidden_characters;
        if !self.take_bytes(&cleaned.text) {
            self.change.opaque_omitted = self.change.opaque_omitted.saturating_add(1);
            return true;
        }
        let name = self.display_name(name);
        let raw_name = self.raw_name(member);
        self.change.opaque.push(ToolCallOpaque {
            kind,
            name,
            raw_name,
            path: path.to_string(),
            truncated: cleaned.truncated,
            text: cleaned.text,
            lines: line_count(raw),
            found,
            write_inside_read,
        });
        true
    }

    fn text(&mut self, member: &str, value: &'a Value, path: &str, name: &str) {
        let Value::String(raw) = value else {
            return;
        };
        if self.before.is_some_and(|before| before == path) {
            return;
        }
        if self.change.texts.len() == MAX_TEXTS {
            self.change.texts_omitted = self.change.texts_omitted.saturating_add(1);
            self.complete = false;
            return;
        }
        let cleaned = sanitize_display_text(
            text_prefix(raw, MAX_STORED_TEXT_CHARS * 8),
            MAX_STORED_TEXT_CHARS,
        );
        self.hidden |= cleaned.hidden_characters;
        if cleaned.text.is_empty() {
            if is_update_like(self.action) {
                self.value(member, value, path, name.to_string());
            }
            return;
        }
        if !self.take_bytes(&cleaned.text) {
            self.change.texts_omitted = self.change.texts_omitted.saturating_add(1);
            return;
        }
        let name = self.display_name(name);
        let raw_name = self.raw_name(member);
        let before = self.before_text();
        self.change.texts.push(ToolCallTextChange {
            path: path.to_string(),
            name,
            raw_name,
            truncated: cleaned.truncated,
            text: cleaned.text,
            lines: line_count(raw),
            chars: u32::try_from(raw.chars().count()).unwrap_or(u32::MAX),
            before,
        });
    }

    /// The text the call says it replaces, stored once however many texts
    /// it writes.
    fn before_text(&mut self) -> Option<ToolCallEffectValue> {
        if self.before_stored {
            return None;
        }
        self.before_stored = true;
        let path = self.before?;
        let raw = self.facts.arguments.pointer(path)?.as_str()?;
        let cleaned = sanitize_display_text(
            text_prefix(raw, MAX_STORED_TEXT_CHARS * 8),
            MAX_STORED_TEXT_CHARS,
        );
        self.hidden |= cleaned.hidden_characters;
        if !self.take_bytes(&cleaned.text) {
            return None;
        }
        (!cleaned.text.is_empty()).then_some(ToolCallEffectValue {
            truncated: cleaned.truncated,
            text: cleaned.text,
            machine_id: false,
            meaning: None,
        })
    }

    fn batch(&mut self, entries: &'a [Value], path: &str, name: &str) {
        if let Some(batch) = self.change.batch.as_mut() {
            // One list of rows is the call's batch; a second is left to the
            // raw call, and what no row does can no longer be said.
            batch.read_all = false;
            self.complete = false;
            return;
        }
        let name = self.display_name(name);
        let total = u32::try_from(entries.len()).unwrap_or(u32::MAX);
        let read = entries.len().min(MAX_ROWS_READ);
        // With no verb nothing counts as a loss, so none can be ruled out.
        let mut read_all = read == entries.len() && self.action != ToolCallAction::Other;
        let mut operations: BTreeMap<u8, (ToolCallAction, u32)> = BTreeMap::new();
        let mut shapes: HashSet<u64> = HashSet::new();
        let mut tallies: Vec<FieldTally> = Vec::new();
        let mut order: HashMap<&'a str, usize> = HashMap::new();
        let mut rows_emptying = 0u32;
        let mut rows_replacing_lists = 0u32;
        let mut deletions = 0u32;
        let mut deleted: Vec<usize> = Vec::new();
        for (index, row) in entries.iter().take(read).enumerate() {
            let Value::Object(members) = row else {
                continue;
            };
            let action = row_action(members);
            let is_delete = action == Some(ToolCallAction::Delete)
                || (self.action == ToolCallAction::Delete && action.is_none());
            if is_delete {
                deletions = deletions.saturating_add(1);
                deleted.push(index);
            }
            if let Some(action) = action {
                operations
                    .entry(action_rank(action))
                    .or_insert((action, 0))
                    .1 += 1;
            }
            let row_path = format!("{path}/{index}");
            let shared = shared_prefix(members);
            let mut empties = false;
            let mut replaces = false;
            let mut shape: Vec<(&str, u64)> = Vec::new();
            for (member, value) in members {
                if self.nodes == 0 {
                    self.complete = false;
                    read_all = false;
                    break;
                }
                self.nodes -= 1;
                let value_path = format!("{row_path}/{}", escape(member));
                if is_verb_field(member, value)
                    || is_row_identifier(member, value)
                    || self.row_member_left_out(&value_path, value)
                {
                    continue;
                }
                let hash = value_hash(value);
                shape.push((member.as_str(), hash));
                let at = *order.entry(member.as_str()).or_insert_with(|| {
                    let name = self.member_name(member, shared.as_deref(), "");
                    tallies.push(FieldTally::new(member, name));
                    tallies.len() - 1
                });
                let update_like =
                    is_update_like(self.action) || action == Some(ToolCallAction::Update);
                match unwrap(value, is_plural(member)) {
                    Unwrapped::Empty if update_like => {
                        empties = true;
                        tallies[at].emptied += 1;
                    }
                    Unwrapped::List(_) if update_like && !only_adds(member) => {
                        self.saw_list = true;
                        if !self.says.adds_to_list {
                            replaces = true;
                            tallies[at].lists += 1;
                        }
                    }
                    // What such a value holds was not looked at.
                    Unwrapped::Other => read_all = false,
                    _ => {}
                }
                tallies[at].rows += 1;
                // An emptied row is counted as that, not as one more value.
                if !matches!(unwrap(value, false), Unwrapped::Empty) {
                    let tally = &mut tallies[at];
                    if tally.distinct.len() < MAX_DISTINCT_TRACKED {
                        let new = tally.distinct.insert(hash);
                        if new && tally.first.len() < MAX_FIELD_SAMPLES {
                            tally.first.push((value, value_path));
                        }
                    }
                }
            }
            rows_emptying += u32::from(empties);
            rows_replacing_lists += u32::from(replaces);
            // A row's own operation is part of what it does.
            let operation = action.map_or(u8::MAX, action_rank);
            shape.push(("", u64::from(operation)));
            shape.sort_unstable();
            shapes.insert({
                use std::hash::{Hash, Hasher};
                let mut hasher = std::collections::hash_map::DefaultHasher::new();
                shape.hash(&mut hasher);
                hasher.finish()
            });
        }
        // Deletions first, so a long batch cannot hide them behind other rows.
        let mut chosen = deleted.clone();
        chosen.extend(
            (0..read)
                .filter(|index| deleted.binary_search(index).is_err())
                .take(MAX_BATCH_ROWS),
        );
        chosen.truncate(MAX_BATCH_ROWS);
        let mut rows = Vec::with_capacity(chosen.len());
        for index in chosen {
            let Some(Value::Object(members)) = entries.get(index) else {
                continue;
            };
            if self.bytes < ENTRY_OVERHEAD_BYTES {
                self.complete = false;
                break;
            }
            self.bytes -= ENTRY_OVERHEAD_BYTES;
            rows.push(self.batch_row(index, members, path));
        }
        // Fields past a row's cap were never compared on the card.
        let every_field_stated = !rows.is_empty()
            && rows
                .iter()
                .all(|row: &ToolCallBatchRow| row.effects_omitted == 0);
        let same_change = read_all && every_field_stated && shapes.len() == 1 && total > 1;
        let shared = same_change
            .then(|| rows.first().map(|row| row.effects.clone()))
            .flatten()
            .unwrap_or_default();
        let fields_omitted =
            u32::try_from(tallies.len().saturating_sub(MAX_BATCH_FIELDS)).unwrap_or(u32::MAX);
        let fields = tallies
            .into_iter()
            .take(MAX_BATCH_FIELDS)
            .map(|tally| self.batch_field(tally))
            .collect();
        self.change.batch = Some(ToolCallBatch {
            path: path.to_string(),
            name,
            total,
            same_change,
            shared,
            rows,
            deletions,
            rows_emptying,
            rows_replacing_lists,
            operations: operations
                .into_values()
                .map(|(action, count)| ToolCallBatchOperation { action, count })
                .collect(),
            fields,
            fields_omitted,
            read_all,
        });
    }

    fn batch_row(
        &mut self,
        index: usize,
        members: &'a Map<String, Value>,
        path: &str,
    ) -> ToolCallBatchRow {
        let row_path = format!("{path}/{index}");
        let number = u32::try_from(index + 1).unwrap_or(u32::MAX);
        let shared = shared_prefix(members);
        let edit = text_edit(members);
        let mut name = None;
        let mut name_from_earlier = false;
        let mut effects = Vec::new();
        let mut effects_omitted = 0u32;
        // A row only compares with what an earlier read said about that row.
        let row_earlier = self.row_record(members);
        let call_earlier = std::mem::replace(&mut self.earlier, row_earlier);
        for (member, value) in members {
            let value_path = format!("{row_path}/{}", escape(member));
            if is_verb_field(member, value)
                || self.row_member_left_out(&value_path, value)
                || edit.is_some_and(|(before, _)| before == member.as_str())
            {
                continue;
            }
            if is_row_identifier(member, value) {
                if name.is_none() {
                    name_from_earlier = is_machine_id(value.as_str().unwrap_or_default());
                    name = self.row_label(value, &value_path);
                }
                continue;
            }
            if effects.len() == MAX_ROW_EFFECTS {
                effects_omitted = effects_omitted.saturating_add(1);
                continue;
            }
            let readable = self.member_name(member, shared.as_deref(), "");
            let effect = match edit {
                Some((before, after)) if after == member.as_str() => {
                    self.text_edit_effect(member, before, members, value, &value_path, readable)
                }
                _ => self.effect(member, value, &value_path, readable),
            };
            let stored = self.afford(&effect, effect.effect == ToolCallEffectKind::Emptied);
            if stored {
                effects.push(effect);
            } else {
                effects_omitted = effects_omitted.saturating_add(1);
                self.complete = false;
            }
        }
        self.earlier = call_earlier;
        ToolCallBatchRow {
            number,
            name,
            name_from_earlier,
            action: row_action(members),
            effects,
            effects_omitted,
        }
    }

    /// Whether a row member is consent or a lookup's name. A name left empty
    /// in a row shaped like a lookup is still a value the row empties.
    fn row_member_left_out(&self, path: &str, value: &Value) -> bool {
        match rules::claim(self.facts.arguments, path, self.facts.approval_argument) {
            Some(Claim::Consent) => true,
            Some(Claim::LookupName) => !matches!(unwrap(value, false), Unwrapped::Empty),
            None => false,
        }
    }

    /// What an earlier read said about this row, by its own ID.
    fn row_record(&self, members: &Map<String, Value>) -> Option<EarlierRecord<'a>> {
        let server = self.facts.server?;
        let id = members
            .iter()
            .find(|(member, value)| names_an_id(member) && is_scalar(value))
            .and_then(|(_, value)| scalar_text(value))?;
        let record = self.facts.context.record_by_id(server, &id)?;
        Some(EarlierRecord { record, server })
    }

    fn batch_field(&mut self, tally: FieldTally<'a>) -> ToolCallBatchField {
        let samples = tally
            .first
            .iter()
            .filter_map(|(value, path)| self.shown(value, path))
            .collect();
        ToolCallBatchField {
            name: self.display_name(&tally.name),
            raw_name: self.raw_name(tally.raw_name),
            rows: tally.rows,
            emptied: tally.emptied,
            lists_replaced: tally.lists,
            distinct: u32::try_from(tally.distinct.len()).unwrap_or(u32::MAX),
            distinct_capped: tally.distinct.len() >= MAX_DISTINCT_TRACKED,
            samples,
        }
    }

    /// One row's old-text → new-text edit, as a single changed value.
    fn text_edit_effect(
        &mut self,
        member: &str,
        before: &str,
        members: &Map<String, Value>,
        value: &Value,
        path: &str,
        name: String,
    ) -> ToolCallEffect {
        let mut effect = self.effect(member, value, path, name);
        let old = members.get(before).and_then(|old| self.shown(old, path));
        if old.is_some() {
            effect.effect = ToolCallEffectKind::Changed;
            effect.old = old;
        }
        effect
    }

    /// A row's own label: its name, or a human-readable identifier.
    fn row_label(&mut self, value: &Value, path: &str) -> Option<String> {
        let shown = self.shown(value, path)?;
        (!shown.text.is_empty()).then_some(shown.text)
    }

    fn finish(mut self, facts: &ChangeFacts<'_>) -> (ToolCallChange, bool) {
        let action = self.action;
        self.change.complete = self.complete;
        self.change.consent_left_out = self.consent_left_out;
        self.change.record_unread = self.record_unread;
        if self.places.len() > 1 {
            self.places.sort_by_key(|(order, _)| *order);
            let joined: Vec<&str> = self.places.iter().map(|(_, text)| text.as_str()).collect();
            self.change.place = Some(joined.join(" / "));
        } else {
            self.change.place = self.places.pop().map(|(_, text)| text);
        }
        let mut notes = Vec::new();
        let says = &self.says;
        let marked_destructive = facts
            .tool
            .annotations
            .as_ref()
            .and_then(|hints| hints.destructive_hint)
            == Some(true);
        let source = facts.destructive_hint_source;
        // An update lists what it changes, which says more than the mark;
        // an operator's override is said wherever it applies.
        if marked_destructive && (source.is_override() || !is_update_like(action)) {
            notes.push(if source.is_operators() {
                ToolCallChangeNote::OperatorMarkedDestructive
            } else {
                ToolCallChangeNote::MarkedDestructive
            });
        }
        if matches!(action, ToolCallAction::Delete | ToolCallAction::Archive) {
            match says.keeps_after_delete() {
                Some(ToolCallChangeNote::ToolSaysPermanent) => {
                    notes.push(ToolCallChangeNote::ToolSaysPermanent)
                }
                Some(ToolCallChangeNote::ToolSaysRestorable) => {
                    notes.push(ToolCallChangeNote::ToolSaysRestorable)
                }
                _ => notes.push(ToolCallChangeNote::DeleteOutcomeUnknown),
            }
        }
        if self.saw_list {
            notes.push(if says.adds_to_list {
                ToolCallChangeNote::ToolSaysAddsToList
            } else if says.replaces_list {
                ToolCallChangeNote::ToolSaysReplacesList
            } else {
                ToolCallChangeNote::ListReplaceUnknown
            });
        }
        if says.ignored_if_missing && is_update_like(action) {
            notes.push(ToolCallChangeNote::ToolSaysIgnoredIfMissing);
        }
        if self
            .change
            .opaque
            .iter()
            .any(|opaque| opaque.kind == ToolCallOpaqueKind::Sql)
            || self
                .change
                .filter
                .as_ref()
                .is_some_and(|filter| !filter.every_record)
        {
            notes.push(ToolCallChangeNote::RowCountUnknown);
        }
        if self
            .change
            .opaque
            .iter()
            .any(|opaque| opaque.kind == ToolCallOpaqueKind::Instruction)
        {
            notes.push(ToolCallChangeNote::InstructionOutcomeUnknown);
        }
        if self.used_earlier {
            notes.push(ToolCallChangeNote::OldValuesFromEarlier);
        }
        let counts = self.change.counts;
        if counts.unchanged > 0
            && counts.emptied
                + counts.list_replaced
                + counts.changed
                + counts.set
                + counts.unreadable
                == 0
            && self.change.texts.is_empty()
            && self.change.opaque.is_empty()
            && self.change.batch.is_none()
            && self.change.recipients.is_none()
            && self.change.filter.is_none()
            && self.change.flags.is_empty()
            && !self.consent_left_out
            && self.complete
        {
            notes.push(ToolCallChangeNote::NothingChanges);
        }
        self.change.notes = notes;
        (self.change, self.hidden)
    }
}

/// A table's name a card can read as part of a kind: one word of letters,
/// digits, `_`, `-` or `.`. Anything else is a value like any other.
fn is_table_name(text: &str) -> bool {
    const MAX_TABLE_NAME_CHARS: usize = 64;
    let text = text.trim();
    !text.is_empty()
        && text.chars().count() <= MAX_TABLE_NAME_CHARS
        && text
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | '.'))
}

/// Whether the one record an item names is named only by a machine ID no
/// result in this chat held: no title names it, its single ID is a machine
/// ID nothing resolved, and the chat's results, all read whole, never showed
/// that ID in any form.
fn record_unread(item: &ToolCallLabelItem, facts: &ChangeFacts<'_>) -> bool {
    let titled = item
        .title
        .as_ref()
        .is_some_and(|title| !title.values.is_empty());
    let Some(id) = item.id.as_ref().filter(|id| id.omitted == 0) else {
        return false;
    };
    let [only] = id.values.as_slice() else {
        return false;
    };
    !titled
        && only.machine_id
        && only.resolved.is_none()
        && facts.context.never_read(facts.arguments, &only.path)
}

/// A call's own text can never pose as the mark for a hidden ID.
fn without_mark(text: &str) -> String {
    text.replace(HIDDEN_ID_MARK, "")
}

fn is_update_like(action: ToolCallAction) -> bool {
    matches!(action, ToolCallAction::Update | ToolCallAction::Upsert)
}

fn scalar_is_number(scalar: &Value, text: &str) -> bool {
    scalar.is_number() || text.parse::<f64>().is_ok()
}

/// `4` and `4.0` written as JSON numbers are one value.
fn same_number(code: &str, scalar: &Value) -> bool {
    scalar
        .as_f64()
        .zip(code.parse::<f64>().ok())
        .is_some_and(|(new, old)| new == old)
}

fn is_one_of(member: &str, names: &[&str]) -> bool {
    names.iter().any(|name| member.eq_ignore_ascii_case(name))
}

fn is_scalar(value: &Value) -> bool {
    matches!(value, Value::String(_) | Value::Number(_))
}

fn scalar_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Number(_) | Value::Bool(_) => Some(value.to_string()),
        _ => None,
    }
}

fn below_a_recipient(path: &str) -> bool {
    super::pointer::member_names(path)
        .iter()
        .any(|member| super::recipients::is_recipient_member(member))
}

fn is_verb_field(member: &str, value: &Value) -> bool {
    is_one_of(member, &rules::VERB_FIELDS)
        && value.as_str().is_some_and(|text| {
            !text.chars().any(char::is_whitespace) && text.chars().count() <= 40
        })
}

fn is_record(value: &Value) -> bool {
    value.as_object().is_some_and(|members| members.len() > 1)
}

/// What one field does across a batch's rows.
struct FieldTally<'a> {
    name: String,
    raw_name: &'a str,
    rows: u32,
    emptied: u32,
    lists: u32,
    distinct: HashSet<u64>,
    first: Vec<(&'a Value, String)>,
}

impl<'a> FieldTally<'a> {
    fn new(member: &'a str, name: String) -> Self {
        Self {
            name,
            raw_name: member,
            rows: 0,
            emptied: 0,
            lists: 0,
            distinct: HashSet::new(),
            first: Vec::new(),
        }
    }
}

/// A list of rows, as opposed to a list of links or wrapped values.
fn is_batch(entries: &[Value]) -> bool {
    entries.len() > 1
        && entries.iter().all(Value::is_object)
        && entries
            .iter()
            .any(|entry| matches!(unwrap(entry, false), Unwrapped::Other))
}

/// `labels` and `people`: a one-entry list of these is still a list, while
/// `title` as `[{"text": {"content": "x"}}]` is one wrapped value.
pub(super) fn is_plural(member: &str) -> bool {
    name_words(member)
        .last()
        .is_some_and(|word| word.ends_with('s') || word == "people")
}

fn value_hash(value: &Value) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    value.to_string().hash(&mut hasher);
    hasher.finish()
}

/// `addLabels`, `append_items`: the member's own name says it adds.
fn only_adds(member: &str) -> bool {
    name_words(member)
        .first()
        .is_some_and(|word| matches!(word.as_str(), "add" | "append" | "include"))
}

/// Where a place member sits in what the card says, broadest first.
fn place_order(member: &str) -> usize {
    const ORDER: [&str; 7] = [
        "owner",
        "organization",
        "repository",
        "repo",
        "objectname",
        "namespace",
        "branch",
    ];
    ORDER
        .iter()
        .position(|name| member.eq_ignore_ascii_case(name))
        .unwrap_or(ORDER.len())
}

/// Old-text and new-text members of one row, as (before, after).
fn text_edit(members: &Map<String, Value>) -> Option<(&str, &str)> {
    let find = |names: &[&str]| {
        members
            .keys()
            .find(|key| is_one_of(key, names))
            .map(String::as_str)
    };
    find(&BEFORE_TEXT_MEMBERS).zip(find(&AFTER_TEXT_MEMBERS))
}

fn line_count(text: &str) -> u32 {
    u32::try_from(text.split('\n').count()).unwrap_or(u32::MAX)
}

fn is_dry_run(member: &str) -> bool {
    let words = name_words(member);
    words
        .iter()
        .any(|word| DRY_RUN_WORDS.contains(&word.as_str()))
        || (words.iter().any(|word| word == "validate") && words.iter().any(|word| word == "only"))
        || (words.iter().any(|word| word == "what") && words.iter().any(|word| word == "if"))
}

fn is_behaviour_flag(member: &str) -> bool {
    name_words(member)
        .iter()
        .any(|word| FLAG_WORDS.contains(&word.as_str()))
}

/// The prefix most keys of an object share, words joined by `_` or `-`, when
/// dropping it leaves every key a name; only then, so `notify_owners` never
/// becomes "Owners" for sitting beside other keys.
fn shared_prefix(members: &Map<String, Value>) -> Option<String> {
    if members.len() < 3 {
        return None;
    }
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for member in members
        .keys()
        .filter(|member| !member.chars().any(char::is_whitespace))
    {
        if let Some((prefix, rest)) = member.split_once(['_', '-'])
            && !rest.is_empty()
        {
            *counts.entry(prefix).or_default() += 1;
        }
    }
    let (prefix, count) = counts.into_iter().max_by_key(|(_, count)| *count)?;
    (count * 2 > members.len()).then(|| prefix.to_string())
}

/// A member as a person reads it. A name with spaces or punctuation is already
/// one; a machine name (`renewal_due_on`, `renewalDueOn`) is split into words,
/// without the prefix most of its neighbours share. Nothing is guessed from
/// its meaning. `prefix` names the object it sits in.
fn readable_name(member: &str, shared: Option<&str>, prefix: &str) -> String {
    if member.is_empty() {
        return prefix.trim_end_matches(" · ").to_string();
    }
    let humanised = if is_machine_id(member) {
        HIDDEN_ID_MARK.to_string()
    } else {
        without_mark(&member_words(member, shared))
    };
    format!("{prefix}{humanised}")
}

fn member_words(member: &str, shared: Option<&str>) -> String {
    let (head, annotation) = match member.split_once('@') {
        Some((head, annotation)) if !head.is_empty() && !annotation.is_empty() => {
            (head, Some(annotation))
        }
        _ => (member, None),
    };
    let _ = annotation;
    if head
        .chars()
        .any(|c| !(c.is_alphanumeric() || matches!(c, '_' | '-' | '.')))
    {
        return member.to_string();
    }
    let stripped = shared
        .and_then(|prefix| {
            head.strip_prefix(prefix)
                .and_then(|rest| rest.strip_prefix(['_', '-']))
        })
        .filter(|rest| !rest.is_empty())
        .unwrap_or(head);
    let mut words: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut after_lower = false;
    for c in stripped.chars() {
        if matches!(c, '_' | '-' | '.') {
            if !current.is_empty() {
                words.push(std::mem::take(&mut current));
            }
            after_lower = false;
            continue;
        }
        if c.is_uppercase() && after_lower && !current.is_empty() {
            words.push(std::mem::take(&mut current));
        }
        current.push(c);
        after_lower = c.is_lowercase() || c.is_ascii_digit();
    }
    if !current.is_empty() {
        words.push(current);
    }
    if words.is_empty() {
        return member.to_string();
    }
    let words: Vec<String> = words
        .iter()
        .flat_map(|word| super::words::split_glued(word))
        .collect();
    words
        .iter()
        .enumerate()
        .map(|(index, word)| {
            let lower = word.to_lowercase();
            if matches!(lower.as_str(), "id" | "ids" | "url" | "urls") {
                return lower.to_uppercase();
            }
            if index == 0 {
                let mut chars = word.chars();
                match chars.next() {
                    Some(first) => first.to_uppercase().chain(chars).collect(),
                    None => String::new(),
                }
            } else if word.chars().all(|c| !c.is_lowercase()) {
                word.clone()
            } else {
                lower
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// A value reduced past its wrappers: a `{"select": {"name": "x"}}` or
/// `[{"text": {"content": "x"}}]` is what it holds.
pub(super) enum Unwrapped<'a> {
    Empty,
    Scalar(&'a Value),
    List(Vec<&'a Value>),
    Other,
}

/// Keys of a wrapper object, best first, that hold what it stands for.
const VALUE_KEYS: [&str; 10] = [
    "displayName",
    "name",
    "title",
    "value",
    "plain_text",
    "content",
    "login",
    "key",
    "number",
    "id",
];

pub(super) fn unwrap(value: &Value, list_like: bool) -> Unwrapped<'_> {
    let mut current = value;
    for _ in 0..8 {
        match current {
            Value::Null => return Unwrapped::Empty,
            Value::String(text) if text.trim().is_empty() => return Unwrapped::Empty,
            Value::String(_) | Value::Number(_) | Value::Bool(_) => {
                return Unwrapped::Scalar(current);
            }
            Value::Array(entries) if entries.is_empty() => return Unwrapped::Empty,
            Value::Array(entries) => {
                if let [only] = entries.as_slice()
                    && only.is_object()
                    && !list_like
                {
                    current = only;
                    continue;
                }
                return Unwrapped::List(entries.iter().collect());
            }
            Value::Object(members) if members.is_empty() => return Unwrapped::Empty,
            Value::Object(members) => {
                if let Some(id) = link_id_member(members)
                    && let Some(id) = members.get(id)
                {
                    return Unwrapped::Scalar(id);
                }
                if let Some(next) = wrapped_value(members) {
                    current = next;
                    continue;
                }
                return Unwrapped::Other;
            }
        }
    }
    Unwrapped::Other
}

/// What a wrapper object holds: its one member, or its best value key when it
/// holds only such keys.
pub(super) fn wrapped_value(members: &Map<String, Value>) -> Option<&Value> {
    if members.len() == 1 {
        return members.values().next();
    }
    if !members
        .keys()
        .all(|key| VALUE_KEYS.iter().any(|name| key.eq_ignore_ascii_case(name)))
    {
        return None;
    }
    VALUE_KEYS.iter().find_map(|name| {
        members
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value)
    })
}

fn is_link_shaped(member: &str, value: &Value) -> bool {
    member.contains("@odata.bind")
        || value.as_object().is_some_and(is_link)
        || value
            .as_str()
            .is_some_and(|text| id_inside_a_link_path(text).is_some())
}

fn is_nobody(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::String(text) => text.trim().is_empty(),
        Value::Object(members) => members.is_empty(),
        Value::Array(entries) => entries.is_empty(),
        _ => false,
    }
}

/// How a recipient reads: an address as written, or the address member of a
/// recipient object, however deep the object holds it.
fn recipient_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.trim().to_string()),
        Value::Number(number) => Some(number.to_string()),
        Value::Object(members) => {
            for (key, member) in members {
                if ADDRESS_MEMBERS.contains(&bare_member(key).as_str()) {
                    let text = recipient_text(member);
                    if text.is_some() {
                        return text;
                    }
                }
            }
            link_id_member(members)
                .and_then(|id| members.get(id))
                .and_then(recipient_text)
        }
        _ => None,
    }
}

/// The addresses a text holds: `a@b, "Doe, Jo" <c@d>; e@f` is three. Commas
/// and semicolons inside quotes or angle brackets do not split, and a text
/// with no `@` stays one recipient.
fn split_addresses(text: &str) -> Vec<String> {
    let text = text.trim();
    if !text.contains('@') {
        return vec![text.to_string()];
    }
    let mut out = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    let mut angled = false;
    for c in text.chars() {
        match c {
            '"' => {
                quoted = !quoted;
                current.push(c);
            }
            '<' if !quoted => {
                angled = true;
                current.push(c);
            }
            '>' if !quoted => {
                angled = false;
                current.push(c);
            }
            ',' | ';' if !quoted && !angled => {
                if !current.trim().is_empty() {
                    out.push(current.trim().to_string());
                }
                current.clear();
            }
            c => current.push(c),
        }
    }
    if !current.trim().is_empty() {
        out.push(current.trim().to_string());
    }
    out
}

/// The domain of `Display Name <a@b>` or `a@b`, read only from a plain ASCII
/// host name. Anything else cannot be checked, and the caller says so.
fn email_domain(address: &str) -> Option<&str> {
    let bare = match address.rsplit_once('<') {
        Some((_, rest)) => rest.strip_suffix('>')?,
        None => address,
    }
    .trim();
    let (local, domain) = bare.split_once('@')?;
    let host_name = !domain.is_empty()
        && domain
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-'));
    (!local.is_empty()
        && !local.contains(['"', '<', '>', ' ', ','])
        && host_name
        && !is_phone_shaped(bare))
    .then_some(domain.trim_end_matches('.'))
}

/// Whether a row member is what identifies the row rather than a value it
/// writes: its ID or name, a machine ID, or a path a file is filed under.
fn is_row_identifier(member: &str, value: &Value) -> bool {
    const ROW_NAMES: [&str; 12] = [
        "name",
        "title",
        "subject",
        "summary",
        "displayname",
        "filename",
        "file_name",
        "path",
        "file_path",
        "file",
        "key",
        "sku",
    ];
    let names_nothing = value.as_str().is_some_and(|text| text.trim().is_empty());
    is_scalar(value)
        && !names_nothing
        && (names_an_id(member)
            || is_one_of(member, &ROW_NAMES)
            || value.as_str().is_some_and(is_machine_id))
}

/// What a row's own verb field says it does, if it names one.
fn row_action(members: &Map<String, Value>) -> Option<ToolCallAction> {
    let found = members.iter().find_map(|(member, value)| {
        is_verb_field(member, value)
            .then(|| value.as_str())
            .flatten()
    })?;
    rules::action_of(found)
}

fn action_rank(action: ToolCallAction) -> u8 {
    match action {
        ToolCallAction::Create => 0,
        ToolCallAction::Update => 1,
        ToolCallAction::Upsert => 2,
        ToolCallAction::Delete => 3,
        ToolCallAction::Archive => 4,
        ToolCallAction::Move => 5,
        ToolCallAction::Send => 6,
        ToolCallAction::Share => 7,
        ToolCallAction::Comment => 8,
        ToolCallAction::Upload => 9,
        ToolCallAction::Run => 10,
        ToolCallAction::Other => 11,
    }
}

fn first_word(text: &str) -> String {
    text.trim_start()
        .chars()
        .take_while(|c| c.is_alphanumeric() || *c == '_')
        .flat_map(char::to_lowercase)
        .collect()
}

/// The content a member holds that only reading it could explain, and what
/// kind it is. A verb field holding an identifier is no such content.
fn opaque_kind<'a>(
    member: &str,
    value: &'a Value,
) -> Option<(ToolCallOpaqueKind, std::borrow::Cow<'a, str>)> {
    if is_verb_field(member, value) {
        return None;
    }
    let text: std::borrow::Cow<'a, str> = match value {
        Value::String(text) if !text.trim().is_empty() => std::borrow::Cow::Borrowed(text),
        Value::Array(entries)
            if is_one_of(member, &SHELL_MEMBERS)
                && !entries.is_empty()
                && entries.iter().all(Value::is_string) =>
        {
            let joined = entries
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(" ");
            std::borrow::Cow::Owned(joined)
        }
        _ => return None,
    };
    let words = name_words(member);
    let last = words.last().map(String::as_str).unwrap_or_default();
    let kind = if SQL_MEMBERS.contains(&last) {
        let start = first_word(&text);
        if matches!(start.as_str(), "query" | "mutation") && text.contains('{') {
            ToolCallOpaqueKind::Code
        } else if last == "query" && !is_sql_statement(&text) {
            // A search box's text is a value, whatever words it holds.
            return None;
        } else {
            ToolCallOpaqueKind::Sql
        }
    } else if SHELL_MEMBERS.contains(&last) {
        ToolCallOpaqueKind::Shell
    } else if CODE_MEMBERS.contains(&last) {
        // `country_code` and `resource` usually hold a plain value.
        if !looks_like_code(&text) {
            return None;
        }
        ToolCallOpaqueKind::Code
    } else if INSTRUCTION_MEMBERS.contains(&last) {
        ToolCallOpaqueKind::Instruction
    } else {
        return None;
    };
    Some((kind, text))
}

fn looks_like_code(text: &str) -> bool {
    text.contains('\n') || text.contains(['(', '{', ';', '=', '<'])
}

/// Whether `text` has the shape of an SQL statement, not just its first word:
/// "delete pages about Q4" is a search, "delete from pages" a statement.
pub(super) fn is_sql_statement(text: &str) -> bool {
    let lower = text_prefix(text, MAX_SCAN_BYTES)
        .trim_start()
        .to_lowercase();
    let words: Vec<&str> = lower
        .split(|c: char| !(c.is_alphanumeric() || c == '_'))
        .filter(|word| !word.is_empty())
        .collect();
    let second = words.get(1).copied().unwrap_or_default();
    let has = |word: &str| words.contains(&word);
    match words.first().copied().unwrap_or_default() {
        "select" => has("from") || lower.contains('*') || lower.contains('('),
        "with" => lower.contains(" as (") || lower.contains(" as("),
        "insert" | "merge" => second == "into",
        "update" => has("set") && lower.contains('='),
        "delete" => second == "from",
        "drop" | "create" | "alter" => SQL_OBJECTS.contains(&second),
        "truncate" => second == "table" || lower.trim_end().ends_with(';'),
        "grant" | "revoke" => has("on") && (has("to") || has("from")),
        "call" => lower.contains('('),
        "explain" => matches!(
            second,
            "select" | "analyze" | "insert" | "update" | "delete" | "with"
        ),
        _ => false,
    }
}

/// Words joined by spaces, with a word no command or statement would hold:
/// someone's description of a task rather than the task.
fn is_prose(text: &str) -> bool {
    let words: Vec<&str> = text.split_whitespace().collect();
    words.len() >= 3
        && words.iter().all(|word| {
            word.chars()
                .all(|c| c.is_alphabetic() || matches!(c, ',' | '.' | '\'' | '?' | '!'))
        })
        && words.iter().any(|word| {
            PROSE_WORDS.contains(
                &word
                    .trim_end_matches([',', '.', '?', '!'])
                    .to_lowercase()
                    .as_str(),
            )
        })
}

fn findings(kind: ToolCallOpaqueKind, text: &str) -> Vec<String> {
    let real_statement = match kind {
        ToolCallOpaqueKind::Sql => is_sql_statement(text),
        ToolCallOpaqueKind::Shell | ToolCallOpaqueKind::Code => !is_prose(text),
        ToolCallOpaqueKind::Instruction => false,
    };
    if !real_statement {
        return Vec::new();
    }
    let text = text_prefix(text, MAX_SCAN_BYTES);
    let words: Vec<String> = text
        .nfkc()
        .collect::<String>()
        .split(|c: char| !(c.is_alphanumeric() || c == '_'))
        .filter(|word| !word.is_empty())
        .map(str::to_string)
        .collect();
    let mut found = Vec::new();
    let mut add = |word: &str| {
        if !found.iter().any(|seen| seen == word) && found.len() < MAX_FOUND_WORDS {
            found.push(word.to_string());
        }
    };
    match kind {
        ToolCallOpaqueKind::Sql => {
            for word in &words {
                let upper = word.to_uppercase();
                if SQL_WRITE_WORDS.contains(&upper.as_str()) {
                    add(&upper);
                }
            }
        }
        ToolCallOpaqueKind::Shell => {
            for word in &words {
                let lower = word.to_lowercase();
                if SHELL_WORDS.contains(&lower.as_str()) {
                    add(&lower);
                }
            }
            for extra in ["-delete", "--force"] {
                if text.contains(extra) {
                    add(extra);
                }
            }
        }
        ToolCallOpaqueKind::Code => {
            for word in &words {
                let lower = word.to_lowercase();
                if CODE_WORDS.contains(&lower.as_str()) {
                    add(&lower);
                }
            }
        }
        ToolCallOpaqueKind::Instruction => {}
    }
    found
}

const RESTORABLE_PHRASES: [&str; 4] = [
    "can be restored",
    "can be recovered",
    "to the trash",
    "to trash",
];
/// A sentence with one of these says the opposite or is unclear: no claim.
const NEGATIONS: [&str; 7] = [
    "not ", "n't", "no way", "never", "cannot", "without", "unable",
];

/// Whether `lower` holds one of `phrases` not right after a word that negates
/// it, as in "not only adds" or "never replaces the list".
fn claims(lower: &str, phrases: &[&str]) -> bool {
    const NEGATING: [&str; 5] = ["not", "never", "n't", "cannot", "no"];
    phrases.iter().any(|phrase| {
        lower.match_indices(phrase).any(|(at, _)| {
            let before = lower[..at].trim_end();
            !NEGATING.iter().any(|word| {
                before.ends_with(word)
                    && before[..before.len() - word.len()]
                        .chars()
                        .next_back()
                        .is_none_or(|c| !c.is_alphanumeric() || *word == "n't")
            })
        })
    })
}

/// What a tool's own description says about what it does, as closed facts.
/// Text the server wrote only ever selects one of these.
struct ToolText {
    replaces_list: bool,
    adds_to_list: bool,
    ignored_if_missing: bool,
    permanent: bool,
    restorable: bool,
}

impl ToolText {
    fn read(description: Option<&str>) -> Self {
        let lower = description
            .map(|text| text_prefix(text, MAX_DESCRIPTION_BYTES).to_lowercase())
            .unwrap_or_default();
        let has = |phrase: &str| lower.contains(phrase);
        Self {
            replaces_list: claims(
                &lower,
                &[
                    "replaces the",
                    "replace all",
                    "replaces all",
                    "overwrites",
                    "will be replaced",
                ],
            ),
            adds_to_list: claims(&lower, &["append-only", "only adds"]),
            ignored_if_missing: has("ignored if") || has("ignores this") || has("silently ignored"),
            permanent: (has("permanently") && !has("not permanently"))
                || has("cannot be undone")
                || has("irreversible"),
            restorable: has("not permanently")
                || lower.split(['.', ';', '\n']).any(|sentence| {
                    RESTORABLE_PHRASES
                        .iter()
                        .any(|phrase| sentence.contains(phrase))
                        && !NEGATIONS.iter().any(|word| sentence.contains(word))
                }),
        }
    }

    fn keeps_after_delete(&self) -> Option<ToolCallChangeNote> {
        if self.restorable {
            Some(ToolCallChangeNote::ToolSaysRestorable)
        } else if self.permanent {
            Some(ToolCallChangeNote::ToolSaysPermanent)
        } else {
            None
        }
    }
}

/// Drops what earlier results in the chat said, for a label copied into
/// another chat: values stay as written, machine IDs lose the names earlier
/// results gave them, and what was known only by comparison becomes "set".
pub fn forget_earlier(change: &mut ToolCallChange) {
    fn forget_value(value: &mut ToolCallEffectValue) {
        if value.machine_id {
            value.text.clear();
        }
        if value
            .meaning
            .as_ref()
            .is_some_and(|meaning| meaning.source == ToolCallValueMeaningSource::Earlier)
        {
            value.meaning = None;
        }
    }
    fn forget_effect(effect: &mut ToolCallEffect) {
        effect.new_name = false;
        effect.old = None;
        effect.removed.clear();
        effect.kept.clear();
        effect.added.clear();
        effect.values.iter_mut().for_each(forget_value);
        if matches!(
            effect.effect,
            ToolCallEffectKind::Changed | ToolCallEffectKind::Unchanged
        ) {
            effect.effect = if effect.list {
                ToolCallEffectKind::ListReplaced
            } else {
                ToolCallEffectKind::Set
            };
        }
    }
    let lists_compared = change
        .effects
        .iter()
        .filter(|effect| {
            effect.list
                && matches!(
                    effect.effect,
                    ToolCallEffectKind::Changed | ToolCallEffectKind::Unchanged
                )
        })
        .count();
    let lists_compared = u32::try_from(lists_compared).unwrap_or(u32::MAX);
    // Counts cover values past the stored cap, so they move as a whole.
    let counts = &mut change.counts;
    let compared = counts.changed.saturating_add(counts.unchanged);
    counts.list_replaced = counts.list_replaced.saturating_add(lists_compared);
    counts.set = counts
        .set
        .saturating_add(compared.saturating_sub(lists_compared));
    counts.changed = 0;
    counts.unchanged = 0;
    change.effects.iter_mut().for_each(forget_effect);
    if let Some(filter) = change.filter.as_mut() {
        filter.text.iter_mut().for_each(forget_value);
        filter
            .parts
            .iter_mut()
            .for_each(|part| forget_value(&mut part.value));
    }
    if let Some(batch) = change.batch.as_mut() {
        batch.shared.iter_mut().for_each(forget_effect);
        batch.fields.iter_mut().for_each(|field| {
            field.samples.iter_mut().for_each(forget_value);
        });
        for row in &mut batch.rows {
            row.effects.iter_mut().for_each(forget_effect);
            if row.name_from_earlier {
                row.name = None;
                row.name_from_earlier = false;
            }
        }
    }
    change.notes.retain(|note| {
        !matches!(
            note,
            ToolCallChangeNote::OldValuesFromEarlier | ToolCallChangeNote::NothingChanges
        )
    });
    // Whether a chat read the record says nothing about another chat.
    change.record_unread = false;
}

#[cfg(test)]
mod tests;
