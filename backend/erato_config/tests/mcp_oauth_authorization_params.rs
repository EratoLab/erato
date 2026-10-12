use erato_config::config::{ConfigSourceFile, McpRuntimeConfig, McpServerAuthenticationConfig};

fn source(params: &str) -> ConfigSourceFile {
    ConfigSourceFile {
        source_filename: "oauth.erato.toml".into(),
        contents: format!(
            r#"
[mcp_servers.tickets]
transport_type = "streamable_http"
url = "https://mcp.example.com/mcp"
[mcp_servers.tickets.authentication]
mode = "oauth2"
[mcp_servers.tickets.authentication.oauth2]
client_id = "test-client"
{params}
"#
        ),
    }
}

#[test]
fn oauth_authorization_params_default_to_empty_and_preserve_literal_values() {
    for params in ["", "authorization_params = {}"] {
        let config = McpRuntimeConfig::from_toml_sources(&[source(params)]).unwrap();
        let McpServerAuthenticationConfig::Oauth2 { oauth2 } =
            &config.mcp_servers["tickets"].authentication
        else {
            panic!("expected OAuth configuration");
        };
        assert!(oauth2.authorization_params.is_empty());
    }
    let config = McpRuntimeConfig::from_toml_sources(&[source(
        r#"authorization_params = { audience = "https://api.example.com/?a=1&b=2", prompt = "consent", login_hint = "ü + & %2B", State = "ignored-at-authorization" }"#,
    )])
    .unwrap();
    let McpServerAuthenticationConfig::Oauth2 { oauth2 } =
        &config.mcp_servers["tickets"].authentication
    else {
        panic!("expected OAuth configuration");
    };
    assert_eq!(
        oauth2.authorization_params["audience"],
        "https://api.example.com/?a=1&b=2"
    );
    assert_eq!(oauth2.authorization_params["login_hint"], "ü + & %2B");
    // Protected entries do not prevent config load; the URL adapter ignores them with WARN.
    assert_eq!(
        oauth2.authorization_params["State"],
        "ignored-at-authorization"
    );
}

#[test]
fn oauth_authorization_params_follow_existing_per_key_merge_semantics() {
    let base =
        source(r#"authorization_params = { audience = "api.example.com", prompt = "login" }"#);
    let override_source = ConfigSourceFile {
        source_filename: "admin-panel.toml".into(),
        contents: r#"[mcp_servers.tickets.authentication.oauth2.authorization_params]
prompt = "consent"
"#
        .into(),
    };
    for contents in [
        override_source.contents.as_str(),
        "[mcp_servers.tickets.authentication.oauth2.authorization_params]",
    ] {
        let config = McpRuntimeConfig::from_toml_sources(&[
            base.clone(),
            ConfigSourceFile {
                contents: contents.into(),
                ..override_source.clone()
            },
        ])
        .unwrap();
        let McpServerAuthenticationConfig::Oauth2 { oauth2 } =
            &config.mcp_servers["tickets"].authentication
        else {
            panic!("expected OAuth configuration");
        };
        assert_eq!(oauth2.authorization_params["audience"], "api.example.com");
        assert_eq!(
            oauth2.authorization_params["prompt"],
            if contents == override_source.contents {
                "consent"
            } else {
                "login"
            }
        );
    }
}
