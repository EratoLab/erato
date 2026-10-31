use std::collections::BTreeMap;

use eyre::{Result, eyre};
use facet::{Def, Facet, Field, Shape, StructType, Type, UserType};
use serde_json::{Map, Value, json};

use crate::config::AppConfig;
use crate::config_facet_attrs;
use crate::config_metadata::{Lifecycle, Stability, validate_version};

#[derive(Clone, Default)]
struct Entry {
    documentation: Map<String, Value>,
    lifecycle: Lifecycle,
}

type Entries = BTreeMap<String, Entry>;

pub fn generate_config_reference() -> Result<Value> {
    generate_reference(AppConfig::SHAPE)
}

fn generate_reference(shape: &'static Shape) -> Result<Value> {
    let mut entries = BTreeMap::new();
    collect_paths(
        shape,
        &mut Vec::new(),
        &mut entries,
        &Lifecycle::for_root(shape)?,
    )?;
    let mut reference = Map::new();
    for (key, entry) in entries {
        let mut lifecycle = entry.lifecycle;
        let mut metadata = entry.documentation;
        if metadata.contains_key("deprecated") {
            lifecycle.stability = Some(Stability::Deprecated);
        }
        if let Some(stability) = lifecycle.stability {
            metadata.insert("stability".into(), serde_json::to_value(stability)?);
        }
        if let Some(version) = lifecycle.introduced_in {
            metadata.insert("introduced_in".into(), json!(version));
        }
        reference.insert(key, Value::Object(metadata));
    }
    let mut reference = Value::Object(reference);
    // The server enables serde_json/preserve_order through workspace feature
    // unification. Codegen must be identical when built with or without it.
    reference.sort_all_objects();
    validate_config_reference(&reference)?;
    Ok(reference)
}

