//! User database tests.

use crate::MIGRATOR;
use erato::models::user::get_or_create_user;
use sqlx::postgres::Postgres;
use sqlx::Pool;

/// Test creating and retrieving a user without an email address.
///
/// # Test Categories
/// - `uses-db`
///
/// # Test Behavior
/// Verifies that:
/// 1. A user can be created without an email
/// 2. Subsequent calls with the same issuer/subject return the same user
/// 3. User data is persisted correctly
#[sqlx::test(migrator = "MIGRATOR")]
async fn test_user_without_email(pool: Pool<Postgres>) {
    // Convert the sqlx pool to a sea-orm DatabaseConnection
    let conn = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool);

    // Test data
    let issuer = "test-issuer";
    let subject = "test-subject";

    // First call - create a user without an email
    let user1 = get_or_create_user(&conn, issuer, subject, None)
        .await
        .expect("Failed to create user without email");

    // Verify the user was created with the correct data
    assert_eq!(user1.issuer, issuer);
    assert_eq!(user1.subject, subject);
    assert_eq!(user1.email, None);

    // Second call - should return the same user
    let user2 = get_or_create_user(&conn, issuer, subject, None)
        .await
        .expect("Failed to get existing user");

    // Verify the user has the same ID (i.e., it's the same user)
    assert_eq!(user1.id, user2.id);
    assert_eq!(user2.issuer, issuer);
    assert_eq!(user2.subject, subject);
    assert_eq!(user2.email, None);
}

/// Basic database connection test.
///
/// # Test Categories
/// - `uses-db`
///
/// # Test Behavior
/// Verifies that we can successfully execute queries against the test database.
#[sqlx::test(migrator = "MIGRATOR")]
async fn test_db_connection(pool: Pool<Postgres>) {
    // Basic test to ensure we can execute a query
    let result = sqlx::query_scalar::<_, i32>("SELECT 1 FROM messages;")
        .fetch_all(&pool)
        .await
        .expect("Failed to execute test query");

    assert_eq!(result, Vec::<i32>::new());
}
