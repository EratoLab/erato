//! The only native operation offered to a delegated child. No generated code,
//! general Office action, arbitrary RPC method or private intermediate result.
use super::contract;
use genai::chat::Tool;
use serde_json::{Value, json};

pub const NAME: &str = "local_collect_evidence";
pub const NAMESPACE: &str = "local";
pub const QUALIFIED_NAME: &str = "collect_evidence";
pub fn build(omit_strict: bool) -> Tool {
    Tool{name:NAME.into(),description:Some("Collect a bounded package of local evidence using deterministic search queries. The task pauses durably until the user reviews an exact snapshot in the native app. Only selected, approved evidence returns. Do not request private intermediate hits, general Office actions, scripts or code.".into()),schema:Some(json!({"type":"object","properties":{"queryVariants":{"type":"array","minItems":1,"maxItems":8,"uniqueItems":true,"items":{"type":"string","minLength":1,"maxLength":512}}},"required":["queryVariants"],"additionalProperties":false})),strict:(!omit_strict).then_some(false),config:None}
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
