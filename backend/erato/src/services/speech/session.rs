use super::{provider, sentences::Sentences, wav};
use crate::policy::prelude::*;
use crate::{
    config::SpeechProviderConfig,
    models::message::{ContentPart, ContentPartAudioFilePointer},
    policy::{engine::PolicyEngine, types::Subject},
    services::background_tasks::{StreamingEvent, StreamingTask},
    state::AppState,
};
use axum::response::sse::Event;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use eyre::{Report, eyre};
use futures::StreamExt;
use sea_orm::{ActiveModelTrait, ActiveValue, TransactionTrait};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::mpsc;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct AudioSynthesisMetadata {
    pub input_text: String,
    pub segments: Vec<String>,
    pub provider_id: String,
    pub model: String,
    pub voice: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub encoding: String,
}

type SynthesizedResponse = (Vec<u8>, Vec<String>, u32);

// Gather a useful initial passage without waiting indefinitely for more text.
// Subsequent calls drain sentences accumulated during synthesis, up to the input cap.
async fn next_passage(
    receiver: &mut mpsc::UnboundedReceiver<String>,
    pending: &mut Option<String>,
) -> Option<String> {
    const MIN_CHARS: usize = 160;
    const MAX_CHARS: usize = 2000;
    let mut text = match pending.take() {
        Some(text) => text,
        None => receiver.recv().await?,
    };
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_millis(250);
    let mut length = text.chars().count();
    loop {
        let next = match receiver.try_recv() {
            Ok(next) => Some(next),
            Err(mpsc::error::TryRecvError::Disconnected) => None,
            Err(mpsc::error::TryRecvError::Empty) if length < MIN_CHARS => {
                tokio::time::timeout_at(deadline, receiver.recv())
                    .await
                    .ok()
                    .flatten()
            }
            Err(mpsc::error::TryRecvError::Empty) => None,
        };
        let Some(next) = next else { break };
        let next_length = next.chars().count();
        if length + next_length > MAX_CHARS {
            *pending = Some(next);
            break;
        }
        text.push_str(&next);
        length += next_length;
    }
    Some(text)
}

