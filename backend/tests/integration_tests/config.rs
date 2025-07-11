use erato::config::AppConfig;
use std::io::Write;
use tempfile::Builder;
use test_log::test;

#[test]
fn test_config_with_openai_provider() {
    // Create a temporary erato.toml file with the specified contents
    let mut temp_file = Builder::new()
        .suffix(".toml")
        .tempfile()
        .expect("Failed to create temporary file");
    let config_content = r#"
[chat_provider]
provider_kind = "openai"
model_name = "o4-mini"
api_key = "sk-XXX"

[file_storage_providers.azblob_demo]
provider_kind = "azblob"
config = { endpoint = "https://xxx.blob.core.windows.net", container = "xxx", account_name = "xxx", account_key = "xxx" }
"#;

    temp_file
        .write_all(config_content.as_bytes())
        .expect("Failed to write to temporary file");

    // Flush the file to ensure content is written
    temp_file.flush().expect("Failed to flush temporary file");

    // Get the path of the temporary file
    let temp_path = temp_file.path().to_str().unwrap();

    // Load configuration from the temporary file using the builder like the existing tests
    let mut builder = AppConfig::config_schema_builder(Some(vec![temp_path.to_string()]), false)
        .expect("Failed to create config builder");

    // Add required fields that don't have defaults
    builder = builder
        .set_override("database_url", "postgres://user:pass@localhost:5432/test")
        .unwrap();

    let config_schema = builder.build().expect("Failed to build config schema");
    let config: AppConfig = config_schema
        .try_deserialize()
        .expect("Failed to deserialize config");

    // Verify that the chat provider configuration is parsed correctly
    assert_eq!(config.chat_provider.provider_kind, "openai");
    assert_eq!(config.chat_provider.model_name, "o4-mini");
    assert_eq!(config.chat_provider.api_key, Some("sk-XXX".to_string()));
    assert_eq!(config.chat_provider.base_url, None);
    assert_eq!(config.chat_provider.system_prompt, None);

    // Verify defaults are still applied
    assert_eq!(config.environment, "development");
    assert_eq!(config.http_host, "127.0.0.1");
    assert_eq!(config.http_port, 3130);
    assert_eq!(config.frontend_bundle_path, "./public");
    assert!(!config.cleanup_enabled);
    assert_eq!(config.cleanup_archived_max_age_days, 30);

    // The temp file will be automatically cleaned up when temp_file goes out of scope
}

#[test]
fn test_config_with_openai_provider_and_custom_base_url() {
    // Create a temporary erato.toml file with additional configuration
    let mut temp_file = Builder::new()
        .suffix(".toml")
        .tempfile()
        .expect("Failed to create temporary file");
    let config_content = r#"
environment = "test"
http_port = 8080

[chat_provider]
provider_kind = "openai"
model_name = "gpt-4"
api_key = "sk-test-key"
base_url = "https://api.custom-openai.com/v1/"
system_prompt = "You are a helpful assistant."

[file_storage_providers.azblob_demo]
provider_kind = "azblob"
config = { endpoint = "https://xxx.blob.core.windows.net", container = "xxx", account_name = "xxx", account_key = "xxx" }
"#;

    temp_file
        .write_all(config_content.as_bytes())
        .expect("Failed to write to temporary file");

    // Flush the file to ensure content is written
    temp_file.flush().expect("Failed to flush temporary file");

    // Get the path of the temporary file
    let temp_path = temp_file.path().to_str().unwrap();

    // Load configuration from the temporary file using the builder like the existing tests
    let mut builder = AppConfig::config_schema_builder(Some(vec![temp_path.to_string()]), false)
        .expect("Failed to create config builder");

    // Add required fields that don't have defaults
    builder = builder
        .set_override("database_url", "postgres://user:pass@localhost:5432/test")
        .unwrap();

    let config_schema = builder.build().expect("Failed to build config schema");
    let config: AppConfig = config_schema
        .try_deserialize()
        .expect("Failed to deserialize config");

    // Verify that the chat provider configuration is parsed correctly
    assert_eq!(config.chat_provider.provider_kind, "openai");
    assert_eq!(config.chat_provider.model_name, "gpt-4");
    assert_eq!(
        config.chat_provider.api_key,
        Some("sk-test-key".to_string())
    );
    assert_eq!(
        config.chat_provider.base_url,
        Some("https://api.custom-openai.com/v1/".to_string())
    );
    assert_eq!(
        config.chat_provider.system_prompt,
        Some("You are a helpful assistant.".to_string())
    );

    // Verify custom values override defaults
    assert_eq!(config.environment, "test");
    assert_eq!(config.http_port, 8080);

    // Verify other defaults are still applied
    assert_eq!(config.http_host, "127.0.0.1");
    assert_eq!(config.frontend_bundle_path, "./public");
}

#[test]
fn test_config_minimal_required_fields() {
    // Test that only the minimum required fields work
    let mut temp_file = Builder::new()
        .suffix(".toml")
        .tempfile()
        .expect("Failed to create temporary file");
    let config_content = r#"
[chat_provider]
provider_kind = "openai"
model_name = "gpt-3.5-turbo"

[file_storage_providers.azblob_demo]
provider_kind = "azblob"
config = { endpoint = "https://xxx.blob.core.windows.net", container = "xxx", account_name = "xxx", account_key = "xxx" }
"#;

    temp_file
        .write_all(config_content.as_bytes())
        .expect("Failed to write to temporary file");

    // Flush the file to ensure content is written
    temp_file.flush().expect("Failed to flush temporary file");

    // Get the path of the temporary file
    let temp_path = temp_file.path().to_str().unwrap();

    // Load configuration from the temporary file using the builder like the existing tests
    let mut builder = AppConfig::config_schema_builder(Some(vec![temp_path.to_string()]), false)
        .expect("Failed to create config builder");

    // Add required fields that don't have defaults
    builder = builder
        .set_override("database_url", "postgres://user:pass@localhost:5432/test")
        .unwrap();

    let config_schema = builder.build().expect("Failed to build config schema");
    let config: AppConfig = config_schema
        .try_deserialize()
        .expect("Failed to deserialize config");

    // Verify that the chat provider configuration is parsed correctly
    assert_eq!(config.chat_provider.provider_kind, "openai");
    assert_eq!(config.chat_provider.model_name, "gpt-3.5-turbo");
    assert_eq!(config.chat_provider.api_key, None);
    assert_eq!(config.chat_provider.base_url, None);
    assert_eq!(
        config.database_url,
        "postgres://user:pass@localhost:5432/test"
    );
}
