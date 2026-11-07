use erato_config::config::{AppConfig, ChatProviderConfig, ChatProvidersConfig, ToolLabelsConfig};
use std::collections::HashMap;

#[test]
fn tool_labels_are_off_by_default() {
    let config: ToolLabelsConfig = serde_json::from_str("{}").unwrap();
    assert_eq!(config, ToolLabelsConfig::default());
    assert!(!config.enabled);
    assert_eq!(config.chat_provider_id, None);
    assert_eq!(
        AppConfig::default().tool_labels,
        ToolLabelsConfig::default()
    );
}

#[test]
fn enabled_tool_labels_require_an_explicit_existing_provider() {
    let mut config = AppConfig::default();
    assert!(config.validate_tool_labels().is_ok());
    config.tool_labels.enabled = true;
    assert!(config.validate_tool_labels().is_err());
    config.tool_labels.chat_provider_id = Some("labeller".into());
    assert!(config.validate_tool_labels().is_err());
    config.chat_providers = Some(ChatProvidersConfig {
        replacement_providers: Vec::new(),
        priority_order: vec!["main".into(), "labeller".into()],
        all_providers: Default::default(),
        providers: HashMap::from([
            ("main".into(), ChatProviderConfig::default()),
            ("labeller".into(), ChatProviderConfig::default()),
        ]),
        summary: Default::default(),
    });
    assert!(config.validate_tool_labels().is_ok());
    for id in ["", " ", "missing"] {
        config.tool_labels.chat_provider_id = Some(id.into());
        assert!(config.validate_tool_labels().is_err(), "{id:?}");
    }
    config.tool_labels.chat_provider_id = None;
    assert!(config.validate_tool_labels().is_err());
}
