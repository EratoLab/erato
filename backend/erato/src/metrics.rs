use std::hash::Hash;
use std::net::SocketAddr;
use std::time::Duration;

use eyre::{Result, WrapErr, eyre};
use metrics::{Unit, describe_gauge, gauge};
use metrics_exporter_prometheus::PrometheusBuilder;
use moka::future::Cache;
use tokio_metrics::RuntimeMetricsReporterBuilder;

use crate::config::AppConfig;
use crate::state::AppState;

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
    describe_cache_metrics();

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
    gauge!("erato_cache_entry_count", "cache" => cache_name.to_string())
        .set(metrics.entry_count as f64);
    gauge!("erato_cache_time_to_live_seconds", "cache" => cache_name.to_string())
        .set(metrics.time_to_live_seconds);
    gauge!("erato_cache_time_to_idle_seconds", "cache" => cache_name.to_string())
        .set(metrics.time_to_idle_seconds);

    let fill_ratio_percent = if metrics.max == 0 {
        0.0
    } else {
        (metrics.used as f64 / metrics.max as f64) * 100.0
    };
    gauge!("erato_cache_fill_ratio", "cache" => cache_name.to_string()).set(fill_ratio_percent);
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

fn describe_cache_metrics() {
    describe_gauge!(
        "erato_chat_provider_info",
        Unit::Count,
        "Info metric for configured chat providers. Always 1; labels carry provider metadata."
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
        Unit::Percent,
        "Current AppState cache utilization as a percentage of max capacity."
    );
    describe_gauge!(
        "erato_cache_entry_count",
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
