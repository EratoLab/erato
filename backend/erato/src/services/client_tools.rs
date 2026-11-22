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
    pub config: ClientToolConfig,
    pub executor: Option<crate::services::client_operations::ExecutorBinding>,
    /// Synthetic bound operations use account discovery, never a child SSE relay.
    pub inbox_only: bool,
    pub timeout_ms: Option<u64>,
    pub submission: Option<SubmissionPolicy>,
    /// Set when an offered submission lists this tool in `part_tools`.
    pub part: Option<PartPolicy>,
    /// Set only when a delegated run is offered the tool under its grant.
    pub grant: Option<GrantedCall>,
    /// The page said the app behind `executor` runs in strict mode: in the
    /// request that offers the tool, or, for a delegated run, in the one that
    /// launched it (the grant's `strict_mode`).
    pub executor_strict_mode: bool,
}

/// The desktop sidecar tools whose results the Erato desktop app shows for
/// review on the device under strict mode before anything leaves it: those
/// whose provider entry selects items (`desktop-sidecar-protocol/providers/
/// sidecar.json`). Mailboxes and search fields are not reviewed.
pub const STRICT_REVIEWED_SIDECAR_TOOLS: [&str; 4] = [
    "get_sidecar_folder_hierarchy",
    "search_sidecar_index",
    "get_sidecar_document",
    "read_sidecar_conversation",
];

/// What a granted call carries to the executor besides the model's input.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GrantedCall {
    pub owner_chat_id: sea_orm::prelude::Uuid,
    pub owner_message_id: sea_orm::prelude::Uuid,
    pub context_ref: Option<String>,
    /// The input field that receives `context_ref`.
    pub context_input: Option<String>,
    /// Input fields the host fills from its own context; dropped from the call.
    pub host_inputs: Vec<String>,
    /// The call parks as a durable operation for the grant's binding instead
    /// of going live.
    pub durable: bool,
    /// The key one decision may approve this tool's calls under, for a tool
    /// with `approval_scope = "context"` on a host that has a scope.
    pub approval_scope: Option<crate::services::approval_scope::ScopeKey>,
}

/// What the arguments of a submission or part call go through before
/// dispatch: decoding of arrays and objects sent as strings, then the schema.
#[derive(Clone)]
pub struct ArgumentCheck {
    validator: Arc<jsonschema::Validator>,
    schema: Arc<Value>,
    /// `#/…` pointers resolve against the root everywhere, so alternatives
    /// can be read from the schema.
    readable: bool,
}

#[derive(Clone)]
pub struct SubmissionPolicy {
    arguments: ArgumentCheck,
    pub max_attempts: u32,
}

/// A tool whose calls stage one part of a submission's draft.
#[derive(Clone)]
pub struct PartPolicy {
    pub arguments: ArgumentCheck,
    /// The qualified name of the submission tool that finishes the draft.
    pub submission: String,
    key: String,
}

/// Longest part name kept in the correction state.
const MAX_PART_KEY_CHARS: usize = 64;

impl PartPolicy {
    /// The part a call writes, from its `part_key` argument: `2`, `2.0` and
    /// `"2"` name the same part.
    pub fn key_of(&self, input: &Value) -> Option<String> {
        input.pointer(&self.key).map(|value| {
            let key = match value {
                Value::String(text) => text.clone(),
                Value::Number(number) => number
                    .as_f64()
                    .filter(|value| value.fract() == 0.0 && value.abs() < 1e15)
                    .map_or_else(|| number.to_string(), |value| (value as i64).to_string()),
                other => other.to_string(),
            };
            bounded(&key, MAX_PART_KEY_CHARS)
        })
    }

    pub fn key_pointer(&self) -> &str {
        &self.key
    }
}

impl OfferedClientTool {
    pub fn restore_config(
        saved: &ClientToolConfig,
        current: &ClientToolConfig,
    ) -> ClientToolConfig {
        let mut restored = current.clone();
        if let Some(saved_policy) = &saved.submission {
            let mut policy = current
                .submission
                .clone()
                .unwrap_or_else(|| saved_policy.clone());
            policy.max_attempts = policy.max_attempts.min(saved_policy.max_attempts);
            policy.max_recovery_reads = policy
                .max_recovery_reads
                .min(saved_policy.max_recovery_reads);
            policy
                .recovery_read_tools
                .retain(|name| saved_policy.recovery_read_tools.contains(name));
            policy
                .part_tools
                .retain(|name| saved_policy.part_tools.contains(name));
            policy.max_part_calls = policy.max_part_calls.min(saved_policy.max_part_calls);
            policy.max_row_tries = policy.max_row_tries.min(saved_policy.max_row_tries);
            policy.part_key = saved_policy.part_key.clone();
            restored.submission = Some(policy);
        }
        restored
    }

    pub fn prepare(config: &ClientToolConfig, schema: &Value) -> Result<Self, String> {
        let submission = config
            .submission
            .as_ref()
            .map(|submission| {
                ArgumentCheck::compile(schema).map(|arguments| SubmissionPolicy {
                    arguments,
                    max_attempts: submission.max_attempts,
                })
            })
            .transpose()?;
        Ok(Self {
            config: config.clone(),
            executor: None,
            inbox_only: false,
            timeout_ms: config.timeout_ms,
            submission,
            part: None,
            grant: None,
            executor_strict_mode: false,
        })
    }

    /// The checks this tool's call arguments get before dispatch, if any.
    pub fn argument_check(&self) -> Option<&ArgumentCheck> {
        self.submission
            .as_ref()
            .map(|submission| &submission.arguments)
            .or_else(|| self.part.as_ref().map(|part| &part.arguments))
    }

    /// Whether the Erato desktop app will ask the user about this tool's
    /// calls itself: a reviewed sidecar tool, routed to a desktop sidecar
    /// binding the page said runs in strict mode. A chat question before it
    /// would ask twice for the same thing (ERMAIN-1155).
    pub fn reviewed_on_device(&self) -> bool {
        use crate::config::ClientToolHostContext;
        use crate::services::client_operations::ExecutionRealm;
        let host = ClientToolHostContext::DesktopSidecar;
        self.executor_strict_mode
            && self.config.host_context == Some(host)
            && STRICT_REVIEWED_SIDECAR_TOOLS.contains(&self.config.name.as_str())
            && self.executor.as_ref().is_some_and(|binding| {
                binding.realm == ExecutionRealm::DesktopSidecar
                    && binding
                        .host_context
                        .as_ref()
                        .is_some_and(|context| context.kind == host.as_str())
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

/// Opaque host-owned correction handle; it grants no permission to apply an artifact.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, ToSchema)]
pub struct ClientToolDraftReference {
    pub id: String,
    pub revision: u32,
}

/// Rejection metadata, distinct from a successful submission result.
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq, ToSchema)]
pub struct ClientToolSubmissionFeedback {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub draft: Option<ClientToolDraftReference>,
    /// Ends an opt-in submission turn without accepting an artifact.
    #[serde(default)]
    pub terminal: bool,
    #[serde(default, skip_serializing_if = "SubmissionRecovery::is_default")]
    pub recovery: SubmissionRecovery,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SubmissionRecovery {
    #[default]
    RepairArguments,
    ReadCurrentContext,
    CannotContinue,
}

impl SubmissionRecovery {
    fn is_default(&self) -> bool {
        *self == Self::RepairArguments
    }
}

const MAX_VALIDATION_ISSUES: usize = 16;
/// Issues compared per alternative when looking for the ones all share.
const MAX_COUNTED_ERRORS: usize = 256;
/// `$ref` hops followed when reading an alternative's keys.
const MAX_REFERENCE_HOPS: usize = 8;

fn schema_issue(error: &jsonschema::ValidationError<'_>) -> ClientToolValidationIssue {
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
}

enum Choice {
    Alternative(usize),
    Issues(Vec<ClientToolValidationIssue>),
}

/// What one alternative of an `anyOf` or `oneOf` requires and names, read
/// through its `$ref`s.
#[derive(Default)]
struct Alternative<'s> {
    required: Vec<&'s str>,
    properties: Vec<(&'s str, &'s Value)>,
}

impl<'s> Alternative<'s> {
    /// None when the alternative names keys this cannot see: through a
    /// combinator, a condition, or a reference it does not follow.
    fn read(root: &'s Value, mut schema: &'s Value) -> Option<Self> {
        let mut alternative = Self::default();
        for _ in 0..=MAX_REFERENCE_HOPS {
            let object = match schema {
                Value::Object(object) => object,
                Value::Bool(_) => return Some(alternative),
                _ => return None,
            };
            if [
                "allOf",
                "anyOf",
                "oneOf",
                "if",
                "dependentSchemas",
                "dependencies",
                "$dynamicRef",
                "$recursiveRef",
            ]
            .iter()
            .any(|keyword| object.contains_key(*keyword))
            {
                return None;
            }
            alternative.required.extend(required_keys(schema));
            for (name, property) in object
                .get("properties")
                .and_then(Value::as_object)
                .into_iter()
                .flatten()
            {
                if !alternative
                    .properties
                    .iter()
                    .any(|(known, _)| known == name)
                {
                    alternative.properties.push((name, property));
                }
            }
            let Some(reference) = object.get("$ref") else {
                return Some(alternative);
            };
            schema = resolve(root, reference.as_str()?)?;
        }
        None
    }

    fn names(&self, key: &str) -> bool {
        self.required.contains(&key) || self.properties.iter().any(|(name, _)| *name == key)
    }

    fn constants(&self, key: &str) -> Option<Vec<&'s Value>> {
        let (_, property) = self.properties.iter().find(|(name, _)| *name == key)?;
        if let Some(value) = property.get("const") {
            return Some(vec![value]);
        }
        property
            .get("enum")
            .and_then(Value::as_array)
            .map(|values| values.iter().collect())
    }
}

/// The properties every alternative constrains with `const` or `enum`, not
/// all with the same values, such as `kind`, with the values any of them allows.
fn tags<'s>(alternatives: &[Alternative<'s>]) -> Vec<(&'s str, Vec<&'s Value>)> {
    let Some(first) = alternatives.first() else {
        return Vec::new();
    };
    first
        .properties
        .iter()
        .filter_map(|(name, _)| {
            let sets = alternatives
                .iter()
                .map(|alternative| alternative.constants(name))
                .collect::<Option<Vec<_>>>()?;
            let same = |a: &[&Value], b: &[&Value]| {
                a.iter().all(|value| b.contains(value)) && b.iter().all(|value| a.contains(value))
            };
            if sets.iter().all(|set| same(set, &sets[0])) {
                return None;
            }
            let mut values = Vec::new();
            for value in sets.into_iter().flatten() {
                if !values.contains(&value) {
                    values.push(value);
                }
            }
            Some((*name, values))
        })
        .collect()
}

