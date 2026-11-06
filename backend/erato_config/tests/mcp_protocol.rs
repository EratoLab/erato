use erato_config::config::{
    McpProtocolMode, McpRuntimeConfig, McpServerConfig, validate_mcp_server_ids,
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
    ] {
        let server = parse(&invalid).unwrap();
        assert!(
            validate_mcp_server_ids(&HashMap::from([("files".into(), server)])).is_err(),
            "{invalid}"
        );
    }
}
