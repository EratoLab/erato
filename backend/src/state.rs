use crate::actors::manager::ActorManager;
use crate::config::{AppConfig, ChatProviderConfig};
use crate::policy::engine::PolicyEngine;
use crate::services::background_tasks::BackgroundTaskManager;
use crate::services::file_storage::{FileStorage, SHAREPOINT_PROVIDER_ID};
use crate::services::langfuse::{LangfuseClient, LangfusePrompt};
use crate::services::mcp_manager::McpServers;
use eyre::Report;
use genai::adapter::AdapterKind;
use genai::resolver::{AuthData, Endpoint, ServiceTargetResolver};
use genai::{Client as GenaiClient, ModelIden, ServiceTarget};
use reqwest;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use sea_orm::{ConnectOptions, Database, DatabaseConnection};
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use tracing::instrument;

/// Wrapper around PolicyEngine that tracks when it was last rebuilt
/// This is used for the global policy engine instance in AppState
#[derive(Debug, Clone)]
pub struct GlobalPolicyEngine {
    engine: PolicyEngine,
    last_rebuild_time: Arc<RwLock<Option<Instant>>>,
}

impl Default for GlobalPolicyEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl GlobalPolicyEngine {
    pub fn new() -> Self {
        Self {
            engine: PolicyEngine::new(),
            last_rebuild_time: Arc::new(RwLock::new(None)),
        }
    }

    /// Check if the policy data needs rebuilding based on time threshold
    /// Returns true if data has never been built or if more than the specified duration has passed
    async fn needs_time_based_rebuild(&self, threshold: Duration) -> bool {
        let last_rebuild = self.last_rebuild_time.read().await;
        match *last_rebuild {
            None => true, // Never been rebuilt
            Some(instant) => instant.elapsed() > threshold,
        }
    }

    /// Rebuild data if needed based on time threshold or explicit invalidation
    /// Returns a request-scoped PolicyEngine clone for use in the request handler
    #[instrument(skip_all)]
    pub async fn get_engine_with_rebuild_check(
        &self,
        db: &DatabaseConnection,
        time_threshold: Duration,
    ) -> Result<PolicyEngine, Report> {
        let needs_time_rebuild = self.needs_time_based_rebuild(time_threshold).await;

        if needs_time_rebuild {
            tracing::debug!("Policy data needs time-based rebuild, rebuilding...");
            self.engine.rebuild_data(db).await?;
            *self.last_rebuild_time.write().await = Some(Instant::now());
        } else {
            // Even if time hasn't elapsed, check if data was explicitly invalidated
            self.engine.rebuild_data_if_needed(db).await?;
        }

        // Use clone_for_request to create an independent data_needs_rebuild state
        // This prevents invalidate_data() on the global engine from affecting
        // request-scoped clones during request processing
        Ok(self.engine.clone_for_request())
    }

    /// Invalidate the policy data, forcing a rebuild on next access
    pub async fn invalidate_data(&self) {
        self.engine.invalidate_data().await;
    }
}

#[derive(Clone, Debug)]
pub struct AppState {
    pub db: DatabaseConnection,
    pub default_file_storage_provider: Option<String>,
    pub file_storage_providers: HashMap<String, FileStorage>,
    pub mcp_servers: Arc<McpServers>,
    pub config: AppConfig,
    pub actor_manager: ActorManager,
    pub langfuse_client: LangfuseClient,
    pub global_policy_engine: GlobalPolicyEngine,
    pub background_tasks: BackgroundTaskManager,
}

impl AppState {
    pub async fn new(config: AppConfig) -> Result<Self, Report> {
        let db_connect_options = ConnectOptions::new(&config.database_url);
        // TODO: Change level to Debug, but that also seems to deactivate some other logging (e.g. Errors during request?)
        // db_connect_options.sqlx_logging_level(LevelFilter::Debug);
        let db = Database::connect(db_connect_options).await?;
        let file_storage_providers = Self::build_file_storage_providers(&config)?;
        let mcp_servers = Arc::new(McpServers::new(&config));

        // Perform connectivity checks for MCP servers
        // Failures are logged but not fatal
        mcp_servers.check_connectivity().await;

        let actor_manager = ActorManager::new(db.clone(), config.clone()).await;
        let langfuse_client = LangfuseClient::from_config(&config.integrations.langfuse)?;

        // Initialize the global policy engine
        let global_policy_engine = GlobalPolicyEngine::new();

        // Initialize the background task manager
        let background_tasks = BackgroundTaskManager::new();

        Ok(Self {
            db,
            default_file_storage_provider: config.default_file_storage_provider.clone(),
            file_storage_providers,
            mcp_servers,
            config,
            actor_manager,
            langfuse_client,
            global_policy_engine,
            background_tasks,
        })
    }

