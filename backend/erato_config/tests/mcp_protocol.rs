use erato_config::config::{
    McpProtocolMode, McpRuntimeConfig, McpServerConfig, McpServersGlobalConfig, has_hidden_chars,
    is_invisible_format_char, mark_hidden_chars, validate_mcp_server_ids,
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

fn parse_global(toml: &str) -> Result<McpServersGlobalConfig, config::ConfigError> {
    config::Config::builder()
        .add_source(config::File::from_str(toml, config::FileFormat::Toml))
        .build()?
        .try_deserialize()
}

#[test]
fn surface_hints_are_opt_in() {
    assert!(!parse("").unwrap().surface_hints);
    assert!(parse("surface_hints = true").unwrap().surface_hints);
    assert!(parse_global("").unwrap().surfaces.is_empty());
}

#[test]
fn configured_surface_lists_keep_their_order_and_are_validated() {
    let global = parse_global(
        "[surfaces.teams-bot]\naccept = ['image/png']\n\n[surfaces.excel]\naccept = ['image/svg+xml', 'image/png', 'application/pdf']\n\n[surfaces.web]\naccept = []\n",
    )
    .unwrap();
    global.validate().unwrap();
    assert_eq!(global.surfaces["teams-bot"].accept, ["image/png"]);
    assert_eq!(
        global.surfaces["excel"].accept,
        ["image/svg+xml", "image/png", "application/pdf"]
    );
    assert!(global.surfaces["web"].accept.is_empty());

    for invalid in [
        "[surfaces.web]\naccept = ['png']",
        "[surfaces.web]\naccept = ['image/png ']",
        "[surfaces.web]\naccept = ['image/*']",
        "[surfaces.web]\naccept = ['*/*']",
        "[surfaces.web]\naccept = ['*/png']",
        "[surfaces.web]\naccept = ['image/']",
        "[surfaces.web]\naccept = ['image/png;q=0.5']",
    ] {
        assert!(
            parse_global(invalid).unwrap().validate().is_err(),
            "{invalid}"
        );
    }
    // A surface entry names its list; anything else is a typo.
    assert!(parse_global("[surfaces.web]\nformats = ['image/png']").is_err());
}

#[test]
fn configured_surface_names_have_the_shape_of_the_built_in_ones() {
    let is_valid = |name: &str| {
        parse_global(&format!("[surfaces.'{name}']\naccept = ['image/png']"))
            .unwrap()
            .validate()
            .is_ok()
    };
    let longest = "a".repeat(32);
    for valid in [
        "web",
        "outlook",
        "word",
        "addin-neutral",
        "teams",
        "teams-bot",
        "kiosk",
        "2nd-screen",
        longest.as_str(),
    ] {
        assert!(is_valid(valid), "{valid}");
    }
    let too_long = "a".repeat(33);
    for invalid in [
        "Kiosk",
        "my_surface",
        "-x",
        "two words",
        "",
        too_long.as_str(),
    ] {
        assert!(!is_valid(invalid), "{invalid}");
    }
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

fn hidden_positions(text: &str) -> Vec<usize> {
    mark_hidden_chars(text.chars())
        .enumerate()
        .filter_map(|(index, (_, hidden))| hidden.then_some(index))
        .collect()
}

#[test]
fn a_selector_or_joiner_is_hidden_only_where_it_styles_or_joins_no_emoji() {
    // Regional indicators and Unicode 16's newest emoji (harp, fingerprint,
    // face with bags under eyes) all have Emoji=Yes.
    for base in [
        '\u{00A9}',
        '\u{2764}',
        '\u{1F1E6}',
        '\u{1F1FF}',
        '\u{1FA89}',
        '\u{1FAC6}',
        '\u{1FAE9}',
    ] {
        for selector in ['\u{FE0E}', '\u{FE0F}'] {
            assert_eq!(
                hidden_positions(&format!("{base}{selector}")),
                [] as [usize; 0],
                "U+{:04X}",
                u32::from(base)
            );
        }
    }
    // Keycap bases have Emoji=Yes too, but read as plain text: a selector on
    // one could tell two IDs apart unseen, unless it makes a real keycap.
    for base in "#*0123456789".chars() {
        for selector in ['\u{FE0E}', '\u{FE0F}'] {
            for text in [format!("{base}{selector}"), format!("{base}{selector}x")] {
                assert_eq!(hidden_positions(&text), [1], "{text:?}");
            }
        }
        assert_eq!(
            hidden_positions(&format!("{base}\u{FE0F}\u{20E3}")),
            [] as [usize; 0],
            "U+{:04X}",
            u32::from(base)
        );
        assert_eq!(
            hidden_positions(&format!("{base}\u{FE0E}\u{20E3}")),
            [1],
            "U+{:04X}",
            u32::from(base)
        );
    }
    for base in ['a', 'Z', '\u{00E9}', '\u{4E2D}', '\u{1F000}', '\u{20E3}'] {
        assert_eq!(
            hidden_positions(&format!("{base}\u{FE0F}")),
            [1],
            "U+{:04X}",
            u32::from(base)
        );
    }

    for (text, hidden) in [
        ("1\u{FE0F}\u{20E3}", vec![]),
        ("#\u{FE0F}\u{20E3}", vec![]),
        ("p_1\u{FE0F}", vec![3]),
        ("1\u{FE0F}x", vec![1]),
        ("p_1\u{FE0E}", vec![3]),
        ("#\u{FE0F}", vec![1]),
        ("INV-1\u{FE0F}2\u{FE0E}3", vec![5, 7]),
        ("1\u{FE0F}\u{FE0F}\u{20E3}", vec![1, 2]),
        ("1\u{1F3FD}\u{FE0F}", vec![2]),
        ("\u{1F44D}\u{1F3FD}\u{FE0F}", vec![]),
        ("a\u{1F3FD}\u{FE0F}", vec![2]),
        ("\u{1F3FD}\u{FE0F}", vec![1]),
        ("\u{2764}\u{FE0F}\u{FE0E}", vec![2]),
        ("\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}", vec![]),
        ("\u{1F3F3}\u{FE0F}\u{200D}\u{1F308}", vec![]),
        ("\u{1F469}\u{1F3FD}\u{200D}\u{1F4BB}", vec![]),
        ("\u{1F000}\u{FE0F}\u{200D}\u{1F469}", vec![1, 2]),
        ("\u{1F1E9}\u{200D}\u{1F1EA}", vec![1]),
        ("\u{1F468}\u{200D}a", vec![1]),
        ("a\u{200D}b", vec![1]),
        ("\u{1F3F4}\u{E0067}\u{E0062}\u{E007F}", vec![1, 2, 3]),
    ] {
        assert_eq!(hidden_positions(text), hidden, "{text:?}");
    }

    let valid = |name: &str| {
        let server = parse(&format!("display_name = \"{name}\"")).unwrap();
        validate_mcp_server_ids(&HashMap::from([("crm".into(), server)])).is_ok()
    };
    for name in [
        "Weather \u{2600}\u{FE0F}",
        "Team \u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}",
        "Pride \u{1F3F3}\u{FE0F}\u{200D}\u{1F308}",
    ] {
        assert!(valid(name), "{name:?}");
    }
    for name in [
        "Wea\u{FE0F}ther",
        "CRM\u{FE0E}",
        "C\u{200D}RM",
        "CRM 1\u{FE0F}",
    ] {
        assert!(!valid(name), "{name:?}");
    }
    assert!(!has_hidden_chars(
        "I \u{2764}\u{FE0F} it, 1\u{FE0F}\u{20E3}"
    ));
}