/// The schema at a keyword location, whose `$ref` segments stand for the
/// schema the reference points to.
fn schema_at<'s>(root: &'s Value, location: &str) -> Option<&'s Value> {
    let mut schema = root;
    for token in location.split('/').skip(1) {
        let token = token.replace("~1", "/").replace("~0", "~");
        schema = match schema {
            Value::Object(object) => match object.get(&token)? {
                Value::String(reference) if token == "$ref" => resolve(root, reference)?,
                value => value,
            },
            Value::Array(items) => items.get(token.parse::<usize>().ok()?)?,
            _ => return None,
        };
    }
    Some(schema)
}

/// Follows `#` and `#/…` pointers into this schema only; anything else, such
/// as an anchor or a `$id` URI, is not followed.
fn resolve<'s>(root: &'s Value, reference: &str) -> Option<&'s Value> {
    root.pointer(reference.strip_prefix('#')?)
}

fn pointer_token(key: &str) -> String {
    key.replace('~', "~0").replace('/', "~1")
}

/// Whether the schema sets `$id` below its root or names an anchor: `#/…`
/// pointers inside it may then not mean the root's.
fn has_nested_base(schema: &Value, root: bool) -> bool {
    let Some(object) = schema.as_object() else {
        return schema
            .as_array()
            .is_some_and(|items| items.iter().any(|item| has_nested_base(item, false)));
    };
    object
        .iter()
        .any(|(keyword, value)| match keyword.as_str() {
            "$id" => !root,
            "$anchor" | "$dynamicAnchor" => true,
            "const" | "enum" | "default" | "examples" => false,
            "properties" | "patternProperties" | "$defs" | "definitions" | "dependentSchemas" => {
                value.as_object().is_some_and(|schemas| {
                    schemas
                        .values()
                        .any(|schema| has_nested_base(schema, false))
                })
            }
            _ => has_nested_base(value, false),
        })
}

