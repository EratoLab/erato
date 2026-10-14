//! In attribution mode we own the exporter jobs: the library's HTTP listener
//! and histogram-upkeep tasks otherwise spawn outside component scopes.

use super::components::{self, Component};
use axum::{Router, http::StatusCode, routing::any};
use metrics_exporter_prometheus::PrometheusHandle;

fn router(handle: PrometheusHandle) -> Router {
    Router::new()
        .route(
            "/health",
            any(|| async { ([("content-type", "text/plain")], "OK") }),
        )
        .fallback(any(move || {
            let handle = handle.clone();
            async move {
                tokio::task::spawn_blocking(components::blocking(
                    Component::MetricsExporter,
                    move || handle.render(),
                ))
                .await
                .map(|body| ([("content-type", "text/plain")], body))
                .map_err(|error| {
                    tracing::warn!(%error, "Prometheus scrape rendering failed");
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Metrics rendering failed",
                    )
                })
            }
        }))
}

#[cfg(all(feature = "profiling", target_os = "linux"))]
pub(super) fn install(address: std::net::SocketAddr) -> eyre::Result<()> {
    use metrics_exporter_prometheus::PrometheusBuilder;

    // Bind before installing the global recorder so address failures remain a
    // synchronous startup error, as with PrometheusBuilder::install().
    let listener = std::net::TcpListener::bind(address)?;
    listener.set_nonblocking(true)?;
    let listener = tokio::net::TcpListener::from_std(listener)?;
    let recorder = PrometheusBuilder::new().build_recorder();
    let handle = recorder.handle();
    metrics::set_global_recorder(recorder).map_err(|error| eyre::eyre!(error.to_string()))?;
    components::init(true)?;

    let upkeep = handle.clone();
    tokio::spawn(async move {
        loop {
            // Same upkeep cadence as metrics-exporter-prometheus's builder.
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            let handle = upkeep.clone();
            if let Err(error) = tokio::task::spawn_blocking(components::blocking(
                Component::MetricsExporter,
                move || handle.run_upkeep(),
            ))
            .await
            {
                tracing::warn!(%error, "Prometheus histogram upkeep failed");
            }
        }
    });
    let app = router(handle);
    tokio::spawn(async move {
        if let Err(error) = axum::serve(listener, app).await {
            tracing::error!(%error, "Prometheus metrics listener failed");
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use metrics_exporter_prometheus::PrometheusBuilder;

    #[tokio::test]
    async fn attributed_exporter_preserves_health_scrapes_and_content_type() {
        let recorder = PrometheusBuilder::new().build_recorder();
        metrics::with_local_recorder(&recorder, || {
            metrics::counter!("example_total").increment(7);
            metrics::histogram!("example_duration").record(0.25);
        });
        let server = axum_test::TestServer::new(router(recorder.handle())).unwrap();
        let health = server.get("/health").await;
        health.assert_status_ok();
        health.assert_text("OK");
        health.assert_header("content-type", "text/plain");
        for path in ["/metrics", "/"] {
            let response = server.get(path).await;
            response.assert_status_ok();
            response.assert_header("content-type", "text/plain");
            assert!(response.text().contains("example_total 7"));
            assert!(response.text().contains("example_duration_count 1"));
        }
    }
}
