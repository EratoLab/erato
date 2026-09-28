//! Model-facing replay of tool calls from earlier user turns.
//!
//! A tool configured with `replay.mode = "receipt"` keeps its full arguments
//! and result in the stored message, but prompt composition replays its calls
//! from earlier user turns as bounded receipts. Composition always runs at the
//! start of a user turn, so every tool call it replays belongs to an earlier
//! one; the in-turn loop and the approval continuation replay the current
//! turn's own calls through `replay_assistant_content`, which this policy never
//! touches.
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

/// Top-level key of every receipt.
pub const RECEIPT_MARKER_KEY: &str = "omitted_from_replay";

pub const RECEIPT_NOTE: &str = "This call belongs to an earlier user turn. Its full content is omitted from the conversation replay; only the fields under \"kept\" remain. Call the tool again if current data is needed.";

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

/// A kept value whose JSON serialisation exceeds this is replaced by a marker,
/// so a receipt stays bounded even when a configured path selects a body.
pub const MAX_RECEIPT_FIELD_BYTES: usize = 512;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ToolReplayPolicy {
    /// Keyed by the model-facing tool name, which is all a stored call carries.
    receipts: HashMap<String, ReceiptSpec>,
}

#[derive(Debug, Clone, Default, PartialEq)]
struct ReceiptSpec {
    input_paths: Vec<Vec<String>>,
    output_paths: Vec<Vec<String>>,
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
    /// response. Both fields are stubbed on both roles: the provider reads only
    /// one of them per role, but the persisted snapshot stores both.
    pub fn apply_to_prior_turn_message(
        &self,
        mut message: InputMessage,
        offered: &OfferedClientTools,
    ) -> InputMessage {
        if let ContentPart::ToolUse(tool_use) = &mut message.content
            && offered.contains(&tool_use.tool_name)
            && let Some(spec) = self.receipts.get(&tool_use.tool_name)
        {
            stub_tool_use(tool_use, spec);
        }
        message
    }
}

fn stub_tool_use(tool_use: &mut ToolUse, spec: &ReceiptSpec) {
    tool_use.input = Some(receipt(tool_use.input.as_ref(), &spec.input_paths, None));
    // A call that never produced a result keeps replaying without one; a
    // receipt would claim a result existed.
    if tool_use.output.is_some() {
        let status = serde_json::to_value(&tool_use.status).ok();
        tool_use.output = Some(receipt(
            tool_use.output.as_ref(),
            &spec.output_paths,
            status,
        ));
    }
}

fn receipt(source: Option<&Value>, paths: &[Vec<String>], status: Option<Value>) -> Value {
    let mut kept = Map::new();
    if let Some(source) = source {
        for path in paths {
            if let Some(value) = lookup(source, path) {
                insert(&mut kept, path, bounded(value));
            }
        }
    }
    let mut receipt = Map::new();
    receipt.insert(
        RECEIPT_MARKER_KEY.to_string(),
        Value::String(RECEIPT_NOTE.to_string()),
    );
    if let Some(status) = status {
        receipt.insert("status".to_string(), status);
    }
    receipt.insert("kept".to_string(), Value::Object(kept));
    Value::Object(receipt)
}

fn lookup<'a>(value: &'a Value, path: &[String]) -> Option<&'a Value> {
    path.iter().try_fold(value, |current, key| current.get(key))
}

fn bounded(value: &Value) -> Value {
    let size = serde_json::to_string(value).map_or(usize::MAX, |json| json.len());
    if size <= MAX_RECEIPT_FIELD_BYTES {
        value.clone()
    } else {
        Value::String(format!("[omitted: {size} bytes]"))
    }
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
        let mut config = ClientToolsConfig::default();
        config.tools.insert(
            "reader".into(),
            ClientToolConfig {
                name: "read_pages".into(),
                replay: ClientToolReplayConfig {
                    mode: ClientToolReplayMode::Receipt,
                    keep_input_fields: input.iter().map(|s| s.to_string()).collect(),
                    keep_output_fields: output.iter().map(|s| s.to_string()).collect(),
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
                progress_message: None,
                progress: None,
                total: None,
                input: Some(input),
                output: Some(output),
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

    #[test]
    fn keeps_only_the_configured_fields_at_their_original_nesting() {
        let policy = policy(
            &["$.snapshot"],
            &["$.result.snapshot", "$.result.complete", "$.missing"],
        );
        let stubbed = policy.apply_to_prior_turn_message(
            message(
            MessageRole::Tool,
            "read_pages",
            json!({"snapshot": "s1", "cursor": "c2"}),
            json!({"status": "success", "result": {"snapshot": "s1", "complete": true, "blocks": ["body text"]}}),
        ),
            &offered(&["read_pages"]),
        );
        let stubbed = tool_use(&stubbed);
        assert_eq!(
            stubbed.input,
            Some(json!({RECEIPT_MARKER_KEY: RECEIPT_NOTE, "kept": {"snapshot": "s1"}}))
        );
        assert_eq!(
            stubbed.output,
            Some(json!({
                RECEIPT_MARKER_KEY: RECEIPT_NOTE,
                "status": "success",
                "kept": {"result": {"snapshot": "s1", "complete": true}},
            }))
        );
        assert_eq!(stubbed.tool_call_id, "call-1");
        assert_eq!(stubbed.tool_name, "read_pages");
    }

    #[test]
    fn an_oversized_kept_field_is_replaced_by_a_marker() {
        let policy = policy(&[], &["$.body"]);
        let body = "x".repeat(MAX_RECEIPT_FIELD_BYTES);
        let stubbed = policy.apply_to_prior_turn_message(
            message(
                MessageRole::Tool,
                "read_pages",
                json!({}),
                json!({"body": body}),
            ),
            &offered(&["read_pages"]),
        );
        let size = MAX_RECEIPT_FIELD_BYTES + 2;
        assert_eq!(
            tool_use(&stubbed).output.as_ref().unwrap()["kept"]["body"],
            json!(format!("[omitted: {size} bytes]"))
        );
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
        assert_eq!(
            tool_use(&stubbed).input.as_ref().unwrap()["kept"],
            json!({"snapshot": "s1"})
        );
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
        assert_eq!(
            stubbed.input.as_ref().unwrap()["kept"],
            json!({"snapshot": "s1"})
        );
    }

    #[test]
    fn a_stored_payload_carrying_the_marker_key_is_still_compacted() {
        let policy = policy(&[], &["$.status"]);
        let stubbed = policy.apply_to_prior_turn_message(
            message(
                MessageRole::Tool,
                "read_pages",
                json!({}),
                json!({RECEIPT_MARKER_KEY: "x", "status": "success", "body": "y".repeat(4096)}),
            ),
            &offered(&["read_pages"]),
        );
        assert_eq!(
            tool_use(&stubbed).output.as_ref().unwrap()["kept"],
            json!({"status": "success"})
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
        let stubbed = policy.apply_to_prior_turn_message(
            message(MessageRole::Tool, "read_pages", json!({}), json!({"a": 1})),
            &offered(&["read_pages"]),
        );
        assert_eq!(
            tool_use(&stubbed).output.as_ref().unwrap()["kept"],
            json!({"a": 1})
        );
    }
}
