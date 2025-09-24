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
    pub chat_providers: Option<ChatProvidersConfig>,
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

    #[serde(default)]
    pub frontend: FrontendConfig,

    #[serde(default)]
    pub integrations: IntegrationsConfig,

    // If true, enables the cleanup worker that periodically deletes old data.
    // Defaults to `false`.
    pub cleanup_enabled: bool,
    // Number of days after which archived chats should be deleted by the cleanup worker.
    // Only has an effect if `cleanup_enabled` is `true`.
    // Defaults to 30.
    pub cleanup_archived_max_age_days: u32,

    // **Deprecated**: Please use `chat_providers` instead for multiple provider support and better flexibility.
    pub chat_provider: Option<ChatProviderConfig>,
    // **Deprecated**: Please use `integrations.sentry.sentry_dsn` instead.
    //
    // If present, will enable Sentry for error reporting.
    #[deprecated(note = "Please use `integrations.sentry.sentry_dsn` instead.")]
    pub sentry_dsn: Option<String>,
    // **Deprecated**: Please use `frontend.additional_environment` instead.
    //
    // This is a dictionary where each value can be a string or a map (string key, string value).
    // These will be available on the frontend via the frontend_environment mechanism, and added to the `windows` object.
    #[serde(default)]
    #[deprecated(note = "Please use `frontend.additional_environment` instead.")]
    pub additional_frontend_environment: Option<HashMap<String, serde_json::Value>>,
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
                .with_list_parse_key("chat_provider.additional_request_headers")
                .with_list_parse_key("chat_providers.priority_order"),
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
        let mut config: Self = schema.try_deserialize()?;
        config = config.migrate();
        Ok(config)
    }

    #[allow(deprecated)]
    pub fn migrate(self) -> Self {
        let mut config = self;

        if let Some(additional_frontend_env) = config.additional_frontend_environment.clone() {
            tracing::warn!("Config key `additional_frontend_environment` is deprecated. Please use `frontend.additional_environment` instead.");
            config
                .frontend
                .additional_environment
                .extend(additional_frontend_env);
        }
        config.additional_frontend_environment = None;

        if let Some(serde_json::Value::String(theme_name)) = config
            .frontend
            .additional_environment
            .get("THEME_CUSTOMER_NAME")
        {
            tracing::warn!("The `additional_environment` key `THEME_CUSTOMER_NAME` is deprecated for setting the theme. Please use `frontend.theme` instead.");
            config.frontend.theme = Some(theme_name.to_string());
        }

        // Migrate deprecated sentry_dsn to integrations.sentry.sentry_dsn
        if let Some(sentry_dsn) = config.sentry_dsn.clone() {
            tracing::warn!("Config key `sentry_dsn` is deprecated. Please use `integrations.sentry.sentry_dsn` instead.");
            if config.integrations.sentry.sentry_dsn.is_none() {
                config.integrations.sentry.sentry_dsn = Some(sentry_dsn);
            }
        }
        config.sentry_dsn = None;

        // Validate integrations configuration
        if let Err(e) = config.integrations.langfuse.validate() {
            panic!("Invalid Langfuse configuration: {}", e);
        }

        // Migrate single chat_provider to new chat_providers structure and handle Azure OpenAI migration
        config = config.migrate_chat_providers();

        // Validate chat providers configuration
        if let Err(e) = config.validate_chat_providers() {
            panic!("Invalid chat providers configuration: {}", e);
        }

        // Validate that Langfuse is configured if any chat provider uses it
        if config.any_chat_provider_uses_langfuse() && !config.integrations.langfuse.enabled {
            panic!("Chat provider uses Langfuse system prompts but Langfuse integration is not enabled. Please set integrations.langfuse.enabled = true and configure the required Langfuse settings.");
        }

        config
    }

    /// Migrates the old single chat_provider configuration to the new chat_providers structure.
    /// Also handles Azure OpenAI to OpenAI migration for all providers.
    pub fn migrate_chat_providers(mut self) -> Self {
        if self.chat_providers.is_none() {
            // Check if we have the old single chat_provider configured
            if let Some(chat_provider) = &self.chat_provider {
                tracing::warn!("Config key `chat_provider` is deprecated. Please use `chat_providers.providers.<provider_id>` and `chat_providers.priority_order` instead.");

                let mut providers = HashMap::new();
                providers.insert("default".to_string(), chat_provider.clone());

                self.chat_providers = Some(ChatProvidersConfig {
                    priority_order: vec!["default".to_string()],
                    providers,
                    summary: SummaryConfig::default(),
                });

                // Clear the old chat_provider after migration
                self.chat_provider = None;
            } else {
                // No chat provider configured at all - this will be caught by validation later
                tracing::error!("No chat provider configuration found. Please configure either `chat_provider` or `chat_providers`.");
            }
        }

        // Migrate azure_openai to openai format for all providers in the new structure
        if let Some(chat_providers) = &mut self.chat_providers {
            for (provider_id, provider_config) in &mut chat_providers.providers {
                if provider_config.provider_kind == "azure_openai" {
                    match provider_config.clone().migrate_azure_openai_to_openai() {
                        Ok(migrated_config) => {
                            *provider_config = migrated_config;
                        }
                        Err(e) => {
                            panic!(
                                "Failed to migrate azure_openai config for provider '{}': {}",
                                provider_id, e
                            );
                        }
                    }
                }
            }
        }

        self
    }

    /// Validates the chat providers configuration.
    pub fn validate_chat_providers(&self) -> Result<(), eyre::Report> {
        if let Some(chat_providers) = &self.chat_providers {
            // Validate priority order is not empty
            if chat_providers.priority_order.is_empty() {
                return Err(eyre!(
                    "Priority order cannot be empty when chat_providers is configured"
                ));
            }

            // Validate that at least one provider is configured
            if chat_providers.providers.is_empty() {
                return Err(eyre!("At least one chat provider must be configured"));
            }

            // Warn if a provider_id in priority order is not configured
            for provider_id in &chat_providers.priority_order {
                if !chat_providers.providers.contains_key(provider_id) {
                    tracing::warn!(
                        "Provider '{}' in priority order is not configured in providers",
                        provider_id
                    );
                }
            }

            // Warn if a configured provider is not in priority order
            for provider_id in chat_providers.providers.keys() {
                if !chat_providers.priority_order.contains(provider_id) {
                    tracing::warn!(
                        "Provider '{}' is configured but not in priority order",
                        provider_id
                    );
                }
            }

            // Validate individual provider configurations
            for (provider_id, provider_config) in &chat_providers.providers {
                if let Err(e) = provider_config.validate() {
                    return Err(eyre!(
                        "Invalid configuration for provider '{}': {}",
                        provider_id,
                        e
                    ));
                }
            }
        } else {
            // If no new chat_providers config, ensure we have at least the old single provider configured
            if self.chat_provider.is_none() {
                return Err(eyre!("No chat provider configuration found. Please configure either `chat_provider` or `chat_providers`."));
            }
        }
        Ok(())
    }

    /// Returns the maximum configured file upload size in bytes, if any.
    pub fn max_upload_size_bytes(&self) -> Option<u64> {
        self.file_storage_providers
            .values()
            .filter_map(|p| p.max_upload_size_kb)
            .max()
            .map(|kb| kb * 1024)
    }

    pub fn additional_frontend_environment(&self) -> HashMap<String, serde_json::Value> {
        self.frontend.additional_environment.clone()
    }

    /// Returns the list of available chat providers, filtered by the optional allowlist.
    pub fn available_chat_providers(&self, chat_provider_allowlist: Option<&[&str]>) -> Vec<&str> {
        let all_providers: Vec<&str> = if let Some(chat_providers) = &self.chat_providers {
            chat_providers
                .providers
                .keys()
                .map(|s| s.as_str())
                .collect()
        } else if let Some(chat_provider) = &self.chat_provider {
            vec![chat_provider.provider_kind.as_str()]
        } else {
            vec![]
        };

        let filtered: Vec<&str> = match chat_provider_allowlist {
            Some(allowlist) => {
                let allowlist_set: std::collections::HashSet<&str> =
                    allowlist.iter().copied().collect();
                all_providers
                    .iter()
                    .copied()
                    .filter(|p| allowlist_set.contains(p))
                    .collect()
            }
            None => all_providers,
        };
        tracing::debug!(?filtered, "Available chat providers after allowlist filter");
        filtered
    }

    /// Determines the chat provider to use based on precedence, allowlist, and requested provider.
    ///
    /// # Arguments
    /// * `chat_provider_allowlist` - Optional list of allowed provider kinds.
    /// * `requested_chat_provider` - Optional requested provider kind.
    ///
    /// # Returns
    /// The chosen provider id as a string slice, or an error if not allowed.
    pub fn determine_chat_provider<'a>(
        &'a self,
        chat_provider_allowlist: Option<&[&str]>,
        requested_chat_provider: Option<&str>,
    ) -> Result<&'a str, eyre::Report> {
        let (all_providers, precedence_order): (Vec<&str>, Vec<&str>) =
            if let Some(chat_providers) = &self.chat_providers {
                let all: Vec<&str> = chat_providers
                    .providers
                    .keys()
                    .map(|s| s.as_str())
                    .collect();
                let precedence: Vec<&str> = chat_providers
                    .priority_order
                    .iter()
                    .map(|s| s.as_str())
                    .collect();
                (all, precedence)
            } else if self.chat_provider.is_some() {
                // Fallback to single provider - use "default" as the provider ID for backward compatibility
                let single = vec!["default"];
                (single.clone(), single)
            } else {
                (vec![], vec![])
            };

        let allowed: Vec<&'a str> = match chat_provider_allowlist {
            Some(allowlist) => {
                let allowlist_set: std::collections::HashSet<&str> =
                    allowlist.iter().copied().collect();
                all_providers
                    .iter()
                    .copied()
                    .filter(|p| allowlist_set.contains(p))
                    .collect()
            }
            None => all_providers,
        };
        tracing::debug!(?allowed, "Allowed chat providers after allowlist filter");

        if let Some(requested) = requested_chat_provider {
            tracing::debug!(requested, "Requested chat provider");
            // Return the matching &str from allowed (which is from self), not the input reference
            if let Some(&matching) = allowed.iter().find(|&&p| p == requested) {
                tracing::debug!(requested, "Requested chat provider is allowed");
                Ok(matching)
            } else {
                tracing::debug!(
                    requested,
                    ?allowed,
                    "Requested chat provider is not allowed"
                );
                Err(eyre!(
                    "Requested chat provider '{}' is not in the allowed list: {:?}",
                    requested,
                    allowed
                ))
            }
        } else {
            // Pick the first in precedence order that is allowed
            let chosen = precedence_order
                .iter()
                .copied()
                .find(|p| allowed.contains(p));
            tracing::debug!(
                ?chosen,
                ?precedence_order,
                ?allowed,
                "Choosing chat provider by precedence"
            );
            chosen.ok_or_else(|| eyre!("No allowed chat provider found"))
        }
    }

    /// Returns the ChatProviderConfig for the given provider id.
    pub fn get_chat_provider(&self, provider_id: &str) -> &ChatProviderConfig {
        if let Some(chat_providers) = &self.chat_providers {
            chat_providers
                .providers
                .get(provider_id)
                .unwrap_or_else(|| {
                    panic!("Chat provider '{}' not found in configuration", provider_id)
                })
        } else if let Some(chat_provider) = &self.chat_provider {
            // Fallback to single provider for backward compatibility
            // In legacy mode, we accept any provider_id and return the single provider
            chat_provider
        } else {
            panic!("No chat provider configuration found");
        }
    }

    /// Returns true if any chat provider uses Langfuse for system prompts.
    pub fn any_chat_provider_uses_langfuse(&self) -> bool {
        if let Some(chat_providers) = &self.chat_providers {
            chat_providers
                .providers
                .values()
                .any(|p| p.uses_langfuse_system_prompt())
        } else if let Some(chat_provider) = &self.chat_provider {
            // Fallback to single provider for backward compatibility
            chat_provider.uses_langfuse_system_prompt()
        } else {
            false
        }
    }

    /// Returns the Sentry DSN from either the new location (integrations.sentry.sentry_dsn)
    /// or the old deprecated location (sentry_dsn) for backward compatibility.
    #[allow(deprecated)]
    pub fn get_sentry_dsn(&self) -> Option<&String> {
        self.integrations
            .sentry
            .sentry_dsn
            .as_ref()
            .or(self.sentry_dsn.as_ref())
    }
}

