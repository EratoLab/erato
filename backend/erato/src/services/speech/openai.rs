use super::*;
use serde_json::json;

pub struct OpenAi(pub SpeechProviderConfig);
#[async_trait]
impl SpeechProvider for OpenAi {
    async fn stream(&self, text: &str) -> Result<SpeechAudio, Report> {
        stream_compatible(&self.0, text, false).await
    }
}
pub(super) async fn stream_compatible(
    config: &SpeechProviderConfig,
    text: &str,
    local: bool,
) -> Result<SpeechAudio, Report> {
    let base = config
        .base_url
        .as_deref()
        .unwrap_or("https://api.openai.com/v1");
    let mut body = json!({"model":config.model_name,"input":text,"voice":config.voice,"response_format":"pcm"});
    // Explicit stream_format is required by audio.cpp, but unsupported by older OpenAI models.
    if local {
        body["stream_format"] = json!("audio");
    }
    if let Some(instructions) = &config.instructions {
        body["instructions"] = json!(instructions);
    }
    let mut request = client()?
        .post(format!("{}/audio/speech", base.trim_end_matches('/')))
        .json(&body);
    if let Some(key) = &config.api_key {
        request = request.bearer_auth(key.expose_secret());
    }
    let response = request.send().await?.error_for_status()?;
    let mime = response
        .headers()
        .get("content-type")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");
    if !(mime.starts_with("audio/pcm")
        || mime.starts_with("audio/L16")
        || mime.starts_with("application/octet-stream"))
    {
        return Err(eyre!(
            "Speech provider returned unexpected PCM content type: {mime}"
        ));
    }
    Ok(SpeechAudio {
        sample_rate: if local { config.sample_rate } else { 24000 },
        chunks: Box::pin(
            response
                .bytes_stream()
                .map(|c| c.map(|b| b.to_vec()).map_err(Report::from)),
        ),
    })
}
