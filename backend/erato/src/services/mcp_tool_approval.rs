use crate::config::{McpToolApprovalConfig, McpToolApprovalPreset};
use crate::models::message::{ToolAllowedBy, ToolApprovalAnnotations};
use crate::models::user_tool_approval_setting::UserToolDecision;
use rmcp::model::Tool;
use serde::Serialize;
use utoipa::ToSchema;

/// The effective approval reading of one MCP tool under the configured policy.
///
/// Both the runtime gate and the enumeration endpoint derive their view from
/// this single evaluation so a badge can never disagree with what happens at
/// call time.
#[derive(Debug, Clone, PartialEq)]
pub struct McpToolApprovalVerdict {
    /// Hints normalized to the protocol defaults for absent values.
    pub annotations: ToolApprovalAnnotations,
    /// Whether effective annotations are present from the server or operator
    /// configuration. An unannotated tool uses pessimistic protocol defaults.
    pub annotated: bool,
    /// Whether the configured policy asks the user before running the tool.
    /// Always false while the approval gate is disabled.
    pub requires_approval: bool,
    /// The server's consent argument on this tool. Such a tool asks on every
    /// call while the gate is on, and a standing grant does not cover it.
    pub approval_argument: Option<String>,
}

pub fn normalize_tool_annotations(tool: &Tool) -> ToolApprovalAnnotations {
    let hints = tool.annotations.as_ref();
    ToolApprovalAnnotations {
        read_only_hint: hints.and_then(|hint| hint.read_only_hint).unwrap_or(false),
        destructive_hint: hints.and_then(|hint| hint.destructive_hint).unwrap_or(true),
        idempotent_hint: hints.and_then(|hint| hint.idempotent_hint).unwrap_or(false),
        open_world_hint: hints.and_then(|hint| hint.open_world_hint).unwrap_or(true),
    }
}

pub fn evaluate_mcp_tool_approval(
    config: &McpToolApprovalConfig,
    tool: &Tool,
    approval_argument: Option<&str>,
) -> McpToolApprovalVerdict {
    let annotations = normalize_tool_annotations(tool);
    // A server that asks for consent per call gets it per call, whatever its
    // hints say about the tool.
    let requires_approval = config.enabled
        && (approval_argument.is_some()
            || match config.preset {
                McpToolApprovalPreset::Permissive => annotations.destructive_hint,
                McpToolApprovalPreset::Restrictive => {
                    !annotations.read_only_hint
                        || annotations.destructive_hint
                        || annotations.open_world_hint
                }
            });
    McpToolApprovalVerdict {
        annotations,
        annotated: tool.annotations.is_some(),
        requires_approval,
        approval_argument: approval_argument.map(str::to_string),
    }
}

/// What actually happens when the tool is called, once the user's stored
/// decision is laid over the policy verdict.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum McpToolEffectiveState {
    Allow,
    Ask,
    Denied,
}

