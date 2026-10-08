//! Shared audio transcription interface for genai chat and the OpenAI-compatible
//! multipart `/audio/transcriptions` API.

use crate::config::ChatProviderConfig;
use crate::services::genai::GenAIClient;
use crate::services::template_rendering::contexts::chat_provider_headers::ChatProviderHeadersContext;
use crate::state::AppState;
use async_trait::async_trait;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use eyre::{Report, WrapErr};
use genai::chat::{
    ChatMessage as GenAiChatMessage, ChatOptions, ChatRequest, ContentPart as GenAiContentPart,
    MessageContent, ReasoningEffort,
};
use reqwest::multipart::{Form, Part};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tracing::warn;
use url::Url;

const TRANSCRIPTION_PROMPT: &str = "Transcribe the provided audio excerpt verbatim. Return only spoken words as plain text. The excerpt may start or end mid-sentence, so transcribe any audible partial speech. Do not summarize, add commentary, timestamps, markdown, speaker labels, or inferred missing words. Return an empty string only when there is no audible speech.";

/// Input shared by both transcription transports. Token budgets apply only to genai.
pub(crate) struct AudioTranscriptionRequest {
    pub(crate) audio_bytes: Vec<u8>,
    pub(crate) filename: String,
    pub(crate) max_output_tokens: u32,
}

#[async_trait]
pub(crate) trait AudioTranscriber: Send + Sync {
    async fn transcribe(&self, request: AudioTranscriptionRequest) -> Result<String, Report>;
}

/// Selects the transport at construction and delegates calls through one interface.
pub(crate) enum AudioTranscriptionClient {
    OpenAi(OpenAiAudioTranscriptionClient),
    GenAi(GenAiAudioTranscriptionClient),
}

impl AudioTranscriptionClient {
    pub(crate) fn new(
        app_state: &AppState,
        config: &ChatProviderConfig,
        headers_context: Option<&ChatProviderHeadersContext<'_>>,
    ) -> Result<Self, Report> {
        if config.is_audio_transcription_provider() {
            Ok(Self::OpenAi(OpenAiAudioTranscriptionClient::new(
                config,
                headers_context,
            )?))
        } else {
            let client = app_state.genai_for_chat_provider_config_with_headers_context(
                config.clone(),
                headers_context,
            )?;
            Ok(Self::GenAi(GenAiAudioTranscriptionClient::new(
                client, config,
            )))
        }
    }
}

#[async_trait]
impl AudioTranscriber for AudioTranscriptionClient {
    async fn transcribe(&self, request: AudioTranscriptionRequest) -> Result<String, Report> {
        match self {
            Self::OpenAi(client) => client.transcribe(request).await,
            Self::GenAi(client) => client.transcribe(request).await,
        }
    }
}

pub(crate) struct GenAiAudioTranscriptionClient {
    client: Arc<dyn GenAIClient>,
    reasoning_effort: ReasoningEffort,
}

impl GenAiAudioTranscriptionClient {
    fn new(client: Arc<dyn GenAIClient>, config: &ChatProviderConfig) -> Self {
        Self {
            client,
            reasoning_effort: audio_transcription_reasoning_effort(
                &config.provider_kind,
                &config.model_name,
            ),
        }
    }
}

