use axum::body::Body;
use axum::handler::HandlerWithoutStateExt;
use axum::http::Request;
use axum::Extension;
use eyre::Report;
use serde_json::{json, Value};
use utoipa_scalar::{Scalar, Servable as ScalarServable};

use erato::config::AppConfig;
use erato::frontend_environment::{
    serve_files_with_script, FrontedEnvironment, FrontendBundlePath,
};
use erato::models;
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

    let config = AppConfig::new()?;

    let mut _sentry_guard = None;
    setup_sentry(config.sentry_dsn.as_ref(), &mut _sentry_guard);

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

    let app = router
        .layer(sentry_tower::NewSentryLayer::<Request<Body>>::new_from_top())
        .layer(sentry_tower::SentryHttpLayer::with_transaction())
        .merge(Scalar::with_url("/scalar", spec.clone()))
        .route(
            "/openapi.json",
            axum::routing::get(move || async move { axum::Json(spec.clone()) }),
        )
        .fallback_service(serve_files_with_script.into_service())
        .layer(Extension(FrontendBundlePath(
            config.frontend_bundle_path.clone(),
        )))
        .layer(Extension(build_frontend_environment()))
        .layer(CorsLayer::very_permissive())
        .with_state(state);

    println!();
    println!("API docs: http://{}/scalar", local_addr);
    println!("Frontend at: http://{}", local_addr);
    println!("Listening on {}", local_addr);
    axum::serve(listener, app.into_make_service()).await?;

    Ok(())
}

pub fn build_frontend_environment() -> FrontedEnvironment {
    let mut env = FrontedEnvironment::default();

    let api_root_url = "/api/".to_string();

    env.0.insert(
        "API_ROOT_URL".to_owned(),
        Value::String(api_root_url.clone()),
    );
    env.0
        .insert("SOME_OBJECT".to_owned(), json!({ "foo": "bar" }));

    env
}

#[cfg(feature = "sentry")]
fn setup_sentry(sentry_dsn: Option<&String>, _sentry_guard: &mut Option<sentry::ClientInitGuard>) {
    if let Some(sentry_dsn) = sentry_dsn {
        *_sentry_guard = Some(sentry::init((
            sentry_dsn.as_str(),
            sentry::ClientOptions {
                release: sentry::release_name!(),
                debug: std::env::var("SENTRY_DEBUG").is_ok(),
                ..Default::default()
            },
        )));
    } else {
        println!("No SENTRY_DSN specified. Observability via Sentry is disabled");
    }
}

#[cfg(not(feature = "sentry"))]
fn setup_sentry(_sentry_dsn: Option<&String>, _sentry_guard: Option<()>) {}
