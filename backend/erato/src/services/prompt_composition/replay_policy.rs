//! Model-facing replay of tool calls from earlier user turns.
//!
//! A tool configured with `replay.mode = "receipt"` keeps its full arguments
//! and result in the stored message, but prompt composition replays its calls
//! from earlier user turns shortened: the call keeps the listed argument fields
//! as its arguments, and the result keeps the listed result fields, a refused
//! call's first validation issue, and a note that the rest is omitted.
//! Composition always runs at the start of a user turn, so every tool call it
//! replays belongs to an earlier one; the in-turn
//! loop and the approval continuation replay the current turn's own calls
//! through `replay_assistant_content`, which this policy never touches.
//!
//! The replayed arguments are never wrapped and never get a placeholder value:
//! the model copies the shape of the calls it sees, so a replayed call has to
//! stay a call it could make (ERMAIN-1274).
//!
//! A stored call carries only its model-facing name, and an MCP tool may share
//! that name (MCP wins the collision at offer time). A call is therefore
//! compacted only when the generation that made it recorded offering a client
//! tool of that name. Without that record the call replays in full: guessing
//! wrong would hide an MCP tool's result from the model.

use crate::config::{ClientToolReplayMode, ClientToolsConfig, parse_receipt_field_path};
use crate::models::message::{ContentPart, InputMessage, ToolUse};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

/// Key of the omission note in every shortened result.
pub const RECEIPT_MARKER_KEY: &str = "omitted_from_replay";

pub const RECEIPT_NOTE: &str = "This call belongs to an earlier user turn. Its result is shortened in the conversation replay. Call the tool again if current data is needed.";

/// Receipts before ERMAIN-1274 wrapped the arguments under this key, with
/// this note. Stored snapshots still hold them.
pub(super) const LEGACY_KEPT_KEY: &str = "kept";
pub(super) const LEGACY_RECEIPT_NOTE: &str = "This call belongs to an earlier user turn. Its full content is omitted from the conversation replay; only the fields under \"kept\" remain. Call the tool again if current data is needed.";
const LEGACY_UPGRADED_NOTE: &str = "This call belongs to an earlier user turn. Its arguments and result are shortened in the conversation replay. Call the tool again if current data is needed.";

/// Key of the per-generation record, in a row's `generation_parameters`, of
/// the client tools that generation offered (keyed by model-facing name).
const OFFERED_CLIENT_TOOLS_KEY: &str = "client_tools";

/// The client tools one stored generation offered to the model.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct OfferedClientTools(HashSet<String>);

impl OfferedClientTools {
    /// Reads the record from a row's raw `generation_parameters`. Rows written
    /// before the record existed yield an empty set, so they replay in full.
    pub fn from_generation_parameters(parameters: Option<&Value>) -> Self {
        Self(
            parameters
                .and_then(|parameters| parameters.get(OFFERED_CLIENT_TOOLS_KEY))
                .and_then(Value::as_object)
                .map(|tools| tools.keys().cloned().collect())
                .unwrap_or_default(),
        )
    }

    fn contains(&self, tool_name: &str) -> bool {
        self.0.contains(tool_name)
    }
}

/// A kept result value whose JSON serialisation exceeds this is replaced by a
/// size marker, so a shortened result stays bounded even when a configured
/// path selects a body.
pub const MAX_RECEIPT_FIELD_BYTES: usize = 512;

/// Left-out arguments the note names; any further ones are counted.
const MAX_NAMED_ARGUMENTS: usize = 8;
const MAX_NAMED_ARGUMENT_BYTES: usize = 64;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ToolReplayPolicy {
    /// Keyed by the model-facing tool name, which is all a stored call carries.
    receipts: HashMap<String, ReceiptSpec>,
}

#[derive(Debug, Clone, Default, PartialEq)]
struct ReceiptSpec {
    input_paths: Vec<Vec<String>>,
    output_paths: Vec<Vec<String>>,
    /// A kept argument larger than this is left out of the replayed call: a
    /// marker in its place would break the argument's schema.
    input_bound: usize,
}

