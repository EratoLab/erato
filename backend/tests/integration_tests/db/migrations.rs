//! Database migration tests and utilities.

use futures::future::BoxFuture;
use serde::Deserialize;
use serde::de::StdError;
use sqlx::migrate::{Migration, MigrationSource, MigrationType};
use std::borrow::Cow;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Deserialize)]
struct SqitchSummary {
    migrations: Vec<String>,
}

#[derive(Debug)]
pub struct SqitchMigrationSource {
    summary_path: PathBuf,
}

impl SqitchMigrationSource {
    #[allow(dead_code)]
    pub fn new<P: AsRef<Path>>(summary_path: P) -> Self {
        Self {
            summary_path: summary_path.as_ref().to_path_buf(),
        }
    }
}

impl<'a> MigrationSource<'a> for SqitchMigrationSource {
    fn resolve(
        self,
    ) -> BoxFuture<'a, Result<Vec<Migration>, Box<dyn StdError + std::marker::Send + Sync + 'static>>>
    {
        // Read and parse the summary file
        let summary_content = fs::read_to_string(&self.summary_path)
            .map_err(|e| {
                sqlx::Error::Configuration(format!("Failed to read summary file: {}", e).into())
            })
            .unwrap();

        let summary: SqitchSummary = serde_json::from_str(&summary_content)
            .map_err(|e| {
                sqlx::Error::Configuration(format!("Failed to parse summary file: {}", e).into())
            })
            .unwrap();

        // Get the directory containing the summary file
        let base_dir = self
            .summary_path
            .parent()
            .ok_or_else(|| {
                sqlx::Error::Configuration("Summary file has no parent directory".into())
            })
            .unwrap();

        // Process each migration
        let mut migrations = Vec::new();
        for (idx, migration_path) in summary.migrations.iter().enumerate() {
            let full_path = base_dir.join(migration_path);

            // Extract description from the filename
            let file_name = full_path
                .file_name()
                .and_then(|f| f.to_str())
                .ok_or_else(|| {
                    sqlx::Error::Configuration(
                        format!("Invalid migration filename: {}", migration_path).into(),
                    )
                })
                .unwrap();

            let description = file_name.trim_end_matches(".sql").replace('_', " ");

            // Read the migration content
            let sql = fs::read_to_string(&full_path)
                .map_err(|e| {
                    sqlx::Error::Configuration(
                        format!("Failed to read migration file {}: {}", migration_path, e).into(),
                    )
                })
                .unwrap();

            // Create a checksum of the SQL content
            // let checksum = blake3::hash(sql.as_bytes()).as_bytes().to_vec();

            migrations.push(Migration::new(
                idx as i64,
                Cow::Owned(description),
                MigrationType::Simple,
                Cow::Owned(sql),
                false, // no_tx
            ));
        }

        Box::pin(futures::future::ok(migrations))
    }
}
