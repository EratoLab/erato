use std::collections::BTreeMap;

use eyre::{Result, eyre};
use facet::{Def, Facet, Field, Shape, StructType, Type, UserType};
use serde_json::{Map, Value, json};

use crate::config::AppConfig;
use crate::config_facet_attrs;

pub fn generate_config_reference() -> Value {
    let mut entries = BTreeMap::new();
    collect_paths(AppConfig::SHAPE, &mut Vec::new(), &mut entries);

    serde_json::to_value(entries).expect("config reference is serializable")
}

pub fn validate_config_reference(reference: &Value) -> Result<()> {
    let object = reference
        .as_object()
        .ok_or_else(|| eyre!("config reference must be a JSON object"))?;

    for (key, entry) in object {
        let replacement_key = entry
            .get("deprecated")
            .and_then(Value::as_object)
            .and_then(|deprecated| deprecated.get("replacement_key"))
            .and_then(Value::as_str);

        if let Some(replacement_key) = replacement_key
            && !object.contains_key(replacement_key)
        {
            return Err(eyre!(
                "Config key '{}' declares replacement_key '{}' but that key is not present in the generated config reference",
                key,
                replacement_key
            ));
        }
    }

    Ok(())
}

fn collect_paths(
    shape: &'static Shape,
    path: &mut Vec<String>,
    entries: &mut BTreeMap<String, Value>,
) {
    match &shape.def {
        Def::Option(option_def) => collect_paths(option_def.t, path, entries),
        Def::List(list_def) => {
            path.push("[]".to_string());
            collect_paths(list_def.t, path, entries);
            path.pop();
        }
        Def::Array(array_def) => {
            path.push("[]".to_string());
            collect_paths(array_def.t, path, entries);
            path.pop();
        }
        Def::Map(map_def) => {
            path.push(map_key_placeholder(path.last().map(String::as_str)));
            collect_paths(map_def.v, path, entries);
            path.pop();
        }
        Def::Set(set_def) => {
            path.push("[]".to_string());
            collect_paths(set_def.t, path, entries);
            path.pop();
        }
        Def::Pointer(pointer_def) => {
            if let Some(pointee) = pointer_def.pointee {
                collect_paths(pointee, path, entries);
            } else if !path.is_empty() {
                ensure_entry(entries, path.join("."));
            }
        }
        Def::DynamicValue(_) | Def::Scalar | Def::Undefined | Def::Slice(_) | Def::NdArray(_) => {
            collect_from_type(shape, path, entries);
        }
        Def::Result(result_def) => {
            collect_paths(result_def.t, path, entries);
            collect_paths(result_def.e, path, entries);
        }
        _ => {
            if let Some(inner) = shape.inner {
                collect_paths(inner, path, entries);
            } else {
                collect_from_type(shape, path, entries);
            }
        }
    }
}

fn collect_from_type(
    shape: &'static Shape,
    path: &mut Vec<String>,
    entries: &mut BTreeMap<String, Value>,
) {
    if shape.type_identifier == "PromptSourceSpecification" {
        collect_prompt_source_specification(path, entries);
        return;
    }

    match shape.ty {
        Type::User(UserType::Struct(struct_type)) => {
            collect_struct_fields(&struct_type, path, entries)
        }
        Type::User(UserType::Enum(enum_type)) => {
            if shape.is_untagged() {
                for variant in enum_type.variants {
                    collect_struct_fields(&variant.data, path, entries);
                }
                return;
            }

            if let Some(tag) = shape.tag {
                path.push(tag.to_string());
                ensure_entry(entries, path.join("."));
                path.pop();
            }

            if let Some(content) = shape.content {
                path.push(content.to_string());
                ensure_entry(entries, path.join("."));
                path.pop();
            }

            for variant in enum_type.variants {
                collect_struct_fields(&variant.data, path, entries);
            }
        }
        _ => {
            if !path.is_empty() {
                ensure_entry(entries, path.join("."));
            }
        }
    }
}

fn collect_prompt_source_specification(
    path: &mut Vec<String>,
    entries: &mut BTreeMap<String, Value>,
) {
    if path.is_empty() {
        return;
    }

    ensure_entry(entries, path.join("."));

    for segment in ["source", "prompt_name", "label", "prompt", "fallback"] {
        path.push(segment.to_string());
        ensure_entry(entries, path.join("."));
        path.pop();
    }
}

fn collect_struct_fields(
    struct_type: &StructType,
    path: &mut Vec<String>,
    entries: &mut BTreeMap<String, Value>,
) {
    if struct_type.fields.is_empty() {
        if !path.is_empty() {
            ensure_entry(entries, path.join("."));
        }
        return;
    }

    for field in struct_type.fields {
        collect_field(field, path, entries);
    }
}

fn collect_field(field: &Field, path: &mut Vec<String>, entries: &mut BTreeMap<String, Value>) {
    let field_shape = field.shape.get();

    if field.is_flattened() {
        collect_paths(field_shape, path, entries);
        return;
    }

    path.push(field.rename.unwrap_or(field.name).to_string());
    collect_paths(field_shape, path, entries);
    apply_field_metadata(field, path, entries);
    path.pop();
}

