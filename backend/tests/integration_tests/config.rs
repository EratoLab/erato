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
    let chat_provider = config
        .chat_provider
        .as_ref()
        .expect("chat_provider should be configured");
    assert_eq!(chat_provider.provider_kind, "openai");
    assert_eq!(chat_provider.model_name, "o4-mini");
    assert_eq!(chat_provider.api_key, Some("sk-XXX".to_string()));
    assert_eq!(chat_provider.base_url, None);
    assert_eq!(chat_provider.system_prompt, None);

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
    let chat_provider = config
        .chat_provider
        .as_ref()
        .expect("chat_provider should be configured");
    assert_eq!(chat_provider.provider_kind, "openai");
    assert_eq!(chat_provider.model_name, "gpt-4");
    assert_eq!(chat_provider.api_key, Some("sk-test-key".to_string()));
    assert_eq!(
        chat_provider.base_url,
        Some("https://api.custom-openai.com/v1/".to_string())
    );
    assert_eq!(
        chat_provider.system_prompt,
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
    let chat_provider = config
        .chat_provider
        .as_ref()
        .expect("chat_provider should be configured");
    assert_eq!(chat_provider.provider_kind, "openai");
    assert_eq!(chat_provider.model_name, "gpt-3.5-turbo");
    assert_eq!(chat_provider.api_key, None);
    assert_eq!(chat_provider.base_url, None);
    assert_eq!(
        config.database_url,
        "postgres://user:pass@localhost:5432/test"
    );
}

#[test]
fn test_config_with_multiple_chat_providers() {
    // Test the new multiple chat providers configuration
    let mut temp_file = Builder::new()
        .suffix(".toml")
        .tempfile()
        .expect("Failed to create temporary file");
    let config_content = r#"
[chat_providers]
priority_order = ["primary", "secondary"]

[chat_providers.providers.primary]
provider_kind = "openai"
model_name = "gpt-4"
model_display_name = "GPT-4 (Primary)"
api_key = "sk-primary-key"

[chat_providers.providers.secondary]
provider_kind = "openai"
model_name = "gpt-3.5-turbo"
model_display_name = "GPT-3.5 Turbo (Backup)"
api_key = "sk-secondary-key"
base_url = "https://api.backup-openai.com/v1/"

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

    // Load configuration from the temporary file
    let mut builder = AppConfig::config_schema_builder(Some(vec![temp_path.to_string()]), false)
        .expect("Failed to create config builder");

    // Add required fields that don't have defaults
    builder = builder
        .set_override("database_url", "postgres://user:pass@localhost:5432/test")
        .unwrap();

    let config_schema = builder.build().expect("Failed to build config schema");
    let mut config: AppConfig = config_schema
        .try_deserialize()
        .expect("Failed to deserialize config");

    // Apply migration to process the configuration
    config = config.migrate();

    // Verify that the chat providers configuration is parsed correctly
    assert!(config.chat_providers.is_some());
    let chat_providers = config.chat_providers.as_ref().unwrap();

    assert_eq!(chat_providers.priority_order, vec!["primary", "secondary"]);
    assert_eq!(chat_providers.providers.len(), 2);

    // Test primary provider
    let primary = chat_providers.providers.get("primary").unwrap();
    assert_eq!(primary.provider_kind, "openai");
    assert_eq!(primary.model_name, "gpt-4");
    assert_eq!(primary.model_display_name(), "GPT-4 (Primary)");
    assert_eq!(primary.api_key, Some("sk-primary-key".to_string()));

    // Test secondary provider
    let secondary = chat_providers.providers.get("secondary").unwrap();
    assert_eq!(secondary.provider_kind, "openai");
    assert_eq!(secondary.model_name, "gpt-3.5-turbo");
    assert_eq!(secondary.model_display_name(), "GPT-3.5 Turbo (Backup)");
    assert_eq!(secondary.api_key, Some("sk-secondary-key".to_string()));
    assert_eq!(
        secondary.base_url,
        Some("https://api.backup-openai.com/v1/".to_string())
    );

    // Test provider lookup methods
    assert_eq!(
        config.determine_chat_provider(None, None).unwrap(),
        "primary"
    );
    assert_eq!(
        config
            .determine_chat_provider(None, Some("secondary"))
            .unwrap(),
        "secondary"
    );

    let primary_config = config.get_chat_provider("primary");
    assert_eq!(primary_config.model_name, "gpt-4");

    let secondary_config = config.get_chat_provider("secondary");
    assert_eq!(secondary_config.model_name, "gpt-3.5-turbo");
}

