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
        custom_format: None,
        cache_control: None,
        eager_input_streaming: None,
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

/// First production kind of the shared durable operation inbox. Native review,
/// approved export validation and receipt trust stay specific to this adapter.
pub struct LocalEvidenceKind {
    pub signer: std::sync::Arc<super::signing::Signer>,
}
pub const KIND: &str = "local_evidence.v1";
impl crate::services::client_operations::OperationKind for LocalEvidenceKind {
    fn kind(&self) -> &'static str {
        KIND
    }
    fn operation_id(&self) -> &'static str {
        QUALIFIED_NAME
    }
    fn realm(&self) -> crate::services::client_operations::ExecutionRealm {
        crate::services::client_operations::ExecutionRealm::DesktopSidecar
    }
    fn consent(&self) -> crate::services::client_operations::ConsentPolicy {
        crate::services::client_operations::ConsentPolicy::Native
    }
    fn reoffer_after_result(
        &self,
        result: &crate::services::client_operations::OperationResult,
    ) -> bool {
        result.outcome == crate::services::client_operations::OperationOutcome::Succeeded
    }
    fn tool_offer(
        &self,
        context: &crate::services::client_operations::OperationOfferContext<'_>,
    ) -> Option<crate::services::client_operations::OperationToolOffer> {
        if context.account_id.is_none()
            || !eligible(
                context.config,
                context.chat,
                context.allowlist,
                context.other_tools,
            )
            || !context
                .request_context
                .registered_client_tools
                .iter()
                .any(|name| name == NAME)
        {
            return None;
        }
        let binding = context.request_context.executor.clone()?;
        let host = binding.host_context.as_ref()?;
        if binding.realm != self.realm()
            || !binding.validate()
            || host.kind != "origin"
            || !context
                .config
                .desktop_sidecar
                .allowed_origins
                .contains(&host.identity)
        {
            return None;
        }
        let tool = build(false);
        Some(crate::services::client_operations::OperationToolOffer {
            definition: crate::config::ClientToolConfig {
                name: NAME.into(),
                namespace: Some("erato".into()),
                description: tool.description?,
                parameters: tool.schema?.to_string(),
                requires_client_registration: true,
                ..Default::default()
            },
            binding,
        })
    }
    fn validate_input(
        &self,
        input: &Value,
        binding: &crate::services::client_operations::ExecutorBinding,
    ) -> Result<(), String> {
        if binding.realm != self.realm()
            || !binding.validate()
            || binding.device_id.len() < 32
            || binding.device_id.len() > 128
            || !binding
                .device_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
            || binding
                .host_context
                .as_ref()
                .is_none_or(|host| host.kind != "origin")
        {
            return Err("Invalid native executor binding".into());
        }
        plan(input, 0)
            .map(|_| ())
            .map_err(|_| "Invalid local evidence plan".into())
    }
    fn validate_result(
        &self,
        request: &crate::services::client_operations::OperationRequest,
        result: &crate::services::client_operations::OperationResult,
    ) -> Result<crate::services::client_operations::ValidatedResult, String> {
        self.validated_export(request, result)
            .map_err(|_| "Invalid approved local evidence".into())
    }
}
impl LocalEvidenceKind {
    fn validated_export(
        &self,
        request: &crate::services::client_operations::OperationRequest,
        result: &crate::services::client_operations::OperationResult,
    ) -> eyre::Result<crate::services::client_operations::ValidatedResult> {
        use crate::services::client_operations::{
            OperationOutcome, OperationValue, ValidatedResult,
        };
        use base64::{Engine as _, engine::general_purpose::STANDARD};
        #[derive(serde::Deserialize)]
        #[serde(deny_unknown_fields)]
        struct ApprovedReceipt {
            receipt: String,
            package: Value,
        }
        let Some(OperationValue::Receipt { receipt }) = &result.result else {
            return Err(eyre::eyre!("Receipt required"));
        };
        let approved: ApprovedReceipt = serde_json::from_value(receipt.clone())?;
        let claims = self.signer.verify_receipt(&approved.receipt)?;
        let package = approved.package;
        let binding = &package["binding"];
        let plan = request_plan(request)?;
        if result.outcome != OperationOutcome::Succeeded
            || result.error.is_some()
            || result.executor != request.binding
            || binding["backendOrigin"] != self.signer.origin
            || binding["accountId"] != request.account_id.to_string()
            || binding["deviceId"] != request.binding.device_id
            || binding["jobId"] != request.attempt_id.to_string()
            || binding["taskId"] != request.chat_id.to_string()
            || binding["toolCallId"] != request.tool_call_id
            || claims["binding"] != *binding
            || claims["exportId"] != package["exportId"]
            || claims["manifestDigest"] != package["manifestDigest"]
        {
            return Err(eyre::eyre!("Receipt binding mismatch"));
        }
        contract::validate_export(&package, binding, &plan, chrono::Utc::now().timestamp())?;
        let mut evidence = Vec::new();
        for item in package["artifacts"].as_array().ok_or(contract::Invalid)? {
            let text = String::from_utf8(
                STANDARD.decode(item["contentBase64"].as_str().ok_or(contract::Invalid)?)?,
            )?;
            evidence.push(json!({"artifactId":item["artifactId"],
                "file_id":super::uploads::file_id(request.attempt_id, package["exportId"].as_str().ok_or(contract::Invalid)?,
                    item["artifactId"].as_str().ok_or(contract::Invalid)?, item["sha256"].as_str().ok_or(contract::Invalid)?),
                "filename":item["filename"],"text":text}));
        }
        Ok(ValidatedResult {
            succeeded: true,
            output: json!({"status":"approved","exportId":package["exportId"],"evidence":evidence}),
        })
    }
}

pub fn request_plan(
    request: &crate::services::client_operations::OperationRequest,
) -> Result<Value, contract::Invalid> {
    plan(
        &request.input,
        request
            .expires_at
            .timestamp()
            .checked_sub(86400)
            .ok_or(contract::Invalid)?,
    )
}

pub fn registry(
    signer: Option<&std::sync::Arc<super::signing::Signer>>,
) -> crate::services::client_operations::OperationRegistry {
    let mut registry = crate::services::client_operations::OperationRegistry::default();
    if let Some(signer) = signer {
        registry
            .register(std::sync::Arc::new(LocalEvidenceKind {
                signer: signer.clone(),
            }))
            .expect("unique compiled operation kind");
    }
    registry
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