/// Combine the policy verdict with the user's decision. A denial always
/// holds. A grant counts only while `allow_always` is on, and an ask only
/// while the approval gate is on, because the park-and-continue machinery
/// is what an ask needs; an inert row falls back to the policy verdict.
///
/// A grant never covers a tool with a consent argument, which asks on every
/// call. An allowed call also says what allowed it: a grant only when it
/// skipped a prompt, the policy when the policy alone needed none.
pub fn effective_mcp_tool_state(
    config: &McpToolApprovalConfig,
    verdict: &McpToolApprovalVerdict,
    decision: Option<UserToolDecision>,
) -> (McpToolEffectiveState, Option<ToolAllowedBy>) {
    match decision {
        Some(UserToolDecision::Denied) => (McpToolEffectiveState::Denied, None),
        Some(UserToolDecision::AlwaysAllow)
            if config.allow_always
                && verdict.approval_argument.is_none()
                && verdict.requires_approval =>
        {
            (
                McpToolEffectiveState::Allow,
                Some(ToolAllowedBy::AlwaysAllow),
            )
        }
        Some(UserToolDecision::Ask) if config.enabled => (McpToolEffectiveState::Ask, None),
        _ if verdict.requires_approval => (McpToolEffectiveState::Ask, None),
        _ => (McpToolEffectiveState::Allow, Some(ToolAllowedBy::Policy)),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        McpToolEffectiveState, effective_mcp_tool_state, evaluate_mcp_tool_approval,
        normalize_tool_annotations,
    };
    use crate::config::{McpToolApprovalConfig, McpToolApprovalPreset};
    use crate::models::user_tool_approval_setting::UserToolDecision;
    use rmcp::model::{Tool, ToolAnnotations};
    use serde_json::Map;

    fn config(enabled: bool, preset: McpToolApprovalPreset) -> McpToolApprovalConfig {
        McpToolApprovalConfig {
            enabled,
            preset,
            allow_always: false,
        }
    }

    #[test]
    fn absent_hints_fall_back_to_protocol_defaults() {
        let unannotated = Tool::new("unknown", "unknown", Map::new());
        let normalized = normalize_tool_annotations(&unannotated);
        assert!(!normalized.read_only_hint);
        assert!(normalized.destructive_hint);
        assert!(!normalized.idempotent_hint);
        assert!(normalized.open_world_hint);

        let partially_annotated = Tool::new("partial", "partial", Map::new()).with_annotations(
            ToolAnnotations::from_raw(None, Some(true), None, None, None),
        );
        let normalized = normalize_tool_annotations(&partially_annotated);
        assert!(normalized.read_only_hint);
        assert!(normalized.destructive_hint);
        assert!(!normalized.idempotent_hint);
        assert!(normalized.open_world_hint);
    }

    #[test]
    fn annotated_is_false_only_without_any_annotations() {
        let permissive = config(true, McpToolApprovalPreset::Permissive);
        let unannotated = Tool::new("unknown", "unknown", Map::new());
        assert!(!evaluate_mcp_tool_approval(&permissive, &unannotated, None).annotated);

        let empty_annotations = Tool::new("empty", "empty", Map::new())
            .with_annotations(ToolAnnotations::from_raw(None, None, None, None, None));
        assert!(evaluate_mcp_tool_approval(&permissive, &empty_annotations, None).annotated);
    }

    #[test]
    fn disabled_gate_never_requires_approval() {
        let disabled = config(false, McpToolApprovalPreset::Restrictive);
        let unannotated = Tool::new("unknown", "unknown", Map::new());
        assert!(!evaluate_mcp_tool_approval(&disabled, &unannotated, None).requires_approval);
    }

    #[test]
    fn presets_evaluate_normalized_hints() {
        let permissive = config(true, McpToolApprovalPreset::Permissive);
        let restrictive = config(true, McpToolApprovalPreset::Restrictive);
        let read_only_closed = Tool::new("read", "read", Map::new()).with_annotations(
            ToolAnnotations::from_raw(None, Some(true), Some(false), Some(true), Some(false)),
        );
        let open_world_non_destructive =
            Tool::new("publish", "publish", Map::new()).with_annotations(
                ToolAnnotations::from_raw(None, Some(false), Some(false), Some(true), Some(true)),
            );
        let unannotated = Tool::new("unknown", "unknown", Map::new());

        assert!(
            !evaluate_mcp_tool_approval(&permissive, &read_only_closed, None).requires_approval
        );
        assert!(
            !evaluate_mcp_tool_approval(&restrictive, &read_only_closed, None).requires_approval
        );
        assert!(
            !evaluate_mcp_tool_approval(&permissive, &open_world_non_destructive, None)
                .requires_approval
        );
        assert!(
            evaluate_mcp_tool_approval(&restrictive, &open_world_non_destructive, None)
                .requires_approval
        );
        assert!(evaluate_mcp_tool_approval(&permissive, &unannotated, None).requires_approval);
        assert!(evaluate_mcp_tool_approval(&restrictive, &unannotated, None).requires_approval);
    }

    #[test]
    fn user_decisions_layer_over_the_policy_verdict() {
        use crate::models::message::ToolAllowedBy as AllowedBy;
        use McpToolEffectiveState as State;
        use UserToolDecision as Decision;
        let auto = Tool::new("read", "read", Map::new()).with_annotations(
            ToolAnnotations::from_raw(None, Some(true), Some(false), Some(true), Some(false)),
        );
        let asks = Tool::new("unknown", "unknown", Map::new());
        let full = McpToolApprovalConfig {
            enabled: true,
            preset: McpToolApprovalPreset::Permissive,
            allow_always: true,
        };
        let no_grants = McpToolApprovalConfig {
            allow_always: false,
            ..full.clone()
        };
        let disabled = McpToolApprovalConfig {
            enabled: false,
            ..no_grants.clone()
        };

        let policy = (State::Allow, Some(AllowedBy::Policy));
        let ask = (State::Ask, None);
        let cases = [
            (&full, &auto, None, policy),
            (&full, &asks, None, ask),
            (&full, &auto, Some(Decision::Ask), ask),
            (
                &full,
                &asks,
                Some(Decision::AlwaysAllow),
                (State::Allow, Some(AllowedBy::AlwaysAllow)),
            ),
            // The grant skipped no prompt.
            (&full, &auto, Some(Decision::AlwaysAllow), policy),
            (&full, &auto, Some(Decision::Denied), (State::Denied, None)),
            // Inert rows fall back to the policy.
            (&no_grants, &asks, Some(Decision::AlwaysAllow), ask),
            (&disabled, &auto, Some(Decision::Ask), policy),
            (&disabled, &asks, Some(Decision::Ask), policy),
            // A denial needs no policy at all.
            (
                &disabled,
                &auto,
                Some(Decision::Denied),
                (State::Denied, None),
            ),
        ];
        for (config, tool, decision, expected) in cases {
            let verdict = evaluate_mcp_tool_approval(config, tool, None);
            assert_eq!(
                effective_mcp_tool_state(config, &verdict, decision),
                expected,
                "{:?} {} {:?}",
                config,
                tool.name,
                decision
            );
        }
    }

    #[test]
    fn a_consent_argument_asks_per_call_and_ignores_standing_grants() {
        use crate::models::message::ToolAllowedBy as AllowedBy;
        use McpToolEffectiveState as State;
        let read_only = Tool::new("delete_record", "delete", Map::new()).with_annotations(
            ToolAnnotations::from_raw(None, Some(true), Some(false), Some(true), Some(false)),
        );
        let full = McpToolApprovalConfig {
            enabled: true,
            preset: McpToolApprovalPreset::Permissive,
            allow_always: true,
        };
        let verdict = evaluate_mcp_tool_approval(&full, &read_only, Some("hasUserApproved"));
        assert!(verdict.requires_approval);
        assert_eq!(
            verdict.approval_argument.as_deref(),
            Some("hasUserApproved")
        );
        assert_eq!(
            effective_mcp_tool_state(&full, &verdict, None),
            (State::Ask, None)
        );
        assert_eq!(
            effective_mcp_tool_state(&full, &verdict, Some(UserToolDecision::AlwaysAllow)),
            (State::Ask, None)
        );
        assert_eq!(
            effective_mcp_tool_state(&full, &verdict, Some(UserToolDecision::Denied)),
            (State::Denied, None)
        );

        // Without the gate nobody can be asked; the call runs and the server
        // receives `false`.
        let disabled = McpToolApprovalConfig {
            enabled: false,
            ..full
        };
        let verdict = evaluate_mcp_tool_approval(&disabled, &read_only, Some("hasUserApproved"));
        assert!(!verdict.requires_approval);
        assert_eq!(
            effective_mcp_tool_state(&disabled, &verdict, None),
            (State::Allow, Some(AllowedBy::Policy))
        );
    }
}
