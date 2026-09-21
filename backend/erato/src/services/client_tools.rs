//! Client-executed tools for action facets.
//!
//! An action facet may declare `client_tools`: tools the model can CALL whose
//! result is fed back into the SAME agentic turn — like an MCP tool, but
//! executed on the client (the Outlook add-in / web app) rather than on the
//! backend. This is distinct from `client_actions` (terminal, one-way,
//! user-confirmed mutations proposed via `propose_client_action`): a client
//! tool normally returns a result and the turn continues. Opt-in submissions
//! validate/stage a draft and finish the turn on success, without applying it.
//!
//! Returning client tools MUST be read-only / idempotent: a backend restart
//! drops the parked turn, so a client may re-execute on recovery. Mutations
//! must use the terminal `client_actions` path.

use std::collections::HashMap;
use std::sync::Arc;

use genai::chat::Tool as GenaiTool;
use genai::chat::ToolName as GenaiToolName;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use utoipa::ToSchema;

use crate::config::{ClientToolConfig, ClientToolNativeSchema};

/// Request-scoped policy for the exact tool selected after namespace deduplication.
#[derive(Clone)]
pub struct OfferedClientTool {
    pub timeout_ms: Option<u64>,
    pub submission: Option<SubmissionPolicy>,
}

#[derive(Clone)]
pub struct SubmissionPolicy {
    validator: Arc<jsonschema::Validator>,
    pub max_attempts: u32,
}

impl OfferedClientTool {
    pub fn prepare(config: &ClientToolConfig, schema: &Value) -> Result<Self, String> {
        let submission = config
            .submission
            .as_ref()
            .map(|submission| {
                erato_config::client_tool_schema::compile(schema).map(|validator| {
                    SubmissionPolicy {
                        validator: Arc::new(validator),
                        max_attempts: submission.max_attempts,
                    }
                })
            })
            .transpose()?;
        Ok(Self {
            timeout_ms: config.timeout_ms,
            submission,
        })
    }
}

/// Compact, parser-owned diagnostics. `path` is a JSON Pointer into the tool
/// arguments (empty for the root); `code` is a stable validator error identifier.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, ToSchema)]
pub struct ClientToolValidationIssue {
    pub path: String,
    pub code: String,
    pub message: String,
}

const MAX_VALIDATION_ISSUES: usize = 16;

