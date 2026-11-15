//! Repairs one known slip of some models: an array or object argument sent as
//! a JSON string, e.g. a large `entries` list wrapped in quotes (ERMAIN-1194).
//!
//! A string is decoded only where no schema that can apply admits a string and
//! one admits the decoded value. Anything this walk cannot resolve (external
//! or dynamic references, conditionals, unmatched pattern properties, depth)
//! counts as admitting a string, so the argument stays as sent.

use serde_json::Value;

const MAX_DEPTH: usize = 64;
/// Schema nodes visited per candidate string; alternatives that refer back to
/// themselves would otherwise branch without end.
const MAX_SCHEMA_STEPS: usize = 4096;

static ANY_SCHEMA: Value = Value::Bool(true);

enum Segment {
    Key(String),
    Index(usize),
}

/// The JSON types a schema position admits, from `type`, `const`, `enum` and
/// the applicators. Only the three that matter here are tracked.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Admits {
    string: bool,
    array: bool,
    object: bool,
}

impl Admits {
    const ANY: Self = Self {
        string: true,
        array: true,
        object: true,
    };
    const NONE: Self = Self {
        string: false,
        array: false,
        object: false,
    };
    /// Neither decodes in a conjunction nor in an alternative.
    const UNKNOWN: Self = Self {
        string: true,
        array: false,
        object: false,
    };

    fn of_type(name: &str) -> Self {
        Self {
            string: name == "string",
            array: name == "array",
            object: name == "object",
        }
    }

    fn of_value(value: &Value) -> Self {
        Self {
            string: value.is_string(),
            array: value.is_array(),
            object: value.is_object(),
        }
    }

    fn and(self, other: Self) -> Self {
        Self {
            string: self.string && other.string,
            array: self.array && other.array,
            object: self.object && other.object,
        }
    }

    fn or(self, other: Self) -> Self {
        Self {
            string: self.string || other.string,
            array: self.array || other.array,
            object: self.object || other.object,
        }
    }
}

/// Decodes stringified arrays and objects in `input` in place and returns the
/// JSON Pointers of the decoded values.
pub fn decode(schema: &Value, input: &mut Value) -> Vec<String> {
    let mut decoded = Vec::new();
    walk(schema, input, &mut Vec::new(), &mut decoded);
    decoded
}

fn walk(root: &Value, value: &mut Value, path: &mut Vec<Segment>, decoded: &mut Vec<String>) {
    if path.len() > MAX_DEPTH {
        return;
    }
    match value {
        Value::String(text) => {
            if !text.trim_start().starts_with(['[', '{']) {
                return;
            }
            let mut steps = MAX_SCHEMA_STEPS;
            let admits = admits_at(root, root, path, 0, &mut steps);
            if admits.string || !(admits.array || admits.object) {
                return;
            }
            let Ok(parsed) = serde_json::from_str::<Value>(text) else {
                return;
            };
            if !(parsed.is_array() && admits.array || parsed.is_object() && admits.object) {
                return;
            }
            *value = parsed;
            decoded.push(pointer(path));
            walk(root, value, path, decoded);
        }
        Value::Array(items) => {
            for (index, item) in items.iter_mut().enumerate() {
                path.push(Segment::Index(index));
                walk(root, item, path, decoded);
                path.pop();
            }
        }
        Value::Object(fields) => {
            for (key, item) in fields.iter_mut() {
                path.push(Segment::Key(key.clone()));
                walk(root, item, path, decoded);
                path.pop();
            }
        }
        _ => {}
    }
}

/// What `schema` admits at `path` below the instance it applies to: every
/// conjunct (own keywords, `$ref`, `allOf`) must admit a type, and one
/// alternative of each `anyOf`/`oneOf` must.
fn admits_at(
    root: &Value,
    schema: &Value,
    path: &[Segment],
    depth: usize,
    steps: &mut usize,
) -> Admits {
    if depth > MAX_DEPTH || *steps == 0 {
        return Admits::UNKNOWN;
    }
    *steps -= 1;
    let object = match schema {
        Value::Bool(true) => return Admits::ANY,
        Value::Bool(false) => return Admits::NONE,
        Value::Object(object) => object,
        _ => return Admits::UNKNOWN,
    };
    if ["if", "dependentSchemas", "$dynamicRef", "$recursiveRef"]
        .iter()
        .any(|keyword| object.contains_key(*keyword))
    {
        return Admits::UNKNOWN;
    }
    let own = own_types(object);
    let mut admits = match path.split_first() {
        None => own,
        Some((segment, rest)) => {
            let container = match segment {
                Segment::Key(_) => own.object,
                Segment::Index(_) => own.array,
            };
            if !container {
                return Admits::NONE;
            }
            match child(object, segment) {
                Some(child) => admits_at(root, child, rest, depth + 1, steps),
                None => Admits::UNKNOWN,
            }
        }
    };
    if let Some(reference) = object.get("$ref") {
        admits = admits.and(resolve(root, reference).map_or(Admits::UNKNOWN, |target| {
            admits_at(root, target, path, depth + 1, steps)
        }));
    }
    if let Some(Value::Array(all)) = object.get("allOf") {
        for schema in all {
            admits = admits.and(admits_at(root, schema, path, depth + 1, steps));
        }
    }
    for keyword in ["anyOf", "oneOf"] {
        if let Some(Value::Array(choices)) = object.get(keyword) {
            admits = admits.and(
                choices
                    .iter()
                    .map(|schema| admits_at(root, schema, path, depth + 1, steps))
                    .fold(Admits::NONE, Admits::or),
            );
        }
    }
    admits
}

