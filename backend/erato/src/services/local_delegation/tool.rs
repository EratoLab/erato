//! The only native operation offered to a delegated child. No generated code,
//! general Office action, arbitrary RPC method or private intermediate result.
use super::contract;
use genai::chat::Tool;
use serde_json::{Value, json};

pub const NAME: &str = erato_config::config::LOCAL_COLLECT_EVIDENCE_TOOL_NAME;
pub const QUALIFIED_NAME: &str = "erato/local_collect_evidence";
pub fn build(omit_strict: bool) -> Tool {
    Tool {
        name: NAME.into(),
        description: Some(concat!(
            "Collect a bounded package of local evidence using deterministic search queries. ",
            "The task pauses durably until the user reviews an exact snapshot in the native app. ",
            "Only selected, approved evidence returns. Do not request private intermediate hits, ",
            "general Office actions, scripts or code."
        ).into()),
        schema: Some(json!({
            "type": "object",
            "properties": {"queryVariants": {"type":"array", "minItems":1, "maxItems":8,
                "uniqueItems":true, "items":{"type":"string", "minLength":1, "maxLength":512}}},
            "required": ["queryVariants"], "additionalProperties": false
        })),
        strict: (!omit_strict).then_some(false), config: None,
    }
}
pub fn plan(input: &Value, now: i64) -> Result<Value, contract::Invalid> {
    let object = input.as_object().ok_or(contract::Invalid)?;
    if object.len() != 1 || !object.contains_key("queryVariants") {
        return Err(contract::Invalid);
    }
    let plan = json!({"operation":"collect_evidence","queryVariants":input["queryVariants"],"maxHits":40,"maxArtifacts":8,"maxBytes":1048576,"executionSeconds":60,"expiresAt":now.checked_add(86400).ok_or(contract::Invalid)?});
    contract::validate("plan", &plan)?;
    if plan["queryVariants"]
        .as_array()
        .ok_or(contract::Invalid)?
        .iter()
        .any(|q| q.as_str().is_none_or(|q| q.trim().is_empty()))
    {
        return Err(contract::Invalid);
    }
    Ok(plan)
}
/// Initial rollout is deliberately a leaf: explicitly selected local research,
/// in an async task with durable parent delivery, and no other execution tools.
/// Ordinary chats, mention runs, awaited children and wildcard opt-ins stay off.
pub fn eligible(
    config: &crate::config::AppConfig,
    chat: &crate::db::entity::chats::Model,
    allowlist: &[String],
    other_tools: bool,
) -> bool {
    if !config.desktop_sidecar.local_delegation.enabled
        || !config.delegation.tasks.enabled
        || other_tools
        || !allowlist.iter().any(|p| p == QUALIFIED_NAME)
    {
        return false;
    }
    let Ok(Some(scope)) = crate::models::chat::parse_chat_configuration(chat) else {
        return false;
    };
    let (Some(task), Some(origin)) = (scope.task, scope.provenance) else {
        return false;
    };
    task.route == crate::models::chat::DelegateRoute::Task
        && config
            .delegation
            .tasks
            .run_modes
            .contains(&erato_config::config::TaskRunMode::Async)
        && origin.kind == crate::models::chat::ChatProvenanceKind::Delegation
        && origin.origin_chat_id.is_some()
        && origin.origin_message_id.is_some()
        && task.facet_ids.iter().any(|id| {
            config
                .facets
                .facets
                .get(id)
                .is_some_and(|f| f.tool_call_allowlist.iter().any(|p| p == QUALIFIED_NAME))
        })
        && origin.depth == 1
        && origin.adopted_at.is_none()
        && origin.run_mode == Some(crate::models::message::ProvenanceRunMode::Async)
        && task.max_client_tool_calls_per_task.is_some_and(|n| n > 0)
        && task.max_server_tool_calls_per_task.is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_bounded_search_is_accepted_and_review_expiry_is_separate() {
        let approved = plan(&json!({"queryVariants":["quarterly report","budget"]}), 100).unwrap();
        assert_eq!(approved["executionSeconds"], 60);
        assert_eq!(approved["expiresAt"], 86500);
        for input in [
            json!({"queryVariants":[" " ]}),
            json!({"queryVariants":["same","same"]}),
            json!({"queryVariants":["search"],"code":"run me"}),
            json!({"queryVariants":vec!["q";9]}),
            json!({"queryVariants":["q".repeat(513)]}),
        ] {
            assert!(plan(&input, 100).is_err());
        }
    }
}
