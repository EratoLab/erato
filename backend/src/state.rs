use crate::config::{AppConfig, ChatProviderConfig};
use crate::policy::engine::PolicyEngine;
use crate::services::file_storage::FileStorage;
use crate::services::mcp_manager::McpServers;
use eyre::Report;
use genai::adapter::AdapterKind;
use genai::resolver::{AuthData, Endpoint, ServiceTargetResolver};
use genai::{Client as GenaiClient, ModelIden, ServiceTarget};
use reqwest;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use sea_orm::{Database, DatabaseConnection};
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;

#[derive(Clone, Debug)]
pub struct AppState {
    pub db: DatabaseConnection,
    pub policy: PolicyEngine,
    pub genai_client: GenaiClient,
    pub system_prompt: Option<String>,
    pub default_file_storage_provider: Option<String>,
    pub file_storage_providers: HashMap<String, FileStorage>,
    pub mcp_servers: Arc<McpServers>,
}

impl AppState {
    pub async fn new(config: AppConfig) -> Result<Self, Report> {
        let db = Database::connect(&config.database_url).await?;
        let policy = Self::build_policy()?;
        let system_prompt = config.chat_provider.system_prompt.clone();
        let file_storage_providers = Self::build_file_storage_providers(&config)?;
        let genai_client = Self::build_genai_client(config.chat_provider.clone())?;
        let mcp_servers = Arc::new(McpServers::new(&config).await?);

        Ok(Self {
            db,
            policy,
            genai_client,
            system_prompt,
            default_file_storage_provider: config.default_file_storage_provider,
            file_storage_providers,
            mcp_servers,
        })
    }

    pub fn policy(&self) -> &PolicyEngine {
        &self.policy
    }

    pub fn genai(&self) -> &GenaiClient {
        &self.genai_client
    }

    pub fn build_policy() -> Result<PolicyEngine, Report> {
        PolicyEngine::new()
    }

    pub fn default_file_storage_provider(&self) -> &FileStorage {
        if let Some(provider_id) = &self.default_file_storage_provider {
            self.file_storage_providers.get(provider_id).unwrap()
        } else if self.file_storage_providers.len() == 1 {
            self.file_storage_providers.values().next().unwrap()
        } else {
            // Should already be verified during construction/config validation
            unreachable!("No default file storage provider configured");
        }
    }

    pub fn default_file_storage_provider_id(&self) -> String {
        if let Some(provider_id) = &self.default_file_storage_provider {
            provider_id.clone()
        } else if self.file_storage_providers.len() == 1 {
            self.file_storage_providers.keys().next().unwrap().clone()
        } else {
            // Should already be verified during construction/config validation
            unreachable!("No default file storage provider configured");
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

        client_builder = client_builder.default_headers(header_map);

        let custom_client = client_builder.build()?;

        let genai_client = genai::ClientBuilder::default()
            .with_reqwest(custom_client)
            .with_service_target_resolver(ServiceTargetResolver::from_resolver_fn(move |service_target: ServiceTarget| -> Result<ServiceTarget, genai::resolver::Error> {
                let ServiceTarget { mut endpoint, .. } = service_target;

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
                let auth = AuthData::from_single("PLACEHOLDER");

                let adapter_kind = match config.provider_kind.as_str() {
                    "ollama" => Ok(AdapterKind::Ollama),
                    "openai" => Ok(AdapterKind::OpenAI),
                    _ => Err(genai::resolver::Error::Custom("Unknown provider kind".to_string()))
                }?;
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
        Ok(file_storage_providers)
    }
}
