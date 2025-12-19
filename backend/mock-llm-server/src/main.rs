#![allow(dead_code)]
#![allow(unused)]

mod endpoints;
mod log;
mod matcher;
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
use request_id::RequestId;
use serde_json::json;
use std::sync::Arc;

use matcher::{MatchRule, Matcher, ResponseConfig};

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

    // Configure match rules with example patterns
    let rules = vec![
        MatchRule {
            pattern: "hello".to_string(),
            response: ResponseConfig {
                chunks: vec![
                    "Hello".to_string(),
                    "!".to_string(),
                    " How".to_string(),
                    " can".to_string(),
                    " I".to_string(),
                    " help".to_string(),
                    " you".to_string(),
                    " today".to_string(),
                    "?".to_string(),
                ],
                delay_ms: 50,
            },
        },
        MatchRule {
            pattern: "weather".to_string(),
            response: ResponseConfig {
                chunks: vec![
                    "The".to_string(),
                    " weather".to_string(),
                    " is".to_string(),
                    " sunny".to_string(),
                    " and".to_string(),
                    " warm".to_string(),
                    " today".to_string(),
                    ".".to_string(),
                ],
                delay_ms: 75,
            },
        },
        MatchRule {
            pattern: "test".to_string(),
            response: ResponseConfig {
                chunks: vec![
                    "This".to_string(),
                    " is".to_string(),
                    " a".to_string(),
                    " test".to_string(),
                    " response".to_string(),
                    " from".to_string(),
                    " the".to_string(),
                    " mock".to_string(),
                    " server".to_string(),
                    ".".to_string(),
                ],
                delay_ms: 100,
            },
        },
        MatchRule {
            pattern: "slow".to_string(),
            response: ResponseConfig {
                chunks: vec![
                    "This".to_string(),
                    " response".to_string(),
                    " will".to_string(),
                    " be".to_string(),
                    " delivered".to_string(),
                    " very".to_string(),
                    " slowly".to_string(),
                    "...".to_string(),
                ],
                delay_ms: 500,
            },
        },
        MatchRule {
            pattern: "fast".to_string(),
            response: ResponseConfig {
                chunks: vec![
                    "Quick".to_string(),
                    " response".to_string(),
                    "!".to_string(),
                ],
                delay_ms: 10,
            },
        },
    ];

    let matcher = Arc::new(Matcher::new(rules));

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

    // Start the server
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|e| panic!("Failed to bind to {}: {}", addr, e));

    axum::serve(listener, app)
        .await
        .unwrap_or_else(|e| panic!("Server error: {}", e));
}
