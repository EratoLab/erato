//! Integration tests for the Erato backend.
//!
//! This module contains the main test setup and shared utilities used across
//! all integration tests. Individual test modules are organized by feature area.

#![allow(clippy::manual_strip)]

use ctor::ctor;
use erato::config::{AppConfig, LangfuseConfig};
use erato::services::background_tasks::BackgroundTaskManager;
use erato::services::file_storage::{FileStorage, SHAREPOINT_PROVIDER_ID};
use erato::services::langfuse::LangfuseClient;
use erato::state::{AppState, GlobalPolicyEngine};
use sqlx::Pool;
use sqlx::postgres::Postgres;
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
    unsafe {
        std::env::set_var(
            "DATABASE_URL",
            "postgres://eratouser:eratopw@127.0.0.1:5432/erato",
        )
    }
}

// TODO: More proper way would be via SqitchMigration but we can't build them in a static way yet.
// pub static MIGRATOR: sqlx::migrate::Migrator = Migrator::new(SqitchMigrationSource::new(PathBuf::from("./sqitch/sqitch_summary.json")));
pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./sqitch/deploy");

// pub fn test_app_config() -> AppConfig {
//     let mut builder = AppConfig::config_schema_builder(None, true).unwrap();
//     builder = builder
//         .set_override("chat_provider.provider_kind", "ollama")
//         .unwrap();
//     builder = builder
//         .set_override("chat_provider.model_name", "smollm2:135m")
//         .unwrap();
//     builder = builder
//         .set_override("chat_provider.base_url", "http://localhost:12434/v1/")
//         .unwrap();
//
//     let config_schema = builder.build().unwrap();
//     config_schema.try_deserialize().unwrap()
// }

pub async fn test_app_state(app_config: AppConfig, pool: Pool<Postgres>) -> AppState {
    test_app_state_internal(app_config, pool, false).await
}

/// Create a test app state with Sharepoint integration enabled.
pub async fn test_app_state_with_sharepoint(
    mut app_config: AppConfig,
    pool: Pool<Postgres>,
) -> AppState {
    // Enable Sharepoint integration
    app_config.integrations.experimental_sharepoint.enabled = true;
    app_config
        .integrations
        .experimental_sharepoint
        .file_upload_enabled = true;
    app_config
        .integrations
        .experimental_sharepoint
        .auth_via_access_token = true;

    test_app_state_internal(app_config, pool, true).await
}

async fn test_app_state_internal(
    app_config: AppConfig,
    pool: Pool<Postgres>,
    sharepoint_enabled: bool,
) -> AppState {
    let db = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool);
    let mut file_storage_providers = HashMap::new();

    let provider = FileStorage::from_config(
        app_config
            .file_storage_providers
            .get("minio")
            .expect("Unable to get `minio` filestorage from app_config"),
    )
    .expect("Unable to instantiate FileStorage");
    file_storage_providers.insert("minio".to_owned(), provider);

    // Register Sharepoint file storage if enabled
    if sharepoint_enabled {
        file_storage_providers.insert(
            SHAREPOINT_PROVIDER_ID.to_string(),
            FileStorage::sharepoint(),
        );
    }

    let actor_manager =
        erato::actors::manager::ActorManager::new(db.clone(), app_config.clone()).await;

    // Create a disabled Langfuse client for testing
    let langfuse_config = LangfuseConfig {
        enabled: false,
        ..Default::default()
    };
    let langfuse_client = LangfuseClient::from_config(&langfuse_config).unwrap();

    let global_policy_engine = GlobalPolicyEngine::new();

    let app_state = AppState {
        db: db.clone(),
        default_file_storage_provider: None,
        file_storage_providers,
        mcp_servers: Arc::new(Default::default()),
        config: app_config,
        actor_manager,
        langfuse_client,
        global_policy_engine,
        background_tasks: BackgroundTaskManager::new(),
    };

    // For tests: Initialize policy engine and work around the middleware rebuild issue
    // The problem is that policy invalidation during API calls doesn't trigger proper rebuilds
    // in the test environment, causing subsequent API calls to fail with "Policy data is stale"

    // Do initial rebuild to populate policy data
    let policy_engine = app_state
        .global_policy_engine
        .get_engine_with_rebuild_check(&db, std::time::Duration::ZERO)
        .await
        .unwrap();

    // Ensure any invalidated state is rebuilt immediately
    // This handles the case where the policy engine might be in an invalidated state
    policy_engine.rebuild_data_if_needed(&db).await.unwrap();

    app_state
}

// This is the main entry point for integration tests
// Add more test modules here as needed
#[test]
fn dummy() {
    // This test exists to make sure the test binary is built
    // Individual tests should go in their respective modules
    // assert!(true);
}
