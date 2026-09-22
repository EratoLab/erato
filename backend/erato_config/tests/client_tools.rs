use erato_config::config::{ClientToolConfig, ClientToolsConfig, FacetsConfig};

#[test]
fn optional_client_tool_configuration_keeps_registration_and_facet_scope() {
    let schema = config::Config::builder()
        .add_source(config::File::from_str(
            r#"
[client_tools.tools.local_read]
name = "read_local_test_data"
namespace = "test_device"
description = "Read synthetic test data."
parameters = '{"type":"object"}'
requires_client_registration = true

[facets.facets.local_test]
display_name = "Local test data"
tool_call_allowlist = ["test_device/*"]
"#,
            config::FileFormat::Toml,
        ))
        .build()
        .unwrap();
    let client_tools: ClientToolsConfig = schema.get("client_tools").unwrap();
    let facets: FacetsConfig = schema.get("facets").unwrap();
    assert_eq!(client_tools.tools.len(), 1);
    for tool in client_tools.tools.values() {
        assert!(tool.requires_client_registration);
        assert_eq!(tool.namespace_or_default(), "test_device");
        let schema: serde_json::Value = serde_json::from_str(&tool.parameters).unwrap();
        assert_eq!(schema["type"], "object");
    }
    assert_eq!(
        facets.facets["local_test"].tool_call_allowlist,
        vec!["test_device/*"]
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
