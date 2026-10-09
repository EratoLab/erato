use erato_config::config::{
    AppConfig, ChatHistoryCompactionConfig, ChatProviderConfig, ChatProvidersConfig,
};
use std::collections::HashMap;

#[test]
fn compaction_defaults_are_disabled_manual_and_soft_targeted() {
    let config: ChatHistoryCompactionConfig = serde_json::from_str("{}").unwrap();
    assert_eq!(config, ChatHistoryCompactionConfig::default());
    assert!(!config.enabled);
    assert_eq!(config.trigger_on_token_limit_threshold_percentage, 80);
    assert_eq!(config.target_compaction_token_limit_percentage, 10);
    assert!(serde_json::from_str::<ChatHistoryCompactionConfig>(r#"{"mode":"truncate"}"#).is_err());
    assert!(
        serde_json::from_str::<ChatHistoryCompactionConfig>(r#"{"trigger_mode":"automatic"}"#)
            .is_err()
    );
    assert!(
        serde_json::from_str::<ChatHistoryCompactionConfig>(
            r#"{"target_compaction_token_limit_percentage":-1}"#
        )
        .is_err()
    );
}

#[test]
fn enabled_compaction_requires_explicit_existing_provider() {
    let mut config = AppConfig::default();
    assert!(config.validate_chat_history_compaction().is_ok());
    config.chat_history_compaction.enabled = true;
    assert!(config.validate_chat_history_compaction().is_err());
    config.chat_history_compaction.chat_provider_id = Some("summary".into());
    assert!(config.validate_chat_history_compaction().is_err());
    config.chat_providers = Some(ChatProvidersConfig {
        priority_order: vec!["summary".into()],
        all_providers: Default::default(),
        providers: HashMap::from([("summary".into(), ChatProviderConfig::default())]),
        summary: Default::default(),
    });
    assert!(config.validate_chat_history_compaction().is_ok());
    for id in ["", " ", "missing"] {
        config.chat_history_compaction.chat_provider_id = Some(id.into());
        assert!(config.validate_chat_history_compaction().is_err());
    }
}

#[test]
fn percentages_accept_boundaries_and_reject_above_one_hundred() {
    let mut config = AppConfig::default();
    for percentage in [0, 1, 80, 100] {
        config
            .chat_history_compaction
            .trigger_on_token_limit_threshold_percentage = percentage;
        config
            .chat_history_compaction
            .target_compaction_token_limit_percentage = percentage;
        assert!(config.validate_chat_history_compaction().is_ok());
    }
    config
        .chat_history_compaction
        .target_compaction_token_limit_percentage = 101;
    assert!(config.validate_chat_history_compaction().is_err());
    config
        .chat_history_compaction
        .target_compaction_token_limit_percentage = 10;
    config
        .chat_history_compaction
        .trigger_on_token_limit_threshold_percentage = 101;
    assert!(config.validate_chat_history_compaction().is_err());
}
