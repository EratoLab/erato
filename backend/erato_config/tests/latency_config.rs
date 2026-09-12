use erato_config::config::AppConfig;

#[test]
fn latency_config_selects_only_local_mocks() {
    let path = format!("{}/../latency/erato.toml", env!("CARGO_MANIFEST_DIR"));
    let config = AppConfig::new_for_app(Some(vec![path])).unwrap();
    let providers = config.chat_providers.unwrap();
    assert_eq!(providers.providers.len(), 2);
    assert_eq!(
        providers.providers["mock"].base_url.as_deref(),
        Some("http://127.0.0.1:44320/base-openai/v1/")
    );
    assert_eq!(
        config.mcp_servers["mock"].url,
        "http://127.0.0.1:44321/mcp/file"
    );
    assert!(!config.integrations.otel.enabled);
    assert_eq!(config.integrations.prometheus.port, 3132);
}
