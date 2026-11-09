//! What a call changes, described the same way for every server: what each
//! value does, how far the call reaches, what is lost, what the card cannot
//! read and what nobody can know. Computed next to the label from the call's
//! real arguments, the tool's own annotations and words, and earlier results
//! in the chat; never from anything a model wrote. Words a tool says about
//! itself only ever pick a closed sentence the card marks as the tool's claim.

use super::MAX_LABEL_VALUE_CHARS;
use super::arguments::names_an_id;
use super::context::{ToolResultContext, is_link, link_id_member, name_words, text_prefix};
use super::machine_id::is_machine_id;
use super::pointer::escape;
use super::recipients::{ADDRESS_MEMBERS, bare_member, is_phone_shaped};
use super::rules::{self, Claim, PLACE_MEMBERS, Recipients, TABLE_MEMBERS, recipients_in};
use crate::models::message::{
    ToolCallAction, ToolCallBatch, ToolCallBatchField, ToolCallBatchOperation, ToolCallBatchRow,
    ToolCallChange, ToolCallChangeNote, ToolCallEffect, ToolCallEffectCounts, ToolCallEffectKind,
    ToolCallEffectValue, ToolCallFilter, ToolCallFilterPart, ToolCallFlag, ToolCallLabel,
    ToolCallLabelItem, ToolCallOpaque, ToolCallOpaqueKind, ToolCallRecipientGroup,
    ToolCallTextChange,
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
/// Bytes of value text in one description, so a huge call stores little.
const MAX_CHANGE_BYTES: usize = 48 * 1024;
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

/// Objects whose members are the values a call writes, flattened into plain
/// rows of the same names.
const WRAPPER_MEMBERS: [&str; 15] = [
    "properties",
    "fields",
    "item",
    "record",
    "data",
    "set",
    "attributes",
    "values",
    "updates",
    "changes",
    "params",
    "payload",
    "update",
    "patch",
    "additional_fields",
];
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
    /// The server whose earlier results may name this call's IDs.
    pub server: Option<&'a str>,
}

/// The call's change description, and whether cleaning a value or name it
/// holds removed invisible characters. `None` for a label with no verb.
pub fn describe(label: &ToolCallLabel, facts: ChangeFacts<'_>) -> Option<(ToolCallChange, bool)> {
    if label.action == ToolCallAction::Other {
        return None;
    }
    let item = label.items.first();
    let mut walk = Walk::new(label.action, item, &facts);
    if let Value::Object(members) = facts.arguments {
        walk.members(members, "", 0, false, "");
    }
    Some(walk.finish(&facts))
}

struct Walk<'a> {
    facts: &'a ChangeFacts<'a>,
    action: ToolCallAction,
    /// Paths the line names: the record, its title, where it goes.
    named: HashSet<&'a str>,
    /// Those of them whose value the line can show, a machine ID only by name.
    named_shown: HashSet<&'a str>,
    /// The text the call says it replaces and the text it writes, by path.
    before: Option<&'a str>,
    after: HashSet<&'a str>,
    earlier: Option<EarlierRecord<'a>>,
    change: ToolCallChange,
    places: Vec<(usize, String)>,
    nodes: usize,
    bytes: usize,
    hidden: bool,
    consent_left_out: bool,
    complete: bool,
    says: ToolText,
    saw_list: bool,
    /// A value was compared with what an earlier result showed.
    used_earlier: bool,
}

struct EarlierRecord<'a> {
    record: &'a super::context::Record,
    server: &'a str,
}