#[test]
fn test_config_migration_from_single_to_multiple_providers() {
    // Test that the old single chat_provider configuration is migrated to the new structure
    let mut temp_file = Builder::new()
        .suffix(".toml")
        .tempfile()
        .expect("Failed to create temporary file");
    let config_content = r#"
[chat_provider]
provider_kind = "openai"
model_name = "gpt-4"
model_display_name = "My GPT-4"
api_key = "sk-test-key"

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

    // Load configuration from the temporary file
    let mut builder = AppConfig::config_schema_builder(Some(vec![temp_path.to_string()]), false)
        .expect("Failed to create config builder");

    // Add required fields that don't have defaults
    builder = builder
        .set_override("database_url", "postgres://user:pass@localhost:5432/test")
        .unwrap();

    let config_schema = builder.build().expect("Failed to build config schema");
    let mut config: AppConfig = config_schema
        .try_deserialize()
        .expect("Failed to deserialize config");

    // Before migration, chat_providers should be None
    assert!(config.chat_providers.is_none());

    // Apply migration
    config = config.migrate();

    // After migration, chat_providers should be populated
    assert!(config.chat_providers.is_some());
    let chat_providers = config.chat_providers.as_ref().unwrap();

    assert_eq!(chat_providers.priority_order, vec!["default"]);
    assert_eq!(chat_providers.providers.len(), 1);

    let default_provider = chat_providers.providers.get("default").unwrap();
    assert_eq!(default_provider.provider_kind, "openai");
    assert_eq!(default_provider.model_name, "gpt-4");
    assert_eq!(default_provider.model_display_name(), "My GPT-4");
    assert_eq!(default_provider.api_key, Some("sk-test-key".to_string()));

    // Test that the methods work correctly with migrated config
    assert_eq!(
        config.determine_chat_provider(None, None).unwrap(),
        "default"
    );
    let provider_config = config.get_chat_provider("default");
    assert_eq!(provider_config.model_name, "gpt-4");
}

