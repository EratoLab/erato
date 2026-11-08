use erato_config::config::{
    McpProtocolMode, McpRuntimeConfig, McpServerConfig, has_hidden_chars, is_hidden_char,
    is_invisible_format_char, validate_mcp_server_ids,
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
        "display_name = \"CRM\u{00AD}\"".to_string(),
        "display_name = \"C\u{034F}RM\"".to_string(),
        "display_name = \"\u{3164}\"".to_string(),
        "display_name = \"CRM\u{115F}\"".to_string(),
        "display_name = \"CRM\u{180E}\"".to_string(),
        "display_name = \"CRM\u{2064}\"".to_string(),
        "display_name = \"CRM\u{1D173}\"".to_string(),
        "display_name = \"CRM\u{FE00}\"".to_string(),
        "display_name = \"CRM\u{E0100}\"".to_string(),
        "display_name = \"\u{FE0F}CRM\"".to_string(),
        "display_name = \"CRM \u{FE0F}\"".to_string(),
        "display_name = \"CRM \u{2600}\u{FE0F}\u{FE0F}\"".to_string(),
    ] {
        let server = parse(&invalid).unwrap();
        assert!(
            validate_mcp_server_ids(&HashMap::from([("files".into(), server)])).is_err(),
            "{invalid}"
        );
    }
}

/// Default_Ignorable_Code_Point in Unicode 16's DerivedCoreProperties.txt.
const DEFAULT_IGNORABLE: [(u32, u32); 17] = [
    (0x00AD, 0x00AD),
    (0x034F, 0x034F),
    (0x061C, 0x061C),
    (0x115F, 0x1160),
    (0x17B4, 0x17B5),
    (0x180B, 0x180F),
    (0x200B, 0x200F),
    (0x202A, 0x202E),
    (0x2060, 0x206F),
    (0x3164, 0x3164),
    (0xFE00, 0xFE0F),
    (0xFEFF, 0xFEFF),
    (0xFFA0, 0xFFA0),
    (0xFFF0, 0xFFF8),
    (0x1BCA0, 0x1BCA3),
    (0x1D173, 0x1D17A),
    (0xE0000, 0xE0FFF),
];

#[test]
fn invisible_formatting_characters_are_exactly_the_default_ignorable_ones() {
    for c in (0..=0x10FFFF).filter_map(char::from_u32) {
        let listed = DEFAULT_IGNORABLE
            .iter()
            .any(|(start, end)| (*start..=*end).contains(&u32::from(c)));
        assert_eq!(
            is_invisible_format_char(c),
            listed,
            "U+{:04X}",
            u32::from(c)
        );
    }
    let named = parse("display_name = \"Café 365 \u{1F600}\"").unwrap();
    assert!(validate_mcp_server_ids(&HashMap::from([("crm".into(), named)])).is_ok());
}

#[test]
fn a_presentation_selector_is_hidden_only_where_it_styles_no_character() {
    for (previous, c) in [
        (Some('\u{2764}'), '\u{FE0F}'),
        (Some('\u{2764}'), '\u{FE0E}'),
        (Some('1'), '\u{FE0F}'),
        (Some('a'), 'b'),
        (None, 'a'),
    ] {
        assert!(!is_hidden_char(previous, c), "{previous:?} {c:?}");
    }
    for (previous, c) in [
        (None, '\u{FE0F}'),
        (Some(' '), '\u{FE0F}'),
        (Some('\n'), '\u{FE0E}'),
        (Some('\u{7}'), '\u{FE0F}'),
        (Some('\u{FE0F}'), '\u{FE0F}'),
        (Some('\u{200B}'), '\u{FE0E}'),
        (Some('\u{2764}'), '\u{FE00}'),
        (Some('\u{2764}'), '\u{E0100}'),
        (Some('\u{2764}'), '\u{200B}'),
    ] {
        assert!(is_hidden_char(previous, c), "{previous:?} {c:?}");
    }

    assert!(!has_hidden_chars(
        "I \u{2764}\u{FE0F} it, 1\u{FE0F}\u{20E3}"
    ));
    assert!(has_hidden_chars("\u{2764}\u{FE0F}\u{FE0E}"));
    let named = parse("display_name = \"Weather \u{2600}\u{FE0F}\"").unwrap();
    assert!(validate_mcp_server_ids(&HashMap::from([("weather".into(), named)])).is_ok());
}
