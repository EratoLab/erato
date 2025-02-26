use crate::config::AppConfig;
use crate::policy::engine::PolicyEngine;
use eyre::Report;
use sea_orm::{Database, DatabaseConnection};

#[derive(Clone, Debug)]
pub struct AppState {
    pub db: DatabaseConnection,
    pub policy: PolicyEngine,
}

impl AppState {
    pub async fn new(config: AppConfig) -> Result<Self, Report> {
        let db = Database::connect(&config.database_url).await?;
        let policy = PolicyEngine::new()?;

        Ok(Self { db, policy })
    }

    pub fn policy(&self) -> &PolicyEngine {
        &self.policy
    }
}
