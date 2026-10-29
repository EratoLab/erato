use super::*;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use futures::SinkExt;
use serde_json::{Value, json};
use std::{collections::VecDeque, sync::Arc, time::Duration};
use tokio_tungstenite::{
    Connector, connect_async_tls_with_config,
    tungstenite::{Message, client::IntoClientRequest},
};

fn endpoint_host(location: &str) -> String {
    match location {
        "global" => "aiplatform.googleapis.com".to_string(),
        "eu" | "us" => format!("aiplatform.{location}.rep.googleapis.com"),
        _ => format!("{location}-aiplatform.googleapis.com"),
    }
}

type Socket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// One instance belongs to one assistant response. Only fully consumed turns are reused.
pub struct GeminiLive {
    config: SpeechProviderConfig,
    idle: Arc<tokio::sync::Mutex<Option<Socket>>>,
}
impl GeminiLive {
    pub fn new(config: SpeechProviderConfig) -> Self {
        Self {
            config,
            idle: Arc::new(tokio::sync::Mutex::new(None)),
        }
    }

    async fn connect(&self) -> Result<Socket, Report> {
        let c = &self.config;
        if c.access_token.is_some() == c.api_key.is_some() {
            return Err(eyre!(
                "Gemini Live requires exactly one of api_key or access_token"
            ));
        }
        let project = c
            .project_id
            .as_deref()
            .filter(|s| !s.is_empty())
            .ok_or_else(|| eyre!("Gemini Live requires project_id"))?;
        let location = c
            .location
            .as_deref()
            .filter(|s| !s.is_empty())
            .ok_or_else(|| eyre!("Gemini Live requires an explicit location"))?;
        if !location
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        {
            return Err(eyre!("Invalid Gemini Live location"));
        }
        let prefix = format!("projects/{project}/locations/{location}/publishers/google/models/");
        let model = if c.model_name.starts_with("projects/") {
            if !c.model_name.starts_with(&prefix)
                || c.model_name[prefix.len()..].is_empty()
                || c.model_name[prefix.len()..].contains('/')
            {
                return Err(eyre!(
                    "Gemini Live model scope must match project_id and location"
                ));
            }
            c.model_name.clone()
        } else {
            if c.model_name.is_empty() || c.model_name.contains('/') {
                return Err(eyre!("Invalid Gemini Live model name"));
            }
            format!("{prefix}{}", c.model_name)
        };
        let host = endpoint_host(location);
        let default_url = format!("wss://{host}");
        let mut url = url::Url::parse(c.base_url.as_deref().unwrap_or(&default_url))?;
        let scheme = match url.scheme() {
            "http" | "ws" => "ws",
            "https" | "wss" => "wss",
            _ => return Err(eyre!("Invalid Gemini Live base URL scheme")),
        };
        url.set_scheme(scheme)
            .map_err(|_| eyre!("Invalid Gemini Live base URL"))?;
        url.set_path(&format!(
            "{}/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent",
            url.path().trim_end_matches('/')
        ));
        let mut request = url.as_str().into_client_request()?;
        if let Some(token) = &c.access_token {
            request.headers_mut().insert(
                "Authorization",
                format!("Bearer {}", token.expose_secret()).parse()?,
            );
        } else if let Some(key) = &c.api_key {
            request
                .headers_mut()
                .insert("x-goog-api-key", key.expose_secret().parse()?);
        }
        let roots =
            rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        let tls = rustls::ClientConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_safe_default_protocol_versions()?
        .with_root_certificates(roots)
        .with_no_client_auth();
        let (mut socket, _) = tokio::time::timeout(
            Duration::from_secs(15),
            connect_async_tls_with_config(
                request,
                None,
                false,
                Some(Connector::Rustls(Arc::new(tls))),
            ),
        )
        .await??;
        let mut instructions = String::from(
            "Read the user's text aloud exactly as written. Do not answer, comment on, add to, or omit any of the text.",
        );
        if let Some(style) = &c.instructions {
            instructions.push_str("\nDelivery instructions: ");
            instructions.push_str(style);
        }
        let setup = json!({"setup":{"model":model,"generationConfig":{"responseModalities":["AUDIO"],"speechConfig":{"voiceConfig":{"prebuiltVoiceConfig":{"voiceName":c.voice}}}},"systemInstruction":{"parts":[{"text":instructions}]}}});
        socket.send(Message::Text(setup.to_string().into())).await?;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(180);
        loop {
            let event = next_event(&mut socket, deadline).await?;
            if event.get("error").is_some() {
                return Err(eyre!("Gemini Live setup failed"));
            }
            if event.get("setupComplete").is_some() {
                break;
            }
        }
        Ok(socket)
    }
}

