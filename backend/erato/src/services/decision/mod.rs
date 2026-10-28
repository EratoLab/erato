//! Native decision providers. Probabilities are model estimates, not policy decisions.
mod llama_cpp;
mod openai;

use std::{
    collections::{BTreeMap, HashSet},
    time::Duration,
};

use async_trait::async_trait;
use eyre::{Result, eyre};
use serde_json::Value;

use crate::config::{AppConfig, DecisionProviderConfig};

#[derive(Debug, Clone)]
pub enum DecisionInput {
    Text(String),
    Json(Value),
}

#[derive(Debug, Clone)]
pub struct ChoiceOption {
    pub value: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone)]
pub enum QuestionKind {
    Choice { options: Vec<ChoiceOption> },
    Predicate,
}

#[derive(Debug, Clone)]
pub struct Question {
    pub id: String,
    pub instructions: String,
    pub kind: QuestionKind,
}

#[derive(Debug, Clone)]
pub struct DecisionRequest {
    pub input: DecisionInput,
    pub questions: Vec<Question>,
}

#[derive(Debug, Clone)]
pub struct SingleDecisionRequest {
    pub input: DecisionInput,
    pub question: Question,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Answer {
    Choice {
        choice: String,
        probabilities: BTreeMap<String, f64>,
        confidence: f64,
    },
    /// The estimated probability that the predicate is true. No threshold is applied.
    Predicate {
        probability: f64,
    },
    Refusal,
}

#[derive(Debug, Clone, PartialEq)]
pub struct QuestionAnswer {
    pub id: String,
    pub answer: Answer,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DecisionResponse {
    pub answers: Vec<QuestionAnswer>,
    pub model: Option<String>,
    pub usage: Option<Value>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SingleDecisionResponse {
    pub answer: QuestionAnswer,
    pub model: Option<String>,
    pub usage: Option<Value>,
}

#[async_trait]
pub trait DecisionProvider: Send + Sync {
    async fn decide(&self, request: &DecisionRequest) -> Result<DecisionResponse>;

    async fn decide_one(&self, request: SingleDecisionRequest) -> Result<SingleDecisionResponse> {
        let response = self
            .decide(&DecisionRequest {
                input: request.input,
                questions: vec![request.question],
            })
            .await?;
        let [answer]: [QuestionAnswer; 1] = response
            .answers
            .try_into()
            .map_err(|_| eyre!("Expected one decision answer"))?;
        Ok(SingleDecisionResponse {
            answer,
            model: response.model,
            usage: response.usage,
        })
    }
}

pub fn provider(config: &DecisionProviderConfig) -> Result<Box<dyn DecisionProvider>> {
    if config.archived {
        return Err(eyre!("Cannot use an archived decision provider"));
    }
    match config.provider_kind.as_str() {
        "openai" => Ok(Box::new(openai::OpenAi(config.clone()))),
        "llama_cpp" => Ok(Box::new(llama_cpp::LlamaCpp(config.clone()))),
        _ => Err(eyre!("Unknown decision provider kind")),
    }
}

/// Resolve replacement IDs before constructing a provider for a new decision.
pub fn provider_by_id(config: &AppConfig, id: &str) -> Result<Box<dyn DecisionProvider>> {
    let resolved = config.resolve_decision_provider_id(id)?;
    let entry = config
        .decision_providers
        .provider
        .get(resolved)
        .ok_or_else(|| eyre!("Decision provider is unavailable"))?;
    provider(entry)
}

fn validate(request: &DecisionRequest) -> Result<()> {
    if request.questions.is_empty() {
        return Err(eyre!("At least one decision question is required"));
    }
    let mut ids = HashSet::new();
    for q in &request.questions {
        if q.id.trim().is_empty() || !ids.insert(&q.id) {
            return Err(eyre!("Question IDs must be nonempty and unique"));
        }
        if q.instructions.trim().is_empty() {
            return Err(eyre!("Question instructions must not be empty"));
        }
        if let QuestionKind::Choice { options } = &q.kind {
            let mut values = HashSet::new();
            if !(2..=255).contains(&options.len())
                || options
                    .iter()
                    .any(|o| o.value.trim().is_empty() || !values.insert(&o.value))
            {
                return Err(eyre!(
                    "Choice questions require 2–255 unique nonempty options"
                ));
            }
        }
    }
    Ok(())
}

fn probability(value: &Value) -> Result<f64> {
    let p = value
        .as_f64()
        .ok_or_else(|| eyre!("Invalid decision probability"))?;
    if !p.is_finite() || !(0.0..=1.0).contains(&p) {
        return Err(eyre!("Invalid decision probability"));
    }
    Ok(p)
}

fn choice_answer(
    question: &Question,
    choice: &Value,
    probabilities: BTreeMap<String, f64>,
    confidence: &Value,
) -> Result<Answer> {
    let QuestionKind::Choice { options } = &question.kind else {
        return Err(eyre!("Unexpected choice answer"));
    };
    let choice = choice
        .as_str()
        .ok_or_else(|| eyre!("Invalid decision choice"))?;
    if !options.iter().any(|o| o.value == choice)
        || probabilities.len() != options.len()
        || options
            .iter()
            .any(|o| !probabilities.contains_key(&o.value))
    {
        return Err(eyre!(
            "Decision choice or probabilities do not match requested options"
        ));
    }
    Ok(Answer::Choice {
        choice: choice.to_owned(),
        probabilities,
        confidence: probability(confidence)?,
    })
}

async fn post(
    config: &DecisionProviderConfig,
    base: &str,
    path: &str,
    body: &Value,
) -> Result<Value> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(180))
        .build()?;
    let mut req = client
        .post(format!("{}/{}", base.trim_end_matches('/'), path))
        .json(body);
    if let Some(key) = &config.api_key {
        req = req.bearer_auth(key.expose_secret());
    }
    let response = req
        .send()
        .await
        .map_err(|e| eyre!("Decision provider request failed: {}", e.without_url()))?;
    let status = response.status();
    if !status.is_success() {
        return Err(eyre!("Decision provider returned HTTP {status}"));
    }
    // Do not include the response body in errors; it may contain sensitive input.
    response
        .json()
        .await
        .map_err(|_| eyre!("Invalid decision provider JSON response"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        Router,
        extract::{Json, State},
        http::HeaderMap,
        routing::post as route_post,
    };
    use serde_json::json;

    async fn mock(
        State((kind, response)): State<(&'static str, Value)>,
        headers: HeaderMap,
        Json(body): Json<Value>,
    ) -> Json<Value> {
        assert_eq!(headers.get("authorization").unwrap(), "Bearer test-key");
        if kind == "openai" {
            assert_eq!(body["model"], "test-model");
            assert_eq!(body["input"], "{\"sample\":1}");
            assert_eq!(body["questions"][0]["type"], "choice");
            assert_eq!(body["questions"][0]["choices"][0]["description"], "first");
            assert_eq!(body["questions"][1]["type"], "predicate");
        } else {
            assert_eq!(body["state"], json!({"sample":1}));
            assert_eq!(
                body["questions"]["first"]["criteria"],
                json!({"a":"first", "b":null})
            );
            assert_eq!(body["questions"]["second"]["type"], "noul");
        }
        Json(response)
    }

    fn request() -> DecisionRequest {
        DecisionRequest {
            input: DecisionInput::Json(json!({"sample":1})),
            questions: vec![
                Question {
                    id: "first".into(),
                    instructions: "Choose".into(),
                    kind: QuestionKind::Choice {
                        options: vec![
                            ChoiceOption {
                                value: "a".into(),
                                description: Some("first".into()),
                            },
                            ChoiceOption {
                                value: "b".into(),
                                description: None,
                            },
                        ],
                    },
                },
                Question {
                    id: "second".into(),
                    instructions: "Is this true?".into(),
                    kind: QuestionKind::Predicate,
                },
            ],
        }
    }

    async fn server(kind: &'static str, response: Value) -> (String, tokio::task::JoinHandle<()>) {
        let path = if kind == "openai" {
            "/v1/decisions"
        } else {
            "/v1/systemone"
        };
        let app = Router::new()
            .route(path, route_post(mock))
            .with_state((kind, response));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (format!("http://{address}/v1"), task)
    }

    fn config(kind: &str, url: &str) -> DecisionProviderConfig {
        serde_json::from_value(json!({"provider_kind":kind,"model_name":"test-model","base_url":url,"api_key":"test-key"})).unwrap()
    }

    #[tokio::test]
    async fn maps_batches_for_both_native_apis() {
        for (kind, response) in [
            (
                "openai",
                json!({"model":"test-model", "answers":[{"type":"choice","name":"first","choice":"a","probabilities":[{"value":"a","probability":0.8},{"value":"b","probability":0.2}],"confidence":0.6},{"type":"predicate","name":"second","probability":0.7}],"usage":{"input_tokens":2}}),
            ),
            (
                "llama_cpp",
                json!({"model":"test-model", "answers":{"second":{"type":"noul","noul":0.7},"first":{"type":"choice","choice":"a","probabilities":{"a":0.8,"b":0.2},"confidence":0.6}},"usage":{"input_tokens":2}}),
            ),
        ] {
            let (url, task) = server(kind, response).await;
            let result = provider(&config(kind, &url))
                .unwrap()
                .decide(&request())
                .await
                .unwrap();
            assert_eq!(result.answers[0].id, "first");
            assert_eq!(
                result.answers[1].answer,
                Answer::Predicate { probability: 0.7 }
            );
            assert!(
                matches!(&result.answers[0].answer, Answer::Choice { choice, probabilities, confidence } if choice == "a" && probabilities["b"] == 0.2 && *confidence == 0.6)
            );
            assert_eq!(result.usage.unwrap()["input_tokens"], 2);
            task.abort();
        }
    }

    #[tokio::test]
    async fn refusal_is_per_question_and_bad_response_is_rejected() {
        let response = json!({"answers":[{"type":"refusal","name":"first"},{"type":"predicate","name":"second","probability":0.7}]});
        let (url, task) = server("openai", response).await;
        let result = provider(&config("openai", &url))
            .unwrap()
            .decide(&request())
            .await
            .unwrap();
        assert_eq!(result.answers[0].answer, Answer::Refusal);
        assert_eq!(
            result.answers[1].answer,
            Answer::Predicate { probability: 0.7 }
        );
        task.abort();
        let (url, task) = server("openai", json!({"answers":[{"type":"refusal","name":"wrong"},{"type":"predicate","name":"second","probability":2}]})).await;
        assert!(
            provider(&config("openai", &url))
                .unwrap()
                .decide(&request())
                .await
                .is_err()
        );
        task.abort();
    }

    #[test]
    fn archived_provider_requires_a_valid_replacement() {
        let config = AppConfig {
            decision_providers: serde_json::from_value(json!({
                "provider": {
                    "old": {"archived": true},
                    "new": {"provider_kind": "openai", "model_name": "test-model"}
                },
                "replacement_providers": [{"old": "old", "new": "new"}]
            }))
            .unwrap(),
            ..Default::default()
        };
        assert!(provider(&config.decision_providers.provider["old"]).is_err());
        assert!(provider_by_id(&config, "old").is_ok());
        assert!(provider_by_id(&config, "missing").is_err());
    }

    #[test]
    fn validates_questions_and_probabilities() {
        let mut req = request();
        assert!(validate(&req).is_ok());
        req.questions[1].id = "first".into();
        assert!(validate(&req).is_err());
        req = request();
        if let QuestionKind::Choice { options } = &mut req.questions[0].kind {
            options[1].value = "a".into();
        }
        assert!(validate(&req).is_err());
        assert!(probability(&json!(1.1)).is_err());
        assert!(probability(&json!(-0.1)).is_err());
    }

    struct Stub;
    #[async_trait]
    impl DecisionProvider for Stub {
        async fn decide(&self, request: &DecisionRequest) -> Result<DecisionResponse> {
            validate(request)?;
            Ok(DecisionResponse {
                answers: request
                    .questions
                    .iter()
                    .map(|q| QuestionAnswer {
                        id: q.id.clone(),
                        answer: Answer::Predicate { probability: 0.7 },
                    })
                    .collect(),
                model: None,
                usage: None,
            })
        }
    }
    #[tokio::test]
    async fn single_question_delegates_to_batch() {
        let question = request().questions.remove(1);
        let result = Stub
            .decide_one(SingleDecisionRequest {
                input: DecisionInput::Text("data".into()),
                question,
            })
            .await
            .unwrap();
        assert_eq!(result.answer.id, "second");
        assert_eq!(result.answer.answer, Answer::Predicate { probability: 0.7 });
    }
}
