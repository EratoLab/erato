use std::hash::Hash;
use std::net::SocketAddr;
use std::time::Duration;

use eyre::{Result, WrapErr, eyre};
use metrics::{
    Unit, counter, describe_counter, describe_gauge, describe_histogram, gauge, histogram,
};
use metrics_exporter_prometheus::PrometheusBuilder;
use moka::future::Cache;
use tokio_metrics::RuntimeMetricsReporterBuilder;

use crate::config::AppConfig;
use crate::models::message::GenerationErrorType;
use crate::state::AppState;

const MCP_ACTIVE_SESSIONS_METRIC: &str = "erato_mcp_active_sessions";
const CHAT_PROVIDER_TIME_TO_FIRST_TOKEN_METRIC: &str =
    "erato_chat_provider_time_to_first_token_seconds";
const CHAT_PROVIDER_TIME_TO_LAST_TOKEN_METRIC: &str =
    "erato_chat_provider_time_to_last_token_seconds";
const CHAT_PROVIDER_GENERATION_ERRORS_METRIC: &str = "erato_chat_provider_generation_errors_total";

pub fn init_prometheus_metrics(config: &AppConfig) -> Result<()> {
    if !config.integrations.prometheus.enabled {
        return Ok(());
    }

    let port = u16::try_from(config.integrations.prometheus.port).map_err(|_| {
        eyre!(
            "Invalid integrations.prometheus.port: {}",
            config.integrations.prometheus.port
        )
    })?;
    let listen_address: SocketAddr = format!("{}:{}", config.integrations.prometheus.host, port)
        .parse()
        .wrap_err_with(|| {
            format!(
                "Invalid Prometheus listener address '{}:{}'",
                config.integrations.prometheus.host, port
            )
        })?;

    PrometheusBuilder::new()
        .with_http_listener(listen_address)
        .install()
        .wrap_err_with(|| {
            format!(
                "Failed to install Prometheus metrics exporter on {}",
                listen_address
            )
        })?;

    let deployment_version =
        std::env::var("ERATO_DEPLOYMENT_VERSION").unwrap_or_else(|_| "unknown".to_string());

    gauge!(
        "erato_info",
        "version" => env!("CARGO_PKG_VERSION").to_string(),
        "environment" => config.environment.clone(),
        "service" => "erato-backend",
        "deployment_version" => deployment_version
    )
    .set(1.0);

    report_chat_provider_info_metrics(config);
    report_mcp_active_session_metrics(config);
    describe_application_metrics();

    tokio::spawn(RuntimeMetricsReporterBuilder::default().describe_and_run());

    println!(
        "Prometheus metrics exporter enabled at http://{}/metrics",
        listen_address
    );

    Ok(())
}

pub fn start_cache_size_metrics_reporter(app_state: AppState) {
    if !app_state.config.integrations.prometheus.enabled {
        return;
    }

    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(30));

        loop {
            interval.tick().await;
            report_cache_size_metrics_once(&app_state).await;
        }
    });
}

async fn report_cache_size_metrics_once(app_state: &AppState) {
    let file_bytes_metrics = cache_metrics(&app_state.file_bytes_cache).await;
    report_cache_metrics("file_bytes_cache", file_bytes_metrics);

    let file_contents_metrics = cache_metrics(&app_state.file_contents_cache).await;
    report_cache_metrics("file_contents_cache", file_contents_metrics);

    let token_count_metrics = cache_metrics(&app_state.token_count_cache).await;
    report_cache_metrics("token_count_cache", token_count_metrics);
}

struct CacheMetrics {
    used: u64,
    max: u64,
    entry_count: u64,
    time_to_live_seconds: f64,
    time_to_idle_seconds: f64,
}

async fn cache_metrics<K, V>(cache: &Cache<K, V>) -> CacheMetrics
where
    K: Hash + Eq + Send + Sync + 'static,
    V: Clone + Send + Sync + 'static,
{
    cache.run_pending_tasks().await;
    let policy = cache.policy();

    CacheMetrics {
        used: cache.weighted_size(),
        max: policy.max_capacity().unwrap_or(0),
        entry_count: cache.entry_count(),
        time_to_live_seconds: policy
            .time_to_live()
            .map(|duration| duration.as_secs_f64())
            .unwrap_or(0.0),
        time_to_idle_seconds: policy
            .time_to_idle()
            .map(|duration| duration.as_secs_f64())
            .unwrap_or(0.0),
    }
}

