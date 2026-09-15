use crate::config::{McpToolApprovalConfig, McpToolApprovalPreset};
use crate::models::message::ToolApprovalAnnotations;
use rmcp::model::Tool;

/// The effective approval reading of one MCP tool under the configured policy.
///
/// Both the runtime gate and the enumeration endpoint derive their view from
/// this single evaluation so a badge can never disagree with what happens at
/// call time.
#[derive(Debug, Clone, PartialEq)]
pub struct McpToolApprovalVerdict {
    /// Hints normalized to the protocol defaults for absent values.
    pub annotations: ToolApprovalAnnotations,
    /// Whether the server declared any annotations at all. An unannotated
    /// tool is not read-only: the defaults are the pessimistic reading.
    pub annotated: bool,
    /// Whether the configured policy asks the user before running the tool.
    /// Always false while the approval gate is disabled.
    pub requires_approval: bool,
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
) -> McpToolApprovalVerdict {
    let annotations = normalize_tool_annotations(tool);
    let requires_approval = config.enabled
        && match config.preset {
            McpToolApprovalPreset::Permissive => annotations.destructive_hint,
            McpToolApprovalPreset::Restrictive => {
                !annotations.read_only_hint
                    || annotations.destructive_hint
                    || annotations.open_world_hint
            }
        };
    McpToolApprovalVerdict {
        annotations,
        annotated: tool.annotations.is_some(),
        requires_approval,
    }
}

#[cfg(test)]
mod tests {
    use super::{evaluate_mcp_tool_approval, normalize_tool_annotations};
    use crate::config::{McpToolApprovalConfig, McpToolApprovalPreset};
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
        assert!(!evaluate_mcp_tool_approval(&permissive, &unannotated).annotated);

        let empty_annotations = Tool::new("empty", "empty", Map::new())
            .with_annotations(ToolAnnotations::from_raw(None, None, None, None, None));
        assert!(evaluate_mcp_tool_approval(&permissive, &empty_annotations).annotated);
    }

    #[test]
    fn disabled_gate_never_requires_approval() {
        let disabled = config(false, McpToolApprovalPreset::Restrictive);
        let unannotated = Tool::new("unknown", "unknown", Map::new());
        assert!(!evaluate_mcp_tool_approval(&disabled, &unannotated).requires_approval);
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

        assert!(!evaluate_mcp_tool_approval(&permissive, &read_only_closed).requires_approval);
        assert!(!evaluate_mcp_tool_approval(&restrictive, &read_only_closed).requires_approval);
        assert!(
            !evaluate_mcp_tool_approval(&permissive, &open_world_non_destructive).requires_approval
        );
        assert!(
            evaluate_mcp_tool_approval(&restrictive, &open_world_non_destructive).requires_approval
        );
        assert!(evaluate_mcp_tool_approval(&permissive, &unannotated).requires_approval);
        assert!(evaluate_mcp_tool_approval(&restrictive, &unannotated).requires_approval);
    }
}
