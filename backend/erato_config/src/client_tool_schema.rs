//! Offline compilation of configured submission schemas. No HTTP or file references.

use serde_json::Value;

struct NoExternalReferences;

impl jsonschema::Retrieve for NoExternalReferences {
    fn retrieve(
        &self,
        _uri: &jsonschema::Uri<String>,
    ) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
        Err("Submission schemas must use local references".into())
    }
}

pub fn compile(schema: &Value) -> Result<jsonschema::Validator, String> {
    if schema.get("type").and_then(Value::as_str) != Some("object") {
        return Err("Submission parameters must have type = object".into());
    }
    jsonschema::options()
        .with_retriever(NoExternalReferences)
        .build(schema)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn accepts_local_references_and_rejects_external_resolution() {
        let local = json!({"type":"object", "properties":{"item":{"$ref":"#/$defs/item"}},
            "$defs":{"item":{"type":"string"}}});
        assert!(compile(&local).unwrap().is_valid(&json!({"item":"ok"})));
        for reference in ["https://example.com/schema", "file:///tmp/schema.json"] {
            let schema = json!({"type":"object","properties":{"item":{"$ref":reference}}});
            assert!(compile(&schema).is_err());
        }
        assert!(compile(&json!({"type":"array"})).is_err());
        assert!(
            compile(&json!({"type":"object","properties":{"item":{"type":"made-up"}}})).is_err()
        );
    }
}