impl ToolReplayPolicy {
    pub fn from_client_tools(config: &ClientToolsConfig) -> Self {
        let parse = |paths: &[String]| {
            paths
                .iter()
                .filter_map(|path| parse_receipt_field_path(path).ok())
                .collect()
        };
        let receipts = config
            .tools
            .values()
            .filter(|tool| tool.replay.mode == ClientToolReplayMode::Receipt)
            .map(|tool| {
                (
                    tool.name.clone(),
                    ReceiptSpec {
                        input_paths: parse(&tool.replay.keep_input_fields),
                        output_paths: parse(&tool.replay.keep_output_fields),
                        input_bound: tool.replay.input_field_bound(),
                    },
                )
            })
            .collect();
        Self { receipts }
    }

    pub fn is_empty(&self) -> bool {
        self.receipts.is_empty()
    }

    /// Rewrites one replayed message of a stored row from an earlier user
    /// turn. Both the assistant-role call and the tool-role response are
    /// rewritten in place, never dropped, so every call keeps its matching
    /// response. Both fields are shortened on both roles: the provider reads
    /// only one of them per role, but the persisted snapshot stores both.
    pub fn apply_to_prior_turn_message(
        &self,
        mut message: InputMessage,
        offered: &OfferedClientTools,
    ) -> InputMessage {
        if let ContentPart::ToolUse(tool_use) = &mut message.content
            && offered.contains(&tool_use.tool_name)
            && let Some(spec) = self.receipts.get(&tool_use.tool_name)
        {
            shorten_tool_use(tool_use, spec);
        }
        message
    }
}

/// Rewrites a receipt from before ERMAIN-1274, as a stored snapshot replays
/// it, into the current form: what it kept of the arguments becomes the call's
/// arguments again. Matched on the exact legacy note, which only the policy
/// wrote; anything else passes through.
pub fn upgrade_legacy_receipt(mut message: InputMessage) -> InputMessage {
    if let ContentPart::ToolUse(tool_use) = &mut message.content {
        if let Some(kept) = tool_use.input.as_ref().and_then(legacy_kept) {
            tool_use.input = Some(Value::Object(without_size_markers(kept)));
        }
        if let Some(output) = tool_use.output.as_ref().and_then(Value::as_object)
            && let Some(kept) = legacy_kept_fields(output)
        {
            let mut result = kept.clone();
            if let Some(status) = output.get("status") {
                result
                    .entry("status".to_string())
                    .or_insert_with(|| status.clone());
            }
            result.insert(
                RECEIPT_MARKER_KEY.to_string(),
                Value::String(LEGACY_UPGRADED_NOTE.to_string()),
            );
            tool_use.output = Some(Value::Object(result));
        }
    }
    message
}

fn shorten_tool_use(tool_use: &mut ToolUse, spec: &ReceiptSpec) {
    // A call whose arguments are a copied receipt meant the arguments under
    // "kept"; replaying the wrapper would teach it again.
    let source = tool_use
        .input
        .as_ref()
        .map(|input| copied_receipt(input).unwrap_or(input));
    let arguments = kept_fields(source, &spec.input_paths, |value, size| {
        (size <= spec.input_bound).then(|| value.clone())
    });
    let mut left_out = Vec::new();
    if let Some(source) = source {
        left_out_fields(source, &arguments, "", &mut left_out);
    }
    tool_use.input = Some(Value::Object(arguments));
    // A call that never produced a result keeps replaying without one; a
    // shortened result would claim a result existed.
    if tool_use.output.is_some() {
        let mut result = kept_fields(
            tool_use.output.as_ref(),
            &spec.output_paths,
            |value, size| {
                Some(if size <= MAX_RECEIPT_FIELD_BYTES {
                    value.clone()
                } else {
                    Value::String(size_marker(size))
                })
            },
        );
        if let Ok(status) = serde_json::to_value(&tool_use.status) {
            result.entry("status".to_string()).or_insert(status);
        }
        // A refused call keeps why next to its arguments, so it does not read
        // as a valid call. Stored issues are already bounded.
        if let Some(issue) = first_validation_issue(tool_use.output.as_ref()) {
            result
                .entry("validation_errors".to_string())
                .or_insert_with(|| Value::Array(vec![issue.clone()]));
        }
        result.insert(
            RECEIPT_MARKER_KEY.to_string(),
            Value::String(note(&left_out)),
        );
        tool_use.output = Some(Value::Object(result));
    }
}

