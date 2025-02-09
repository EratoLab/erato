// use sqlx::{PgPool, Postgres};
// use test_log::test;
//
// pub async fn setup_test_db() -> PgPool {
//     let database_url = std::env::var("DATABASE_URL")
//         .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:5432/erato_test".to_string());
//
//     PgPool::connect(&database_url)
//         .await
//         .expect("Failed to create database connection pool")
// }
//
//
// #[test]
// fn test_setup_db() {
//     let rt = tokio::runtime::Runtime::new().unwrap();
//     rt.block_on(async {
//         let pool = setup_test_db().await;
//         assert!(pool.acquire().await.is_ok());
//     });
// }