fn apply_field_metadata(field: &Field, path: &[String], entries: &mut BTreeMap<String, Value>) {
    let key = path.join(".");
    let mut has_deprecation = None;
    let mut should_hide = false;
    let mut needs_scoped_replacement_flag = false;

    if let Some(attr) = field.get_attr(Some("erato"), "deprecated")
        && let Some(config_facet_attrs::Attr::Deprecated(deprecated)) =
            attr.get_as::<config_facet_attrs::Attr>()
    {
        let mut deprecated_entry = Map::new();
        deprecated_entry.insert(
            "note".to_string(),
            Value::String(deprecated.note.to_string()),
        );
        if let Some(replacement_key) = deprecated.replacement_key {
            deprecated_entry.insert(
                "replacement_key".to_string(),
                Value::String(replacement_key.to_string()),
            );
        }
        if let Some(planned_removal_version) = deprecated.planned_removal_version {
            deprecated_entry.insert(
                "planned_removal_version".to_string(),
                Value::String(planned_removal_version.to_string()),
            );
        }

        has_deprecation = Some(deprecated_entry);
    }

    if let Some(config_facet_attrs::Attr::HideInDocs(hide_in_docs)) = field
        .get_attr(Some("erato"), "hide_in_docs")
        .and_then(|attr| attr.get_as::<config_facet_attrs::Attr>())
        && hide_in_docs.hidden
    {
        should_hide = true;
    }

    if let Some(config_facet_attrs::Attr::NeedsScopedReplacement(needs_scoped_replacement)) = field
        .get_attr(Some("erato"), "needs_scoped_replacement")
        .and_then(|attr| attr.get_as::<config_facet_attrs::Attr>())
        && needs_scoped_replacement.enabled
    {
        needs_scoped_replacement_flag = true;
    }

    if should_hide {
        mark_descendant_keys_hidden(entries, &key);
    }

    let Some(Value::Object(entry)) = entries.get_mut(&key) else {
        return;
    };

    if should_hide {
        entry.insert("hide_in_docs".to_string(), Value::Bool(true));
    }

    if let Some(deprecated_entry) = has_deprecation {
        entry.insert("deprecated".to_string(), json!(deprecated_entry));
    }

    if needs_scoped_replacement_flag {
        entry.insert("needs_scoped_replacement".to_string(), Value::Bool(true));
    }
}

fn mark_descendant_keys_hidden(entries: &mut BTreeMap<String, Value>, key: &str) {
    let prefix = format!("{key}.");

    for (entry_key, entry) in entries.iter_mut() {
        if (entry_key == key || entry_key.starts_with(&prefix))
            && let Value::Object(entry_obj) = entry
        {
            entry_obj.insert("hide_in_docs".to_string(), Value::Bool(true));
        }
    }
}

fn ensure_entry(entries: &mut BTreeMap<String, Value>, key: String) {
    entries
        .entry(key)
        .or_insert_with(|| Value::Object(Map::new()));
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
    use super::{generate_config_reference, validate_config_reference};

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
        assert!(keys.contains(&"server.encryption_key".to_string()));
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

    #[test]
    fn includes_deprecation_metadata_for_deprecated_keys() {
        let generated = generate_config_reference();
        let object = generated
            .as_object()
            .expect("config reference is a flat object");

        assert_eq!(
            object["sentry_dsn"]["deprecated"]["replacement_key"],
            "integrations.sentry.sentry_dsn"
        );
        assert_eq!(
            object["sentry_dsn"]["deprecated"]["planned_removal_version"],
            "0.6.0"
        );
        assert_eq!(
            object["additional_frontend_environment"]["deprecated"]["replacement_key"],
            "frontend.additional_environment"
        );
    }

    #[test]
    fn validates_replacement_keys() {
        let generated = generate_config_reference();
        validate_config_reference(&generated).expect("replacement keys should exist");
    }

    #[test]
    fn includes_hide_in_docs_metadata() {
        let generated = generate_config_reference();
        let object = generated
            .as_object()
            .expect("config reference is a flat object");

        assert_eq!(object["sentry_dsn"]["hide_in_docs"], true);
    }

    #[test]
    fn hide_in_docs_markers_propagate_to_descendants() {
        let generated = generate_config_reference();
        let object = generated
            .as_object()
            .expect("config reference is a flat object");

        assert_eq!(object["chat_provider.provider_kind"]["hide_in_docs"], true);
        assert_eq!(
            object["chat_provider.additional_request_headers.[]"]["hide_in_docs"],
            true
        );
    }

    #[test]
    fn includes_needs_scoped_replacement_metadata() {
        let generated = generate_config_reference();
        let object = generated
            .as_object()
            .expect("config reference is a flat object");

        assert_eq!(object["cleanup_enabled"]["needs_scoped_replacement"], true);
        assert_eq!(
            object["cleanup_archived_max_age_days"]["needs_scoped_replacement"],
            true
        );
    }
}