#[test]
fn test_config_azure_openai_migration_multiple_providers() {
    // Test that Azure OpenAI migration works for multiple providers in the new structure
    let mut temp_file = Builder::new()
        .suffix(".toml")
        .tempfile()
        .expect("Failed to create temporary file");
    let config_content = r#"
[chat_providers]
priority_order = ["azure_primary", "azure_backup", "openai_provider"]

[chat_providers.providers.azure_primary]
provider_kind = "azure_openai"
model_name = "gpt-4"
model_display_name = "Azure GPT-4 Primary"
base_url = "https://primary.api.cognitive.microsoft.com"
api_key = "primary-azure-key"
api_version = "2024-10-21"

[chat_providers.providers.azure_backup]
provider_kind = "azure_openai"
model_name = "gpt-3.5-turbo"
model_display_name = "Azure GPT-3.5 Backup"
base_url = "https://backup.openai.azure.com"
api_key = "backup-azure-key"
api_version = "2024-08-01-preview"

[chat_providers.providers.openai_provider]
provider_kind = "openai"
model_name = "gpt-4o"
model_display_name = "OpenAI GPT-4o"
api_key = "openai-key"

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

    // Load configuration from the temporary file
    let mut builder = AppConfig::config_schema_builder(Some(vec![temp_path.to_string()]), false)
        .expect("Failed to create config builder");

    // Add required fields that don't have defaults
    builder = builder
        .set_override("database_url", "postgres://user:pass@localhost:5432/test")
        .unwrap();

    let config_schema = builder.build().expect("Failed to build config schema");
    let mut config: AppConfig = config_schema
        .try_deserialize()
        .expect("Failed to deserialize config");

    // Apply migration to process the configuration
    config = config.migrate();

    // Verify that the chat providers configuration is parsed correctly
    assert!(config.chat_providers.is_some());
    let chat_providers = config.chat_providers.as_ref().unwrap();

    assert_eq!(
        chat_providers.priority_order,
        vec!["azure_primary", "azure_backup", "openai_provider"]
    );
    assert_eq!(chat_providers.providers.len(), 3);

    // Test that Azure providers were migrated to OpenAI format
    let azure_primary = chat_providers.providers.get("azure_primary").unwrap();
    assert_eq!(azure_primary.provider_kind, "openai"); // Should be migrated to "openai"
    assert_eq!(azure_primary.model_name, "gpt-4");
    assert_eq!(azure_primary.model_display_name(), "Azure GPT-4 Primary");
    assert_eq!(azure_primary.api_key, None); // Should be moved to headers
    assert!(azure_primary
        .base_url
        .as_ref()
        .unwrap()
        .contains("/openai/deployments/gpt-4/")); // Should be converted to deployment URL
    assert!(azure_primary
        .additional_request_parameters
        .as_ref()
        .unwrap()
        .contains(&"api-version=2024-10-21".to_string()));
    assert!(azure_primary
        .additional_request_headers
        .as_ref()
        .unwrap()
        .contains(&"api-key=primary-azure-key".to_string()));

    let azure_backup = chat_providers.providers.get("azure_backup").unwrap();
    assert_eq!(azure_backup.provider_kind, "openai"); // Should be migrated to "openai"
    assert_eq!(azure_backup.model_name, "gpt-3.5-turbo");
    assert_eq!(azure_backup.model_display_name(), "Azure GPT-3.5 Backup");
    assert_eq!(azure_backup.api_key, None); // Should be moved to headers
    assert!(azure_backup
        .base_url
        .as_ref()
        .unwrap()
        .contains("/openai/deployments/gpt-3.5-turbo/")); // Should be converted to deployment URL
    assert!(azure_backup
        .additional_request_parameters
        .as_ref()
        .unwrap()
        .contains(&"api-version=2024-08-01-preview".to_string()));
    assert!(azure_backup
        .additional_request_headers
        .as_ref()
        .unwrap()
        .contains(&"api-key=backup-azure-key".to_string()));

    // Test that regular OpenAI provider was not affected
    let openai_provider = chat_providers.providers.get("openai_provider").unwrap();
    assert_eq!(openai_provider.provider_kind, "openai");
    assert_eq!(openai_provider.model_name, "gpt-4o");
    assert_eq!(openai_provider.model_display_name(), "OpenAI GPT-4o");
    assert_eq!(openai_provider.api_key, Some("openai-key".to_string()));
    assert!(openai_provider.additional_request_parameters.is_none());
    assert!(openai_provider.additional_request_headers.is_none());

    // Test that the methods work correctly with migrated config
    assert_eq!(
        config.determine_chat_provider(None, None).unwrap(),
        "azure_primary"
    );
    let primary_config = config.get_chat_provider("azure_primary");
    assert_eq!(primary_config.model_name, "gpt-4");
}

#[test]
#[allow(deprecated)]
fn test_config_with_new_sentry_integration() {
    // Test the new nested sentry configuration under integrations
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

[integrations.sentry]
sentry_dsn = "https://test-key@sentry.io/12345"
"#;

    temp_file
        .write_all(config_content.as_bytes())
        .expect("Failed to write to temporary file");

    // Flush the file to ensure content is written
    temp_file.flush().expect("Failed to flush temporary file");

    // Get the path of the temporary file
    let temp_path = temp_file.path().to_str().unwrap();

    // Load configuration from the temporary file
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

    // Verify the new sentry configuration is parsed correctly
    assert_eq!(
        config.integrations.sentry.sentry_dsn,
        Some("https://test-key@sentry.io/12345".to_string())
    );
    // The get_sentry_dsn() method should return the new config value
    assert_eq!(
        config.get_sentry_dsn(),
        Some(&"https://test-key@sentry.io/12345".to_string())
    );
    // The old deprecated field should be None
    assert_eq!(config.sentry_dsn, None);
}

