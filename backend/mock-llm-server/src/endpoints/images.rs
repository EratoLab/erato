use axum::{
    extract::{Extension, Request},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{log, request_id::RequestId, responses::build_image_generation_response};

/// Request structure for image generation endpoint
#[derive(Debug, Deserialize)]
pub struct ImageGenerationRequest {
    /// Text description of the image
    pub prompt: String,
    /// Number of images to generate
    #[serde(default = "default_n")]
    pub n: usize,
    /// Size of the images
    #[serde(default)]
    pub size: Option<String>,
    /// Response format (url or b64_json)
    #[serde(default = "default_response_format")]
    pub response_format: String,
}

fn default_n() -> usize {
    1
}

fn default_response_format() -> String {
    "b64_json".to_string()
}

/// Response structure for image generation endpoint
#[derive(Debug, Serialize)]
pub struct ImageGenerationResponse {
    pub created: u64,
    pub data: Vec<ImageData>,
}

#[derive(Debug, Serialize)]
pub struct ImageData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub b64_json: Option<String>,
    pub revised_prompt: String,
}

/// Handler for image generation endpoint
pub async fn generate_images(
    Extension(request_id): Extension<RequestId>,
    request: Request,
) -> Result<Json<Value>, Json<Value>> {
    let uri = request.uri().path().to_string();

    // Extract the JSON body
    let bytes = axum::body::to_bytes(request.into_body(), usize::MAX)
        .await
        .map_err(|_| Json(serde_json::json!({"error": "Failed to read request body"})))?;

    let image_request: ImageGenerationRequest = serde_json::from_slice(&bytes)
        .map_err(|_| Json(serde_json::json!({"error": "Invalid JSON"})))?;

    log::log_request(
        request_id.as_str(),
        "POST",
        &uri,
        &format!(
            "Received image generation request: prompt='{}', n={}, size={:?}, format={}",
            image_request.prompt,
            image_request.n,
            image_request.size,
            image_request.response_format
        ),
    );

    log::log_response_start(request_id.as_str(), "image generation");

    let response = build_image_generation_response(&image_request.prompt, image_request.n);

    log::log_response_complete(request_id.as_str());

    Ok(Json(response))
}
