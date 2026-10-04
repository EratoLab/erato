//! Durable per-message budget choices. Decisions use the existing approval
//! protocol: approve extends, reject answers now, and withdraw stops.

use crate::models::message::{
    ContentPart, ContentPartToolApprovalRequest, PendingToolCall, ToolApprovalAnnotations,
    ToolApprovalKind,
};
use serde_json::json;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BudgetChoice {
    Continue,
    Answer,
    Stop,
}

/// Read decisions only after their own request, so earlier approvals cannot
/// accidentally settle a later prompt. The request snapshots its budget.
pub(crate) fn choices(content: &[ContentPart]) -> impl Iterator<Item = (u32, BudgetChoice)> + '_ {
    content.iter().enumerate().filter_map(|(index, part)| {
        let ContentPart::ToolApprovalRequest(request) = part else {
            return None;
        };
        if request.kind != ToolApprovalKind::ToolCallLimit {
            return None;
        }
        let budget = u32::try_from(request.input["budget"].as_u64()?).ok()?;
        content[index + 1..].iter().find_map(|part| match part {
            ContentPart::ToolApproval(part) if part.tool_call_id == request.tool_call_id => {
                Some((budget, BudgetChoice::Continue))
            }
            ContentPart::ToolRejection(part) if part.tool_call_id == request.tool_call_id => {
                Some((
                    budget,
                    if part.reason.as_deref() == Some("withdrawn") {
                        BudgetChoice::Stop
                    } else {
                        BudgetChoice::Answer
                    },
                ))
            }
            _ => None,
        })
    })
}

pub(crate) fn effective_budget(default: u32, content: &[ContentPart]) -> u32 {
    choices(content).fold(default, |budget, (snapshot, choice)| {
        if choice == BudgetChoice::Continue {
            budget.max(snapshot.saturating_mul(2))
        } else {
            budget
        }
    })
}

pub(crate) fn request(
    budget: u32,
    pending_tool_calls: Vec<PendingToolCall>,
) -> ContentPartToolApprovalRequest {
    ContentPartToolApprovalRequest {
        // A budget choice names no real tool call. A fresh id distinguishes
        // repeated prompts and keeps the decision out of tool execution.
        tool_call_id: format!("tool-budget:{}", sea_orm::prelude::Uuid::new_v4()),
        tool_name: "Tool-call budget".to_string(),
        display: None,
        mcp_server_id: String::new(),
        input: json!({"budget": budget}),
        annotations: ToolApprovalAnnotations {
            read_only_hint: false,
            destructive_hint: false,
            idempotent_hint: false,
            open_world_hint: false,
        },
        preset: String::new(),
        allow_always: false,
        requested_at: chrono::Utc::now().to_rfc3339(),
        kind: ToolApprovalKind::ToolCallLimit,
        approvals: Vec::new(),
        pending_tool_calls,
    }
}
