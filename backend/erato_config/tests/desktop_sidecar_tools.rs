use erato_config::config::{AppConfig, ClientToolConfig, ClientToolsConfig, FacetsConfig};

#[test]
fn optional_sidecar_example_requires_ready_clients_and_keeps_scope_explicit() {
    let path = format!(
        "{}/../examples/desktop-sidecar.erato.toml",
        env!("CARGO_MANIFEST_DIR")
    );
    // This file is an overlay, not a standalone server configuration.
    let schema = AppConfig::config_schema_builder(Some(vec![path]), false)
        .unwrap()
        .build()
        .unwrap();
    let client_tools: ClientToolsConfig = schema.get("client_tools").unwrap();
    let facets: FacetsConfig = schema.get("facets").unwrap();
    assert_eq!(client_tools.tools.len(), 2);
    for tool in client_tools.tools.values() {
        assert!(tool.requires_client_registration);
        assert_eq!(tool.namespace_or_default(), "desktop");
        let schema: serde_json::Value = serde_json::from_str(&tool.parameters).unwrap();
        assert_eq!(schema["type"], "object");
    }
    assert_eq!(
        facets.facets["desktop_local"].tool_call_allowlist,
        vec!["desktop/*"]
    );
    assert!(facets.tool_call_allowlist.is_empty());
}

#[test]
fn existing_client_tool_configuration_does_not_require_new_client_headers() {
    let tool: ClientToolConfig = serde_json::from_value(serde_json::json!({
        "name": "fetch_availability", "description": "Calendar read", "parameters": "{}"
    }))
    .unwrap();
    assert!(!tool.requires_client_registration);
}