fn own_types(object: &serde_json::Map<String, Value>) -> Admits {
    let mut admits = match object.get("type") {
        None => Admits::ANY,
        Some(Value::String(name)) => Admits::of_type(name),
        Some(Value::Array(names)) => names
            .iter()
            .filter_map(Value::as_str)
            .map(Admits::of_type)
            .fold(Admits::NONE, Admits::or),
        Some(_) => Admits::UNKNOWN,
    };
    if let Some(value) = object.get("const") {
        admits = admits.and(Admits::of_value(value));
    }
    if let Some(Value::Array(values)) = object.get("enum") {
        admits = admits.and(
            values
                .iter()
                .map(Admits::of_value)
                .fold(Admits::NONE, Admits::or),
        );
    }
    admits
}

/// The schema a child position gets from this schema's own keywords; `None`
/// when that depends on something this walk does not evaluate.
fn child<'a>(object: &'a serde_json::Map<String, Value>, segment: &Segment) -> Option<&'a Value> {
    match segment {
        Segment::Key(key) => {
            if let Some(property) = object
                .get("properties")
                .and_then(Value::as_object)
                .and_then(|properties| properties.get(key))
            {
                return Some(property);
            }
            if object.contains_key("patternProperties") {
                return None;
            }
            Some(object.get("additionalProperties").unwrap_or(&ANY_SCHEMA))
        }
        Segment::Index(index) => {
            let prefix = object.get("prefixItems").and_then(Value::as_array);
            if let Some(item) = prefix.and_then(|prefix| prefix.get(*index)) {
                return Some(item);
            }
            match object.get("items") {
                Some(Value::Array(tuple)) => tuple
                    .get(*index)
                    .or_else(|| Some(object.get("additionalItems").unwrap_or(&ANY_SCHEMA))),
                Some(items) => Some(items),
                None => Some(&ANY_SCHEMA),
            }
        }
    }
}

fn resolve<'a>(root: &'a Value, reference: &Value) -> Option<&'a Value> {
    root.pointer(reference.as_str()?.strip_prefix('#')?)
}

