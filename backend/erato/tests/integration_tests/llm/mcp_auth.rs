use crate::test_utils::{JwtTokenBuilder, setup_mock_llm_server};
use crate::{MIGRATOR, test_app_state};
use erato::config::{
    McpServerAuthenticationConfig, McpServerConfig, McpServerFixedAuthenticationConfig,
    McpServerForwardedAuthenticationConfig, McpServerForwardedCredential,
};
use erato::services::mcp_manager::McpRequestAuthContext;
use erato::services::mcp_manager::McpServers;
use genai::chat::ToolCall as GenaiToolCall;
use sea_orm::prelude::Uuid;
use serde_json::json;
use sqlx::Pool;
use sqlx::postgres::Postgres;
use std::collections::HashSet;
use std::env;

fn mock_mcp_base_url() -> String {
    env::var("TEST_MOCK_MCP_SERVER_BASE_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:44321".to_string())
}

fn mcp_server_config(
    base_url: &str,
    path: &str,
    authentication: McpServerAuthenticationConfig,
) -> McpServerConfig {
    McpServerConfig {
        transport_type: "streamable_http".to_string(),
        url: format!("{base_url}{path}"),
        http_headers: None,
        authentication,
        max_session_idle_seconds: None,
    }
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn test_mcp_auth_variants_execute_expected_tools(pool: Pool<Postgres>) {
    let mock_mcp_base_url = mock_mcp_base_url();
    let (mut app_config, _llm_server) = setup_mock_llm_server(None).await;

    app_config.mcp_servers.insert(
        "auth-none".to_string(),
        mcp_server_config(
            &mock_mcp_base_url,
            "/mcp/auth-none",
            McpServerAuthenticationConfig::None,
        ),
    );
    app_config.mcp_servers.insert(
        "auth-fixed".to_string(),
        mcp_server_config(
            &mock_mcp_base_url,
            "/mcp/auth-fixed",
            McpServerAuthenticationConfig::Fixed {
                fixed: McpServerFixedAuthenticationConfig {
                    api_key: "fixed-api-key-secret".to_string(),
                    header_name: "Authorization".to_string(),
                    prefix: "Bearer ".to_string(),
                },
            },
        ),
    );
    app_config.mcp_servers.insert(
        "auth-fixed-custom".to_string(),
        mcp_server_config(
            &mock_mcp_base_url,
            "/mcp/auth-fixed-custom",
            McpServerAuthenticationConfig::Fixed {
                fixed: McpServerFixedAuthenticationConfig {
                    api_key: "fixed-api-key-secret".to_string(),
                    header_name: "X-API-Key".to_string(),
                    prefix: "Token ".to_string(),
                },
            },
        ),
    );
    app_config.mcp_servers.insert(
        "auth-forwarded-access".to_string(),
        mcp_server_config(
            &mock_mcp_base_url,
            "/mcp/auth-forwarded-access",
            McpServerAuthenticationConfig::Forwarded {
                forwarded: McpServerForwardedAuthenticationConfig {
                    credential: McpServerForwardedCredential::AccessToken,
                },
            },
        ),
    );
    app_config.mcp_servers.insert(
        "auth-forwarded-oidc".to_string(),
        mcp_server_config(
            &mock_mcp_base_url,
            "/mcp/auth-forwarded-oidc",
            McpServerAuthenticationConfig::Forwarded {
                forwarded: McpServerForwardedAuthenticationConfig {
                    credential: McpServerForwardedCredential::OidcIdToken,
                },
            },
        ),
    );

    let _app_state = test_app_state(app_config.clone(), pool).await;
    let mcp_servers = McpServers::new(&app_config);
    let allowed_oidc_token = JwtTokenBuilder::new().subject("allowed-user").build();
    let cases = [
        ("auth-none", "auth_none_probe", None),
        ("auth-fixed", "auth_fixed_api_key_probe", None),
        ("auth-fixed-custom", "auth_fixed_custom_header_probe", None),
        (
            "auth-forwarded-access",
            "auth_forwarded_access_probe",
            Some("access:allowed-user"),
        ),
        ("auth-forwarded-oidc", "auth_forwarded_oidc_probe", None),
    ];

    for (server_id, expected_tool, access_token) in cases {
        let chat_id = Uuid::new_v4();
        let server_filter = HashSet::from([server_id.to_string()]);
        let auth_context = McpRequestAuthContext {
            oidc_token: Some(&allowed_oidc_token),
            access_token,
        };
        let tools = mcp_servers
            .list_tools_for_server_ids(chat_id, Some(&server_filter), &auth_context)
            .await
            .unwrap_or_else(|e| panic!("Failed to discover tools for '{}': {}", server_id, e));

        let tool = tools
            .iter()
            .find(|tool| tool.tool.name == expected_tool)
            .unwrap_or_else(|| {
                panic!(
                    "Expected tool '{}' on server '{}'",
                    expected_tool, server_id
                )
            })
            .clone();

        let managed_tool_call = mcp_servers
            .convert_tool_call_to_managed_tool_call(
                chat_id,
                GenaiToolCall {
                    call_id: "call_123".to_string(),
                    fn_name: expected_tool.to_string(),
                    fn_arguments: json!({}),
                    thought_signatures: None,
                },
                &auth_context,
            )
            .await
            .expect("Failed to resolve managed tool call");
        assert_eq!(managed_tool_call.tool.name, tool.tool.name);

        mcp_servers
            .call_tool(chat_id, managed_tool_call, &auth_context)
            .await
            .expect("Expected MCP tool call to succeed");
    }
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn test_forwarded_mcp_auth_filters_tools_by_identity(pool: Pool<Postgres>) {
    let mock_mcp_base_url = mock_mcp_base_url();
    let (mut app_config, _llm_server) = setup_mock_llm_server(None).await;

    app_config.mcp_servers.insert(
        "auth-forwarded-access".to_string(),
        mcp_server_config(
            &mock_mcp_base_url,
            "/mcp/auth-forwarded-access",
            McpServerAuthenticationConfig::Forwarded {
                forwarded: McpServerForwardedAuthenticationConfig {
                    credential: McpServerForwardedCredential::AccessToken,
                },
            },
        ),
    );
    app_config.mcp_servers.insert(
        "auth-forwarded-oidc".to_string(),
        mcp_server_config(
            &mock_mcp_base_url,
            "/mcp/auth-forwarded-oidc",
            McpServerAuthenticationConfig::Forwarded {
                forwarded: McpServerForwardedAuthenticationConfig {
                    credential: McpServerForwardedCredential::OidcIdToken,
                },
            },
        ),
    );

    let _app_state = test_app_state(app_config.clone(), pool).await;
    let mcp_servers = McpServers::new(&app_config);
    let chat_id = Uuid::new_v4();
    let oidc_allowed_token = JwtTokenBuilder::new().subject("allowed-user").build();
    let oidc_denied_token = JwtTokenBuilder::new().subject("denied-user").build();

    let access_allowed = mcp_servers
        .list_tools_for_server_ids(
            chat_id,
            None,
            &McpRequestAuthContext {
                oidc_token: Some(&oidc_allowed_token),
                access_token: Some("access:allowed-user"),
            },
        )
        .await
        .expect("Failed to discover MCP tools for allowed forwarded-access user");
    let access_denied = mcp_servers
        .list_tools_for_server_ids(
            chat_id,
            None,
            &McpRequestAuthContext {
                oidc_token: Some(&oidc_denied_token),
                access_token: Some("access:denied-user"),
            },
        )
        .await
        .expect("Failed to discover MCP tools for denied forwarded-access user");

    assert!(
        access_allowed
            .iter()
            .any(|tool| tool.tool.name == "auth_forwarded_access_probe")
    );
    assert!(
        access_denied
            .iter()
            .all(|tool| tool.tool.name != "auth_forwarded_access_probe")
    );
    let oidc_allowed = mcp_servers
        .list_tools_for_server_ids(
            chat_id,
            None,
            &McpRequestAuthContext {
                oidc_token: Some(&oidc_allowed_token),
                access_token: Some("access:allowed-user"),
            },
        )
        .await
        .expect("Failed to discover MCP tools for allowed forwarded-oidc user");
    let oidc_denied = mcp_servers
        .list_tools_for_server_ids(
            chat_id,
            None,
            &McpRequestAuthContext {
                oidc_token: Some(&oidc_denied_token),
                access_token: Some("access:allowed-user"),
            },
        )
        .await
        .expect("Failed to discover MCP tools for denied forwarded-oidc user");

    assert!(
        oidc_allowed
            .iter()
            .any(|tool| tool.tool.name == "auth_forwarded_oidc_probe")
    );
    assert!(
        oidc_denied
            .iter()
            .all(|tool| tool.tool.name != "auth_forwarded_oidc_probe")
    );
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn test_mcp_connection_errors_are_propagated_during_tool_discovery(pool: Pool<Postgres>) {
    let (mut app_config, _llm_server) = setup_mock_llm_server(None).await;

    app_config.mcp_servers.insert(
        "unreachable-auth-none".to_string(),
        mcp_server_config(
            "http://127.0.0.1:9",
            "/mcp/auth-none",
            McpServerAuthenticationConfig::None,
        ),
    );

    let _app_state = test_app_state(app_config.clone(), pool).await;
    let mcp_servers = McpServers::new(&app_config);
    let chat_id = Uuid::new_v4();
    let auth_context = McpRequestAuthContext::default();
    let server_filter = HashSet::from(["unreachable-auth-none".to_string()]);

    let error = mcp_servers
        .list_tools_for_server_ids(chat_id, Some(&server_filter), &auth_context)
        .await
        .expect_err("Expected MCP tool discovery to fail for an unreachable server");

    let error_text = error.to_string();
    assert!(error_text.contains("Failed to discover MCP tools"));
    assert!(error_text.contains("unreachable-auth-none"));
}