/// Whether an alternative's `type`, `const` or `enum` rejects the value's
/// JSON type, as a `null` alternative does for an object.
fn rejects_type(errors: &[jsonschema::ValidationError<'_>], path: &str, value: &Value) -> bool {
    use jsonschema::error::ValidationErrorKind::{AnyOf, Constant, Enum, OneOfNotValid, Type};
    let same = |other: &Value| std::mem::discriminant(other) == std::mem::discriminant(value);
    errors.iter().any(|error| {
        error.instance_path.as_str() == path
            && match &error.kind {
                Type { .. } => true,
                Constant { expected_value } => !same(expected_value),
                Enum { options } => options
                    .as_array()
                    .is_some_and(|options| !options.iter().any(same)),
                AnyOf { context } | OneOfNotValid { context } => {
                    !context.is_empty()
                        && context
                            .iter()
                            .all(|errors| rejects_type(errors, path, value))
                }
                _ => false,
            }
    })
}

fn quoted_list(keys: &[&str]) -> String {
    let quoted = keys
        .iter()
        .map(|key| format!("\"{key}\""))
        .collect::<Vec<_>>();
    match quoted.split_last() {
        Some((last, rest)) if !rest.is_empty() => format!("{} and {last}", rest.join(", ")),
        _ => quoted.concat(),
    }
}

fn required_keys(schema: &Value) -> impl Iterator<Item = &str> {
    schema
        .get("required")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
}

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

fn push_issue(
    issues: &mut Vec<ClientToolValidationIssue>,
    issue: ClientToolValidationIssue,
    limit: usize,
) {
    if issues.len() < limit && !issues.contains(&issue) {
        issues.push(issue);
    }
}

/// Gives each offered part tool its part policy, from the offered submission
/// that lists it. A part tool whose submission is not offered stays an
/// ordinary client tool.
pub fn link_part_tools(offered: &mut HashMap<String, OfferedClientTool>) -> Result<(), String> {
    let owners = offered
        .values()
        .filter(|tool| tool.submission.is_some())
        .filter_map(|tool| {
            let submission = tool.config.submission.as_ref()?;
            (!submission.part_tools.is_empty()).then(|| {
                (
                    tool.config.qualified_name(),
                    submission.part_tools.clone(),
                    submission.part_key.clone(),
                )
            })
        })
        .collect::<Vec<_>>();
    if owners.is_empty() {
        return Ok(());
    }
    for tool in offered.values_mut() {
        if tool.submission.is_some() {
            continue;
        }
        let qualified = tool.config.qualified_name();
        let Some((owner, _, key)) = owners
            .iter()
            .find(|(_, parts, _)| parts.contains(&qualified))
        else {
            continue;
        };
        let schema = serde_json::from_str::<Value>(&tool.config.parameters)
            .map_err(|error| format!("Invalid part tool schema for '{qualified}': {error}"))?;
        tool.part = Some(PartPolicy {
            arguments: ArgumentCheck::compile(&schema)?,
            submission: owner.clone(),
            key: key.clone(),
        });
    }
    Ok(())
}

impl ArgumentCheck {
    pub fn compile(schema: &Value) -> Result<Self, String> {
        Ok(Self {
            validator: Arc::new(erato_config::client_tool_schema::compile(schema)?),
            schema: Arc::new(schema.clone()),
            readable: !has_nested_base(schema, true),
        })
    }

    /// Decodes arrays and objects sent as JSON strings where the schema admits
    /// only those; returns the decoded JSON Pointers.
    pub fn decode_stringified(&self, input: &mut Value) -> Vec<String> {
        crate::services::stringified_arguments::decode(&self.schema, input)
    }

    /// A failed `anyOf` or `oneOf`, at any depth, is reported as the errors of
    /// the alternative the value aims at (see `choose`), not as one issue.
    pub fn validate(&self, input: &Value) -> Option<ClientToolOutcome> {
        let mut issues = Vec::new();
        for error in self.validator.iter_errors(input) {
            if issues.len() >= MAX_VALIDATION_ISSUES {
                break;
            }
            self.report(&error, &mut issues, MAX_VALIDATION_ISSUES);
        }
        (!issues.is_empty())
            .then(|| ClientToolOutcome::ValidationFailed(bound_issues(issues), None))
    }

    fn report(
        &self,
        error: &jsonschema::ValidationError<'_>,
        issues: &mut Vec<ClientToolValidationIssue>,
        limit: usize,
    ) {
        use jsonschema::error::ValidationErrorKind::{AnyOf, OneOfNotValid};
        if let AnyOf { context } | OneOfNotValid { context } = &error.kind {
            match self.choose(error, context) {
                Some(Choice::Alternative(index)) if !context[index].is_empty() => {
                    for nested in &context[index] {
                        self.report(nested, issues, limit);
                    }
                    return;
                }
                Some(Choice::Issues(chosen)) => {
                    for issue in chosen {
                        push_issue(issues, issue, limit);
                    }
                    return;
                }
                _ => {}
            }
        }
        push_issue(issues, schema_issue(error), limit);
    }

    fn issues_of(
        &self,
        errors: &[jsonschema::ValidationError<'_>],
        limit: usize,
    ) -> Vec<ClientToolValidationIssue> {
        let mut issues = Vec::new();
        for error in errors {
            self.report(error, &mut issues, limit);
        }
        issues
    }

    /// The alternative a value that fails every alternative aims at. One that
    /// rejects the value's JSON type comes last. Then: the one whose tag (see
    /// `tags`) accepts the value's, else the one whose own required key (one
    /// no other alternative names) is present; then the fewest missing
    /// required keys, the fewest errors, the first. A tag value no alternative
    /// accepts, a missing tag every alternative requires, or no own key
    /// present where every alternative has one is reported as such. Tags and
    /// own keys are used only if every alternative can be read.
    fn choose(
        &self,
        error: &jsonschema::ValidationError<'_>,
        context: &[Vec<jsonschema::ValidationError<'static>>],
    ) -> Option<Choice> {
        use jsonschema::error::ValidationErrorKind::{Constant, Enum, Required};
        if context.len() < 2 {
            return (!context.is_empty()).then_some(Choice::Alternative(0));
        }
        let path = error.instance_path.as_str();
        let alternatives = self
            .readable
            .then(|| schema_at(&self.schema, error.schema_path.as_str()))
            .flatten()
            .and_then(Value::as_array)
            .filter(|choices| choices.len() == context.len())
            .and_then(|choices| {
                choices
                    .iter()
                    .map(|choice| Alternative::read(&self.schema, choice))
                    .collect::<Option<Vec<_>>>()
            })
            .unwrap_or_default();
        let object = error.instance.as_object();
        let mut tagged: Option<Vec<bool>> = None;
        for (tag, values) in object.map_or_else(Vec::new, |_| tags(&alternatives)) {
            let allowed = Value::Array(values.into_iter().cloned().collect());
            if object.is_some_and(|object| !object.contains_key(tag)) {
                if alternatives
                    .iter()
                    .all(|alternative| alternative.required.contains(&tag))
                {
                    return Some(Choice::Issues(vec![ClientToolValidationIssue {
                        path: path.to_owned(),
                        code: "required".into(),
                        message: format!("\"{tag}\" is a required property (one of {allowed})"),
                    }]));
                }
                continue;
            }
            let at = format!("{path}/{}", pointer_token(tag));
            let accepted = context
                .iter()
                .map(|errors| {
                    !errors.iter().any(|error| {
                        error.instance_path.as_str() == at
                            && matches!(error.kind, Constant { .. } | Enum { .. })
                    })
                })
                .collect::<Vec<_>>();
            if !accepted.contains(&true) {
                return Some(Choice::Issues(vec![ClientToolValidationIssue {
                    path: at,
                    code: "enum".into(),
                    message: format!("value is not one of {allowed}"),
                }]));
            }
            tagged = Some(match tagged {
                Some(tagged) => tagged
                    .into_iter()
                    .zip(accepted)
                    .map(|(a, b)| a && b)
                    .collect(),
                None => accepted,
            });
        }
        let tagged = tagged.unwrap_or_else(|| vec![false; context.len()]);
        let own = alternatives
            .iter()
            .enumerate()
            .map(|(index, alternative)| {
                alternative
                    .required
                    .iter()
                    .copied()
                    .filter(|key| {
                        alternatives
                            .iter()
                            .enumerate()
                            .all(|(other, alternative)| other == index || !alternative.names(key))
                    })
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
        let aimed = (0..context.len())
            .map(|index| {
                own.get(index).is_some_and(|keys| {
                    keys.iter()
                        .any(|key| object.is_some_and(|object| object.contains_key(*key)))
                })
            })
            .collect::<Vec<_>>();
        if object.is_some()
            && !tagged.contains(&true)
            && !aimed.contains(&true)
            && !own.is_empty()
            && own.iter().all(|keys| !keys.is_empty())
        {
            return Some(Choice::Issues(
                self.no_alternative_aimed_at(path, &own, context),
            ));
        }
        let missing = |errors: &[jsonschema::ValidationError<'static>]| {
            errors
                .iter()
                .filter(|error| {
                    matches!(error.kind, Required { .. }) && error.instance_path.as_str() == path
                })
                .count()
        };
        (0..context.len())
            .min_by_key(|&index| {
                (
                    rejects_type(&context[index], path, &error.instance),
                    !tagged[index],
                    !aimed[index],
                    missing(&context[index]),
                    context[index].len(),
                )
            })
            .map(Choice::Alternative)
    }

    /// One issue naming each alternative's own keys, then the issues every
    /// alternative has, such as a key none of them knows.
    fn no_alternative_aimed_at(
        &self,
        path: &str,
        own: &[Vec<&str>],
        context: &[Vec<jsonschema::ValidationError<'static>>],
    ) -> Vec<ClientToolValidationIssue> {
        let choices = own.iter().map(|keys| quoted_list(keys)).collect::<Vec<_>>();
        let mut issues = vec![ClientToolValidationIssue {
            path: path.to_owned(),
            code: "required".into(),
            message: format!("one of these is required: {}", choices.join("; or ")),
        }];
        let each = context
            .iter()
            .map(|errors| self.issues_of(errors, MAX_COUNTED_ERRORS))
            .collect::<Vec<_>>();
        if let Some((first, rest)) = each.split_first() {
            issues.extend(
                first
                    .iter()
                    .filter(|issue| rest.iter().all(|other| other.contains(issue)))
                    .cloned(),
            );
        }
        issues
    }
}

impl SubmissionPolicy {
    pub fn decode_stringified(&self, input: &mut Value) -> Vec<String> {
        self.arguments.decode_stringified(input)
    }

    pub fn validate(&self, input: &Value) -> Option<ClientToolOutcome> {
        self.arguments.validate(input)
    }

    pub fn finish_after(&self, outcome: &ClientToolOutcome, attempt: u32) -> bool {
        matches!(
            outcome,
            ClientToolOutcome::Result(..) | ClientToolOutcome::Cancelled { .. }
        ) || matches!(outcome, ClientToolOutcome::ValidationFailed(_, Some(feedback)) if feedback.terminal)
            || attempt >= self.max_attempts
    }

    pub fn annotate(&self, output: &mut Value, outcome: &ClientToolOutcome, attempt: u32) {
        let finished = self.finish_after(outcome, attempt);
        output["submission"] = json!({
            "status": if matches!(outcome, ClientToolOutcome::Result(..)) { "accepted" }
                else if finished { "failed" } else { "retry" },
            "attempts_remaining": if finished { 0 } else { self.max_attempts.saturating_sub(attempt) },
        });
    }
}

/// Some models send a large array or object argument of a submission as a
/// JSON string. Decoding it once, in the model's captured response, means the
/// replayed call, the stored call and the client all see the same arguments.
pub fn decode_stringified_submission_arguments(
    content: &mut genai::chat::MessageContent,
    offered: &HashMap<String, OfferedClientTool>,
) {
    for part in content.iter_mut() {
        let genai::chat::ContentPart::ToolCall(call) = part else {
            continue;
        };
        let Some(arguments) = offered
            .get(&call.fn_name)
            .and_then(OfferedClientTool::argument_check)
        else {
            continue;
        };
        let decoded = arguments.decode_stringified(&mut call.fn_arguments);
        if !decoded.is_empty() {
            tracing::info!(
                tool = %call.fn_name,
                call_id = %call.call_id,
                paths = ?decoded,
                "Decoded submission arguments sent as JSON strings"
            );
        }
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

/// Bounded availability hints. Config and facet allowlists remain authoritative.
pub fn registered_client_tools(headers: &axum::http::HeaderMap) -> Vec<String> {
    client_tool_names(headers, "X-Erato-Client-Tools")
}

/// The registered tools whose handlers accept grant calls. Never part of the
/// executor binding, which an older backend would drop for an unknown field.
pub fn child_client_tools(headers: &axum::http::HeaderMap) -> Vec<String> {
    let registered = registered_client_tools(headers);
    let mut names = client_tool_names(headers, "X-Erato-Child-Client-Tools");
    names.retain(|name| registered.contains(name));
    names
}

/// The child tools whose handlers check a covered call's approval scope
/// before reading. Like the child tools, never part of the binding.
pub fn scoped_client_tools(headers: &axum::http::HeaderMap, child: &[String]) -> Vec<String> {
    let mut names = client_tool_names(headers, "X-Erato-Scoped-Client-Tools");
    names.retain(|name| child.contains(name));
    names
}

/// The client that holds a claim (`X-Erato-Executor-Claimant`): one browser
/// profile or Office pane. Windows of one Erato desktop app installation share
/// its binding, so the binding alone no longer names the holder.
pub fn executor_claimant(headers: &axum::http::HeaderMap) -> Option<String> {
    let value = headers
        .get("X-Erato-Executor-Claimant")?
        .to_str()
        .ok()?
        .trim();
    (!value.is_empty() && value.len() <= 256 && !value.chars().any(char::is_control))
        .then(|| value.to_owned())
}

fn client_tool_names(headers: &axum::http::HeaderMap, header: &str) -> Vec<String> {
    let Some(value) = headers.get(header).and_then(|v| v.to_str().ok()) else {
        return Vec::new();
    };
    if value.len() > 8319 {
        return Vec::new();
    }
    let mut names: Vec<String> = value
        .split(',')
        .map(str::trim)
        .filter(|name| {
            !name.is_empty()
                && name.len() <= 64
                && name
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        })
        .take(128)
        .map(str::to_owned)
        .collect();
    names.sort();
    names.dedup();
    names
}

pub fn client_tool_is_available(tool: &ClientToolConfig, registered: &[String]) -> bool {
    !tool.requires_client_registration || registered.contains(&tool.name)
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
        custom_format: None,
        cache_control: None,
        eager_input_streaming: None,
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
    /// JSON for the model plus separately authorized attachment IDs. Never
    /// infer attachments from arbitrary fields inside the tool's JSON result.
    Result(Value, Vec<sea_orm::prelude::Uuid>),
    Error(String),
    ValidationFailed(
        Vec<ClientToolValidationIssue>,
        Option<ClientToolSubmissionFeedback>,
    ),
    Cancelled {
        reason: String,
    },
}

impl ClientToolOutcome {
    /// Shared by direct delivery and the cross-instance command queue so both
    /// paths preserve diagnostics and error precedence, including explicit null.
    pub fn from_payload(payload: &Value) -> Self {
        let feedback = match payload
            .get("submission_feedback")
            .filter(|value| !value.is_null())
        {
            Some(value) => {
                match serde_json::from_value::<ClientToolSubmissionFeedback>(value.clone()) {
                    Ok(feedback)
                        if feedback.draft.as_ref().is_none_or(|draft| {
                            !draft.id.is_empty()
                                && draft.id.chars().count() <= 128
                                && draft.revision > 0
                        }) =>
                    {
                        Some(feedback)
                    }
                    _ => return Self::Error("Invalid client submission feedback".into()),
                }
            }
            None => None,
        };
        if let Some(issues) = payload.get("validation_errors") {
            match serde_json::from_value::<Vec<ClientToolValidationIssue>>(issues.clone()) {
                Ok(issues) if !issues.is_empty() => {
                    return Self::ValidationFailed(bound_issues(issues), feedback);
                }
                Ok(_) => {}
                Err(_) => return Self::Error("Invalid client validation diagnostics".into()),
            }
        }
        if feedback.is_some() {
            return Self::Error("Submission feedback requires validation diagnostics".into());
        }
        if let Some(error) = payload.get("error") {
            return Self::Error(error.as_str().unwrap_or("client tool failed").into());
        }
        match payload.get("result") {
            Some(result) => match payload.get("file_upload_ids") {
                Some(ids) => match serde_json::from_value(ids.clone()) {
                    Ok(ids) => Self::Result(result.clone(), ids),
                    Err(_) => Self::Error("Invalid client tool file references".into()),
                },
                None => Self::Result(result.clone(), Vec::new()),
            },
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
        let ClientToolOutcome::ValidationFailed(issues, _) = &failure else {
            panic!("validation failure")
        };
        assert_eq!(issues[0].path, "/title");
        assert_eq!(issues[0].code, "type");
        assert!(!issues[0].message.contains("large-artifact"));
        assert!(!policy.finish_after(&failure, 1));
        assert!(policy.finish_after(&failure, 3));
        assert!(policy.finish_after(&ClientToolOutcome::Result(Value::Null, vec![]), 1));
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

    /// The Word plan tool's shape: root alternatives told apart by their own
    /// required keys, entries by `kind` and patches by `op`.
    fn plan_policy() -> SubmissionPolicy {
        let read = json!({"snapshot":{"type":"string"},"readToken":{"type":"string"}});
        let alternative = |own: Value, required: &[&str]| {
            let mut properties = read.clone();
            properties
                .as_object_mut()
                .unwrap()
                .extend(own.as_object().unwrap().clone());
            let mut keys = vec!["snapshot", "readToken"];
            keys.extend(required);
            json!({"type":"object","properties":properties,"required":keys,"additionalProperties":false})
        };
        let schema = json!({"type":"object","anyOf":[
            alternative(json!({
                "version":{"type":"integer","const":1},
                "scope":{"type":"string","enum":["body","document"]},
                "entries":{"type":"array","items":{"$ref":"#/$defs/entry"}}
            }), &["version", "scope", "entries"]),
            alternative(json!({
                "draft_id":{"type":"string"},
                "revision":{"type":"integer"},
                "patches":{"type":"array","maxItems":32,"items":{"anyOf":[
                    {"type":"object","required":["op","path","value"],"additionalProperties":false,
                        "properties":{"op":{"type":"string","enum":["add","replace"]},
                            "path":{"type":"string"},"value":{}}},
                    {"type":"object","required":["op","path"],"additionalProperties":false,
                        "properties":{"op":{"type":"string","const":"remove"},"path":{"type":"string"}}}
                ]}}
            }), &["draft_id", "revision", "patches"]),
            alternative(json!({"table_cell":{"type":"object"}}), &["table_cell"]),
            alternative(json!({"scoped_edit":{"type":"object","minProperties":1,
                "additionalProperties":false,"properties":{"body":{"type":"array","maxItems":16,
                    "items":{"type":"object","required":["operation"],"additionalProperties":false,
                        "properties":{
                            "operation":{"type":"string","enum":["replace","delete","insert-after"]},
                            "source":{"type":"array","maxItems":16,"items":{"type":"string"}},
                            "blocks":{"type":"array","items":{"$ref":"#/$defs/block"}}
                        }}}}}}), &["scoped_edit"]),
        ],"$defs":{
            "entry":{"anyOf":[
                {"type":"object","required":["kind","source"],"additionalProperties":false,"properties":{
                    "kind":{"type":"string","const":"keep"},
                    "source":{"type":"array","items":{"type":"string"}}
                }},
                {"type":"object","required":["kind","source","blocks"],"additionalProperties":false,"properties":{
                    "kind":{"type":"string","const":"replace"},
                    "source":{"type":"array","items":{"type":"string"}},
                    "blocks":{"type":"array","items":{"$ref":"#/$defs/block"}}
                }},
                {"type":"object","required":["kind","blocks"],"additionalProperties":false,"properties":{
                    "kind":{"type":"string","const":"insert"},
                    "blocks":{"type":"array","items":{"$ref":"#/$defs/block"}}
                }}
            ]},
            "block":{"type":"object","required":["type"],"additionalProperties":false,"properties":{
                "type":{"type":"string","enum":["paragraph"]},"text":{"type":"string"},
                "edits":{"type":"array","items":{"type":"object","additionalProperties":false,
                    "properties":{"children":{"type":"array","items":{"$ref":"#/$defs/block"}}}}}
            }}
        }});
        let config = ClientToolConfig {
            name: "submit_document_plan".into(),
            parameters: schema.to_string(),
            submission: Some(Default::default()),
            ..Default::default()
        };
        OfferedClientTool::prepare(&config, &schema)
            .unwrap()
            .submission
            .unwrap()
    }

    fn offered_parts(with_submission: bool) -> HashMap<String, OfferedClientTool> {
        let submit = ClientToolConfig {
            name: "submit_draft".into(),
            submission: Some(crate::config::ClientToolSubmissionConfig {
                part_tools: vec!["client/write_part".into()],
                ..Default::default()
            }),
            ..Default::default()
        };
        let part_schema = json!({"type":"object","properties":{"row":{"type":"integer"},
            "lines":{"type":"array","items":{"type":"string"}}},"required":["row"]});
        let write = ClientToolConfig {
            name: "write_part".into(),
            parameters: part_schema.to_string(),
            ..Default::default()
        };
        let other = ClientToolConfig {
            name: "read_context".into(),
            ..Default::default()
        };
        let mut offered = HashMap::new();
        for (config, schema) in [(write, part_schema), (other, json!({"type":"object"}))]
            .into_iter()
            .chain(with_submission.then(|| (submit, json!({"type":"object"}))))
        {
            offered.insert(
                config.name.clone(),
                OfferedClientTool::prepare(&config, &schema).unwrap(),
            );
        }
        link_part_tools(&mut offered).unwrap();
        offered
    }

    #[test]
    fn a_part_tool_is_linked_only_while_its_submission_is_offered() {
        let offered = offered_parts(true);
        let part = offered["write_part"].part.as_ref().unwrap();
        assert_eq!(part.submission, "client/submit_draft");
        assert!(offered["read_context"].part.is_none());
        assert!(offered["submit_draft"].part.is_none());
        assert!(offered_parts(false)["write_part"].part.is_none());

        for row in [json!(2), json!(2.0), json!("2")] {
            assert_eq!(part.key_of(&json!({ "row": row })).as_deref(), Some("2"));
        }
        assert_eq!(part.key_of(&json!({"row":2.5})).as_deref(), Some("2.5"));
        assert_eq!(part.key_of(&json!({})), None);
        let mut input = json!({"row":2,"lines":"[\"a\",\"b\"]"});
        let check = offered["write_part"].argument_check().unwrap();
        assert_eq!(check.decode_stringified(&mut input), vec!["/lines"]);
        assert!(check.validate(&input).is_none());
        let Some(ClientToolOutcome::ValidationFailed(issues, None)) =
            check.validate(&json!({"row":"two"}))
        else {
            panic!("a schema failure");
        };
        assert_eq!(issues[0].path, "/row");
    }

    #[test]
    fn a_resumed_turn_keeps_the_narrower_part_budgets() {
        let part_budgets = |tools: &[&str], calls: u32, tries: u32, key: &str| ClientToolConfig {
            name: "submit_draft".into(),
            submission: Some(crate::config::ClientToolSubmissionConfig {
                part_tools: tools.iter().map(|tool| tool.to_string()).collect(),
                max_part_calls: calls,
                max_row_tries: tries,
                part_key: key.into(),
                ..Default::default()
            }),
            ..Default::default()
        };
        let saved = part_budgets(&["client/a", "client/b"], 20, 3, "/row");
        let current = part_budgets(&["client/b", "client/c"], 40, 2, "/part");
        let restored = OfferedClientTool::restore_config(&saved, &current)
            .submission
            .unwrap();
        assert_eq!(restored.part_tools, ["client/b"]);
        assert_eq!(restored.max_part_calls, 20);
        assert_eq!(restored.max_row_tries, 2);
        assert_eq!(restored.part_key, "/row");
    }

    #[test]
    fn a_submission_without_part_tools_stores_the_same_settings_as_before() {
        assert_eq!(
            serde_json::to_value(crate::config::ClientToolSubmissionConfig::default()).unwrap(),
            json!({"max_attempts":3,"recovery_read_tools":[],"max_recovery_reads":32,"native_schema":"auto"})
        );
        assert_eq!(
            serde_json::to_value(crate::services::client_operations::ToolCallCharge::default())
                .unwrap(),
            json!({"budget_refusal":null,"submission_attempt":null,"submission_mixed_batch":false,
                "recovery_read":false,"operation_identity":null})
        );
    }

    fn issues(policy: &SubmissionPolicy, input: Value) -> Vec<(String, String, String)> {
        check_issues(&policy.arguments, input)
    }

    fn check_issues(check: &ArgumentCheck, mut input: Value) -> Vec<(String, String, String)> {
        check.decode_stringified(&mut input);
        match check.validate(&input) {
            None => Vec::new(),
            Some(ClientToolOutcome::ValidationFailed(issues, None)) => issues
                .into_iter()
                .map(|issue| (issue.path, issue.code, issue.message))
                .collect(),
            Some(other) => panic!("unexpected outcome {other:?}"),
        }
    }

    fn issue(path: &str, code: &str, message: &str) -> (String, String, String) {
        (path.into(), code.into(), message.into())
    }

    #[test]
    fn a_failed_root_alternative_reports_the_errors_of_the_one_aimed_at() {
        let policy = plan_policy();
        let read = json!({"snapshot":"s1","readToken":"t1"});
        let with = |fields: Value| {
            let mut input = read.clone();
            input
                .as_object_mut()
                .unwrap()
                .extend(fields.as_object().unwrap().clone());
            input
        };
        let change = json!({"operation":"replace","source":["b1"],"blocks":[{"type":"paragraph","text":"secret draft"}]});
        assert_eq!(
            issues(
                &policy,
                with(json!({"scoped_edit":{"body":vec![change.clone(); 17]}}))
            ),
            vec![issue(
                "/scoped_edit/body",
                "maxItems",
                "value has more than 16 items"
            )]
        );
        assert!(
            issues(
                &policy,
                with(json!({"scoped_edit":{"body":vec![change; 16]}}))
            )
            .is_empty()
        );

        let entries = json!([{"kind":"keep","source":["b1"]},{"kind":"insert","blocks":[{"type":"paragraph","text":"[secret]"}]}]);
        let plan = |entries: Value| with(json!({"version":1,"scope":"body","entries":entries}));
        assert!(issues(&policy, plan(json!(format!("{entries}}}]")))).is_empty());
        assert_eq!(
            issues(&policy, plan(json!(format!("{entries}}}] secret")))),
            vec![issue("/entries", "type", r#"value is not of type "array""#)]
        );
        let mut unversioned = plan(entries);
        unversioned.as_object_mut().unwrap().remove("version");
        assert_eq!(
            issues(&policy, unversioned),
            vec![issue("", "required", r#""version" is a required property"#)]
        );

        let many = issues(&policy, plan(json!(vec![json!({"kind":"secret"}); 20])));
        assert_eq!(many.len(), 16);
        assert!(
            many.iter()
                .all(|(path, code, message)| path.starts_with("/entries/")
                    && code == "enum"
                    && !message.contains("secret"))
        );
    }

    #[test]
    fn several_aimed_alternatives_rank_by_missing_required_keys_first() {
        let policy = plan_policy();
        let wrong = json!({"op":"replace","source":["b1"]});
        for body in [
            vec![wrong.clone(), wrong],
            vec![json!({"kind":"replace","source":["b1"]})],
        ] {
            let input =
                json!({"snapshot":"s1","readToken":"t1","version":1,"scoped_edit":{"body":body}});
            let reported = issues(&policy, input);
            assert!(
                reported
                    .iter()
                    .any(|(path, code, _)| path == "/scoped_edit/body/0" && code == "required"),
                "{reported:?}"
            );
            assert!(
                reported.iter().all(|(path, code, message)| {
                    path.starts_with("/scoped_edit/body/")
                        || code == "additionalProperties" && message.contains("'version'")
                }),
                "{reported:?}"
            );
        }
        // The full plan misses `version` and `scope`. The table cell
        // alternative has as few errors as the scoped edit, but its key is absent.
        let both =
            json!({"snapshot":"s1","readToken":"t1","entries":"x","scoped_edit":{"body":"x"}});
        let mut reported = issues(&policy, both)
            .into_iter()
            .map(|(path, code, _)| (path, code))
            .collect::<Vec<_>>();
        reported.sort();
        assert_eq!(
            reported,
            [("", "additionalProperties"), ("/scoped_edit/body", "type")]
                .map(|(path, code)| (path.to_owned(), code.to_owned()))
        );
    }

    #[test]
    fn arguments_aimed_at_no_alternative_get_the_keys_that_tell_them_apart() {
        let policy = plan_policy();
        let keys = issue(
            "",
            "required",
            r#"one of these is required: "version", "scope" and "entries"; or "draft_id", "revision" and "patches"; or "table_cell"; or "scoped_edit""#,
        );
        assert_eq!(
            issues(&policy, json!({"snapshot":"s1","readToken":"t1"})),
            vec![keys.clone()]
        );
        for (key, value) in [
            (
                "scopedEdit",
                json!({"body":[{"operation":"delete","source":["b1"]}]}),
            ),
            ("body", json!([{"operation":"delete","source":["b1"]}])),
        ] {
            let mut input = json!({"snapshot":"s1","readToken":"t1"});
            input[key] = value;
            assert_eq!(
                issues(&policy, input),
                vec![
                    keys.clone(),
                    issue(
                        "",
                        "additionalProperties",
                        &format!("Additional properties are not allowed ('{key}' was unexpected)")
                    )
                ]
            );
        }
        assert_eq!(
            issues(&policy, json!({"readToken":"t1"})),
            vec![
                keys,
                issue("", "required", r#""snapshot" is a required property"#)
            ]
        );
    }

    fn policy_for(schema: Value) -> SubmissionPolicy {
        let config = ClientToolConfig {
            parameters: schema.to_string(),
            submission: Some(Default::default()),
            ..Default::default()
        };
        OfferedClientTool::prepare(&config, &schema)
            .unwrap()
            .submission
            .unwrap()
    }

    #[test]
    fn a_mistake_inside_an_entry_names_the_field_of_its_kind() {
        let policy = plan_policy();
        let plan = |entry: Value| {
            json!({"snapshot":"s1","readToken":"t1","version":1,"scope":"body",
                "entries":[{"kind":"keep","source":["b1"]}, entry]})
        };
        let block = json!({"type":"paragraph","text":"secret draft"});
        assert_eq!(
            issues(&policy, plan(json!({"kind":"replace","source":["b2"]}))),
            vec![issue(
                "/entries/1",
                "required",
                r#""blocks" is a required property"#
            )]
        );
        assert_eq!(
            issues(
                &policy,
                plan(json!({"kind":"rewrite","source":["b2"],"blocks":[block.clone()]}))
            ),
            vec![issue(
                "/entries/1/kind",
                "enum",
                r#"value is not one of ["keep","replace","insert"]"#
            )]
        );
        assert_eq!(
            issues(&policy, plan(json!({"source":["b2"],"blocks":[block]}))),
            vec![issue(
                "/entries/1",
                "required",
                r#""kind" is a required property (one of ["keep","replace","insert"])"#
            )]
        );
        assert_eq!(
            issues(
                &policy,
                plan(json!({"kind":"insert","blocks":[{"type":"secret","text":"secret"}]}))
            ),
            vec![issue(
                "/entries/1/blocks/0/type",
                "enum",
                r#"value is not one of ["paragraph"]"#
            )]
        );
    }

    #[test]
    fn a_mistake_inside_a_patch_names_the_field_of_its_op() {
        let policy = plan_policy();
        let repair = |patch: Value| json!({"snapshot":"s1","readToken":"t1","draft_id":"d1","revision":1,"patches":[patch]});
        assert_eq!(
            issues(
                &policy,
                repair(json!({"op":"remove","path":"/entries/0","value":"secret"}))
            ),
            vec![issue(
                "/patches/0",
                "additionalProperties",
                "Additional properties are not allowed ('value' was unexpected)"
            )]
        );
        assert_eq!(
            issues(&policy, repair(json!({"op":"add","path":"/entries/0"}))),
            vec![issue(
                "/patches/0",
                "required",
                r#""value" is a required property"#
            )]
        );
        assert_eq!(
            issues(&policy, repair(json!({"op":"delete","path":"/entries/0"}))),
            vec![issue(
                "/patches/0/op",
                "enum",
                r#"value is not one of ["add","replace","remove"]"#
            )]
        );
    }

    /// The Word section writer's `ops`: forms told apart only by their own
    /// keys, checked as a part call.
    #[test]
    fn a_mistake_inside_a_part_op_names_the_field_of_its_form() {
        let text = json!({"type":"string","minLength":1});
        let op = |properties: Value, required: &[&str]| {
            json!({"type":"object","properties":properties,"required":required,
                "additionalProperties":false})
        };
        let check = ArgumentCheck::compile(&json!({"type":"object","required":["row","ops"],
        "additionalProperties":false,"properties":{
            "row":{"type":"integer"},
            "ops":{"type":"array","minItems":1,"items":{"anyOf":[
                op(json!({"keep":text}), &["keep"]),
                op(json!({"replace":text,"text":text}), &["replace", "text"]),
                op(json!({"insert":text}), &["insert"]),
                op(json!({"delete":text,"reason":text}), &["delete", "reason"])
            ]}}
        }}))
        .unwrap();
        assert!(erato_config::client_tool_schema::fanned_choices(&check.schema).is_empty());
        let write = |op: Value| json!({"row":2,"ops":[{"keep":"b1"}, op]});
        let missing_text = issue("/ops/1", "required", r#""text" is a required property"#);
        assert_eq!(
            check_issues(&check, write(json!({"replace":"b2"}))),
            vec![missing_text.clone()]
        );
        assert_eq!(
            check_issues(&check, write(json!({"replace":["b2","b3"]}))),
            vec![
                missing_text,
                issue("/ops/1/replace", "type", r#"value is not of type "string""#)
            ]
        );
        assert_eq!(
            check_issues(&check, write(json!({"delete":"b3"}))),
            vec![issue(
                "/ops/1",
                "required",
                r#""reason" is a required property"#
            )]
        );
        assert_eq!(
            check_issues(&check, write(json!({"modify":"b2"}))),
            vec![
                issue(
                    "/ops/1",
                    "required",
                    r#"one of these is required: "keep"; or "replace" and "text"; or "insert"; or "delete" and "reason""#
                ),
                issue(
                    "/ops/1",
                    "additionalProperties",
                    "Additional properties are not allowed ('modify' was unexpected)"
                )
            ]
        );
    }

    #[test]
    fn alternatives_are_read_through_references() {
        let policy = policy_for(json!({"type":"object","anyOf":[
            {"$ref":"#/$defs/a"},
            {"type":"object","required":["b"]}
        ],"$defs":{"a":{"type":"object","required":["a"],"properties":{"a":{"type":"string"}}}}}));
        assert_eq!(
            issues(&policy, json!({})),
            vec![issue(
                "",
                "required",
                r#"one of these is required: "a"; or "b""#
            )]
        );
        assert_eq!(
            issues(&policy, json!({"a":1})),
            vec![issue("/a", "type", r#"value is not of type "string""#)]
        );

        let policy = policy_for(json!({"type":"object","oneOf":[
            {"type":"object","required":["a"],"properties":{"a":{"properties":{"child":{"$ref":"#"}}}}},
            {"type":"object","required":["b"]}
        ]}));
        assert_eq!(
            issues(&policy, json!({"a":{"child":1}})),
            vec![issue(
                "/a/child",
                "type",
                r#"value is not of type "object""#
            )]
        );
    }

    #[test]
    fn an_alternative_that_rejects_the_value_type_comes_last() {
        let pair = json!({"type":"object","additionalProperties":false,
            "properties":{"a":{"type":"string"},"b":{"type":"string"}}});
        let policy = policy_for(json!({"type":"object","properties":{
            "note":{"anyOf":[pair.clone(), {"type":"null"}]},
            "tags":{"anyOf":[{"type":"array","items":{"type":"string"}}, {"type":"string"}]},
            "mode":{"anyOf":[{"const":"auto"}, pair]},
            "v":{"anyOf":[{"type":"integer"}, {"type":"string","maxLength":2}]}
        }}));
        let string = r#"value is not of type "string""#;
        for field in ["note", "mode"] {
            let mut input = json!({});
            input[field] = json!({"a":1,"b":2});
            assert_eq!(
                issues(&policy, input),
                vec![
                    issue(&format!("/{field}/a"), "type", string),
                    issue(&format!("/{field}/b"), "type", string)
                ]
            );
        }
        assert_eq!(
            issues(&policy, json!({"tags":[1,2]})),
            vec![
                issue("/tags/0", "type", string),
                issue("/tags/1", "type", string)
            ]
        );
        assert_eq!(
            issues(&policy, json!({"v":"abc"})),
            vec![issue(
                "/v",
                "maxLength",
                "value is longer than 2 characters"
            )]
        );
        assert!(issues(&policy, json!({"note":null})).is_empty());
        assert_eq!(
            issues(&policy, json!({"note":5})),
            vec![issue("/note", "type", r#"value is not of type "object""#)]
        );
    }

    #[test]
    fn a_property_every_alternative_pins_to_the_same_values_is_not_a_tag() {
        let alternative = |own: &str, schema: Value, version: Value| {
            json!({"type":"object","required":["version", own],"additionalProperties":false,
                "properties":{"version":version, own: schema}})
        };
        let root = |first: Value, second: Value| {
            policy_for(json!({"type":"object","anyOf":[
                alternative("a", json!({"type":"string"}), first),
                alternative("b", json!({"type":"array","maxItems":2}), second)
            ]}))
        };
        let missing = issue("", "required", r#""version" is a required property"#);
        let too_many = issue("/b", "maxItems", "value has more than 2 items");
        let policy = root(json!({"const":1}), json!({"const":1}));
        assert_eq!(
            issues(&policy, json!({"b":[1,2,3],"secretKey":1})),
            vec![
                missing.clone(),
                too_many.clone(),
                issue(
                    "",
                    "additionalProperties",
                    "Additional properties are not allowed ('secretKey' was unexpected)"
                )
            ]
        );
        assert_eq!(
            issues(&policy, json!({"version":2,"b":[1,2,3]})),
            vec![
                issue("/version", "const", "1 was expected"),
                too_many.clone()
            ]
        );
        for (first, second) in [
            (json!({"enum":[1,2]}), json!({"enum":[2,1]})),
            (json!({"const":1}), json!({"enum":[1]})),
        ] {
            assert_eq!(
                issues(&root(first, second), json!({"b":[1,2,3]})),
                vec![missing.clone(), too_many.clone()]
            );
        }

        let item = |kind: &str, schema: Value| {
            json!({"type":"object","required":["version","kind", kind],"additionalProperties":false,
                "properties":{"version":{"const":1},"kind":{"const":kind}, kind: schema}})
        };
        let policy = policy_for(
            json!({"type":"object","properties":{"items":{"type":"array",
            "items":{"anyOf":[
                item("a", json!({"type":"string"})),
                item("b", json!({"type":"array","maxItems":2}))
            ]}}}}),
        );
        assert_eq!(
            issues(&policy, json!({"items":[{"kind":"b","b":[1,2,3]}]})),
            vec![
                issue(
                    "/items/0",
                    "required",
                    r#""version" is a required property"#
                ),
                issue("/items/0/b", "maxItems", "value has more than 2 items")
            ]
        );
    }

    #[test]
    fn alternatives_that_cannot_all_be_read_are_ranked_by_their_errors() {
        let note = json!({"type":"object","required":["kind","text"],"additionalProperties":false,
            "properties":{"kind":{"const":"note"},"text":{"type":"string"}}});
        let list = json!({"type":"object","required":["kind","items"],"additionalProperties":false,
            "properties":{"kind":{"const":"list"},"items":{"type":"array"}}});
        let mut anchored = note.clone();
        anchored["$anchor"] = json!("note");
        for (first, defined) in [
            (json!({"$ref":"#/$defs/note"}), note.clone()),
            (json!({"$ref":"#note"}), anchored),
            (json!({"allOf":[{"$ref":"#/$defs/note"}]}), note.clone()),
        ] {
            let policy = policy_for(json!({"type":"object","anyOf":[first, list.clone()],
                "$defs":{"note":defined}}));
            assert_eq!(
                issues(&policy, json!({"kind":"note","text":5})),
                vec![issue("/text", "type", r#"value is not of type "string""#)]
            );
        }

        let pair = json!({"type":"object","required":["a","b"],"additionalProperties":false,
            "properties":{"a":{"type":"string"},"b":{"type":"string"}}});
        let policy = policy_for(json!({"type":"object","anyOf":[{"$ref":"#a"}, pair],
            "$defs":{"x":{"$anchor":"a","type":"object","required":["a"],"additionalProperties":false,
                "properties":{"a":{"type":"integer"}}}}}));
        assert_eq!(
            issues(&policy, json!({"a":"text"})),
            vec![issue("/a", "type", r#"value is not of type "integer""#)]
        );

        // A `$id` below the root makes `#/…` ambiguous: no tag is read.
        let schema = |other: Value| json!({"type":"object","anyOf":[note.clone(), list.clone()],"$defs":{"other":other}});
        let input = json!({"kind":"memo","text":"t"});
        assert_eq!(
            issues(&policy_for(schema(json!({"type":"string"}))), input.clone()),
            vec![issue(
                "/kind",
                "enum",
                r#"value is not one of ["note","list"]"#
            )]
        );
        assert_eq!(
            issues(
                &policy_for(schema(json!({"$id":"urn:example:other","type":"string"}))),
                input
            ),
            vec![issue("/kind", "const", r#""note" was expected"#)]
        );
    }

    fn error_count(errors: &[jsonschema::ValidationError<'_>]) -> usize {
        use jsonschema::error::ValidationErrorKind::{AnyOf, OneOfNotValid};
        errors
            .iter()
            .map(|error| match &error.kind {
                AnyOf { context } | OneOfNotValid { context } => {
                    1 + context
                        .iter()
                        .map(|errors| error_count(errors))
                        .sum::<usize>()
                }
                _ => 1,
            })
            .sum()
    }

    #[test]
    fn the_plan_shape_costs_the_same_at_any_nesting_depth() {
        let policy = plan_policy();
        assert!(
            erato_config::client_tool_schema::fanned_choices(&policy.arguments.schema).is_empty()
        );
        let nested = |depth: usize| {
            let mut block = json!({"type":"paragraph","text":5});
            for _ in 0..depth {
                block = json!({"type":"paragraph","edits":[{"children":[block]}]});
            }
            json!({"snapshot":"s1","readToken":"t1","version":1,"scope":"body",
                "entries":[{"kind":"replace","source":["b1"],"blocks":[block]}]})
        };
        let count = |depth: usize| {
            let input = nested(depth);
            error_count(
                &policy
                    .arguments
                    .validator
                    .iter_errors(&input)
                    .collect::<Vec<_>>(),
            )
        };
        assert_eq!(count(10), count(28));
        let reported = issues(&policy, nested(3));
        assert_eq!(reported.len(), 1);
        assert!(
            reported[0].0.ends_with("/edits/0/children/0/text"),
            "{reported:?}"
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
        let ClientToolOutcome::ValidationFailed(issues, _) =
            ClientToolOutcome::from_payload(&payload)
        else {
            panic!("errors take precedence")
        };
        assert_eq!(issues[0].code, "unknown_reference");
        assert!(matches!(
            ClientToolOutcome::from_payload(&json!({"result":null})),
            ClientToolOutcome::Result(Value::Null, _)
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
    fn correction_metadata_survives_transport_and_terminal_failure_is_not_acceptance() {
        let (config, schema) = submission();
        let policy = OfferedClientTool::prepare(&config, &schema)
            .unwrap()
            .submission
            .unwrap();
        let mut payload = json!({
            "validation_errors":[{"path":"/items","code":"coverage","message":"Missing source r3"}],
            "submission_feedback":{"draft":{"id":"draft-1","revision":2},"terminal":false},
            "result":{"must_not_be_accepted":true}
        });
        let outcome = ClientToolOutcome::from_payload(&payload);
        let ClientToolOutcome::ValidationFailed(_, Some(feedback)) = &outcome else {
            panic!("expected rejection with a correction handle");
        };
        assert_eq!(feedback.draft.as_ref().unwrap().revision, 2);
        assert!(!policy.finish_after(&outcome, 1));
        payload["submission_feedback"]["terminal"] = json!(true);
        let outcome = ClientToolOutcome::from_payload(&payload);
        assert!(policy.finish_after(&outcome, 1));
        let mut output = json!({});
        policy.annotate(&mut output, &outcome, 1);
        assert_eq!(
            output["submission"],
            json!({"status":"failed","attempts_remaining":0})
        );
        for bad in [
            json!({"draft":{"id":"x".repeat(129),"revision":1}}),
            json!({"draft":{"id":"draft","revision":0}}),
            json!({"terminal":"yes"}),
        ] {
            payload["submission_feedback"] = bad;
            assert!(matches!(
                ClientToolOutcome::from_payload(&payload),
                ClientToolOutcome::Error(_)
            ));
        }
        assert!(matches!(
            ClientToolOutcome::from_payload(&json!({
                "result":true,"submission_feedback":{"terminal":true}
            })),
            ClientToolOutcome::Error(_)
        ));
    }

    #[test]
    fn attachment_transport_preserves_ids_and_error_precedence() {
        let id = sea_orm::prelude::Uuid::new_v4();
        let mut payload = json!({"result": null, "file_upload_ids": [id]});
        let ClientToolOutcome::Result(Value::Null, ids) = ClientToolOutcome::from_payload(&payload)
        else {
            panic!("explicit null can carry attachments")
        };
        assert_eq!(ids, vec![id]);
        payload["error"] = json!("failed");
        assert!(matches!(
            ClientToolOutcome::from_payload(&payload),
            ClientToolOutcome::Error(_)
        ));
        let ClientToolOutcome::Result(_, ids) =
            ClientToolOutcome::from_payload(&json!({"result": {"file_upload_ids": [id]}}))
        else {
            panic!("JSON result")
        };
        assert!(ids.is_empty(), "nested JSON must not create attachments");
        assert!(matches!(
            ClientToolOutcome::from_payload(
                &json!({"result": null, "file_upload_ids": ["invalid"]})
            ),
            ClientToolOutcome::Error(_)
        ));
    }

    #[test]
    fn optional_tools_need_registration_but_legacy_tools_do_not() {
        let mut optional = tool("desktop", "search_sidecar_index");
        optional.requires_client_registration = true;
        let legacy = tool("outlook", "fetch_availability");
        assert!(!client_tool_is_available(&optional, &[]));
        assert!(client_tool_is_available(&legacy, &[]));
        assert!(client_tool_is_available(
            &optional,
            &["search_sidecar_index".into()]
        ));
        assert!(!client_tool_is_available(
            &optional,
            &["different_tool".into()]
        ));
    }

    #[test]
    fn registration_headers_are_bounded_and_do_not_parse_arbitrary_names() {
        use axum::http::{HeaderMap, HeaderValue};
        let mut headers = HeaderMap::new();
        assert!(registered_client_tools(&headers).is_empty());
        headers.insert(
            "X-Erato-Client-Tools",
            HeaderValue::from_static(
                "search_sidecar_index, search_sidecar_index, bad/name, read_sidecar_conversation",
            ),
        );
        assert_eq!(
            registered_client_tools(&headers),
            vec!["read_sidecar_conversation", "search_sidecar_index"]
        );
        headers.insert(
            "X-Erato-Client-Tools",
            HeaderValue::from_str(&"x".repeat(8320)).unwrap(),
        );
        assert!(registered_client_tools(&headers).is_empty());
    }

    #[test]
    fn child_client_tools_are_a_subset_of_the_registered_tools() {
        use axum::http::{HeaderMap, HeaderValue};
        let mut headers = HeaderMap::new();
        headers.insert(
            "X-Erato-Child-Client-Tools",
            HeaderValue::from_static("read_document_blocks"),
        );
        assert!(child_client_tools(&headers).is_empty());
        headers.insert(
            "X-Erato-Client-Tools",
            HeaderValue::from_static("read_document_blocks,submit_plan"),
        );
        headers.insert(
            "X-Erato-Child-Client-Tools",
            HeaderValue::from_static("read_document_blocks, unregistered, bad/name"),
        );
        assert_eq!(child_client_tools(&headers), vec!["read_document_blocks"]);
    }

    #[test]
    fn scoped_client_tools_are_a_subset_of_the_child_tools() {
        use axum::http::{HeaderMap, HeaderValue};
        let mut headers = HeaderMap::new();
        headers.insert(
            "X-Erato-Client-Tools",
            HeaderValue::from_static("read_document_blocks,submit_plan"),
        );
        headers.insert(
            "X-Erato-Scoped-Client-Tools",
            HeaderValue::from_static("read_document_blocks"),
        );
        assert!(scoped_client_tools(&headers, &child_client_tools(&headers)).is_empty());
        headers.insert(
            "X-Erato-Child-Client-Tools",
            HeaderValue::from_static("read_document_blocks"),
        );
        headers.insert(
            "X-Erato-Scoped-Client-Tools",
            HeaderValue::from_static("read_document_blocks, submit_plan, bad/name"),
        );
        assert_eq!(
            scoped_client_tools(&headers, &child_client_tools(&headers)),
            vec!["read_document_blocks"]
        );
        headers.remove("X-Erato-Scoped-Client-Tools");
        assert!(scoped_client_tools(&headers, &child_client_tools(&headers)).is_empty());
    }

    #[test]
    fn older_generation_contexts_have_no_optional_tools() {
        let context: crate::models::message::GenerationRequestContext =
            serde_json::from_str(r#"{"platform":"outlook"}"#).unwrap();
        assert!(context.registered_client_tools.is_empty());
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
            requires_client_registration: false,
            timeout_ms: None,
            submission: None,
            replay: Default::default(),
            label: None,
            durable: None,
            child_access: Default::default(),
            host_context: None,
            child_context_arg: None,
            child_context_input: None,
            child_host_inputs: Vec::new(),
            child_dispatch: None,
            approval_scope: Default::default(),
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

    /// The reviewed tools are exactly those the protocol's provider table
    /// gives a `selection`.
    #[test]
    fn the_reviewed_sidecar_tools_are_those_the_provider_table_selects_items_of() {
        let table: Value = serde_json::from_str(include_str!(
            "../../../../desktop-sidecar-protocol/providers/sidecar.json"
        ))
        .unwrap();
        let mut selecting: Vec<&str> = table["tools"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|tool| !tool["selection"].is_null())
            .map(|tool| tool["name"].as_str().unwrap())
            .collect();
        selecting.sort_unstable();
        let mut reviewed = STRICT_REVIEWED_SIDECAR_TOOLS.to_vec();
        reviewed.sort_unstable();
        assert_eq!(selecting, reviewed);
    }

    #[test]
    fn only_a_reviewed_tool_on_a_strict_sidecar_binding_is_reviewed_on_the_device() {
        use crate::config::ClientToolHostContext;
        use crate::services::client_operations::{ExecutionRealm, ExecutorBinding, HostContext};
        let sidecar = ExecutorBinding {
            device_id: "installation".into(),
            realm: ExecutionRealm::DesktopSidecar,
            host_context: Some(HostContext {
                kind: "desktop_sidecar".into(),
                identity: "local".into(),
            }),
        };
        let offered = |name: &str, binding: &ExecutorBinding, strict: bool| {
            let config = ClientToolConfig {
                host_context: Some(ClientToolHostContext::DesktopSidecar),
                ..tool("desktop", name)
            };
            OfferedClientTool {
                executor: Some(binding.clone()),
                executor_strict_mode: strict,
                ..OfferedClientTool::prepare(&config, &json!({ "type": "object" })).unwrap()
            }
        };
        for name in STRICT_REVIEWED_SIDECAR_TOOLS {
            assert!(offered(name, &sidecar, true).reviewed_on_device(), "{name}");
            assert!(
                !offered(name, &sidecar, false).reviewed_on_device(),
                "{name}"
            );
        }
        for name in ["list_sidecar_mailboxes", "get_sidecar_search_fields"] {
            assert!(
                !offered(name, &sidecar, true).reviewed_on_device(),
                "{name}"
            );
        }
        let office = ExecutorBinding {
            realm: ExecutionRealm::OfficeAddin,
            host_context: Some(HostContext {
                kind: "outlook_mailbox".into(),
                identity: "mailbox".into(),
            }),
            ..sidecar.clone()
        };
        assert!(
            !offered("search_sidecar_index", &office, true).reviewed_on_device(),
            "a call routed to another host's binding"
        );
        let mut elsewhere = offered("search_sidecar_index", &sidecar, true);
        elsewhere.config.host_context = Some(ClientToolHostContext::OutlookMailbox);
        assert!(!elsewhere.reviewed_on_device(), "a tool of another host");
        let mut unbound = offered("search_sidecar_index", &sidecar, true);
        unbound.executor = None;
        assert!(!unbound.reviewed_on_device());
    }
}
