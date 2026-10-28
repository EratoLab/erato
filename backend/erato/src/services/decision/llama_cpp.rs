use super::*;
use serde_json::{Map, json};

pub struct LlamaCpp(pub DecisionProviderConfig);

#[async_trait]
impl DecisionProvider for LlamaCpp {
    async fn decide(&self, request: &DecisionRequest) -> Result<DecisionResponse> {
        validate(request)?;
        let base = self
            .0
            .base_url
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| eyre!("llama.cpp decision provider requires base_url"))?;
        let state = match &request.input {
            DecisionInput::Text(s) => json!(s),
            DecisionInput::Json(v @ (Value::Object(_) | Value::Array(_))) => v.clone(),
            // System One only accepts strings, objects, and arrays as state.
            DecisionInput::Json(v) => json!(serde_json::to_string(v)?),
        };
        let mut questions = Map::new();
        for q in &request.questions {
            let value = match &q.kind {
                QuestionKind::Predicate => json!({"type":"noul", "instructions":q.instructions}),
                QuestionKind::Choice { options } => {
                    let criteria: Map<String, Value> = options
                        .iter()
                        .map(|o| (o.value.clone(), json!(o.description)))
                        .collect();
                    json!({"type":"choice", "instructions":q.instructions, "criteria":criteria})
                }
            };
            questions.insert(q.id.clone(), value);
        }
        let response = post(
            &self.0,
            base,
            "systemone",
            &json!({"state":state,"questions":questions}),
        )
        .await?;
        let answers = response["answers"]
            .as_object()
            .ok_or_else(|| eyre!("Missing decision answers"))?;
        if answers.len() != request.questions.len() {
            return Err(eyre!("Unexpected decision answer count"));
        }
        let mut result = Vec::with_capacity(answers.len());
        for q in &request.questions {
            let a = answers
                .get(&q.id)
                .ok_or_else(|| eyre!("Missing decision answer ID"))?;
            let answer = match (a["type"].as_str(), &q.kind) {
                (Some("noul"), QuestionKind::Predicate) => Answer::Predicate {
                    probability: probability(&a["noul"])?,
                },
                (Some("choice"), QuestionKind::Choice { .. }) => {
                    let mut probabilities = BTreeMap::new();
                    for (key, value) in a["probabilities"]
                        .as_object()
                        .ok_or_else(|| eyre!("Missing choice probabilities"))?
                    {
                        probabilities.insert(key.clone(), probability(value)?);
                    }
                    choice_answer(q, &a["choice"], probabilities, &a["confidence"])?
                }
                _ => return Err(eyre!("Unexpected decision answer type")),
            };
            result.push(QuestionAnswer {
                id: q.id.clone(),
                answer,
            });
        }
        Ok(DecisionResponse {
            answers: result,
            model: response["model"].as_str().map(str::to_owned),
            usage: response.get("usage").filter(|v| !v.is_null()).cloned(),
        })
    }
}
