//! `client_tool.v1`: the one compiled kind that configured client tools opt into
//! with `[client_tools.tools.<id>.durable]`. Configuration selects the tool and a
//! compiled host family; it never names an executor, realm or device.
use super::*;
use crate::config::{ClientToolConfig, ClientToolHostContext};
use serde_json::json;

pub const CLIENT_TOOL_KIND: &str = "client_tool.v1";
const MAX_INPUT_BYTES: usize = 64 * 1024;
const MAX_RESULT_BYTES: usize = 1024 * 1024;
/// The most files the server reads for one result.
const MAX_RESULT_FILES: usize = 20;

pub struct ConfiguredClientToolKind {
    operation_id: String,
    host: ClientToolHostContext,
    result: Option<Arc<jsonschema::Validator>>,
    attempt_ttl: chrono::Duration,
    claim_lease: chrono::Duration,
}

fn seconds(value: u64) -> Result<chrono::Duration, String> {
    i64::try_from(value)
        .ok()
        .and_then(chrono::Duration::try_seconds)
        .ok_or_else(|| "duration out of range".to_string())
}

impl ConfiguredClientToolKind {
    /// `None` for a tool without a `durable` table.
    pub fn from_config(tool: &ClientToolConfig) -> Result<Option<Self>, String> {
        let Some(durable) = &tool.durable else {
            return Ok(None);
        };
        let result = durable
            .result_schema
            .as_deref()
            .map(|schema| {
                let schema = serde_json::from_str(schema).map_err(|error| error.to_string())?;
                erato_config::client_tool_schema::compile(&schema).map(Arc::new)
            })
            .transpose()?;
        Ok(Some(Self {
            operation_id: tool.qualified_name(),
            host: durable.host_context,
            result,
            attempt_ttl: seconds(durable.attempt_expiry_secs)?,
            claim_lease: seconds(durable.claim_lease_secs)?,
        }))
    }
}

/// The realm whose executors hold this host family's client context.
fn realm_for(host: ClientToolHostContext) -> ExecutionRealm {
    match host {
        ClientToolHostContext::OutlookMailbox | ClientToolHostContext::WordDocument => {
            ExecutionRealm::OfficeAddin
        }
        ClientToolHostContext::DesktopSidecar => ExecutionRealm::DesktopSidecar,
    }
}

fn serialized_len(value: &Value) -> usize {
    serde_json::to_vec(value).map_or(usize::MAX, |bytes| bytes.len())
}

fn bounded_message(error: &OperationError) -> Result<Option<&str>, String> {
    match error.message.as_deref() {
        Some(message) if message.chars().count() > MAX_OPERATION_MESSAGE_CHARS => {
            Err("Executor message too long".into())
        }
        message => Ok(message),
    }
}

