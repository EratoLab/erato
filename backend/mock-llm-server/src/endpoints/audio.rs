use axum::{
    extract::{Extension, Request},
    Json,
};
use serde::Serialize;
use serde_json::Value;

use crate::{log, request_id::RequestId};

#[derive(Debug, Serialize)]
struct AudioTranscriptionResponse {
    text: String,
}

/// Handler for OpenAI-compatible audio transcription endpoint.
pub async fn transcriptions(
    Extension(request_id): Extension<RequestId>,
    request: Request,
) -> Result<Json<Value>, Json<Value>> {
    let uri = request.uri().path().to_string();
    let bytes = axum::body::to_bytes(request.into_body(), usize::MAX)
        .await
        .map_err(|_| Json(serde_json::json!({"error": "Failed to read request body"})))?;

    log::log_request(
        request_id.as_str(),
        "POST",
        &uri,
        &format!(
            "Received audio transcription request ({} bytes)",
            bytes.len()
        ),
    );
    log::log_response_start(request_id.as_str(), "audio transcription");

    let response_text = std::env::var("MOCK_LLM_AUDIO_TRANSCRIPTION_TEXT")
        .unwrap_or_else(|_| "This is a deterministic mock audio transcription.".to_string());
    let response = serde_json::to_value(AudioTranscriptionResponse {
        text: response_text,
    })
    .map_err(|_| Json(serde_json::json!({"error": "Failed to build response"})))?;

    log::log_response_complete(request_id.as_str());
    Ok(Json(response))
}
