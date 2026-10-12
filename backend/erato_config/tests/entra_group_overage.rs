use erato_config::config::{EntraIdConfig, IntegrationsConfig};

#[test]
fn overage_defaults_on_independently_of_directory_endpoints() {
    let config: EntraIdConfig = serde_json::from_value(serde_json::json!({})).unwrap();
    assert_eq!(config, EntraIdConfig::default());
    assert!(!config.enabled);
    assert!(config.group_overage.enabled);
    assert!(config.validate().is_ok());
}

#[test]
fn explicit_disable_and_deprecated_integration_alias_are_supported() {
    for name in ["entra_id", "experimental_entra_id"] {
        let integrations: IntegrationsConfig = serde_json::from_value(serde_json::json!({
            name: {"enabled": false, "auth_via_access_token": false, "group_overage": {"enabled": false}}
        })).unwrap();
        assert!(!integrations.entra_id.group_overage.enabled);
        assert!(integrations.entra_id.validate().is_ok());
    }
}

#[test]
fn overage_requires_access_token_auth_even_without_directory_endpoints() {
    let config: EntraIdConfig = serde_json::from_value(serde_json::json!({
        "enabled": false,
        "auth_via_access_token": false
    }))
    .unwrap();
    assert!(config.validate().is_err());
}
