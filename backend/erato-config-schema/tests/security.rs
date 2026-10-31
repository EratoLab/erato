use std::collections::BTreeMap;

use erato_config_schema::{generate_reference, validate_config_reference};
use facet::Facet;
use serde_json::json;

#[derive(Facet)]
struct Child {
    inherited: bool,
    #[facet(erato_config_schema::security_relevance(level = "low"))]
    #[facet(erato_config_schema::security_relevance(level = "medium", under = "map"))]
    #[facet(erato_config_schema::security_relevance(level = "high", under = "map.<key>"))]
    relevance_override: bool,
    // Security context: this default permits convenient access; deployments
    // exposing this feature publicly should disable it.
    #[facet(erato_config_schema::default_value_security(level = "less_secure"))]
    #[facet(erato_config_schema::default_value_security(level = "more_secure", under = "map"))]
    default_override: bool,
}

#[derive(Facet)]
#[facet(erato_config_schema::stability(level = "stable"))]
#[facet(erato_config_schema::introduced_in(version = "1.0.0"))]
#[facet(erato_config_schema::security_relevance(level = "medium"))]
#[facet(erato_config_schema::default_value_security(level = "more_secure"))]
struct Config {
    #[facet(erato_config_schema::security_relevance(level = "high"))]
    optional: Option<Child>,
    map: BTreeMap<String, Child>,
    map_extra: Child,
    list: Vec<Child>,
    #[facet(flatten)]
    flattened: Child,
    #[facet(erato_config_schema::hide_in_docs(hidden = true))]
    #[facet(erato_config_schema::deprecated_alias(name = "old"))]
    #[facet(erato_config_schema::security_relevance(level = "low", under = "old"))]
    #[facet(erato_config_schema::default_value_security(level = "unknown", under = "old"))]
    hidden: Child,
    #[facet(erato_config_schema::security_relevance(level = "none"))]
    irrelevant: Child,
    #[facet(erato_config_schema::security_relevance(level = "unknown"))]
    #[facet(erato_config_schema::default_value_security(level = "unknown"))]
    unevaluated: bool,
}

#[test]
fn security_inherits_independently_with_scoped_overrides() {
    let reference = generate_reference(Config::SHAPE).unwrap();
    for (key, relevance, default_security) in [
        ("optional.inherited", "high", "more_secure"),
        ("optional.relevance_override", "low", "more_secure"),
        ("optional.default_override", "high", "less_secure"),
        ("map.<key>.relevance_override", "high", "more_secure"),
        ("map.<key>.default_override", "medium", "more_secure"),
        ("map_extra.relevance_override", "low", "more_secure"),
        ("map_extra.default_override", "medium", "less_secure"),
        ("list.[].inherited", "medium", "more_secure"),
        ("inherited", "medium", "more_secure"),
        ("hidden.inherited", "medium", "more_secure"),
        ("old.inherited", "low", "unknown"),
        ("old.default_override", "low", "less_secure"),
        ("irrelevant.inherited", "none", "unknown_none"),
        ("irrelevant.default_override", "none", "unknown_none"),
        // Derive unknown_none only at emission, so overriding relevance on a
        // child restores the independently inherited default classification.
        ("irrelevant.relevance_override", "low", "more_secure"),
        ("unevaluated", "unknown", "unknown"),
    ] {
        assert_eq!(reference[key]["security_relevance"], relevance, "{key}");
        assert_eq!(
            reference[key]["default_value_security"], default_security,
            "{key}"
        );
    }
    assert_eq!(reference["old.inherited"]["hide_in_docs"], true);
}

#[derive(Facet)]
#[facet(erato_config_schema::stability(level = "stable"))]
#[facet(erato_config_schema::introduced_in(version = "1.0.0"))]
struct Unevaluated {
    field: bool,
    #[facet(erato_config_schema::security_relevance(level = "none"))]
    irrelevant: bool,
}

#[test]
fn omitted_security_attributes_default_to_unknown() {
    let reference = generate_reference(Unevaluated::SHAPE).unwrap();
    assert_eq!(reference["field"]["security_relevance"], "unknown");
    assert_eq!(reference["field"]["default_value_security"], "unknown");
    assert_eq!(
        reference["irrelevant"]["default_value_security"],
        "unknown_none"
    );
}

#[derive(Facet)]
struct InvalidRelevance {
    #[facet(erato_config_schema::security_relevance(level = "critical"))]
    field: bool,
}

#[derive(Facet)]
struct InvalidDefault {
    #[facet(erato_config_schema::default_value_security(level = "safe"))]
    field: bool,
}

#[derive(Facet)]
struct ExplicitUnknownNone {
    #[facet(erato_config_schema::security_relevance(level = "none"))]
    #[facet(erato_config_schema::default_value_security(level = "unknown_none"))]
    field: bool,
}

#[derive(Facet)]
struct ConflictingRelevance {
    #[facet(erato_config_schema::security_relevance(level = "low"))]
    #[facet(erato_config_schema::security_relevance(level = "high"))]
    field: bool,
}

#[derive(Facet)]
struct ConflictingDefault {
    #[facet(erato_config_schema::default_value_security(level = "less_secure"))]
    #[facet(erato_config_schema::default_value_security(level = "more_secure"))]
    field: bool,
}

#[derive(Facet)]
struct EmptyScope {
    #[facet(erato_config_schema::security_relevance(level = "low", under = ""))]
    field: bool,
}

#[test]
fn invalid_source_attributes_report_the_property_and_key() {
    for (shape, property) in [
        (InvalidRelevance::SHAPE, "security_relevance"),
        (InvalidDefault::SHAPE, "default_value_security"),
        (ExplicitUnknownNone::SHAPE, "unknown_none"),
        (
            ConflictingRelevance::SHAPE,
            "Conflicting security_relevance",
        ),
        (
            ConflictingDefault::SHAPE,
            "Conflicting default_value_security",
        ),
        (EmptyScope::SHAPE, "empty security_relevance scope"),
    ] {
        let error = generate_reference(shape).unwrap_err().to_string();
        assert!(error.contains("field"), "{error}");
        assert!(error.contains(property), "{error}");
    }
}

#[test]
fn reference_validation_checks_security_values_and_derived_value_consistency() {
    for relevance in ["high", "medium", "low", "none", "unknown", "invalid"] {
        for default_security in [
            "less_secure",
            "more_secure",
            "unknown",
            "unknown_none",
            "invalid",
        ] {
            let reference = json!({"field": {
                "stability": "stable",
                "introduced_in": "1.0.0",
                "security_relevance": relevance,
                "default_value_security": default_security,
            }});
            let result = validate_config_reference(&reference);
            let valid = relevance != "invalid"
                && default_security != "invalid"
                && ((relevance == "none") == (default_security == "unknown_none"));
            assert_eq!(result.is_ok(), valid, "{relevance}/{default_security}");
            if let Err(error) = result {
                assert!(error.to_string().contains("field"));
            }
        }
    }
}
