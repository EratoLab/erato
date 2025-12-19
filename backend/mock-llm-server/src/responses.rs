use axum::response::sse::Event;
use futures::StreamExt;
use serde_json::json;
use std::time::Duration;

use crate::matcher::{ResponseConfig, StaticResponseConfig};

/// Build an OpenAI-compatible SSE streaming chunk
/// Based on backend/erato/tests/integration_tests/test_utils.rs:437-463
/// Note: Returns just the JSON, not the full SSE format (axum adds "data: " prefix)
pub fn build_openai_chat_chunk(content: &str, finish_reason: Option<&str>) -> String {
    let delta = if content.is_empty() {
        json!({
            "content": content,
            "role": "assistant"
        })
    } else {
        json!({
            "content": content
        })
    };

    let chunk = json!({
        "id": "chatcmpl-mock-123",
        "object": "chat.completion.chunk",
        "created": 1234567890,
        "model": "gpt-3.5-turbo",
        "choices": [{
            "index": 0,
            "delta": delta,
            "finish_reason": finish_reason
        }]
    });

    chunk.to_string()
}

/// Action to perform when building a streaming response
#[derive(Debug, Clone)]
pub enum StreamAction {
    /// Send bytes immediately
    Bytes(String),
    /// Wait for a duration
    Delay(Duration),
}

/// Build a sequence of stream actions for a delayed streaming response
/// Based on backend/erato/tests/integration_tests/test_utils.rs:466-494
pub fn build_delayed_streaming_response(
    chunks: Vec<String>,
    delay_ms: u64,
    initial_delay_ms: Option<u64>,
) -> Vec<StreamAction> {
    let mut actions = Vec::new();

    // First chunk is typically an empty role message
    actions.push(StreamAction::Bytes(build_openai_chat_chunk("", None)));

    // Add each content chunk with delay
    for (i, chunk) in chunks.iter().enumerate() {
        if i > 0 {
            actions.push(StreamAction::Delay(Duration::from_millis(delay_ms)));
        } else if let Some(initial_delay) = initial_delay_ms {
            // Use initial delay before the first chunk
            actions.push(StreamAction::Delay(Duration::from_millis(initial_delay)));
        }
        actions.push(StreamAction::Bytes(build_openai_chat_chunk(chunk, None)));
    }

    // Add a small delay before the final chunk
    actions.push(StreamAction::Delay(Duration::from_millis(delay_ms)));

    // Final chunk with finish_reason
    actions.push(StreamAction::Bytes(build_openai_chat_chunk(
        "",
        Some("stop"),
    )));

    // OpenAI sends a final [DONE] message
    actions.push(StreamAction::Bytes("[DONE]".to_string()));

    actions
}

/// Convert a ResponseConfig into a stream of SSE events
pub async fn stream_response(
    config: ResponseConfig,
) -> impl futures::Stream<Item = Result<Event, std::convert::Infallible>> {
    let (chunks, delay_ms, initial_delay_ms) = match config {
        ResponseConfig::Static(static_config) => (
            static_config.chunks,
            static_config.delay_ms,
            static_config.initial_delay_ms,
        ),
    };

    let actions = build_delayed_streaming_response(chunks, delay_ms, initial_delay_ms);

    futures::stream::iter(actions).then(|action| async move {
        match action {
            StreamAction::Bytes(data) => Ok(Event::default().data(data)),
            StreamAction::Delay(duration) => {
                tokio::time::sleep(duration).await;
                // Return an empty event that will be filtered out
                // We use a special marker that the handler can filter
                Ok(Event::default().data(""))
            }
        }
    })
}

/// Generate a mock embedding vector
pub fn generate_mock_embedding(dimension: usize) -> Vec<f32> {
    // Generate a simple mock embedding with normalized values
    let mut embedding = vec![0.0; dimension];
    for (i, val) in embedding.iter_mut().enumerate() {
        *val = ((i as f32 * 0.1) % 1.0) - 0.5;
    }
    embedding
}

/// Build an OpenAI-compatible embeddings response
pub fn build_embeddings_response(input: &[String], model: &str) -> serde_json::Value {
    let data: Vec<serde_json::Value> = input
        .iter()
        .enumerate()
        .map(|(index, _text)| {
            json!({
                "object": "embedding",
                "embedding": generate_mock_embedding(1536), // OpenAI's default dimension
                "index": index
            })
        })
        .collect();

    json!({
        "object": "list",
        "data": data,
        "model": model,
        "usage": {
            "prompt_tokens": input.iter().map(|s| s.split_whitespace().count()).sum::<usize>(),
            "total_tokens": input.iter().map(|s| s.split_whitespace().count()).sum::<usize>()
        }
    })
}

/// Generate a mock base64-encoded 1x1 transparent PNG image
pub fn generate_mock_image_base64() -> String {
    // 1x1 transparent PNG
    const TRANSPARENT_PNG_BASE64: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    TRANSPARENT_PNG_BASE64.to_string()
}

/// Build an OpenAI-compatible image generation response
pub fn build_image_generation_response(prompt: &str, n: usize) -> serde_json::Value {
    let data: Vec<serde_json::Value> = (0..n)
        .map(|_| {
            json!({
                "b64_json": generate_mock_image_base64(),
                "revised_prompt": prompt
            })
        })
        .collect();

    json!({
        "created": 1234567890u64,
        "data": data
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_openai_chat_chunk() {
        let chunk = build_openai_chat_chunk("Hello", None);
        assert!(chunk.contains("Hello"));
        assert!(chunk.contains("chat.completion.chunk"));
        // Verify it's valid JSON
        let _parsed: serde_json::Value = serde_json::from_str(&chunk).unwrap();
    }

    #[test]
    fn test_build_openai_chat_chunk_with_finish() {
        let chunk = build_openai_chat_chunk("", Some("stop"));
        assert!(chunk.contains("finish_reason"));
        assert!(chunk.contains("stop"));
    }

    #[test]
    fn test_build_delayed_streaming_response() {
        let chunks = vec!["Hello".to_string(), " world".to_string()];
        let actions = build_delayed_streaming_response(chunks, 50, None);

        // Should have: initial empty, 2 content chunks, delay before final, final chunk, [DONE]
        assert!(actions.len() >= 5);

        // Check for delays
        let delay_count = actions
            .iter()
            .filter(|a| matches!(a, StreamAction::Delay(_)))
            .count();
        assert!(delay_count >= 1);
    }

    #[test]
    fn test_generate_mock_embedding() {
        let embedding = generate_mock_embedding(1536);
        assert_eq!(embedding.len(), 1536);
        // Check values are in reasonable range
        assert!(embedding.iter().all(|&v| (-1.0..=1.0).contains(&v)));
    }

    #[test]
    fn test_build_embeddings_response() {
        let input = vec!["test string".to_string()];
        let response = build_embeddings_response(&input, "text-embedding-ada-002");

        assert_eq!(response["object"], "list");
        assert_eq!(response["model"], "text-embedding-ada-002");
        assert_eq!(response["data"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn test_build_image_generation_response() {
        let response = build_image_generation_response("A test image", 1);

        assert!(response["created"].is_u64());
        assert_eq!(response["data"].as_array().unwrap().len(), 1);
        assert!(response["data"][0]["b64_json"].is_string());
    }
}
