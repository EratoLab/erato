use erato_config::config::{
    AppConfig, ChatProviderConfig, ChatProvidersConfig, MessageTextActionsConfig,
    PromptSourceSpecification,
};
use std::collections::HashMap;

#[test]
fn both_actions_are_off_by_default() {
    let config: MessageTextActionsConfig = serde_json::from_str("{}").unwrap();
    assert_eq!(config, MessageTextActionsConfig::default());
    assert!(!config.quote_enabled);
    assert!(!config.explain.enabled);
    assert_eq!(config.explain.chat_provider_id, None);
    assert_eq!(
        AppConfig::default().message_text_actions,
        MessageTextActionsConfig::default()
    );
}

#[test]
fn quote_needs_no_provider() {
    let mut config = AppConfig::default();
    config.message_text_actions.quote_enabled = true;
    assert!(config.validate_message_text_actions().is_ok());
}

#[test]
fn enabled_explain_requires_a_prompt_and_an_existing_provider() {
    let mut config = AppConfig::default();
    assert!(config.validate_message_text_actions().is_ok());
    config.message_text_actions.explain.enabled = true;
    config.message_text_actions.explain.chat_provider_id = Some("explainer".into());
    config.chat_providers = Some(ChatProvidersConfig {
        replacement_providers: Vec::new(),
        priority_order: vec!["explainer".into()],
        all_providers: Default::default(),
        providers: HashMap::from([("explainer".into(), ChatProviderConfig::default())]),
        summary: Default::default(),
    });
    assert!(config.validate_message_text_actions().is_err());

    config.message_text_actions.explain.prompt = Some(PromptSourceSpecification::Static {
        content: " ".into(),
    });
    assert!(config.validate_message_text_actions().is_err());
    config.message_text_actions.explain.prompt = Some(PromptSourceSpecification::Static {
        content: "Explain it.".into(),
    });
    assert!(config.validate_message_text_actions().is_ok());

    for id in [None, Some(""), Some(" "), Some("missing")] {
        config.message_text_actions.explain.chat_provider_id = id.map(Into::into);
        assert!(config.validate_message_text_actions().is_err(), "{id:?}");
    }
}

#[test]
fn the_built_in_prompt_applies_when_none_is_configured() {
    let defaults = AppConfig::config_schema_builder(None, false)
        .unwrap()
        .build()
        .unwrap();
    let prompt = defaults
        .get_string("message_text_actions.explain.prompt")
        .expect("default prompt");
    assert!(prompt.contains("simple words"));
    assert!(
        !defaults
            .get_bool("message_text_actions.explain.enabled")
            .unwrap()
    );
    assert!(
        !defaults
            .get_bool("message_text_actions.quote_enabled")
            .unwrap()
    );
}