#[async_trait]
impl SpeechProvider for GeminiLive {
    async fn finish(&self) -> Result<(), Report> {
        if let Some(mut socket) = self.idle.lock().await.take() {
            let _ = tokio::time::timeout(Duration::from_secs(2), socket.close(None)).await;
        }
        Ok(())
    }

    async fn stream(&self, text: &str) -> Result<SpeechAudio, Report> {
        let cached = self.idle.lock().await.take();
        let mut socket = match cached {
            Some(socket) => socket,
            None => self.connect().await?,
        };
        let deadline = tokio::time::Instant::now() + Duration::from_secs(180);
        let idle = self.idle.clone();
        socket.send(Message::Text(json!({"clientContent":{"turns":[{"role":"user","parts":[{"text":text}]}],"turnComplete":true}}).to_string().into())).await?;
        let chunks = futures::stream::try_unfold(
            (socket, deadline, VecDeque::<Vec<u8>>::new(), false, idle),
            |(mut socket, deadline, mut ready, mut complete, idle)| async move {
                loop {
                    if let Some(chunk) = ready.pop_front() {
                        return Ok(Some((chunk, (socket, deadline, ready, complete, idle))));
                    }
                    if complete {
                        *idle.lock().await = Some(socket);
                        return Ok(None);
                    }
                    let event = next_event(&mut socket, deadline).await?;
                    if event.get("error").is_some() {
                        return Err(eyre!("Gemini Live speech provider error"));
                    }
                    let Some(content) = event.get("serverContent") else {
                        continue;
                    };
                    if content.get("interrupted").and_then(Value::as_bool) == Some(true) {
                        return Err(eyre!("Gemini Live speech was interrupted"));
                    }
                    if let Some(parts) = content
                        .pointer("/modelTurn/parts")
                        .and_then(Value::as_array)
                    {
                        for part in parts {
                            if let Some(audio) = part.get("inlineData") {
                                let mime = audio
                                    .get("mimeType")
                                    .and_then(Value::as_str)
                                    .unwrap_or("")
                                    .to_ascii_lowercase()
                                    .replace(' ', "");
                                if !mime.starts_with("audio/pcm")
                                    || !mime.split(';').any(|p| p == "rate=24000")
                                {
                                    return Err(eyre!("Unexpected Gemini Live PCM format: {mime}"));
                                }
                                let data = audio
                                    .get("data")
                                    .and_then(Value::as_str)
                                    .ok_or_else(|| eyre!("Missing Gemini Live audio data"))?;
                                ready.push_back(STANDARD.decode(data)?);
                            }
                        }
                    }
                    complete = content.get("turnComplete").and_then(Value::as_bool) == Some(true);
                }
            },
        );
        Ok(SpeechAudio {
            sample_rate: 24000,
            chunks: Box::pin(chunks),
        })
    }
}