pub struct SpeechSession {
    sentences: Sentences,
    sender: Option<mpsc::UnboundedSender<String>>,
    worker: tokio::task::JoinHandle<Result<SynthesizedResponse, Report>>,
    config: SpeechProviderConfig,
    provider_id: String,
    input_bytes: usize,
    input_limit_exceeded: bool,
    task: Arc<StreamingTask>,
}
impl Drop for SpeechSession {
    fn drop(&mut self) {
        self.worker.abort();
    }
}
impl SpeechSession {
    pub fn start(
        config: SpeechProviderConfig,
        provider_id: String,
        task: Arc<StreamingTask>,
        tx: mpsc::Sender<Result<Event, Report>>,
        message_id: Uuid,
    ) -> Self {
        let (sender, mut receiver) = mpsc::unbounded_channel::<String>();
        let settings = config.clone();
        let worker_task = task.clone();
        let worker = tokio::spawn(async move {
            let task = worker_task;
            let provider = provider(&settings)?;
            let mut pcm = Vec::new();
            let mut segments = Vec::new();
            let mut rate = 0;
            let mut sequence = 0;
            let mut pending = None;
            let run = async {
                while let Some(text) = next_passage(&mut receiver, &mut pending).await {
                    let text = super::sentences::speakable(&text);
                    if text.trim().is_empty() {
                        continue;
                    }
                    let mut audio = provider.stream(&text).await?;
                    if rate != 0 && rate != audio.sample_rate {
                        return Err(eyre!("Speech sample rate changed between sentences"));
                    }
                    rate = audio.sample_rate;
                    segments.push(text);
                    let before = pcm.len();
                    let mut carry = Vec::new();
                    while let Some(chunk) = audio.chunks.next().await {
                        carry.extend(chunk?);
                        let length = carry.len() / 2 * 2;
                        if length == 0 {
                            continue;
                        }
                        let bytes: Vec<_> = carry.drain(..length).collect();
                        if pcm.len() + bytes.len() > 64 * 1024 * 1024 {
                            return Err(eyre!("Speech response exceeds 64 MiB"));
                        }
                        pcm.extend(&bytes);
                        let event = StreamingEvent::AudioDelta {
                            message_id,
                            sequence,
                            audio: STANDARD.encode(&bytes),
                            sample_rate: rate,
                        };
                        let json = serde_json::to_string(&event)?;
                        task.send_event(event).await.map_err(Report::msg)?;
                        let _ = tx
                            .send(Ok(Event::default().event("audio_delta").data(json)))
                            .await;
                        sequence += 1;
                    }
                    if !carry.is_empty() || pcm.len() == before {
                        return Err(eyre!("Incomplete or empty speech response"));
                    }
                }
                provider.finish().await?;
                Ok((pcm, segments, rate))
            };
            tokio::select! {
                result = run => result,
                _ = task.wait_for_abort() => Err(eyre!("Speech cancelled")),
            }
        });
        Self {
            sentences: Sentences::default(),
            sender: Some(sender),
            worker,
            config,
            provider_id,
            input_bytes: 0,
            input_limit_exceeded: false,
            task,
        }
    }
    // Never await speech capacity on the LLM text-stream path. Bound total input
    // instead: on overflow disable audio for this response, preserving its text.
    pub fn push(&mut self, text: &str) {
        const MAX_INPUT_BYTES: usize = 1024 * 1024;
        self.input_bytes = self.input_bytes.saturating_add(text.len());
        if self.input_bytes > MAX_INPUT_BYTES {
            self.input_limit_exceeded = true;
            self.sender.take();
            self.worker.abort();
            return;
        }
        for sentence in self.sentences.push(text) {
            if let Some(sender) = &self.sender {
                let _ = sender.send(sentence);
            }
        }
    }
    pub async fn finish(
        mut self,
        app: &AppState,
        policy: &PolicyEngine,
        subject: &Subject,
        chat_id: Uuid,
        message_id: Uuid,
    ) -> Result<Option<ContentPart>, Report> {
        if self.input_limit_exceeded {
            return Err(eyre!("Speech input exceeds 1 MiB"));
        }
        if let Some(tail) = self.sentences.finish()
            && let Some(sender) = &self.sender
        {
            let _ = sender.send(tail);
        }
        self.sender.take();
        let (pcm, segments, sample_rate) = (&mut self.worker).await??;
        if self.task.is_abort_requested() {
            return Err(eyre!("Speech cancelled"));
        }
        if pcm.is_empty() {
            return Ok(None);
        }
        let data = wav(&pcm, sample_rate)?;
        let metadata = AudioSynthesisMetadata {
            input_text: segments.concat(),
            segments,
            provider_id: self.provider_id.clone(),
            model: self.config.model_name.clone(),
            voice: self.config.voice.clone(),
            sample_rate,
            channels: 1,
            encoding: "pcm_s16le".into(),
        };
        let path = format!("speech/{chat_id}/{message_id}.wav");
        let storage = app.default_file_storage_provider();
        authorize!(
            policy,
            subject,
            &Resource::Chat(chat_id.to_string()),
            Action::Update
        )?;
        let result = async {
            let mut writer = storage.upload_file_writer(&path, Some("audio/wav")).await?;
            writer.write(data).await?;
            writer.close().await?;
            if self.task.is_abort_requested() {
                return Err(eyre!("Speech cancelled"));
            }
            let transaction = app.db.begin().await?;
            let file = crate::models::file_upload::create_file_upload_record(
                &transaction,
                Uuid::new_v4(),
                subject.user_id().to_string(),
                &chat_id,
                format!("speech-{message_id}.wav"),
                app.default_file_storage_provider_id(),
                path.clone(),
                None,
                None,
            )
            .await?;
            crate::db::entity::file_uploads::ActiveModel {
                id: ActiveValue::Set(file.id),
                audio_synthesis: ActiveValue::Set(Some(serde_json::to_value(metadata)?)),
                ..Default::default()
            }
            .update(&transaction)
            .await?;
            if self.task.is_abort_requested() {
                return Err(eyre!("Speech cancelled"));
            }
            transaction.commit().await?;
            Ok::<_, Report>(Some(ContentPart::AudioFilePointer(
                ContentPartAudioFilePointer {
                    file_upload_id: file.id,
                    download_url: None,
                },
            )))
        }
        .await;
        if result.is_err()
            && let Err(error) = storage.delete_generated_file(&path).await
        {
            tracing::warn!(%error, "Failed to clean up speech file");
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::background_tasks::BackgroundTaskManager;
    use axum::{Router, body::Body, response::Response, routing::post};

    #[tokio::test]
    async fn augsburg_capture_streams_all_text_before_slow_speech_and_preserves_replay_pcm() {
        use axum::routing::get;
        let fixture = mock_llm_server::endpoints::augsburg::capture();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            axum::serve(
                listener,
                Router::new().route(
                    "/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent",
                    get(mock_llm_server::endpoints::augsburg::live),
                ),
            )
            .await
            .unwrap();
        });
        let manager = BackgroundTaskManager::new(None, Default::default(), None);
        let message_id = Uuid::new_v4();
        let (_, task) = manager.start_task(Uuid::new_v4(), message_id).await;
        let (tx, mut rx) = mpsc::channel(16);
        let mut session = SpeechSession::start(
            super::super::gemini_live::tests::config(url),
            "mock".into(),
            task,
            tx,
            message_id,
        );
        for event in fixture
            .events
            .iter()
            .filter(|event| event.event == "text_delta")
        {
            session.push(event.data["new_text"].as_str().unwrap());
            tokio::time::sleep(std::time::Duration::from_millis(40)).await;
        }
        // The provider deliberately waits 5 seconds before its first audio.
        // Text delivery must already be complete, even with >8 pending sentences.
        assert!(matches!(
            rx.try_recv(),
            Err(mpsc::error::TryRecvError::Empty)
        ));
        let drain = tokio::spawn(async move {
            let mut count = 0;
            while rx.recv().await.is_some() {
                count += 1;
            }
            count
        });
        if let Some(tail) = session.sentences.finish() {
            session.sender.as_ref().unwrap().send(tail).unwrap();
        }
        session.sender.take();
        let (pcm, _, rate) =
            tokio::time::timeout(std::time::Duration::from_secs(45), &mut session.worker)
                .await
                .unwrap()
                .unwrap()
                .unwrap();
        assert_eq!(rate, 24000);
        assert_eq!(pcm, fixture.pcm);
        assert_eq!(drain.await.unwrap(), 1372);
        assert_eq!(&wav(&pcm, rate).unwrap()[44..], fixture.pcm);
        server.abort();
    }

