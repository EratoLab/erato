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

pub struct SpeechSession {
    sentences: Sentences,
    sender: Option<mpsc::Sender<String>>,
    worker: tokio::task::JoinHandle<Result<SynthesizedResponse, Report>>,
    config: SpeechProviderConfig,
    provider_id: String,
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
        let (sender, mut receiver) = mpsc::channel::<String>(8);
        let settings = config.clone();
        let worker_task = task.clone();
        let worker = tokio::spawn(async move {
            let task = worker_task;
            let provider = provider(&settings)?;
            let mut pcm = Vec::new();
            let mut segments = Vec::new();
            let mut rate = 0;
            let mut sequence = 0;
            let run = async {
                while let Some(text) = receiver.recv().await {
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
            task,
        }
    }
    pub async fn push(&mut self, text: &str) {
        for sentence in self.sentences.push(text) {
            if let Some(sender) = &self.sender {
                let _ = sender.send(sentence).await;
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
        if let Some(tail) = self.sentences.finish()
            && let Some(sender) = &self.sender
        {
            let _ = sender.send(tail).await;
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
    async fn gemini_live_sentence_audio_is_collected_for_replay() {
        let (url, _, server) = super::super::gemini_live::tests::mock("complete", "Hello. ").await;
        let config = super::super::gemini_live::tests::config(url);
        let manager = BackgroundTaskManager::new(None, Default::default(), None);
        let message_id = Uuid::new_v4();
        let (mut events, task) = manager.start_task(Uuid::new_v4(), message_id).await;
        let (tx, _rx) = mpsc::channel(8);
        let mut session = SpeechSession::start(config, "live".into(), task, tx, message_id);
        session.push("Hello.").await;
        if let Some(tail) = session.sentences.finish() {
            session.sender.as_ref().unwrap().send(tail).await.unwrap();
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
        session
            .push("First sentence. More text still arriving")
            .await;
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
