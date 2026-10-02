use erato_config::config::McpServersGlobalConfig;

#[test]
fn mcp_visibility_preserves_omission_and_independent_overrides() {
    for parent in [false, true] {
        for chat in [None, Some(false), Some(true)] {
            for assistant in [None, Some(false), Some(true)] {
                let mut source = format!("show_frontend_tab = {parent}\n");
                if let Some(value) = chat {
                    source.push_str(&format!("show_in_chat_input = {value}\n"));
                }
                if let Some(value) = assistant {
                    source.push_str(&format!("show_in_assistant_editor = {value}\n"));
                }
                let parsed: McpServersGlobalConfig = config::Config::builder()
                    .add_source(config::File::from_str(&source, config::FileFormat::Toml))
                    .build()
                    .unwrap()
                    .try_deserialize()
                    .unwrap();
                assert_eq!(parsed.show_frontend_tab, parent);
                assert_eq!(parsed.show_in_chat_input, chat);
                assert_eq!(parsed.show_in_assistant_editor, assistant);
            }
        }
    }
    let parsed: McpServersGlobalConfig = config::Config::builder()
        .add_source(config::File::from_str("", config::FileFormat::Toml))
        .build()
        .unwrap()
        .try_deserialize()
        .unwrap();
    assert_eq!(parsed, McpServersGlobalConfig::default());
}
