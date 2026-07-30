use crate::config::ConfigSourceFile;
use crate::db::entity::prelude::RuntimeConfiguration;
use crate::db::entity::runtime_configuration;
use crate::services::config_redaction::{RUNTIME_CONFIGURATION_REDACTION_PATHS, redact_toml_keys};
use crate::state::AppState;
use eyre::Report;
use sea_orm::{
    ActiveValue::Set, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, TransactionTrait,
};

pub const ERATO_BACKEND_SOURCE_SERVICE: &str = "erato_backend";

// ASCII "erato-rc", used only to serialize replacement transactions.
const RUNTIME_CONFIGURATION_ADVISORY_LOCK_KEY: i64 = 7_310_012_297_885_086_307;

pub async fn mirror_erato_backend_sources(
    app_state: &AppState,
    source_files: &[ConfigSourceFile],
) -> Result<(), Report> {
    let rows = source_files
        .iter()
        .map(|source_file| {
            let redacted = redact_toml_keys(
                &source_file.contents,
                &RUNTIME_CONFIGURATION_REDACTION_PATHS,
            )?;
            let encrypted = app_state.encrypt(&redacted)?;

            Ok(runtime_configuration::ActiveModel {
                source_service: Set(ERATO_BACKEND_SOURCE_SERVICE.to_string()),
                source_filename: Set(Some(source_file.source_filename.clone())),
                config: Set(encrypted),
                ..Default::default()
            })
        })
        .collect::<Result<Vec<_>, Report>>()?;

    let transaction = app_state.db.begin().await?;
    transaction
        .execute_unprepared(&format!(
            "SELECT pg_advisory_xact_lock({RUNTIME_CONFIGURATION_ADVISORY_LOCK_KEY})"
        ))
        .await?;

    RuntimeConfiguration::delete_many()
        .filter(runtime_configuration::Column::SourceService.eq(ERATO_BACKEND_SOURCE_SERVICE))
        .exec(&transaction)
        .await?;

    if !rows.is_empty() {
        RuntimeConfiguration::insert_many(rows)
            .exec(&transaction)
            .await?;
    }

    transaction.commit().await?;
    Ok(())
}
