use config::builder::DefaultState;
use config::{Config, ConfigBuilder, ConfigError, Environment};
use eyre::{eyre, OptionExt, Report};
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Default, Deserialize, PartialEq, Eq, Clone)]
pub struct AppConfig {
    // A opaque marker to signify the environment. This may be forwarded to diagnostic/observability tools to signify the environment,
    // but is never parsed/interpreted by the application to trigger environment-specific behavior.
    pub environment: String,
    // The HTTP host to listen on.
    // Defaults to `127.0.0.1`.
    pub http_host: String,
    // The HTTP port to listen on.
    // Defaults to `3130`.
    pub http_port: i32,
    // Where to find the static frontend files to serve.
    // Defaults to `./public`
    pub frontend_bundle_path: String,
    pub database_url: String,
    pub chat_provider: ChatProviderConfig,
    // A list of file storage providers to use.
    //
    // The keys of the map act as the IDs for the providers.
    //
    // If multiple providers are configured, `default_file_storage_provider` must be set.
    pub file_storage_providers: HashMap<String, FileStorageProviderConfig>,
    // The default file storage provider to use.
    pub default_file_storage_provider: Option<String>,

    // A list of MCP servers that may be used in conjunction with the LLM providers.
    #[serde(default)]
    pub mcp_servers: HashMap<String, McpServerConfig>,

    // If present, will enable Sentry for error reporting.
    pub sentry_dsn: Option<String>,

    // Additional values to inject into the frontend environment as global variables.
    // This is a dictionary where each value can be a string or a map (string key, string value).
    // These will be available on the frontend via the frontend_environment mechanism, and added to the `windows` object.
    #[serde(default)]
    pub additional_frontend_environment: HashMap<String, serde_json::Value>,

    // If true, enables the cleanup worker that periodically deletes old data.
    // Defaults to `false`.
    pub cleanup_enabled: bool,
    // Number of days after which archived chats should be deleted by the cleanup worker.
    // Only has an effect if `cleanup_enabled` is `true`.
    // Defaults to 30.
    pub cleanup_archived_max_age_days: u32,
}

impl AppConfig {
    /// Separate builder, so we can also add overrides in tests.
    ///
    /// # Arguments
    ///
    /// * `config_file_paths` - An optional ordered list of paths to configuration files. If this is `Some`, auto-discovery is disabled.
    /// * `auto_discover_config_files` - A boolean flag to enable or disable auto-discovery of `erato.toml` and `*.auto.erato.toml` files.
    pub fn config_schema_builder(
        config_file_paths: Option<Vec<String>>,
        auto_discover_config_files: bool,
    ) -> Result<ConfigBuilder<DefaultState>, ConfigError> {
        let mut builder = Config::builder()
            .set_default("environment", "development")?
            .set_default("http_host", "127.0.0.1")?
            .set_default("http_port", "3130")?
            .set_default("frontend_bundle_path", "./public")?
            .set_default("cleanup_enabled", false)?
            .set_default("cleanup_archived_max_age_days", 30)?;

        let config_files_to_load: Vec<String> = if let Some(paths) = config_file_paths {
            paths
        } else if auto_discover_config_files {
            if let Ok(entries) = std::fs::read_dir(".") {
                let mut discovered_paths: Vec<String> = entries
                    .filter_map(Result::ok)
                    .map(|e| e.path())
                    .filter(|p| p.is_file())
                    .filter_map(|p| p.file_name().and_then(|s| s.to_str().map(String::from)))
                    .filter(|s| s == "erato.toml" || s.ends_with(".auto.erato.toml"))
                    .collect();
                discovered_paths.sort();
                discovered_paths
            } else {
                vec![]
            }
        } else {
            vec![]
        };

        for path in &config_files_to_load {
            println!("Loading config from: {}", path);
            builder = builder.add_source(config::File::with_name(path).required(false));
        }

        builder = builder.add_source(
            Environment::default()
                .try_parsing(true)
                .separator("__")
                .list_separator(" ")
                .with_list_parse_key("chat_provider.additional_request_parameters")
                .with_list_parse_key("chat_provider.additional_request_headers"),
        );
        Ok(builder)
    }

    pub fn config_schema(
        config_file_paths: Option<Vec<String>>,
        auto_discover_config_files: bool,
    ) -> Result<Config, ConfigError> {
        let builder = Self::config_schema_builder(config_file_paths, auto_discover_config_files)?;
        builder.build()
    }

    pub fn new_for_app(config_file_paths: Option<Vec<String>>) -> Result<Self, ConfigError> {
        let schema = Self::config_schema(config_file_paths, true)?;
        // You can deserialize (and thus freeze) the entire configuration as
        schema.try_deserialize()
    }

    /// Returns the maximum configured file upload size in bytes, if any.
    pub fn max_upload_size_bytes(&self) -> Option<u64> {
        self.file_storage_providers
            .values()
            .filter_map(|p| p.max_upload_size_kb)
            .max()
            .map(|kb| kb * 1024)
    }
}

