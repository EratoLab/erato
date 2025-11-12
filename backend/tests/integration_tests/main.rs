//! Integration tests for the Erato backend.
//!
//! This module contains the main test setup and shared utilities used across
//! all integration tests. Individual test modules are organized by feature area.

#![allow(clippy::manual_strip)]

use ctor::ctor;
use erato::config::{
    AppConfig, FileStorageProviderConfig, LangfuseConfig, StorageProviderSpecificConfigMerged,
};
use erato::services::file_storage::FileStorage;
use erato::services::langfuse::LangfuseClient;
use erato::state::AppState;
use sqlx::postgres::Postgres;
use sqlx::Pool;
use std::collections::HashMap;
use std::default::Default;
use std::sync::Arc;
use test_log::test;

mod actors;
mod api;
mod config;
mod db;
mod llm;
mod test_utils;

// Using a (possibly brittle?) life-before-main method to set the DATABASE_URL before any tests run.
#[ctor]
fn set_test_db_url() {
    std::env::set_var(
        "DATABASE_URL",
        "postgres://eratouser:eratopw@127.0.0.1:5432/erato",
    )
}

// TODO: More proper way would be via SqitchMigration but we can't build them in a static way yet.
// pub static MIGRATOR: sqlx::migrate::Migrator = Migrator::new(SqitchMigrationSource::new(PathBuf::from("./sqitch/sqitch_summary.json")));
pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./sqitch/deploy");

pub fn test_app_config() -> AppConfig {
    let mut builder = AppConfig::config_schema_builder(None, true).unwrap();
    builder = builder
        .set_override("chat_provider.provider_kind", "ollama")
        .unwrap();
    builder = builder
        .set_override("chat_provider.model_name", "smollm2:135m")
        .unwrap();
    builder = builder
        .set_override("chat_provider.base_url", "http://localhost:12434/v1/")
        .unwrap();

    let config_schema = builder.build().unwrap();
    config_schema.try_deserialize().unwrap()
}

pub async fn test_app_state(app_config: AppConfig, pool: Pool<Postgres>) -> AppState {
    let db = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool);
    let mut file_storage_providers = HashMap::new();

    let provider = FileStorage::from_config(&FileStorageProviderConfig {
        display_name: None,
        provider_kind: "s3".to_string(),
        config: StorageProviderSpecificConfigMerged {
            endpoint: Some("http://localhost:9000".to_string()),
            bucket: Some("erato-storage".to_string()),
            region: Some("us-east-1".to_string()),
            access_key_id: Some("erato-app-user".to_string()),
            secret_access_key: Some("erato-app-password".to_string()),
            ..StorageProviderSpecificConfigMerged::default()
        },
        max_upload_size_kb: None,
    })
    .unwrap();
    file_storage_providers.insert("local_minio".to_owned(), provider);

    let actor_manager =
        erato::actors::manager::ActorManager::new(db.clone(), app_config.clone()).await;

    // Create a disabled Langfuse client for testing
    let langfuse_config = LangfuseConfig {
        enabled: false,
        ..Default::default()
    };
    let langfuse_client = LangfuseClient::from_config(&langfuse_config).unwrap();

    AppState {
        db: db.clone(),
        default_file_storage_provider: None,
        file_storage_providers,
        mcp_servers: Arc::new(Default::default()),
        config: app_config,
        actor_manager,
        langfuse_client,
    }
}

// This is the main entry point for integration tests
// Add more test modules here as needed
#[test]
fn dummy() {
    // This test exists to make sure the test binary is built
    // Individual tests should go in their respective modules
    // assert!(true);
}