#[test]
#[allow(deprecated)]
fn test_config_with_old_deprecated_sentry_dsn() {
    // Test backward compatibility with the old sentry_dsn field
    let mut temp_file = Builder::new()
        .suffix(".toml")
        .tempfile()
        .expect("Failed to create temporary file");
    let config_content = r#"
sentry_dsn = "https://old-key@sentry.io/67890"

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

    // Load configuration from the temporary file
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

    // Before migration - verify the old field is loaded from TOML
    assert_eq!(
        config.sentry_dsn,
        Some("https://old-key@sentry.io/67890".to_string())
    );

    // After migration - the value should be moved to the new location and old cleared
    let migrated_config = config.migrate();
    assert_eq!(migrated_config.sentry_dsn, None);
    assert_eq!(
        migrated_config.integrations.sentry.sentry_dsn,
        Some("https://old-key@sentry.io/67890".to_string())
    );
    // The get_sentry_dsn() method should return the migrated value
    assert_eq!(
        migrated_config.get_sentry_dsn(),
        Some(&"https://old-key@sentry.io/67890".to_string())
    );
}

#[test]
#[allow(deprecated)]
fn test_config_with_both_old_and_new_sentry_dsn() {
    // Test that the new config takes precedence over the old deprecated one
    let mut temp_file = Builder::new()
        .suffix(".toml")
        .tempfile()
        .expect("Failed to create temporary file");
    let config_content = r#"
sentry_dsn = "https://old-key@sentry.io/67890"

[chat_provider]
provider_kind = "openai"
model_name = "gpt-3.5-turbo"

[file_storage_providers.azblob_demo]
provider_kind = "azblob"
config = { endpoint = "https://xxx.blob.core.windows.net", container = "xxx", account_name = "xxx", account_key = "xxx" }

[integrations.sentry]
sentry_dsn = "https://new-key@sentry.io/12345"
"#;

    temp_file
        .write_all(config_content.as_bytes())
        .expect("Failed to write to temporary file");

    // Flush the file to ensure content is written
    temp_file.flush().expect("Failed to flush temporary file");

    // Get the path of the temporary file
    let temp_path = temp_file.path().to_str().unwrap();

    // Load configuration from the temporary file
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

    // Before migration - verify both values are loaded from TOML
    assert_eq!(
        config.sentry_dsn,
        Some("https://old-key@sentry.io/67890".to_string())
    );
    assert_eq!(
        config.integrations.sentry.sentry_dsn,
        Some("https://new-key@sentry.io/12345".to_string())
    );

    // After migration - the new config should be preserved, old should be cleared
    let migrated_config = config.migrate();
    assert_eq!(migrated_config.sentry_dsn, None);
    assert_eq!(
        migrated_config.integrations.sentry.sentry_dsn,
        Some("https://new-key@sentry.io/12345".to_string())
    );

    // The get_sentry_dsn() method should return the new value (taking precedence)
    assert_eq!(
        migrated_config.get_sentry_dsn(),
        Some(&"https://new-key@sentry.io/12345".to_string())
    );
}

#[test]
#[allow(deprecated)]
fn test_config_migration_sentry_dsn() {
    // Test that the migrate method moves sentry_dsn to integrations.sentry.sentry_dsn
    let mut temp_file = Builder::new()
        .suffix(".toml")
        .tempfile()
        .expect("Failed to create temporary file");
    let config_content = r#"
sentry_dsn = "https://old-key@sentry.io/67890"

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

    // Load configuration from the temporary file
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

    // Before migration - the old field should have the value, the new should be None
    assert_eq!(
        config.sentry_dsn,
        Some("https://old-key@sentry.io/67890".to_string())
    );
    assert_eq!(config.integrations.sentry.sentry_dsn, None);

    // After migration - the value should be moved to the new location
    let migrated_config = config.migrate();
    assert_eq!(migrated_config.sentry_dsn, None);
    assert_eq!(
        migrated_config.integrations.sentry.sentry_dsn,
        Some("https://old-key@sentry.io/67890".to_string())
    );

    // The get_sentry_dsn() method should return the migrated value
    assert_eq!(
        migrated_config.get_sentry_dsn(),
        Some(&"https://old-key@sentry.io/67890".to_string())
    );
}