    pub fn chat_provider_for_summary(&self) -> Result<ChatProviderConfig, Report> {
        // Check if a specific summary chat provider is configured
        let chat_provider_id = if let Some(ref chat_providers) = self.config.chat_providers {
            if let Some(ref summary_provider_id) = chat_providers.summary.summary_chat_provider_id {
                // Validate that the configured provider exists
                if chat_providers.providers.contains_key(summary_provider_id) {
                    summary_provider_id.as_str()
                } else {
                    return Err(eyre::eyre!(
                        "Configured summary chat provider '{}' not found in providers",
                        summary_provider_id
                    ));
                }
            } else {
                // Fall back to highest priority provider
                self.config.determine_chat_provider(None, None)?
            }
        } else {
            // Fall back to highest priority provider
            self.config.determine_chat_provider(None, None)?
        };

        Ok(self.config.get_chat_provider(chat_provider_id).clone())
    }

    pub fn max_tokens_for_summary(&self) -> u32 {
        self.config
            .chat_providers
            .as_ref()
            .and_then(|cp| cp.summary.max_tokens)
            .unwrap_or(300) // Default to current hardcoded value
    }

    pub fn genai_for_summary(&self) -> Result<GenaiClient, Report> {
        Self::build_genai_client(self.chat_provider_for_summary()?)
    }

    pub fn genai_for_chatcompletion(
        &self,
        requested_chat_provider: Option<&str>,
        user_groups: &[String],
    ) -> Result<GenaiClient, Report> {
        let chat_provider_allowlist = self.determine_chat_provider_allowlist_for_user(user_groups);
        let allowlist_refs: Option<Vec<&str>> = chat_provider_allowlist
            .as_ref()
            .map(|list| list.iter().map(|s| s.as_str()).collect());

        let chat_provider_id = self
            .config
            .determine_chat_provider(allowlist_refs.as_deref(), requested_chat_provider)?;
        let chat_provider_config = self.config.get_chat_provider(chat_provider_id);
        Self::build_genai_client(chat_provider_config.clone())
    }

    pub fn chat_provider_for_chatcompletion(
        &self,
        requested_chat_provider: Option<&str>,
        user_groups: &[String],
    ) -> Result<ChatProviderConfig, Report> {
        let chat_provider_allowlist = self.determine_chat_provider_allowlist_for_user(user_groups);
        let allowlist_refs: Option<Vec<&str>> = chat_provider_allowlist
            .as_ref()
            .map(|list| list.iter().map(|s| s.as_str()).collect());

        let chat_provider_id = self
            .config
            .determine_chat_provider(allowlist_refs.as_deref(), requested_chat_provider)?;
        Ok(self.config.get_chat_provider(chat_provider_id).clone())
    }

    /// Determines chat provider allowlist for a user based on their group memberships.
    /// Uses the model_permissions configuration to filter available chat providers.
    #[instrument(skip_all)]
    pub fn determine_chat_provider_allowlist_for_user(
        &self,
        user_groups: &[String],
    ) -> Option<Vec<String>> {
        // Get all available chat provider IDs
        let all_provider_ids: Vec<String> =
            if let Some(chat_providers) = &self.config.chat_providers {
                chat_providers.providers.keys().cloned().collect()
            } else if self.config.chat_provider.is_some() {
                // Fallback to single provider - use "default" as the provider ID for backward compatibility
                vec!["default".to_string()]
            } else {
                vec![]
            };

        let allowed_providers = self
            .config
            .model_permissions
            .filter_allowed_chat_provider_ids(&all_provider_ids, user_groups);

        // If the filtered list is the same as the original list, return None (no restrictions)
        if allowed_providers.len() == all_provider_ids.len() {
            tracing::debug!("Model permissions allow all available chat providers");
            None
        } else {
            tracing::debug!(
                ?allowed_providers,
                "Model permissions filtered chat providers"
            );
            Some(allowed_providers)
        }
    }

