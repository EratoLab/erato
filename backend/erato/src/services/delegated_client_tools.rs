//! Client tools in delegated tasks (ERMAIN-1001). A task that names a child
//! facet is a client task for that facet's host. At launch it gets a grant for
//! the read tools its parent turn was offered for that host; every later turn
//! of the task is offered, and dispatches, exactly those tools while the grant
//! holds, live over the executor stream of the grant's binding.

use crate::config::{ClientToolChildAccess, ClientToolConfig, ClientToolHostContext, FacetsConfig};
use crate::db::entity_ext::chats;
use crate::models::chat::{ChatProvenance, ClientToolGrant};
use crate::models::user_preference::ClientToolDecision;
use crate::server::api::v1beta::message_streaming::DelegationDispatchContext;
use crate::services::client_operations::{ExecutorBinding, executor_stream};
use crate::services::client_tools::{GrantedCall, OfferedClientTool};
use crate::state::AppState;
use sea_orm::prelude::Uuid;
use serde_json::Value;

/// The host a task is a client task for: that of the first facet it names
/// with a `child_host_context`.
pub fn client_task_host(
    facets: &FacetsConfig,
    facet_ids: &[String],
) -> Option<ClientToolHostContext> {
    facet_ids
        .iter()
        .find_map(|id| facets.facets.get(id)?.child_host_context)
}

/// Whether a `delegate_task` call names a child facet, read from its raw
/// arguments. The dispatch-approval gate runs before validation and must see
/// the run mode a client task will get, not the one it asked for.
pub fn names_child_facet(facets: &FacetsConfig, call: &genai::chat::ToolCall) -> bool {
    call.fn_arguments
        .get("facet_ids")
        .and_then(Value::as_array)
        .is_some_and(|ids| {
            ids.iter().filter_map(Value::as_str).any(|id| {
                facets
                    .facets
                    .get(id)
                    .is_some_and(|facet| facet.child_host_context.is_some())
            })
        })
}

/// The task result's note for a client task that asked for `async`.
pub fn wait_note(host: ClientToolHostContext) -> String {
    match host {
        ClientToolHostContext::WordDocument => "wait (uses the open document)",
        ClientToolHostContext::OutlookMailbox => "wait (uses the open mailbox)",
    }
    .to_string()
}

pub(crate) const NOT_ENABLED: &str = "client tools are not enabled for tasks";
pub(crate) const NOT_FROM_HOST: &str = "the turn was not sent from the pane this task needs";
pub(crate) const NONE_OFFERED: &str = "the turn offered no client tools that tasks may use";
pub(crate) const ALL_NEVER: &str = "the user does not allow these client tools";
pub(crate) const PANE_NOT_CONNECTED: &str = "the pane is not connected";
pub(crate) const PANE_REFUSES_TASKS: &str = "the pane does not take calls from tasks";

/// Whether a tool may be granted for `host`, by its current configuration.
fn grantable(config: &ClientToolConfig, host: &str) -> bool {
    config.child_access == ClientToolChildAccess::Read
        && config.submission.is_none()
        && config
            .host_context
            .is_some_and(|context| context.as_str() == host)
}

fn binding_host(binding: &ExecutorBinding) -> Option<&str> {
    binding
        .host_context
        .as_ref()
        .map(|context| context.kind.as_str())
}

/// The parent turn's offered tools a task could be granted.
pub(crate) fn grant_candidates<'a>(
    offered: impl IntoIterator<Item = &'a OfferedClientTool>,
) -> Vec<OfferedClientTool> {
    offered
        .into_iter()
        .filter(|tool| {
            tool.config.child_access == ClientToolChildAccess::Read
                && !tool.inbox_only
                && tool.grant.is_none()
        })
        .cloned()
        .collect()
}