fn pointer(path: &[Segment]) -> String {
    path.iter()
        .map(|segment| match segment {
            Segment::Key(key) => format!("/{}", key.replace('~', "~0").replace('/', "~1")),
            Segment::Index(index) => format!("/{index}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// The shape of the Word plan tool: alternatives at the root, closed
    /// objects, and recursion through `$defs`.
    fn plan_schema() -> Value {
        json!({
            "type": "object",
            "anyOf": [
                {
                    "type": "object",
                    "properties": {
                        "snapshot": {"type": "string"},
                        "entries": {"type": "array", "items": {"$ref": "#/$defs/entry"}}
                    },
                    "required": ["snapshot", "entries"],
                    "additionalProperties": false
                },
                {
                    "type": "object",
                    "properties": {
                        "snapshot": {"type": "string"},
                        "scoped_edit": {"type": "object"}
                    },
                    "required": ["snapshot", "scoped_edit"],
                    "additionalProperties": false
                }
            ],
            "$defs": {
                "entry": {
                    "anyOf": [
                        {
                            "type": "object",
                            "properties": {
                                "kind": {"type": "string", "const": "keep"},
                                "source": {"type": "array", "items": {"type": "string"}}
                            },
                            "additionalProperties": false
                        },
                        {
                            "type": "object",
                            "properties": {
                                "kind": {"type": "string", "const": "insert"},
                                "blocks": {"type": "array", "items": {"$ref": "#/$defs/block"}}
                            },
                            "additionalProperties": false
                        }
                    ]
                },
                "block": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "text": {"type": "string"},
                        "control": {
                            "type": "object",
                            "properties": {
                                "children": {"type": "array", "items": {"$ref": "#/$defs/block"}}
                            }
                        }
                    },
                    "additionalProperties": false
                }
            }
        })
    }

    fn entries() -> Value {
        json!([
            {"kind": "keep", "source": ["b1", "b2"]},
            {"kind": "insert", "blocks": [{"text": "[not, json]"}, {"text": "{\"a\":1}"}]}
        ])
    }

    #[test]
    fn decodes_a_stringified_entries_list_and_leaves_strings_alone() {
        let schema = plan_schema();
        let validator = jsonschema::validator_for(&schema).unwrap();
        let mut input = json!({"snapshot": "s1", "entries": entries().to_string()});
        assert!(!validator.is_valid(&input));
        assert_eq!(decode(&schema, &mut input), vec!["/entries".to_string()]);
        assert_eq!(input, json!({"snapshot": "s1", "entries": entries()}));
        assert!(validator.is_valid(&input));
        // A text that happens to be JSON is still text.
        assert_eq!(input["entries"][1]["blocks"][1]["text"], "{\"a\":1}");
    }

    #[test]
    fn decodes_nested_positions_through_references() {
        let schema = plan_schema();
        let blocks = json!([{"id": "c1", "text": "Nested"}]);
        let mut input = json!({"snapshot": "s1", "entries": [
            {"kind": "keep", "source": "[\"b1\"]"},
            {"kind": "insert", "blocks": [{"control": {"children": blocks.to_string()}}]}
        ]});
        assert_eq!(
            decode(&schema, &mut input),
            vec![
                "/entries/0/source".to_string(),
                "/entries/1/blocks/0/control/children".to_string()
            ]
        );
        assert_eq!(input["entries"][0]["source"], json!(["b1"]));
        assert_eq!(
            input["entries"][1]["blocks"][0]["control"]["children"],
            blocks
        );
    }

    #[test]
    fn keeps_a_string_where_the_schema_admits_one_or_the_text_does_not_fit() {
        let schema = plan_schema();
        for mut input in [
            // The snapshot is a string in every alternative.
            json!({"snapshot": "[\"b1\"]", "entries": []}),
            // Not JSON, or JSON of the wrong type, or trailing text.
            json!({"snapshot": "s1", "entries": "[{\"kind\":\"keep\""}),
            json!({"snapshot": "s1", "entries": "{\"kind\":\"keep\"}"}),
            json!({"snapshot": "s1", "entries": "[] and more"}),
            // A position no alternative defines.
            json!({"snapshot": "s1", "entries": [], "extra": "[1]"}),
        ] {
            let before = input.clone();
            assert!(decode(&schema, &mut input).is_empty(), "{before}");
            assert_eq!(input, before);
        }
    }

    #[test]
    fn an_alternative_that_admits_a_string_keeps_it() {
        for schema in [
            json!({"type": "object", "properties": {"value": {"anyOf": [
                {"type": "array"}, {"type": "string"}
            ]}}}),
            json!({"type": "object", "properties": {"value": {"type": ["array", "string"]}}}),
            // An open object admits anything under an undeclared key.
            json!({"type": "object", "anyOf": [
                {"properties": {"value": {"type": "array"}}, "additionalProperties": false},
                {"properties": {"other": {"type": "string"}}}
            ]}),
            // Conditionals and unmatched patterns are not evaluated.
            json!({"type": "object", "properties": {"value": {
                "if": {"type": "array"}, "then": {"type": "array"}, "else": {"type": "array"}
            }}}),
            json!({"type": "object", "patternProperties": {"^v": {"type": "array"}}}),
            json!({"type": "object", "properties": {"value": {"$ref": "https://example.com/s"}}}),
        ] {
            let mut input = json!({"value": "[1, 2]"});
            assert!(decode(&schema, &mut input).is_empty(), "{schema}");
            assert_eq!(input["value"], "[1, 2]");
        }
    }

    #[test]
    fn conjunctions_must_all_admit_the_decoded_value() {
        let schema = json!({"type": "object", "properties": {"value": {"allOf": [
            {"type": "array"}, {"type": ["array", "object"]}
        ]}}});
        let mut input = json!({"value": "[1]", "other": "[2]"});
        assert_eq!(decode(&schema, &mut input), vec!["/value".to_string()]);
        assert_eq!(input, json!({"value": [1], "other": "[2]"}));

        let schema = json!({"type": "object", "properties": {"value": {"allOf": [
            {"type": "array"}, {"type": "object"}
        ]}}});
        let mut input = json!({"value": "[1]"});
        assert!(decode(&schema, &mut input).is_empty());
    }

    #[test]
    fn self_references_end_without_decoding() {
        for schema in [
            json!({"$ref": "#", "type": "object", "properties": {"value": {"$ref": "#/$defs/loop"}},
                "$defs": {"loop": {"$ref": "#/$defs/loop"}}}),
            json!({"type": "object", "properties": {"value": {"$ref": "#/$defs/fork"}},
                "$defs": {"fork": {"anyOf": [{"$ref": "#/$defs/fork"}, {"$ref": "#/$defs/fork"}]}}}),
        ] {
            let mut input = json!({"value": "[1]"});
            assert!(decode(&schema, &mut input).is_empty(), "{schema}");
        }
    }

    #[test]
    fn pointers_escape_keys() {
        let schema = json!({"type": "object", "properties": {"a/b~c": {"type": "object"}}});
        let mut input = json!({"a/b~c": "{\"x\": 1}"});
        assert_eq!(decode(&schema, &mut input), vec!["/a~1b~0c".to_string()]);
        assert_eq!(input["a/b~c"], json!({"x": 1}));
    }
}
