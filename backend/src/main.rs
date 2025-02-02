use utoipa_scalar::{Scalar, Servable as ScalarServable};

use backend::{ApiDoc, server};
use backend::config::AppConfig;

#[tokio::main]
async fn main() {
    // initialize tracing
    tracing_subscriber::fmt::init();
    let loaded_dotenv_files = dotenv_flow::dotenv_flow().ok();
    if let Some(loaded_dotenv_files) = loaded_dotenv_files {
        for file in loaded_dotenv_files {
            println!("Loaded dotenv file: {:?}", file);
        }
    }

    let config = AppConfig::new().unwrap();

    let (router, api) = server::router::router().split_for_parts();

    let listener = tokio::net::TcpListener::bind(format!("{}:{}", config.address, config.port))
        .await
        .unwrap();
    let local_addr = listener.local_addr().unwrap();

    // Create OpenAPI spec with server information
    let mut spec = ApiDoc::build_openapi_full();
    spec.servers = Some(vec![utoipa::openapi::Server::new(format!("http://{}", local_addr))]);

    let app = router
        .merge(Scalar::with_url("/scalar", spec.clone()))
        .route("/openapi.json", axum::routing::get(move || async move { 
            axum::Json(spec.clone()) 
        }));

    println!();
    println!("API docs: http://{}/scalar", local_addr);
    println!("Listening on {}", local_addr);
    axum::serve(listener, app.into_make_service())
        .await
        .unwrap();
}
