//! Database migration tests and utilities.

use crate::MIGRATOR;
use erato::models::user::get_or_create_user;
use erato::policy::engine::PolicyEngine;
use erato::policy::types::Subject;
use futures::future::BoxFuture;
use serde::Deserialize;
use serde::de::StdError;
use sqlx::Pool;
use sqlx::migrate::{Migration, MigrationSource, MigrationType};
use sqlx::postgres::Postgres;
use sqlx::{AssertSqlSafe, SqlSafeStr};
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
                AssertSqlSafe(sql).into_sql_str(),
                false, // no_tx
            ));
        }

        Box::pin(futures::future::ok(migrations))
    }
}

/// Data migration: empty assistant id lists are normalized to NULL.
///
/// # Test Categories
/// - `uses-db`
///
/// # Test Behavior
/// The write path collapses empty id lists to `None`, but rows persisted
/// before that change can still hold `{}` — which generation-time filters read
/// as "restrict to nothing". The test migrator has already applied every
/// deploy file (including the normalization) to the empty database, so this
/// test seeds legacy-shaped rows through raw SQL and then replays the actual
/// deploy file against them, proving:
/// 1. Empty arrays read back as unrestricted (`None`) through the model layer
/// 2. Populated and already-NULL id lists are left untouched
#[sqlx::test(migrator = "MIGRATOR")]
async fn test_normalize_empty_assistant_id_lists_migration(pool: Pool<Postgres>) {
    let conn = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool.clone());

    let user = get_or_create_user(&conn, "test-issuer", "assistant-migration-subject", None)
        .await
        .expect("Failed to create user");

    // Raw inserts bypass the model's write-path normalization, reproducing
    // rows persisted before it existed.
    let insert_assistant = "INSERT INTO assistants (owner_user_id, name, prompt, mcp_server_ids, facet_ids) \
         VALUES ($1, $2, 'You are a test assistant.', $3, $4) RETURNING id";
    let legacy_id: sqlx::types::Uuid = sqlx::query_scalar(insert_assistant)
        .bind(user.id)
        .bind("Legacy empty lists")
        .bind(Vec::<String>::new())
        .bind(Vec::<String>::new())
        .fetch_one(&pool)
        .await
        .expect("Failed to insert legacy-shaped assistant");
    let restricted_id: sqlx::types::Uuid = sqlx::query_scalar(insert_assistant)
        .bind(user.id)
        .bind("Restricted")
        .bind(vec!["server1".to_string()])
        .bind(vec!["facet1".to_string()])
        .fetch_one(&pool)
        .await
        .expect("Failed to insert restricted assistant");
    let unrestricted_id: sqlx::types::Uuid = sqlx::query_scalar(insert_assistant)
        .bind(user.id)
        .bind("Unrestricted")
        .bind(Option::<Vec<String>>::None)
        .bind(Option::<Vec<String>>::None)
        .fetch_one(&pool)
        .await
        .expect("Failed to insert unrestricted assistant");

    let policy = PolicyEngine::new();
    let subject = Subject::User(user.id.to_string());

    let legacy = erato::models::assistant::get_assistant_by_id(&conn, &policy, &subject, legacy_id)
        .await
        .expect("Failed to load legacy assistant before normalization");
    assert_eq!(legacy.mcp_server_ids, Some(Vec::new()));
    assert_eq!(legacy.facet_ids, Some(Vec::new()));

    let migration_sql = fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../sqitch/deploy/0037_normalize_empty_assistant_id_lists.sql"
    ))
    .expect("Failed to read normalization migration");
    sqlx::raw_sql(AssertSqlSafe(migration_sql))
        .execute(&pool)
        .await
        .expect("Failed to replay normalization migration");

    let legacy = erato::models::assistant::get_assistant_by_id(&conn, &policy, &subject, legacy_id)
        .await
        .expect("Failed to load legacy assistant");
    assert_eq!(legacy.mcp_server_ids, None);
    assert_eq!(legacy.facet_ids, None);

    let restricted =
        erato::models::assistant::get_assistant_by_id(&conn, &policy, &subject, restricted_id)
            .await
            .expect("Failed to load restricted assistant");
    assert_eq!(restricted.mcp_server_ids, Some(vec!["server1".to_string()]));
    assert_eq!(restricted.facet_ids, Some(vec!["facet1".to_string()]));

    let unrestricted =
        erato::models::assistant::get_assistant_by_id(&conn, &policy, &subject, unrestricted_id)
            .await
            .expect("Failed to load unrestricted assistant");
    assert_eq!(unrestricted.mcp_server_ids, None);
    assert_eq!(unrestricted.facet_ids, None);
}
