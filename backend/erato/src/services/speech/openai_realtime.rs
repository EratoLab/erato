use super::*;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use futures::SinkExt;
use serde_json::{Value, json};
use tokio_tungstenite::{
    Connector, connect_async_tls_with_config,
    tungstenite::{Message, client::IntoClientRequest},
};

pub struct OpenAiRealtime(pub SpeechProviderConfig);

#[async_trait]
impl SpeechProvider for OpenAiRealtime {
    async fn stream(&self, text: &str) -> Result<SpeechAudio, Report> {
        let config = &self.0;
        let mut url = url::Url::parse(
            config
                .base_url
                .as_deref()
                .unwrap_or("https://api.openai.com/v1"),
        )?;
        let scheme = match url.scheme() {
            "http" | "ws" => "ws",
            "https" | "wss" => "wss",
            _ => return Err(eyre!("Invalid Realtime base URL scheme")),
        };
        url.set_scheme(scheme)
            .map_err(|_| eyre!("Invalid Realtime base URL"))?;
        url.set_path(&format!("{}/realtime", url.path().trim_end_matches('/')));
        url.query_pairs_mut()
            .append_pair("model", &config.model_name);
        let mut request = url.as_str().into_client_request()?;
        if let Some(key) = &config.api_key {
            request.headers_mut().insert(
                "Authorization",
                format!("Bearer {}", key.expose_secret()).parse()?,
            );
        }
        let roots =
            rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        let tls = rustls::ClientConfig::builder_with_provider(std::sync::Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_safe_default_protocol_versions()?
        .with_root_certificates(roots)
        .with_no_client_auth();
        let (mut socket, _) = tokio::time::timeout(
            std::time::Duration::from_secs(15),
            connect_async_tls_with_config(
                request,
                None,
                false,
                Some(Connector::Rustls(std::sync::Arc::new(tls))),
            ),
        )
        .await??;
        let mut instructions = String::from(
            "Read the user's text aloud exactly as written. Do not answer, comment on, add to, or omit any of the text.",
        );
        if let Some(style) = &config.instructions {
            instructions.push_str("\nDelivery instructions: ");
            instructions.push_str(style);
        }
        let event = json!({"type":"response.create", "response": {
            "conversation":"none", "output_modalities":["audio"], "instructions":instructions,
            "audio":{"output":{"format":{"type":"audio/pcm", "rate":24000}, "voice":config.voice}},
            "input":[{"type":"message", "role":"user", "content":[{"type":"input_text", "text":text}]}]
        }});
        socket.send(Message::Text(event.to_string().into())).await?;
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(180);
        let chunks =
            futures::stream::try_unfold((socket, deadline), |(mut socket, deadline)| async move {
                loop {
                    let message = tokio::time::timeout_at(deadline, socket.next())
                        .await?
                        .ok_or_else(|| eyre!("Realtime speech ended without completion"))??;
                    match message {
                        Message::Text(text) => {
                            let event: Value = serde_json::from_str(&text)?;
                            match event["type"].as_str() {
                                Some("response.output_audio.delta") => {
                                    let delta = event["delta"]
                                        .as_str()
                                        .ok_or_else(|| eyre!("Missing Realtime audio delta"))?;
                                    return Ok(Some((STANDARD.decode(delta)?, (socket, deadline))));
                                }
                                Some("response.done") => {
                                    if event.pointer("/response/status").and_then(Value::as_str)
                                        != Some("completed")
                                    {
                                        return Err(eyre!(
                                            "Realtime speech response did not complete: {}",
                                            event["response"]["status"]
                                        ));
                                    }
                                    return Ok(None);
                                }
                                Some("error") => {
                                    return Err(eyre!(
                                        "Realtime speech provider error: {}",
                                        event["error"]
                                    ));
                                }
                                _ => {}
                            }
                        }
                        Message::Close(_) => {
                            return Err(eyre!("Realtime speech ended without completion"));
                        }
                        _ => {}
                    }
                }
            });
        Ok(SpeechAudio {
            sample_rate: 24000,
            chunks: Box::pin(chunks),
        })
    }
}
