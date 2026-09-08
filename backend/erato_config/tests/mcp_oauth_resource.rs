use erato_config::config::McpServerAuthenticationConfig;
use erato_config::config::McpServerConfig;

#[test]
fn oauth_resource_config_preserves_automatic_override_and_omission() {
    for (setting, expected) in [
        ("", None),
        (
            "resource = \"https://api.example.com\"",
            Some("https://api.example.com"),
        ),
        ("resource = \"\"", Some("")),
    ] {
        let config = config::Config::builder()
            .add_source(config::File::from_str(
                &format!(
                    r#"
[mcp_servers.entra]
url = "https://mcp.example.com/mcp"
transport_type = "streamable_http"
[mcp_servers.entra.authentication]
mode = "oauth2"
[mcp_servers.entra.authentication.oauth2]
client_id = "client"
scopes = ["https://api.example.com/Mcp.Read"]
{setting}
"#
                ),
                config::FileFormat::Toml,
            ))
            .build()
            .unwrap();
        let server: McpServerConfig = config.get("mcp_servers.entra").unwrap();
        let McpServerAuthenticationConfig::Oauth2 { oauth2 } = server.authentication else {
            panic!("expected OAuth configuration");
        };
        assert_eq!(oauth2.resource.as_deref(), expected);
    }
}
