//! Display-only progress while a provider is still generating tool arguments.
//! The completed provider response remains the only source of executable calls.

use crate::models::message::{ContentPart, ToolCallStatus, ToolUse};
use genai::chat::ToolCall;
use serde_json::Value;
use std::collections::HashMap;
use std::time::{Duration, Instant};

const UPDATE_INTERVAL: Duration = Duration::from_millis(250);
const PREVIEW_BYTES: usize = 4096;
const MAX_PREPARATIONS: usize = 128;

#[derive(Default)]
pub(crate) struct ToolArgumentStreams {
    sent: HashMap<String, (Instant, usize)>,
}

pub(crate) struct ArgumentProgress {
    pub index: usize,
    pub first: bool,
    pub preview: Value,
    pub bytes: usize,
}

impl ToolArgumentStreams {
    /// Adapter chunks contain accumulated arguments, not append-only deltas.
    /// Keep previews bounded and throttle updates, even for very large drafts.
    pub fn observe(
        &mut self,
        call: &ToolCall,
        content: &mut Vec<ContentPart>,
        now: Instant,
    ) -> Option<ArgumentProgress> {
        if call.call_id.is_empty() || call.fn_name.is_empty() {
            return None;
        }
        let index = tool_call_content_index(content, &call.call_id);
        if matches!(content.get(index), Some(ContentPart::ToolUse(part)) if part.status != ToolCallStatus::Preparing)
        {
            return None;
        }
        let first = !self.sent.contains_key(&call.call_id);
        if first && self.sent.len() >= MAX_PREPARATIONS {
            return None;
        }
        let serialized;
        let arguments = match &call.fn_arguments {
            Value::String(text) => text.as_str(),
            value => {
                serialized = value.to_string();
                &serialized
            }
        };
        let bytes = arguments.len();
        if let Some((sent_at, sent_bytes)) = self.sent.get(&call.call_id)
            && (*sent_bytes == bytes || now.saturating_duration_since(*sent_at) < UPDATE_INTERVAL)
        {
            return None;
        }
        let preview = Value::String(bounded_preview(arguments));
        upsert_tool_use(
            content,
            ToolUse {
                tool_call_id: call.call_id.clone(),
                tool_name: call.fn_name.clone(),
                status: ToolCallStatus::Preparing,
                input: Some(preview.clone()),
                progress: Some(bytes as f64),
                ..Default::default()
            },
        );
        self.sent.insert(call.call_id.clone(), (now, bytes));
        Some(ArgumentProgress {
            index,
            first,
            preview,
            bytes,
        })
    }
}

fn bounded_preview(text: &str) -> String {
    if text.len() <= PREVIEW_BYTES {
        return text.to_owned();
    }
    let mut head = PREVIEW_BYTES / 2;
    while !text.is_char_boundary(head) {
        head -= 1;
    }
    let mut tail = text.len() - PREVIEW_BYTES / 2;
    while !text.is_char_boundary(tail) {
        tail += 1;
    }
    format!("{}\n…\n{}", &text[..head], &text[tail..])
}

pub(crate) fn tool_call_content_index(content: &[ContentPart], id: &str) -> usize {
    content
        .iter()
        .position(|part| matches!(part, ContentPart::ToolUse(tool) if tool.tool_call_id == id))
        .unwrap_or(content.len())
}

/// Preserve the position first reserved by streaming argument generation.
pub(crate) fn upsert_tool_use(content: &mut Vec<ContentPart>, tool: ToolUse) -> usize {
    let index = tool_call_content_index(content, &tool.tool_call_id);
    let part = ContentPart::ToolUse(tool);
    if index == content.len() {
        content.push(part);
    } else {
        content[index] = part;
    }
    index
}

/// Partial arguments are transient UI state, never executable or replayable history.
pub(crate) fn without_preparing_tools(content: &[ContentPart]) -> Vec<ContentPart> {
    content.iter().filter(|part| !matches!(part, ContentPart::ToolUse(tool) if tool.status == ToolCallStatus::Preparing)).cloned().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn call(id: &str, arguments: &str) -> ToolCall {
        ToolCall {
            call_id: id.into(),
            fn_name: "submit_draft".into(),
            fn_arguments: Value::String(arguments.into()),
            thought_signatures: None,
        }
    }

    #[test]
    fn incomplete_arguments_are_visible_but_never_enter_saved_history() {
        let mut streams = ToolArgumentStreams::default();
        let mut content = vec![];
        let update = streams
            .observe(
                &call("one", "{\"title\":\"hel"),
                &mut content,
                Instant::now(),
            )
            .unwrap();
        assert!(update.first);
        assert_eq!(update.index, 0);
        assert!(
            matches!(&content[0], ContentPart::ToolUse(tool) if tool.status == ToolCallStatus::Preparing && tool.input == Some(json!("{\"title\":\"hel")))
        );
        assert!(without_preparing_tools(&content).is_empty());
    }

    #[test]
    fn accumulated_chunks_replace_the_preview_and_updates_are_throttled() {
        let mut streams = ToolArgumentStreams::default();
        let mut content = vec![];
        let now = Instant::now();
        streams
            .observe(&call("one", "{"), &mut content, now)
            .unwrap();
        assert!(
            streams
                .observe(
                    &call("one", "{\"title\":"),
                    &mut content,
                    now + Duration::from_millis(20)
                )
                .is_none()
        );
        let update = streams
            .observe(
                &call("one", "{\"title\":\"hello\"}"),
                &mut content,
                now + UPDATE_INTERVAL,
            )
            .unwrap();
        assert!(!update.first);
        assert_eq!(update.preview, json!("{\"title\":\"hello\"}"));
        assert_eq!(content.len(), 1);
        assert!(
            streams
                .observe(
                    &call("one", "{\"title\":\"hello\"}"),
                    &mut content,
                    now + UPDATE_INTERVAL * 2
                )
                .is_none()
        );
    }

    #[test]
    fn interleaved_calls_keep_their_positions_when_execution_settles() {
        let mut streams = ToolArgumentStreams::default();
        let mut content = vec![];
        let now = Instant::now();
        streams
            .observe(&call("one", "{"), &mut content, now)
            .unwrap();
        streams
            .observe(&call("two", "{"), &mut content, now)
            .unwrap();
        let settled = ToolUse {
            tool_call_id: "two".into(),
            tool_name: "submit_draft".into(),
            status: ToolCallStatus::Success,
            input: Some(json!({"title":"Done"})),
            ..Default::default()
        };
        assert_eq!(upsert_tool_use(&mut content, settled), 1);
        assert!(
            streams
                .observe(&call("two", "{}"), &mut content, now + UPDATE_INTERVAL)
                .is_none()
        );
        assert_eq!(content.len(), 2);
        assert_eq!(without_preparing_tools(&content).len(), 1);
    }

    #[test]
    fn previews_are_bounded_utf8_and_require_an_identifiable_call() {
        let mut streams = ToolArgumentStreams::default();
        let mut content = vec![];
        let now = Instant::now();
        assert!(streams.observe(&call("", "{"), &mut content, now).is_none());
        let text = "😀".repeat(100_000);
        let update = streams
            .observe(&call("one", &text), &mut content, now)
            .unwrap();
        assert_eq!(update.bytes, text.len());
        assert!(update.preview.as_str().unwrap().len() <= PREVIEW_BYTES + 5);
        assert!(update.preview.as_str().unwrap().contains('\u{2026}'));
    }
}
