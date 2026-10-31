use std::collections::BTreeMap;

use eyre::{Result, WrapErr, bail, eyre};
use facet::{Def, Field, Shape, StructType, Type, UserType};
use serde_json::{Map, Value, json};

use crate::config_facet_attrs;
use crate::config_metadata::{
    ConfigMetadata, DefaultValueSecurity, SecurityRelevance, Stability, validate_version,
};

#[derive(Clone, Default)]
struct Entry {
    documentation: Map<String, Value>,
    config_metadata: ConfigMetadata,
}

type Entries = BTreeMap<String, Entry>;

/// Application-specific conventions for map keys and custom serialized types.
/// The default traverses Facet shapes and uses `<key>` for all map entries.
#[derive(Clone, Copy)]
pub struct ReferenceOptions {
    /// Return the placeholder for a map at the given public config path.
    pub map_key_placeholder: fn(&[String]) -> String,
    /// Override traversal for a custom serialized type with relative leaf paths.
    /// An empty path emits the current key; `None` uses normal Facet traversal.
    /// Each leaf inherits the metadata of the containing field.
    pub custom_leaf_paths: fn(&Shape) -> Option<&'static [&'static str]>,
}

impl Default for ReferenceOptions {
    fn default() -> Self {
        Self {
            map_key_placeholder: |_| "<key>".to_owned(),
            custom_leaf_paths: |_| None,
        }
    }
}

/// Generate a sorted, validated reference from a root configuration shape.
pub fn generate_reference(shape: &'static Shape) -> Result<Value> {
    generate_reference_with_options(shape, &ReferenceOptions::default())
}

/// Generate a reference using application-specific serialization conventions.
pub fn generate_reference_with_options(
    shape: &'static Shape,
    options: &ReferenceOptions,
) -> Result<Value> {
    let mut entries = BTreeMap::new();
    collect_paths(
        shape,
        &mut Vec::new(),
        &mut entries,
        &ConfigMetadata::for_root(shape)?,
        options,
    )?;
    let mut reference = Map::new();
    for (key, entry) in entries {
        let mut config_metadata = entry.config_metadata;
        let mut metadata = entry.documentation;
        if metadata.contains_key("deprecated") {
            config_metadata.stability = Some(Stability::Deprecated);
        }
        if let Some(stability) = config_metadata.stability {
            metadata.insert("stability".into(), serde_json::to_value(stability)?);
        }
        if let Some(version) = config_metadata.introduced_in {
            metadata.insert("introduced_in".into(), json!(version));
        }
        metadata.insert(
            "security_relevance".into(),
            serde_json::to_value(config_metadata.security_relevance)?,
        );
        let default_value_security =
            if config_metadata.security_relevance == SecurityRelevance::None {
                DefaultValueSecurity::UnknownNone
            } else {
                config_metadata.default_value_security
            };
        metadata.insert(
            "default_value_security".into(),
            serde_json::to_value(default_value_security)?,
        );
        reference.insert(key, Value::Object(metadata));
    }
    let mut reference = Value::Object(reference);
    // Consumers may enable serde_json/preserve_order through feature unification.
    // Codegen must be identical when built with or without it.
    reference.sort_all_objects();
    validate_config_reference(&reference)?;
    Ok(reference)
}