pub fn validate_config_reference(reference: &Value) -> Result<()> {
    let object = reference
        .as_object()
        .ok_or_else(|| eyre!("config reference must be a JSON object"))?;

    for (key, entry) in object {
        let stability: Stability =
            serde_json::from_value(entry.get("stability").cloned().unwrap_or(Value::Null))
                .map_err(|err| {
                    eyre!("Config key '{key}' has invalid or missing stability: {err}")
                })?;
        let version = entry
            .get("introduced_in")
            .and_then(Value::as_str)
            .ok_or_else(|| eyre!("Config key '{key}' is missing introduced_in"))?;
        validate_version(key, version)?;
        if entry.get("deprecated").is_some() && stability != Stability::Deprecated {
            return Err(eyre!(
                "Config key '{key}' has deprecation metadata but stability is not deprecated"
            ));
        }
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
    entries: &mut Entries,
    lifecycle: &Lifecycle,
) -> Result<()> {
    match &shape.def {
        Def::Option(option_def) => collect_paths(option_def.t, path, entries, lifecycle)?,
        Def::List(list_def) => {
            path.push("[]".to_string());
            collect_paths(list_def.t, path, entries, lifecycle)?;
            path.pop();
        }
        Def::Array(array_def) => {
            path.push("[]".to_string());
            collect_paths(array_def.t, path, entries, lifecycle)?;
            path.pop();
        }
        Def::Map(map_def) => {
            path.push(map_key_placeholder(path));
            collect_paths(map_def.v, path, entries, lifecycle)?;
            path.pop();
        }
        Def::Set(set_def) => {
            path.push("[]".to_string());
            collect_paths(set_def.t, path, entries, lifecycle)?;
            path.pop();
        }
        Def::Pointer(pointer_def) => {
            if let Some(pointee) = pointer_def.pointee {
                collect_paths(pointee, path, entries, lifecycle)?;
            } else if !path.is_empty() {
                ensure_entry(entries, path.join("."), lifecycle)?;
            }
        }
        Def::DynamicValue(_) | Def::Scalar | Def::Undefined | Def::Slice(_) | Def::NdArray(_) => {
            collect_from_type(shape, path, entries, lifecycle)?;
        }
        Def::Result(result_def) => {
            collect_paths(result_def.t, path, entries, lifecycle)?;
            collect_paths(result_def.e, path, entries, lifecycle)?;
        }
        _ => {
            if let Some(inner) = shape.inner {
                collect_paths(inner, path, entries, lifecycle)?;
            } else {
                collect_from_type(shape, path, entries, lifecycle)?;
            }
        }
    }
    Ok(())
}

fn collect_from_type(
    shape: &'static Shape,
    path: &mut Vec<String>,
    entries: &mut Entries,
    lifecycle: &Lifecycle,
) -> Result<()> {
    if shape.type_identifier == "PromptSourceSpecification" {
        collect_prompt_source_specification(path, entries, lifecycle)?;
        return Ok(());
    }

    match shape.ty {
        Type::User(UserType::Struct(struct_type)) => {
            collect_struct_fields(&struct_type, path, entries, lifecycle)?
        }
        Type::User(UserType::Enum(enum_type)) => {
            if shape.is_untagged() {
                for variant in enum_type.variants {
                    collect_struct_fields(&variant.data, path, entries, lifecycle)?;
                }
                return Ok(());
            }

            if let Some(tag) = shape.tag {
                path.push(tag.to_string());
                ensure_entry(entries, path.join("."), lifecycle)?;
                path.pop();
            }

            if let Some(content) = shape.content {
                path.push(content.to_string());
                ensure_entry(entries, path.join("."), lifecycle)?;
                path.pop();
            }

            for variant in enum_type.variants {
                collect_struct_fields(&variant.data, path, entries, lifecycle)?;
            }
        }
        _ => {
            if !path.is_empty() {
                ensure_entry(entries, path.join("."), lifecycle)?;
            }
        }
    }
    Ok(())
}

fn collect_prompt_source_specification(
    path: &mut Vec<String>,
    entries: &mut Entries,
    lifecycle: &Lifecycle,
) -> Result<()> {
    if path.is_empty() {
        return Ok(());
    }

    ensure_entry(entries, path.join("."), lifecycle)?;

    for segment in ["source", "prompt_name", "label", "prompt", "fallback"] {
        path.push(segment.to_string());
        ensure_entry(entries, path.join("."), lifecycle)?;
        path.pop();
    }
    Ok(())
}

fn collect_struct_fields(
    struct_type: &StructType,
    path: &mut Vec<String>,
    entries: &mut Entries,
    lifecycle: &Lifecycle,
) -> Result<()> {
    if struct_type.fields.is_empty() {
        if !path.is_empty() {
            ensure_entry(entries, path.join("."), lifecycle)?;
        }
        return Ok(());
    }

    for field in struct_type.fields {
        collect_field(field, path, entries, lifecycle)?;
    }
    Ok(())
}

fn collect_field(
    field: &Field,
    path: &mut Vec<String>,
    entries: &mut Entries,
    lifecycle: &Lifecycle,
) -> Result<()> {
    let field_shape = field.shape.get();

    if field.is_flattened() {
        let lifecycle = lifecycle.for_field(field, path)?;
        collect_paths(field_shape, path, entries, &lifecycle)?;
        return Ok(());
    }

    path.push(field.rename.unwrap_or(field.name).to_string());
    let field_lifecycle = lifecycle.for_field(field, path)?;
    collect_paths(field_shape, path, entries, &field_lifecycle)?;
    apply_field_metadata(field, path, entries);
    collect_deprecated_alias(field, path, entries, lifecycle)?;
    path.pop();
    Ok(())
}

fn collect_deprecated_alias(
    field: &Field,
    path: &[String],
    entries: &mut Entries,
    inherited: &Lifecycle,
) -> Result<()> {
    let Some(config_facet_attrs::Attr::DeprecatedAlias(alias)) = field
        .get_attr(Some("erato"), "deprecated_alias")
        .and_then(|attr| attr.get_as::<config_facet_attrs::Attr>())
    else {
        return Ok(());
    };

    let canonical_key = path.join(".");
    let mut alias_path = path.to_vec();
    *alias_path.last_mut().expect("field path is not empty") = alias.name.to_string();
    let alias_key = alias_path.join(".");
    // Traverse the alias independently: the same Rust fields can have different
    // introduction dates under their old and canonical public names.
    let lifecycle = inherited.for_field(field, &alias_path)?;
    let mut aliases = BTreeMap::new();
    collect_paths(field.shape.get(), &mut alias_path, &mut aliases, &lifecycle)?;
    for (key, metadata) in &mut aliases {
        let canonical = format!("{canonical_key}{}", &key[alias_key.len()..]);
        metadata.documentation = entries[&canonical].documentation.clone();
        metadata.lifecycle.stability = Some(Stability::Deprecated);
        metadata
            .documentation
            .insert("hide_in_docs".into(), json!(true));
        metadata.documentation.insert(
            "deprecated".into(),
            json!({
                "note": format!("Please use `{canonical}` instead."),
                "replacement_key": canonical,
            }),
        );
    }
    entries.extend(aliases);
    Ok(())
}

fn apply_field_metadata(field: &Field, path: &[String], entries: &mut Entries) {
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

    let Some(entry) = entries.get_mut(&key) else {
        return;
    };
    let entry = &mut entry.documentation;

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

fn mark_descendant_keys_hidden(entries: &mut Entries, key: &str) {
    let prefix = format!("{key}.");

    for (entry_key, entry) in entries.iter_mut() {
        if entry_key == key || entry_key.starts_with(&prefix) {
            entry
                .documentation
                .insert("hide_in_docs".to_string(), Value::Bool(true));
        }
    }
}

fn ensure_entry(entries: &mut Entries, key: String, lifecycle: &Lifecycle) -> Result<()> {
    if let Some(existing) = entries.get(&key) {
        if existing.lifecycle != *lifecycle {
            return Err(eyre!(
                "Conflicting lifecycle metadata for config key '{key}'"
            ));
        }
    } else {
        entries.insert(
            key,
            Entry {
                documentation: Map::new(),
                lifecycle: lifecycle.clone(),
            },
        );
    }
    Ok(())
}

fn map_key_placeholder(path: &[String]) -> String {
    match path.last().map(String::as_str) {
        Some("facets") => "<facet-id>".to_string(),
        Some("file_storage_providers") => "<provider-id>".to_string(),
        Some("localized_prompts") => "<locale>".to_string(),
        Some("mcp_servers") => "<server-id>".to_string(),
        Some("tools") if path.len() == 3 && path[0] == "mcp_servers" => "<tool-name>".to_string(),
        Some("prompt_patterns") => "<pattern-id>".to_string(),
        Some("prompts") => "<prompt-id>".to_string(),
        Some("providers" | "provider") => "<provider-id>".to_string(),
        Some("policies") if path.len() == 2 && path[0] == "policy_guides" => {
            "<policy-id>".to_string()
        }
        Some("rules") => "<rule-name>".to_string(),
        _ => "<key>".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::{generate_config_reference, generate_reference, validate_config_reference};
    use crate::config_facet_attrs as erato_config;
    use facet::Facet;
    use serde_json::json;
    use std::collections::BTreeMap;

    #[test]
    fn generated_metadata_has_stable_order_with_preserve_order_enabled() {
        fn assert_sorted(value: &serde_json::Value) {
            if let Some(object) = value.as_object() {
                let keys = object.keys().collect::<Vec<_>>();
                assert!(keys.windows(2).all(|pair| pair[0] <= pair[1]));
                for child in object.values() {
                    assert_sorted(child);
                }
            }
        }
        assert_sorted(&generate_config_reference().unwrap());
    }

    #[derive(Facet)]
    struct Child {
        #[facet(erato_config::introduced_in(version = "0.8.0", under = "second"))]
        inherited: bool,
        #[facet(erato_config::stability(level = "stable", under = "second"))]
        #[facet(erato_config::stability(level = "beta"))]
        beta: bool,
        #[facet(erato_config::introduced_in(version = "0.7.0"))]
        #[facet(erato_config::introduced_in(version = "0.8.0", under = "second"))]
        #[facet(erato_config::introduced_in(version = "0.8.1", under = "second.<key>"))]
        later: bool,
    }

    #[derive(Facet)]
    #[facet(erato_config::stability(level = "unstable"))]
    #[facet(erato_config::introduced_in(version = "0.6.1"))]
    struct Sections {
        #[facet(erato_config::stability(level = "alpha"))]
        #[facet(erato_config::introduced_in(version = "0.6.0"))]
        first: Option<Child>,
        #[facet(erato_config::stability(level = "alpha"))]
        #[facet(erato_config::introduced_in(version = "0.6.2"))]
        second: BTreeMap<String, Child>,
        second_extra: Child,
        #[facet(erato_config::stability(level = "stable"))]
        list: Vec<Child>,
        #[facet(flatten)]
        #[facet(erato_config::stability(level = "alpha"))]
        flattened: Child,
        sibling: bool,
    }

    #[test]
    fn lifecycle_inherits_independently_across_shared_flattened_and_collection_fields() {
        let reference = generate_reference(Sections::SHAPE).unwrap();
        assert_eq!(
            reference["first.inherited"],
            json!({"stability":"alpha", "introduced_in":"0.6.0"})
        );
        assert_eq!(
            reference["first.beta"],
            json!({"stability":"beta", "introduced_in":"0.6.0"})
        );
        assert_eq!(reference["first.later"]["introduced_in"], "0.7.0");
        assert_eq!(
            reference["second.<key>.inherited"]["introduced_in"],
            "0.8.0"
        );
        assert_eq!(reference["second.<key>.beta"]["introduced_in"], "0.6.2");
        assert_eq!(reference["list.[].inherited"]["stability"], "stable");
        assert_eq!(reference["inherited"]["stability"], "alpha");
        assert_eq!(reference["sibling"]["stability"], "unstable");
    }

    #[test]
    fn scoped_attributes_are_specific_and_match_whole_path_segments() {
        let reference = generate_reference(Sections::SHAPE).unwrap();
        assert_eq!(
            reference["second.<key>.beta"],
            json!({"stability":"stable", "introduced_in":"0.6.2"})
        );
        assert_eq!(
            reference["second.<key>.later"],
            json!({"stability":"alpha", "introduced_in":"0.8.1"})
        );
        assert_eq!(
            reference["second_extra.inherited"],
            json!({"stability":"unstable", "introduced_in":"0.6.1"})
        );
        assert_eq!(reference["second_extra.beta"]["stability"], "beta");
    }

    #[derive(Facet)]
    #[facet(erato_config::stability(level = "unstable"))]
    struct Aliases {
        #[facet(erato_config::deprecated_alias(name = "old"))]
        #[facet(erato_config::introduced_in(version = "0.7.0"))]
        #[facet(erato_config::introduced_in(version = "0.6.0", under = "old"))]
        new: Child,
    }

    #[test]
    fn aliases_resolve_their_own_inherited_dates_and_child_overrides() {
        let reference = generate_reference(Aliases::SHAPE).unwrap();
        assert_eq!(reference["new.inherited"]["introduced_in"], "0.7.0");
        assert_eq!(reference["old.inherited"]["introduced_in"], "0.6.0");
        assert_eq!(reference["old.later"]["introduced_in"], "0.7.0");
        assert_eq!(reference["old.beta"]["stability"], "deprecated");
        assert_eq!(
            reference["old.beta"]["deprecated"]["replacement_key"],
            "new.beta"
        );
        assert_eq!(reference["old.beta"]["hide_in_docs"], true);
    }

    #[derive(Facet)]
    struct ConflictingAttributes {
        #[facet(erato_config::introduced_in(version = "0.6.0"))]
        #[facet(erato_config::introduced_in(version = "0.7.0"))]
        field: bool,
    }

    #[test]
    fn conflicting_attributes_are_rejected() {
        let error = generate_reference(ConflictingAttributes::SHAPE).unwrap_err();
        assert!(
            error
                .to_string()
                .contains("Conflicting introduced_in attributes for config key 'field'")
        );
    }

    #[derive(Facet)]
    #[repr(C)]
    #[facet(untagged)]
    #[allow(dead_code)]
    enum ConflictingVariants {
        First {
            #[facet(erato_config::stability(level = "stable"))]
            field: bool,
        },
        Second {
            #[facet(erato_config::stability(level = "alpha"))]
            field: bool,
        },
    }

    #[test]
    fn conflicting_enum_metadata_is_rejected() {
        let error = generate_reference(ConflictingVariants::SHAPE).unwrap_err();
        assert!(
            error
                .to_string()
                .contains("Conflicting lifecycle metadata for config key 'field'")
        );
    }

    #[test]
    fn lifecycle_validation_names_the_key() {
        for metadata in [
            json!({}),
            json!({"stability":"preview", "introduced_in":"0.6.0"}),
            json!({"stability":"stable"}),
            json!({"stability":"stable", "introduced_in":"v0.6.0"}),
            json!({"stability":"stable", "introduced_in":"0.6"}),
            json!({"stability":"stable", "introduced_in":"0.6.0", "deprecated":{}}),
        ] {
            assert!(
                validate_config_reference(&json!({"example": metadata}))
                    .unwrap_err()
                    .to_string()
                    .contains("example")
            );
        }
        for version in ["0.6.0", "0.8.0-rc.1", "unreleased"] {
            validate_config_reference(
                &json!({"example":{"stability":"alpha", "introduced_in":version}}),
            )
            .unwrap();
        }
    }

    #[derive(Facet)]
    #[facet(erato_config::stability(level = "unstable"))]
    struct MissingIntroduction {
        #[facet(erato_config::hide_in_docs(hidden = true))]
        incomplete: bool,
    }

    #[derive(Facet)]
    #[facet(erato_config::introduced_in(version = "0.6.0"))]
    struct MissingStability {
        incomplete: bool,
    }

    #[test]
    fn generation_rejects_missing_effective_metadata_from_attributes() {
        for (shape, property) in [
            (MissingIntroduction::SHAPE, "introduced_in"),
            (MissingStability::SHAPE, "stability"),
        ] {
            let error = generate_reference(shape).unwrap_err().to_string();
            assert!(error.contains("incomplete"), "{error}");
            assert!(error.contains(property), "{error}");
        }
    }

    #[test]
    fn backfill_preserves_alias_dates_and_classifies_existing_deprecations() {
        let reference = generate_config_reference().unwrap();
        assert_eq!(
            reference["experimental_facets.default_selected_facets.[]"]["introduced_in"],
            "0.6.0"
        );
        assert_eq!(
            reference["facets.default_selected_facets.[]"]["introduced_in"],
            "0.7.0"
        );
        assert_eq!(reference["server.encryption_key"]["introduced_in"], "0.6.0");
        for metadata in reference.as_object().unwrap().values() {
            if metadata.get("deprecated").is_some() {
                assert_eq!(metadata["stability"], "deprecated");
            }
            assert!(metadata["introduced_in"].is_string());
            assert!(metadata["stability"].is_string());
        }
        for suffix in [
            "",
            ".source",
            ".prompt",
            ".prompt_name",
            ".label",
            ".fallback",
        ] {
            assert_eq!(
                reference[format!("prompt_optimizer.prompt{suffix}")]["introduced_in"],
                "0.6.0"
            );
        }
    }

    #[test]
    fn only_conversational_audio_exposes_speech_provider() {
        let reference = generate_config_reference().unwrap();
        let keys = reference.as_object().unwrap();
        assert!(keys.contains_key("audio_conversational.speech_provider"));
        assert!(!keys.contains_key("audio_dictation.speech_provider"));
        assert!(!keys.contains_key("audio_transcription.speech_provider"));
        for key in keys
            .keys()
            .filter_map(|key| key.strip_prefix("audio_transcription."))
        {
            assert!(keys.contains_key(&format!("audio_conversational.{key}")));
            assert!(keys.contains_key(&format!("audio_dictation.{key}")));
        }
        assert!(
            !keys
                .keys()
                .any(|key| key.starts_with("audio_conversational.transcription."))
        );
    }

    #[test]
    fn emits_expected_example_paths() {
        let generated = generate_config_reference().unwrap();
        let keys = generated
            .as_object()
            .expect("config reference is a flat object")
            .keys()
            .cloned()
            .collect::<Vec<_>>();

        assert!(keys.contains(&"chat_providers.providers.<provider-id>.model_name".to_string()));
        assert!(keys.contains(&"assistants.enabled".to_string()));
        assert!(keys.contains(&"facets.facets.<facet-id>.display_name".to_string()));
        assert!(keys.contains(&"integrations.sharepoint.enabled".to_string()));
        assert!(keys.contains(&"integrations.entra_id.enabled".to_string()));
        assert!(keys.contains(&"model_permissions.rules.<rule-name>.rule_type".to_string()));
        assert!(keys.contains(&"server.encryption_key".to_string()));
        assert!(
            keys.contains(
                &"mcp_servers_global.default_tool_annotations.read_only_hint".to_string()
            )
        );
        assert!(keys.contains(
            &"mcp_servers.<server-id>.override_tool_annotations.destructive_hint".to_string()
        ));
        assert!(keys.contains(&"mcp_servers.<server-id>.tools.<tool-name>.default_tool_annotations.open_world_hint".to_string()));
        assert!(keys.contains(&"client_tools.tools.<key>.name".to_string()));
        assert!(keys.contains(&"chat_providers.priority_order.[]".to_string()));
        assert!(keys.windows(2).all(|window| window[0] <= window[1]));
    }

    #[test]
    fn includes_both_scalar_and_object_prompt_forms() {
        let generated = generate_config_reference().unwrap();
        let object = generated
            .as_object()
            .expect("config reference is a flat object");

        assert!(object.contains_key("prompt_optimizer.prompt"));
        assert!(object.contains_key("prompt_optimizer.prompt.source"));
        assert!(object.contains_key("prompt_optimizer.prompt.prompt_name"));
    }

    #[test]
    fn includes_deprecation_metadata_for_deprecated_keys() {
        let generated = generate_config_reference().unwrap();
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
    fn deprecated_aliases_preserve_all_descendants_with_replacements() {
        let generated = generate_config_reference().unwrap();
        let object = generated.as_object().unwrap();

        for (canonical, alias) in [
            ("facets", "experimental_facets"),
            (
                "integrations.sharepoint",
                "integrations.experimental_sharepoint",
            ),
            (
                "integrations.entra_id",
                "integrations.experimental_entra_id",
            ),
        ] {
            let canonical_prefix = format!("{canonical}.");
            let mut count = 0;
            for (key, metadata) in object {
                if !key.starts_with(&canonical_prefix) {
                    continue;
                }
                count += 1;
                let alias_key = format!("{alias}{}", &key[canonical.len()..]);
                let alias_metadata = &object[&alias_key];
                assert_eq!(
                    alias_metadata["deprecated"]["replacement_key"],
                    key.as_str()
                );
                assert_eq!(alias_metadata["hide_in_docs"], true);
                assert!(metadata.get("deprecated").is_none());
                assert!(metadata.get("hide_in_docs").is_none());
            }
            assert!(count > 0, "no reference entries for {canonical}");
        }
        validate_config_reference(&generated).unwrap();
    }

    #[test]
    fn validates_replacement_keys() {
        let generated = generate_config_reference().unwrap();
        validate_config_reference(&generated).expect("replacement keys should exist");
    }

    #[test]
    fn includes_hide_in_docs_metadata() {
        let generated = generate_config_reference().unwrap();
        let object = generated
            .as_object()
            .expect("config reference is a flat object");

        assert_eq!(object["sentry_dsn"]["hide_in_docs"], true);
    }

    #[test]
    fn hide_in_docs_markers_propagate_to_descendants() {
        let generated = generate_config_reference().unwrap();
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
        let generated = generate_config_reference().unwrap();
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
