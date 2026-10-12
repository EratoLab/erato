//! Resolve operator hints before approval, write filtering, or enumeration.

use crate::config::{McpServerConfig, McpToolAnnotationsConfig};
use rmcp::model::{Tool, ToolAnnotations};
use serde::Serialize;
use utoipa::ToSchema;

/// The winning declaration for one effective MCP tool hint.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum McpToolAnnotationSource {
    ToolOverride,
    ServerOverride,
    GlobalOverride,
    ServerSupplied,
    ToolDefault,
    ServerDefault,
    GlobalDefault,
    #[default]
    ProtocolDefault,
}

/// Sources are independent: a tool can inherit each hint from a different scope.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
pub struct McpToolAnnotationSources {
    pub read_only_hint: McpToolAnnotationSource,
    pub destructive_hint: McpToolAnnotationSource,
    pub idempotent_hint: McpToolAnnotationSource,
    pub open_world_hint: McpToolAnnotationSource,
}

/// Cache metadata belongs to Erato, rather than the server's MCP wire object.
#[derive(Debug, Clone)]
pub struct ResolvedMcpTool {
    pub tool: Tool,
    pub sources: McpToolAnnotationSources,
    /// Original hints, retained separately from operator assertions.
    pub server_annotations: Option<ToolAnnotations>,
}