    /// Get available chat models for the user, taking into account any allowlist restrictions.
    /// Returns a list of (provider_id, display_name) pairs.
    pub fn available_models(&self, user_groups: &[String]) -> Vec<(String, String)> {
        let chat_provider_allowlist = self.determine_chat_provider_allowlist_for_user(user_groups);
        let allowlist_refs: Option<Vec<&str>> = chat_provider_allowlist
            .as_ref()
            .map(|list| list.iter().map(|s| s.as_str()).collect());

        let available_provider_ids = self
            .config
            .available_chat_providers(allowlist_refs.as_deref());

        available_provider_ids
            .into_iter()
            .map(|provider_id| {
                let config = self.config.get_chat_provider(provider_id);
                let display_name = config.model_display_name().to_string();
                (provider_id.to_string(), display_name)
            })
            .collect()
    }

    pub fn default_file_storage_provider(&self) -> &FileStorage {
        if let Some(provider_id) = &self.default_file_storage_provider {
            self.file_storage_providers.get(provider_id).unwrap()
        } else {
            // Filter out the SharePoint provider as it's an integration-based provider
            // that shouldn't be considered for default file storage
            let non_integration_providers: Vec<_> = self
                .file_storage_providers
                .iter()
                .filter(|(id, _)| id.as_str() != SHAREPOINT_PROVIDER_ID)
                .collect();

            if non_integration_providers.len() == 1 {
                non_integration_providers[0].1
            } else {
                // Should already be verified during construction/config validation
                unreachable!("No default file storage provider configured");
            }
        }
    }

    pub fn default_file_storage_provider_id(&self) -> String {
        if let Some(provider_id) = &self.default_file_storage_provider {
            provider_id.clone()
        } else {
            // Filter out the SharePoint provider as it's an integration-based provider
            // that shouldn't be considered for default file storage
            let non_integration_providers: Vec<_> = self
                .file_storage_providers
                .keys()
                .filter(|id| id.as_str() != SHAREPOINT_PROVIDER_ID)
                .collect();

            if non_integration_providers.len() == 1 {
                non_integration_providers[0].clone()
            } else {
                // Should already be verified during construction/config validation
                unreachable!("No default file storage provider configured");
            }
        }
    }

    pub fn build_genai_client(config: ChatProviderConfig) -> Result<GenaiClient, Report> {
        let base_url = config.base_url.clone();
        let request_params = config.additional_request_parameters_map();
        let request_headers = config.additional_request_headers_map();

        // Create a custom reqwest client with the additional headers
        let mut client_builder = reqwest::ClientBuilder::new();

        // Add default headers if specified
        let mut header_map = HeaderMap::new();
        for (key, value) in request_headers {
            header_map.insert(HeaderName::from_str(&key)?, HeaderValue::from_str(&value)?);
        }

        client_builder = client_builder
            .default_headers(header_map)
            .connection_verbose(true);

        let custom_client = client_builder.build()?;

        let genai_client = genai::ClientBuilder::default()
            .with_reqwest(custom_client)
            .with_service_target_resolver(ServiceTargetResolver::from_resolver_fn(move |_service_target: ServiceTarget| -> Result<ServiceTarget, genai::resolver::Error> {
                let adapter_kind = match config.provider_kind.as_str() {
                    "ollama" => Ok(AdapterKind::Ollama),
                    "openai" => Ok(AdapterKind::OpenAI),
                    _ => Err(genai::resolver::Error::Custom("Unknown provider kind".to_string()))
                }?;

                let mut endpoint = default_endpoint(adapter_kind);

                if let Some(base_url) = base_url.clone() {
                    let mut url_str = base_url;
                    // Add additional request parameters if specified
                    if !request_params.is_empty() {
                        let mut first_param = true;
                        for (key, value) in &request_params {
                            if first_param {
                                // First parameter needs ? or & depending on whether the URL already has parameters
                                if url_str.contains('?') {
                                    url_str.push('&');
                                } else {
                                    url_str.push('?');
                                }
                                first_param = false;
                            } else {
                                // Subsequent parameters always use &
                                url_str.push('&');
                            }
                            url_str.push_str(&format!("{}={}", key, value));
                        }
                    }
                    endpoint = Endpoint::from_owned(url_str);
                }

                // TODO: Allow specifying auth in config
                let mut auth = AuthData::from_single("PLACEHOLDER");
                if let Some(api_key) = config.api_key.clone() {
                    auth = AuthData::from_single(api_key);
                }

                let model = ModelIden::new(adapter_kind, config.model_name.clone());
                Ok(ServiceTarget { endpoint, auth, model })
            },
        )).build();
        Ok(genai_client)
    }