#[derive(Debug, Deserialize, PartialEq, Eq, Clone)]
pub struct ChatProvidersConfig {
    // Priority order of chat providers to use.
    // Each string should match a key in the providers map.
    pub priority_order: Vec<String>,
    // Map of provider_id to provider configuration.
    pub providers: HashMap<String, ChatProviderConfig>,
    // Configuration for summary generation.
    #[serde(default)]
    pub summary: SummaryConfig,
}

#[derive(Debug, Default, Deserialize, PartialEq, Eq, Clone)]
pub struct SummaryConfig {
    // The chat provider ID to use for summary generation.
    // If not specified, uses the highest priority chat provider.
    pub summary_chat_provider_id: Option<String>,
    // Maximum output tokens for summary generation.
    // Defaults to 300 if not specified.
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Default, Deserialize, PartialEq, Eq, Clone)]
pub struct ChatProviderConfig {
    // May be one of:
    // - "openai" (applicable for both OpenAI and AzureGPT)
    // - "azure_openai" (will be automatically converted to "openai" format during config loading)
    // - "ollama"
    pub provider_kind: String,
    // The model name to use for the chat provider.
    //
    // E.g. `gpt-4o`
    pub model_name: String,
    // The display name for the model shown to users.
    // Falls back to model_name if not provided.
    pub model_display_name: Option<String>,
    // The base URL for OpenAI compatible API endpoints.
    // If not provided, will use the default for the provider.
    //
    // Should likely end with `/v1/`
    // E.g. 'http://localhost:11434/v1/'
    //
    // For Azure OpenAI, this should be the deployment endpoint URL ending with
    // either `.api.cognitive.microsoft.com` or `.openai.azure.com`
    // E.g. 'https://germanywestcentral.api.cognitive.microsoft.com'
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    // For Azure OpenAI, the API version to use (e.g. "2024-10-21").
    // This will be automatically converted to additional_request_parameters during config loading.
    pub api_version: Option<String>,
    // Additional request parameters to be added to API requests.
    // E.g. 'api-version=2024-10-21'
    pub additional_request_parameters: Option<Vec<String>>,
    // Additional request headers to be added to API requests.
    // E.g. 'api-key=XYZ'
    pub additional_request_headers: Option<Vec<String>>,
    // Optional system prompt to use with the chat provider.
    pub system_prompt: Option<String>,
    // Optional Langfuse system prompt configuration.
    // Mutually exclusive with system_prompt.
    pub system_prompt_langfuse: Option<LangfuseSystemPromptConfig>,
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

