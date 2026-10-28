use erato_config::config::{
    AppConfig, ChatProviderConfig, ChatProvidersConfig, ProviderReplacement,
};
use std::collections::HashMap;

fn config() -> AppConfig {
    AppConfig {
        chat_providers: Some(ChatProvidersConfig {
            priority_order: vec!["old".into(), "new".into()],
            replacement_providers: vec![
                ProviderReplacement { old: "removed".into(), new: "old".into() },
                ProviderReplacement { old: "old".into(), new: "new".into() },
            ],
            providers: HashMap::from([
                ("old".into(), serde_json::from_value(serde_json::json!({"archived": true, "provider_kind": "azure_openai", "model_name": "legacy"})).unwrap()),
                ("new".into(), ChatProviderConfig { provider_kind: "openai".into(), model_name: "new-model".into(), ..Default::default() }),
            ]),
            all_providers: Default::default(),
            summary: Default::default(),
        }),
        ..Default::default()
    }
}

#[test]
fn resolves_removed_and_archived_ids_without_losing_historical_metadata() {
    let config = config().migrate_chat_providers();
    config.validate_chat_providers().unwrap();
    assert_eq!(config.resolve_chat_provider_id("removed").unwrap(), "new");
    assert_eq!(
        config.determine_chat_provider(None, Some("old")).unwrap(),
        "new"
    );
    assert_eq!(config.available_chat_providers(None), vec!["new"]);
    assert_eq!(config.get_chat_provider("old").model_name, "legacy");
    assert!(config.resolve_chat_provider_id("missing").is_err());
}

#[test]
fn rejects_cycles_duplicates_missing_targets_and_active_sources() {
    for replacement in [
        ProviderReplacement {
            old: "new".into(),
            new: "old".into(),
        },
        ProviderReplacement {
            old: "old".into(),
            new: "new".into(),
        },
        ProviderReplacement {
            old: "absent".into(),
            new: "missing".into(),
        },
    ] {
        let mut config = config();
        config
            .chat_providers
            .as_mut()
            .unwrap()
            .replacement_providers
            .push(replacement);
        assert!(config.validate_chat_providers().is_err());
    }
    let mut config = config();
    config
        .chat_providers
        .as_mut()
        .unwrap()
        .replacement_providers[1]
        .new = "removed".into();
    assert!(config.validate_chat_providers().is_err());
}

#[test]
fn speech_resolves_absent_and_archived_providers() {
    for kind in ["openai", "openai_realtime"] {
        let config = AppConfig {
            speech_providers: serde_json::from_value(serde_json::json!({
                "provider": {"old": {"archived": true}, "new": {"provider_kind": kind, "model_name": "voice-model", "voice": "voice"}},
                "replacement_providers": [{"old": "missing", "new": "old"}, {"old": "old", "new": "new"}]
            })).unwrap(),
            ..Default::default()
        };
        assert_eq!(config.resolve_speech_provider_id("missing").unwrap(), "new");
        assert_eq!(config.speech_providers.provider["new"].provider_kind, kind);
        assert!(config.speech_providers.provider["old"].archived);
    }
}
