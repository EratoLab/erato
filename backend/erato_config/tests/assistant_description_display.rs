use erato_config::config::{AssistantToolsMenuDescriptionDisplay, AssistantsConfig};

#[test]
fn assistant_description_display_defaults_to_truncated() {
    let config: AssistantsConfig = serde_json::from_str("{}").unwrap();
    assert_eq!(
        config.tools_menu_description_display,
        AssistantToolsMenuDescriptionDisplay::Truncated
    );
    assert_eq!(
        AssistantsConfig::default().tools_menu_description_display,
        config.tools_menu_description_display
    );
}

#[test]
fn assistant_description_display_accepts_only_supported_modes() {
    for mode in ["none", "truncated", "full"] {
        let config = config::Config::builder()
            .add_source(config::File::from_str(
                &format!("[assistants]\ntools_menu_description_display = \"{mode}\""),
                config::FileFormat::Toml,
            ))
            .build()
            .unwrap();
        let assistants: AssistantsConfig = config.get("assistants").unwrap();
        assert_eq!(
            serde_json::to_value(assistants.tools_menu_description_display).unwrap(),
            mode
        );
    }
    assert!(
        serde_json::from_str::<AssistantsConfig>(
            r#"{"tools_menu_description_display": "invalid"}"#
        )
        .is_err()
    );
}
