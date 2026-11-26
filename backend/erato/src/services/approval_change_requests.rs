//! A change request on a waiting approval: the user neither allows nor
//! denies the call, but asks for it to be different. The call is not run,
//! the model reads the user's words as the call's result, and the corrected
//! call's approval item names the item it replaces.

use crate::models::message::{ContentPart, ContentPartToolApprovalRequest, ToolCallStatus};
use serde_json::{Value, json};
use std::collections::HashSet;

/// `ContentPartToolRejection.reason` of a call the user asked to change.
pub(crate) const REJECTION_REASON: &str = "change_requested";

/// `status` of the result the model reads for a call the user asked to
/// change.
const OUTPUT_STATUS: &str = "change_requested";

/// The result the model reads in place of the call's own. The user's words
/// travel as their own JSON string, apart from the note, so they cannot
/// rewrite what the note says.
pub(crate) fn tool_output(note: &str, user_request: &str) -> Value {
    json!({
        "status": OUTPUT_STATUS,
        "note": note,
        "user_request": user_request,
    })
}

/// Whether a stored result is the one [`tool_output`] writes.
pub(crate) fn is_change_request_output(output: &serde_json::Map<String, Value>) -> bool {
    output.get("status").and_then(Value::as_str) == Some(OUTPUT_STATUS)
        && output.get("user_request").is_some_and(Value::is_string)
}

/// How many change requests the turn stored on `content` has taken.
pub(crate) fn rounds(content: &[ContentPart]) -> usize {
    content
        .iter()
        .filter(|part| is_change_request(part))
        .count()
}

fn is_change_request(part: &ContentPart) -> bool {
    matches!(part, ContentPart::ToolRejection(rejection)
        if rejection.reason.as_deref() == Some(REJECTION_REASON))
}

