//! Service-level projections of the sanitized Augsburg Audio-back capture.
use axum::{
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{io::Read, sync::OnceLock, time::Duration};

#[derive(Deserialize)]
pub struct CapturedEvent {
    pub elapsed_ms: f64,
    pub event: String,
    pub data: Value,
}
#[derive(Deserialize)]
pub struct Capture {
    pub prompt: String,
    pub sample_rate: u32,
    pub pcm_sha256: String,
    pub events: Vec<CapturedEvent>,
    #[serde(skip)]
    pub pcm: Vec<u8>,
}
pub fn capture() -> &'static Capture {
    static CAPTURE: OnceLock<Capture> = OnceLock::new();
    CAPTURE.get_or_init(|| {
        let mut json = Vec::new();
        flate2::read::GzDecoder::new(
            &include_bytes!("../../fixtures/augsburg/capture.json.gz")[..],
        )
        .read_to_end(&mut json)
        .expect("valid compressed capture");
        let mut fixture: Capture = serde_json::from_slice(&json).expect("valid capture JSON");
        let mut audio =
            claxon::FlacReader::new(&include_bytes!("../../fixtures/augsburg/audio.flac")[..])
                .expect("valid FLAC");
        assert_eq!(audio.streaminfo().sample_rate, fixture.sample_rate);
        assert_eq!(audio.streaminfo().channels, 1);
        fixture.pcm = audio
            .samples()
            .flat_map(|sample| (sample.expect("valid sample") as i16).to_le_bytes())
            .collect();
        fixture
    })
}

/// Use the real multipart transcription adapter; only the upstream result is mocked.
pub async fn transcription(body: axum::body::Bytes) -> impl IntoResponse {
    if body.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"Missing microphone audio"})),
        );
    }
    (StatusCode::OK, Json(json!({"text":capture().prompt})))
}

pub async fn live(ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(live_session)
}
async fn live_session(mut socket: WebSocket) {
    let Some(Ok(Message::Text(setup))) = socket.recv().await else {
        return;
    };
    let Ok(setup) = serde_json::from_str::<Value>(&setup) else {
        return;
    };
    if setup.get("setup").is_none() {
        return;
    }
    if socket
        .send(Message::Text(
            json!({"setupComplete":{}}).to_string().into(),
        ))
        .await
        .is_err()
    {
        return;
    }
    let fixture = capture();
    let audio: Vec<_> = fixture
        .events
        .iter()
        .filter(|e| e.event == "audio_delta")
        .collect();
    let total_chars: usize = fixture
        .events
        .iter()
        .filter(|e| e.event == "text_delta")
        .map(|e| {
            e.data["new_text"]
                .as_str()
                .unwrap()
                .chars()
                .filter(|c| c.is_alphanumeric())
                .count()
        })
        .sum();
    let mut spoken_chars = 0;
    let mut cursor = 0;
    while let Some(Ok(Message::Text(turn))) = socket.recv().await {
        let Ok(turn) = serde_json::from_str::<Value>(&turn) else {
            return;
        };
        let Some(text) = turn
            .pointer("/clientContent/turns/0/parts/0/text")
            .and_then(Value::as_str)
        else {
            return;
        };
        if cursor == 0 {
            // Ensure text can complete while synthesis is still starting.
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
        spoken_chars += text.chars().filter(|c| c.is_alphanumeric()).count();
        let end = (spoken_chars * audio.len() / total_chars)
            .max(cursor + 1)
            .min(audio.len());
        for i in cursor..end {
            let event = audio[i];
            let delay = if i == 0 {
                0.0
            } else {
                (event.elapsed_ms - audio[i - 1].elapsed_ms) / 20.0
            };
            tokio::time::sleep(Duration::from_secs_f64(delay / 1000.0)).await;
            let offset = event.data["audio_offset"].as_u64().unwrap() as usize;
            let length = event.data["audio_length"].as_u64().unwrap() as usize;
            let frame = json!({"serverContent":{"modelTurn":{"parts":[{"inlineData":{
                "mimeType":"audio/pcm;rate=24000", "data":STANDARD.encode(&fixture.pcm[offset..offset+length])
            }}]}}});
            if socket
                .send(Message::Text(frame.to_string().into()))
                .await
                .is_err()
            {
                return;
            }
        }
        cursor = end;
        if socket
            .send(Message::Text(
                json!({"serverContent":{"turnComplete":true}})
                    .to_string()
                    .into(),
            ))
            .await
            .is_err()
        {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn compressed_capture_preserves_audio_and_timings() {
        let fixture = capture();
        assert_eq!(fixture.events.len(), 1415);
        assert_eq!(fixture.pcm.len(), 10674728);
        use sha2::Digest;
        assert_eq!(
            sha2::Sha256::digest(&fixture.pcm)
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>(),
            fixture.pcm_sha256
        );
        let mut offset = 0;
        let mut sequence = 0;
        let mut previous = 0.0;
        for event in &fixture.events {
            assert!(event.elapsed_ms >= previous);
            previous = event.elapsed_ms;
            if event.event == "audio_delta" {
                assert_eq!(event.data["sequence"], sequence);
                assert_eq!(event.data["audio_offset"], offset);
                offset += event.data["audio_length"].as_u64().unwrap();
                sequence += 1;
            }
        }
        assert_eq!(sequence, 1372);
        assert_eq!(offset as usize, fixture.pcm.len());
    }
}