pub fn resolve_tool_annotations(
    mut tool: Tool,
    server: &McpServerConfig,
    global_defaults: &McpToolAnnotationsConfig,
    global_overrides: &McpToolAnnotationsConfig,
) -> ResolvedMcpTool {
    use McpToolAnnotationSource as Source;

    let server_annotations = tool.annotations.clone();
    let hints = server_annotations.as_ref();
    let declared = McpToolAnnotationsConfig {
        read_only_hint: hints.and_then(|hint| hint.read_only_hint),
        destructive_hint: hints.and_then(|hint| hint.destructive_hint),
        idempotent_hint: hints.and_then(|hint| hint.idempotent_hint),
        open_world_hint: hints.and_then(|hint| hint.open_world_hint),
    };
    let tool_config = server.tools.get(tool.name.as_ref());
    let empty = McpToolAnnotationsConfig::default();
    let layers = [
        (
            tool_config.map_or(&empty, |config| &config.override_tool_annotations),
            Source::ToolOverride,
        ),
        (&server.override_tool_annotations, Source::ServerOverride),
        (global_overrides, Source::GlobalOverride),
        (&declared, Source::ServerSupplied),
        (
            tool_config.map_or(&empty, |config| &config.default_tool_annotations),
            Source::ToolDefault,
        ),
        (&server.default_tool_annotations, Source::ServerDefault),
        (global_defaults, Source::GlobalDefault),
    ];
    let resolve = |get: fn(&McpToolAnnotationsConfig) -> Option<bool>| {
        layers
            .iter()
            .find_map(|(hints, source)| get(hints).map(|value| (Some(value), *source)))
            .unwrap_or((None, Source::ProtocolDefault))
    };
    let (read_only, read_only_source) = resolve(|hints| hints.read_only_hint);
    let (destructive, destructive_source) = resolve(|hints| hints.destructive_hint);
    let (idempotent, idempotent_source) = resolve(|hints| hints.idempotent_hint);
    let (open_world, open_world_source) = resolve(|hints| hints.open_world_hint);

    // Do not materialize protocol defaults here: absence is still meaningful.
    // Preserve empty/title-only server objects and their title verbatim.
    if tool.annotations.is_some()
        || [read_only, destructive, idempotent, open_world]
            .iter()
            .any(Option::is_some)
    {
        let annotations = tool
            .annotations
            .get_or_insert_with(|| ToolAnnotations::from_raw(None, None, None, None, None));
        annotations.read_only_hint = read_only;
        annotations.destructive_hint = destructive;
        annotations.idempotent_hint = idempotent;
        annotations.open_world_hint = open_world;
    }

    ResolvedMcpTool {
        tool,
        sources: McpToolAnnotationSources {
            read_only_hint: read_only_source,
            destructive_hint: destructive_source,
            idempotent_hint: idempotent_source,
            open_world_hint: open_world_source,
        },
        server_annotations,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{McpToolApprovalConfig, McpToolApprovalPreset, McpToolConfig};
    use crate::services::mcp_tool_approval::{
        evaluate_mcp_tool_approval, normalize_tool_annotations,
    };
    use serde_json::json;

    fn tool(annotations: Option<ToolAnnotations>) -> Tool {
        let mut tool = Tool::new("read_file", "description", serde_json::Map::new());
        tool.annotations = annotations;
        tool
    }

    fn server() -> McpServerConfig {
        serde_json::from_value(
            json!({"transport_type": "streamable_http", "url": "https://example.com/mcp"}),
        )
        .unwrap()
    }

    fn hints(value: Option<bool>) -> McpToolAnnotationsConfig {
        McpToolAnnotationsConfig {
            read_only_hint: value,
            destructive_hint: value,
            idempotent_hint: value,
            open_world_hint: value,
        }
    }

    #[test]
    fn every_hint_uses_the_first_declared_layer_including_explicit_false() {
        use McpToolAnnotationSource as Source;
        let expected = [
            Source::ToolOverride,
            Source::ServerOverride,
            Source::GlobalOverride,
            Source::ServerSupplied,
            Source::ToolDefault,
            Source::ServerDefault,
            Source::GlobalDefault,
            Source::ProtocolDefault,
        ];
        for (winner, expected_source) in expected.into_iter().enumerate() {
            for value in [false, true] {
                // All lower-priority layers disagree with the winning value.
                let layer = |index| {
                    if index < winner {
                        None
                    } else if index == winner {
                        Some(value)
                    } else {
                        Some(!value)
                    }
                };
                let mut config = server();
                config.override_tool_annotations = hints(layer(1));
                config.default_tool_annotations = hints(layer(5));
                config.tools.insert(
                    "read_file".to_string(),
                    McpToolConfig {
                        override_tool_annotations: hints(layer(0)),
                        default_tool_annotations: hints(layer(4)),
                    },
                );
                let declared = tool(Some(ToolAnnotations::from_raw(
                    Some("Title".into()),
                    layer(3),
                    layer(3),
                    layer(3),
                    layer(3),
                )));
                let resolved =
                    resolve_tool_annotations(declared, &config, &hints(layer(6)), &hints(layer(2)));
                let effective = normalize_tool_annotations(&resolved.tool);
                assert_eq!(
                    effective.read_only_hint,
                    if winner == 7 { false } else { value }
                );
                assert_eq!(
                    effective.destructive_hint,
                    if winner == 7 { true } else { value }
                );
                assert_eq!(
                    effective.idempotent_hint,
                    if winner == 7 { false } else { value }
                );
                assert_eq!(
                    effective.open_world_hint,
                    if winner == 7 { true } else { value }
                );
                assert_eq!(
                    resolved.sources,
                    McpToolAnnotationSources {
                        read_only_hint: expected_source,
                        destructive_hint: expected_source,
                        idempotent_hint: expected_source,
                        open_world_hint: expected_source
                    }
                );
                assert_eq!(
                    resolved.tool.annotations.unwrap().title.as_deref(),
                    Some("Title")
                );
            }
        }
    }

    #[test]
    fn hints_merge_independently_without_changing_server_metadata() {
        let mut config = server();
        config.default_tool_annotations.destructive_hint = Some(false);
        config.tools.insert(
            "read_file".into(),
            McpToolConfig {
                override_tool_annotations: McpToolAnnotationsConfig {
                    read_only_hint: Some(true),
                    ..Default::default()
                },
                ..Default::default()
            },
        );
        let original = tool(Some(ToolAnnotations::from_raw(
            Some("Original title".into()),
            Some(false),
            None,
            None,
            Some(false),
        )));
        let resolved = resolve_tool_annotations(
            original.clone(),
            &config,
            &McpToolAnnotationsConfig {
                idempotent_hint: Some(true),
                ..Default::default()
            },
            &Default::default(),
        );
        assert_eq!(resolved.server_annotations, original.annotations);
        assert_eq!(resolved.tool.description, original.description);
        assert_eq!(resolved.tool.input_schema, original.input_schema);
        assert_eq!(resolved.tool.name, original.name);
        assert_eq!(
            resolved.sources,
            McpToolAnnotationSources {
                read_only_hint: McpToolAnnotationSource::ToolOverride,
                destructive_hint: McpToolAnnotationSource::ServerDefault,
                idempotent_hint: McpToolAnnotationSource::GlobalDefault,
                open_world_hint: McpToolAnnotationSource::ServerSupplied
            }
        );
        for preset in [
            McpToolApprovalPreset::Permissive,
            McpToolApprovalPreset::Restrictive,
        ] {
            let verdict = evaluate_mcp_tool_approval(
                &McpToolApprovalConfig {
                    enabled: true,
                    preset,
                    allow_always: false,
                },
                &resolved.tool,
            );
            assert!(!verdict.requires_approval);
            assert!(verdict.annotations.read_only_hint);
        }
    }

    #[test]
    fn absent_empty_partial_and_title_only_objects_receive_only_missing_hints() {
        let mut config = server();
        config.default_tool_annotations = McpToolAnnotationsConfig {
            read_only_hint: Some(true),
            destructive_hint: Some(false),
            ..Default::default()
        };
        for annotations in [
            None,
            Some(ToolAnnotations::from_raw(None, None, None, None, None)),
            Some(ToolAnnotations::from_raw(
                Some("Title".into()),
                None,
                None,
                None,
                None,
            )),
            Some(ToolAnnotations::from_raw(
                None,
                Some(false),
                None,
                None,
                None,
            )),
        ] {
            let original = tool(annotations);
            let resolved = resolve_tool_annotations(
                original.clone(),
                &config,
                &Default::default(),
                &Default::default(),
            );
            let hints = resolved.tool.annotations.unwrap();
            assert_eq!(
                hints.read_only_hint,
                original
                    .annotations
                    .as_ref()
                    .and_then(|hints| hints.read_only_hint)
                    .or(Some(true))
            );
            assert_eq!(hints.destructive_hint, Some(false));
            assert_eq!(hints.idempotent_hint, None);
            assert_eq!(hints.open_world_hint, None);
            assert_eq!(
                hints.title,
                original.annotations.and_then(|hints| hints.title)
            );
        }
    }

    #[test]
    fn empty_configuration_is_identity_and_tool_keys_are_exact_and_server_scoped() {
        for annotations in [
            None,
            Some(ToolAnnotations::from_raw(None, None, None, None, None)),
            Some(ToolAnnotations::from_raw(
                Some("Title".into()),
                Some(false),
                Some(true),
                Some(false),
                Some(true),
            )),
        ] {
            let original = tool(annotations);
            assert_eq!(
                resolve_tool_annotations(
                    original.clone(),
                    &server(),
                    &Default::default(),
                    &Default::default()
                )
                .tool,
                original
            );
        }
        let mut config = server();
        for name in ["read_*", "Read_file", "not_discovered"] {
            config.tools.insert(
                name.into(),
                McpToolConfig {
                    override_tool_annotations: hints(Some(true)),
                    ..Default::default()
                },
            );
        }
        assert!(
            resolve_tool_annotations(
                tool(None),
                &config,
                &Default::default(),
                &Default::default()
            )
            .tool
            .annotations
            .is_none()
        );
        config.tools.insert(
            "read_file".into(),
            McpToolConfig {
                override_tool_annotations: hints(Some(true)),
                ..Default::default()
            },
        );
        assert!(
            resolve_tool_annotations(
                tool(None),
                &config,
                &Default::default(),
                &Default::default()
            )
            .tool
            .annotations
            .is_some()
        );
        assert!(
            resolve_tool_annotations(
                tool(None),
                &server(),
                &Default::default(),
                &Default::default()
            )
            .tool
            .annotations
            .is_none()
        );
    }
}