fn report_cache_metrics(cache_name: &str, metrics: CacheMetrics) {
    gauge!("erato_cache_max_size_bytes", "cache" => cache_name.to_string()).set(metrics.max as f64);
    gauge!("erato_cache_used_size_bytes", "cache" => cache_name.to_string())
        .set(metrics.used as f64);
    gauge!("erato_cache_entries", "cache" => cache_name.to_string())
        .set(metrics.entry_count as f64);
    gauge!("erato_cache_time_to_live_seconds", "cache" => cache_name.to_string())
        .set(metrics.time_to_live_seconds);
    gauge!("erato_cache_time_to_idle_seconds", "cache" => cache_name.to_string())
        .set(metrics.time_to_idle_seconds);

    gauge!("erato_cache_fill_ratio", "cache" => cache_name.to_string())
        .set(calculate_fill_ratio(metrics.used, metrics.max));
}

fn calculate_fill_ratio(used: u64, max: u64) -> f64 {
    if max == 0 {
        0.0
    } else {
        used as f64 / max as f64
    }
}

fn report_chat_provider_info_metrics(config: &AppConfig) {
    let Some(chat_providers) = config.chat_providers.as_ref() else {
        return;
    };

    let mut provider_ids: Vec<&String> = chat_providers.providers.keys().collect();
    provider_ids.sort();

    for chat_provider_id in provider_ids {
        if let Some(provider) = chat_providers.providers.get(chat_provider_id) {
            gauge!(
                "erato_chat_provider_info",
                "chat_provider_id" => chat_provider_id.clone(),
                "provider_kind" => provider.provider_kind.clone(),
                "model_name" => provider.model_name.clone()
            )
            .set(1.0);
        }
    }
}

fn report_mcp_active_session_metrics(config: &AppConfig) {
    let mut server_ids: Vec<&String> = config.mcp_servers.keys().collect();
    server_ids.sort();

    for server_id in server_ids {
        report_mcp_active_sessions_for_server(server_id, 0);
    }
}

pub fn report_mcp_active_sessions_for_server(server_id: &str, count: usize) {
    gauge!(MCP_ACTIVE_SESSIONS_METRIC, "server_id" => server_id.to_string()).set(count as f64);
}

pub fn report_chat_provider_time_to_first_token(chat_provider_id: &str, duration: Duration) {
    histogram!(
        CHAT_PROVIDER_TIME_TO_FIRST_TOKEN_METRIC,
        "chat_provider_id" => chat_provider_id.to_string()
    )
    .record(duration_seconds_with_millisecond_precision(duration));
}

pub fn report_chat_provider_time_to_last_token(chat_provider_id: &str, duration: Duration) {
    histogram!(
        CHAT_PROVIDER_TIME_TO_LAST_TOKEN_METRIC,
        "chat_provider_id" => chat_provider_id.to_string()
    )
    .record(duration_seconds_with_millisecond_precision(duration));
}

pub fn report_chat_provider_generation_error(chat_provider_id: &str, error: &GenerationErrorType) {
    counter!(
        CHAT_PROVIDER_GENERATION_ERRORS_METRIC,
        "chat_provider_id" => chat_provider_id.to_string(),
        "error_type" => generation_error_type_label(error).to_string()
    )
    .increment(1);
}

fn generation_error_type_label(error: &GenerationErrorType) -> &'static str {
    match error {
        GenerationErrorType::ContentFilter { .. } => "content_filter",
        GenerationErrorType::RateLimit { .. } => "rate_limit",
        GenerationErrorType::ModelUnavailable { .. } => "model_unavailable",
        GenerationErrorType::InvalidRequest { .. } => "invalid_request",
        GenerationErrorType::ProviderError { .. } => "provider_error",
        GenerationErrorType::InternalError { .. } => "internal_error",
    }
}

fn duration_seconds_with_millisecond_precision(duration: Duration) -> f64 {
    duration.as_millis() as f64 / 1_000.0
}

