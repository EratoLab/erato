use erato_config_schema::check_config_reference as check_reference;
use serde_json::json;

#[test]
fn matching_reference_still_requires_all_metadata_properties_on_every_key() {
    for property in [
        "introduced_in",
        "stability",
        "security_relevance",
        "default_value_security",
    ] {
        for hidden in [false, true] {
            let mut reference = json!({
                "valid": {"security_relevance":"unknown", "default_value_security":"unknown", "introduced_in": "0.6.0", "stability": "stable"},
                "incomplete": {"security_relevance":"unknown", "default_value_security":"unknown", "introduced_in": "unreleased", "stability": "unstable", "hide_in_docs": hidden}
            });
            reference["incomplete"]
                .as_object_mut()
                .unwrap()
                .remove(property);
            let document = serde_json::to_string_pretty(&reference).unwrap();
            let error = format!("{:#}", check_reference(&document, &document).unwrap_err());
            assert!(error.contains("incomplete"), "{error}");
            assert!(error.contains(property), "{error}");
        }
    }
}

#[test]
fn valid_reference_must_also_be_up_to_date() {
    let document = r#"{"example":{"security_relevance":"unknown", "default_value_security":"unknown", "introduced_in":"unreleased","stability":"alpha"}}"#;
    check_reference(document, document).unwrap();
    let error = check_reference(document, &format!("{document}\n")).unwrap_err();
    assert!(error.to_string().contains("out of date"));
}
