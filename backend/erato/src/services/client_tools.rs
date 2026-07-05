//! Client-executed tools for action facets.
//!
//! An action facet may declare `client_tools`: tools the model can CALL whose
//! result is fed back into the SAME agentic turn — like an MCP tool, but
//! executed on the client (the Outlook add-in / web app) rather than on the
//! backend. This is distinct from `client_actions` (terminal, one-way,
//! user-confirmed mutations proposed via `propose_client_action`): a client
//! tool returns a result and the turn continues.
//!
//! Returning client tools MUST be read-only / idempotent: a backend restart
//! drops the parked turn, so a client may re-execute on recovery. Mutations
//! must use the terminal `client_actions` path.

use std::collections::HashMap;

use genai::chat::Tool as GenaiTool;
use genai::chat::ToolName as GenaiToolName;
use serde_json::Value;

use crate::config::ClientToolConfig;

/// Build a genai tool for a facet-declared client tool. `schema` is the parsed
/// JSON-Schema object for the tool's input parameters (validated as a JSON
/// object at config load). Mirrors `client_actions::build_client_action_tool`'s
/// shape, including the `strict` / `compat_omit_strict` handling.
pub fn build_client_tool(
    name: &str,
    description: &str,
    schema: Value,
    omit_tool_strict: bool,
) -> GenaiTool {
    GenaiTool {
        name: GenaiToolName::Custom(name.to_string()),
        description: Some(description.to_string()),
        schema: Some(schema),
        strict: if omit_tool_strict { None } else { Some(false) },
        config: None,
    }
}

/// Why an allowlist-selected client tool was NOT offered to the model.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClientToolSkip {
    /// The bare name collides with the reserved `propose_client_action` tool.
    ReservedName,
    /// An MCP tool already uses the same model-facing name; the MCP tool wins.
    /// `explicitly_selected` is true when the allowlist named this client tool
    /// EXACTLY (`namespace/name`, not via a wildcard) — that combination is
    /// always a config bug and is logged at error level.
    McpCollision { explicitly_selected: bool },
    /// An earlier client tool (in deterministic qualified-name order) already
    /// exposes the same model-facing name. Cross-namespace bare-name reuse is
    /// valid config (platform-disjoint packages), but providers require unique
    /// tool names within one request, so only the first is offered.
    DuplicateBareName { winner_qualified: String },
}

/// The client tools to offer for one request, plus per-tool skip diagnostics.
pub struct ClientToolSelection<'a> {
    pub offered: Vec<&'a ClientToolConfig>,
    pub skipped: Vec<(&'a ClientToolConfig, ClientToolSkip)>,
}

/// Select the client tools to offer: the allowlist-matched tools in
/// DETERMINISTIC qualified-name order (config holds them in a `HashMap`, whose
/// iteration order would otherwise churn provider prompt-cache prefixes and
/// make collision winners arbitrary across restarts), minus reserved-name,
/// MCP-collision, and duplicate-bare-name entries. Pure — the caller does the
/// allowlist matching and the logging.
pub fn select_client_tools<'a>(
    allowlist_matched: Vec<&'a ClientToolConfig>,
    allowlist: &[String],
    mcp_has_tool: impl Fn(&str) -> bool,
) -> ClientToolSelection<'a> {
    let mut matched = allowlist_matched;
    matched.sort_by_key(|tool| tool.qualified_name());

    let mut offered: Vec<&ClientToolConfig> = Vec::new();
    let mut winner_by_bare_name: HashMap<&str, String> = HashMap::new();
    let mut skipped: Vec<(&ClientToolConfig, ClientToolSkip)> = Vec::new();

    for tool in matched {
        let name = tool.name.as_str();
        if name == crate::services::client_actions::CLIENT_ACTION_TOOL_NAME {
            skipped.push((tool, ClientToolSkip::ReservedName));
            continue;
        }
        if mcp_has_tool(name) {
            let explicitly_selected = allowlist
                .iter()
                .any(|pattern| *pattern == tool.qualified_name());
            skipped.push((
                tool,
                ClientToolSkip::McpCollision {
                    explicitly_selected,
                },
            ));
            continue;
        }
        if let Some(winner) = winner_by_bare_name.get(name) {
            skipped.push((
                tool,
                ClientToolSkip::DuplicateBareName {
                    winner_qualified: winner.clone(),
                },
            ));
            continue;
        }
        winner_by_bare_name.insert(name, tool.qualified_name());
        offered.push(tool);
    }

    ClientToolSelection { offered, skipped }
}

