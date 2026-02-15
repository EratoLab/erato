use std::net::SocketAddr;

use eyre::{Result, WrapErr, eyre};
use metrics::gauge;
use metrics_exporter_prometheus::PrometheusBuilder;
use tokio_metrics::RuntimeMetricsReporterBuilder;

use crate::config::AppConfig;

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

    tokio::spawn(RuntimeMetricsReporterBuilder::default().describe_and_run());

    println!(
        "Prometheus metrics exporter enabled at http://{}/metrics",
        listen_address
    );

    Ok(())
}
