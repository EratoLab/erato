use std::collections::{BTreeMap, BTreeSet};

use facet::{Def, Facet, Field, Shape, StructType, Type, UserType};
use serde_json::{Map, Value};

use crate::config::AppConfig;

pub fn generate_config_reference() -> Value {
    let mut keys = BTreeSet::new();
    collect_paths(AppConfig::SHAPE, &mut Vec::new(), &mut keys);

    let entries = keys
        .into_iter()
        .map(|key| (key, Value::Object(Map::new())))
        .collect::<BTreeMap<_, _>>();

    serde_json::to_value(entries).expect("config reference is serializable")
}

fn collect_paths(shape: &'static Shape, path: &mut Vec<String>, keys: &mut BTreeSet<String>) {
    match &shape.def {
        Def::Option(option_def) => collect_paths(option_def.t, path, keys),
        Def::List(list_def) => {
            path.push("[]".to_string());
            collect_paths(list_def.t, path, keys);
            path.pop();
        }
        Def::Array(array_def) => {
            path.push("[]".to_string());
            collect_paths(array_def.t, path, keys);
            path.pop();
        }
        Def::Map(map_def) => {
            path.push(map_key_placeholder(path.last().map(String::as_str)));
            collect_paths(map_def.v, path, keys);
            path.pop();
        }
        Def::Set(set_def) => {
            path.push("[]".to_string());
            collect_paths(set_def.t, path, keys);
            path.pop();
        }
        Def::Pointer(pointer_def) => {
            if let Some(pointee) = pointer_def.pointee {
                collect_paths(pointee, path, keys);
            } else if !path.is_empty() {
                keys.insert(path.join("."));
            }
        }
        Def::DynamicValue(_) | Def::Scalar | Def::Undefined | Def::Slice(_) | Def::NdArray(_) => {
            collect_from_type(shape, path, keys);
        }
        Def::Result(result_def) => {
            collect_paths(result_def.t, path, keys);
            collect_paths(result_def.e, path, keys);
        }
        _ => {
            if let Some(inner) = shape.inner {
                collect_paths(inner, path, keys);
            } else {
                collect_from_type(shape, path, keys);
            }
        }
    }
}

fn collect_from_type(shape: &'static Shape, path: &mut Vec<String>, keys: &mut BTreeSet<String>) {
    if shape.type_identifier == "PromptSourceSpecification" {
        collect_prompt_source_specification(path, keys);
        return;
    }

    match shape.ty {
        Type::User(UserType::Struct(struct_type)) => {
            collect_struct_fields(&struct_type, path, keys)
        }
        Type::User(UserType::Enum(enum_type)) => {
            if shape.is_untagged() {
                for variant in enum_type.variants {
                    collect_struct_fields(&variant.data, path, keys);
                }
                return;
            }

            if let Some(tag) = shape.tag {
                path.push(tag.to_string());
                keys.insert(path.join("."));
                path.pop();
            }

            if let Some(content) = shape.content {
                path.push(content.to_string());
                keys.insert(path.join("."));
                path.pop();
            }

            for variant in enum_type.variants {
                collect_struct_fields(&variant.data, path, keys);
            }
        }
        _ => {
            if !path.is_empty() {
                keys.insert(path.join("."));
            }
        }
    }
}

fn collect_prompt_source_specification(path: &mut Vec<String>, keys: &mut BTreeSet<String>) {
    if path.is_empty() {
        return;
    }

    keys.insert(path.join("."));

    for segment in ["source", "prompt_name", "label", "prompt", "fallback"] {
        path.push(segment.to_string());
        keys.insert(path.join("."));
        path.pop();
    }
}

fn collect_struct_fields(
    struct_type: &StructType,
    path: &mut Vec<String>,
    keys: &mut BTreeSet<String>,
) {
    if struct_type.fields.is_empty() {
        if !path.is_empty() {
            keys.insert(path.join("."));
        }
        return;
    }

    for field in struct_type.fields {
        collect_field(field, path, keys);
    }
}

fn collect_field(field: &Field, path: &mut Vec<String>, keys: &mut BTreeSet<String>) {
    let field_shape = field.shape.get();

    if field.is_flattened() {
        collect_paths(field_shape, path, keys);
        return;
    }

    path.push(field.rename.unwrap_or(field.name).to_string());
    collect_paths(field_shape, path, keys);
    path.pop();
}

fn map_key_placeholder(parent_segment: Option<&str>) -> String {
    match parent_segment {
        Some("facets") => "<facet-id>".to_string(),
        Some("file_storage_providers") => "<provider-id>".to_string(),
        Some("localized_prompts") => "<locale>".to_string(),
        Some("mcp_servers") => "<server-id>".to_string(),
        Some("prompts") => "<prompt-id>".to_string(),
        Some("providers") => "<provider-id>".to_string(),
        Some("rules") => "<rule-name>".to_string(),
        _ => "<key>".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::generate_config_reference;

    #[test]
    fn emits_expected_example_paths() {
        let generated = generate_config_reference();
        let keys = generated
            .as_object()
            .expect("config reference is a flat object")
            .keys()
            .cloned()
            .collect::<Vec<_>>();

        assert!(keys.contains(&"chat_providers.providers.<provider-id>.model_name".to_string()));
        assert!(keys.contains(&"experimental_facets.facets.<facet-id>.display_name".to_string()));
        assert!(keys.contains(&"model_permissions.rules.<rule-name>.rule_type".to_string()));
        assert!(keys.contains(&"chat_providers.priority_order.[]".to_string()));
        assert!(keys.windows(2).all(|window| window[0] <= window[1]));
    }

    #[test]
    fn includes_both_scalar_and_object_prompt_forms() {
        let generated = generate_config_reference();
        let object = generated
            .as_object()
            .expect("config reference is a flat object");

        assert!(object.contains_key("prompt_optimizer.prompt"));
        assert!(object.contains_key("prompt_optimizer.prompt.source"));
        assert!(object.contains_key("prompt_optimizer.prompt.prompt_name"));
    }
}