/// The result of a client-executed tool, delivered back to the suspended
/// agentic loop. Either a successful JSON result (becomes the tool response the
/// model reasons over), an error message (the model sees it and can recover), or
/// a `Cancelled` marker produced by the backend itself when the park ends
/// without a client result (e.g. the timeout fires). `Cancelled` is never sent
/// by the client — it exists so the loop can emit a typed, `tool_call_id`
/// -correlated resolution the client can distinguish from a genuine tool error
/// (so a still-executing client learns its work was abandoned rather than
/// discovering it via a benign 404 on a late POST).
#[derive(Debug, Clone)]
pub enum ClientToolOutcome {
    Result(Value),
    Error(String),
    Cancelled { reason: String },
}

/// Outcome of attempting to deliver a client-tool result into a parked loop.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClientToolDelivery {
    /// The result was handed to the waiting loop.
    Delivered,
    /// No loop is waiting for this tool_call_id — already delivered, timed out,
    /// aborted, or never issued. The delivery is a benign no-op (idempotent).
    Unknown,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn build_client_tool_sets_name_description_and_schema() {
        let schema = json!({ "type": "object", "properties": {} });
        let tool = build_client_tool(
            "fetch_availability",
            "Fetch the user's free/busy.",
            schema.clone(),
            false,
        );
        match &tool.name {
            GenaiToolName::Custom(name) => assert_eq!(name, "fetch_availability"),
            other => panic!("expected a custom tool name, got {other:?}"),
        }
        assert_eq!(
            tool.description.as_deref(),
            Some("Fetch the user's free/busy.")
        );
        assert_eq!(tool.schema, Some(schema));
        assert_eq!(tool.strict, Some(false));
    }

    #[test]
    fn build_client_tool_omits_strict_when_requested() {
        let tool = build_client_tool("t", "d", json!({ "type": "object" }), true);
        assert_eq!(tool.strict, None);
    }

    fn tool(namespace: &str, name: &str) -> ClientToolConfig {
        ClientToolConfig {
            name: name.to_string(),
            namespace: Some(namespace.to_string()),
            description: "d".to_string(),
            parameters: r#"{ "type": "object" }"#.to_string(),
            timeout_ms: None,
        }
    }

    #[test]
    fn select_orders_deterministically_by_qualified_name() {
        let (b, a) = (tool("teams", "ping"), tool("outlook", "ping2"));
        let selection = select_client_tools(vec![&b, &a], &[], |_| false);
        let offered: Vec<_> = selection
            .offered
            .iter()
            .map(|t| t.qualified_name())
            .collect();
        assert_eq!(offered, vec!["outlook/ping2", "teams/ping"]);
        assert!(selection.skipped.is_empty());
    }

    #[test]
    fn select_dedups_bare_names_first_in_order_wins() {
        let (teams, outlook) = (
            tool("teams", "fetch_availability"),
            tool("outlook", "fetch_availability"),
        );
        let selection = select_client_tools(vec![&teams, &outlook], &[], |_| false);
        assert_eq!(selection.offered.len(), 1);
        assert_eq!(
            selection.offered[0].qualified_name(),
            "outlook/fetch_availability"
        );
        assert_eq!(
            selection.skipped,
            vec![(
                &teams,
                ClientToolSkip::DuplicateBareName {
                    winner_qualified: "outlook/fetch_availability".to_string(),
                }
            )]
        );
    }

    #[test]
    fn select_skips_mcp_collisions_and_flags_exact_selection() {
        let (colliding, wildcard_selected) = (tool("outlook", "search"), tool("teams", "search2"));
        let allowlist = vec!["outlook/search".to_string(), "teams/*".to_string()];
        let selection =
            select_client_tools(vec![&colliding, &wildcard_selected], &allowlist, |name| {
                name == "search" || name == "search2"
            });
        assert!(selection.offered.is_empty());
        assert_eq!(
            selection.skipped,
            vec![
                (
                    &colliding,
                    ClientToolSkip::McpCollision {
                        explicitly_selected: true,
                    }
                ),
                (
                    &wildcard_selected,
                    ClientToolSkip::McpCollision {
                        explicitly_selected: false,
                    }
                ),
            ]
        );
    }

    #[test]
    fn select_skips_the_reserved_name() {
        let reserved = tool("client", "propose_client_action");
        let selection = select_client_tools(vec![&reserved], &[], |_| false);
        assert!(selection.offered.is_empty());
        assert_eq!(selection.skipped[0].1, ClientToolSkip::ReservedName);
    }
}
