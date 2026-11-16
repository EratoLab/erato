//! Offline compilation of configured submission and result schemas. No HTTP or file references.

use serde_json::Value;

struct NoExternalReferences;

impl jsonschema::Retrieve for NoExternalReferences {
    fn retrieve(
        &self,
        _uri: &jsonschema::Uri<String>,
    ) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
        Err("Client tool schemas must use local references".into())
    }
}

pub fn compile(schema: &Value) -> Result<jsonschema::Validator, String> {
    if schema.get("type").and_then(Value::as_str) != Some("object") {
        return Err("Client tool schemas must have type = object".into());
    }
    jsonschema::options()
        .with_retriever(NoExternalReferences)
        .build(schema)
        .map_err(|error| error.to_string())
}

/// How an applicator reaches a child of the instance.
#[derive(Clone, PartialEq)]
enum Step {
    Key(String),
    AnyKey,
    Item,
}

impl Step {
    fn overlaps(&self, other: &Step) -> bool {
        match (self, other) {
            (Step::Item, Step::Item) => true,
            (Step::Item, _) | (_, Step::Item) => false,
            (Step::Key(a), Step::Key(b)) => a == b,
            _ => true,
        }
    }
}

fn pointer_token(key: &str) -> String {
    key.replace('~', "~0").replace('/', "~1")
}

/// The subschemas applied to the same instance as the one at `at`, and those
/// applied to a child of it.
fn edges(root: &Value, at: &str) -> (Vec<String>, Vec<(Step, String)>) {
    let (mut same, mut child) = (Vec::new(), Vec::new());
    let Some(Value::Object(schema)) = root.pointer(at) else {
        return (same, child);
    };
    if let Some(target) = schema
        .get("$ref")
        .and_then(Value::as_str)
        .and_then(|reference| reference.strip_prefix('#'))
        .filter(|target| target.is_empty() || target.starts_with('/'))
    {
        same.push(target.to_owned());
    }
    for keyword in ["allOf", "anyOf", "oneOf"] {
        if let Some(items) = schema.get(keyword).and_then(Value::as_array) {
            same.extend((0..items.len()).map(|index| format!("{at}/{keyword}/{index}")));
        }
    }
    for keyword in ["if", "then", "else", "not"] {
        if schema.contains_key(keyword) {
            same.push(format!("{at}/{keyword}"));
        }
    }
    let schemas = |keyword: &'static str| {
        schema
            .get(keyword)
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .filter(|(_, value)| value.is_object())
            .map(move |(key, _)| {
                (
                    key.clone(),
                    format!("{at}/{keyword}/{}", pointer_token(key)),
                )
            })
    };
    for keyword in ["dependentSchemas", "dependencies"] {
        same.extend(schemas(keyword).map(|(_, next)| next));
    }
    child.extend(schemas("properties").map(|(key, next)| (Step::Key(key), next)));
    child.extend(schemas("patternProperties").map(|(_, next)| (Step::AnyKey, next)));
    for keyword in ["additionalProperties", "unevaluatedProperties"] {
        if schema.get(keyword).is_some_and(Value::is_object) {
            child.push((Step::AnyKey, format!("{at}/{keyword}")));
        }
    }
    for keyword in [
        "items",
        "prefixItems",
        "additionalItems",
        "contains",
        "unevaluatedItems",
    ] {
        match schema.get(keyword) {
            Some(Value::Object(_)) => child.push((Step::Item, format!("{at}/{keyword}"))),
            Some(Value::Array(items)) => child.extend(
                (0..items.len()).map(|index| (Step::Item, format!("{at}/{keyword}/{index}"))),
            ),
            _ => {}
        }
    }
    (same, child)
}

fn reaches(root: &Value, from: &str, target: &str) -> bool {
    let mut seen = std::collections::HashSet::new();
    let mut stack = vec![from.to_owned()];
    while let Some(at) = stack.pop() {
        if at == target {
            return true;
        }
        if seen.insert(at.clone()) {
            let (same, child) = edges(root, &at);
            stack.extend(same);
            stack.extend(child.into_iter().map(|(_, next)| next));
        }
    }
    false
}

/// The steps to a child through which `alternative` leads back to `choice`.
fn steps_back(root: &Value, alternative: &str, choice: &str) -> Vec<Step> {
    let mut steps = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut stack = vec![alternative.to_owned()];
    while let Some(at) = stack.pop() {
        if at == choice || !seen.insert(at.clone()) {
            continue;
        }
        let (same, child) = edges(root, &at);
        stack.extend(same);
        for (step, next) in child {
            if !steps.contains(&step) && reaches(root, &next, choice) {
                steps.push(step);
            }
        }
    }
    steps
}

