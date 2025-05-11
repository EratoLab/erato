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

    // If present, will enable Sentry for error reporting.
    pub sentry_dsn: Option<String>,

    // Additional values to inject into the frontend environment as global variables.
    // This is a dictionary where each value can be a string or a map (string key, string value).
    // These will be available on the frontend via the frontend_environment mechanism, and added to the `windows` object.
    #[serde(default)]
    pub additional_frontend_environment: HashMap<String, serde_json::Value>,
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
    // Additional request parameters to be added to API requests.
    // E.g. 'api-version=2024-10-21'
    pub additional_request_parameters: Option<Vec<String>>,
    // Additional request headers to be added to API requests.
    // E.g. 'api-key=XYZ'
    pub additional_request_headers: Option<Vec<String>>,
    // Optional system prompt to use with the chat provider.
    pub system_prompt: Option<String>,
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

impl AppConfig {
    /// Separate builder, so we can also add overrides in tests.
    pub fn config_schema_builder() -> Result<ConfigBuilder<DefaultState>, ConfigError> {
        let builder = Config::builder()
            .set_default("environment", "development")?
            .set_default("http_host", "127.0.0.1")?
            .set_default("http_port", "3130")?
            .set_default("frontend_bundle_path", "./public")?
            .add_source(config::File::with_name("erato.toml").required(false))
            .add_source(
                Environment::default()
                    .try_parsing(true)
                    .separator("__")
                    .list_separator(" ")
                    .with_list_parse_key("chat_provider.additional_request_parameters")
                    .with_list_parse_key("chat_provider.additional_request_headers"),
            );
        Ok(builder)
    }

    pub fn config_schema() -> Result<Config, ConfigError> {
        let builder = Self::config_schema_builder()?;
        builder.build()
    }

    pub fn new() -> Result<Self, ConfigError> {
        let schema = Self::config_schema()?;
        // You can deserialize (and thus freeze) the entire configuration as
        schema.try_deserialize()
    }
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