#[async_trait]
impl AudioTranscriber for GenAiAudioTranscriptionClient {
    async fn transcribe(&self, request: AudioTranscriptionRequest) -> Result<String, Report> {
        let b64_audio = STANDARD.encode(request.audio_bytes);
        let user_content = MessageContent::from_parts(vec![
            GenAiContentPart::Text(TRANSCRIPTION_PROMPT.to_string()),
            GenAiContentPart::from_binary_base64(
                "audio/wav",
                Arc::from(b64_audio.as_str()),
                Some(request.filename),
            ),
        ]);
        let chat_request = ChatRequest::new(vec![GenAiChatMessage::user(user_content)])
            .with_system("You are a strict audio transcription engine.");
        let chat_options = ChatOptions::default()
            .with_capture_content(true)
            .with_capture_raw_body(true)
            .with_temperature(0.0)
            .with_reasoning_effort(self.reasoning_effort.clone())
            .with_max_tokens(request.max_output_tokens);
        let response = match self
            .client
            .exec_chat("PLACEHOLDER_MODEL", chat_request, Some(&chat_options))
            .await
        {
            Ok(response) => response,
            Err(genai::Error::ChatResponseGeneration {
                model_iden,
                response_body,
                cause,
                ..
            }) => {
                // The default rendering of this error embeds the whole request payload,
                // including the base64 audio. Log the provider's raw response and the cause
                // on their own; only the classification travels to the client.
                let provider_error =
                    AudioTranscriptionProviderError::from_response_body(&response_body);
                warn!(
                    model = %model_iden,
                    error_code = provider_error.code.as_str(),
                    cause = %cause,
                    response_body = %response_body,
                    "Audio transcription provider returned an unusable response"
                );
                return Err(Report::new(provider_error));
            }
            Err(error) => {
                warn!(
                    error = %error,
                    "Audio transcription provider call failed"
                );
                return Err(Report::new(AudioTranscriptionProviderError {
                    code: AudioTranscriptionErrorCode::ProviderError,
                    block_reason: None,
                }));
            }
        };
        let transcript = response.first_text().unwrap_or_default().trim().to_string();
        Ok(transcript)
    }
}

/// Why a chunk could not be transcribed, in a form the client can translate and the
/// user can quote. The snake_case literals are part of the socket protocol.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AudioTranscriptionErrorCode {
    ProviderContentBlocked,
    ProviderError,
    TranscriptionFailed,
}

impl AudioTranscriptionErrorCode {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::ProviderContentBlocked => "provider_content_blocked",
            Self::ProviderError => "provider_error",
            Self::TranscriptionFailed => "transcription_failed",
        }
    }
}

/// Provider-side transcription failure. The raw response is logged where it is
/// classified; the Display text is the short, user-safe message sent to the client.
#[derive(Debug)]
pub(crate) struct AudioTranscriptionProviderError {
    pub(crate) code: AudioTranscriptionErrorCode,
    pub(crate) block_reason: Option<String>,
}

impl AudioTranscriptionProviderError {
    pub(crate) fn from_response_body(response_body: &serde_json::Value) -> Self {
        let block_reason = response_body
            .pointer("/promptFeedback/blockReason")
            .and_then(|value| value.as_str())
            .map(str::to_string);
        Self {
            code: if block_reason.is_some() {
                AudioTranscriptionErrorCode::ProviderContentBlocked
            } else {
                AudioTranscriptionErrorCode::ProviderError
            },
            block_reason,
        }
    }
}

impl std::fmt::Display for AudioTranscriptionProviderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match (self.code, self.block_reason.as_deref()) {
            (AudioTranscriptionErrorCode::ProviderContentBlocked, Some(reason)) => write!(
                f,
                "The AI provider's content filter blocked this passage (reason: {reason})"
            ),
            (AudioTranscriptionErrorCode::ProviderContentBlocked, None) => {
                write!(f, "The AI provider's content filter blocked this passage")
            }
            _ => write!(f, "The AI provider could not transcribe this passage"),
        }
    }
}

impl std::error::Error for AudioTranscriptionProviderError {}

fn audio_transcription_reasoning_effort(provider_kind: &str, model_name: &str) -> ReasoningEffort {
    if !matches!(provider_kind, "gemini" | "vertex_ai") {
        return ReasoningEffort::Zero;
    }

    // Gemini 3 cannot disable thinking. Low maps to thinkingLevel=LOW in the
    // Gemini adapter, whereas Budget(0) sends an unsupported zero thinkingBudget.
    // Accept resource-qualified model names used by Vertex AI as well.
    if model_name
        .rsplit('/')
        .next()
        .unwrap_or(model_name)
        .starts_with("gemini-3")
    {
        ReasoningEffort::Low
    } else {
        // Preserve the existing extraction behavior for earlier Gemini models.
        ReasoningEffort::Budget(0)
    }
}

pub(crate) struct OpenAiAudioTranscriptionClient {
    client: reqwest::Client,
    endpoint: Url,
    model: String,
}

#[derive(Deserialize)]
struct TranscriptionResponse {
    text: String,
}

