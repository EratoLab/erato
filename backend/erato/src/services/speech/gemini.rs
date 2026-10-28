use super::*;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::{Value, json};

pub struct Gemini(pub SpeechProviderConfig);
#[async_trait]
impl SpeechProvider for Gemini {
    async fn stream(&self, text: &str) -> Result<SpeechAudio, Report> {
        let c = &self.0;
        if c.model_name
            .rsplit('/')
            .next()
            .is_some_and(|name| name == "gemini-3.8-live")
        {
            return Err(eyre!(
                "gemini-3.8-live requires the gemini_live speech provider"
            ));
        }
        let location = c.location.as_deref().unwrap_or("global");
        let host = if location == "global" {
            "https://aiplatform.googleapis.com".to_owned()
        } else {
            format!("https://{location}-aiplatform.googleapis.com")
        };
        let base = c.base_url.as_deref().unwrap_or(&host);
        let scope = match c.project_id.as_deref() {
            Some(project) => format!("projects/{project}/locations/{location}/"),
            None if c.api_key.is_some() && c.access_token.is_none() => String::new(),
            None => return Err(eyre!("Gemini OAuth speech requires project_id")),
        };
        let url = format!(
            "{}/v1/{scope}publishers/google/models/{}:streamGenerateContent?alt=sse",
            base.trim_end_matches('/'),
            c.model_name
        );
        let voice = if c.model_name.starts_with("gemini-3.8") {
            json!({"voice":c.voice})
        } else {
            json!({"prebuiltVoiceConfig":{"voiceName":c.voice}})
        };
        let mut part = json!({"text":text});
        if let Some(style) = &c.instructions {
            part["speechMetadata"] = json!({"style":style});
        }
        let body = json!({"contents":[{"role":"user","parts":[part]}],"generationConfig":{
            "responseModalities":["AUDIO"],"speechConfig":{"voiceConfig":voice}
        }});
        let mut request = client()?.post(url).json(&body);
        if let Some(token) = &c.access_token {
            request = request.bearer_auth(token.expose_secret());
        } else if let Some(key) = &c.api_key {
            request = request.header("x-goog-api-key", key.expose_secret());
        } else {
            return Err(eyre!("Gemini speech requires api_key or access_token"));
        }
        let response = request.send().await?.error_for_status()?;
        let mime = response
            .headers()
            .get("content-type")
            .and_then(|h| h.to_str().ok())
            .unwrap_or("");
        if !mime.starts_with("text/event-stream") {
            return Err(eyre!("Expected Gemini SSE response"));
        }
        // SSE data is decoded only after a complete line, preserving split UTF-8/base64 boundaries.
        let state = (
            response,
            Vec::<u8>::new(),
            std::collections::VecDeque::<Vec<u8>>::new(),
            false,
            false,
        );
        let chunks = futures::stream::try_unfold(
            state,
            |(mut response, mut pending, mut ready, mut ended, mut complete)| async move {
                loop {
                    if let Some(bytes) = ready.pop_front() {
                        return Ok(Some((bytes, (response, pending, ready, ended, complete))));
                    }
                    if ended {
                        if !complete {
                            return Err(eyre!("Gemini speech ended without successful completion"));
                        }
                        return Ok(None);
                    }
                    match response.chunk().await? {
                        Some(bytes) => pending.extend(bytes),
                        None => {
                            ended = true;
                            pending.push(b'\n');
                        }
                    }
                    if pending.len() > 8 * 1024 * 1024 {
                        return Err(eyre!("Gemini SSE event too large"));
                    }
                    while let Some(end) = pending.iter().position(|b| *b == b'\n') {
                        let line: Vec<u8> = pending.drain(..=end).collect();
                        let line = std::str::from_utf8(&line)?.trim();
                        if let Some(data) = line.strip_prefix("data:") {
                            if data.trim() == "[DONE]" {
                                continue;
                            }
                            let value: Value = serde_json::from_str(data.trim())?;
                            if let Some(reason) = value
                                .pointer("/candidates/0/finishReason")
                                .and_then(Value::as_str)
                            {
                                if reason != "STOP" {
                                    return Err(eyre!("Gemini speech did not complete: {reason}"));
                                }
                                complete = true;
                            }
                            if value.get("error").is_some() {
                                return Err(eyre!("Gemini speech stream failed"));
                            }
                            if let Some(parts) = value
                                .pointer("/candidates/0/content/parts")
                                .and_then(Value::as_array)
                            {
                                for part in parts {
                                    if let Some(audio) = part.get("inlineData") {
                                        let mime = audio["mimeType"]
                                            .as_str()
                                            .unwrap_or("")
                                            .to_ascii_lowercase();
                                        if !mime.starts_with("audio/l16")
                                            || !mime.contains("rate=24000")
                                        {
                                            return Err(eyre!(
                                                "Unexpected Gemini PCM format: {mime}"
                                            ));
                                        }
                                        ready.push_back(
                                            STANDARD.decode(
                                                audio["data"]
                                                    .as_str()
                                                    .ok_or_else(|| eyre!("Missing audio data"))?,
                                            )?,
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            },
        );
        Ok(SpeechAudio {
            sample_rate: 24000,
            chunks: Box::pin(chunks),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{Router, http::HeaderMap, routing::post};

    #[tokio::test]
    async fn missing_credentials_fail_without_discovery() {
        let config = serde_json::from_value(json!({
            "provider_kind": "gemini", "model_name": "gemini-3.8-flash-lite-tts",
            "voice": "Kore", "project_id": "test"
        }))
        .unwrap();
        let error = match Gemini(config).stream("Hello.").await {
            Err(error) => error,
            Ok(_) => panic!("Missing credentials must fail"),
        };
        assert_eq!(
            error.to_string(),
            "Gemini speech requires api_key or access_token"
        );
    }

    #[tokio::test]
    async fn api_key_uses_projectless_endpoint_and_pcm_with_spaced_mime_parameters() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = Router::new().route(
            "/v1/publishers/google/models/gemini-3.8-flash-lite-tts:streamGenerateContent",
            post(|headers: HeaderMap| async move {
                assert_eq!(headers["x-goog-api-key"], "test-key");
                assert!(!headers.contains_key("authorization"));
                ([("content-type", "text/event-stream")],
                 "data: {\"candidates\":[{\"finishReason\":\"STOP\",\"content\":{\"parts\":[{\"inlineData\":{\"mimeType\":\"audio/l16; rate=24000; channels=1\",\"data\":\"AQIDBA==\"}}]}}]}\n\n")
            }),
        );
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let config = serde_json::from_value(json!({
            "provider_kind": "gemini", "model_name":"gemini-3.8-flash-lite-tts",
            "voice":"Kore", "api_key":"test-key", "base_url":format!("http://{address}")
        }))
        .unwrap();
        let audio = Gemini(config).synthesize("Hello.").await.unwrap();
        assert_eq!(audio.pcm, [1, 2, 3, 4]);
        assert_eq!(audio.sample_rate, 24000);
        server.abort();
    }
}
