use config::builder::DefaultState;
use config::{Config, ConfigBuilder, ConfigError, Environment};
use eyre::{OptionExt, Report, eyre};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use utoipa::ToSchema;

#[derive(Debug, Default, Deserialize, PartialEq, Clone)]
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

    // Model permissions configuration for controlling access to chat providers based on user attributes.
    #[serde(default)]
    pub model_permissions: ModelPermissionsConfig,

    // Budget configuration for tracking and displaying per-user spending.
    #[serde(default)]
    pub budget: BudgetConfig,

    // Experimental assistants configuration.
    #[serde(default)]
    pub experimental_assistants: ExperimentalAssistantsConfig,

    // Experimental facets configuration.
    #[serde(default)]
    pub experimental_facets: ExperimentalFacetsConfig,

    // Caches configuration for file contents and token counts.
    #[serde(default)]
    pub caches: CachesConfig,

    // File processor configuration for controlling which file parsing library to use.
    #[serde(default)]
    pub file_processor: FileProcessorConfig,

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
                .with_list_parse_key("chat_providers.priority_order")
                .with_list_parse_key("experimental_facets.priority_order")
                .with_list_parse_key("experimental_facets.tool_call_allowlist")
                .with_list_parse_key("experimental_facets.default_selected_facets"),
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
            tracing::warn!(
                "Config key `additional_frontend_environment` is deprecated. Please use `frontend.additional_environment` instead."
            );
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
            tracing::warn!(
                "The `additional_environment` key `THEME_CUSTOMER_NAME` is deprecated for setting the theme. Please use `frontend.theme` instead."
            );
            config.frontend.theme = Some(theme_name.to_string());
        }

        // Migrate deprecated sentry_dsn to integrations.sentry.sentry_dsn
        if let Some(sentry_dsn) = config.sentry_dsn.clone() {
            tracing::warn!(
                "Config key `sentry_dsn` is deprecated. Please use `integrations.sentry.sentry_dsn` instead."
            );
            if config.integrations.sentry.sentry_dsn.is_none() {
                config.integrations.sentry.sentry_dsn = Some(sentry_dsn);
            }
        }
        config.sentry_dsn = None;

        // Validate integrations configuration
        if let Err(e) = config.integrations.langfuse.validate() {
            panic!("Invalid Langfuse configuration: {}", e);
        }

        // Validate Sharepoint configuration
        if let Err(e) = config.integrations.experimental_sharepoint.validate() {
            panic!("Invalid Sharepoint configuration: {}", e);
        }

        // Validate Entra ID configuration
        if let Err(e) = config.integrations.experimental_entra_id.validate() {
            panic!("Invalid Entra ID configuration: {}", e);
        }

        // Migrate single chat_provider to new chat_providers structure and handle Azure OpenAI migration
        config = config.migrate_chat_providers();

        // Validate chat providers configuration
        if let Err(e) = config.validate_chat_providers() {
            panic!("Invalid chat providers configuration: {}", e);
        }

        // Validate model permissions configuration
        if let Err(e) = config.model_permissions.validate() {
            panic!("Invalid model permissions configuration: {}", e);
        }

        // Validate budget configuration
        if let Err(e) = config.budget.validate() {
            panic!("Invalid budget configuration: {}", e);
        }

        // Validate file processor configuration
        if config.file_processor.processor != "parser-core"
            && config.file_processor.processor != "kreuzberg"
        {
            panic!(
                "Invalid file processor '{}'. Must be 'parser-core' or 'kreuzberg'",
                config.file_processor.processor
            );
        }

        // Validate that Langfuse is configured if any chat provider uses it
        if config.any_chat_provider_uses_langfuse() && !config.integrations.langfuse.enabled {
            panic!(
                "Chat provider uses Langfuse system prompts but Langfuse integration is not enabled. Please set integrations.langfuse.enabled = true and configure the required Langfuse settings."
            );
        }

        config
    }

    /// Migrates the old single chat_provider configuration to the new chat_providers structure.
    /// Also handles Azure OpenAI to OpenAI migration for all providers.
    pub fn migrate_chat_providers(mut self) -> Self {
        if self.chat_providers.is_none() {
            // Check if we have the old single chat_provider configured
            if let Some(chat_provider) = &self.chat_provider {
                tracing::warn!(
                    "Config key `chat_provider` is deprecated. Please use `chat_providers.providers.<provider_id>` and `chat_providers.priority_order` instead."
                );

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
                tracing::error!(
                    "No chat provider configuration found. Please configure either `chat_provider` or `chat_providers`."
                );
            }
        }

        // Migrate azure_openai to openai format for all providers in the new structure
        // and apply default model capabilities
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
                return Err(eyre!(
                    "No chat provider configuration found. Please configure either `chat_provider` or `chat_providers`."
                ));
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
    /// The providers are returned in priority_order.
    pub fn available_chat_providers(&self, chat_provider_allowlist: Option<&[&str]>) -> Vec<&str> {
        let (all_providers, priority_order): (Vec<&str>, Vec<&str>) =
            if let Some(chat_providers) = &self.chat_providers {
                let all: Vec<&str> = chat_providers
                    .providers
                    .keys()
                    .map(|s| s.as_str())
                    .collect();
                let priority: Vec<&str> = chat_providers
                    .priority_order
                    .iter()
                    .map(|s| s.as_str())
                    .collect();
                (all, priority)
            } else if let Some(chat_provider) = &self.chat_provider {
                let single = vec![chat_provider.provider_kind.as_str()];
                (single.clone(), single)
            } else {
                (vec![], vec![])
            };

        let filtered: Vec<&str> = match chat_provider_allowlist {
            Some(allowlist) => {
                let allowlist_set: std::collections::HashSet<&str> =
                    allowlist.iter().copied().collect();
                // Return providers in priority order that are both configured and in the allowlist
                priority_order
                    .iter()
                    .copied()
                    .filter(|p| all_providers.contains(p) && allowlist_set.contains(p))
                    .collect()
            }
            None => {
                // Return providers in priority order that are configured
                priority_order
                    .iter()
                    .copied()
                    .filter(|p| all_providers.contains(p))
                    .collect()
            }
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

#[derive(Debug, Deserialize, PartialEq, Clone)]
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

#[derive(Debug, Default, Deserialize, PartialEq, Clone)]
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
    // The model name to report to Langfuse for observability and tracing.
    // Falls back to model_name if not provided.
    // This is useful when the provider's model name differs from the standardized name
    // used in Langfuse (e.g., Azure deployment names vs. OpenAI model names).
    pub model_name_langfuse: Option<String>,
    // The base URL for OpenAI compatible API endpoints.
    // If not provided, will use the default for the provider.
    //
    // Should likely end with `/v1/`
    // E.g. 'http://localhost:11434/v1/'
    //
    // For Azure OpenAI, this should be the deployment endpoint URL ending with
    // either `.api.cognitive.microsoft.com`, `.openai.azure.com`,
    // `.cognitiveservices.azure.com`, or `.services.ai.azure.com`
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
    // Model capabilities configuration for this chat provider.
    #[serde(default)]
    pub model_capabilities: ModelCapabilities,
    // Model settings configuration for this chat provider.
    #[serde(default)]
    pub model_settings: ModelSettings,
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
                && !trimmed_url.contains(".cognitiveservices.azure.com")
                && !trimmed_url.contains(".services.ai.azure.com")
            {
                return Err(eyre!(
                    "Azure OpenAI base_url must end with either '.api.cognitive.microsoft.com', '.openai.azure.com', '.cognitiveservices.azure.com', or '.services.ai.azure.com' got: {}",
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
            model_name_langfuse: self.model_name_langfuse,
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
            model_capabilities: self.model_capabilities,
            model_settings: self.model_settings,
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

    /// Returns the model name to report to Langfuse, falling back to model_name if not set.
    pub fn model_name_langfuse(&self) -> &str {
        self.model_name_langfuse
            .as_ref()
            .unwrap_or(&self.model_name)
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
    // Supported values are:
    // - "sse" (Server-Sent Events)
    // - "streamable_http" (Streamable HTTP)
    pub transport_type: String,
    // Url of the server.
    // For `transport_type = "sse"`, this will conventionally end with `/sse`.
    // For `transport_type = "streamable_http"`, this should be the base HTTP endpoint.
    pub url: String,
    // Optional static HTTP headers to be sent with every request.
    // This is useful for authentication or API keys.
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

    // Whether to disable file upload functionality in the UI.
    // Defaults to `false`.
    #[serde(default)]
    pub disable_upload: bool,

    // Whether to disable automatic focusing of the chat input field.
    // This prevents unwanted scrolling behavior when navigating to pages with embedded chat.
    // Defaults to `false`.
    #[serde(default)]
    pub disable_chat_input_autofocus: bool,

    // Whether to hide logout functionality from the UI.
    // Defaults to `false`.
    #[serde(default)]
    pub disable_logout: bool,

    // Whether to enable message feedback functionality in the UI.
    // Allows users to submit thumbs up/down ratings with optional comments for messages.
    // Defaults to `false`.
    #[serde(default)]
    pub enable_message_feedback: bool,

    // Whether to enable the comment text field in message feedback.
    // When enabled, users can add optional text comments with their thumbs up/down ratings.
    // Requires `enable_message_feedback` to be true to have any effect.
    // Defaults to `false`.
    #[serde(default)]
    pub enable_message_feedback_comments: bool,

    // Time limit in seconds for editing message feedback after creation.
    // When set, feedback can only be edited within this time window.
    // When not set (default), feedback can be edited at any time.
    #[serde(default)]
    pub message_feedback_edit_time_limit_seconds: Option<u64>,
}

#[derive(Debug, Deserialize, PartialEq, Eq, Clone, Default)]
pub struct ExperimentalAssistantsConfig {
    // Whether the experimental assistants feature is enabled.
    // Defaults to `false`.
    #[serde(default)]
    pub enabled: bool,
}

#[derive(Debug, Deserialize, PartialEq, Clone, Default)]
pub struct ExperimentalFacetsConfig {
    // Map of facet id to facet configuration.
    #[serde(default)]
    pub facets: HashMap<String, FacetConfig>,

    // List of facet IDs in priority order for display.
    #[serde(default)]
    pub priority_order: Vec<String>,

    // Global tool allowlist applied regardless of selected facets.
    #[serde(default)]
    pub tool_call_allowlist: Vec<String>,

    // Global facet prompt template (optional).
    #[serde(default)]
    pub facet_prompt_template: Option<String>,

    // Whether only a single facet can be selected at the same time.
    // Defaults to `false`.
    #[serde(default)]
    pub only_single_facet: bool,

    // Whether to include the facet display name in the chat box indicator.
    // Defaults to `false`.
    #[serde(default)]
    pub show_facet_indicator_with_display_name: bool,

    // Facets that should be selected by default in the frontend.
    #[serde(default)]
    pub default_selected_facets: Vec<String>,
}

#[derive(Debug, Deserialize, PartialEq, Clone, Default)]
pub struct FacetConfig {
    // Human readable name for the facet.
    pub display_name: String,

    // Optional icon identifier (e.g. "iconoir-lightbulb").
    pub icon: Option<String>,

    // Additional system prompt to inject when this facet is selected.
    pub additional_system_prompt: Option<String>,

    // Allowlist of tools for this facet.
    #[serde(default)]
    pub tool_call_allowlist: Vec<String>,

    // Optional model settings overrides for this facet.
    #[serde(default)]
    pub model_settings: ModelSettings,

    // Disable the global facet prompt template for this facet.
    // Defaults to `false`.
    #[serde(default)]
    pub disable_facet_prompt_template: bool,
}

#[derive(Debug, Deserialize, PartialEq, Eq, Clone)]
pub struct CachesConfig {
    // Maximum size in MB for file bytes cache (raw file bytes for both text and images)
    // Defaults to 100MB
    #[serde(default = "default_file_bytes_cache_mb")]
    pub file_bytes_cache_mb: u64,

    // Maximum size in MB for file contents cache (parsed text files only)
    // Defaults to 100MB
    #[serde(default = "default_file_contents_cache_mb")]
    pub file_contents_cache_mb: u64,

    // Maximum size in MB for token count cache
    // Defaults to 100MB
    #[serde(default = "default_token_count_cache_mb")]
    pub token_count_cache_mb: u64,
}

fn default_file_bytes_cache_mb() -> u64 {
    100
}

fn default_file_contents_cache_mb() -> u64 {
    100
}

fn default_token_count_cache_mb() -> u64 {
    100
}

impl Default for CachesConfig {
    fn default() -> Self {
        Self {
            file_bytes_cache_mb: default_file_bytes_cache_mb(),
            file_contents_cache_mb: default_file_contents_cache_mb(),
            token_count_cache_mb: default_token_count_cache_mb(),
        }
    }
}

#[derive(Debug, Deserialize, PartialEq, Eq, Clone)]
pub struct FileProcessorConfig {
    /// File processor to use (currently only "kreuzberg" is supported)
    /// parser-core has been removed as it was unmaintained and yanked
    #[serde(default = "default_processor")]
    pub processor: String,
}

fn default_processor() -> String {
    "kreuzberg".to_string()
}

impl Default for FileProcessorConfig {
    fn default() -> Self {
        Self {
            processor: default_processor(),
        }
    }
}

#[derive(Debug, Deserialize, PartialEq, Eq, Clone, Default)]
pub struct ExperimentalSharepointConfig {
    // Whether the experimental Sharepoint/OneDrive integration is enabled.
    // Defaults to `false`.
    #[serde(default)]
    pub enabled: bool,

    // Whether file upload from Sharepoint/OneDrive is enabled.
    // Only has an effect if `enabled` is `true`.
    // Defaults to `true` when the integration is enabled.
    #[serde(default = "default_true")]
    pub file_upload_enabled: bool,

    // Whether to use the user's existing access token for MS Graph API calls.
    // Currently this must be `true` when the integration is enabled.
    // In the future, there may be alternative authentication methods.
    // Defaults to `true`.
    #[serde(default = "default_true")]
    pub auth_via_access_token: bool,
}

fn default_true() -> bool {
    true
}

impl ExperimentalSharepointConfig {
    /// Validates the Sharepoint configuration.
    pub fn validate(&self) -> Result<(), Report> {
        if self.enabled && !self.auth_via_access_token {
            return Err(eyre!(
                "Sharepoint integration is enabled but auth_via_access_token is false. \
                 Currently, auth_via_access_token must be true when Sharepoint is enabled."
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize, PartialEq, Eq, Clone)]
pub struct ExperimentalEntraIdConfig {
    // Whether the experimental Entra ID integration is enabled.
    // Defaults to `false`.
    #[serde(default)]
    pub enabled: bool,

    // Whether to use the user's existing access token for MS Graph API calls.
    // Currently this must be `true` when the integration is enabled.
    // In the future, there may be alternative authentication methods.
    // Defaults to `true`.
    #[serde(default = "default_true")]
    pub auth_via_access_token: bool,
}

impl Default for ExperimentalEntraIdConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            auth_via_access_token: true,
        }
    }
}

impl ExperimentalEntraIdConfig {
    /// Validates the Entra ID configuration.
    pub fn validate(&self) -> Result<(), Report> {
        if self.enabled && !self.auth_via_access_token {
            return Err(eyre!(
                "Entra ID integration is enabled but auth_via_access_token is false. \
                 Currently, auth_via_access_token must be true when Entra ID is enabled."
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize, PartialEq, Eq, Clone, Default)]
pub struct IntegrationsConfig {
    #[serde(default)]
    pub langfuse: LangfuseConfig,
    #[serde(default)]
    pub sentry: SentryConfig,
    #[serde(default)]
    pub otel: OtelConfig,
    #[serde(default)]
    pub experimental_sharepoint: ExperimentalSharepointConfig,
    #[serde(default)]
    pub experimental_entra_id: ExperimentalEntraIdConfig,
}

#[derive(Debug, Deserialize, PartialEq, Eq, Clone)]
pub struct OtelConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_otel_endpoint")]
    pub endpoint: String,
    #[serde(default = "default_otel_protocol")]
    pub protocol: String,
    #[serde(default = "default_service_name")]
    pub service_name: String,
}

impl Default for OtelConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            endpoint: default_otel_endpoint(),
            protocol: default_otel_protocol(),
            service_name: default_service_name(),
        }
    }
}

fn default_otel_endpoint() -> String {
    "http://localhost:4318".to_string()
}

fn default_otel_protocol() -> String {
    "http".to_string()
}

fn default_service_name() -> String {
    "erato-backend".to_string()
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

    // Whether user feedback should be forwarded to Langfuse as scores.
    // Defaults to `false`.
    #[serde(default)]
    pub enable_feedback: bool,
}

#[derive(Debug, Deserialize, PartialEq, Eq, Clone)]
pub struct LangfuseSystemPromptConfig {
    // The name of the prompt in Langfuse prompt management.
    pub prompt_name: String,
}

#[derive(Debug, Deserialize, PartialEq, Clone)]
pub struct ModelCapabilities {
    // Maximum number of tokens that may be provided to the model
    #[serde(default = "default_context_size_tokens")]
    pub context_size_tokens: usize,
    // Whether the model supports being provided with images for understanding
    #[serde(default)]
    pub supports_image_understanding: bool,
    // Whether the model supports reasoning mode
    #[serde(default)]
    pub supports_reasoning: bool,
    // Whether the model supports providing a verbosity parameter (for future support of GPT-5-type models)
    #[serde(default)]
    pub supports_verbosity: bool,
    // Price per 1 million input tokens (unit-less)
    #[serde(default)]
    pub cost_input_tokens_per_1m: f64,
    // Price per 1 million output tokens (unit-less)
    #[serde(default)]
    pub cost_output_tokens_per_1m: f64,
}

fn default_context_size_tokens() -> usize {
    1_000_000
}

impl Default for ModelCapabilities {
    fn default() -> Self {
        Self {
            context_size_tokens: default_context_size_tokens(),
            supports_image_understanding: false,
            supports_reasoning: false,
            supports_verbosity: false,
            cost_input_tokens_per_1m: 0.0,
            cost_output_tokens_per_1m: 0.0,
        }
    }
}

#[derive(Debug, Deserialize, PartialEq, Eq, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum ModelReasoningEffort {
    None,
    Minimal,
    Low,
    Medium,
    High,
}

#[derive(Debug, Deserialize, PartialEq, Eq, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum ModelVerbosity {
    Low,
    Medium,
    High,
}

#[derive(Debug, Deserialize, PartialEq, Clone, Default)]
pub struct ModelSettings {
    // Whether the model should generate images instead of text
    #[serde(default)]
    pub generate_images: bool,
    // Optional sampling temperature for generation.
    pub temperature: Option<f64>,
    // Optional nucleus sampling parameter.
    pub top_p: Option<f64>,
    // Optional reasoning effort level for supported models.
    pub reasoning_effort: Option<ModelReasoningEffort>,
    // Optional verbosity setting for supported models.
    pub verbosity: Option<ModelVerbosity>,
}

#[derive(Debug, Deserialize, PartialEq, Eq, Clone, Default)]
pub struct SentryConfig {
    // If present, will enable Sentry for error reporting.
    pub sentry_dsn: Option<String>,
}

#[derive(Debug, Deserialize, PartialEq, Clone, Default)]
pub struct BudgetConfig {
    // Whether budget tracking and display is enabled.
    // Defaults to `false`.
    #[serde(default)]
    pub enabled: bool,

    // The maximum budget amount per budget period (unit-less).
    // Only has an effect if `enabled` is `true`.
    pub max_budget: Option<f64>,

    // The currency to use for display purposes.
    // Only has an effect if `enabled` is `true`.
    // Defaults to `USD`.
    #[serde(default)]
    pub budget_currency: BudgetCurrency,

    // The threshold (between 0.0 and 1.0) at which to warn users about budget usage.
    // Only has an effect if `enabled` is `true`.
    // Defaults to `0.7` (70%).
    #[serde(default = "default_warn_threshold")]
    pub warn_threshold: f64,

    // Number of days that counts as one budget period.
    // Only has an effect if `enabled` is `true`.
    // Defaults to `30`.
    #[serde(default = "default_budget_period_days")]
    pub budget_period_days: u32,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq, Clone, ToSchema, Default)]
#[serde(rename_all = "UPPERCASE")]
pub enum BudgetCurrency {
    EUR,
    #[default]
    USD,
}

fn default_warn_threshold() -> f64 {
    0.7
}

fn default_budget_period_days() -> u32 {
    30
}

impl BudgetConfig {
    /// Validates the budget configuration.
    pub fn validate(&self) -> Result<(), Report> {
        if self.enabled {
            if self.max_budget.is_none() {
                return Err(eyre!("Budget is enabled but max_budget is not set"));
            }

            if let Some(max_budget) = self.max_budget
                && max_budget <= 0.0
            {
                return Err(eyre!(
                    "max_budget must be greater than 0, got: {}",
                    max_budget
                ));
            }

            if self.warn_threshold < 0.0 || self.warn_threshold > 1.0 {
                return Err(eyre!(
                    "warn_threshold must be between 0.0 and 1.0, got: {}",
                    self.warn_threshold
                ));
            }

            if self.budget_period_days == 0 {
                return Err(eyre!(
                    "budget_period_days must be greater than 0, got: {}",
                    self.budget_period_days
                ));
            }
        }
        Ok(())
    }
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

#[cfg(test)]
mod model_permissions_tests {
    use super::*;

    #[test]
    fn test_no_rules_allows_all() {
        let config = ModelPermissionsConfig {
            rules: HashMap::new(),
        };

        let available_providers = vec!["gpt-4".to_string(), "claude".to_string()];
        let user_groups = vec!["admin".to_string()];

        let result = config.filter_allowed_chat_provider_ids(&available_providers, &user_groups);
        assert_eq!(result, available_providers);
    }

    #[test]
    fn test_allow_all_rule() {
        let mut rules = HashMap::new();
        rules.insert(
            "allow_gpt".to_string(),
            ModelPermissionRule::AllowAll {
                chat_provider_ids: vec!["gpt-4".to_string()],
            },
        );

        let config = ModelPermissionsConfig { rules };
        let available_providers = vec!["gpt-4".to_string(), "claude".to_string()];
        let user_groups = vec!["admin".to_string()];

        let result = config.filter_allowed_chat_provider_ids(&available_providers, &user_groups);
        assert_eq!(result, vec!["gpt-4".to_string()]);
    }

    #[test]
    fn test_allow_for_group_members_rule_matching_group() {
        let mut rules = HashMap::new();
        rules.insert(
            "allow_claude_for_admins".to_string(),
            ModelPermissionRule::AllowForGroupMembers {
                chat_provider_ids: vec!["claude".to_string()],
                groups: vec!["admin".to_string()],
            },
        );

        let config = ModelPermissionsConfig { rules };
        let available_providers = vec!["gpt-4".to_string(), "claude".to_string()];
        let user_groups = vec!["admin".to_string()];

        let result = config.filter_allowed_chat_provider_ids(&available_providers, &user_groups);
        assert_eq!(result, vec!["claude".to_string()]);
    }

    #[test]
    fn test_allow_for_group_members_rule_no_matching_group() {
        let mut rules = HashMap::new();
        rules.insert(
            "allow_claude_for_admins".to_string(),
            ModelPermissionRule::AllowForGroupMembers {
                chat_provider_ids: vec!["claude".to_string()],
                groups: vec!["admin".to_string()],
            },
        );

        let config = ModelPermissionsConfig { rules };
        let available_providers = vec!["gpt-4".to_string(), "claude".to_string()];
        let user_groups = vec!["user".to_string()];

        let result = config.filter_allowed_chat_provider_ids(&available_providers, &user_groups);
        assert_eq!(result, Vec::<String>::new());
    }

    #[test]
    fn test_multiple_rules_any_match_allows() {
        let mut rules = HashMap::new();
        rules.insert(
            "allow_gpt_for_all".to_string(),
            ModelPermissionRule::AllowAll {
                chat_provider_ids: vec!["gpt-4".to_string()],
            },
        );
        rules.insert(
            "allow_claude_for_admins".to_string(),
            ModelPermissionRule::AllowForGroupMembers {
                chat_provider_ids: vec!["claude".to_string()],
                groups: vec!["admin".to_string()],
            },
        );

        let config = ModelPermissionsConfig { rules };
        let available_providers = vec![
            "gpt-4".to_string(),
            "claude".to_string(),
            "ollama".to_string(),
        ];

        // User with admin group should get both gpt-4 (allow-all) and claude (group match)
        let admin_user_groups = vec!["admin".to_string()];
        let admin_result =
            config.filter_allowed_chat_provider_ids(&available_providers, &admin_user_groups);
        let mut admin_expected = vec!["gpt-4".to_string(), "claude".to_string()];
        admin_expected.sort();
        let mut admin_actual = admin_result;
        admin_actual.sort();
        assert_eq!(admin_actual, admin_expected);

        // Regular user should only get gpt-4 (allow-all)
        let regular_user_groups = vec!["user".to_string()];
        let regular_result =
            config.filter_allowed_chat_provider_ids(&available_providers, &regular_user_groups);
        assert_eq!(regular_result, vec!["gpt-4".to_string()]);
    }

    #[test]
    fn test_model_permission_rule_allows_chat_provider() {
        let allow_all_rule = ModelPermissionRule::AllowAll {
            chat_provider_ids: vec!["gpt-4".to_string(), "claude".to_string()],
        };

        assert!(allow_all_rule.allows_chat_provider("gpt-4", &[]));
        assert!(allow_all_rule.allows_chat_provider("claude", &[]));
        assert!(!allow_all_rule.allows_chat_provider("ollama", &[]));

        let group_rule = ModelPermissionRule::AllowForGroupMembers {
            chat_provider_ids: vec!["premium-model".to_string()],
            groups: vec!["premium".to_string(), "admin".to_string()],
        };

        assert!(group_rule.allows_chat_provider("premium-model", &["premium".to_string()]));
        assert!(group_rule.allows_chat_provider("premium-model", &["admin".to_string()]));
        assert!(group_rule.allows_chat_provider(
            "premium-model",
            &["user".to_string(), "premium".to_string()]
        ));
        assert!(!group_rule.allows_chat_provider("premium-model", &["user".to_string()]));
        assert!(!group_rule.allows_chat_provider("other-model", &["premium".to_string()]));
    }
}

#[derive(Debug, Deserialize, PartialEq, Eq, Clone, Default)]
pub struct ModelPermissionsConfig {
    // Map of rule name to rule configuration.
    #[serde(default)]
    pub rules: HashMap<String, ModelPermissionRule>,
}

#[derive(Debug, Deserialize, PartialEq, Eq, Clone)]
#[serde(tag = "rule_type")]
pub enum ModelPermissionRule {
    #[serde(rename = "allow-all")]
    AllowAll {
        // List of chat provider IDs this rule grants access to
        chat_provider_ids: Vec<String>,
    },
    #[serde(rename = "allow-for-group-members")]
    AllowForGroupMembers {
        // List of chat provider IDs this rule grants access to
        chat_provider_ids: Vec<String>,
        // List of group names/identifiers that are allowed access
        groups: Vec<String>,
    },
}

impl ModelPermissionsConfig {
    /// Validates the model permissions configuration.
    pub fn validate(&self) -> Result<(), Report> {
        for (rule_name, rule) in &self.rules {
            if let Err(e) = rule.validate() {
                return Err(eyre!(
                    "Invalid configuration for model permission rule '{}': {}",
                    rule_name,
                    e
                ));
            }
        }
        Ok(())
    }

    /// Filters a list of chat provider IDs based on the configured permission rules.
    /// If no rules are configured, all providers are allowed.
    /// If rules are configured, a provider is allowed if at least one rule grants access to it.
    pub fn filter_allowed_chat_provider_ids(
        &self,
        available_chat_provider_ids: &[String],
        user_groups: &[String],
    ) -> Vec<String> {
        // If no rules are configured, allow all providers
        if self.rules.is_empty() {
            tracing::debug!("No model permission rules configured, allowing all chat providers");
            return available_chat_provider_ids.to_vec();
        }

        let mut allowed_providers = Vec::new();

        for chat_provider_id in available_chat_provider_ids {
            let is_allowed = self.rules.iter().any(|(rule_name, rule)| {
                let allowed = rule.allows_chat_provider(chat_provider_id, user_groups);
                if allowed {
                    tracing::debug!(
                        rule_name,
                        chat_provider_id,
                        "Rule grants access to chat provider"
                    );
                }
                allowed
            });

            if is_allowed {
                allowed_providers.push(chat_provider_id.clone());
            } else {
                tracing::debug!(chat_provider_id, "No rules grant access to chat provider");
            }
        }

        tracing::debug!(
            ?allowed_providers,
            "Final allowed chat provider IDs for user"
        );
        allowed_providers
    }
}

impl ModelPermissionRule {
    /// Validates the model permission rule configuration.
    pub fn validate(&self) -> Result<(), Report> {
        match self {
            ModelPermissionRule::AllowAll { chat_provider_ids } => {
                if chat_provider_ids.is_empty() {
                    return Err(eyre!(
                        "Allow-all rule must specify at least one chat_provider_id"
                    ));
                }
            }
            ModelPermissionRule::AllowForGroupMembers {
                chat_provider_ids,
                groups,
            } => {
                if chat_provider_ids.is_empty() {
                    return Err(eyre!(
                        "Allow-for-group-members rule must specify at least one chat_provider_id"
                    ));
                }
                if groups.is_empty() {
                    return Err(eyre!(
                        "Allow-for-group-members rule must specify at least one group"
                    ));
                }
            }
        }
        Ok(())
    }

    /// Checks if this rule allows access to a specific chat provider for the given user groups.
    pub fn allows_chat_provider(&self, chat_provider_id: &str, user_groups: &[String]) -> bool {
        match self {
            ModelPermissionRule::AllowAll { chat_provider_ids } => {
                let allows = chat_provider_ids.contains(&chat_provider_id.to_string());
                tracing::debug!(
                    chat_provider_id,
                    ?chat_provider_ids,
                    allows,
                    "Allow-all rule evaluation"
                );
                allows
            }
            ModelPermissionRule::AllowForGroupMembers {
                chat_provider_ids,
                groups,
            } => {
                let has_provider = chat_provider_ids.contains(&chat_provider_id.to_string());
                let has_matching_group = user_groups
                    .iter()
                    .any(|user_group| groups.contains(user_group));
                let allows = has_provider && has_matching_group;
                tracing::debug!(
                    chat_provider_id,
                    ?chat_provider_ids,
                    ?user_groups,
                    ?groups,
                    has_provider,
                    has_matching_group,
                    allows,
                    "Allow-for-group-members rule evaluation"
                );
                allows
            }
        }
    }
}
