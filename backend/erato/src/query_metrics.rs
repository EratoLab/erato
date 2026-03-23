use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

use metrics::histogram;
use sea_orm::{DatabaseConnection, DatabaseConnection::SqlxPostgresPoolConnection, Value, metric};
use sha2::{Digest, Sha256};

use crate::metrics::duration_seconds_with_millisecond_precision;
use crate::metrics_constants::KNOWN_POSTGRES_QUERY_IDS;

pub const POSTGRES_QUERY_DURATION_METRIC: &str = "erato_postgres_query_duration_seconds";

static QUERY_ID_REGISTRY: OnceLock<RwLock<HashMap<String, &'static str>>> = OnceLock::new();

pub fn init_known_postgres_query_metrics() {
    for query_id in KNOWN_POSTGRES_QUERY_IDS {
        let _ = histogram!(
            POSTGRES_QUERY_DURATION_METRIC,
            "query_id" => (*query_id).to_string(),
            "status" => "success"
        );
        let _ = histogram!(
            POSTGRES_QUERY_DURATION_METRIC,
            "query_id" => (*query_id).to_string(),
            "status" => "error"
        );
    }
}

pub fn install_postgres_query_metrics(db: &mut DatabaseConnection) {
    if !matches!(db, SqlxPostgresPoolConnection(_)) {
        return;
    }

    db.set_metric_callback(report_postgres_query_metric);
}

pub fn named_statement_from_sql_and_values<I, T>(
    db_backend: sea_orm::DbBackend,
    query_id: &'static str,
    sql: T,
    values: I,
) -> sea_orm::Statement
where
    I: IntoIterator<Item = Value>,
    T: Into<String>,
{
    let sql = sql.into();
    register_named_query(query_id, &sql);
    sea_orm::Statement::from_sql_and_values(db_backend, sql, values)
}

pub fn named_statement_from_string<T>(
    db_backend: sea_orm::DbBackend,
    query_id: &'static str,
    sql: T,
) -> sea_orm::Statement
where
    T: Into<String>,
{
    let sql = sql.into();
    register_named_query(query_id, &sql);
    sea_orm::Statement::from_string(db_backend, sql)
}

fn register_named_query(query_id: &'static str, sql: &str) {
    let normalized_sql = normalize_sql(sql);
    let registry = QUERY_ID_REGISTRY.get_or_init(|| RwLock::new(HashMap::new()));
    registry
        .write()
        .expect("query ID registry lock poisoned")
        .insert(normalized_sql, query_id);
}

fn report_postgres_query_metric(info: &metric::Info<'_>) {
    let query_id = query_id_for_statement(info.statement);
    let status = if info.failed { "error" } else { "success" };

    tracing::trace!(
        query_id = query_id,
        status = status,
        elapsed_secs = info.elapsed.as_secs_f64(),
        sql = info.statement.sql,
        "recorded postgres query metric"
    );

    histogram!(
        POSTGRES_QUERY_DURATION_METRIC,
        "query_id" => query_id,
        "status" => status
    )
    .record(duration_seconds_with_millisecond_precision(info.elapsed));
}

fn query_id_for_statement(statement: &sea_orm::Statement) -> String {
    let normalized_sql = normalize_sql(&statement.sql);

    if let Some(query_id) = QUERY_ID_REGISTRY.get().and_then(|registry| {
        registry
            .read()
            .expect("query ID registry lock poisoned")
            .get(&normalized_sql)
            .copied()
    }) {
        return query_id.to_string();
    }

    format!("hash-{}", short_query_hash(&normalized_sql))
}

fn normalize_sql(sql: &str) -> String {
    sql.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

fn short_query_hash(sql: &str) -> String {
    let digest = Sha256::digest(sql.as_bytes());
    digest[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{normalize_sql, query_id_for_statement, register_named_query, short_query_hash};

    #[test]
    fn normalize_sql_collapses_whitespace_and_case() {
        assert_eq!(
            normalize_sql(" SELECT  *\nFROM chats\tWHERE id = $1 "),
            "select * from chats where id = $1"
        );
    }

    #[test]
    fn known_query_ids_are_resolved_from_registered_sql() {
        let sql = "SELECT 1 FROM chats WHERE id = $1";
        register_named_query("test_query", sql);

        let statement = sea_orm::Statement::from_string(
            sea_orm::DbBackend::Postgres,
            "  select 1 from chats\nwhere id = $1  ",
        );

        assert_eq!(query_id_for_statement(&statement), "test_query");
    }

    #[test]
    fn unknown_queries_fall_back_to_hash_ids() {
        let statement = sea_orm::Statement::from_string(
            sea_orm::DbBackend::Postgres,
            "SELECT 1 FROM messages WHERE id = $1",
        );

        assert_eq!(
            query_id_for_statement(&statement),
            format!(
                "hash-{}",
                short_query_hash("select 1 from messages where id = $1")
            )
        );
    }
}
