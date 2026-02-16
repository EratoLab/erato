pub mod assistant;
pub mod chat;
pub mod file_capability;
pub mod file_upload;
pub mod message;
pub mod message_feedback;
pub mod permissions;
pub mod share_grant;
pub mod user;
pub mod user_preference;

/// Pagination utilities for consistent pagination implementation across models
pub mod pagination {
    use std::convert::TryFrom;

    /// A trait providing common pagination functionality
    pub trait Paginated {
        /// Calculate whether there are more items available based on the current results
        fn has_more(&self, offset: u64, total: u64) -> bool;
    }

    /// Calculate a total count estimate without doing a full COUNT query when possible
    ///
    /// This optimizes by avoiding an expensive COUNT query when we already know
    /// the total or can determine if there are more items.
    ///
    /// Parameters:
    /// - offset: The current offset in the pagination
    /// - limit: The requested limit of items per page
    /// - returned_count: The number of items actually returned in this page
    /// - do_count_query: A function that performs the full COUNT query if needed
    pub async fn calculate_total_count<F, Fut, E>(
        offset: u64,
        limit: u64,
        returned_count: usize,
        do_count_query: F,
    ) -> Result<(u64, bool), E>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<u64, E>>,
    {
        // If we got fewer items than the limit, we know the total count exactly
        if (returned_count as u64) < limit {
            let total = offset + (returned_count as u64);
            return Ok((total, false));
        }

        // Otherwise, we need to do a COUNT query to get the exact total
        let total = do_count_query().await?;
        let has_more = (offset + (returned_count as u64)) < total;

        Ok((total, has_more))
    }

    /// Convert a u64 count to i64 safely, with appropriate logging if truncation occurs
    pub fn u64_to_i64_count(count: u64) -> i64 {
        i64::try_from(count).unwrap_or_else(|_| {
            tracing::warn!("Count value exceeded i64::MAX, capping at max value");
            i64::MAX
        })
    }
}

use eyre::{Result, eyre};
use sea_orm::{ConnectionTrait, DatabaseConnection, Statement};

/// The latest migration change hash from the sqitch deployment
const LATEST_MIGRATION_HASH: &str = include_str!("../../../sqitch/latest_change.txt");

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

/// Test module for pagination utilities
#[cfg(test)]
mod tests {
    use super::pagination;

    #[tokio::test]
    async fn test_calculate_total_count_with_partial_page() {
        // When we get fewer items than the limit, we should know the exact count
        // without doing a COUNT query
        let mut count_query_called = false;

        let (total, has_more) = pagination::calculate_total_count(
            10, // offset
            20, // limit
            15, // returned_count (less than limit)
            || async {
                count_query_called = true;
                Ok::<u64, ()>(100) // This should never be called
            },
        )
        .await
        .unwrap();

        // Should calculate total as offset + returned_count
        assert_eq!(total, 25);
        assert!(!has_more, "Should not have more items");
        assert!(
            !count_query_called,
            "COUNT query should not be called for partial page"
        );
    }

    #[tokio::test]
    async fn test_calculate_total_count_with_full_page() {
        // When we get exactly the limit, we need to do a COUNT query
        let mut count_query_called = false;

        let (total, has_more) = pagination::calculate_total_count(
            10, // offset
            20, // limit
            20, // returned_count (equal to limit)
            || async {
                count_query_called = true;
                Ok::<u64, ()>(50) // Total count from database
            },
        )
        .await
        .unwrap();

        assert_eq!(total, 50);
        assert!(has_more, "Should have more items");
        assert!(
            count_query_called,
            "COUNT query should be called for full page"
        );
    }

    #[tokio::test]
    async fn test_calculate_total_count_with_full_page_no_more() {
        // When we get a full page but there are no more items
        let mut count_query_called = false;

        let (total, has_more) = pagination::calculate_total_count(
            10, // offset
            20, // limit
            20, // returned_count (equal to limit)
            || async {
                count_query_called = true;
                Ok::<u64, ()>(30) // Exactly offset + returned_count
            },
        )
        .await
        .unwrap();

        assert_eq!(total, 30);
        assert!(!has_more, "Should not have more items");
        assert!(
            count_query_called,
            "COUNT query should be called even if no more items"
        );
    }

    #[test]
    fn test_u64_to_i64_count_normal() {
        let result = pagination::u64_to_i64_count(100);
        assert_eq!(result, 100);
    }

    #[test]
    fn test_u64_to_i64_count_max() {
        // Test with a value larger than i64::MAX
        let huge_value = u64::MAX;
        let result = pagination::u64_to_i64_count(huge_value);

        // Should cap at i64::MAX
        assert_eq!(result, i64::MAX);
    }
}