impl OpenAiAudioTranscriptionClient {
    pub(crate) fn new(
        config: &ChatProviderConfig,
        headers_context: Option<&ChatProviderHeadersContext<'_>>,
    ) -> Result<Self, Report> {
        let mut endpoint = Url::parse(
            config
                .base_url
                .as_deref()
                .unwrap_or("https://api.openai.com/v1/"),
        )
        .wrap_err("Invalid audio transcription base URL")?;
        let path = format!(
            "{}/audio/transcriptions",
            endpoint.path().trim_end_matches('/')
        );
        endpoint.set_path(&path);
        let parameters = config.additional_request_parameters_map();
        if !parameters.is_empty() {
            endpoint.query_pairs_mut().extend_pairs(parameters);
        }

        let mut headers = AppState::build_request_headers(config, headers_context)?;
        if let Some(api_key) = &config.api_key
            && !headers.contains_key(reqwest::header::AUTHORIZATION)
        {
            let mut authorization = reqwest::header::HeaderValue::from_str(&format!(
                "Bearer {}",
                api_key.expose_secret()
            ))?;
            authorization.set_sensitive(true);
            headers
                .entry(reqwest::header::AUTHORIZATION)
                .or_insert(authorization);
        }
        let client = reqwest::Client::builder()
            .default_headers(headers)
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(120))
            .build()?;
        Ok(Self {
            client,
            endpoint,
            model: config.model_name.clone(),
        })
    }

    /// The audio workflows supply standalone canonical WAV chunks. JSON output
    /// works with both Whisper-compatible servers and OpenAI transcription models.
    async fn send_transcription(
        &self,
        audio_bytes: Vec<u8>,
        filename: String,
    ) -> Result<String, Report> {
        let file = Part::bytes(audio_bytes)
            .file_name(filename)
            .mime_str("audio/wav")?;
        let form = Form::new()
            .part("file", file)
            .text("model", self.model.clone())
            .text("response_format", "json");
        let response = self
            .client
            .post(self.endpoint.clone())
            .multipart(form)
            .send()
            .await
            .wrap_err("Audio transcription request failed")?;
        if !response.status().is_success() {
            // Provider bodies can contain request contents; keep them out of
            // errors that are logged or passed back through the socket protocol.
            return Err(eyre::eyre!(
                "Audio transcription provider returned HTTP {}",
                response.status()
            ));
        }
        let body = response
            .bytes()
            .await
            .wrap_err("Reading audio transcription response failed")?;
        let response: TranscriptionResponse =
            serde_json::from_slice(&body).wrap_err("Invalid audio transcription JSON response")?;
        Ok(response.text)
    }
}