fn note(left_out: &[String]) -> String {
    if left_out.is_empty() {
        return RECEIPT_NOTE.to_string();
    }
    let named: Vec<&str> = left_out
        .iter()
        .filter(|field| field.len() <= MAX_NAMED_ARGUMENT_BYTES)
        .take(MAX_NAMED_ARGUMENTS)
        .map(String::as_str)
        .collect();
    let mut fields = named.join(", ");
    let more = left_out.len() - named.len();
    if more > 0 {
        let separator = if fields.is_empty() { "" } else { ", " };
        fields = format!("{fields}{separator}{more} more");
    }
    format!(
        "This call belongs to an earlier user turn. Its result is shortened in the conversation replay, and its arguments are shown without these fields: {fields}. Call the tool again if current data is needed."
    )
}

/// The listed fields at their original nesting; `keep` decides each value
/// from it and its JSON size, and `None` leaves it out.
fn kept_fields(
    source: Option<&Value>,
    paths: &[Vec<String>],
    keep: impl Fn(&Value, usize) -> Option<Value>,
) -> Map<String, Value> {
    let mut kept = Map::new();
    if let Some(source) = source {
        for path in paths {
            if let Some(value) = lookup(source, path) {
                let size = serde_json::to_string(value).map_or(usize::MAX, |json| json.len());
                if let Some(value) = keep(value, size) {
                    insert(&mut kept, path, value);
                }
            }
        }
    }
    kept
}

/// Dotted paths of the source's object members the replayed arguments lack.
fn left_out_fields(source: &Value, kept: &Map<String, Value>, prefix: &str, out: &mut Vec<String>) {
    let Some(source) = source.as_object() else {
        return;
    };
    for (key, value) in source {
        let path = if prefix.is_empty() {
            key.clone()
        } else {
            format!("{prefix}.{key}")
        };
        match kept.get(key) {
            None => out.push(path),
            Some(Value::Object(inner)) => left_out_fields(value, inner, &path, out),
            Some(_) => {}
        }
    }
}

fn first_validation_issue(output: Option<&Value>) -> Option<&Value> {
    output?.get("validation_errors")?.as_array()?.first()
}

/// The arguments under "kept" when a call's arguments are a receipt's wrapper
/// and nothing else: the rule the Word read repairs by (wordReadArguments.ts).
fn copied_receipt(input: &Value) -> Option<&Value> {
    let receipt = input.as_object()?;
    if !only_receipt_keys(receipt) {
        return None;
    }
    receipt.get(LEGACY_KEPT_KEY).filter(|kept| kept.is_object())
}

fn legacy_kept(value: &Value) -> Option<&Map<String, Value>> {
    legacy_kept_fields(value.as_object()?)
}

fn legacy_kept_fields(receipt: &Map<String, Value>) -> Option<&Map<String, Value>> {
    if receipt.get(RECEIPT_MARKER_KEY)?.as_str()? != LEGACY_RECEIPT_NOTE
        || !only_receipt_keys(receipt)
    {
        return None;
    }
    receipt.get(LEGACY_KEPT_KEY)?.as_object()
}

fn only_receipt_keys(receipt: &Map<String, Value>) -> bool {
    receipt
        .keys()
        .all(|key| [RECEIPT_MARKER_KEY, LEGACY_KEPT_KEY, "status"].contains(&key.as_str()))
}