/// Writes the grant a client task launches with, or says why it gets none.
pub(crate) async fn resolve_grant(
    app_state: &AppState,
    context: &DelegationDispatchContext<'_>,
    host: ClientToolHostContext,
    owner_message_id: Uuid,
) -> Result<ClientToolGrant, &'static str> {
    if !app_state.config.client_tools.executor_stream_enabled {
        return Err(NOT_ENABLED);
    }
    let binding = context
        .request_context
        .executor
        .as_ref()
        .filter(|binding| binding_host(binding) == Some(host.as_str()))
        .ok_or(NOT_FROM_HOST)?;
    let candidates: Vec<&OfferedClientTool> = context
        .parent_client_tools
        .iter()
        .filter(|tool| {
            grantable(&tool.config, host.as_str()) && tool.executor.as_ref() == Some(binding)
        })
        .collect();
    if candidates.is_empty() {
        return Err(NONE_OFFERED);
    }
    let account_id = Uuid::parse_str(&context.me_user.id).map_err(|_| NONE_OFFERED)?;
    let mut allowed = Vec::new();
    for tool in candidates {
        let decision = crate::models::user_preference::find_client_tool_decision(
            &app_state.db,
            &account_id,
            &tool.config.qualified_name(),
        )
        .await
        .unwrap_or_else(|error| {
            tracing::warn!(%error, "Cannot read a client tool decision for a task grant");
            Some(ClientToolDecision::NeverAllow)
        });
        if decision != Some(ClientToolDecision::NeverAllow) {
            allowed.push(tool);
        }
    }
    if allowed.is_empty() {
        return Err(ALL_NEVER);
    }
    let presence = executor_stream::present(&app_state.db, account_id, binding)
        .await
        .unwrap_or_else(|error| {
            tracing::warn!(%error, "Cannot look up the executor stream for a task grant");
            None
        })
        .ok_or(PANE_NOT_CONNECTED)?;
    let granted: Vec<&OfferedClientTool> = allowed
        .into_iter()
        .filter(|tool| presence.serves_grant_call(&tool.config.name))
        .collect();
    if granted.is_empty() {
        return Err(PANE_REFUSES_TASKS);
    }
    let context_ref = granted
        .iter()
        .find_map(|tool| tool.config.child_context_arg.as_ref())
        .and_then(|arg| context.action_facet_args.as_ref()?.get(arg).cloned());
    let mut tools: Vec<String> = granted
        .iter()
        .map(|tool| tool.config.qualified_name())
        .collect();
    tools.sort();
    Ok(ClientToolGrant {
        tools,
        binding: binding.clone(),
        owner_chat_id: context.origin_chat.id,
        owner_message_id,
        context_ref,
    })
}

/// The grant-level half of the offer predicate (contract §4): the run is on
/// the grant's binding, nobody took it over, and the turn that owns the client
/// context is still the one running in the parent chat.
pub fn grant_offer_allowed(
    grant: &ClientToolGrant,
    provenance: &ChatProvenance,
    executor: Option<&ExecutorBinding>,
    owner_running: bool,
) -> bool {
    executor == Some(&grant.binding) && provenance.adopted_at.is_none() && owner_running
}

/// The tool-level half: listed in the grant, still `read` for the grant's
/// host by the current configuration, and not set to Never.
pub fn granted_tool_allowed(
    grant: &ClientToolGrant,
    config: &ClientToolConfig,
    decision: Option<ClientToolDecision>,
) -> bool {
    grant.tools.contains(&config.qualified_name())
        && binding_host(&grant.binding).is_some_and(|host| grantable(config, host))
        && decision != Some(ClientToolDecision::NeverAllow)
}

/// A delegated run's granted tools as they may be offered now, with the
/// grant's binding. `None` for a run without a grant or whose grant no longer
/// holds; the same answer on a fresh turn and on a continuation.
pub(crate) async fn granted_tools(
    app_state: &AppState,
    chat: &chats::Model,
    executor: Option<&ExecutorBinding>,
    account_id: Option<Uuid>,
) -> Option<(ExecutorBinding, Vec<(ClientToolConfig, GrantedCall)>)> {
    let configuration = crate::models::chat::parse_chat_configuration(chat)
        .ok()
        .flatten()?;
    let provenance = configuration.provenance?;
    let grant = configuration.task?.client_grant?;
    let owner_running = app_state
        .background_tasks
        .active_generation(&grant.owner_chat_id)
        .await
        .and_then(|generation| generation.message_id())
        == Some(grant.owner_message_id);
    if !grant_offer_allowed(&grant, &provenance, executor, owner_running) {
        return None;
    }
    let account_id = account_id?;
    let mut tools = Vec::new();
    for config in app_state.config.client_tools.tools.values() {
        let qualified_name = config.qualified_name();
        if !grant.tools.contains(&qualified_name) {
            continue;
        }
        let decision = crate::models::user_preference::find_client_tool_decision(
            &app_state.db,
            &account_id,
            &qualified_name,
        )
        .await
        .unwrap_or_else(|error| {
            tracing::warn!(%error, "Cannot read a client tool decision for a granted tool");
            Some(ClientToolDecision::NeverAllow)
        });
        if granted_tool_allowed(&grant, config, decision) {
            tools.push((
                config.clone(),
                GrantedCall {
                    owner_chat_id: grant.owner_chat_id,
                    owner_message_id: grant.owner_message_id,
                    context_ref: grant.context_ref.clone(),
                    context_input: config.child_context_input.clone(),
                },
            ));
        }
    }
    Some((grant.binding, tools))
}