    #[tokio::test]
    async fn stalled_speech_does_not_backpressure_text_and_input_is_bounded() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let entered = Arc::new(tokio::sync::Notify::new());
        let notify = entered.clone();
        let server = tokio::spawn(async move {
            axum::serve(
                listener,
                Router::new().route(
                    "/audio/speech",
                    post(move || {
                        let notify = notify.clone();
                        async move {
                            notify.notify_one();
                            std::future::pending::<Response>().await
                        }
                    }),
                ),
            )
            .await
            .unwrap();
        });
        let config = serde_json::from_value(serde_json::json!({
            "provider_kind":"audio_cpp", "model_name":"mock", "voice":"mock", "base_url":format!("http://{address}")
        })).unwrap();
        let manager = BackgroundTaskManager::new(None, Default::default(), None);
        let message_id = Uuid::new_v4();
        let (_, task) = manager.start_task(Uuid::new_v4(), message_id).await;
        let (tx, _rx) = mpsc::channel(8);
        let mut session = SpeechSession::start(config, "mock".into(), task, tx, message_id);
        session.push("The first sentence. More text ");
        tokio::time::timeout(std::time::Duration::from_secs(3), entered.notified())
            .await
            .unwrap();
        // More than the former eight queued sentences, with the provider still stalled.
        for _ in 0..100 {
            session.push("Another complete sentence. ");
        }
        assert!(!session.worker.is_finished());
        assert!(!session.input_limit_exceeded);
        session.push(&"x".repeat(1024 * 1024));
        assert!(session.input_limit_exceeded);
        assert!(session.sender.is_none());
        assert!((&mut session.worker).await.unwrap_err().is_cancelled());
        server.abort();
    }

    #[tokio::test]
    async fn passages_merge_queued_text_and_preserve_overflow_and_tail() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        tx.send("Hello. ".into()).unwrap();
        tx.send("More context. ".into()).unwrap();
        tx.send("x".repeat(1990)).unwrap();
        tx.send("Final tail".into()).unwrap();
        drop(tx);
        let mut pending = None;
        assert_eq!(
            next_passage(&mut rx, &mut pending).await.unwrap(),
            "Hello. More context. "
        );
        assert_eq!(
            next_passage(&mut rx, &mut pending).await.unwrap(),
            "x".repeat(1990) + "Final tail"
        );
        assert!(next_passage(&mut rx, &mut pending).await.is_none());
    }

    #[tokio::test]
    async fn short_passage_flushes_while_text_channel_remains_open() {
        let (_tx, mut rx) = mpsc::unbounded_channel();
        let mut pending = Some("Short sentence.".into());
        let passage = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            next_passage(&mut rx, &mut pending),
        )
        .await
        .unwrap();
        assert_eq!(passage.as_deref(), Some("Short sentence."));
    }

    #[tokio::test]
    async fn gemini_live_sentence_audio_is_collected_for_replay() {
        let (url, _, server) = super::super::gemini_live::tests::mock("complete", "Hello. ").await;
        let config = super::super::gemini_live::tests::config(url);
        let manager = BackgroundTaskManager::new(None, Default::default(), None);
        let message_id = Uuid::new_v4();
        let (mut events, task) = manager.start_task(Uuid::new_v4(), message_id).await;
        let (tx, _rx) = mpsc::channel(8);
        let mut session = SpeechSession::start(config, "live".into(), task, tx, message_id);
        session.push("Hello.");
        if let Some(tail) = session.sentences.finish() {
            session.sender.as_ref().unwrap().send(tail).unwrap();
        }
        session.sender.take();
        let (pcm, segments, rate) = (&mut session.worker).await.unwrap().unwrap();
        assert_eq!(segments, ["Hello. "]);
        assert_eq!(rate, 24000);
        assert_eq!(&wav(&pcm, rate).unwrap()[44..], &[1, 2, 3, 4]);
        assert!(matches!(
            events.recv().await,
            Ok(StreamingEvent::AudioDelta { .. })
        ));
        server.abort();
    }

    #[tokio::test]
    async fn emits_audio_before_text_finishes_and_aborts_without_finalizing() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(
                listener,
                Router::new().route(
                    "/audio/speech",
                    post(|| async {
                        Response::builder()
                            .header("content-type", "audio/pcm")
                            .body(Body::from(vec![1, 2, 3, 4]))
                            .unwrap()
                    }),
                ),
            )
            .await
            .unwrap();
        });
        let config: SpeechProviderConfig = serde_json::from_value(serde_json::json!({
            "provider_kind":"audio_cpp", "model_name":"local", "voice":"voice", "base_url":format!("http://{address}")
        })).unwrap();
        let manager = BackgroundTaskManager::new(None, Default::default(), None);
        let message_id = Uuid::new_v4();
        let (mut events, task) = manager.start_task(Uuid::new_v4(), message_id).await;
        let (tx, _rx) = mpsc::channel(8);
        let mut session = SpeechSession::start(config, "test".into(), task.clone(), tx, message_id);
        session.push("First sentence. More text still arriving");
        let event = tokio::time::timeout(std::time::Duration::from_secs(3), events.recv())
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(
            event,
            StreamingEvent::AudioDelta { sequence: 0, .. }
        ));
        // The sender is still open: no full-text finish was required for the first audio.
        task.request_abort();
        assert!(
            tokio::time::timeout(std::time::Duration::from_secs(3), &mut session.worker)
                .await
                .unwrap()
                .unwrap()
                .is_err()
        );
        server.abort();
    }
}