#[async_trait]
impl AudioTranscriber for OpenAiAudioTranscriptionClient {
    async fn transcribe(&self, request: AudioTranscriptionRequest) -> Result<String, Report> {
        self.send_transcription(request.audio_bytes, request.filename)
            .await
            .map_err(|error| {
                warn!(%error, "Audio transcription provider call failed");
                Report::new(AudioTranscriptionProviderError {
                    code: AudioTranscriptionErrorCode::ProviderError,
                    block_reason: None,
                })
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::genai::GenAIChatStreamResponse;
    use axum::extract::{OriginalUri, State};
    use axum::http::{HeaderMap, StatusCode};
    use axum::{Router, routing::post};
    use axum_extra::extract::Multipart;
    use genai::chat::{BinarySource, ChatResponse};
    use std::sync::Mutex;
    use tokio::sync::mpsc;

    #[derive(Default)]
    struct RecordingGenAiClient {
        request: Mutex<Option<(ChatRequest, ChatOptions)>>,
        fail: bool,
    }

    #[async_trait]
    impl GenAIClient for RecordingGenAiClient {
        async fn exec_chat(
            &self,
            model: &str,
            request: ChatRequest,
            options: Option<&ChatOptions>,
        ) -> genai::Result<ChatResponse> {
            assert_eq!(model, "PLACEHOLDER_MODEL");
            *self.request.lock().unwrap() = Some((request, options.unwrap().clone()));
            if self.fail {
                return Err(genai::Error::Internal("forced provider failure".into()));
            }
            let model_iden =
                genai::ModelIden::new(genai::adapter::AdapterKind::Gemini, "test-model");
            Ok(ChatResponse {
                content: MessageContent::from_text("recognized speech"),
                reasoning_content: None,
                model_iden: model_iden.clone(),
                provider_model_iden: model_iden,
                stop_reason: None,
                usage: Default::default(),
                captured_raw_body: None,
                response_id: None,
            })
        }

        async fn exec_chat_stream(
            &self,
            _model: &str,
            _request: ChatRequest,
            _options: Option<&ChatOptions>,
        ) -> genai::Result<GenAIChatStreamResponse> {
            panic!("Transcription must use the non-streaming chat API")
        }
    }

    #[tokio::test]
    async fn genai_enum_variant_preserves_audio_prompt_and_generation_options() {
        let recording = Arc::new(RecordingGenAiClient::default());
        let config = ChatProviderConfig {
            provider_kind: "gemini".into(),
            model_name: "gemini-3-flash-preview".into(),
            ..Default::default()
        };
        let client = AudioTranscriptionClient::GenAi(GenAiAudioTranscriptionClient::new(
            recording.clone(),
            &config,
        ));
        let audio = vec![0, 1, 2, 255];
        assert_eq!(
            client
                .transcribe(request(audio.clone(), "chunk.wav"))
                .await
                .unwrap(),
            "recognized speech"
        );
        let (request, options) = recording.request.lock().unwrap().take().unwrap();
        assert_eq!(
            request.system.as_deref(),
            Some("You are a strict audio transcription engine.")
        );
        assert_eq!(request.messages.len(), 1);
        let parts = request.messages[0].content.parts();
        assert_eq!(parts.len(), 2);
        assert!(
            matches!(&parts[0], GenAiContentPart::Text(text) if text.contains("verbatim") && text.contains("Return only spoken words"))
        );
        let GenAiContentPart::Binary(binary) = &parts[1] else {
            panic!("Expected a binary audio part")
        };
        assert_eq!(binary.content_type, "audio/wav");
        assert_eq!(binary.name.as_deref(), Some("chunk.wav"));
        let BinarySource::Base64(encoded) = &binary.source else {
            panic!("Expected base64 audio")
        };
        assert_eq!(STANDARD.decode(encoded.as_bytes()).unwrap(), audio);
        assert_eq!(options.max_tokens, Some(512));
        assert_eq!(options.temperature, Some(0.0));
        assert!(matches!(
            options.reasoning_effort,
            Some(ReasoningEffort::Low)
        ));
        assert_eq!(options.capture_content, Some(true));
        assert_eq!(options.capture_raw_body, Some(true));
    }

    #[tokio::test]
    async fn genai_enum_variant_returns_classified_provider_failures() {
        let recording = Arc::new(RecordingGenAiClient {
            fail: true,
            ..Default::default()
        });
        let client = AudioTranscriptionClient::GenAi(GenAiAudioTranscriptionClient::new(
            recording,
            &ChatProviderConfig::default(),
        ));
        let error = client
            .transcribe(request(vec![0], "chunk.wav"))
            .await
            .unwrap_err();
        assert_eq!(
            error
                .downcast_ref::<AudioTranscriptionProviderError>()
                .unwrap()
                .code,
            AudioTranscriptionErrorCode::ProviderError
        );
        assert!(!error.to_string().contains("forced provider failure"));
    }

    #[tokio::test]
    async fn openai_enum_variant_returns_classified_provider_failures() {
        let (base_url, mut requests, server) =
            mock_server(StatusCode::TOO_MANY_REQUESTS, "sensitive provider error").await;
        let client = AudioTranscriptionClient::OpenAi(
            OpenAiAudioTranscriptionClient::new(&config(base_url), None).unwrap(),
        );
        let error = client
            .transcribe(request(vec![0], "chunk.wav"))
            .await
            .unwrap_err();
        assert_eq!(
            error
                .downcast_ref::<AudioTranscriptionProviderError>()
                .unwrap()
                .code,
            AudioTranscriptionErrorCode::ProviderError
        );
        assert!(!error.to_string().contains("sensitive provider error"));
        requests.recv().await.unwrap();
        server.abort();
    }

    #[test]
    fn gemini_3_audio_uses_a_supported_thinking_level() {
        for provider_kind in ["gemini", "vertex_ai"] {
            for model_name in [
                "gemini-3.8-flash",
                "gemini-3-flash-preview",
                "publishers/google/models/gemini-3.8-flash",
            ] {
                assert!(matches!(
                    audio_transcription_reasoning_effort(provider_kind, model_name),
                    ReasoningEffort::Low
                ));
            }
        }
    }

    #[test]
    fn audio_thinking_preserves_other_provider_behavior() {
        assert!(matches!(
            audio_transcription_reasoning_effort("gemini", "gemini-2.5-flash"),
            ReasoningEffort::Budget(0)
        ));
        assert!(matches!(
            audio_transcription_reasoning_effort("vertex_ai", "gemini-2.5-flash"),
            ReasoningEffort::Budget(0)
        ));
        assert!(matches!(
            audio_transcription_reasoning_effort("openai", "gpt-4o-audio-preview"),
            ReasoningEffort::Zero
        ));
    }

    #[derive(Debug)]
    struct RecordedField {
        name: String,
        filename: Option<String>,
        content_type: Option<String>,
        bytes: Vec<u8>,
    }

    #[derive(Debug)]
    struct RecordedRequest {
        headers: HeaderMap,
        uri: axum::http::Uri,
        fields: Vec<RecordedField>,
    }

    async fn mock_server(
        status: StatusCode,
        body: &'static str,
    ) -> (
        String,
        mpsc::Receiver<RecordedRequest>,
        tokio::task::JoinHandle<()>,
    ) {
        let (sender, receiver) = mpsc::channel(1);
        let app = Router::new()
            .route(
                "/provider/v1/audio/transcriptions",
                post(
                    move |State(sender): State<mpsc::Sender<RecordedRequest>>,
                          OriginalUri(uri): OriginalUri,
                          headers: HeaderMap,
                          mut multipart: Multipart| async move {
                        let mut fields = Vec::new();
                        while let Some(field) = multipart.next_field().await.unwrap() {
                            let name = field.name().unwrap().to_string();
                            let filename = field.file_name().map(str::to_string);
                            let content_type = field.content_type().map(str::to_string);
                            let bytes = field.bytes().await.unwrap().to_vec();
                            fields.push(RecordedField {
                                name,
                                filename,
                                content_type,
                                bytes,
                            });
                        }
                        sender
                            .send(RecordedRequest {
                                headers,
                                uri,
                                fields,
                            })
                            .await
                            .unwrap();
                        (
                            status,
                            [(reqwest::header::CONTENT_TYPE, "application/json")],
                            body,
                        )
                    },
                ),
            )
            .with_state(sender);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (format!("http://{addr}/provider/v1"), receiver, task)
    }

    fn request(audio_bytes: Vec<u8>, filename: &str) -> AudioTranscriptionRequest {
        AudioTranscriptionRequest {
            audio_bytes,
            filename: filename.into(),
            max_output_tokens: 512,
        }
    }

    fn config(base_url: String) -> ChatProviderConfig {
        ChatProviderConfig {
            provider_kind: "openai_audio_transcriptions".into(),
            model_name: "whisper-1".into(),
            base_url: Some(base_url),
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn uploads_wav_with_provider_auth_headers_and_query_parameters() {
        let (base_url, mut requests, server) = mock_server(
            StatusCode::OK,
            r#"{"text":"Hello world","usage":{"seconds":1}}"#,
        )
        .await;
        let mut config = config(format!("{base_url}/?existing=kept"));
        config.api_key = Some("test-key".into());
        config.additional_request_parameters =
            Some(vec!["api-version=2026-01-01".into(), "tenant=a&b=c".into()]);
        config.additional_request_headers = Some(vec![
            "X-User={{erato_user.id}}".into(),
            "X-Tenant={{id_token.claims.tenant}}".into(),
        ]);
        let claims = serde_json::json!({ "tenant": "tenant-123" });
        let context = ChatProviderHeadersContext::new("user-123", &claims);
        let client = AudioTranscriptionClient::OpenAi(
            OpenAiAudioTranscriptionClient::new(&config, Some(&context)).unwrap(),
        );
        let audio = b"RIFF\0\xffWAVE test audio".to_vec();
        assert_eq!(
            client
                .transcribe(request(audio.clone(), "audio-chunk-2.wav"))
                .await
                .unwrap(),
            "Hello world"
        );
        let request = requests.recv().await.unwrap();
        assert_eq!(request.headers["authorization"], "Bearer test-key");
        assert_eq!(request.headers["x-user"], "user-123");
        assert_eq!(request.headers["x-tenant"], "tenant-123");
        assert!(
            request.headers["content-type"]
                .to_str()
                .unwrap()
                .starts_with("multipart/form-data; boundary=")
        );
        let url = Url::parse(&format!("http://localhost{}", request.uri)).unwrap();
        let query: std::collections::HashMap<_, _> = url.query_pairs().collect();
        assert_eq!(query["existing"], "kept");
        assert_eq!(query["api-version"], "2026-01-01");
        assert_eq!(query["tenant"], "a&b=c");
        assert_eq!(request.fields.len(), 3);
        let file = request
            .fields
            .iter()
            .find(|field| field.name == "file")
            .unwrap();
        assert_eq!(file.bytes, audio);
        assert_eq!(file.filename.as_deref(), Some("audio-chunk-2.wav"));
        assert_eq!(file.content_type.as_deref(), Some("audio/wav"));
        for (name, expected) in [("model", "whisper-1"), ("response_format", "json")] {
            let field = request
                .fields
                .iter()
                .find(|field| field.name == name)
                .unwrap();
            assert_eq!(field.bytes, expected.as_bytes());
        }
        server.abort();
    }

    #[tokio::test]
    async fn custom_authorization_overrides_api_key() {
        let (base_url, mut requests, server) = mock_server(StatusCode::OK, r#"{"text":""}"#).await;
        let mut config = config(base_url);
        config.api_key = Some("unused-key".into());
        config.additional_request_headers = Some(vec!["Authorization=Bearer custom-token".into()]);
        let client = AudioTranscriptionClient::OpenAi(
            OpenAiAudioTranscriptionClient::new(&config, None).unwrap(),
        );
        assert_eq!(
            client
                .transcribe(request(vec![0], "silence.wav"))
                .await
                .unwrap(),
            ""
        );
        assert_eq!(
            requests.recv().await.unwrap().headers["authorization"],
            "Bearer custom-token"
        );
        server.abort();
    }

    #[tokio::test]
    async fn rejects_http_errors_and_invalid_responses() {
        for (status, body) in [
            (
                StatusCode::UNAUTHORIZED,
                r#"{"error":{"message":"sensitive provider error"}}"#,
            ),
            (StatusCode::TOO_MANY_REQUESTS, "sensitive provider error"),
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "sensitive provider error",
            ),
            (StatusCode::OK, r#"{"error":"sensitive provider error"}"#),
            (StatusCode::OK, r#"{"text":null}"#),
            (StatusCode::OK, "invalid json"),
        ] {
            let (base_url, mut requests, server) = mock_server(status, body).await;
            let client = OpenAiAudioTranscriptionClient::new(&config(base_url), None).unwrap();
            let error = client
                .send_transcription(vec![0], "audio.wav".into())
                .await
                .unwrap_err();
            let message = format!("{error:?}");
            assert!(!message.contains("sensitive provider error"));
            if !status.is_success() {
                assert!(message.contains(&status.as_u16().to_string()));
            }
            assert!(
                !requests
                    .recv()
                    .await
                    .unwrap()
                    .headers
                    .contains_key("authorization")
            );
            server.abort();
        }
    }

    #[test]
    fn defaults_to_openai_and_rejects_invalid_configuration() {
        let config = ChatProviderConfig {
            model_name: "whisper-1".into(),
            ..Default::default()
        };
        let client = OpenAiAudioTranscriptionClient::new(&config, None).unwrap();
        assert_eq!(
            client.endpoint.as_str(),
            "https://api.openai.com/v1/audio/transcriptions"
        );
        let invalid = ChatProviderConfig {
            base_url: Some("not a url".into()),
            ..config.clone()
        };
        assert!(OpenAiAudioTranscriptionClient::new(&invalid, None).is_err());
        let invalid = ChatProviderConfig {
            additional_request_headers: Some(vec!["Invalid Header=value".into()]),
            ..config
        };
        assert!(OpenAiAudioTranscriptionClient::new(&invalid, None).is_err());
    }
}