/// The input a granted call is dispatched with: the grant's context version
/// in place of whatever the model put there, or nothing when the grant has
/// none. The stored call keeps the model's input.
pub fn dispatch_input(input: &Value, call: &GrantedCall) -> Value {
    let mut input = input.clone();
    if let (Some(field), Some(object)) = (call.context_input.as_ref(), input.as_object_mut()) {
        match &call.context_ref {
            Some(context_ref) => {
                object.insert(field.clone(), Value::String(context_ref.clone()));
            }
            None => {
                object.remove(field);
            }
        }
    }
    input
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::FacetConfig;
    use crate::services::client_operations::{ExecutionRealm, HostContext};
    use serde_json::json;

    fn binding(kind: &str, identity: &str) -> ExecutorBinding {
        ExecutorBinding {
            device_id: "device".into(),
            realm: ExecutionRealm::OfficeAddin,
            host_context: Some(HostContext {
                kind: kind.into(),
                identity: identity.into(),
            }),
        }
    }

    fn grant() -> ClientToolGrant {
        ClientToolGrant {
            tools: vec!["word/read_document_blocks".into()],
            binding: binding("word_document", "pane-one"),
            owner_chat_id: Uuid::new_v4(),
            owner_message_id: Uuid::new_v4(),
            context_ref: Some("token".into()),
        }
    }

    fn provenance() -> ChatProvenance {
        ChatProvenance {
            kind: crate::models::chat::ChatProvenanceKind::Delegation,
            origin_chat_id: None,
            origin_message_id: None,
            origin_assistant_id: None,
            parent_message_id: None,
            rebase_cutoff: None,
            depth: 1,
            adopted_at: None,
            legacy_expected_output: None,
            legacy_constraints: None,
            run_mode: None,
            result_delivery: None,
            retry_of: None,
        }
    }

    fn read_tool() -> ClientToolConfig {
        ClientToolConfig {
            name: "read_document_blocks".into(),
            namespace: Some("word".into()),
            child_access: ClientToolChildAccess::Read,
            host_context: Some(ClientToolHostContext::WordDocument),
            child_context_arg: Some("document_snapshot".into()),
            child_context_input: Some("snapshot".into()),
            ..Default::default()
        }
    }

    #[test]
    fn the_grant_holds_only_on_its_binding_unadopted_and_while_the_owner_runs() {
        let grant = grant();
        let on_binding = Some(&grant.binding);
        assert!(grant_offer_allowed(&grant, &provenance(), on_binding, true));
        assert!(!grant_offer_allowed(&grant, &provenance(), None, true));
        let other = binding("word_document", "pane-two");
        assert!(!grant_offer_allowed(
            &grant,
            &provenance(),
            Some(&other),
            true
        ));
        let adopted = ChatProvenance {
            adopted_at: Some(chrono::Utc::now().into()),
            ..provenance()
        };
        assert!(!grant_offer_allowed(&grant, &adopted, on_binding, true));
        assert!(!grant_offer_allowed(
            &grant,
            &provenance(),
            on_binding,
            false
        ));
    }

    #[test]
    fn a_granted_tool_needs_the_grant_its_current_config_and_no_never() {
        let grant = grant();
        let tool = read_tool();
        assert!(granted_tool_allowed(&grant, &tool, None));
        assert!(granted_tool_allowed(
            &grant,
            &tool,
            Some(ClientToolDecision::Ask)
        ));
        assert!(!granted_tool_allowed(
            &grant,
            &tool,
            Some(ClientToolDecision::NeverAllow)
        ));
        let unlisted = ClientToolConfig {
            name: "read_document_outline".into(),
            ..read_tool()
        };
        assert!(!granted_tool_allowed(&grant, &unlisted, None));
        let no_longer_read = ClientToolConfig {
            child_access: ClientToolChildAccess::None,
            ..read_tool()
        };
        assert!(!granted_tool_allowed(&grant, &no_longer_read, None));
        let other_host = ClientToolConfig {
            host_context: Some(ClientToolHostContext::OutlookMailbox),
            ..read_tool()
        };
        assert!(!granted_tool_allowed(&grant, &other_host, None));
    }

    #[test]
    fn the_context_version_replaces_the_models_or_is_removed() {
        let call = GrantedCall {
            owner_chat_id: Uuid::new_v4(),
            owner_message_id: Uuid::new_v4(),
            context_ref: Some("server-token".into()),
            context_input: Some("snapshot".into()),
        };
        let input = json!({"snapshot": "forged", "part": "intro"});
        assert_eq!(
            dispatch_input(&input, &call),
            json!({"snapshot": "server-token", "part": "intro"})
        );
        assert_eq!(
            dispatch_input(&json!({"part": "intro"}), &call),
            json!({"snapshot": "server-token", "part": "intro"})
        );
        let without_ref = GrantedCall {
            context_ref: None,
            ..call.clone()
        };
        assert_eq!(
            dispatch_input(&input, &without_ref),
            json!({"part": "intro"})
        );
        let without_field = GrantedCall {
            context_input: None,
            ..call
        };
        assert_eq!(dispatch_input(&input, &without_field), input);
    }

    fn facets() -> FacetsConfig {
        let mut facets = FacetsConfig::default();
        facets.facets.insert(
            "research".into(),
            FacetConfig {
                display_name: "Research".into(),
                ..Default::default()
            },
        );
        facets.facets.insert(
            "word_reader".into(),
            FacetConfig {
                display_name: "Read the document".into(),
                child_host_context: Some(ClientToolHostContext::WordDocument),
                ..Default::default()
            },
        );
        facets.facets.insert(
            "mail_reader".into(),
            FacetConfig {
                display_name: "Read the mailbox".into(),
                child_host_context: Some(ClientToolHostContext::OutlookMailbox),
                ..Default::default()
            },
        );
        facets
    }

    #[test]
    fn the_first_named_child_facet_decides_the_host() {
        let facets = facets();
        let ids = |ids: &[&str]| ids.iter().map(|id| id.to_string()).collect::<Vec<_>>();
        assert_eq!(client_task_host(&facets, &ids(&["research"])), None);
        assert_eq!(client_task_host(&facets, &ids(&["unknown"])), None);
        assert_eq!(
            client_task_host(&facets, &ids(&["research", "mail_reader", "word_reader"])),
            Some(ClientToolHostContext::OutlookMailbox)
        );
        let call = |arguments| genai::chat::ToolCall {
            call_id: "call".into(),
            fn_name: "delegate_task".into(),
            fn_arguments: arguments,
            thought_signatures: None,
        };
        assert!(names_child_facet(
            &facets,
            &call(json!({"facet_ids": ["research", "word_reader"]}))
        ));
        assert!(!names_child_facet(
            &facets,
            &call(json!({"facet_ids": ["research"]}))
        ));
        assert!(!names_child_facet(&facets, &call(json!({"task": "x"}))));
        assert!(!names_child_facet(
            &facets,
            &call(json!({"facet_ids": "word_reader"}))
        ));
    }

    #[test]
    fn only_read_tools_of_the_turn_are_candidates() {
        let schema = json!({"type": "object"});
        let read = OfferedClientTool::prepare(&read_tool(), &schema).unwrap();
        let plain = OfferedClientTool::prepare(
            &ClientToolConfig {
                name: "write_comment".into(),
                ..Default::default()
            },
            &schema,
        )
        .unwrap();
        let mut inbox = read.clone();
        inbox.inbox_only = true;
        let candidates = grant_candidates([&read, &plain, &inbox]);
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].config.name, "read_document_blocks");
    }
}