/// Validate metadata completeness, security classifications, versions, and replacements.
/// This checks every entry, including hidden keys and deprecated aliases.
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
        let security_relevance: SecurityRelevance = serde_json::from_value(
            entry
                .get("security_relevance")
                .cloned()
                .unwrap_or(Value::Null),
        )
        .map_err(|err| {
            eyre!("Config key '{key}' has invalid or missing security_relevance: {err}")
        })?;
        let default_value_security: DefaultValueSecurity = serde_json::from_value(
            entry
                .get("default_value_security")
                .cloned()
                .unwrap_or(Value::Null),
        )
        .map_err(|err| {
            eyre!("Config key '{key}' has invalid or missing default_value_security: {err}")
        })?;
        if (security_relevance == SecurityRelevance::None)
            != (default_value_security == DefaultValueSecurity::UnknownNone)
        {
            bail!(
                "Config key '{key}': default_value_security must be 'unknown_none' if and only if security_relevance is 'none'"
            );
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
    config_metadata: &ConfigMetadata,
    options: &ReferenceOptions,
) -> Result<()> {
    if let Some(leaves) = (options.custom_leaf_paths)(shape) {
        for leaf in leaves {
            let mut segments = path.clone();
            if !leaf.is_empty() {
                segments.extend(leaf.split('.').map(str::to_owned));
            }
            if !segments.is_empty() {
                ensure_entry(entries, segments.join("."), config_metadata)?;
            }
        }
        return Ok(());
    }

    match &shape.def {
        Def::Option(option_def) => {
            collect_paths(option_def.t, path, entries, config_metadata, options)?
        }
        Def::List(list_def) => {
            path.push("[]".to_string());
            collect_paths(list_def.t, path, entries, config_metadata, options)?;
            path.pop();
        }
        Def::Array(array_def) => {
            path.push("[]".to_string());
            collect_paths(array_def.t, path, entries, config_metadata, options)?;
            path.pop();
        }
        Def::Map(map_def) => {
            path.push((options.map_key_placeholder)(path));
            collect_paths(map_def.v, path, entries, config_metadata, options)?;
            path.pop();
        }
        Def::Set(set_def) => {
            path.push("[]".to_string());
            collect_paths(set_def.t, path, entries, config_metadata, options)?;
            path.pop();
        }
        Def::Pointer(pointer_def) => {
            if let Some(pointee) = pointer_def.pointee {
                collect_paths(pointee, path, entries, config_metadata, options)?;
            } else if !path.is_empty() {
                ensure_entry(entries, path.join("."), config_metadata)?;
            }
        }
        Def::DynamicValue(_) | Def::Scalar | Def::Undefined | Def::Slice(_) | Def::NdArray(_) => {
            collect_from_type(shape, path, entries, config_metadata, options)?;
        }
        Def::Result(result_def) => {
            collect_paths(result_def.t, path, entries, config_metadata, options)?;
            collect_paths(result_def.e, path, entries, config_metadata, options)?;
        }
        _ => {
            if let Some(inner) = shape.inner {
                collect_paths(inner, path, entries, config_metadata, options)?;
            } else {
                collect_from_type(shape, path, entries, config_metadata, options)?;
            }
        }
    }
    Ok(())
}

fn collect_from_type(
    shape: &'static Shape,
    path: &mut Vec<String>,
    entries: &mut Entries,
    config_metadata: &ConfigMetadata,
    options: &ReferenceOptions,
) -> Result<()> {
    match shape.ty {
        Type::User(UserType::Struct(struct_type)) => {
            collect_struct_fields(&struct_type, path, entries, config_metadata, options)?
        }
        Type::User(UserType::Enum(enum_type)) => {
            if shape.is_untagged() {
                for variant in enum_type.variants {
                    collect_struct_fields(&variant.data, path, entries, config_metadata, options)?;
                }
                return Ok(());
            }

            if let Some(tag) = shape.tag {
                path.push(tag.to_string());
                ensure_entry(entries, path.join("."), config_metadata)?;
                path.pop();
            }

            if let Some(content) = shape.content {
                path.push(content.to_string());
                ensure_entry(entries, path.join("."), config_metadata)?;
                path.pop();
            }

            for variant in enum_type.variants {
                collect_struct_fields(&variant.data, path, entries, config_metadata, options)?;
            }
        }
        _ => {
            if !path.is_empty() {
                ensure_entry(entries, path.join("."), config_metadata)?;
            }
        }
    }
    Ok(())
}

fn collect_struct_fields(
    struct_type: &StructType,
    path: &mut Vec<String>,
    entries: &mut Entries,
    config_metadata: &ConfigMetadata,
    options: &ReferenceOptions,
) -> Result<()> {
    if struct_type.fields.is_empty() {
        if !path.is_empty() {
            ensure_entry(entries, path.join("."), config_metadata)?;
        }
        return Ok(());
    }

    for field in struct_type.fields {
        collect_field(field, path, entries, config_metadata, options)?;
    }
    Ok(())
}

fn collect_field(
    field: &Field,
    path: &mut Vec<String>,
    entries: &mut Entries,
    config_metadata: &ConfigMetadata,
    options: &ReferenceOptions,
) -> Result<()> {
    let field_shape = field.shape.get();

    if field.is_flattened() {
        let config_metadata = config_metadata.for_field(field, path)?;
        collect_paths(field_shape, path, entries, &config_metadata, options)?;
        return Ok(());
    }

    path.push(field.rename.unwrap_or(field.name).to_string());
    let field_config_metadata = config_metadata.for_field(field, path)?;
    collect_paths(field_shape, path, entries, &field_config_metadata, options)?;
    apply_field_metadata(field, path, entries);
    collect_deprecated_alias(field, path, entries, config_metadata, options)?;
    path.pop();
    Ok(())
}