async fn next_event<S>(
    socket: &mut tokio_tungstenite::WebSocketStream<S>,
    deadline: tokio::time::Instant,
) -> Result<Value, Report>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    loop {
        let message = tokio::time::timeout_at(deadline, socket.next())
            .await?
            .ok_or_else(|| eyre!("Gemini Live ended without completion"))??;
        match message {
            Message::Text(text) => return Ok(serde_json::from_str(&text)?),
            Message::Binary(bytes) => return Ok(serde_json::from_slice(&bytes)?),
            Message::Close(_) => return Err(eyre!("Gemini Live ended without completion")),
            _ => {}
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use axum::{
        Router,
        extract::{
            State,
            ws::{Message as WsMessage, WebSocketUpgrade},
        },
        http::HeaderMap,
        routing::get,
    };
    use tokio::sync::oneshot;

    pub(crate) fn config(url: String) -> SpeechProviderConfig {
        serde_json::from_value(json!({"provider_kind":"gemini_live", "base_url":url, "model_name":"gemini-3.8-live", "voice":"Kore", "project_id":"test", "location":"eu", "access_token":"secret"})).unwrap()
    }

    #[test]
    fn endpoint_routes_multi_regions_and_regions() {
        assert_eq!(endpoint_host("eu"), "aiplatform.eu.rep.googleapis.com");
        assert_eq!(endpoint_host("us"), "aiplatform.us.rep.googleapis.com");
        assert_eq!(endpoint_host("global"), "aiplatform.googleapis.com");
        assert_eq!(
            endpoint_host("europe-west4"),
            "europe-west4-aiplatform.googleapis.com"
        );
    }

    pub(crate) async fn mock(
        mode: &'static str,
        expected_text: &'static str,
    ) -> (String, oneshot::Receiver<()>, tokio::task::JoinHandle<()>) {
        let (tx, rx) = oneshot::channel();
        let state = Arc::new(tokio::sync::Mutex::new(Some(tx)));
        let app = Router::new().route("/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent", get(move |ws: WebSocketUpgrade, headers: HeaderMap, State(state): State<Arc<tokio::sync::Mutex<Option<oneshot::Sender<()>>>>>| async move {
            if mode == "key_complete" {
                assert_eq!(headers["x-goog-api-key"], "secret-key");
                assert!(!headers.contains_key("authorization"));
            } else {
                assert_eq!(headers["authorization"], "Bearer secret");
                assert!(!headers.contains_key("x-goog-api-key"));
            }
            ws.on_upgrade(move |mut socket| async move {
                let WsMessage::Text(setup) = socket.recv().await.unwrap().unwrap() else { panic!("expected setup") };
                let setup: Value = serde_json::from_str(&setup).unwrap();
                assert_eq!(setup["setup"]["model"], "projects/test/locations/eu/publishers/google/models/gemini-3.8-live");
                assert_eq!(setup["setup"]["generationConfig"]["speechConfig"]["voiceConfig"]["prebuiltVoiceConfig"]["voiceName"], "Kore");
                socket.send(WsMessage::Text(json!({"setupComplete":{}}).to_string().into())).await.unwrap();
                let WsMessage::Text(text) = socket.recv().await.unwrap().unwrap() else { panic!("expected text") };
                let text: Value = serde_json::from_str(&text).unwrap();
                assert_eq!(text["clientContent"]["turns"][0]["parts"][0]["text"], expected_text);
                let response = if mode == "error" { json!({"error":{"message":"provider failure"}}) } else { json!({"serverContent":{"modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm;rate=24000","data":"AQIDBA=="}}]},"turnComplete":mode == "complete" || mode == "key_complete"}}) };
                socket.send(WsMessage::Text(response.to_string().into())).await.unwrap();
                if mode == "cancel" { let _ = socket.recv().await; }
                if let Some(tx) = state.lock().await.take() { let _ = tx.send(()); }
            })
        })).with_state(state);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (format!("http://{address}"), rx, task)
    }

    #[tokio::test]
    async fn reuses_connection_for_multiple_passages_and_closes_on_finish() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
            let Message::Text(setup) = socket.next().await.unwrap().unwrap() else {
                panic!()
            };
            assert!(
                serde_json::from_str::<Value>(&setup)
                    .unwrap()
                    .get("setup")
                    .is_some()
            );
            socket
                .send(Message::Text(
                    json!({"setupComplete":{}}).to_string().into(),
                ))
                .await
                .unwrap();
            for expected in ["First passage.", "Second passage."] {
                let Message::Text(text) = socket.next().await.unwrap().unwrap() else {
                    panic!()
                };
                let request: Value = serde_json::from_str(&text).unwrap();
                assert_eq!(
                    request["clientContent"]["turns"][0]["parts"][0]["text"],
                    expected
                );
                socket.send(Message::Text(json!({"serverContent":{"modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm;rate=24000","data":"AQIDBA=="}}]},"turnComplete":true}}).to_string().into())).await.unwrap();
            }
            assert!(matches!(socket.next().await, Some(Ok(Message::Close(_)))));
        });
        let provider = provider(&config(url)).unwrap();
        for text in ["First passage.", "Second passage."] {
            let result = tokio::time::timeout(Duration::from_secs(3), provider.synthesize(text))
                .await
                .unwrap()
                .unwrap();
            assert_eq!(result.pcm, [1, 2, 3, 4]);
        }
        provider.finish().await.unwrap();
        tokio::time::timeout(Duration::from_secs(3), server)
            .await
            .unwrap()
            .unwrap();
    }

    #[tokio::test]
    async fn streams_audio_completes_and_builds_replay_wav() {
        let (url, _, task) = mock("complete", "Hello.").await;
        let audio = provider(&config(url))
            .unwrap()
            .synthesize("Hello.")
            .await
            .unwrap();
        assert_eq!(audio.sample_rate, 24000);
        assert_eq!(audio.pcm, [1, 2, 3, 4]);
        let replay = wav(&audio.pcm, audio.sample_rate).unwrap();
        assert_eq!(&replay[44..], &audio.pcm);
        task.abort();
    }

    #[tokio::test]
    async fn api_key_is_sent_in_websocket_header() {
        let (url, _, task) = mock("key_complete", "Hello.").await;
        let mut settings = config(url);
        settings.access_token = None;
        settings.api_key = serde_json::from_value(json!("secret-key")).unwrap();
        let audio = provider(&settings)
            .unwrap()
            .synthesize("Hello.")
            .await
            .unwrap();
        assert_eq!(audio.pcm, [1, 2, 3, 4]);
        task.abort();
    }

    #[tokio::test]
    async fn errors_and_missing_completion_fail() {
        for mode in ["error", "closed"] {
            let (url, _, task) = mock(mode, "Hello.").await;
            assert!(
                provider(&config(url))
                    .unwrap()
                    .synthesize("Hello.")
                    .await
                    .is_err()
            );
            task.abort();
        }
    }

    #[tokio::test]
    async fn dropping_stream_closes_connection() {
        let (url, closed, task) = mock("cancel", "Hello.").await;
        let mut audio = provider(&config(url))
            .unwrap()
            .stream("Hello.")
            .await
            .unwrap();
        assert_eq!(audio.chunks.next().await.unwrap().unwrap(), [1, 2, 3, 4]);
        drop(audio);
        tokio::time::timeout(Duration::from_secs(2), closed)
            .await
            .unwrap()
            .unwrap();
        task.abort();
    }

    #[tokio::test]
    async fn rejects_mismatched_model_scope_and_multiple_credentials() {
        let mut c = config("http://localhost".into());
        c.model_name = "projects/test/locations/us/publishers/google/models/gemini-3.8-live".into();
        assert!(GeminiLive::new(c.clone()).stream("Hello.").await.is_err());
        c.model_name = "gemini-3.8-live".into();
        c.api_key = serde_json::from_value(json!("key")).unwrap();
        assert!(GeminiLive::new(c).stream("Hello.").await.is_err());
    }
}