fn describe_application_metrics() {
    describe_gauge!(
        "erato_chat_provider_info",
        Unit::Count,
        "Info metric for configured chat providers. Always 1; labels carry provider metadata."
    );
    describe_histogram!(
        CHAT_PROVIDER_TIME_TO_FIRST_TOKEN_METRIC,
        Unit::Seconds,
        "Time from dispatching a chat-provider generation request until the first streamed token, recorded with millisecond precision."
    );
    describe_histogram!(
        CHAT_PROVIDER_TIME_TO_LAST_TOKEN_METRIC,
        Unit::Seconds,
        "Time from dispatching a chat-provider generation request until the last streamed token, recorded with millisecond precision."
    );
    describe_counter!(
        CHAT_PROVIDER_GENERATION_ERRORS_METRIC,
        Unit::Count,
        "Total number of chat-provider generation failures segmented by provider and normalized error type."
    );
    describe_gauge!(
        MCP_ACTIVE_SESSIONS_METRIC,
        Unit::Count,
        "Current number of active MCP sessions for each configured MCP server."
    );
    describe_gauge!(
        "erato_cache_max_size_bytes",
        Unit::Bytes,
        "Maximum configured capacity of each AppState cache in bytes."
    );
    describe_gauge!(
        "erato_cache_used_size_bytes",
        Unit::Bytes,
        "Current weighted usage of each AppState cache in bytes."
    );
    describe_gauge!(
        "erato_cache_fill_ratio",
        Unit::Count,
        "Current AppState cache utilization ratio in the range 0..1."
    );
    describe_gauge!(
        "erato_cache_entries",
        Unit::Count,
        "Current number of entries in each AppState cache."
    );
    describe_gauge!(
        "erato_cache_time_to_live_seconds",
        Unit::Seconds,
        "Configured time-to-live for each AppState cache policy in seconds (0 means disabled)."
    );
    describe_gauge!(
        "erato_cache_time_to_idle_seconds",
        Unit::Seconds,
        "Configured time-to-idle for each AppState cache policy in seconds (0 means disabled)."
    );
}

#[cfg(test)]
mod tests {
    use super::{
        calculate_fill_ratio, duration_seconds_with_millisecond_precision,
        generation_error_type_label,
    };
    use crate::models::message::GenerationErrorType;
    use std::time::Duration;

    #[test]
    fn calculate_fill_ratio_returns_zero_when_max_is_zero() {
        assert_eq!(calculate_fill_ratio(50, 0), 0.0);
    }

    #[test]
    fn calculate_fill_ratio_returns_unit_interval_ratio() {
        assert_eq!(calculate_fill_ratio(25, 100), 0.25);
    }

    #[test]
    fn generation_error_type_label_matches_serialized_names() {
        assert_eq!(
            generation_error_type_label(&GenerationErrorType::ContentFilter {
                error_description: "x".to_string(),
                filter_details: None,
            }),
            "content_filter"
        );
        assert_eq!(
            generation_error_type_label(&GenerationErrorType::RateLimit {
                error_description: "x".to_string(),
            }),
            "rate_limit"
        );
        assert_eq!(
            generation_error_type_label(&GenerationErrorType::ModelUnavailable {
                error_description: "x".to_string(),
            }),
            "model_unavailable"
        );
        assert_eq!(
            generation_error_type_label(&GenerationErrorType::InvalidRequest {
                error_description: "x".to_string(),
            }),
            "invalid_request"
        );
        assert_eq!(
            generation_error_type_label(&GenerationErrorType::ProviderError {
                error_description: "x".to_string(),
                status_code: None,
            }),
            "provider_error"
        );
        assert_eq!(
            generation_error_type_label(&GenerationErrorType::InternalError {
                error_description: "x".to_string(),
            }),
            "internal_error"
        );
    }

    #[test]
    fn duration_seconds_with_millisecond_precision_truncates_sub_millisecond_precision() {
        assert_eq!(
            duration_seconds_with_millisecond_precision(Duration::from_micros(1_999)),
            0.001
        );
        assert_eq!(
            duration_seconds_with_millisecond_precision(Duration::from_micros(2_000)),
            0.002
        );
    }
}
