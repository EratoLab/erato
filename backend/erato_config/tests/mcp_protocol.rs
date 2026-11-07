use erato_config::config::{
    McpProtocolMode, McpRuntimeConfig, McpServerConfig, is_invisible_format_char,
    validate_mcp_server_ids,
};
use std::collections::HashMap;

fn parse(mode: &str) -> Result<McpServerConfig, config::ConfigError> {
    config::Config::builder()
        .add_source(config::File::from_str(
            &format!("transport_type = 'streamable_http'\nurl = 'http://localhost/mcp'\n{mode}"),
            config::FileFormat::Toml,
        ))
        .build()?
        .try_deserialize()
}

#[test]
fn protocol_defaults_and_overrides_are_backwards_compatible() {
    assert_eq!(parse("").unwrap().protocol_mode, McpProtocolMode::Auto);
    assert_eq!(
        parse("protocol_mode = 'legacy'").unwrap().protocol_mode,
        McpProtocolMode::Legacy
    );
    assert_eq!(
        parse("protocol_mode = 'stateless'").unwrap().protocol_mode,
        McpProtocolMode::Stateless
    );
    assert!(parse("protocol_mode = 'unknown'").is_err());
    let mut server = parse("protocol_mode = 'stateless'").unwrap();
    server.transport_type = "sse".into();
    assert!(validate_mcp_server_ids(&HashMap::from([("files".into(), server)])).is_err());
}

#[test]
fn display_names_are_optional_validated_and_fall_back_to_the_tidied_id() {
    assert_eq!(parse("").unwrap().display_name, None);
    let named = parse("display_name = 'Dynamics 365'").unwrap();
    assert_eq!(named.display_name.as_deref(), Some("Dynamics 365"));
    let mut runtime = McpRuntimeConfig::default();
    runtime.mcp_servers.insert("dynamics".into(), named);
    runtime
        .mcp_servers
        .insert("web_access".into(), parse("").unwrap());
    assert!(validate_mcp_server_ids(&runtime.mcp_servers).is_ok());
    assert_eq!(runtime.mcp_server_display_name("dynamics"), "Dynamics 365");
    assert_eq!(runtime.mcp_server_display_name("web_access"), "Web access");
    assert_eq!(runtime.mcp_server_display_name("notion"), "Notion");
    assert_eq!(runtime.mcp_server_display_name("mcp--CRM_v2"), "Mcp CRM v2");
    assert_eq!(runtime.mcp_server_display_name("___"), "___");

    for invalid in [
        "display_name = '   '".to_string(),
        "display_name = \"bad\\nname\"".to_string(),
        format!("display_name = '{}'", "ä".repeat(65)),
        "display_name = \"CRM\u{202E}evil\"".to_string(),
        "display_name = \"CRM\u{061C}\"".to_string(),
        "display_name = \"C\u{200B}RM\"".to_string(),
        "display_name = \"C\u{200D}RM\"".to_string(),
        "display_name = \"C\u{2060}RM\"".to_string(),
        "display_name = \"\u{FEFF}CRM\"".to_string(),
        "display_name = \"CRM\u{E0001}\u{E0065}\u{E0076}\u{E0069}\u{E006C}\u{E007F}\"".to_string(),
        "display_name = \"\u{200B}\"".to_string(),
    ] {
        let server = parse(&invalid).unwrap();
        assert!(
            validate_mcp_server_ids(&HashMap::from([("files".into(), server)])).is_err(),
            "{invalid}"
        );
    }
}

#[test]
fn invisible_formatting_characters_are_named_one_by_one() {
    for c in [
        '\u{061C}',
        '\u{200B}',
        '\u{200C}',
        '\u{200D}',
        '\u{200E}',
        '\u{200F}',
        '\u{202A}',
        '\u{202E}',
        '\u{2060}',
        '\u{2066}',
        '\u{2069}',
        '\u{FEFF}',
        '\u{E0000}',
        '\u{E0041}',
        '\u{E007F}',
    ] {
        assert!(is_invisible_format_char(c), "U+{:04X}", c as u32);
    }
    for c in [
        'a',
        ' ',
        '\u{00AD}',
        '\u{061B}',
        '\u{061D}',
        '\u{200A}',
        '\u{2010}',
        '\u{2029}',
        '\u{202F}',
        '\u{2061}',
        '\u{206A}',
        '\u{FEFE}',
        '\u{FF0D}',
        '\u{DFFFF}',
        '\u{E0080}',
        '\u{E0100}',
        '\u{1F600}',
    ] {
        assert!(!is_invisible_format_char(c), "U+{:04X}", c as u32);
    }
    let named = parse("display_name = \"Café 365 \u{1F600}\"").unwrap();
    assert!(validate_mcp_server_ids(&HashMap::from([("crm".into(), named)])).is_ok());
}
