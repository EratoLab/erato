use erato_config::config::{McpProtocolMode, McpServerConfig, validate_mcp_server_ids};
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
