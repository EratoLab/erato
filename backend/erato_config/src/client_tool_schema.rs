//! Offline compilation of configured submission and result schemas. No HTTP or file references.

use std::collections::{HashMap, HashSet, VecDeque};

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

/// Escapes an object key for use as one JSON Pointer segment.
pub fn pointer_token(key: &str) -> String {
    key.replace('~', "~0").replace('/', "~1")
}

/// Follows `#` and `#/…` references into `root` only; anything else, such as
/// an anchor or a `$id` URI, is not followed.
pub fn resolve_local<'s>(root: &'s Value, reference: &str) -> Option<&'s Value> {
    root.pointer(reference.strip_prefix('#')?)
}

/// How an applicator reaches a child of the instance.
#[derive(Clone, PartialEq)]
enum Step {
    Key(String),
    /// Any key but the listed ones, as `additionalProperties` next to
    /// `properties`.
    OtherKey(Vec<String>),
    AnyKey,
    Item,
}

impl Step {
    fn overlaps(&self, other: &Step) -> bool {
        match (self, other) {
            (Step::Item, Step::Item) => true,
            (Step::Item, _) | (_, Step::Item) => false,
            (Step::Key(a), Step::Key(b)) => a == b,
            (Step::Key(key), Step::OtherKey(except)) | (Step::OtherKey(except), Step::Key(key)) => {
                !except.contains(key)
            }
            _ => true,
        }
    }
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
    let named = schema
        .get("properties")
        .and_then(Value::as_object)
        .map(|properties| properties.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    for keyword in ["additionalProperties", "unevaluatedProperties"] {
        if schema.get(keyword).is_some_and(Value::is_object) {
            child.push((Step::OtherKey(named.clone()), format!("{at}/{keyword}")));
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

/// Counts, saturating at 2, the ways a check of the schema at `at` reaches
/// each subschema applied to the same instance. A cycle without a child step
/// is not followed.
fn count_same_instance(
    root: &Value,
    at: &str,
    counts: &mut HashMap<String, u8>,
    on_path: &mut HashSet<String>,
) {
    if on_path.contains(at) {
        return;
    }
    let count = counts.entry(at.to_owned()).or_default();
    if *count == 2 {
        return;
    }
    *count += 1;
    on_path.insert(at.to_owned());
    for next in edges(root, at).0 {
        count_same_instance(root, &next, counts, on_path);
    }
    on_path.remove(at);
}

struct Transition {
    step: Step,
    to: String,
    /// Reached through more than one subschema applied to the same instance.
    twice: bool,
}

/// The child steps a check of the schema at `at` takes, through everything
/// it applies to the same instance.
fn transitions(root: &Value, at: &str) -> Vec<Transition> {
    let mut counts = HashMap::new();
    count_same_instance(root, at, &mut counts, &mut HashSet::new());
    let mut found = Vec::new();
    for (location, count) in counts {
        for (step, to) in edges(root, &location).1 {
            found.push(Transition {
                step,
                to,
                twice: count > 1,
            });
        }
    }
    found
}

/// The place a failed check would reach more than once for the same value at
/// every nesting level of the value, as a `$ref` such as `#/$defs/block`. A
/// failed check collects the errors of every alternative and every keyword,
/// so two parts of the schema that lead back to the same subschema through
/// the same property make it grow exponentially with the depth. Only
/// references within the schema (`#` or `#/…`) are followed.
pub fn doubled_recursion(schema: &Value) -> Option<String> {
    let mut automaton = HashMap::new();
    let mut pending = vec![String::new()];
    while let Some(at) = pending.pop() {
        if automaton.contains_key(&at) {
            continue;
        }
        let out = transitions(schema, &at);
        pending.extend(out.iter().map(|transition| transition.to.clone()));
        automaton.insert(at, out);
    }
    let mut predecessors: HashMap<&str, Vec<&str>> = HashMap::new();
    for (from, out) in &automaton {
        for transition in out {
            predecessors
                .entry(transition.to.as_str())
                .or_default()
                .push(from.as_str());
        }
    }
    let mut starts = automaton.keys().map(String::as_str).collect::<Vec<_>>();
    starts.sort_unstable();
    for start in starts {
        let mut back = HashSet::from([start]);
        let mut pending = vec![start];
        while let Some(at) = pending.pop() {
            for &from in predecessors.get(at).into_iter().flatten() {
                if back.insert(from) {
                    pending.push(from);
                }
            }
        }
        if !automaton[start]
            .iter()
            .any(|transition| back.contains(transition.to.as_str()))
        {
            continue;
        }
        // Two checks of the same value, walking the same child steps: they
        // part where they take different subschemas.
        let mut seen = HashSet::new();
        let mut queue = VecDeque::from([(start, start, None::<&str>)]);
        while let Some((first, second, parted)) = queue.pop_front() {
            if parted.is_some() && first == start && second == start {
                return parted.map(|at| reference_name(schema, at));
            }
            if !seen.insert((first, second, parted.is_some())) {
                continue;
            }
            for (i, one) in automaton[first].iter().enumerate() {
                for (j, other) in automaton[second].iter().enumerate() {
                    if !one.step.overlaps(&other.step)
                        || !back.contains(one.to.as_str())
                        || !back.contains(other.to.as_str())
                    {
                        continue;
                    }
                    let parted =
                        parted.or((first == second && (i != j || one.twice)).then_some(first));
                    queue.push_back((one.to.as_str(), other.to.as_str(), parted));
                }
            }
        }
    }
    None
}

/// `at` as a reference, or what its `$ref` points to.
fn reference_name(root: &Value, at: &str) -> String {
    let target = root
        .pointer(at)
        .and_then(|schema| schema.get("$ref"))
        .and_then(Value::as_str)
        .filter(|reference| resolve_local(root, reference).is_some());
    target.map_or_else(|| format!("#{at}"), str::to_owned)
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
    fn refuses_alternatives_that_lead_back_through_the_same_property() {
        for keyword in ["anyOf", "oneOf"] {
            assert_eq!(
                doubled_recursion(&blocks(keyword, &[true, true, true])).as_deref(),
                Some("#/$defs/block")
            );
            assert_eq!(
                doubled_recursion(&blocks(keyword, &[false, true, false])),
                None
            );
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
        assert_eq!(
            doubled_recursion(&wildcard).as_deref(),
            Some("#/$defs/node")
        );
        let pattern =
            node(json!({"type":"object","patternProperties":{"^x":{"$ref":"#/$defs/node"}}}));
        assert_eq!(doubled_recursion(&pattern).as_deref(), Some("#/$defs/node"));
        let elsewhere =
            node(json!({"type":"object","properties":{"rows":{"$ref":"#/$defs/node"}}}));
        assert_eq!(doubled_recursion(&elsewhere), None);
        let items = json!({"type":"object","properties":{"root":{"$ref":"#/$defs/node"}},
        "$defs":{"node":{"anyOf":[
            {"type":"array","items":{"$ref":"#/$defs/node"}},
            {"type":"array","prefixItems":[{"type":"string"},{"$ref":"#/$defs/node"}]}
        ]}}});
        assert_eq!(doubled_recursion(&items).as_deref(), Some("#/$defs/node"));
        let root = json!({"type":"object","anyOf":[
            {"type":"object","required":["a"],"properties":{"child":{"$ref":"#"}}},
            {"type":"object","required":["b"],"properties":{"child":{"allOf":[{"$ref":"#"}]}}}
        ]});
        assert_eq!(doubled_recursion(&root).as_deref(), Some("#"));
    }

    #[test]
    fn refuses_an_alternative_and_a_keyword_beside_the_choice_that_lead_back_alike() {
        let children = json!({"type":"array","items":{"$ref":"#/$defs/node"}});
        let beside = json!({"type":"object","properties":{"root":{"$ref":"#/$defs/node"}},
        "$defs":{"node":{"type":"object",
            "properties":{"type":{"type":"string"},"children":children},
            "anyOf":[
                {"properties":{"type":{"const":"list"},"children":children}},
                {"properties":{"type":{"const":"para"}}}
            ]}}});
        assert_eq!(doubled_recursion(&beside).as_deref(), Some("#/$defs/node"));
        let named_once = json!({"type":"object","properties":{"root":{"$ref":"#/$defs/node"}},
        "$defs":{"node":{"type":"object",
            "properties":{"type":{"type":"string"},"children":children},
            "anyOf":[
                {"properties":{"type":{"const":"list"},"children":true}},
                {"properties":{"type":{"const":"para"}}}
            ]}}});
        assert_eq!(doubled_recursion(&named_once), None);
        let all_of = json!({"type":"object","properties":{"root":{"$ref":"#/$defs/node"}},
        "$defs":{
            "node":{"allOf":[{"$ref":"#/$defs/list"},{"$ref":"#/$defs/tree"}]},
            "list":{"properties":{"children":children}},
            "tree":{"properties":{"children":children}}
        }});
        assert_eq!(doubled_recursion(&all_of).as_deref(), Some("#/$defs/node"));
    }

    #[test]
    fn accepts_recursion_that_parts_on_the_way_back() {
        let node = json!({"$ref":"#/$defs/node"});
        let schema = json!({"type":"object","properties":{"root":node},
        "$defs":{"node":{"anyOf":[
            {"type":"object","properties":{"x":{"type":"object","properties":{"y":node}}}},
            {"type":"object","properties":{"x":{"type":"object","properties":{"z":node}}}}
        ]}}});
        assert_eq!(doubled_recursion(&schema), None);
        let rejoined = json!({"type":"object","properties":{"root":node},
        "$defs":{"node":{"anyOf":[
            {"type":"object","properties":{"x":{"type":"object","properties":{"y":node}}}},
            {"type":"object","properties":{"x":{"type":"object","additionalProperties":node}}}
        ]}}});
        assert_eq!(
            doubled_recursion(&rejoined).as_deref(),
            Some("#/$defs/node")
        );
    }

    #[test]
    fn checks_a_choice_under_a_property_named_like_a_keyword() {
        let next = json!({"$ref":"#/properties/default"});
        let schema = json!({"type":"object","properties":{"default":{"anyOf":[
            {"type":"object","properties":{"next":next}},
            {"type":"object","properties":{"next":next}}
        ]}}});
        assert_eq!(
            doubled_recursion(&schema).as_deref(),
            Some("#/properties/default")
        );
    }
}
