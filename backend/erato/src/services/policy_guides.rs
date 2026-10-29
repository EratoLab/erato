//! Policy definitions evaluated as refusal predicates. Callers supply content and
//! decide how to interpret probabilities; this module does not enforce policies.
use eyre::{Result, eyre};
use serde_json::Value;

use crate::config::AppConfig;
use crate::services::decision::{
    self, Answer, DecisionInput, DecisionProvider, Question, QuestionKind, SingleDecisionRequest,
};

#[derive(Debug, Clone, PartialEq)]
pub enum PolicyGuideOutcome {
    /// Estimated probability that the configured refusal condition is true.
    Evaluated { refusal_probability: f64 },
    /// The provider declined to evaluate. This is not a policy violation.
    ProviderRefusal,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PolicyGuideEvaluation {
    pub policy_id: String,
    pub configured_provider_id: String,
    pub resolved_provider_id: String,
    pub outcome: PolicyGuideOutcome,
    pub model: Option<String>,
    pub usage: Option<Value>,
}

/// Evaluate one enabled policy using only its highest-priority provider.
/// Replacement mappings are honored; provider failures never trigger fallback.
pub async fn evaluate(
    config: &AppConfig,
    policy_id: &str,
    input: DecisionInput,
) -> Result<PolicyGuideEvaluation> {
    evaluate_with_factory(config, policy_id, input, |id| {
        decision::provider_by_id(config, id)
    })
    .await
}

async fn evaluate_with_factory(
    config: &AppConfig,
    policy_id: &str,
    input: DecisionInput,
    factory: impl FnOnce(&str) -> Result<Box<dyn DecisionProvider>>,
) -> Result<PolicyGuideEvaluation> {
    let policy = config
        .policy_guides
        .policies
        .get(policy_id)
        .ok_or_else(|| eyre!("Unknown policy guide {policy_id}"))?;
    eyre::ensure!(policy.enabled, "Policy guide {policy_id} is disabled");
    let configured_provider_id = policy
        .decision_providers
        .first()
        .ok_or_else(|| eyre!("Policy guide {policy_id} has no decision provider"))?;
    let resolved_provider_id = config.resolve_decision_provider_id(configured_provider_id)?;
    let provider = factory(resolved_provider_id)?;
    let response = provider
        .decide_one(SingleDecisionRequest {
            input,
            question: Question {
                id: policy_id.to_owned(),
                instructions: format!(
                    "Evaluate whether the supplied content should be refused under this policy.\n\n\
                     Question:\n{}\n\n\
                     True (refuse):\n{}\n\n\
                     False (allow):\n{}\n\n\
                     The predicate is true when the refusal condition applies and false when the allowed condition applies.",
                    policy.question, policy.choice_refuse, policy.choice_allow
                ),
                kind: QuestionKind::Predicate,
            },
        })
        .await?;
    eyre::ensure!(
        response.answer.id == policy_id,
        "Unexpected policy guide answer ID"
    );
    let outcome = match response.answer.answer {
        Answer::Predicate { probability } => {
            eyre::ensure!(
                probability.is_finite() && (0.0..=1.0).contains(&probability),
                "Invalid policy guide refusal probability"
            );
            PolicyGuideOutcome::Evaluated {
                refusal_probability: probability,
            }
        }
        Answer::Refusal => PolicyGuideOutcome::ProviderRefusal,
        Answer::Choice { .. } => return Err(eyre!("Unexpected policy guide answer kind")),
    };
    Ok(PolicyGuideEvaluation {
        policy_id: policy_id.to_owned(),
        configured_provider_id: configured_provider_id.clone(),
        resolved_provider_id: resolved_provider_id.to_owned(),
        outcome,
        model: response.model,
        usage: response.usage,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::decision::{DecisionRequest, DecisionResponse, QuestionAnswer};
    use async_trait::async_trait;
    use serde_json::json;
    use std::sync::{Arc, Mutex};

    fn config() -> AppConfig {
        AppConfig {
            policy_guides: serde_json::from_value(json!({"policies": {"confidential": {
                "enabled": true,
                "question": "Does this contain confidential information?",
                "choice_refuse": "Contains confidential information.",
                "choice_allow": "Contains only public information.",
                "decision_providers": ["removed", "second"],
                "metadata": {"internal_note": "not model instructions"}
            }}}))
            .unwrap(),
            decision_providers: serde_json::from_value(json!({
                "provider": {
                    "archived": {"archived": true},
                    "first": {"provider_kind": "openai", "model_name": "test"},
                    "second": {"provider_kind": "openai", "model_name": "unused"}
                },
                "replacement_providers": [
                    {"old": "removed", "new": "archived"},
                    {"old": "archived", "new": "first"}
                ]
            }))
            .unwrap(),
            ..Default::default()
        }
    }

    struct Stub {
        requests: Arc<Mutex<Vec<DecisionRequest>>>,
        answer: Answer,
        fail: bool,
    }

    #[async_trait]
    impl DecisionProvider for Stub {
        async fn decide(&self, request: &DecisionRequest) -> Result<DecisionResponse> {
            self.requests.lock().unwrap().push(request.clone());
            eyre::ensure!(!self.fail, "provider unavailable");
            Ok(DecisionResponse {
                answers: vec![QuestionAnswer {
                    id: request.questions[0].id.clone(),
                    answer: self.answer.clone(),
                }],
                model: Some("test-model".into()),
                usage: Some(json!({"input_tokens": 3})),
            })
        }
    }

    #[tokio::test]
    async fn preserves_probabilities_inputs_and_replacement_identity() {
        let config = config();
        for probability in [0.0, 0.5, 1.0] {
            for input in [
                DecisionInput::Text("sample".into()),
                DecisionInput::Json(json!({"text":"sample"})),
            ] {
                let requests = Arc::new(Mutex::new(vec![]));
                let result = evaluate_with_factory(&config, "confidential", input.clone(), |id| {
                    assert_eq!(id, "first");
                    Ok(Box::new(Stub {
                        requests: requests.clone(),
                        answer: Answer::Predicate { probability },
                        fail: false,
                    }))
                })
                .await
                .unwrap();
                assert_eq!(
                    result.outcome,
                    PolicyGuideOutcome::Evaluated {
                        refusal_probability: probability
                    }
                );
                assert_eq!(result.configured_provider_id, "removed");
                assert_eq!(result.resolved_provider_id, "first");
                assert_eq!(result.model.as_deref(), Some("test-model"));
                assert_eq!(result.usage, Some(json!({"input_tokens":3})));
                let requests = requests.lock().unwrap();
                assert_eq!(requests.len(), 1);
                match (&requests[0].input, &input) {
                    (DecisionInput::Text(actual), DecisionInput::Text(expected)) => {
                        assert_eq!(actual, expected)
                    }
                    (DecisionInput::Json(actual), DecisionInput::Json(expected)) => {
                        assert_eq!(actual, expected)
                    }
                    _ => panic!("Input kind changed"),
                }
                let [question] = requests[0].questions.as_slice() else {
                    panic!("Expected one question")
                };
                assert!(matches!(question.kind, QuestionKind::Predicate));
                assert_eq!(question.id, "confidential");
                assert!(
                    question
                        .instructions
                        .contains("Question:\nDoes this contain confidential information?")
                );
                assert!(
                    question
                        .instructions
                        .contains("True (refuse):\nContains confidential information.")
                );
                assert!(
                    question
                        .instructions
                        .contains("False (allow):\nContains only public information.")
                );
                assert!(!question.instructions.contains("not model instructions"));
            }
        }
    }

    #[tokio::test]
    async fn refuses_to_call_unknown_disabled_or_unavailable_policies() {
        let mut config = config();
        for id in ["missing", "confidential"] {
            config
                .policy_guides
                .policies
                .get_mut("confidential")
                .unwrap()
                .enabled = false;
            assert!(
                evaluate_with_factory(
                    &config,
                    id,
                    DecisionInput::Text("sample".into()),
                    |_| panic!("Must not construct provider")
                )
                .await
                .is_err()
            );
        }
        let policy = config
            .policy_guides
            .policies
            .get_mut("confidential")
            .unwrap();
        policy.enabled = true;
        policy.decision_providers[0] = "unavailable".into();
        assert!(
            evaluate_with_factory(
                &config,
                "confidential",
                DecisionInput::Text("sample".into()),
                |_| panic!("Must not fall back to second provider")
            )
            .await
            .is_err()
        );
    }

    #[tokio::test]
    async fn provider_refusal_is_distinct_and_errors_never_become_probabilities() {
        for (answer, fail) in [
            (Answer::Refusal, false),
            (Answer::Refusal, true),
            (
                Answer::Choice {
                    choice: "allow".into(),
                    probabilities: Default::default(),
                    confidence: 1.0,
                },
                false,
            ),
            (
                Answer::Predicate {
                    probability: f64::NAN,
                },
                false,
            ),
            (Answer::Predicate { probability: -0.1 }, false),
            (Answer::Predicate { probability: 1.1 }, false),
        ] {
            let expected_refusal = !fail && answer == Answer::Refusal;
            let requests = Arc::new(Mutex::new(vec![]));
            let result = evaluate_with_factory(
                &config(),
                "confidential",
                DecisionInput::Text("sample".into()),
                |id| {
                    assert_eq!(id, "first");
                    Ok(Box::new(Stub {
                        requests: requests.clone(),
                        answer,
                        fail,
                    }))
                },
            )
            .await;
            if expected_refusal {
                assert_eq!(result.unwrap().outcome, PolicyGuideOutcome::ProviderRefusal);
            } else {
                assert!(result.is_err());
            }
            assert_eq!(requests.lock().unwrap().len(), 1);
        }
    }
}
