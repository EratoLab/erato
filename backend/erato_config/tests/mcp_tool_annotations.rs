use erato_config::config::{AppConfig, ConfigSourceFile, McpRuntimeConfig};

const SERVER: &str = r#"
[mcp_servers.search]
transport_type = "streamable_http"
url = "https://mcp.example.com/mcp"
"#;

fn parse_startup(source: &str) -> Result<AppConfig, config::ConfigError> {
    config::Config::builder()
        .add_source(config::File::from_str(source, config::FileFormat::Toml))
        .set_override("database_url", "postgres://localhost/test")?
        .set_override("environment", "test")?
        .set_override("http_host", "127.0.0.1")?
        .set_override("http_port", 3130)?
        .set_override("cleanup_enabled", false)?
        .set_override("cleanup_archived_max_age_days", 30)?
        .set_override(
            "file_storage_providers",
            std::collections::HashMap::<String, String>::new(),
        )?
        .build()?
        .try_deserialize()
}

fn parse_runtime(source: &str) -> eyre::Result<McpRuntimeConfig> {
    McpRuntimeConfig::from_toml_sources(&[ConfigSourceFile {
        source_filename: "annotations.erato.toml".to_string(),
        contents: source.to_string(),
    }])
}

#[test]
fn annotation_sections_parse_all_scopes_and_preserve_false_and_omission() {
    let source = format!(
        r#"{SERVER}
[mcp_servers_global.default_tool_annotations]
read_only_hint = true
[mcp_servers_global.override_tool_annotations]
destructive_hint = false
[mcp_servers.search.default_tool_annotations]
idempotent_hint = true
[mcp_servers.search.override_tool_annotations]
open_world_hint = false
[mcp_servers.search.tools."Read.File".default_tool_annotations]
read_only_hint = false
[mcp_servers.search.tools."Read.File".override_tool_annotations]
destructive_hint = true
[mcp_servers.search.tools.not_yet_discovered.default_tool_annotations]
"#
    );
    let startup = parse_startup(&source).unwrap();
    let runtime = parse_runtime(&source).unwrap();
    assert_eq!(McpRuntimeConfig::from_app_config(&startup), runtime);
    let global = &runtime.mcp_servers_global;
    assert_eq!(global.default_tool_annotations.read_only_hint, Some(true));
    assert_eq!(global.default_tool_annotations.destructive_hint, None);
    assert_eq!(
        global.override_tool_annotations.destructive_hint,
        Some(false)
    );
    let server = &runtime.mcp_servers["search"];
    assert_eq!(server.default_tool_annotations.idempotent_hint, Some(true));
    assert_eq!(
        server.override_tool_annotations.open_world_hint,
        Some(false)
    );
    let tool = &server.tools["Read.File"];
    assert_eq!(tool.default_tool_annotations.read_only_hint, Some(false));
    assert_eq!(tool.override_tool_annotations.destructive_hint, Some(true));
    assert_eq!(
        server.tools["not_yet_discovered"].default_tool_annotations,
        Default::default()
    );
    assert!(!server.tools.contains_key("read.file"));
}

#[test]
fn annotation_sections_are_empty_when_omitted_or_empty() {
    for sections in [
        "",
        "[mcp_servers_global.default_tool_annotations]\n[mcp_servers.search.override_tool_annotations]\n",
    ] {
        let runtime = parse_runtime(&format!("{SERVER}\n{sections}")).unwrap();
        assert_eq!(
            runtime.mcp_servers_global.default_tool_annotations,
            Default::default()
        );
        assert_eq!(
            runtime.mcp_servers_global.override_tool_annotations,
            Default::default()
        );
        assert_eq!(
            runtime.mcp_servers["search"].default_tool_annotations,
            Default::default()
        );
        assert_eq!(
            runtime.mcp_servers["search"].override_tool_annotations,
            Default::default()
        );
        assert!(runtime.mcp_servers["search"].tools.is_empty());
    }
}

#[test]
fn annotation_sections_reject_typos_and_wrong_types_at_startup_and_reload() {
    for scope in [
        "mcp_servers_global",
        "mcp_servers.search",
        "mcp_servers.search.tools.read_file",
    ] {
        for tier in ["default_tool_annotations", "override_tool_annotations"] {
            for invalid in [
                "readOnlyHint = true",
                "unknown = false",
                "title = 'title'",
                "read_only_hint = 'true'",
                "destructive_hint = 0",
            ] {
                let source = format!("{SERVER}\n[{scope}.{tier}]\n{invalid}\n");
                assert!(
                    parse_startup(&source).is_err(),
                    "startup accepted {scope}.{tier}: {invalid}"
                );
                assert!(
                    parse_runtime(&source).is_err(),
                    "reload accepted {scope}.{tier}: {invalid}"
                );
            }
        }
    }
    let source = format!("{SERVER}\n[mcp_servers.search.tools.read_file]\nread_only_hint = true\n");
    assert!(parse_startup(&source).is_err());
    assert!(parse_runtime(&source).is_err());
}
