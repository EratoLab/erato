#![allow(dead_code)]
#![allow(unused)]

mod endpoints;
mod image_data;
mod log;
mod matcher;
mod mocks;
mod request_id;
mod responses;

use axum::{
    extract::{Extension, Request},
    http::StatusCode,
    middleware,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use colored::Colorize;
use request_id::RequestId;
use serde_json::json;
use std::sync::Arc;

use matcher::Matcher;

/// Health check endpoint
async fn health() -> Json<serde_json::Value> {
    Json(json!({
        "status": "ok",
        "service": "mock-llm-server"
    }))
}

/// Fallback handler for non-existent endpoints
async fn fallback_404(Extension(request_id): Extension<RequestId>, request: Request) -> Response {
    let method = request.method().to_string();
    let uri = request.uri().path().to_string();

    log::log_404(request_id.as_str(), &method, &uri);

    (
        StatusCode::NOT_FOUND,
        Json(json!({
            "error": "Not Found",
            "path": uri
        })),
    )
        .into_response()
}

#[tokio::main]
async fn main() {
    // We don't use tracing for output anymore, but keep it for potential debugging
    // Set RUST_LOG=debug to see internal tracing logs if needed
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "off".into()),
        )
        .init();

    // Load configured mocks
    let mocks = mocks::get_default_mocks();

    let matcher = Arc::new(Matcher::new(mocks.clone()));

    // Build the router with all endpoints nested under /base-openai
    let app = Router::new()
        .route("/health", get(health))
        .nest(
            "/base-openai",
            Router::new()
                .route(
                    "/v1/chat/completions",
                    post(endpoints::chat::chat_completions),
                )
                .route("/v1/embeddings", post(endpoints::embeddings::embeddings))
                .route(
                    "/v1/images/generations",
                    post(endpoints::images::generate_images),
                )
                .route("/v1/responses", post(endpoints::responses::responses)),
        )
        .nest(
            "/base-vertex",
            Router::new().route(
                "/v1/publishers/google/{*path}",
                post(endpoints::vertex::vertex_generate_content),
            ),
        )
        .fallback(fallback_404)
        .with_state(matcher)
        .layer(middleware::from_fn(request_id::request_id_middleware));

    // Get bind address from environment or use default
    let host = std::env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port = std::env::var("PORT").unwrap_or_else(|_| "44320".to_string());
    let addr = format!("{}:{}", host, port);

    log::log_startup(&addr);

    // Print example erato.toml configuration
    println!("{}", "Example erato.toml configuration:".bright_white());
    println!("```");
    println!("[chat_providers.providers.mock-llm-openai]");
    println!("provider_kind = \"openai\"");
    println!("model_name = \"placeholder\"");
    println!("model_display_name = \"Mock-LLM\"");
    println!("base_url = \"http://localhost:44320/base-openai/v1/placeholder\"");
    println!();
    println!("[chat_providers.providers.mock-llm-openai-responses]");
    println!("provider_kind = \"openai_responses\"");
    println!("model_name = \"gpt-5.2\"");
    println!("model_display_name = \"Mock-LLM Responses\"");
    println!("base_url = \"http://localhost:44320/base-openai/v1/placeholder\"");
    println!();
    println!("[chat_providers.providers.mock-llm-vertex]");
    println!("provider_kind = \"vertex_ai\"");
    println!("model_name = \"gemini-2.5-flash\"");
    println!("model_display_name = \"Mock Vertex\"");
    println!("base_url = \"http://localhost:44320/base-vertex/v1/publishers/google/\"");
    println!("```");
    println!();

    // Print mock summary at startup
    println!(
        "{}",
        format!("{} configured chat mocks available:", mocks.len()).bright_white()
    );
    for mock in &mocks {
        mock.print_summary();
    }

    println!(
        "{}",
        "2 configured OpenAI Responses mocks available:".bright_white()
    );
    println!("  [responses-reasoning-lock-code]");
    println!(
        "    {}: emits reasoning summary chunks followed by assistant output",
        "Description".bold()
    );
    println!(
        "    {}: request text contains \"five-digit riddle\"",
        "Match rule".bold()
    );
    println!(
        "    {}: response.reasoning_summary_text.delta + response.output_text.delta",
        "Response".bold()
    );
    println!();
    println!("  [responses-riddle-follow-up]");
    println!(
        "    {}: validates replayed encrypted reasoning content from the prior reasoning response",
        "Description".bold()
    );
    println!(
        "    {}: request text contains \"riddle follow-up\" and replayed encrypted_content",
        "Match rule".bold()
    );
    println!("    {}: response.output_text.delta", "Response".bold());
    println!();

    // Print image mock summary
    let image_mocks = mocks::get_default_image_mocks();
    println!(
        "{}",
        format!("{} configured image mocks available:", image_mocks.len()).bright_white()
    );
    for mock in &image_mocks {
        println!("  [{}]", mock.name);
        println!("    {}: {}", "Description".bold(), mock.description);
        println!("    {}: contains \"{}\"", "Match rule".bold(), mock.pattern);
        println!(
            "    {}: Base64 image ({} bytes)",
            "Response".bold(),
            mock.image_base64.len()
        );
        println!();
    }

    // Start the server
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|e| panic!("Failed to bind to {}: {}", addr, e));

    axum::serve(listener, app)
        .await
        .unwrap_or_else(|e| panic!("Server error: {}", e));
}
