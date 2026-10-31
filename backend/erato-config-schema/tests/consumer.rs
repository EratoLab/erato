use std::collections::BTreeMap;

use erato_config_schema::{
    ReferenceOptions, check_config_reference, config_reference_document, generate_reference,
    generate_reference_with_options,
};
use facet::Facet;
use serde_json::json;

// The shared crate must not special-case Erato type names.
#[derive(Facet)]
struct PromptSourceSpecification {
    internal: String,
}

#[derive(Facet)]
#[facet(erato_config_schema::stability(level = "stable"))]
#[facet(erato_config_schema::introduced_in(version = "1.0.0"))]
struct Config {
    #[facet(erato_config_schema::deprecated_alias(name = "legacy_providers"))]
    providers: BTreeMap<String, PromptSourceSpecification>,
    labels: BTreeMap<String, String>,
    #[facet(erato_config_schema::hide_in_docs(hidden = true))]
    hidden: PromptSourceSpecification,
    #[facet(erato_config_schema::deprecated(
        note = "Use labels instead.",
        replacement_key = "labels.<key>",
        planned_removal_version = "2.0.0"
    ))]
    #[facet(erato_config_schema::needs_scoped_replacement(enabled = true))]
    old_label: String,
}

#[test]
fn external_consumer_uses_attributes_without_erato_configuration() {
    let reference = generate_reference(Config::SHAPE).unwrap();
    assert_eq!(reference["providers.<key>.internal"]["stability"], "stable");
    assert!(reference.get("providers.<provider-id>.internal").is_none());
    assert_eq!(reference["hidden.internal"]["hide_in_docs"], true);
    assert_eq!(reference["old_label"]["stability"], "deprecated");
    assert_eq!(reference["old_label"]["needs_scoped_replacement"], true);
    assert_eq!(
        reference["legacy_providers.<key>.internal"]["deprecated"]["replacement_key"],
        "providers.<key>.internal"
    );
}

#[test]
fn consumer_customizes_maps_and_serialized_types_including_aliases() {
    let reference = generate_reference_with_options(
        Config::SHAPE,
        &ReferenceOptions {
            map_key_placeholder: |path| match path.last().map(String::as_str) {
                Some("providers" | "legacy_providers") => "<service-name>".into(),
                _ => "<key>".into(),
            },
            custom_leaf_paths: |shape| {
                (shape == PromptSourceSpecification::SHAPE).then_some(&[
                    "",
                    "source",
                    "remote.name",
                ])
            },
        },
    )
    .unwrap();

    for suffix in ["", ".source", ".remote.name"] {
        let canonical = format!("providers.<service-name>{suffix}");
        let alias = format!("legacy_providers.<service-name>{suffix}");
        assert_eq!(reference[&canonical]["introduced_in"], "1.0.0");
        assert_eq!(
            reference[&alias]["deprecated"]["replacement_key"],
            canonical
        );
        assert_eq!(reference[&alias]["hide_in_docs"], true);
        assert_eq!(reference[format!("hidden{suffix}")]["hide_in_docs"], true);
    }
    assert!(reference.get("providers.<service-name>.internal").is_none());
    assert!(reference.get("labels.<key>").is_some());
}

#[test]
fn freshness_check_rejects_missing_keys_even_with_valid_remaining_metadata() {
    let reference = generate_reference(Config::SHAPE).unwrap();
    let expected = config_reference_document(&reference).unwrap();
    check_config_reference(&expected, &expected).unwrap();
    let mut stale = reference;
    stale.as_object_mut().unwrap().remove("hidden.internal");
    let stale = config_reference_document(&stale).unwrap();
    assert!(
        check_config_reference(&stale, &expected)
            .unwrap_err()
            .to_string()
            .contains("out of date")
    );
}

#[test]
fn document_serialization_validates_and_sorts_metadata() {
    let reference = json!({
        "z": {"stability": "stable", "introduced_in": "1.0.0"},
        "a": {"stability": "alpha", "introduced_in": "unreleased"}
    });
    let document = config_reference_document(&reference).unwrap();
    assert!(document.ends_with('\n'));
    assert!(document.find("\"a\"").unwrap() < document.find("\"z\"").unwrap());
    assert!(document.find("introduced_in").unwrap() < document.find("stability").unwrap());
    assert!(config_reference_document(&json!({"hidden": {"hide_in_docs": true}})).is_err());
}

#[test]
fn inconsistent_alias_placeholders_report_an_error() {
    let error = generate_reference_with_options(
        Config::SHAPE,
        &ReferenceOptions {
            map_key_placeholder: |path| format!("<{}>", path.last().unwrap()),
            ..ReferenceOptions::default()
        },
    )
    .unwrap_err();
    assert!(error.to_string().contains("no matching canonical key"));
}

#[test]
fn missing_deprecation_replacement_is_rejected() {
    let mut reference = generate_reference(Config::SHAPE).unwrap();
    reference.as_object_mut().unwrap().remove("labels.<key>");
    let error = config_reference_document(&reference).unwrap_err();
    assert!(error.to_string().contains("replacement_key 'labels.<key>'"));
}
