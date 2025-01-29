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

    let app = router.merge(Scalar::with_url("/scalar", ApiDoc::build_openapi_full()));

    let listener = tokio::net::TcpListener::bind(format!("{}:{}", config.address, config.port))
        .await
        .unwrap();
    println!();
    println!("API docs: http://{}/scalar", listener.local_addr().unwrap());
    println!("Listening on {}", listener.local_addr().unwrap());
    axum::serve(listener, app.into_make_service())
        .await
        .unwrap();
}