    /// Migrates azure_openai configuration to openai format
    pub fn migrate_azure_openai_to_openai(self) -> Result<Self, Report> {
        if self.provider_kind != "azure_openai" {
            return Ok(self);
        }

        // Validate and process base_url
        let base_url = if let Some(url) = &self.base_url {
            let trimmed_url = url.trim_end_matches('/');

            // Validate that the URL ends with the expected Azure OpenAI domains
            if !trimmed_url.contains(".api.cognitive.microsoft.com")
                && !trimmed_url.contains(".openai.azure.com")
            {
                return Err(eyre!(
                    "Azure OpenAI base_url must end with either '.api.cognitive.microsoft.com' or '.openai.azure.com', got: {}",
                    url
                ));
            }

            // Construct the full deployment URL by appending the model name as deployment name
            let deployment_url = format!("{}/openai/deployments/{}/", trimmed_url, self.model_name);
            Some(deployment_url)
        } else {
            return Err(eyre!("base_url is required for azure_openai provider"));
        };

        // Prepare additional_request_parameters
        let mut additional_params = self.additional_request_parameters.unwrap_or_default();
        if let Some(api_version) = &self.api_version {
            additional_params.push(format!("api-version={}", api_version));
        }

        // Prepare additional_request_headers
        let mut additional_headers = self.additional_request_headers.unwrap_or_default();
        if let Some(api_key) = &self.api_key {
            additional_headers.push(format!("api-key={}", api_key));
        }

        Ok(ChatProviderConfig {
            provider_kind: "openai".to_string(),
            model_name: self.model_name,
            model_display_name: self.model_display_name,
            base_url,
            api_key: None,     // Moved to headers
            api_version: None, // Moved to parameters
            additional_request_parameters: if additional_params.is_empty() {
                None
            } else {
                Some(additional_params)
            },
            additional_request_headers: if additional_headers.is_empty() {
                None
            } else {
                Some(additional_headers)
            },
            system_prompt: self.system_prompt,
            system_prompt_langfuse: self.system_prompt_langfuse,
        })
    }

