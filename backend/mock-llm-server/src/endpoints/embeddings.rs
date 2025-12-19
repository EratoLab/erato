use axum::{
    extract::{Extension, Request},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{log, request_id::RequestId, responses::build_embeddings_response};

/// Request structure for embeddings endpoint
#[derive(Debug, Deserialize)]
pub struct EmbeddingsRequest {
    /// Input text(s) to generate embeddings for
    /// Can be a single string or an array of strings
    pub input: InputText,
    /// Model to use for embeddings
    #[serde(default = "default_model")]
    pub model: String,
}

fn default_model() -> String {
    "text-embedding-ada-002".to_string()
}

/// Input text can be either a single string or an array of strings
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum InputText {
    Single(String),
    Multiple(Vec<String>),
}

impl InputText {
    fn to_vec(&self) -> Vec<String> {
        match self {
            InputText::Single(s) => vec![s.clone()],
            InputText::Multiple(v) => v.clone(),
        }
    }
}

/// Response structure for embeddings endpoint
#[derive(Debug, Serialize)]
pub struct EmbeddingsResponse {
    pub object: String,
    pub data: Vec<EmbeddingData>,
    pub model: String,
    pub usage: Usage,
}

#[derive(Debug, Serialize)]
pub struct EmbeddingData {
    pub object: String,
    pub embedding: Vec<f32>,
    pub index: usize,
}

#[derive(Debug, Serialize)]
pub struct Usage {
    pub prompt_tokens: usize,
    pub total_tokens: usize,
}

/// Handler for embeddings endpoint
pub async fn embeddings(
    Extension(request_id): Extension<RequestId>,
    request: Request,
) -> Result<Json<Value>, Json<Value>> {
    let uri = request.uri().path().to_string();

    // Extract the JSON body
    let bytes = axum::body::to_bytes(request.into_body(), usize::MAX)
        .await
        .map_err(|_| Json(serde_json::json!({"error": "Failed to read request body"})))?;

    let embeddings_request: EmbeddingsRequest = serde_json::from_slice(&bytes)
        .map_err(|_| Json(serde_json::json!({"error": "Invalid JSON"})))?;

    let input_texts = embeddings_request.input.to_vec();

    log::log_request(
        request_id.as_str(),
        "POST",
        &uri,
        &format!(
            "Received embeddings request for {} text(s) with model {}",
            input_texts.len(),
            embeddings_request.model
        ),
    );

    log::log_response_start(request_id.as_str(), "embeddings");

    let response = build_embeddings_response(&input_texts, &embeddings_request.model);

    log::log_response_complete(request_id.as_str());

    Ok(Json(response))
}
