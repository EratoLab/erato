use erato_config::config::{
    AllChatProvidersConfig, AppConfig, ChatProviderConfig, ChatProvidersConfig, SummaryConfig,
};
use std::collections::HashMap;

#[test]
fn embedded_image_retrieval_defaults_and_overrides() {
    let mut config = AppConfig {
        chat_providers: Some(ChatProvidersConfig {
            priority_order: vec!["model".into()],
            all_providers: AllChatProvidersConfig::default(),
            providers: HashMap::from([("model".into(), ChatProviderConfig::default())]),
            summary: SummaryConfig::default(),
        }),
        ..Default::default()
    };
    assert!(!config.embedded_image_retrieval_enabled("model"));
    config
        .chat_providers
        .as_mut()
        .unwrap()
        .all_providers
        .enable_embedded_image_retrieval_tool = true;
    assert!(config.embedded_image_retrieval_enabled("model"));
    config
        .chat_providers
        .as_mut()
        .unwrap()
        .providers
        .get_mut("model")
        .unwrap()
        .enable_embedded_image_retrieval_tool = Some(false);
    assert!(!config.embedded_image_retrieval_enabled("model"));
    config
        .chat_providers
        .as_mut()
        .unwrap()
        .all_providers
        .enable_embedded_image_retrieval_tool = false;
    config
        .chat_providers
        .as_mut()
        .unwrap()
        .providers
        .get_mut("model")
        .unwrap()
        .enable_embedded_image_retrieval_tool = Some(true);
    assert!(config.embedded_image_retrieval_enabled("model"));
    let mut provider = config
        .chat_providers
        .take()
        .unwrap()
        .providers
        .remove("model")
        .unwrap();
    provider.provider_kind = "azure_openai".into();
    provider.base_url = Some("https://example.openai.azure.com".into());
    let provider = provider.migrate_azure_openai_to_openai().unwrap();
    assert_eq!(provider.enable_embedded_image_retrieval_tool, Some(true));
    config.chat_provider = Some(provider);
    assert!(config.embedded_image_retrieval_enabled("default"));
    config
        .chat_provider
        .as_mut()
        .unwrap()
        .enable_embedded_image_retrieval_tool = None;
    assert!(!config.embedded_image_retrieval_enabled("default"));
}

#[test]
fn embedded_image_retrieval_settings_deserialize() {
    let defaults: AllChatProvidersConfig = serde_json::from_str("{}").unwrap();
    assert!(!defaults.enable_embedded_image_retrieval_tool);
    for enabled in [true, false] {
        let global: AllChatProvidersConfig = serde_json::from_value(serde_json::json!({
            "enable_embedded_image_retrieval_tool": enabled,
        }))
        .unwrap();
        assert_eq!(global.enable_embedded_image_retrieval_tool, enabled);
        let provider: ChatProviderConfig = serde_json::from_value(serde_json::json!({
            "provider_kind": "openai", "model_name": "vision",
            "enable_embedded_image_retrieval_tool": enabled,
        }))
        .unwrap();
        assert_eq!(provider.enable_embedded_image_retrieval_tool, Some(enabled));
    }
    let provider: ChatProviderConfig = serde_json::from_value(serde_json::json!({
        "provider_kind": "openai", "model_name": "vision",
    }))
    .unwrap();
    assert_eq!(provider.enable_embedded_image_retrieval_tool, None);
}