fn choices(value: &Value, at: String, found: &mut Vec<(String, &'static str, usize)>) {
    match value {
        Value::Object(object) => {
            for keyword in ["anyOf", "oneOf"] {
                if let Some(items) = object.get(keyword).and_then(Value::as_array) {
                    found.push((at.clone(), keyword, items.len()));
                }
            }
            for (key, child) in object {
                if !matches!(key.as_str(), "const" | "enum" | "default" | "examples") {
                    choices(child, format!("{at}/{}", pointer_token(key)), found);
                }
            }
        }
        Value::Array(items) => {
            for (index, child) in items.iter().enumerate() {
                choices(child, format!("{at}/{index}"), found);
            }
        }
        _ => {}
    }
}

/// The `anyOf`/`oneOf` choices two of whose alternatives lead back to the
/// choice through the same property, or both through items. A failed check
/// collects every alternative's errors, so such a choice repeats once per
/// alternative at every nesting level of the value. Only references within
/// the schema (`#` or `#/…`) are followed.
pub fn fanned_choices(schema: &Value) -> Vec<String> {
    let mut found = Vec::new();
    choices(schema, String::new(), &mut found);
    found
        .into_iter()
        .filter(|(at, keyword, len)| {
            let steps = (0..*len)
                .map(|index| steps_back(schema, &format!("{at}/{keyword}/{index}"), at))
                .collect::<Vec<_>>();
            steps.iter().enumerate().any(|(index, mine)| {
                steps[index + 1..]
                    .iter()
                    .any(|theirs| mine.iter().any(|a| theirs.iter().any(|b| a.overlaps(b))))
            })
        })
        .map(|(at, keyword, _)| format!("{at}/{keyword}"))
        .collect()
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

    /// A block choice whose alternatives each hold `children` of blocks.
    fn blocks(keyword: &str, recursive: &[bool]) -> Value {
        let alternatives = recursive
            .iter()
            .enumerate()
            .map(|(index, recursive)| {
                let mut properties = json!({"type":{"const":index}});
                if *recursive {
                    properties["children"] =
                        json!({"type":"array","items":{"$ref":"#/$defs/block"}});
                }
                json!({"type":"object","properties":properties,"additionalProperties":false})
            })
            .collect::<Vec<_>>();
        json!({"type":"object","properties":{"blocks":{"type":"array","items":{"$ref":"#/$defs/block"}}},
            "$defs":{"block":{ keyword: alternatives }}})
    }

    #[test]
    fn flags_alternatives_that_lead_back_through_the_same_property() {
        for keyword in ["anyOf", "oneOf"] {
            assert_eq!(
                fanned_choices(&blocks(keyword, &[true, true, true])),
                [format!("/$defs/block/{keyword}")]
            );
            assert!(fanned_choices(&blocks(keyword, &[false, true, false])).is_empty());
        }
        let node = |own: Value| {
            json!({"type":"object","properties":{"root":{"$ref":"#/$defs/node"}},
            "$defs":{"node":{"anyOf":[
                {"type":"object","properties":{"children":{"$ref":"#/$defs/node"}}},
                own
            ]}}})
        };
        let wildcard =
            node(json!({"type":"object","additionalProperties":{"$ref":"#/$defs/node"}}));
        assert_eq!(fanned_choices(&wildcard), ["/$defs/node/anyOf"]);
        let pattern =
            node(json!({"type":"object","patternProperties":{"^x":{"$ref":"#/$defs/node"}}}));
        assert_eq!(fanned_choices(&pattern), ["/$defs/node/anyOf"]);
        let elsewhere =
            node(json!({"type":"object","properties":{"rows":{"$ref":"#/$defs/node"}}}));
        assert!(fanned_choices(&elsewhere).is_empty());
        let items = json!({"type":"object","properties":{"root":{"$ref":"#/$defs/node"}},
        "$defs":{"node":{"anyOf":[
            {"type":"array","items":{"$ref":"#/$defs/node"}},
            {"type":"array","prefixItems":[{"type":"string"},{"$ref":"#/$defs/node"}]}
        ]}}});
        assert_eq!(fanned_choices(&items), ["/$defs/node/anyOf"]);
        let root = json!({"type":"object","anyOf":[
            {"type":"object","required":["a"],"properties":{"child":{"$ref":"#"}}},
            {"type":"object","required":["b"],"properties":{"child":{"allOf":[{"$ref":"#"}]}}}
        ]});
        assert_eq!(fanned_choices(&root), ["/anyOf"]);
    }
}
