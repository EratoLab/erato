use crate::migrations::SqitchMigrationSource;
use ctor::ctor;
use sqlx::migrate::Migrator;
use sqlx::pool::PoolConnection;
use sqlx::postgres::Postgres;
use sqlx::Pool;
use std::path::PathBuf;
use test_log::test;

mod db;
mod migrations;

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

// This is the main entry point for integration tests
// Add more test modules here as needed
#[test]
fn dummy() {
    // This test exists to make sure the test binary is built
    // Individual tests should go in their respective modules
    assert!(true);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn test_db_connection(pool: Pool<Postgres>) {
    dbg!(&pool.connect_options());
    // Basic test to ensure we can execute a query
    let result = sqlx::query_scalar::<_, i32>("SELECT 1 FROM messages;")
        .fetch_all(&pool)
        .await
        .expect("Failed to execute test query");

    assert_eq!(result, Vec::<i32>::new());
}
