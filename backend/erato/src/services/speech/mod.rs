pub mod audio_cpp;
pub mod gemini;
pub mod gemini_live;
pub mod openai;
pub mod openai_realtime;
pub mod sentences;
pub mod session;

use crate::config::SpeechProviderConfig;
use async_trait::async_trait;
use eyre::{Report, eyre};
use futures::{Stream, StreamExt};
use std::pin::Pin;

/// All adapters return signed little-endian 16-bit mono PCM. Sample rate is explicit.
pub type AudioStream = Pin<Box<dyn Stream<Item = Result<Vec<u8>, Report>> + Send>>;
pub struct SpeechAudio {
    pub sample_rate: u32,
    pub chunks: AudioStream,
}
pub struct CompleteAudio {
    pub sample_rate: u32,
    pub pcm: Vec<u8>,
}
#[async_trait]
pub trait SpeechProvider: Send + Sync {
    async fn stream(&self, text: &str) -> Result<SpeechAudio, Report>;
    /// Release any session retained across passages of this assistant response.
    async fn finish(&self) -> Result<(), Report> {
        Ok(())
    }
    async fn synthesize(&self, text: &str) -> Result<CompleteAudio, Report> {
        let mut audio = self.stream(text).await?;
        let mut pcm = Vec::new();
        while let Some(chunk) = audio.chunks.next().await {
            pcm.extend(chunk?);
        }
        if pcm.is_empty() || pcm.len() % 2 != 0 {
            return Err(eyre!("Invalid PCM response"));
        }
        Ok(CompleteAudio {
            sample_rate: audio.sample_rate,
            pcm,
        })
    }
}
pub fn provider(config: &SpeechProviderConfig) -> Result<Box<dyn SpeechProvider>, Report> {
    if config.archived {
        return Err(eyre!("Cannot use an archived speech provider"));
    }
    Ok(match config.provider_kind.as_str() {
        "openai" => Box::new(openai::OpenAi(config.clone())),
        "openai_realtime" => Box::new(openai_realtime::OpenAiRealtime(config.clone())),
        "audio_cpp" => Box::new(audio_cpp::AudioCpp(config.clone())),
        "gemini" => Box::new(gemini::Gemini(config.clone())),
        "gemini_live" => Box::new(gemini_live::GeminiLive::new(config.clone())),
        _ => return Err(eyre!("Unknown speech provider")),
    })
}
pub fn client() -> Result<reqwest::Client, Report> {
    Ok(reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(180))
        .build()?)
}
pub fn wav(pcm: &[u8], sample_rate: u32) -> Result<Vec<u8>, Report> {
    let size = u32::try_from(pcm.len())?;
    if size % 2 != 0 || size > u32::MAX - 36 {
        return Err(eyre!("Invalid PCM length"));
    }
    let mut out = Vec::with_capacity(pcm.len() + 44);
    out.extend(b"RIFF");
    out.extend((size + 36).to_le_bytes());
    out.extend(b"WAVEfmt ");
    out.extend(16u32.to_le_bytes());
    out.extend(1u16.to_le_bytes());
    out.extend(1u16.to_le_bytes());
    out.extend(sample_rate.to_le_bytes());
    out.extend((sample_rate * 2).to_le_bytes());
    out.extend(2u16.to_le_bytes());
    out.extend(16u16.to_le_bytes());
    out.extend(b"data");
    out.extend(size.to_le_bytes());
    out.extend(pcm);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{Router, body::Body, extract::Json, response::Response, routing::post};
    use serde_json::{Value, json};
    async fn server(
        body: &'static str,
        mime: &'static str,
        gemini: bool,
    ) -> (String, tokio::task::JoinHandle<()>) {
        let app = Router::new().route(if gemini { "/v1/projects/test/locations/global/publishers/google/models/gemini-3.8-flash-lite-tts:streamGenerateContent" } else { "/audio/speech" }, post(move |Json(request): Json<Value>| async move {
            if gemini {
                assert_eq!(request["contents"][0]["parts"][0]["text"], "Hello.");
                assert_eq!(request["generationConfig"]["speechConfig"]["voiceConfig"]["voice"], "Kore");
            } else {
                assert_eq!(request["input"], "Hello.");
                assert_eq!(request["response_format"], "pcm");
            }
            let pieces = body.as_bytes().chunks(3).map(|s| Ok::<_, std::io::Error>(s.to_vec())).collect::<Vec<_>>();
            Response::builder().header("content-type", mime).body(Body::from_stream(futures::stream::iter(pieces))).unwrap()
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (format!("http://{address}"), task)
    }
    fn config(kind: &str, url: String) -> SpeechProviderConfig {
        serde_json::from_value(json!({"provider_kind":kind,"base_url":url,"model_name":"gemini-3.8-flash-lite-tts","voice":"Kore","project_id":"test","access_token":"test"})).unwrap()
    }
    #[tokio::test]
    async fn compatible_providers_collect_pcm_and_reject_wav() {
        for kind in ["openai", "audio_cpp"] {
            let (url, task) = server("abcd", "audio/pcm", false).await;
            let audio = provider(&config(kind, url))
                .unwrap()
                .synthesize("Hello.")
                .await
                .unwrap();
            assert_eq!(audio.pcm, b"abcd");
            assert_eq!(audio.sample_rate, 24000);
            task.abort();
            let (url, task) = server("RIFF", "audio/wav", false).await;
            assert!(
                provider(&config(kind, url))
                    .unwrap()
                    .stream("Hello.")
                    .await
                    .is_err()
            );
            task.abort();
        }
    }
    #[tokio::test]
    async fn gemini_decodes_fragmented_sse() {
        let (url,task) = server("data: {\"candidates\":[{\"finishReason\":\"STOP\",\"content\":{\"parts\":[{\"inlineData\":{\"mimeType\":\"audio/L16;codec=pcm;rate=24000\",\"data\":\"AQIDBA==\"}}]}}]}\r\n\r\n", "text/event-stream", true).await;
        let audio = provider(&config("gemini", url))
            .unwrap()
            .synthesize("Hello.")
            .await
            .unwrap();
        assert_eq!(audio.pcm, [1, 2, 3, 4]);
        task.abort();
    }
    #[tokio::test]
    async fn gemini_rejects_truncated_audio() {
        let (url, task) = server("data: {\"candidates\":[{\"content\":{\"parts\":[{\"inlineData\":{\"mimeType\":\"audio/L16;codec=pcm;rate=24000\",\"data\":\"AQIDBA==\"}}]}}]}\n\n", "text/event-stream", true).await;
        assert!(
            provider(&config("gemini", url))
                .unwrap()
                .synthesize("Hello.")
                .await
                .is_err()
        );
        task.abort();
    }
    #[tokio::test]
    async fn realtime_streams_audio_and_requires_successful_completion() {
        use axum::{
            extract::ws::{Message, WebSocketUpgrade},
            routing::get,
        };
        for status in ["completed", "failed", "closed"] {
            let app = Router::new().route("/v1/realtime", get(move |ws: WebSocketUpgrade, uri: axum::http::Uri| async move {
                assert_eq!(uri.query(), Some("model=gemini-3.8-flash-lite-tts"));
                ws.on_upgrade(move |mut socket| async move {
                    let Message::Text(request) = socket.recv().await.unwrap().unwrap() else { panic!("expected text") };
                    let request: Value = serde_json::from_str(&request).unwrap();
                    assert_eq!(request["type"], "response.create");
                    assert_eq!(request["response"]["input"][0]["content"][0]["text"], "Hello.");
                    assert_eq!(request["response"]["audio"]["output"]["voice"], "Kore");
                    assert_eq!(request["response"]["audio"]["output"]["format"]["type"], "audio/pcm");
                    socket.send(Message::Text(json!({"type":"response.output_audio.delta", "delta":"AQIDBA=="}).to_string().into())).await.unwrap();
                    if status != "closed" {
                        socket.send(Message::Text(json!({"type":"response.done", "response":{"status":status}}).to_string().into())).await.unwrap();
                    }
                })
            }));
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
            let result = provider(&config("openai_realtime", format!("http://{address}/v1")))
                .unwrap()
                .synthesize("Hello.")
                .await;
            if status == "completed" {
                let audio = result.unwrap();
                assert_eq!(audio.pcm, [1, 2, 3, 4]);
                assert_eq!(audio.sample_rate, 24000);
            } else {
                assert!(result.is_err());
            }
            task.abort();
        }
    }
    #[test]
    fn wav_header_matches_pcm_and_rejects_incomplete_sample() {
        let bytes = wav(&[1, 2, 3, 4], 24000).unwrap();
        assert_eq!(&bytes[..4], b"RIFF");
        assert_eq!(&bytes[40..44], &4u32.to_le_bytes());
        assert_eq!(&bytes[44..], &[1, 2, 3, 4]);
        assert!(wav(&[1], 24000).is_err());
    }
}
