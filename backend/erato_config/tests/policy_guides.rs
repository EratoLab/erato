use config::{Config, File, FileFormat};
use erato_config::config::{AppConfig, PolicyGuidesConfig};
use serde_json::json;

fn configured() -> AppConfig {
    AppConfig {
        policy_guides: Config::builder()
            .add_source(File::from_str(r#"
[policies.confidential]
enabled = true
question = "Is this confidential?"
choice_refuse = "Contains confidential information"
choice_allow = "Only public information"
decision_providers = ["removed", "secondary"]
[policies.confidential.metadata]
label = "Confidential information"
level = 2
tags = ["upload", "review"]
nested = { display = true }
[policies.disabled]
decision_providers = ["not-configured"]
"#, FileFormat::Toml))
            .build().unwrap().try_deserialize().unwrap(),
        decision_providers: serde_json::from_value(json!({
            "provider": {
                "old": {"archived":true},
                "active": {"provider_kind":"openai", "model_name":"test", "api_key":"private-credential"},
                "secondary": {"provider_kind":"llama_cpp", "base_url":"http://localhost:8080/v1"}
            },
            "replacement_providers": [{"old":"removed","new":"old"},{"old":"old","new":"active"}]
        })).unwrap(),
        ..Default::default()
    }
}

#[test]
fn policy_guides_parse_validate_and_project_without_credentials() {
    let empty: PolicyGuidesConfig = serde_json::from_value(json!({})).unwrap();
    assert!(empty.policies.is_empty());
    assert!(AppConfig::default().policy_guides.policies.is_empty());
    let mut config = configured();
    config.validate_decision_providers().unwrap();
    config.validate_policy_guides().unwrap();
    assert!(!config.policy_guides.policies["disabled"].enabled);
    config
        .desktop_sidecar
        .organization_configuration
        .show_tray_icon = Some(false);
    let projected =
        serde_json::to_value(config.desktop_sidecar_organization_configuration()).unwrap();
    assert_eq!(projected["show_tray_icon"], false);
    assert_eq!(
        projected["policy_guides"],
        serde_json::to_value(&config.policy_guides).unwrap()
    );
    assert_eq!(
        projected["policy_guides"]["policies"]["confidential"]["decision_providers"],
        json!(["removed", "secondary"])
    );
    assert_eq!(
        projected["policy_guides"]["policies"]["confidential"]["metadata"],
        json!({
            "label":"Confidential information", "level":2, "tags":["upload","review"], "nested":{"display":true}
        })
    );
    assert!(!projected.to_string().contains("private-credential"));
    assert!(projected.get("decision_providers").is_none());
    config.policy_guides.policies.clear();
    let cleared =
        serde_json::to_value(config.desktop_sidecar_organization_configuration()).unwrap();
    assert_eq!(cleared["policy_guides"], json!({"policies":{}}));
}

#[test]
fn policy_guides_validate_enabled_definitions_and_provider_references() {
    for field in ["question", "choice_refuse", "choice_allow"] {
        let mut config = configured();
        let mut policy =
            serde_json::to_value(&config.policy_guides.policies["confidential"]).unwrap();
        policy[field] = json!("  ");
        config.policy_guides.policies.insert(
            "confidential".into(),
            serde_json::from_value(policy).unwrap(),
        );
        assert!(config.validate_policy_guides().is_err(), "{field}");
    }
    for providers in [
        vec![],
        vec![""],
        vec!["active", "active"],
        vec!["missing"],
        vec!["active", "missing"],
    ] {
        let mut config = configured();
        config
            .policy_guides
            .policies
            .get_mut("confidential")
            .unwrap()
            .decision_providers = providers.iter().map(|s| s.to_string()).collect();
        assert!(config.validate_policy_guides().is_err(), "{providers:?}");
    }
    let mut config = configured();
    config
        .policy_guides
        .policies
        .insert(" ".into(), Default::default());
    assert!(config.validate_policy_guides().is_err());
    let mut config = configured();
    config.decision_providers.replacement_providers.clear();
    config
        .policy_guides
        .policies
        .get_mut("confidential")
        .unwrap()
        .decision_providers = vec!["old".into()];
    assert!(config.validate_policy_guides().is_err());
}

#[test]
fn policy_guides_metadata_supports_arbitrary_json_and_defaults_disabled() {
    let policies: PolicyGuidesConfig = serde_json::from_value(json!({"policies": {"future": {
        "metadata": {"null":null, "number":1.25, "array":[true, {"nested":[1,"x"]}]}
    }}}))
    .unwrap();
    assert!(!policies.policies["future"].enabled);
    assert_eq!(
        serde_json::from_value::<PolicyGuidesConfig>(serde_json::to_value(&policies).unwrap())
            .unwrap(),
        policies
    );
}