#[test]
#[allow(deprecated)]
fn test_config_migration_preserves_new_sentry_dsn() {
    // Test that migration doesn't overwrite an existing new config value
    let mut temp_file = Builder::new()
        .suffix(".toml")
        .tempfile()
        .expect("Failed to create temporary file");
    let config_content = r#"
sentry_dsn = "https://old-key@sentry.io/67890"

[chat_provider]
provider_kind = "openai"
model_name = "gpt-3.5-turbo"

[file_storage_providers.azblob_demo]
provider_kind = "azblob"
config = { endpoint = "https://xxx.blob.core.windows.net", container = "xxx", account_name = "xxx", account_key = "xxx" }

[integrations.sentry]
sentry_dsn = "https://new-key@sentry.io/12345"
"#;

    temp_file
        .write_all(config_content.as_bytes())
        .expect("Failed to write to temporary file");

    // Flush the file to ensure content is written
    temp_file.flush().expect("Failed to flush temporary file");

    // Get the path of the temporary file
    let temp_path = temp_file.path().to_str().unwrap();

    // Load configuration from the temporary file
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

    // After migration - the new config should be preserved, old should be cleared
    let migrated_config = config.migrate();
    assert_eq!(migrated_config.sentry_dsn, None);
    assert_eq!(
        migrated_config.integrations.sentry.sentry_dsn,
        Some("https://new-key@sentry.io/12345".to_string())
    );

    // The get_sentry_dsn() method should return the new value (not the old one)
    assert_eq!(
        migrated_config.get_sentry_dsn(),
        Some(&"https://new-key@sentry.io/12345".to_string())
    );
}

#[test]
fn test_config_with_summary_configuration() {
    // Test the new summary configuration feature
    let mut temp_file = Builder::new()
        .suffix(".toml")
        .tempfile()
        .expect("Failed to create temporary file");
    let config_content = r#"
[chat_providers]
priority_order = ["primary", "summarizer"]

[chat_providers.summary]
summary_chat_provider_id = "summarizer"
max_tokens = 150

[chat_providers.providers.primary]
provider_kind = "openai"
model_name = "gpt-4"
model_display_name = "GPT-4 (Primary)"
api_key = "sk-primary-key"

[chat_providers.providers.summarizer]
provider_kind = "openai"
model_name = "gpt-4o-mini"
model_display_name = "GPT-4o Mini (Summarizer)"
api_key = "sk-summarizer-key"

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

    // Load configuration from the temporary file
    let mut builder = AppConfig::config_schema_builder(Some(vec![temp_path.to_string()]), false)
        .expect("Failed to create config builder");

    // Add required fields that don't have defaults
    builder = builder
        .set_override("database_url", "postgres://user:pass@localhost:5432/test")
        .unwrap();

    let config_schema = builder.build().expect("Failed to build config schema");
    let mut config: AppConfig = config_schema
        .try_deserialize()
        .expect("Failed to deserialize config");

    // Apply migration to process the configuration
    config = config.migrate();

    // Verify that the chat providers configuration is parsed correctly
    assert!(config.chat_providers.is_some());
    let chat_providers = config.chat_providers.as_ref().unwrap();

    // Test summary configuration
    assert_eq!(
        chat_providers.summary.summary_chat_provider_id,
        Some("summarizer".to_string())
    );
    assert_eq!(chat_providers.summary.max_tokens, Some(150));

    // Verify the summarizer provider exists
    assert!(chat_providers.providers.contains_key("summarizer"));
    let summarizer = chat_providers.providers.get("summarizer").unwrap();
    assert_eq!(summarizer.model_name, "gpt-4o-mini");
    assert_eq!(summarizer.model_display_name(), "GPT-4o Mini (Summarizer)");
}

