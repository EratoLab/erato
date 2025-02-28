use crate::config::{AppConfig, ChatProviderConfig};
use crate::policy::engine::PolicyEngine;
use eyre::Report;
use genai::adapter::AdapterKind;
use genai::resolver::{AuthData, Endpoint, ServiceTargetResolver};
use genai::{Client as GenaiClient, ModelIden, ServiceTarget};
use sea_orm::{Database, DatabaseConnection};

#[derive(Clone, Debug)]
pub struct AppState {
    pub db: DatabaseConnection,
    pub policy: PolicyEngine,
    pub genai_client: GenaiClient,
}

impl AppState {
    pub async fn new(config: AppConfig) -> Result<Self, Report> {
        let db = Database::connect(&config.database_url).await?;
        let policy = Self::build_policy()?;
        let genai_client = Self::build_genai_client(config.chat_provider)?;

        Ok(Self {
            db,
            policy,
            genai_client,
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

    pub fn build_genai_client(config: ChatProviderConfig) -> Result<GenaiClient, Report> {
        let base_url = config.base_url.clone();
        let genai_client = genai::ClientBuilder::default().with_service_target_resolver(ServiceTargetResolver::from_resolver_fn(move |service_target: ServiceTarget| -> Result<ServiceTarget, genai::resolver::Error> {
            let ServiceTarget { mut endpoint, .. } = service_target;

            if let Some(base_url) = base_url {
                endpoint = Endpoint::from_owned(base_url);
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
}
