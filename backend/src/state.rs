use crate::config::AppConfig;
use eyre::Report;
use sea_orm::{Database, DatabaseConnection};

#[derive(Clone, Debug)]
pub struct AppState {
    pub db: DatabaseConnection,
}

impl AppState {
    pub async fn new(config: AppConfig) -> Result<Self, Report> {
        let db = Database::connect(&config.database_url).await?;

        Ok(Self { db })
    }
}
