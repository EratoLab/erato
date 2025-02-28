pub mod chat;
pub mod message;
pub mod user;

use eyre::{eyre, Result};
use sea_orm::{ConnectionTrait, DatabaseConnection, Statement};

/// The latest migration change hash from the sqitch deployment
const LATEST_MIGRATION_HASH: &str = include_str!("../../sqitch/latest_change.txt");

/// Verifies that the database has been migrated to the latest change.
///
/// This function checks if the latest migration hash from `latest_change.txt`
/// exists in the database's `changes` table.
pub async fn verify_latest_migration(conn: &DatabaseConnection) -> Result<bool> {
    // Use the latest change hash from the constant
    let latest_change = LATEST_MIGRATION_HASH.trim();

    // Query the changes table to check if the latest change exists
    let stmt = Statement::from_string(
        conn.get_database_backend(),
        format!(
            "SELECT EXISTS(SELECT 1 FROM changes WHERE change_id = '{}') as exists",
            latest_change
        ),
    );

    let row = conn.query_one(stmt).await?;
    let exists = row
        .and_then(|r| r.try_get::<bool>("", "exists").ok())
        .unwrap_or(false);

    // Return whether the change exists
    Ok(exists)
}

/// Ensures that the database has been migrated to the latest change.
///
/// This function verifies the migration status and returns an error if the database
/// is not up-to-date.
pub async fn ensure_latest_migration(conn: &DatabaseConnection) -> Result<()> {
    if !verify_latest_migration(conn).await? {
        return Err(eyre!(
            "Database is not migrated to the latest version. Please run migrations."
        ));
    }

    Ok(())
}
