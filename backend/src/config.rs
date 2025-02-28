use config::builder::DefaultState;
use config::{Config, ConfigBuilder, ConfigError, Environment};
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Default, Deserialize, PartialEq, Eq, Clone)]
pub struct AppConfig {
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
}

impl AppConfig {
    /// Separate builder, so we can also add overrides in tests.
    pub fn config_schema_builder() -> Result<ConfigBuilder<DefaultState>, ConfigError> {
        let builder = Config::builder()
            .set_default("http_host", "127.0.0.1")?
            .set_default("http_port", "3130")?
            .set_default("frontend_bundle_path", "./public")?
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