    /// Validates that system_prompt and system_prompt_langfuse are mutually exclusive.
    pub fn validate(&self) -> Result<(), Report> {
        if self.system_prompt.is_some() && self.system_prompt_langfuse.is_some() {
            return Err(eyre!(
                "Cannot specify both system_prompt and system_prompt_langfuse. They are mutually exclusive."
            ));
        }
        Ok(())
    }

    /// Returns true if this chat provider uses Langfuse for system prompts.
    pub fn uses_langfuse_system_prompt(&self) -> bool {
        self.system_prompt_langfuse.is_some()
    }

    /// Returns the display name for the model, falling back to model_name if not set.
    pub fn model_display_name(&self) -> &str {
        self.model_display_name.as_ref().unwrap_or(&self.model_name)
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

#[derive(Debug, Deserialize, PartialEq, Eq, Clone, Default)]
pub struct FrontendConfig {
    // The name of a theme to use for the frontend.
    // Themes can be placed in `frontend/public/custom-theme/<THEME_NAME>` directories.
    pub theme: Option<String>,

    // Additional values to inject into the frontend environment as global variables.
    // This is a dictionary where each value can be a string or a map (string key, string value).
    // These will be available on the frontend via the frontend_environment mechanism, and added to the `windows` object.
    #[serde(default)]
    pub additional_environment: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Deserialize, PartialEq, Eq, Clone, Default)]
pub struct IntegrationsConfig {
    #[serde(default)]
    pub langfuse: LangfuseConfig,
    #[serde(default)]
    pub sentry: SentryConfig,
}

#[derive(Debug, Deserialize, PartialEq, Eq, Clone, Default)]
pub struct LangfuseConfig {
    // Whether Langfuse integration is enabled.
    // Defaults to `false`.
    #[serde(default)]
    pub enabled: bool,

