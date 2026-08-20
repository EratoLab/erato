use axum::Extension;
use axum::handler::HandlerWithoutStateExt;
use axum_tracing_opentelemetry::middleware::{OtelAxumLayer, OtelInResponseLayer};
use eyre::{Report, WrapErr};
use utoipa_scalar::{Scalar, Servable as ScalarServable};

use erato::config::AppConfig;
use erato::deployment_identity::DeploymentIdentity;
use erato::distribution::runtime::ReloadableAppState;
use erato::frontend_environment::{
    DeploymentVersion, build_frontend_registry, serve_files_with_script,
};
use erato::models;
use erato::services::configuration_reload_listener::ConfigurationReloadListener;
use erato::services::sentry::{extend_with_sentry_layers, setup_sentry};
use erato::startup_log;
use erato::state::AppState;
use erato::{ApiDoc, server};
use std::time::Duration;
use tower_http::cors::CorsLayer;
use tower_http::set_header::SetResponseHeaderLayer;

#[cfg(all(feature = "profiling", target_os = "linux"))]
#[global_allocator]
static GLOBAL: tikv_jemallocator::Jemalloc = tikv_jemallocator::Jemalloc;

#[cfg(all(feature = "profiling", target_os = "linux"))]
#[unsafe(export_name = "malloc_conf")]
pub static MALLOC_CONF: &[u8] = b"prof:true,prof_active:true,lg_prof_sample:19\0";

const ENV_WORKER_THREADS: &str = "TOKIO_WORKER_THREADS";
const MIN_TOKIO_WORKER_THREADS: usize = 4;

/// Worker stack size. Tokio's 2 MiB default is not enough for the message
/// streaming handler's very large futures in unoptimized builds: polling them
/// overflows the worker stack the moment a message is submitted (observed once
/// the client-tool offering path became active on every turn). The reservation
/// is virtual — pages are only committed as touched — so a generous value
/// costs nothing in practice.
const TOKIO_WORKER_STACK_BYTES: usize = 16 * 1024 * 1024;

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
                startup_log::warn_preinit(format!(
                    "Warning: \"{ENV_WORKER_THREADS}\" is set to {n}, which is below the recommended minimum of {MIN_TOKIO_WORKER_THREADS} worker threads."
                ));
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

/// Resolves on the first shutdown request: SIGTERM (how Kubernetes asks a pod
/// to stop) or Ctrl-C.
async fn shutdown_signal() {
    #[cfg(unix)]
    {
        let mut sigterm = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler");
        tokio::select! {
            _ = sigterm.recv() => {}
            _ = tokio::signal::ctrl_c() => {}
        }
    }
    #[cfg(not(unix))]
    {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl-C handler");
    }
}

fn main() -> Result<(), Report> {
    let worker_threads = configured_tokio_worker_threads();
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(worker_threads)
        .thread_stack_size(TOKIO_WORKER_STACK_BYTES)
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
            startup_log::info_preinit(format!("Loaded dotenv file: {:?}", file));
        }
    }

    let loaded_config = AppConfig::new_for_app_with_sources(None)?;
    let config = loaded_config.config;

    // initialize tracing
    let _telemetry_guard = erato::telemetry::init_telemetry(&config)?;
    startup_log::reemit_buffered_logs_if_json(&config.logging);
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

    if config.runtime_configuration.enabled {
        models::runtime_configuration::mirror_erato_backend_sources_with_translation_pos(
            &state,
            &loaded_config.source_files,
            state.distribution.translations.sources(),
        )
        .await?;

        *state.reloadable.write().await = ReloadableAppState::load(&state).await?;
    }

    let _configuration_reload_listener = config.runtime_configuration.enabled.then(|| {
        ConfigurationReloadListener::spawn(
            config.database_url.expose_secret().to_owned(),
            state.clone(),
        )
    });

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
        .layer(Extension(build_frontend_registry(
            &config,
            &state.distribution,
        )))
        .layer(Extension(DeploymentVersion::from_env()))
        .layer(CorsLayer::very_permissive())
        .layer(SetResponseHeaderLayer::overriding(
            axum::http::header::SERVER,
            DeploymentIdentity::from_env().server_header(),
        ));

    let background_tasks = state.background_tasks.clone();

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

    tracing::info!(api_docs_url = %format!("http://{}/scalar", local_addr), "API docs available");
    tracing::info!(frontend_url = %format!("http://{}", local_addr), "Frontend available");
    tracing::info!(listen_addr = %local_addr, worker_threads, "Server listening");

    // Everything after the signal shares one deadline: the connection drain
    // and the generation drain draw from the same budget, so the total
    // post-signal time stays within the deployment's termination grace
    // period no matter which phase consumes it.
    let drain_window = Duration::from_secs(config.generation_status.shutdown_drain_secs);
    let (drain_deadline_tx, drain_deadline_rx) =
        tokio::sync::watch::channel(None::<tokio::time::Instant>);
    let shutdown = {
        let background_tasks = background_tasks.clone();
        async move {
            shutdown_signal().await;
            tracing::info!("Shutdown signal received; draining in-flight generations");
            let _ = drain_deadline_tx.send(Some(tokio::time::Instant::now() + drain_window));
            // Aborting before the connection drain matters: the graceful
            // shutdown below waits for open responses, and a live SSE stream
            // only ends once its generation stops — without the abort, the
            // server would sit on streaming connections until killed.
            background_tasks.request_abort_all().await;
        }
    };
    // The graceful shutdown awaits every open response without a timeout of
    // its own, so a wedged handler or a stalled SSE tail could hold the serve
    // future open past the grace period — and everything below it, abort
    // sweep, generation drain and logging, would never run. Once the deadline
    // passes, dropping the serve future closes the remaining connections,
    // which is the correct outcome at that point.
    let deadline_elapsed = {
        let mut deadline_rx = drain_deadline_rx.clone();
        async move {
            // An error means the serve future resolved without a signal ever
            // arriving; this branch then simply never fires.
            if deadline_rx
                .wait_for(|deadline| deadline.is_some())
                .await
                .is_err()
            {
                std::future::pending::<()>().await;
            }
            let deadline = (*deadline_rx.borrow()).expect("set before the sender is dropped");
            tokio::time::sleep_until(deadline).await;
        }
    };
    tokio::select! {
        result = axum::serve(listener, app.into_make_service()).with_graceful_shutdown(shutdown) => result?,
        () = deadline_elapsed => {
            tracing::warn!("Shutdown deadline elapsed with connections still open; dropping them");
        }
    }

    // A second sweep for generations spawned by requests that were already
    // past the listener when the signal fired.
    background_tasks.request_abort_all().await;
    if !drain_window.is_zero() {
        // The generation drain gets whatever the connection drain left of
        // the shared deadline, never a fresh window.
        let remaining = (*drain_deadline_rx.borrow())
            .map(|deadline| deadline.saturating_duration_since(tokio::time::Instant::now()))
            .unwrap_or(drain_window);
        if background_tasks.drain(remaining).await {
            tracing::info!("All in-flight generations recorded their outcome");
        } else {
            tracing::warn!(
                drain_secs = config.generation_status.shutdown_drain_secs,
                "Exiting with generations still in flight; the stale-lease reaper will mark them errored"
            );
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn shutdown_signal_stays_pending_until_a_signal_arrives() {
        let result = tokio::time::timeout(Duration::from_millis(20), shutdown_signal()).await;
        assert!(
            result.is_err(),
            "the shutdown future must not resolve on its own"
        );
    }

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