impl<'a> Walk<'a> {
    fn new(
        action: ToolCallAction,
        item: Option<&'a ToolCallLabelItem>,
        facts: &'a ChangeFacts<'a>,
    ) -> Self {
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
            named,
            named_shown,
            before,
            after,
            earlier,
            change: ToolCallChange::default(),
            places: Vec::new(),
            nodes: MAX_NODES,
            bytes: MAX_CHANGE_BYTES,
            hidden: false,
            consent_left_out: false,
            complete: true,
            says: ToolText::read(facts.tool.description.as_deref()),
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
            let name = readable_name(member, shared.as_deref(), prefix);
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
        if is_one_of(member, &TABLE_MEMBERS) && value.is_string() {
            self.place(member, value);
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
        if let Some(text) = scalar_text(value) {
            let cleaned = self.clean(&text);
            if !cleaned.is_empty() && !is_machine_id(&cleaned) {
                self.places.push((place_order(member), cleaned));
            }
        }
    }

    fn clean(&mut self, text: &str) -> String {
        let cleaned = sanitize_display_text(
            text_prefix(text, MAX_LABEL_VALUE_CHARS * 8),
            MAX_LABEL_VALUE_CHARS,
        );
        self.hidden |= cleaned.hidden_characters;
        cleaned.text
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
            Value::String(text) => std::borrow::Cow::Borrowed(text.as_str()),
            Value::Bool(_) | Value::Number(_) => std::borrow::Cow::Owned(value.to_string()),
            Value::Null => return None,
            other => std::borrow::Cow::Owned(other.to_string()),
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
            });
        }
        Some(ToolCallEffectValue {
            truncated: cleaned.truncated,
            text: cleaned.text,
            machine_id: false,
        })
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
        let effect = self.effect(member, value, path, name);
        self.push(effect);
    }

    fn effect(&mut self, member: &str, value: &Value, path: &str, name: String) -> ToolCallEffect {
        let name = self.display_name(&name);
        let raw_name = self.display_name(member);
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
            link: false,
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
                let shown = self.link_or_value(scalar, path);
                effect.values.extend(shown);
                self.classify_scalar(member, path, scalar, &mut effect);
            }
            Unwrapped::List(entries) => {
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

    fn link_or_value(&mut self, scalar: &Value, path: &str) -> Option<ToolCallEffectValue> {
        if let Value::String(text) = scalar
            && let Some(inside) = id_inside_a_link_path(text)
        {
            return Some(ToolCallEffectValue {
                text: self.name_of_id(inside, path).unwrap_or_default(),
                truncated: false,
                machine_id: true,
            });
        }
        self.shown(scalar, path)
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
        let Some(earlier) = self.earlier_text(member) else {
            return;
        };
        let new = scalar_text(scalar).unwrap_or_default();
        effect.effect = if earlier == new {
            ToolCallEffectKind::Unchanged
        } else {
            ToolCallEffectKind::Changed
        };
        effect.old = self.old_shown(member, &earlier, path);
        self.used_earlier = true;
    }

    fn fill_old(&mut self, member: &str, path: &str, effect: &mut ToolCallEffect) {
        if let Some(earlier) = self.earlier_text(member) {
            effect.old = self.old_shown(member, &earlier, path);
            self.used_earlier = true;
        }
    }

    fn earlier_text(&self, member: &str) -> Option<String> {
        let earlier = self.earlier.as_ref()?;
        earlier.record.field(member)
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
                },
                None if is_machine_id(earlier) => ToolCallEffectValue {
                    text: String::new(),
                    truncated: false,
                    machine_id: true,
                },
                None => ToolCallEffectValue {
                    text: self.clean(earlier),
                    truncated: false,
                    machine_id: false,
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
                Unwrapped::Scalar(scalar) => self.link_or_value(scalar, &entry_path),
                Unwrapped::Empty => None,
                _ => self.shown(entry, &entry_path),
            };
            effect.values.extend(shown);
        }
    }

    /// What a replaced list loses and keeps, where an earlier result showed
    /// the list. A list that loses nothing replaces nothing.
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
            .map(<[String]>::to_vec)
        else {
            return;
        };
        self.used_earlier = true;
        let new: Vec<String> = entries
            .iter()
            .filter_map(|entry| match unwrap(entry, false) {
                Unwrapped::Scalar(scalar) => scalar_text(scalar),
                _ => None,
            })
            .collect();
        let as_value = |text: &String| Value::String(text.clone());
        for entry in &old {
            let shown = self.shown(&as_value(entry), path);
            if new.contains(entry) {
                effect.kept.extend(shown);
            } else {
                effect.removed.extend(shown);
            }
        }
        if !effect.removed.is_empty() {
            return;
        }
        effect.effect = if old.iter().collect::<HashSet<_>>() == new.iter().collect::<HashSet<_>>()
        {
            ToolCallEffectKind::Unchanged
        } else {
            ToolCallEffectKind::Changed
        };
        effect.old = Some(ToolCallEffectValue {
            text: old.join(", "),
            truncated: false,
            machine_id: false,
        });
    }

    fn push(&mut self, effect: ToolCallEffect) {
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
        if self.change.effects.len() < cap {
            self.change.effects.push(effect);
        } else {
            self.complete = false;
        }
    }

    fn flag(&mut self, member: &str, path: &str, name: String, dry_run: bool) {
        let name = self.display_name(&name);
        let raw_name = self.display_name(member);
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
                    let name = readable_name(member, shared.as_deref(), "");
                    let name = self.display_name(&name);
                    if let Some(value) = self.shown(inner, &inner_path) {
                        filter.parts.push(ToolCallFilterPart { name, value });
                    }
                }
                self.complete &= members.len() <= MAX_FILTER_PARTS;
            }
            other => filter.text = self.shown(other, path),
        }
        self.change.filter = Some(filter);
    }

    fn recipients(&mut self, member: &str, value: &'a Value, path: &str) {
        let name = readable_name(member, None, "");
        let name = self.display_name(&name);
        let raw_name = self.display_name(member);
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
        let known = self.facts.context.organization_domains().is_some();
        let change = self.change.recipients.get_or_insert_with(Default::default);
        change.outside_known = known;
        change.total = change
            .total
            .saturating_add(u32::try_from(entries.len()).unwrap_or(u32::MAX));
        let mut group = ToolCallRecipientGroup {
            name,
            raw_name,
            count: u32::try_from(entries.len()).unwrap_or(u32::MAX),
            values: Vec::new(),
            omitted: 0,
        };
        for entry in entries {
            match recipient_text(entry) {
                Some(address) if !is_machine_id(&address) => {
                    let shown = self.display_name(&address);
                    self.check_outside(&shown);
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
        let known = self.facts.context.organization_domains().is_some();
        let domain = email_domain(address).map(str::to_string);
        let inside = domain
            .as_deref()
            .is_some_and(|domain| self.facts.context.is_inside_organization(domain));
        let Some(change) = self.change.recipients.as_mut() else {
            return;
        };
        if domain.is_none() {
            change.unchecked = change.unchecked.saturating_add(1);
        } else if known && !inside {
            if change.outside.len() < MAX_OUTSIDE {
                change.outside.push(address.to_string());
            } else {
                change.outside_omitted = change.outside_omitted.saturating_add(1);
            }
        }
    }

    fn opaque(&mut self, member: &str, value: &'a Value, path: &str, name: &str) -> bool {
        let Some((kind, text)) = opaque_kind(member, value) else {
            return false;
        };
        if self.change.opaque.len() == MAX_OPAQUE {
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
        let name = self.display_name(name);
        let raw_name = self.display_name(member);
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
        let name = self.display_name(name);
        let raw_name = self.display_name(member);
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

    fn before_text(&mut self) -> Option<ToolCallEffectValue> {
        let path = self.before?;
        let raw = self.facts.arguments.pointer(path)?.as_str()?;
        let cleaned = sanitize_display_text(
            text_prefix(raw, MAX_STORED_TEXT_CHARS * 8),
            MAX_STORED_TEXT_CHARS,
        );
        self.hidden |= cleaned.hidden_characters;
        (!cleaned.text.is_empty()).then_some(ToolCallEffectValue {
            truncated: cleaned.truncated,
            text: cleaned.text,
            machine_id: false,
        })
    }

    fn batch(&mut self, entries: &'a [Value], path: &str, name: &str) {
        if self.change.batch.is_some() {
            // One list of rows is the call's batch; a second is left to the raw call.
            self.complete = false;
            return;
        }
        let name = self.display_name(name);
        let total = u32::try_from(entries.len()).unwrap_or(u32::MAX);
        let read = entries.len().min(MAX_ROWS_READ);
        let read_all = read == entries.len();
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
                    break;
                }
                self.nodes -= 1;
                let value_path = format!("{row_path}/{}", escape(member));
                if is_verb_field(member, value)
                    || is_row_identifier(member, value)
                    || rules::claim(
                        self.facts.arguments,
                        &value_path,
                        self.facts.approval_argument,
                    )
                    .is_some()
                {
                    continue;
                }
                let hash = value_hash(value);
                shape.push((member.as_str(), hash));
                let at = *order.entry(member.as_str()).or_insert_with(|| {
                    tallies.push(FieldTally::new(member, shared.as_deref()));
                    tallies.len() - 1
                });
                let update_like =
                    is_update_like(self.action) || action == Some(ToolCallAction::Update);
                match unwrap(value, is_plural(member)) {
                    Unwrapped::Empty if update_like => {
                        empties = true;
                        tallies[at].emptied += 1;
                    }
                    Unwrapped::List(_) if update_like => {
                        replaces = true;
                        tallies[at].lists += 1;
                    }
                    _ => {}
                }
                tallies[at].rows += 1;
                if tallies[at].first.len() < MAX_FIELD_SAMPLES
                    && tallies[at].distinct.insert(hash)
                    && !matches!(unwrap(value, false), Unwrapped::Empty)
                {
                    tallies[at].first.push((value, value_path));
                } else if tallies[at].distinct.len() < MAX_DISTINCT_TRACKED {
                    tallies[at].distinct.insert(hash);
                }
            }
            rows_emptying += u32::from(empties);
            rows_replacing_lists += u32::from(replaces);
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
            rows.push(self.batch_row(index, members, path));
        }
        let same_change = read_all && shapes.len() == 1 && total > 1;
        let shared = same_change
            .then(|| {
                rows.first()
                    .map(|row: &ToolCallBatchRow| row.effects.clone())
            })
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
        let mut effects = Vec::new();
        for (member, value) in members {
            let value_path = format!("{row_path}/{}", escape(member));
            if is_verb_field(member, value)
                || rules::claim(
                    self.facts.arguments,
                    &value_path,
                    self.facts.approval_argument,
                )
                .is_some()
                || edit.is_some_and(|(before, _)| before == member.as_str())
            {
                continue;
            }
            if is_row_identifier(member, value) {
                let label = self.row_label(value, &value_path);
                name = name.or(label);
                continue;
            }
            if effects.len() == MAX_ROW_EFFECTS {
                continue;
            }
            let readable = readable_name(member, shared.as_deref(), "");
            let effect = match edit {
                Some((before, after)) if after == member.as_str() => {
                    self.text_edit_effect(member, before, members, value, &value_path, readable)
                }
                _ => self.effect(member, value, &value_path, readable),
            };
            effects.push(effect);
        }
        ToolCallBatchRow {
            number,
            name,
            action: row_action(members),
            effects,
        }
    }

    fn batch_field(&mut self, tally: FieldTally<'a>) -> ToolCallBatchField {
        let samples = tally
            .first
            .iter()
            .filter_map(|(value, path)| self.shown(value, path))
            .collect();
        ToolCallBatchField {
            name: self.display_name(&tally.name),
            raw_name: self.display_name(tally.raw_name),
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
        if self.places.len() > 1 {
            self.places.sort_by_key(|(order, _)| *order);
            let joined: Vec<&str> = self.places.iter().map(|(_, text)| text.as_str()).collect();
            self.change.place = Some(joined.join(" / "));
        } else {
            self.change.place = self.places.pop().map(|(_, text)| text);
        }
        let mut notes = Vec::new();
        let says = &self.says;
        if facts
            .tool
            .annotations
            .as_ref()
            .and_then(|hints| hints.destructive_hint)
            == Some(true)
        {
            notes.push(ToolCallChangeNote::MarkedDestructive);
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
        {
            notes.push(ToolCallChangeNote::NothingChanges);
        }
        self.change.notes = notes;
        (self.change, self.hidden)
    }
}

fn is_update_like(action: ToolCallAction) -> bool {
    matches!(action, ToolCallAction::Update | ToolCallAction::Upsert)
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
    fn new(member: &'a str, shared: Option<&str>) -> Self {
        Self {
            name: readable_name(member, shared, ""),
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
    let humanised = member_words(member, shared);
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
    words
        .iter()
        .enumerate()
        .map(|(index, word)| {
            let lower = word.to_lowercase();
            if matches!(lower.as_str(), "id" | "ids") {
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
            Value::String(text) if text.is_empty() => return Unwrapped::Empty,
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
fn wrapped_value(members: &Map<String, Value>) -> Option<&Value> {
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

/// `/accounts(aaaaaaaa-0000-4000-8000-0000000000a1)` and the like: a path that
/// only points at a record, whose ID it holds.
fn id_inside_a_link_path(text: &str) -> Option<&str> {
    let open = text.rfind('(')?;
    let inner = text[open + 1..].strip_suffix(')')?;
    (text.starts_with('/') && !text[..open].contains(' ') && is_machine_id(inner)).then_some(inner)
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

/// The domain of `Display Name <a@b>` or `a@b`, read only from plain ASCII.
fn email_domain(address: &str) -> Option<&str> {
    let bare = address
        .rsplit_once('<')
        .map(|(_, rest)| rest.trim_end_matches('>'))
        .unwrap_or(address)
        .trim();
    let (local, domain) = bare.split_once('@')?;
    (!local.is_empty()
        && !domain.is_empty()
        && !domain.contains('@')
        && domain.is_ascii()
        && !is_phone_shaped(bare))
    .then_some(domain)
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
    is_scalar(value)
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
            replaces_list: has("replaces the")
                || has("replace all")
                || has("replaces all")
                || has("overwrites")
                || has("will be replaced"),
            adds_to_list: has("append-only") || has("only adds") || has("never removed"),
            ignored_if_missing: has("ignored if") || has("ignores this") || has("silently ignored"),
            permanent: (has("permanently") && !has("not permanently"))
                || has("cannot be undone")
                || has("irreversible"),
            restorable: has("not permanently")
                || has("can be restored")
                || has("to restore")
                || has("can be recovered")
                || has("to the trash")
                || has("to trash"),
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
/// another chat: values stay as written, and machine IDs lose the names
/// that earlier results gave them.
pub fn forget_earlier(change: &mut ToolCallChange) {
    let counts = &mut change.counts;
    *counts = ToolCallEffectCounts::default();
    let fix = |effect: &mut ToolCallEffect, counts: &mut ToolCallEffectCounts| {
        effect.old = None;
        effect.removed.clear();
        effect.kept.clear();
        for value in &mut effect.values {
            if value.machine_id {
                value.text.clear();
            }
        }
        if matches!(
            effect.effect,
            ToolCallEffectKind::Changed | ToolCallEffectKind::Unchanged
        ) {
            effect.effect = ToolCallEffectKind::Set;
        }
        let count = match effect.effect {
            ToolCallEffectKind::Emptied => &mut counts.emptied,
            ToolCallEffectKind::ListReplaced => &mut counts.list_replaced,
            ToolCallEffectKind::Changed => &mut counts.changed,
            ToolCallEffectKind::Set => &mut counts.set,
            ToolCallEffectKind::Unchanged => &mut counts.unchanged,
            ToolCallEffectKind::Unreadable => &mut counts.unreadable,
        };
        *count = count.saturating_add(1);
    };
    for effect in &mut change.effects {
        fix(effect, counts);
    }
    if let Some(batch) = change.batch.as_mut() {
        for effect in batch
            .shared
            .iter_mut()
            .chain(batch.rows.iter_mut().flat_map(|row| row.effects.iter_mut()))
        {
            effect.old = None;
            for value in &mut effect.values {
                if value.machine_id {
                    value.text.clear();
                }
            }
        }
    }
    change.notes.retain(|note| {
        !matches!(
            note,
            ToolCallChangeNote::OldValuesFromEarlier | ToolCallChangeNote::NothingChanges
        )
    });
}

#[cfg(test)]
mod tests;