fn size_marker(size: usize) -> String {
    format!("[omitted: {size} bytes]")
}

pub(super) fn is_size_marker(value: &Value) -> bool {
    value
        .as_str()
        .and_then(|text| text.strip_prefix("[omitted: "))
        .and_then(|text| text.strip_suffix(" bytes]"))
        .is_some_and(|size| !size.is_empty() && size.bytes().all(|b| b.is_ascii_digit()))
}

fn without_size_markers(kept: &Map<String, Value>) -> Map<String, Value> {
    kept.iter()
        .filter(|(_, value)| !is_size_marker(value))
        .map(|(key, value)| {
            let value = match value {
                Value::Object(inner) => Value::Object(without_size_markers(inner)),
                other => other.clone(),
            };
            (key.clone(), value)
        })
        .collect()
}

fn lookup<'a>(value: &'a Value, path: &[String]) -> Option<&'a Value> {
    path.iter().try_fold(value, |current, key| current.get(key))
}

/// Rebuilds the kept value at the same nesting as in the source. A path that
/// runs through an already-kept scalar is skipped rather than overwriting it.
fn insert(target: &mut Map<String, Value>, path: &[String], value: Value) {
    let Some((last, parents)) = path.split_last() else {
        return;
    };
    let mut current = target;
    for key in parents {
        let entry = current
            .entry(key.clone())
            .or_insert_with(|| Value::Object(Map::new()));
        let Value::Object(next) = entry else {
            return;
        };
        current = next;
    }
    current.insert(last.clone(), value);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{ClientToolConfig, ClientToolReplayConfig};
    use crate::models::message::{MessageRole, ToolCallStatus};
    use serde_json::json;

    fn policy(input: &[&str], output: &[&str]) -> ToolReplayPolicy {
        bounded_policy(input, output, None)
    }

    fn bounded_policy(
        input: &[&str],
        output: &[&str],
        max_input_field_bytes: Option<usize>,
    ) -> ToolReplayPolicy {
        let mut config = ClientToolsConfig::default();
        config.tools.insert(
            "reader".into(),
            ClientToolConfig {
                name: "read_pages".into(),
                replay: ClientToolReplayConfig {
                    mode: ClientToolReplayMode::Receipt,
                    keep_input_fields: input.iter().map(|s| s.to_string()).collect(),
                    keep_output_fields: output.iter().map(|s| s.to_string()).collect(),
                    max_input_field_bytes,
                },
                ..Default::default()
            },
        );
        ToolReplayPolicy::from_client_tools(&config)
    }

    fn message(role: MessageRole, tool_name: &str, input: Value, output: Value) -> InputMessage {
        InputMessage {
            role,
            content: ContentPart::ToolUse(ToolUse {
                tool_call_id: "call-1".into(),
                status: ToolCallStatus::Success,
                tool_name: tool_name.into(),
                display: None,
                progress_message: None,
                progress: None,
                total: None,
                input: Some(input),
                output: Some(output),
                result_details: None,
                allowed_by: None,
                started_at: None,
                ended_at: None,
            }),
        }
    }

    fn offered(names: &[&str]) -> OfferedClientTools {
        let tools: Map<String, Value> = names
            .iter()
            .map(|name| (name.to_string(), json!({})))
            .collect();
        OfferedClientTools::from_generation_parameters(Some(&json!({ "client_tools": tools })))
    }

    fn tool_use(message: &InputMessage) -> &ToolUse {
        match &message.content {
            ContentPart::ToolUse(tool_use) => tool_use,
            _ => panic!("not a tool use"),
        }
    }

    fn stubbed(policy: &ToolReplayPolicy, input: Value, output: Value) -> ToolUse {
        tool_use(&policy.apply_to_prior_turn_message(
            message(MessageRole::Tool, "read_pages", input, output),
            &offered(&["read_pages"]),
        ))
        .clone()
    }

    #[test]
    fn keeps_the_configured_fields_as_real_arguments_and_shortens_the_result() {
        let policy = policy(
            &["$.snapshot"],
            &["$.result.snapshot", "$.result.complete", "$.missing"],
        );
        let stubbed = stubbed(
            &policy,
            json!({"snapshot": "s1", "cursor": "c2"}),
            json!({"status": "success", "result": {"snapshot": "s1", "complete": true, "blocks": ["body text"]}}),
        );
        assert_eq!(stubbed.input, Some(json!({"snapshot": "s1"})));
        assert_eq!(
            stubbed.output,
            Some(json!({
                "status": "success",
                "result": {"snapshot": "s1", "complete": true},
                RECEIPT_MARKER_KEY: note(&["cursor".to_string()]),
            }))
        );
        assert!(note(&["cursor".to_string()]).contains("without these fields: cursor."));
        assert_eq!(stubbed.tool_call_id, "call-1");
        assert_eq!(stubbed.tool_name, "read_pages");
    }

    #[test]
    fn a_call_whose_arguments_are_all_kept_replays_them_unchanged() {
        let policy = policy(
            &["$.snapshot", "$.documentIdentity", "$.section"],
            &["$.status"],
        );
        let call = json!({"snapshot": "s1", "documentIdentity": "doc", "section": {"ref": "b4", "cursor": "c2"}});
        let stubbed = stubbed(
            &policy,
            call.clone(),
            json!({"status": "success", "result": {}}),
        );
        assert_eq!(stubbed.input, Some(call));
        assert_eq!(
            stubbed.output,
            Some(json!({"status": "success", RECEIPT_MARKER_KEY: RECEIPT_NOTE}))
        );
    }

    #[test]
    fn an_oversized_argument_is_left_out_and_an_oversized_result_field_is_marked() {
        let policy = policy(&["$.snapshot", "$.blocks"], &["$.body"]);
        let blocks: Vec<Value> = (0..200)
            .map(|k| json!({"text": format!("block {k}")}))
            .collect();
        let body = "x".repeat(MAX_RECEIPT_FIELD_BYTES);
        let stubbed = stubbed(
            &policy,
            json!({"snapshot": "s1", "blocks": blocks}),
            json!({"body": body}),
        );
        assert_eq!(stubbed.input, Some(json!({"snapshot": "s1"})));
        let output = stubbed.output.unwrap();
        let size = MAX_RECEIPT_FIELD_BYTES + 2;
        assert_eq!(output["body"], json!(format!("[omitted: {size} bytes]")));
        assert_eq!(
            output[RECEIPT_MARKER_KEY],
            json!(note(&["blocks".to_string()]))
        );
    }

    #[test]
    fn a_tool_may_keep_larger_arguments_whole() {
        let queries: Vec<Value> = (0..16)
            .map(|k| json!({"text": format!("{k}{}", "q".repeat(250))}))
            .collect();
        let call = json!({"snapshot": "s1", "target": {"queries": queries}});
        for (bound, kept) in [
            (None, json!({"snapshot": "s1"})),
            (Some(24 * 1024), call.clone()),
        ] {
            let stubbed = stubbed(
                &bounded_policy(&["$.snapshot", "$.target"], &[], bound),
                call.clone(),
                json!({"status": "success"}),
            );
            assert_eq!(stubbed.input, Some(kept));
        }
    }

    #[test]
    fn a_refused_call_keeps_its_first_validation_issue() {
        let policy = policy(&["$.snapshot", "$.include"], &["$.status", "$.error"]);
        let issue = json!({"path": "/section", "code": "read-arguments", "message": "Unexpected field: include."});
        let stubbed = stubbed(
            &policy,
            json!({"snapshot": "s1", "include": ["text"]}),
            json!({"status": "error", "error": "Document read validation failed", "validation_errors": [issue, {"path": "", "code": "read-arguments", "message": "A correct call: {}"}]}),
        );
        assert_eq!(
            stubbed.output,
            Some(json!({
                "status": "error",
                "error": "Document read validation failed",
                "validation_errors": [issue],
                RECEIPT_MARKER_KEY: RECEIPT_NOTE,
            }))
        );
    }

    #[test]
    fn the_note_names_nested_left_out_arguments_and_counts_the_rest() {
        let policy = policy(&["$.snapshot", "$.section.ref"], &[]);
        let stubbed = stubbed(
            &policy,
            json!({"snapshot": "s1", "section": {"ref": "b1", "cursor": "c"}, "include": ["edits"]}),
            json!({}),
        );
        assert_eq!(
            stubbed.input,
            Some(json!({"snapshot": "s1", "section": {"ref": "b1"}}))
        );
        let output = stubbed.output.unwrap();
        let named = output[RECEIPT_MARKER_KEY].as_str().unwrap();
        assert!(
            named.contains("section.cursor") && named.contains("include"),
            "{named}"
        );
        assert!(!named.contains("snapshot"), "{named}");

        let many: Vec<String> = (0..12).map(|k| format!("field{k}")).collect();
        let long = "y".repeat(MAX_NAMED_ARGUMENT_BYTES + 1);
        let named = note(&[many.clone(), vec![long.clone()]].concat());
        assert!(named.contains("field7, 5 more."), "{named}");
        assert!(!named.contains("field8") && !named.contains(&long));
    }

    #[test]
    fn a_call_that_copied_a_receipt_replays_as_the_call_it_wraps() {
        let policy = policy(&["$.snapshot", "$.section"], &["$.status"]);
        let read = json!({"snapshot": "s1", "section": {"ref": "b2"}});
        for wrapper in [
            json!({RECEIPT_MARKER_KEY: "This call belongs to an earlier user turn.", "kept": read}),
            json!({"kept": read}),
            json!({"status": "success", "kept": read}),
        ] {
            let stubbed = stubbed(&policy, wrapper, json!({"status": "success"}));
            assert_eq!(stubbed.input, Some(read.clone()));
            assert_eq!(
                stubbed.output.unwrap()[RECEIPT_MARKER_KEY],
                json!(RECEIPT_NOTE)
            );
        }
        let beside = stubbed(
            &policy,
            json!({"kept": read, "snapshot": "s2"}),
            json!({"status": "error"}),
        );
        assert_eq!(beside.input, Some(json!({"snapshot": "s2"})));
    }

    #[test]
    fn a_call_is_compacted_only_when_its_generation_offered_that_client_tool() {
        let policy = policy(&["$.snapshot"], &["$.result.snapshot"]);
        let call = message(
            MessageRole::Tool,
            "read_pages",
            json!({"snapshot": "s1", "cursor": "c2"}),
            json!({"result": {"snapshot": "s1", "blocks": ["body text"]}}),
        );
        // A same-named MCP tool wins the collision at offer time, so the
        // generation's record does not list the client tool.
        for record in [
            offered(&[]),
            offered(&["some_other_tool"]),
            OfferedClientTools::from_generation_parameters(None),
            OfferedClientTools::from_generation_parameters(Some(&json!({"selected_facets": {}}))),
        ] {
            assert_eq!(
                json!(policy.apply_to_prior_turn_message(call.clone(), &record)),
                json!(call)
            );
        }
        let stubbed = policy.apply_to_prior_turn_message(call, &offered(&["read_pages"]));
        assert_eq!(tool_use(&stubbed).input, Some(json!({"snapshot": "s1"})));
    }

    #[test]
    fn a_call_without_a_result_keeps_replaying_without_one() {
        let policy = policy(&["$.snapshot"], &["$.status"]);
        let mut call = message(
            MessageRole::Tool,
            "read_pages",
            json!({"snapshot": "s1", "plan": "large body"}),
            json!(null),
        );
        if let ContentPart::ToolUse(tool_use) = &mut call.content {
            tool_use.output = None;
            tool_use.status = ToolCallStatus::InProgress;
        }
        let stubbed = policy.apply_to_prior_turn_message(call, &offered(&["read_pages"]));
        let stubbed = tool_use(&stubbed);
        assert_eq!(stubbed.output, None);
        assert_eq!(stubbed.input, Some(json!({"snapshot": "s1"})));
    }

    #[test]
    fn a_stored_payload_carrying_the_marker_key_is_still_compacted() {
        let policy = policy(&[], &["$.status"]);
        let stubbed = stubbed(
            &policy,
            json!({}),
            json!({RECEIPT_MARKER_KEY: "x", "status": "success", "body": "y".repeat(4096)}),
        );
        assert_eq!(
            stubbed.output,
            Some(json!({"status": "success", RECEIPT_MARKER_KEY: RECEIPT_NOTE}))
        );
    }

    #[test]
    fn other_tools_and_non_tool_content_are_untouched() {
        let policy = policy(&[], &[]);
        let other = message(
            MessageRole::Tool,
            "search",
            json!({"q": "a"}),
            json!({"hits": [1, 2]}),
        );
        assert_eq!(
            json!(policy.apply_to_prior_turn_message(other.clone(), &offered(&["search"]))),
            json!(other)
        );
        assert!(ToolReplayPolicy::default().is_empty());
    }

    #[test]
    fn a_path_through_a_kept_scalar_does_not_overwrite_it() {
        let policy = policy(&[], &["$.a", "$.a.b"]);
        let stubbed = stubbed(&policy, json!({}), json!({"a": 1}));
        assert_eq!(
            stubbed.output,
            Some(json!({"a": 1, "status": "success", RECEIPT_MARKER_KEY: RECEIPT_NOTE}))
        );
    }

    #[test]
    fn a_legacy_receipt_from_a_snapshot_is_upgraded_to_a_real_call() {
        let legacy = message(
            MessageRole::Assistant,
            "read_pages",
            json!({RECEIPT_MARKER_KEY: LEGACY_RECEIPT_NOTE, "kept": {"snapshot": "s1", "range": {"start": "b1", "body": "[omitted: 900 bytes]"}, "plan": "[omitted: 4096 bytes]"}}),
            json!({RECEIPT_MARKER_KEY: LEGACY_RECEIPT_NOTE, "status": "success", "kept": {"result": {"complete": true}}}),
        );
        let upgraded = upgrade_legacy_receipt(legacy);
        let upgraded = tool_use(&upgraded);
        assert_eq!(
            upgraded.input,
            Some(json!({"snapshot": "s1", "range": {"start": "b1"}}))
        );
        assert_eq!(
            upgraded.output,
            Some(
                json!({"result": {"complete": true}, "status": "success", RECEIPT_MARKER_KEY: LEGACY_UPGRADED_NOTE})
            )
        );

        let empty = upgrade_legacy_receipt(message(
            MessageRole::Assistant,
            "read_pages",
            json!({RECEIPT_MARKER_KEY: LEGACY_RECEIPT_NOTE, "kept": {}}),
            json!({RECEIPT_MARKER_KEY: LEGACY_RECEIPT_NOTE, "status": "error", "kept": {"status": "error"}}),
        ));
        // The old receipt of a call that sent a copied wrapper kept nothing.
        assert_eq!(tool_use(&empty).input, Some(json!({})));

        for untouched in [
            message(
                MessageRole::Tool,
                "search",
                json!({RECEIPT_MARKER_KEY: "another note", "kept": {"q": "a"}}),
                json!({RECEIPT_MARKER_KEY: LEGACY_RECEIPT_NOTE, "kept": {}, "hits": [1]}),
            ),
            message(
                MessageRole::Tool,
                "read_pages",
                json!({"snapshot": "s1"}),
                json!({"status": "success", RECEIPT_MARKER_KEY: RECEIPT_NOTE}),
            ),
        ] {
            assert_eq!(
                json!(upgrade_legacy_receipt(untouched.clone())),
                json!(untouched)
            );
        }
    }
}