    // The base URL for the Langfuse API.
    // E.g. 'https://cloud.langfuse.com' or 'http://localhost:3000'
    pub base_url: Option<String>,

    // The public key for Langfuse API authentication.
    pub public_key: Option<String>,

    // The secret key for Langfuse API authentication.
    pub secret_key: Option<String>,

    // Whether tracing is enabled for Langfuse.
    // Defaults to `false`.
    #[serde(default)]
    pub tracing_enabled: bool,
}

#[derive(Debug, Deserialize, PartialEq, Eq, Clone)]
pub struct LangfuseSystemPromptConfig {
    // The name of the prompt in Langfuse prompt management.
    pub prompt_name: String,
}

#[derive(Debug, Deserialize, PartialEq, Eq, Clone, Default)]
pub struct SentryConfig {
    // If present, will enable Sentry for error reporting.
    pub sentry_dsn: Option<String>,
}

impl LangfuseConfig {
    /// Validates that required fields are set when the integration is enabled.
    pub fn validate(&self) -> Result<(), Report> {
        if self.enabled {
            if self.public_key.is_none() {
                return Err(eyre!(
                    "Langfuse integration is enabled but public_key is not set"
                ));
            }
            if self.secret_key.is_none() {
                return Err(eyre!(
                    "Langfuse integration is enabled but secret_key is not set"
                ));
            }
        }
        Ok(())
    }
}