#[test]
fn test_config_with_default_summary_configuration() {
    // Test that summary configuration defaults work correctly
    let mut temp_file = Builder::new()
        .suffix(".toml")
        .tempfile()
        .expect("Failed to create temporary file");
    let config_content = r#"
[chat_providers]
priority_order = ["primary"]

[chat_providers.providers.primary]
provider_kind = "openai"
model_name = "gpt-4"
model_display_name = "GPT-4 (Primary)"
api_key = "sk-primary-key"

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

    // Load configuration from the temporary file
    let mut builder = AppConfig::config_schema_builder(Some(vec![temp_path.to_string()]), false)
        .expect("Failed to create config builder");

    // Add required fields that don't have defaults
    builder = builder
        .set_override("database_url", "postgres://user:pass@localhost:5432/test")
        .unwrap();

    let config_schema = builder.build().expect("Failed to build config schema");
    let mut config: AppConfig = config_schema
        .try_deserialize()
        .expect("Failed to deserialize config");

    // Apply migration to process the configuration
    config = config.migrate();

    // Verify that the chat providers configuration is parsed correctly
    assert!(config.chat_providers.is_some());
    let chat_providers = config.chat_providers.as_ref().unwrap();

    // Test default summary configuration
    assert_eq!(chat_providers.summary.summary_chat_provider_id, None);
    assert_eq!(chat_providers.summary.max_tokens, None);
}

#[test]
fn test_config_with_model_capabilities() {
    // Create a temporary erato.toml file with model capabilities
    let mut temp_file = Builder::new()
        .suffix(".toml")
        .tempfile()
        .expect("Failed to create temporary file");
    let config_content = r#"
[chat_providers]
priority_order = ["gpt4", "gpt4o-mini"]

[chat_providers.providers.gpt4]
provider_kind = "openai"
model_name = "gpt-4"
model_display_name = "GPT-4"
api_key = "sk-test-key"

[chat_providers.providers.gpt4.model_capabilities]
context_size_tokens = 8192
supports_image_understanding = false
supports_reasoning = false
supports_verbosity = false
cost_input_tokens_per_1m = 30.0
cost_output_tokens_per_1m = 60.0

[chat_providers.providers.gpt4o-mini]
provider_kind = "openai"
model_name = "gpt-4o-mini"
model_display_name = "GPT-4o Mini"
api_key = "sk-test-key"

[chat_providers.providers.gpt4o-mini.model_capabilities]
context_size_tokens = 128000
supports_image_understanding = true
supports_reasoning = false
supports_verbosity = false
cost_input_tokens_per_1m = 0.15
cost_output_tokens_per_1m = 0.6

[file_storage_providers.test]
provider_kind = "s3"
config = { bucket = "test-bucket", endpoint = "http://localhost:9000", region = "us-east-1" }
"#;

    temp_file
        .write_all(config_content.as_bytes())
        .expect("Failed to write to temporary file");

    // Flush the file to ensure content is written
    temp_file.flush().expect("Failed to flush temporary file");

    // Get the path of the temporary file
    let temp_path = temp_file.path().to_str().unwrap();

    // Load configuration from the temporary file
    let mut builder = AppConfig::config_schema_builder(Some(vec![temp_path.to_string()]), false)
        .expect("Failed to create config builder");

    // Add required fields that don't have defaults
    builder = builder
        .set_override("database_url", "postgres://user:pass@localhost:5432/test")
        .unwrap();

    let config_schema = builder.build().expect("Failed to build config schema");
    let mut config: AppConfig = config_schema
        .try_deserialize()
        .expect("Failed to deserialize config");

    // Apply migration to process the configuration
    config = config.migrate();

    // Verify that the chat providers configuration is parsed correctly
    assert!(config.chat_providers.is_some());
    let chat_providers = config.chat_providers.as_ref().unwrap();

    // Test that both providers are configured
    assert_eq!(chat_providers.priority_order, vec!["gpt4", "gpt4o-mini"]);
    assert!(chat_providers.providers.contains_key("gpt4"));
    assert!(chat_providers.providers.contains_key("gpt4o-mini"));

    // Test GPT-4 model capabilities
    let gpt4_provider = &chat_providers.providers["gpt4"];
    assert_eq!(gpt4_provider.model_capabilities.context_size_tokens, 8192);
    assert!(
        !gpt4_provider
            .model_capabilities
            .supports_image_understanding
    );
    assert!(!gpt4_provider.model_capabilities.supports_reasoning);
    assert!(!gpt4_provider.model_capabilities.supports_verbosity);
    assert_eq!(
        gpt4_provider.model_capabilities.cost_input_tokens_per_1m,
        30.0
    );
    assert_eq!(
        gpt4_provider.model_capabilities.cost_output_tokens_per_1m,
        60.0
    );

    // Test GPT-4o Mini model capabilities
    let gpt4o_mini_provider = &chat_providers.providers["gpt4o-mini"];
    assert_eq!(
        gpt4o_mini_provider.model_capabilities.context_size_tokens,
        128000
    );
    assert!(
        gpt4o_mini_provider
            .model_capabilities
            .supports_image_understanding
    );
    assert!(!gpt4o_mini_provider.model_capabilities.supports_reasoning);
    assert!(!gpt4o_mini_provider.model_capabilities.supports_verbosity);
    assert_eq!(
        gpt4o_mini_provider
            .model_capabilities
            .cost_input_tokens_per_1m,
        0.15
    );
    assert_eq!(
        gpt4o_mini_provider
            .model_capabilities
            .cost_output_tokens_per_1m,
        0.6
    );

    // Test accessing a provider through the config API
    let gpt4_config = config.get_chat_provider("gpt4");
    assert_eq!(gpt4_config.model_capabilities.context_size_tokens, 8192);
}

