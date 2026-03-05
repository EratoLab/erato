use axum::Extension;
use axum::handler::HandlerWithoutStateExt;
use axum_tracing_opentelemetry::middleware::{OtelAxumLayer, OtelInResponseLayer};
use eyre::{Report, WrapErr};
use utoipa_scalar::{Scalar, Servable as ScalarServable};

use erato::config::AppConfig;
use erato::frontend_environment::{
    DeploymentVersion, FrontendBundlePath, build_frontend_environment, serve_files_with_script,
};
use erato::models;
use erato::services::sentry::{extend_with_sentry_layers, setup_sentry};
use erato::state::AppState;
use erato::{ApiDoc, server};
use tower_http::cors::CorsLayer;

#[cfg(all(feature = "profiling", target_os = "linux"))]
#[global_allocator]
static GLOBAL: tikv_jemallocator::Jemalloc = tikv_jemallocator::Jemalloc;

#[cfg(all(feature = "profiling", target_os = "linux"))]
#[unsafe(export_name = "malloc_conf")]
pub static MALLOC_CONF: &[u8] = b"prof:true,prof_active:true,lg_prof_sample:19\0";

const ENV_WORKER_THREADS: &str = "TOKIO_WORKER_THREADS";
const MIN_TOKIO_WORKER_THREADS: usize = 4;

/// Similar to the normal worker thread detection mechanism, but adds a minimum value to the auto-detection,
/// as we've seen problems with 1 worker thread, and that value will likely often be inferred
/// when running containerized in Kubernetes with small resource sizing.
///
/// The value can still be overridden explicitly via `TOKIO_WORKER_THREADS` if required.
fn configured_tokio_worker_threads() -> usize {
    use std::num::NonZeroUsize;

    match std::env::var(ENV_WORKER_THREADS) {
        Ok(s) => {
            let n = s.parse().unwrap_or_else(|e| {
                panic!("\"{ENV_WORKER_THREADS}\" must be usize, error: {e}, value: {s}")
            });
            assert!(n > 0, "\"{ENV_WORKER_THREADS}\" cannot be set to 0");
            if n < MIN_TOKIO_WORKER_THREADS {
                eprintln!(
                    "Warning: \"{ENV_WORKER_THREADS}\" is set to {n}, which is below the recommended minimum of {MIN_TOKIO_WORKER_THREADS} worker threads."
                );
            }
            n
        }
        Err(std::env::VarError::NotPresent) => std::thread::available_parallelism()
            .map_or(1, NonZeroUsize::get)
            .max(MIN_TOKIO_WORKER_THREADS),
        Err(std::env::VarError::NotUnicode(e)) => {
            panic!("\"{ENV_WORKER_THREADS}\" must be valid unicode, error: {e:?}")
        }
    }
}

fn main() -> Result<(), Report> {
    let worker_threads = configured_tokio_worker_threads();
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(worker_threads)
        .enable_all()
        .build()
        .wrap_err("Failed to build Tokio runtime")?;

    runtime.block_on(async_main(worker_threads))
}

async fn async_main(worker_threads: usize) -> Result<(), Report> {
    color_eyre::install()?;
    let loaded_dotenv_files = dotenv_flow::dotenv_flow().ok();
    if let Some(loaded_dotenv_files) = loaded_dotenv_files {
        for file in loaded_dotenv_files {
            println!("Loaded dotenv file: {:?}", file);
        }
    }

    let config = AppConfig::new_for_app(None)?;

    // initialize tracing
    let _telemetry_guard = erato::telemetry::init_telemetry(&config)?;
    erato::metrics::init_prometheus_metrics(&config)?;

    let mut _sentry_guard = None;
    setup_sentry(
        config.get_sentry_dsn(),
        config.environment.clone(),
        &mut _sentry_guard,
    );

    let state = AppState::new(config.clone()).await?;
    erato::metrics::start_cache_size_metrics_reporter(state.clone());

    // Verify that the database has been migrated to the latest version
    models::ensure_latest_migration(&state.db).await?;

    let (router, _api) = server::router::router(state.clone()).split_for_parts();

    let listener =
        tokio::net::TcpListener::bind(format!("{}:{}", config.http_host, config.http_port)).await?;
    let local_addr = listener.local_addr()?;

    // Create OpenAPI spec with server information
    let mut spec = ApiDoc::build_openapi_full();
    spec.servers = Some(vec![utoipa::openapi::Server::new(format!(
        "http://{}",
        local_addr
    ))]);

    let app = extend_with_sentry_layers(router)
        .merge(Scalar::with_url("/scalar", spec.clone()))
        .route(
            "/openapi.json",
            axum::routing::get(move || async move { axum::Json(spec.clone()) }),
        )
        .fallback_service(serve_files_with_script.into_service())
        .layer(Extension(FrontendBundlePath(
            config.frontend_bundle_path.clone(),
        )))
        .layer(Extension(DeploymentVersion::from_env()))
        .layer(Extension(build_frontend_environment(&config)))
        .layer(CorsLayer::very_permissive());

    let app = if config.integrations.otel.enabled {
        app
            // include trace context as header into the response
            .layer(OtelInResponseLayer)
            // start OpenTelemetry trace on incoming request
            .layer(OtelAxumLayer::default())
    } else {
        app
    }
    .with_state(state);

    println!();
    println!("Tokio worker threads: {}", worker_threads);
    println!("API docs: http://{}/scalar", local_addr);
    println!("Frontend at: http://{}", local_addr);
    println!("Listening on {}", local_addr);
    axum::serve(listener, app.into_make_service()).await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn configured_tokio_worker_threads_has_minimum() {
        // SAFETY: test-scoped env mutation; these tests do not rely on parallel env access.
        unsafe {
            std::env::remove_var(ENV_WORKER_THREADS);
        }
        let workers = configured_tokio_worker_threads();
        assert!(workers >= MIN_TOKIO_WORKER_THREADS);
    }

    #[test]
    fn configured_tokio_worker_threads_respects_larger_env_value() {
        // SAFETY: test-scoped env mutation; these tests do not rely on parallel env access.
        unsafe {
            std::env::set_var(ENV_WORKER_THREADS, "12");
        }
        let workers = configured_tokio_worker_threads();
        assert_eq!(workers, 12);

        // SAFETY: test-scoped env cleanup.
        unsafe {
            std::env::remove_var(ENV_WORKER_THREADS);
        }
    }

    #[test]
    fn configured_tokio_worker_threads_enforces_minimum_for_small_env_value() {
        // SAFETY: test-scoped env mutation; these tests do not rely on parallel env access.
        unsafe {
            std::env::set_var(ENV_WORKER_THREADS, "2");
        }
        let workers = configured_tokio_worker_threads();
        assert_eq!(workers, 2);

        // SAFETY: test-scoped env cleanup.
        unsafe {
            std::env::remove_var(ENV_WORKER_THREADS);
        }
    }
}