impl OperationKind for ConfiguredClientToolKind {
    fn kind(&self) -> &'static str {
        CLIENT_TOOL_KIND
    }
    fn operation_id(&self) -> &str {
        &self.operation_id
    }
    fn realm(&self) -> ExecutionRealm {
        realm_for(self.host)
    }
    fn consent(&self) -> ConsentPolicy {
        ConsentPolicy::None
    }
    fn attempt_ttl(&self) -> chrono::Duration {
        self.attempt_ttl
    }
    fn claim_lease(&self) -> chrono::Duration {
        self.claim_lease
    }
    fn gated_by_user_decision(&self) -> bool {
        true
    }
    fn requires_binding(&self) -> bool {
        false
    }
    fn settle_invalid_claimed(&self) -> bool {
        true
    }
    fn validate_input(&self, input: &Value, binding: &ExecutorBinding) -> Result<(), String> {
        if !binding.validate()
            || binding.realm != self.realm()
            || binding
                .host_context
                .as_ref()
                .is_none_or(|host| host.kind != self.host.as_str())
        {
            return Err("Executor binding does not match the tool's host".into());
        }
        if !input.is_object() || serialized_len(input) > MAX_INPUT_BYTES {
            return Err("Invalid client tool input".into());
        }
        Ok(())
    }
    fn validate_result(
        &self,
        request: &OperationRequest,
        result: &OperationResult,
    ) -> Result<ValidatedResult, String> {
        if result.attempt_id != request.attempt_id
            || result.operation_id != request.operation_id
            || result.executor != request.binding
            || result.base_revision.is_some()
        {
            return Err("Result identity mismatch".into());
        }
        match (result.outcome, &result.result, &result.error) {
            (
                OperationOutcome::Succeeded,
                Some(OperationValue::Value {
                    value,
                    file_upload_ids,
                }),
                None,
            ) => {
                if serialized_len(value) > MAX_RESULT_BYTES {
                    return Err("Result too large".into());
                }
                if file_upload_ids.len() > MAX_RESULT_FILES
                    || file_upload_ids
                        .iter()
                        .enumerate()
                        .any(|(index, id)| file_upload_ids[..index].contains(id))
                {
                    return Err("Invalid result files".into());
                }
                // The schema describes the tool's own value; with files the
                // model sees it inside the server's file wrapper instead.
                if file_upload_ids.is_empty()
                    && self
                        .result
                        .as_ref()
                        .is_some_and(|schema| !schema.is_valid(value))
                {
                    return Err("Result does not match the tool's result schema".into());
                }
                Ok(ValidatedResult {
                    output: json!({"status":"success","result":value}),
                    succeeded: true,
                    file_ids: file_upload_ids.clone(),
                })
            }
            (OperationOutcome::Failed, None, Some(error)) if error.code == "execution_failed" => {
                let message = bounded_message(error)?
                    .and_then(clean_message)
                    .unwrap_or_else(|| "The client tool failed.".into());
                Ok(ValidatedResult {
                    output: json!({"status":"error","error":message}),
                    succeeded: false,
                    file_ids: Vec::new(),
                })
            }
            (OperationOutcome::Rejected, None, Some(error))
                if error.code == "validation_failed" =>
            {
                bounded_message(error)?;
                if self.host == ClientToolHostContext::WordDocument
                    && let Some(validation) = &error.validation
                {
                    let payload = json!({"validation_errors": validation.issues, "submission_feedback": validation.feedback});
                    if serialized_len(&payload) > MAX_INPUT_BYTES {
                        return Err("Read diagnostics too large".into());
                    }
                    let crate::services::client_tools::ClientToolOutcome::ValidationFailed(
                        issues,
                        feedback,
                    ) = crate::services::client_tools::ClientToolOutcome::from_payload(&payload)
                    else {
                        return Err("Invalid read diagnostics".into());
                    };
                    let mut output = json!({"status":"error", "error":"Document read validation failed", "validation_errors":issues});
                    if let Some(feedback) = feedback {
                        output["submission_feedback"] = json!(feedback);
                    }
                    return Ok(ValidatedResult {
                        output,
                        succeeded: false,
                        file_ids: Vec::new(),
                    });
                }
                Ok(ValidatedResult {
                    output: json!({"status":"error","error":"Client tool validation failed"}),
                    succeeded: false,
                    file_ids: Vec::new(),
                })
            }
            // A device prompt the user declined. Only a task's granted call
            // counts it as declined; the user's own calls have their card.
            (OperationOutcome::Rejected, None, Some(error))
                if error.code == crate::services::delegated_client_tools::DECLINED
                    && request.lineage.is_some() =>
            {
                bounded_message(error)?;
                let tool_name = request.operation_id.rsplit('/').next().unwrap_or_default();
                Ok(ValidatedResult {
                    output: crate::services::delegated_client_tools::declined_output(tool_name),
                    succeeded: false,
                    file_ids: Vec::new(),
                })
            }
            _ => Err("Unsupported client tool result".into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ClientToolDurableConfig;

    #[test]
    fn word_read_rejections_keep_bounded_diagnostics_on_both_paths() {
        use crate::services::client_tools::{
            ClientToolOutcome, ClientToolSubmissionFeedback, SubmissionRecovery,
        };
        let mut kind = kind(None);
        kind.host = ClientToolHostContext::WordDocument;
        let mut request = request();
        request.binding.host_context.as_mut().unwrap().kind = "word_document".into();
        let outcome = ClientToolOutcome::from_payload(&json!({
            "validation_errors": [{"path":"/snapshot","code":"capture-unavailable","message":"x".repeat(2000)}],
            "submission_feedback": {"terminal":true,"recovery":"cannot_continue"}
        }));
        let result = from_fast_result(&request, outcome).unwrap();
        assert!(result.result.is_none());
        let validated = kind.validate_result(&request, &result).unwrap();
        assert!(!validated.succeeded);
        assert_eq!(
            validated.output["validation_errors"][0]["message"]
                .as_str()
                .unwrap()
                .len(),
            512
        );
        assert!(matches!(
            ClientToolOutcome::from_payload(&validated.output),
            ClientToolOutcome::ValidationFailed(
                _,
                Some(ClientToolSubmissionFeedback {
                    recovery: SubmissionRecovery::CannotContinue,
                    ..
                })
            )
        ));
        let mut malformed = result.clone();
        malformed
            .error
            .as_mut()
            .unwrap()
            .validation
            .as_mut()
            .unwrap()
            .issues
            .clear();
        assert!(kind.validate_result(&request, &malformed).is_err());
        kind.host = ClientToolHostContext::OutlookMailbox;
        assert!(
            kind.validate_result(&request, &result)
                .unwrap()
                .output
                .get("validation_errors")
                .is_none()
        );
    }

    const SCHEMA: &str =
        r#"{"type":"object","required":["busy"],"properties":{"busy":{"type":"array"}}}"#;

    fn tool(durable: ClientToolDurableConfig) -> ClientToolConfig {
        ClientToolConfig {
            name: "fetch_availability".into(),
            namespace: Some("outlook".into()),
            description: "Free/busy".into(),
            parameters: r#"{"type":"object"}"#.into(),
            durable: Some(durable),
            ..Default::default()
        }
    }

    fn durable(result_schema: Option<&str>) -> ClientToolDurableConfig {
        ClientToolDurableConfig {
            host_context: ClientToolHostContext::OutlookMailbox,
            result_schema: result_schema.map(str::to_string),
            attempt_expiry_secs: 900,
            claim_lease_secs: 90,
        }
    }

    fn kind(result_schema: Option<&str>) -> ConfiguredClientToolKind {
        ConfiguredClientToolKind::from_config(&tool(durable(result_schema)))
            .unwrap()
            .unwrap()
    }

    fn binding() -> ExecutorBinding {
        ExecutorBinding {
            device_id: "device-one".into(),
            realm: ExecutionRealm::OfficeAddin,
            host_context: Some(HostContext {
                kind: "outlook_mailbox".into(),
                identity: "a".repeat(64),
            }),
        }
    }

    fn request() -> OperationRequest {
        OperationRequest {
            attempt_id: Uuid::new_v4(),
            operation_id: "outlook/fetch_availability".into(),
            kind: CLIENT_TOOL_KIND.into(),
            realm: ExecutionRealm::OfficeAddin,
            chat_id: Uuid::new_v4(),
            message_id: Uuid::new_v4(),
            tool_call_id: "call".into(),
            account_id: Uuid::new_v4(),
            binding: binding(),
            base_revision: None,
            consent: ConsentPolicy::None,
            expires_at: chrono::Utc::now(),
            input: json!({"lookahead_days":7}),
            lineage: None,
        }
    }

    fn result(
        request: &OperationRequest,
        outcome: OperationOutcome,
        value: Option<OperationValue>,
        error: Option<(&str, Option<String>)>,
    ) -> OperationResult {
        OperationResult {
            attempt_id: request.attempt_id,
            operation_id: request.operation_id.clone(),
            base_revision: None,
            outcome,
            result: value,
            error: error.map(|(code, message)| OperationError {
                validation: None,
                code: code.into(),
                message,
            }),
            executor: request.binding.clone(),
        }
    }

    fn value(value: Value) -> Option<OperationValue> {
        files(value, Vec::new())
    }

    fn files(value: Value, file_upload_ids: Vec<Uuid>) -> Option<OperationValue> {
        Some(OperationValue::Value {
            value,
            file_upload_ids,
        })
    }

    #[test]
    fn a_succeeded_value_may_carry_its_uploaded_files() {
        let request = request();
        let ids: Vec<Uuid> = (0..MAX_RESULT_FILES).map(|_| Uuid::new_v4()).collect();
        let with_files = result(
            &request,
            OperationOutcome::Succeeded,
            files(json!({"busy":"none"}), ids.clone()),
            None,
        );
        let validated = kind(None).validate_result(&request, &with_files).unwrap();
        assert!(validated.succeeded);
        assert_eq!(validated.file_ids, ids);
        assert_eq!(
            validated.output,
            json!({"status":"success","result":{"busy":"none"}})
        );
        assert_eq!(
            serde_json::to_value(&validated).unwrap()["file_ids"],
            json!(ids)
        );
        // The schema is the tool's own value; a result with files skips it.
        assert!(
            kind(Some(SCHEMA))
                .validate_result(&request, &with_files)
                .is_ok()
        );
        let without_files = result(
            &request,
            OperationOutcome::Succeeded,
            value(json!({"busy":"none"})),
            None,
        );
        assert!(
            kind(Some(SCHEMA))
                .validate_result(&request, &without_files)
                .is_err()
        );

        let mut too_many = ids.clone();
        too_many.push(Uuid::new_v4());
        let repeated = vec![ids[0], ids[1], ids[0]];
        for refused in [
            result(
                &request,
                OperationOutcome::Succeeded,
                files(json!({}), too_many),
                None,
            ),
            result(
                &request,
                OperationOutcome::Succeeded,
                files(json!({}), repeated),
                None,
            ),
            result(
                &request,
                OperationOutcome::Failed,
                files(json!({}), vec![ids[0]]),
                Some(("execution_failed", None)),
            ),
            result(
                &request,
                OperationOutcome::Rejected,
                files(json!({}), vec![ids[0]]),
                Some(("validation_failed", None)),
            ),
        ] {
            assert!(
                kind(None).validate_result(&request, &refused).is_err(),
                "{refused:?}"
            );
        }
    }

    #[test]
    fn a_result_without_files_keeps_its_earlier_shape() {
        let request = request();
        let plain = result(
            &request,
            OperationOutcome::Succeeded,
            value(json!({"busy":[]})),
            None,
        );
        let serialized = serde_json::to_value(&plain).unwrap();
        assert_eq!(
            serialized["result"],
            json!({"type":"value","value":{"busy":[]}})
        );
        let parsed: OperationResult = serde_json::from_value(serialized).unwrap();
        assert_eq!(parsed, plain);
        let validated = kind(None).validate_result(&request, &plain).unwrap();
        assert!(validated.file_ids.is_empty());
        assert!(
            serde_json::to_value(&validated)
                .unwrap()
                .get("file_ids")
                .is_none()
        );

        let id = Uuid::new_v4();
        let from_fast = from_fast_result(
            &request,
            crate::services::client_tools::ClientToolOutcome::Result(json!({"busy":[]}), vec![id]),
        )
        .unwrap();
        assert_eq!(from_fast.outcome, OperationOutcome::Succeeded);
        assert_eq!(from_fast.result, files(json!({"busy":[]}), vec![id]));
        assert_eq!(
            serde_json::to_value(&from_fast).unwrap()["result"],
            json!({"type":"value","value":{"busy":[]},"file_upload_ids":[id]})
        );
    }

    #[test]
    fn identity_comes_from_the_configured_tool() {
        let kind = kind(None);
        assert_eq!(kind.kind(), CLIENT_TOOL_KIND);
        assert_eq!(kind.operation_id(), "outlook/fetch_availability");
        assert_eq!(kind.consent(), ConsentPolicy::None);
        assert!(!kind.allow_cross_device());
        assert!(kind.gated_by_user_decision());
        assert!(!kind.requires_binding());
        assert!(kind.settle_invalid_claimed());
        assert_eq!(kind.attempt_ttl(), chrono::Duration::seconds(900));
        assert_eq!(kind.claim_lease(), chrono::Duration::seconds(90));
        let mut invalid = durable(Some(r#"{"type":"array"}"#));
        assert!(ConfiguredClientToolKind::from_config(&tool(invalid.clone())).is_err());
        invalid.result_schema = Some("not json".into());
        assert!(ConfiguredClientToolKind::from_config(&tool(invalid)).is_err());
        let plain = ClientToolConfig {
            durable: None,
            ..tool(durable(None))
        };
        assert!(
            ConfiguredClientToolKind::from_config(&plain)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn input_requires_the_configured_host_family() {
        let kind = kind(None);
        let input = json!({"lookahead_days":7});
        assert!(kind.validate_input(&input, &binding()).is_ok());
        let mut frontend = binding();
        frontend.realm = ExecutionRealm::Frontend;
        let mut sidecar = binding();
        sidecar.realm = ExecutionRealm::DesktopSidecar;
        let mut no_host = binding();
        no_host.host_context = None;
        let mut word = binding();
        word.host_context.as_mut().unwrap().kind = "word".into();
        let mut empty_device = binding();
        empty_device.device_id.clear();
        for binding in [frontend, sidecar, no_host, word, empty_device] {
            assert!(
                kind.validate_input(&input, &binding).is_err(),
                "{binding:?}"
            );
        }
        assert!(kind.validate_input(&json!([1]), &binding()).is_err());
        assert!(kind.validate_input(&json!("text"), &binding()).is_err());
        let large = json!({"text":"x".repeat(MAX_INPUT_BYTES)});
        assert!(kind.validate_input(&large, &binding()).is_err());
    }

    #[test]
    fn successful_values_pass_the_optional_result_schema() {
        let request = request();
        let ok = result(
            &request,
            OperationOutcome::Succeeded,
            value(json!({"busy":[]})),
            None,
        );
        let validated = kind(None).validate_result(&request, &ok).unwrap();
        assert!(validated.succeeded);
        assert_eq!(
            validated.output,
            json!({"status":"success","result":{"busy":[]}})
        );
        assert!(kind(Some(SCHEMA)).validate_result(&request, &ok).is_ok());
        let violation = result(
            &request,
            OperationOutcome::Succeeded,
            value(json!({"busy":"none"})),
            None,
        );
        assert!(kind(None).validate_result(&request, &violation).is_ok());
        assert!(
            kind(Some(SCHEMA))
                .validate_result(&request, &violation)
                .is_err()
        );
        let large = result(
            &request,
            OperationOutcome::Succeeded,
            value(json!({"busy":[], "pad":"x".repeat(MAX_RESULT_BYTES)})),
            None,
        );
        assert!(kind(None).validate_result(&request, &large).is_err());
    }

    #[test]
    fn failures_forward_only_a_bounded_single_line_message() {
        let request = request();
        let kind = kind(None);
        let failed = |message: Option<String>| {
            kind.validate_result(
                &request,
                &result(
                    &request,
                    OperationOutcome::Failed,
                    None,
                    Some(("execution_failed", message)),
                ),
            )
        };
        let validated = failed(Some("Calendar\nunavailable\t".into())).unwrap();
        assert!(!validated.succeeded);
        assert_eq!(
            validated.output,
            json!({"status":"error","error":"Calendar unavailable"})
        );
        assert_eq!(
            failed(None).unwrap().output["error"],
            "The client tool failed."
        );
        assert_eq!(
            failed(Some(" \n ".into())).unwrap().output["error"],
            "The client tool failed."
        );
        assert!(failed(Some("x".repeat(MAX_OPERATION_MESSAGE_CHARS))).is_ok());
        assert!(failed(Some("x".repeat(MAX_OPERATION_MESSAGE_CHARS + 1))).is_err());
        let rejected = kind
            .validate_result(
                &request,
                &result(
                    &request,
                    OperationOutcome::Rejected,
                    None,
                    Some(("validation_failed", None)),
                ),
            )
            .unwrap();
        assert_eq!(
            rejected.output,
            json!({"status":"error","error":"Client tool validation failed"})
        );
    }

    #[test]
    fn other_envelopes_and_executors_are_refused() {
        let request = request();
        let kind = kind(None);
        let reference = Some(OperationValue::Reference {
            reference: Uuid::new_v4(),
        });
        let receipt = Some(OperationValue::Receipt { receipt: json!({}) });
        let mut other_executor = result(
            &request,
            OperationOutcome::Succeeded,
            value(json!({})),
            None,
        );
        other_executor.executor.device_id = "device-two".into();
        let mut revision = result(
            &request,
            OperationOutcome::Succeeded,
            value(json!({})),
            None,
        );
        revision.base_revision = Some(1);
        for refused in [
            result(&request, OperationOutcome::Succeeded, reference, None),
            result(&request, OperationOutcome::Succeeded, receipt, None),
            result(&request, OperationOutcome::Unknown, None, None),
            result(
                &request,
                OperationOutcome::Failed,
                None,
                Some(("validation_failed", None)),
            ),
            result(
                &request,
                OperationOutcome::Rejected,
                None,
                Some(("execution_failed", None)),
            ),
            result(
                &request,
                OperationOutcome::Succeeded,
                value(json!({})),
                Some(("execution_failed", None)),
            ),
            other_executor,
            revision,
        ] {
            assert!(
                kind.validate_result(&request, &refused).is_err(),
                "{refused:?}"
            );
        }
    }

    #[test]
    fn realm_comes_from_the_host_context() {
        let mut kind = kind(None);
        assert_eq!(kind.realm(), ExecutionRealm::OfficeAddin);
        kind.host = ClientToolHostContext::WordDocument;
        assert_eq!(kind.realm(), ExecutionRealm::OfficeAddin);
        assert_eq!(
            realm_for(ClientToolHostContext::OutlookMailbox),
            ExecutionRealm::OfficeAddin
        );
        kind.host = ClientToolHostContext::DesktopSidecar;
        assert_eq!(kind.realm(), ExecutionRealm::DesktopSidecar);
        let input = json!({"text":"contract"});
        let sidecar = ExecutorBinding {
            device_id: "client-one".into(),
            realm: ExecutionRealm::DesktopSidecar,
            host_context: Some(HostContext {
                kind: "desktop_sidecar".into(),
                identity: "local".into(),
            }),
        };
        assert!(kind.validate_input(&input, &sidecar).is_ok());
        let mut office_realm = sidecar.clone();
        office_realm.realm = ExecutionRealm::OfficeAddin;
        let mut origin = sidecar.clone();
        origin.host_context.as_mut().unwrap().kind = "origin".into();
        for binding in [office_realm, origin, binding()] {
            assert!(
                kind.validate_input(&input, &binding).is_err(),
                "{binding:?}"
            );
        }
    }

    #[test]
    fn a_declined_rejection_is_accepted_only_for_grant_operations() {
        let mut request = request();
        let kind = kind(Some(SCHEMA));
        let declined = |request: &OperationRequest| {
            result(
                request,
                OperationOutcome::Rejected,
                None,
                Some(("declined", None)),
            )
        };
        assert!(kind.validate_result(&request, &declined(&request)).is_err());
        request.lineage = Some(super::super::executor_stream::CallLineage {
            owner_chat_id: Uuid::new_v4(),
            owner_message_id: Uuid::new_v4(),
            requesting_chat_id: request.chat_id,
            requesting_message_id: request.message_id,
            context_ref: None,
        });
        let validated = kind.validate_result(&request, &declined(&request)).unwrap();
        assert!(!validated.succeeded);
        assert_eq!(validated.output["status"], "cancelled");
        assert_eq!(validated.output["reason"], "declined");
        assert!(
            validated.output["error"]
                .as_str()
                .unwrap()
                .contains("'fetch_availability'")
        );
        for refused in [
            result(
                &request,
                OperationOutcome::Failed,
                None,
                Some(("declined", None)),
            ),
            result(
                &request,
                OperationOutcome::Rejected,
                value(json!({})),
                Some(("declined", None)),
            ),
            result(
                &request,
                OperationOutcome::Rejected,
                None,
                Some((
                    "declined",
                    Some("x".repeat(MAX_OPERATION_MESSAGE_CHARS + 1)),
                )),
            ),
        ] {
            assert!(
                kind.validate_result(&request, &refused).is_err(),
                "{refused:?}"
            );
        }
    }

    #[test]
    fn registry_holds_one_kind_per_opted_in_tool_only_while_enabled() {
        let mut config = crate::config::AppConfig::default();
        config
            .client_tools
            .tools
            .insert("availability".into(), tool(durable(None)));
        let mut plain = tool(durable(None));
        plain.name = "search".into();
        plain.durable = None;
        config.client_tools.tools.insert("search".into(), plain);
        assert_eq!(
            super::super::registry(&config, None)
                .unwrap()
                .kinds()
                .count(),
            0
        );
        config.client_tools.durable_operations_enabled = true;
        let registry = super::super::registry(&config, None).unwrap();
        assert_eq!(registry.kinds().count(), 1);
        let kind = registry
            .for_operation("outlook/fetch_availability")
            .unwrap();
        assert_eq!(kind.kind(), CLIENT_TOOL_KIND);
        assert!(registry.for_operation("outlook/search").is_none());
        assert!(registry.for_operation("fetch_availability").is_none());
    }
}