/// Marks the turn's own item of `request` as replacing the item the latest
/// change request on `content` withdrew.
///
/// It is the replacement only if it is the first call the model made after
/// that change request, and the only one: it waits alone (no other call of
/// the turn ran or waits since), on the same server and tool, in a stop of the
/// same kind. A question back, another tool, several calls or no call at all
/// mark nothing, and so does any later stop.
pub(crate) fn mark_replacement(
    content: &[ContentPart],
    request: &mut ContentPartToolApprovalRequest,
) {
    let Some(at) = content.iter().rposition(is_change_request) else {
        return;
    };
    let ContentPart::ToolRejection(rejection) = &content[at] else {
        return;
    };
    let Some((old_part, old_approval_id)) = content[..at].iter().rev().find_map(|part| {
        let ContentPart::ToolApprovalRequest(part) = part else {
            return None;
        };
        let item = part.approval_items().into_iter().find(|item| {
            item.child.is_none()
                && match &rejection.approval_id {
                    Some(approval_id) => &item.approval_id == approval_id,
                    None => item.tool_call_id == rejection.tool_call_id,
                }
        })?;
        Some((part, item.approval_id))
    }) else {
        return;
    };
    let Some(old_item) = old_part
        .approval_items()
        .into_iter()
        .find(|item| item.approval_id == old_approval_id)
    else {
        return;
    };

    // Every call the turn knew of when the user asked for the change: the
    // calls that ran or were asked about, and those still queued behind a
    // stop, which run or are asked about again after it.
    let mut known: HashSet<&str> = HashSet::new();
    for part in &content[..=at] {
        match part {
            ContentPart::ToolUse(tool_use) => {
                known.insert(&tool_use.tool_call_id);
            }
            ContentPart::ToolApprovalRequest(part) => {
                known.insert(&part.tool_call_id);
                known.extend(part.approvals.iter().map(|item| item.tool_call_id.as_str()));
                known.extend(
                    part.pending_tool_calls
                        .iter()
                        .map(|call| call.call_id.as_str()),
                );
            }
            ContentPart::ClientToolPending(pending) => {
                known.insert(&pending.tool_call_id);
                known.extend(
                    pending
                        .pending_tool_calls
                        .iter()
                        .map(|call| call.call_id.as_str()),
                );
            }
            _ => {}
        }
    }
    let asked: HashSet<&str> = request
        .approvals
        .iter()
        .map(|item| item.tool_call_id.as_str())
        .collect();
    // A call still streaming its arguments has a placeholder row; the gated
    // call has one until the stop replaces it.
    let new_calls_since = content[at + 1..].iter().any(|part| match part {
        ContentPart::ToolUse(tool_use) => {
            tool_use.status != ToolCallStatus::Preparing
                && !asked.contains(tool_use.tool_call_id.as_str())
                && !known.contains(tool_use.tool_call_id.as_str())
        }
        ContentPart::ToolApprovalRequest(part) => part
            .approval_items()
            .iter()
            .any(|item| !known.contains(item.tool_call_id.as_str())),
        ContentPart::ClientToolPending(pending) => !known.contains(pending.tool_call_id.as_str()),
        _ => false,
    });
    if new_calls_since || !request.pending_tool_calls.is_empty() {
        return;
    }
    let mut new_items = request
        .approvals
        .iter_mut()
        .filter(|item| !known.contains(item.tool_call_id.as_str()));
    let (Some(new_item), None) = (new_items.next(), new_items.next()) else {
        return;
    };
    if new_item.child.is_some()
        || request.kind != old_part.kind
        || request.mcp_server_id != old_part.mcp_server_id
        || new_item.tool_name != old_item.tool_name
    {
        return;
    }
    new_item.replaces_approval_id = Some(old_item.approval_id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::message::{
        ApprovalItem, ContentPartToolRejection, PendingToolCall, ToolApprovalAnnotations,
        ToolApprovalKind, ToolUse,
    };

    fn stop(call_id: &str, tool: &str, server: &str) -> ContentPartToolApprovalRequest {
        ContentPartToolApprovalRequest {
            tool_call_id: call_id.into(),
            tool_name: tool.into(),
            display: None,
            mcp_server_id: server.into(),
            input: json!({}),
            annotations: ToolApprovalAnnotations {
                read_only_hint: false,
                destructive_hint: false,
                idempotent_hint: false,
                open_world_hint: true,
            },
            preset: "restrictive".into(),
            allow_always: false,
            requested_at: String::new(),
            kind: ToolApprovalKind::McpTool,
            approvals: vec![ApprovalItem {
                approval_id: call_id.into(),
                tool_call_id: call_id.into(),
                tool_name: tool.into(),
                called_as: None,
                display: None,
                input: json!({}),
                child: None,
                replaces_approval_id: None,
                follows: None,
            }],
            pending_tool_calls: Vec::new(),
            approval_scope: None,
        }
    }

    fn settled(call_id: &str, tool: &str) -> ToolUse {
        ToolUse {
            tool_call_id: call_id.into(),
            status: ToolCallStatus::Error,
            tool_name: tool.into(),
            display: None,
            input: None,
            progress_message: None,
            progress: None,
            total: None,
            output: None,
            result_details: None,
            allowed_by: None,
            budget_usage: None,
            started_at: None,
            ended_at: None,
        }
    }

    fn rejection(call_id: &str, reason: Option<&str>) -> ContentPart {
        ContentPart::ToolRejection(ContentPartToolRejection {
            tool_call_id: call_id.into(),
            never_allow: false,
            user_tool_approval_setting_id: None,
            rejected_at: String::new(),
            approval_id: Some(call_id.into()),
            child_chat_id: None,
            reason: reason.map(str::to_string),
            change_request: reason.map(|_| "nimm den 22.".to_string()),
            voice: None,
        })
    }

    /// The row after a change request on `old`, with whatever the turn did
    /// since.
    fn asked_to_change(since: Vec<ContentPart>) -> Vec<ContentPart> {
        let mut content = vec![
            ContentPart::ToolApprovalRequest(stop("old", "update_record", "records")),
            rejection("old", Some(REJECTION_REASON)),
            ContentPart::ToolUse(settled("old", "update_record")),
        ];
        content.extend(since);
        content
    }

    fn replaces(
        content: &[ContentPart],
        mut new: ContentPartToolApprovalRequest,
    ) -> Option<String> {
        mark_replacement(content, &mut new);
        new.approvals[0].replaces_approval_id.clone()
    }

    #[test]
    fn the_corrected_call_replaces_the_withdrawn_item() {
        let content = asked_to_change(Vec::new());
        assert_eq!(
            replaces(&content, stop("new", "update_record", "records")).as_deref(),
            Some("old")
        );
    }

    #[test]
    fn the_gated_calls_own_placeholder_is_no_other_call() {
        let mut preparing = settled("new", "update_record");
        preparing.status = ToolCallStatus::Preparing;
        let mut running = settled("new", "update_record");
        running.status = ToolCallStatus::InProgress;
        let content = asked_to_change(vec![
            ContentPart::ToolUse(preparing),
            ContentPart::ToolUse(running),
        ]);
        assert_eq!(
            replaces(&content, stop("new", "update_record", "records")).as_deref(),
            Some("old")
        );
    }

    #[test]
    fn another_tool_or_server_replaces_nothing() {
        let content = asked_to_change(Vec::new());
        assert_eq!(
            replaces(&content, stop("new", "update_gizmo", "records")),
            None
        );
        assert_eq!(
            replaces(&content, stop("new", "update_record", "other")),
            None
        );
    }

    #[test]
    fn a_denial_or_withdrawal_replaces_nothing() {
        for reason in [None, Some("withdrawn")] {
            let content = vec![
                ContentPart::ToolApprovalRequest(stop("old", "update_record", "records")),
                rejection("old", reason),
                ContentPart::ToolUse(settled("old", "update_record")),
            ];
            assert_eq!(
                replaces(&content, stop("new", "update_record", "records")),
                None
            );
        }
    }

    #[test]
    fn several_calls_replace_nothing() {
        let content = asked_to_change(vec![ContentPart::ToolUse(settled("read", "read_record"))]);
        assert_eq!(
            replaces(&content, stop("new", "update_record", "records")),
            None
        );

        let content = asked_to_change(Vec::new());
        let mut new = stop("new", "update_record", "records");
        new.pending_tool_calls.push(PendingToolCall {
            call_id: "also".into(),
            fn_name: "update_record".into(),
            fn_arguments: json!({}),
        });
        assert_eq!(replaces(&content, new), None);
    }

    /// Only the first stop with a call made after the change request can be
    /// the replacement; a call the change request found queued is no answer
    /// to it.
    #[test]
    fn a_queued_call_and_later_stops_replace_nothing() {
        let mut first = stop("old", "update_record", "records");
        first.pending_tool_calls.push(PendingToolCall {
            call_id: "queued".into(),
            fn_name: "update_record".into(),
            fn_arguments: json!({}),
        });
        let content = vec![
            ContentPart::ToolApprovalRequest(first),
            rejection("old", Some(REJECTION_REASON)),
            ContentPart::ToolUse(settled("old", "update_record")),
        ];
        assert_eq!(
            replaces(&content, stop("queued", "update_record", "records")),
            None
        );

        let content = asked_to_change(vec![
            ContentPart::ToolApprovalRequest(stop("new", "update_record", "records")),
            ContentPart::ToolApproval(crate::models::message::ContentPartToolApproval {
                tool_call_id: "new".into(),
                always_allow: false,
                user_tool_approval_setting_id: None,
                approved_at: String::new(),
                approval_id: Some("new".into()),
                child_chat_id: None,
                covers: None,
                scope_approval_id: None,
                voice: None,
            }),
            ContentPart::ToolUse(settled("new", "update_record")),
        ]);
        assert_eq!(
            replaces(&content, stop("later", "update_record", "records")),
            None
        );
    }

    #[test]
    fn a_second_round_replaces_the_first_replacement() {
        let mut content = asked_to_change(vec![ContentPart::ToolApprovalRequest(stop(
            "new",
            "update_record",
            "records",
        ))]);
        content.push(rejection("new", Some(REJECTION_REASON)));
        content.push(ContentPart::ToolUse(settled("new", "update_record")));
        assert_eq!(rounds(&content), 2);
        assert_eq!(
            replaces(&content, stop("newer", "update_record", "records")).as_deref(),
            Some("new")
        );
    }
}