#[derive(Debug, Default, Deserialize, PartialEq, Eq, Clone)]
pub struct ChatProviderConfig {
    // May be one of:
    // - "openai" (applicable for both OpenAI and AzureGPT)
    // - "ollama"
    pub provider_kind: String,
    // The model name to use for the chat provider.
    //
    // E.g. `gpt-4o`
    pub model_name: String,
    // The base URL for OpenAI compatible API endpoints.
    // If not provided, will use the default for the provider.
    //
    // Should likely end with `/v1/`
    // E.g. 'http://localhost:11434/v1/'
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    // Additional request parameters to be added to API requests.
    // E.g. 'api-version=2024-10-21'
    pub additional_request_parameters: Option<Vec<String>>,
    // Additional request headers to be added to API requests.
    // E.g. 'api-key=XYZ'
    pub additional_request_headers: Option<Vec<String>>,
    // Optional system prompt to use with the chat provider.
    pub system_prompt: Option<String>,
}

impl ChatProviderConfig {
    /// Parses the additional_request_parameters into a HashMap of key-value pairs
    pub fn additional_request_parameters_map(&self) -> HashMap<String, String> {
        let mut params = HashMap::new();
        if let Some(param_vec) = &self.additional_request_parameters {
            for param in param_vec {
                if let Some((key, value)) = param.split_once('=') {
                    params.insert(key.trim().to_string(), value.trim().to_string());
                }
            }
        }
        params
    }

    /// Parses the additional_request_headers into a HashMap of key-value pairs
    pub fn additional_request_headers_map(&self) -> HashMap<String, String> {
        let mut headers = HashMap::new();
        if let Some(header_vec) = &self.additional_request_headers {
            for header in header_vec {
                if let Some((key, value)) = header.split_once('=') {
                    headers.insert(key.trim().to_string(), value.trim().to_string());
                }
            }
        }
        headers
    }
}

#[derive(Debug, Deserialize, PartialEq, Eq, Clone)]
pub struct FileStorageProviderConfig {
    // Name to display in the UI.
    pub display_name: Option<String>,
    // The kind of the file storage provider.
    //
    // May be one of:
    // - "s3" - Amazon S3 or services that expose a S3-compatible API.
    // - "azblob" - Azure Blob Storage
    pub provider_kind: String,
    pub config: StorageProviderSpecificConfigMerged,
    // The maximum file size that may be uploaded in kilobytes.
    #[serde(default)]
    pub max_upload_size_kb: Option<u64>,
}

impl FileStorageProviderConfig {
    pub fn specific_config(&self) -> Result<StorageProviderSpecificConfig, Report> {
        self.config
            .clone()
            .into_specific_config(&self.provider_kind)
    }
}

#[derive(Debug, Deserialize, PartialEq, Eq, Clone)]
pub enum StorageProviderSpecificConfig {
    S3(StorageProviderS3Config),
    AzBlob(StorageProviderAzBlobConfig),
}

#[derive(Debug, Default, Deserialize, PartialEq, Eq, Clone)]
pub struct StorageProviderAzBlobConfig {
    pub root: Option<String>,
    pub container: String,
    pub endpoint: String,
    pub account_name: Option<String>,
    pub account_key: Option<String>,
}

#[derive(Debug, Default, Deserialize, PartialEq, Eq, Clone)]
pub struct StorageProviderS3Config {
    pub endpoint: Option<String>,
    pub root: Option<String>,
    pub bucket: String,
    pub region: Option<String>,
    pub access_key_id: Option<String>,
    pub secret_access_key: Option<String>,
}

#[derive(Debug, Deserialize, PartialEq, Eq, Clone, Default)]
/// Merged config for storage provider specific configs.
pub struct StorageProviderSpecificConfigMerged {
    pub access_key_id: Option<String>,
    pub account_key: Option<String>,
    pub account_name: Option<String>,
    pub bucket: Option<String>,
    pub container: Option<String>,
    pub endpoint: Option<String>,
    pub region: Option<String>,
    pub root: Option<String>,
    pub secret_access_key: Option<String>,
}

impl StorageProviderSpecificConfigMerged {
    pub fn into_specific_config(
        self,
        provider_kind: &str,
    ) -> Result<StorageProviderSpecificConfig, Report> {
        match provider_kind {
            "s3" => Ok(StorageProviderSpecificConfig::S3(StorageProviderS3Config {
                endpoint: self.endpoint,
                root: self.root,
                region: self.region,
                bucket: self
                    .bucket
                    .ok_or_eyre("`bucket` required for s3 storage provider")?,
                access_key_id: self.access_key_id,
                secret_access_key: self.secret_access_key,
            })),
            "azblob" => Ok(StorageProviderSpecificConfig::AzBlob(
                StorageProviderAzBlobConfig {
                    root: self.root,
                    container: self
                        .container
                        .ok_or_eyre("container required for azblob storage provider")?,
                    endpoint: self
                        .endpoint
                        .ok_or_eyre("container required for azblob storage provider")?,
                    account_name: self.account_name,
                    account_key: self.account_key,
                },
            )),
            _ => Err(eyre!("Unknown storage provider type {}", provider_kind)),
        }
    }
}

#[derive(Debug, Deserialize, PartialEq, Eq, Clone)]
pub struct McpServerConfig {
    // The type of transport that the MCP server uses.
    // Right now the only valid value is `sse`.
    pub transport_type: String,
    // Url of the server.
    // For `transport_type = "sse"`, this will conventionally end with `/sse`.
    pub url: String,
    // For `transport_type = "sse"`, these static headers will be sent with every request.
    pub http_headers: Option<HashMap<String, String>>,
}
