use super::*;
use serde_json::json;

pub struct OpenAi(pub DecisionProviderConfig);

#[async_trait]
impl DecisionProvider for OpenAi {
    async fn decide(&self, request: &DecisionRequest) -> Result<DecisionResponse> {
        validate(request)?;
        let model = self
            .0
            .model_name
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| eyre!("OpenAI decision provider requires model_name"))?;
        let input = match &request.input {
            DecisionInput::Text(s) => s.clone(),
            DecisionInput::Json(v) => serde_json::to_string(v)?,
        };
        let questions: Vec<Value> = request.questions.iter().map(|q| match &q.kind {
            QuestionKind::Predicate => json!({"type":"predicate", "name":q.id, "instructions":q.instructions}),
            QuestionKind::Choice { options } => json!({"type":"choice", "name":q.id, "instructions":q.instructions, "choices":options.iter().map(|o| {
                let mut v = json!({"value":o.value});
                if let Some(description) = &o.description { v["description"] = json!(description); }
                v
            }).collect::<Vec<_>>() }),
        }).collect();
        let body = json!({"model":model, "input":input, "questions":questions});
        let response = post(
            &self.0,
            self.0
                .base_url
                .as_deref()
                .unwrap_or("https://api.openai.com/v1"),
            "decisions",
            &body,
        )
        .await?;
        let answers = response["answers"]
            .as_array()
            .ok_or_else(|| eyre!("Missing decision answers"))?;
        if answers.len() != request.questions.len() {
            return Err(eyre!("Unexpected decision answer count"));
        }
        let mut result = Vec::with_capacity(answers.len());
        for (q, a) in request.questions.iter().zip(answers) {
            if a["name"].as_str() != Some(&q.id) {
                return Err(eyre!("Unexpected decision answer ID"));
            }
            let answer = match (a["type"].as_str(), &q.kind) {
                (Some("refusal"), _) => Answer::Refusal,
                (Some("predicate"), QuestionKind::Predicate) => Answer::Predicate {
                    probability: probability(&a["probability"])?,
                },
                (Some("choice"), QuestionKind::Choice { .. }) => {
                    let mut probabilities = BTreeMap::new();
                    for item in a["probabilities"]
                        .as_array()
                        .ok_or_else(|| eyre!("Missing choice probabilities"))?
                    {
                        let key = item["value"]
                            .as_str()
                            .ok_or_else(|| eyre!("Invalid choice probability value"))?
                            .to_owned();
                        if probabilities
                            .insert(key, probability(&item["probability"])?)
                            .is_some()
                        {
                            return Err(eyre!("Duplicate choice probability"));
                        }
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