#[test]
fn test_config_with_default_model_capabilities() {
    // Create a temporary erato.toml file without explicit model capabilities
    let mut temp_file = Builder::new()
        .suffix(".toml")
        .tempfile()
        .expect("Failed to create temporary file");
    let config_content = r#"
[chat_providers]
priority_order = ["basic"]

[chat_providers.providers.basic]
provider_kind = "openai"
model_name = "gpt-3.5-turbo"
api_key = "sk-test-key"

[file_storage_providers.test]
provider_kind = "s3"
config = { bucket = "test-bucket", endpoint = "http://localhost:9000", region = "us-east-1" }
"#;

    temp_file
        .write_all(config_content.as_bytes())
        .expect("Failed to write to temporary file");

    // Flush the file to ensure content is written
    temp_file.flush().expect("Failed to flush temporary file");

    // Get the path of the temporary file
    let temp_path = temp_file.path().to_str().unwrap();

    // Load configuration from the temporary file
    let mut builder = AppConfig::config_schema_builder(Some(vec![temp_path.to_string()]), false)
        .expect("Failed to create config builder");

    // Add required fields that don't have defaults
    builder = builder
        .set_override("database_url", "postgres://user:pass@localhost:5432/test")
        .unwrap();

    let config_schema = builder.build().expect("Failed to build config schema");
    let mut config: AppConfig = config_schema
        .try_deserialize()
        .expect("Failed to deserialize config");

    // Apply migration to process the configuration
    config = config.migrate();

    // Verify that default model capabilities are applied
    let basic_provider = &config.chat_providers.as_ref().unwrap().providers["basic"];

    // Should have default values
    assert_eq!(
        basic_provider.model_capabilities.context_size_tokens,
        1_000_000
    ); // Default
    assert!(
        !basic_provider
            .model_capabilities
            .supports_image_understanding
    );
    assert!(!basic_provider.model_capabilities.supports_reasoning);
    assert!(!basic_provider.model_capabilities.supports_verbosity);
    assert_eq!(
        basic_provider.model_capabilities.cost_input_tokens_per_1m,
        0.0
    );
    assert_eq!(
        basic_provider.model_capabilities.cost_output_tokens_per_1m,
        0.0
    );
}