    fn build_file_storage_providers(
        config: &AppConfig,
    ) -> Result<HashMap<String, FileStorage>, Report> {
        let mut file_storage_providers = HashMap::new();
        for (provider_config_id, provider_config) in &config.file_storage_providers {
            let provider = FileStorage::from_config(provider_config)?;
            file_storage_providers.insert(provider_config_id.clone(), provider);
        }

        // Register Sharepoint file storage if the integration is enabled
        if config.integrations.experimental_sharepoint.enabled
            && config
                .integrations
                .experimental_sharepoint
                .file_upload_enabled
        {
            file_storage_providers.insert(
                SHAREPOINT_PROVIDER_ID.to_string(),
                FileStorage::sharepoint(),
            );
        }

        Ok(file_storage_providers)
    }

    /// Get the system prompt for a given chat provider configuration.
    /// This resolves either a static system prompt or retrieves one from Langfuse.
    pub async fn get_system_prompt(
        &self,
        config: &ChatProviderConfig,
    ) -> Result<Option<String>, Report> {
        // If a static system prompt is configured, return it
        if let Some(system_prompt) = &config.system_prompt {
            tracing::debug!(
                system_prompt_length = system_prompt.len(),
                "Using static system prompt"
            );
            return Ok(Some(system_prompt.clone()));
        }

        // If Langfuse system prompt is configured, retrieve it
        if let Some(langfuse_config) = &config.system_prompt_langfuse {
            tracing::debug!(
                prompt_name = %langfuse_config.prompt_name,
                "Retrieving system prompt from Langfuse"
            );

            let langfuse_prompt = self
                .langfuse_client
                .get_prompt(&langfuse_config.prompt_name)
                .await?;

            let system_prompt = extract_system_prompt_from_langfuse_prompt(&langfuse_prompt)?;

            tracing::debug!(
                prompt_name = %langfuse_config.prompt_name,
                system_prompt_length = system_prompt.len(),
                "Successfully retrieved system prompt from Langfuse"
            );

            return Ok(Some(system_prompt));
        }

        // No system prompt configured
        tracing::debug!("No system prompt configured");
        Ok(None)
    }
}

/// Extract the system prompt content from a Langfuse prompt response.
/// This handles different prompt formats that Langfuse might return.
fn extract_system_prompt_from_langfuse_prompt(prompt: &LangfusePrompt) -> Result<String, Report> {
    tracing::debug!(
        prompt_type = %prompt.prompt_type,
        "Extracting system prompt from Langfuse prompt"
    );

    match prompt.prompt_type.as_str() {
        "text" => {
            // For text prompts, the content should be directly in the prompt field
            if let Some(content) = prompt.prompt.as_str() {
                Ok(content.to_string())
            } else {
                Err(eyre::eyre!(
                    "Expected string content for text prompt '{}', but got: {:?}",
                    prompt.name,
                    prompt.prompt
                ))
            }
        }
        "chat" => {
            // For chat prompts, look for system message in the messages array
            if let Some(messages) = prompt.prompt.as_array() {
                for message in messages {
                    if let Some(message_obj) = message.as_object()
                        && let Some(role) = message_obj.get("role").and_then(|r| r.as_str())
                        && role == "system"
                        && let Some(content) = message_obj.get("content").and_then(|c| c.as_str())
                    {
                        return Ok(content.to_string());
                    }
                }
                Err(eyre::eyre!(
                    "No system message found in chat prompt '{}'. Available messages: {:?}",
                    prompt.name,
                    messages
                ))
            } else {
                Err(eyre::eyre!(
                    "Expected array of messages for chat prompt '{}', but got: {:?}",
                    prompt.name,
                    prompt.prompt
                ))
            }
        }
        _ => Err(eyre::eyre!(
            "Unsupported prompt type '{}' for prompt '{}'. Supported types are 'text' and 'chat'.",
            prompt.prompt_type,
            prompt.name
        )),
    }
}

pub fn default_endpoint(kind: AdapterKind) -> Endpoint {
    match kind {
        AdapterKind::OpenAI => Endpoint::from_static("https://api.openai.com/v1/"),
        AdapterKind::Ollama => Endpoint::from_static("http://localhost:11434/v1/"),
        _ => unimplemented!("Default endpoint not implemented for this adapter kind"),
    }
}
