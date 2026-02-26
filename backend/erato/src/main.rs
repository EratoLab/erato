use axum::Extension;
use axum::handler::HandlerWithoutStateExt;
use axum_tracing_opentelemetry::middleware::{OtelAxumLayer, OtelInResponseLayer};
use eyre::Report;
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

#[tokio::main]
async fn main() -> Result<(), Report> {
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
    println!("API docs: http://{}/scalar", local_addr);
    println!("Frontend at: http://{}", local_addr);
    println!("Listening on {}", local_addr);
    axum::serve(listener, app.into_make_service()).await?;

    Ok(())
}