fn collect_deprecated_alias(
    field: &Field,
    path: &[String],
    entries: &mut Entries,
    inherited: &ConfigMetadata,
    options: &ReferenceOptions,
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
    let config_metadata = inherited.for_field(field, &alias_path)?;
    let mut aliases = BTreeMap::new();
    collect_paths(
        field.shape.get(),
        &mut alias_path,
        &mut aliases,
        &config_metadata,
        options,
    )?;
    for (key, metadata) in &mut aliases {
        let canonical = format!("{canonical_key}{}", &key[alias_key.len()..]);
        metadata.documentation = entries
            .get(&canonical)
            .ok_or_else(|| {
                eyre!(
                    "Deprecated alias key '{key}' has no matching canonical key '{canonical}'; use the same map placeholders under aliases and canonical paths"
                )
            })?
            .documentation
            .clone();
        metadata.config_metadata.stability = Some(Stability::Deprecated);
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

fn ensure_entry(
    entries: &mut Entries,
    key: String,
    config_metadata: &ConfigMetadata,
) -> Result<()> {
    if let Some(existing) = entries.get(&key) {
        if existing.config_metadata != *config_metadata {
            return Err(eyre!("Conflicting config metadata for config key '{key}'"));
        }
    } else {
        entries.insert(
            key,
            Entry {
                documentation: Map::new(),
                config_metadata: config_metadata.clone(),
            },
        );
    }
    Ok(())
}

/// Serialize validated metadata deterministically, including a trailing newline.
pub fn config_reference_document(reference: &Value) -> Result<String> {
    validate_config_reference(reference)?;
    let mut reference = reference.clone();
    reference.sort_all_objects();
    Ok(format!("{}\n", serde_json::to_string_pretty(&reference)?))
}

/// Validate both documents and require byte-for-byte freshness.
/// Generate the expected document from the current root shape before calling this
/// function so missing keys as well as missing metadata are detected.
pub fn check_config_reference(existing_doc: &str, generated_doc: &str) -> Result<()> {
    for (document, label) in [(existing_doc, "checked-in"), (generated_doc, "generated")] {
        let reference = serde_json::from_str(document)
            .wrap_err_with(|| format!("Invalid JSON in {label} config reference"))?;
        validate_config_reference(&reference)
            .wrap_err_with(|| format!("Invalid metadata in {label} config reference"))?;
    }
    if existing_doc != generated_doc {
        bail!("Config reference is out of date. Run without --check to update.");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{generate_reference, validate_config_reference};
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
        assert_sorted(&generate_reference(Sections::SHAPE).unwrap());
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
    fn config_metadata_inherits_independently_across_shared_flattened_and_collection_fields() {
        let reference = generate_reference(Sections::SHAPE).unwrap();
        assert_eq!(
            reference["first.inherited"],
            json!({"security_relevance":"unknown", "default_value_security":"unknown", "stability":"alpha", "introduced_in":"0.6.0"})
        );
        assert_eq!(
            reference["first.beta"],
            json!({"security_relevance":"unknown", "default_value_security":"unknown", "stability":"beta", "introduced_in":"0.6.0"})
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
            json!({"security_relevance":"unknown", "default_value_security":"unknown", "stability":"stable", "introduced_in":"0.6.2"})
        );
        assert_eq!(
            reference["second.<key>.later"],
            json!({"security_relevance":"unknown", "default_value_security":"unknown", "stability":"alpha", "introduced_in":"0.8.1"})
        );
        assert_eq!(
            reference["second_extra.inherited"],
            json!({"security_relevance":"unknown", "default_value_security":"unknown", "stability":"unstable", "introduced_in":"0.6.1"})
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
                .contains("Conflicting config metadata for config key 'field'")
        );
    }

    #[test]
    fn config_metadata_validation_names_the_key() {
        for metadata in [
            json!({}),
            json!({"security_relevance":"unknown", "default_value_security":"unknown", "stability":"preview", "introduced_in":"0.6.0"}),
            json!({"security_relevance":"unknown", "default_value_security":"unknown", "stability":"stable"}),
            json!({"security_relevance":"unknown", "default_value_security":"unknown", "stability":"stable", "introduced_in":"v0.6.0"}),
            json!({"security_relevance":"unknown", "default_value_security":"unknown", "stability":"stable", "introduced_in":"0.6"}),
            json!({"security_relevance":"unknown", "default_value_security":"unknown", "stability":"stable", "introduced_in":"0.6.0", "deprecated":{}}),
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
                &json!({"example":{"stability":"alpha", "introduced_in":version, "security_relevance":"unknown", "default_value_security":"unknown"}}),
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
}