fn bounded(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

fn bound_issues(issues: Vec<ClientToolValidationIssue>) -> Vec<ClientToolValidationIssue> {
    issues
        .into_iter()
        .take(MAX_VALIDATION_ISSUES)
        .map(|issue| ClientToolValidationIssue {
            path: bounded(&issue.path, 512),
            code: bounded(&issue.code, 64),
            message: bounded(&issue.message, 512),
        })
        .collect()
}

impl SubmissionPolicy {
    pub fn validate(&self, input: &Value) -> Option<ClientToolOutcome> {
        let issues = self
            .validator
            .iter_errors(input)
            .take(MAX_VALIDATION_ISSUES)
            .map(|error| {
                ClientToolValidationIssue {
                    path: error.instance_path.to_string(),
                    code: error
                        .schema_path
                        .to_string()
                        .rsplit('/')
                        .next()
                        .unwrap_or("schema")
                        .into(),
                    // Do not echo the proposed artifact into a correction response.
                    message: bounded(&error.masked().to_string(), 512),
                }
            })
            .collect::<Vec<_>>();
        (!issues.is_empty()).then(|| ClientToolOutcome::ValidationFailed(bound_issues(issues)))
    }

    pub fn finish_after(&self, outcome: &ClientToolOutcome, attempt: u32) -> bool {
        matches!(
            outcome,
            ClientToolOutcome::Result(_) | ClientToolOutcome::Cancelled { .. }
        ) || attempt >= self.max_attempts
    }

    pub fn annotate(&self, output: &mut Value, outcome: &ClientToolOutcome, attempt: u32) {
        let finished = self.finish_after(outcome, attempt);
        output["submission"] = json!({
            "status": if matches!(outcome, ClientToolOutcome::Result(_)) { "accepted" }
                else if finished { "failed" } else { "retry" },
            "attempts_remaining": if finished { 0 } else { self.max_attempts.saturating_sub(attempt) },
        });
    }
}

/// Native strict generation is an optimization, not the acceptance authority.
/// Only adapters that actually serialize the setting are eligible. A deployment
/// explicitly opts each model/endpoint in; never infer support from a model name.
pub fn native_strict_for_submission(
    config: &ClientToolConfig,
    schema: &Value,
    provider_kind: &str,
    model_supports_strict: bool,
    omit_strict: bool,
) -> Result<bool, String> {
    let Some(submission) = &config.submission else {
        return Ok(false);
    };
    let available = model_supports_strict
        && !omit_strict
        && matches!(
            provider_kind,
            "openai" | "openai_responses" | "azure_openai_responses"
        )
        && schema.get("anyOf").is_none()
        && native_schema_compatible(schema);
    match submission.native_schema {
        ClientToolNativeSchema::Off => Ok(false),
        ClientToolNativeSchema::Auto => Ok(available),
        ClientToolNativeSchema::Required if available => Ok(true),
        ClientToolNativeSchema::Required => Err(format!(
            "Client tool '{}' requires native schema enforcement, but the model, adapter, schema or compat_omit_strict setting does not support it",
            config.qualified_name()
        )),
    }
}

// Conservative OpenAI strict subset. Walk schema positions, never instance
// literals (const/enum/default). Do not make optional fields required or strip
// constraints to coerce a schema into a provider's subset.
fn native_schema_compatible(schema: &Value) -> bool {
    let Some(object) = schema.as_object() else {
        return false;
    };
    for key in object.keys() {
        if !matches!(
            key.as_str(),
            "$schema"
                | "$defs"
                | "$ref"
                | "type"
                | "title"
                | "description"
                | "properties"
                | "required"
                | "additionalProperties"
                | "items"
                | "anyOf"
                | "enum"
                | "const"
        ) {
            return false;
        }
    }
    if let Some(reference) = object.get("$ref")
        && !reference
            .as_str()
            .is_some_and(|reference| reference == "#" || reference.starts_with("#/$defs/"))
    {
        return false;
    }
    let object_type = object.get("type").is_some_and(|ty| {
        ty == "object"
            || ty
                .as_array()
                .is_some_and(|types| types.iter().any(|ty| ty == "object"))
    });
    if object_type || object.contains_key("properties") {
        let Some(properties) = object.get("properties").and_then(Value::as_object) else {
            return false;
        };
        let Some(required) = object.get("required").and_then(Value::as_array) else {
            return false;
        };
        if object.get("additionalProperties") != Some(&Value::Bool(false))
            || required.len() != properties.len()
            || !properties
                .keys()
                .all(|key| required.iter().any(|value| value.as_str() == Some(key)))
        {
            return false;
        }
    }
    for key in ["properties", "$defs"] {
        if let Some(children) = object.get(key).and_then(Value::as_object)
            && !children.values().all(native_schema_compatible)
        {
            return false;
        }
    }
    if let Some(items) = object.get("items")
        && !native_schema_compatible(items)
    {
        return false;
    }
    if let Some(choices) = object.get("anyOf").and_then(Value::as_array)
        && !choices.iter().all(native_schema_compatible)
    {
        return false;
    }
    true
}

/// Build a genai tool for a facet-declared client tool. `schema` is the parsed
/// JSON-Schema object for the tool's input parameters (validated as a JSON
/// object at config load). Mirrors `client_actions::build_client_action_tool`'s
/// shape, including the `strict` / `compat_omit_strict` handling.
pub fn build_client_tool(
    name: &str,
    description: &str,
    schema: Value,
    omit_tool_strict: bool,
    native_strict: bool,
) -> GenaiTool {
    GenaiTool {
        name: GenaiToolName::Custom(name.to_string()),
        description: Some(description.to_string()),
        schema: Some(schema),
        strict: if omit_tool_strict {
            None
        } else {
            Some(native_strict)
        },
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
        if name == crate::services::client_actions::CLIENT_ACTION_TOOL_NAME
            || name == crate::services::delegation::DELEGATE_TO_ASSISTANT_TOOL_NAME
        {
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
    ValidationFailed(Vec<ClientToolValidationIssue>),
    Cancelled { reason: String },
}

impl ClientToolOutcome {
    /// Shared by direct delivery and the cross-instance command queue so both
    /// paths preserve diagnostics and error precedence, including explicit null.
    pub fn from_payload(payload: &Value) -> Self {
        if let Some(issues) = payload.get("validation_errors") {
            match serde_json::from_value::<Vec<ClientToolValidationIssue>>(issues.clone()) {
                Ok(issues) if !issues.is_empty() => {
                    return Self::ValidationFailed(bound_issues(issues));
                }
                Ok(_) => {}
                Err(_) => return Self::Error("Invalid client validation diagnostics".into()),
            }
        }
        if let Some(error) = payload.get("error") {
            return Self::Error(error.as_str().unwrap_or("client tool failed").into());
        }
        match payload.get("result") {
            Some(result) => Self::Result(result.clone()),
            None => Self::Error("client tool returned neither a result nor an error".into()),
        }
    }
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

    fn submission() -> (ClientToolConfig, Value) {
        let schema = json!({"type":"object","properties":{"title":{"type":"string"}},"required":["title"],"additionalProperties":false});
        let config = ClientToolConfig {
            name: "submit_draft".into(),
            parameters: schema.to_string(),
            submission: Some(Default::default()),
            ..Default::default()
        };
        (config, schema)
    }

    #[test]
    fn validates_before_dispatch_and_bounds_repair_feedback() {
        let (config, schema) = submission();
        let policy = OfferedClientTool::prepare(&config, &schema)
            .unwrap()
            .submission
            .unwrap();
        assert!(policy.validate(&json!({"title":"Draft"})).is_none());
        let invalid = json!({"title": ["large-artifact".repeat(1000)]});
        let failure = policy.validate(&invalid).unwrap();
        let ClientToolOutcome::ValidationFailed(issues) = &failure else {
            panic!("validation failure")
        };
        assert_eq!(issues[0].path, "/title");
        assert_eq!(issues[0].code, "type");
        assert!(!issues[0].message.contains("large-artifact"));
        assert!(!policy.finish_after(&failure, 1));
        assert!(policy.finish_after(&failure, 3));
        assert!(policy.finish_after(&ClientToolOutcome::Result(Value::Null), 1));
        assert!(policy.finish_after(
            &ClientToolOutcome::Cancelled {
                reason: "timeout".into()
            },
            1
        ));
        let mut output = json!({});
        policy.annotate(&mut output, &failure, 2);
        assert_eq!(
            output["submission"],
            json!({"status":"retry","attempts_remaining":1})
        );
        policy.annotate(&mut output, &failure, 3);
        assert_eq!(
            output["submission"],
            json!({"status":"failed","attempts_remaining":0})
        );
    }

    #[test]
    fn native_enforcement_requires_model_adapter_and_schema_support() {
        let (mut config, schema) = submission();
        for provider in ["openai", "openai_responses", "azure_openai_responses"] {
            assert!(native_strict_for_submission(&config, &schema, provider, true, false).unwrap());
        }
        for provider in ["gemini", "vertex_ai", "ollama", "unknown"] {
            assert!(
                !native_strict_for_submission(&config, &schema, provider, true, false).unwrap()
            );
        }
        assert!(!native_strict_for_submission(&config, &schema, "openai", false, false).unwrap());
        assert!(!native_strict_for_submission(&config, &schema, "openai", true, true).unwrap());
        let mut optional = schema.clone();
        optional["required"] = json!([]);
        assert!(!native_strict_for_submission(&config, &optional, "openai", true, false).unwrap());
        assert_eq!(
            optional["required"],
            json!([]),
            "optional fields must not change meaning"
        );
        config.submission.as_mut().unwrap().native_schema = ClientToolNativeSchema::Required;
        assert!(native_strict_for_submission(&config, &optional, "openai", true, false).is_err());
        config.submission.as_mut().unwrap().native_schema = ClientToolNativeSchema::Off;
        assert!(!native_strict_for_submission(&config, &schema, "openai", true, false).unwrap());
        assert_eq!(
            build_client_tool("submit_draft", "Stage a draft", schema, false, true).strict,
            Some(true)
        );
    }

    #[test]
    fn diagnostic_transport_fails_closed_and_preserves_null_success() {
        let payload = json!({"result": {"accepted":true}, "error":"bad draft", "validation_errors":[
            {"path":"/items/0/source","code":"unknown_reference","message":"Use a current ID"}
        ]});
        let ClientToolOutcome::ValidationFailed(issues) = ClientToolOutcome::from_payload(&payload)
        else {
            panic!("errors take precedence")
        };
        assert_eq!(issues[0].code, "unknown_reference");
        assert!(matches!(
            ClientToolOutcome::from_payload(&json!({"result":null})),
            ClientToolOutcome::Result(Value::Null)
        ));
        assert!(matches!(
            ClientToolOutcome::from_payload(&json!({})),
            ClientToolOutcome::Error(_)
        ));
        assert!(matches!(
            ClientToolOutcome::from_payload(&json!({"result":true,"validation_errors":{}})),
            ClientToolOutcome::Error(_)
        ));
    }

    #[test]
    fn build_client_tool_sets_name_description_and_schema() {
        let schema = json!({ "type": "object", "properties": {} });
        let tool = build_client_tool(
            "fetch_availability",
            "Fetch the user's free/busy.",
            schema.clone(),
            false,
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
        let tool = build_client_tool("t", "d", json!({ "type": "object" }), true, false);
        assert_eq!(tool.strict, None);
    }

    fn tool(namespace: &str, name: &str) -> ClientToolConfig {
        ClientToolConfig {
            name: name.to_string(),
            namespace: Some(namespace.to_string()),
            description: "d".to_string(),
            parameters: r#"{ "type": "object" }"#.to_string(),
            timeout_ms: None,
            submission: None,
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
