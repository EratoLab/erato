use axum::handler::HandlerWithoutStateExt;
use axum::Extension;
use eyre::Report;
use utoipa_scalar::{Scalar, Servable as ScalarServable};

use erato::config::AppConfig;
use erato::frontend_environment::{
    build_frontend_environment, serve_files_with_script, FrontendBundlePath,
};
use erato::models;
use erato::services::sentry::{extend_with_sentry_layers, setup_sentry};
use erato::state::AppState;
use erato::{server, ApiDoc};
use tower_http::cors::CorsLayer;

#[tokio::main]
async fn main() -> Result<(), Report> {
    // initialize tracing
    tracing_subscriber::fmt::init();
    color_eyre::install()?;
    let loaded_dotenv_files = dotenv_flow::dotenv_flow().ok();
    if let Some(loaded_dotenv_files) = loaded_dotenv_files {
        for file in loaded_dotenv_files {
            println!("Loaded dotenv file: {:?}", file);
        }
    }

    let config = AppConfig::new_for_app(None)?;

    let mut _sentry_guard = None;
    setup_sentry(
        config.get_sentry_dsn(),
        config.environment.clone(),
        &mut _sentry_guard,
    );

    let state = AppState::new(config.clone()).await?;

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
        .layer(Extension(build_frontend_environment(&config)))
        .layer(CorsLayer::very_permissive())
        .with_state(state);

    println!();
    println!("API docs: http://{}/scalar", local_addr);
    println!("Frontend at: http://{}", local_addr);
    println!("Listening on {}", local_addr);
    axum::serve(listener, app.into_make_service()).await?;

    Ok(())
}
