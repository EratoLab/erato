use crate::db::entity::file_uploads;
use crate::models;
use crate::models::file_upload::{
    AudioTranscriptSegment, AudioTranscriptionChunk, AudioTranscriptionMetadata,
};
use crate::policy::engine::PolicyEngine;
use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use crate::state::{AppState, ChatProviderConfigWithId};
use axum::Extension;
use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::IntoResponse;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use eyre::{OptionExt, Report, WrapErr};
use futures::{SinkExt, StreamExt};
use genai::chat::{
    ChatMessage as GenAiChatMessage, ChatOptions, ChatRequest, ContentPart as GenAiContentPart,
    MessageContent, ReasoningEffort,
};
use opendal::Writer;
use sea_orm::prelude::Uuid;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::ops::Range;
use std::sync::Arc;
use std::time::Duration;
use tokio::time::sleep;
use tracing::{debug, instrument, trace, warn};

const CANONICAL_AUDIO_CONTENT_TYPE: &str = "audio/wav";
const CANONICAL_SAMPLE_RATE_HZ: u32 = 16_000;
const CANONICAL_CHANNELS: u16 = 1;
const CANONICAL_BITS_PER_SAMPLE: u16 = 16;

#[derive(Debug, Clone, Copy)]
enum AudioFeature {
    Transcription,
    Dictation,
}

impl AudioFeature {
    fn config<'a>(&self, app_state: &'a AppState) -> &'a crate::config::AudioTranscriptionConfig {
        match self {
            Self::Transcription => &app_state.config.audio_transcription,
            Self::Dictation => &app_state.config.audio_dictation,
        }
    }

    fn config_key(&self) -> &'static str {
        match self {
            Self::Transcription => "audio_transcription",
            Self::Dictation => "audio_dictation",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientControlFrame {
    Start {
        chat_id: String,
        filename: Option<String>,
        content_type: Option<String>,
        chunk_duration_ms: Option<u64>,
    },
    Resume {
        file_upload_id: String,
    },
    RetryFailed {
        file_upload_id: Option<String>,
    },
    ChunkMetadata {
        chunk_index: usize,
        start_ms: u64,
        end_ms: u64,
        content_type: Option<String>,
    },
    Finish,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ServerControlFrame {
    SessionState {
        file_upload_id: String,
        status: String,
        next_chunk_index: usize,
        stored_offset: u64,
        chunk_duration_ms: u64,
        audio_transcription: AudioTranscriptionMetadata,
    },
    ChunkAck {
        file_upload_id: String,
        chunk_index: usize,
        byte_start: u64,
        byte_end: u64,
    },
    ChunkTranscribed {
        file_upload_id: String,
        chunk_index: usize,
        transcript: String,
        audio_transcription: AudioTranscriptionMetadata,
    },
    ChunkFailed {
        file_upload_id: String,
        chunk_index: usize,
        error: String,
        audio_transcription: AudioTranscriptionMetadata,
    },
    Completed {
        file_upload_id: String,
        transcript: String,
        audio_transcription: AudioTranscriptionMetadata,
    },
    Error {
        error: String,
    },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum DictationClientControlFrame {
    Start {
        chunk_duration_ms: Option<u64>,
    },
    ChunkMetadata {
        chunk_index: usize,
        start_ms: u64,
        end_ms: u64,
        content_type: Option<String>,
    },
    Finish,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum DictationServerControlFrame {
    SessionState {
        next_chunk_index: usize,
        chunk_duration_ms: u64,
    },
    ChunkAck {
        chunk_index: usize,
    },
    ChunkTranscribed {
        chunk_index: usize,
        transcript: String,
    },
    Completed,
    Error {
        error: String,
    },
}

#[derive(Debug, Clone)]
struct PendingChunk {
    chunk_index: usize,
    start_ms: u64,
    end_ms: u64,
    content_type: String,
}

struct AudioSession {
    file_upload: file_uploads::Model,
    metadata: AudioTranscriptionMetadata,
    chunk_duration_ms: u64,
    stored_offset: u64,
    storage_writer: Option<Writer>,
}

#[derive(Debug)]
struct ValidatedAudioChunk {
    provider_audio_bytes: Vec<u8>,
    append_bytes: Vec<u8>,
}

struct TranscribedChunk {
    transcript: String,
    attempts: usize,
}

#[instrument(skip_all)]
pub async fn audio_transcription_socket(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(app_state, me_user, policy, socket))
}

#[instrument(skip_all)]
pub async fn audio_dictation_socket(
    State(app_state): State<AppState>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_dictation_socket(app_state, socket))
}

async fn handle_socket(
    app_state: AppState,
    me_user: MeProfile,
    policy: PolicyEngine,
    socket: WebSocket,
) {
    let (mut sender, mut receiver) = socket.split();
    let mut session: Option<AudioSession> = None;
    let mut pending_chunk: Option<PendingChunk> = None;

    while let Some(message_result) = receiver.next().await {
        let message = match message_result {
            Ok(message) => message,
            Err(error) => {
                tracing::warn!(error = %error, "Audio transcription socket read failed");
                break;
            }
        };

        let response = match message {
            Message::Text(text) => match serde_json::from_str::<ClientControlFrame>(&text) {
                Ok(control_frame) => handle_control_frame(
                    &app_state,
                    &policy,
                    &me_user,
                    &mut session,
                    &mut pending_chunk,
                    control_frame,
                )
                .await
                .map(|frame| frame.into_iter().collect::<Vec<_>>()),
                Err(error) => Err(eyre::eyre!(
                    "Invalid audio transcription control frame: {}",
                    error
                )),
            },
            Message::Binary(bytes) => {
                handle_audio_bytes(&app_state, &mut session, &mut pending_chunk, bytes.to_vec())
                    .await
            }
            Message::Close(_) => break,
            Message::Ping(_) | Message::Pong(_) => Ok(Vec::new()),
        };

        match response {
            Ok(frames) => {
                for frame in frames {
                    if let Err(error) = send_frame(&mut sender, &frame).await {
                        tracing::warn!(error = %error, "Failed to write audio transcription socket frame");
                        break;
                    }
                }
            }
            Err(error) => {
                tracing::warn!(error = %error, "Audio transcription socket command failed");
                let frame = ServerControlFrame::Error {
                    error: error.to_string(),
                };
                if send_frame(&mut sender, &frame).await.is_err() {
                    break;
                }
            }
        }
    }
}

async fn send_frame(
    sender: &mut futures::stream::SplitSink<WebSocket, Message>,
    frame: &impl Serialize,
) -> Result<(), Report> {
    let text = serde_json::to_string(frame)?;
    sender.send(Message::Text(text.into())).await?;
    Ok(())
}

async fn handle_dictation_socket(app_state: AppState, socket: WebSocket) {
    let (mut sender, mut receiver) = socket.split();
    let mut chunk_duration_ms: Option<u64> = None;
    let mut next_chunk_index = 0usize;
    let mut pending_chunk: Option<PendingChunk> = None;

    while let Some(message_result) = receiver.next().await {
        let message = match message_result {
            Ok(message) => message,
            Err(error) => {
                tracing::warn!(error = %error, "Audio dictation socket read failed");
                break;
            }
        };

        let response = match message {
            Message::Text(text) => match serde_json::from_str::<DictationClientControlFrame>(&text)
            {
                Ok(control_frame) => handle_dictation_control_frame(
                    &app_state,
                    &mut chunk_duration_ms,
                    &mut next_chunk_index,
                    &mut pending_chunk,
                    control_frame,
                )
                .await
                .map(|frame| frame.into_iter().collect::<Vec<_>>()),
                Err(error) => Err(eyre::eyre!(
                    "Invalid audio dictation control frame: {}",
                    error
                )),
            },
            Message::Binary(bytes) => {
                handle_dictation_audio_bytes(
                    &app_state,
                    chunk_duration_ms,
                    &mut next_chunk_index,
                    &mut pending_chunk,
                    bytes.to_vec(),
                )
                .await
            }
            Message::Close(_) => break,
            Message::Ping(_) | Message::Pong(_) => Ok(Vec::new()),
        };

        match response {
            Ok(frames) => {
                for frame in frames {
                    if let Err(error) = send_frame(&mut sender, &frame).await {
                        tracing::warn!(error = %error, "Failed to write audio dictation socket frame");
                        break;
                    }
                }
            }
            Err(error) => {
                tracing::warn!(error = %error, "Audio dictation socket command failed");
                let frame = DictationServerControlFrame::Error {
                    error: error.to_string(),
                };
                if send_frame(&mut sender, &frame).await.is_err() {
                    break;
                }
            }
        }
    }
}

async fn handle_dictation_control_frame(
    app_state: &AppState,
    chunk_duration_ms: &mut Option<u64>,
    next_chunk_index: &mut usize,
    pending_chunk: &mut Option<PendingChunk>,
    control_frame: DictationClientControlFrame,
) -> Result<Option<DictationServerControlFrame>, Report> {
    match control_frame {
        DictationClientControlFrame::Start {
            chunk_duration_ms: requested_chunk_duration_ms,
        } => {
            ensure_audio_dictation_enabled(app_state)?;
            let resolved_chunk_duration_ms = requested_chunk_duration_ms
                .unwrap_or_else(|| app_state.config.audio_dictation.chunk_duration_seconds * 1000);
            *chunk_duration_ms = Some(resolved_chunk_duration_ms);
            *next_chunk_index = 0;
            *pending_chunk = None;
            Ok(Some(DictationServerControlFrame::SessionState {
                next_chunk_index: *next_chunk_index,
                chunk_duration_ms: resolved_chunk_duration_ms,
            }))
        }
        DictationClientControlFrame::ChunkMetadata {
            chunk_index,
            start_ms,
            end_ms,
            content_type,
        } => {
            let chunk_duration_ms =
                (*chunk_duration_ms).ok_or_eyre("Start audio dictation before sending chunks")?;
            validate_chunk_metadata(
                app_state,
                AudioFeature::Dictation,
                chunk_index,
                start_ms,
                end_ms,
                chunk_duration_ms,
                *next_chunk_index,
            )?;
            let content_type = resolve_chunk_content_type(chunk_index, content_type)?;
            *pending_chunk = Some(PendingChunk {
                chunk_index,
                start_ms,
                end_ms,
                content_type,
            });
            Ok(None)
        }
        DictationClientControlFrame::Finish => {
            (*chunk_duration_ms).ok_or_eyre("Start audio dictation before finishing")?;
            Ok(Some(DictationServerControlFrame::Completed))
        }
    }
}

async fn handle_dictation_audio_bytes(
    app_state: &AppState,
    chunk_duration_ms: Option<u64>,
    next_chunk_index: &mut usize,
    pending_chunk: &mut Option<PendingChunk>,
    bytes: Vec<u8>,
) -> Result<Vec<DictationServerControlFrame>, Report> {
    chunk_duration_ms.ok_or_eyre("Start audio dictation before sending audio bytes")?;
    let pending = pending_chunk
        .take()
        .ok_or_eyre("Send chunk_metadata before binary audio bytes")?;
    let validated_chunk = validate_audio_chunk(&pending, &bytes)?;
    debug!(
        chunk_index = pending.chunk_index,
        start_ms = pending.start_ms,
        end_ms = pending.end_ms,
        content_type = %pending.content_type,
        received_bytes = bytes.len(),
        provider_audio_bytes = validated_chunk.provider_audio_bytes.len(),
        "Validated audio dictation chunk"
    );
    enforce_audio_byte_limit(
        app_state,
        AudioFeature::Dictation,
        validated_chunk.append_bytes.len() as u64,
    )?;

    let ack = DictationServerControlFrame::ChunkAck {
        chunk_index: pending.chunk_index,
    };
    let transcribed_chunk = transcribe_audio_chunk_with_retry(
        app_state,
        AudioFeature::Dictation,
        &pending,
        validated_chunk.provider_audio_bytes,
    )
    .await?;
    *next_chunk_index += 1;

    Ok(vec![
        ack,
        DictationServerControlFrame::ChunkTranscribed {
            chunk_index: pending.chunk_index,
            transcript: transcribed_chunk.transcript,
        },
    ])
}

async fn handle_control_frame(
    app_state: &AppState,
    policy: &PolicyEngine,
    me_user: &MeProfile,
    session: &mut Option<AudioSession>,
    pending_chunk: &mut Option<PendingChunk>,
    control_frame: ClientControlFrame,
) -> Result<Option<ServerControlFrame>, Report> {
    match control_frame {
        ClientControlFrame::Start {
            chat_id,
            filename,
            content_type,
            chunk_duration_ms,
        } => {
            ensure_audio_transcription_enabled(app_state)?;
            let chat_id = Uuid::parse_str(&chat_id).wrap_err("Invalid chat_id")?;
            let file_upload_id = Uuid::new_v4();
            let file_storage_path = file_upload_id.to_string();
            let filename =
                filename.unwrap_or_else(|| format!("audio-transcription-{file_upload_id}.wav"));
            let content_type =
                content_type.unwrap_or_else(|| CANONICAL_AUDIO_CONTENT_TYPE.to_string());
            if content_type != CANONICAL_AUDIO_CONTENT_TYPE {
                return Err(eyre::eyre!(
                    "Unsupported audio content type: {}",
                    content_type
                ));
            }

            let file_upload = models::file_upload::create_file_upload(
                &app_state.db,
                policy,
                &me_user.to_subject(),
                &chat_id,
                filename,
                app_state.default_file_storage_provider_id(),
                file_storage_path,
            )
            .await
            .wrap_err("Failed to create audio transcription file upload")?;

            let metadata = AudioTranscriptionMetadata {
                status: "recording".to_string(),
                progress: Some(0.0),
                chunks: Some(Vec::new()),
                transcript_segments: Some(Vec::new()),
                ..Default::default()
            };
            models::file_upload::set_audio_transcription_metadata(
                &app_state.db,
                &file_upload.id,
                Some(metadata.clone()),
            )
            .await?;
            app_state.global_policy_engine.invalidate_data().await;

            let chunk_duration_ms = chunk_duration_ms.unwrap_or_else(|| {
                app_state.config.audio_transcription.chunk_duration_seconds * 1000
            });
            let next_session = AudioSession {
                file_upload,
                metadata,
                chunk_duration_ms,
                stored_offset: 0,
                storage_writer: None,
            };
            let frame = session_state_frame(&next_session);
            *session = Some(next_session);
            Ok(Some(frame))
        }
        ClientControlFrame::Resume { file_upload_id } => {
            ensure_audio_transcription_enabled(app_state)?;
            let file_upload_id =
                Uuid::parse_str(&file_upload_id).wrap_err("Invalid file_upload_id")?;
            let file_upload = models::file_upload::get_audio_transcription_upload_for_mutation(
                &app_state.db,
                &me_user.to_subject(),
                &file_upload_id,
            )
            .await?;
            let metadata = models::file_upload::get_audio_transcription_metadata(&file_upload)
                .ok_or_eyre("File upload is not an audio transcription upload")?;
            let provider = app_state.default_file_storage_provider();
            let stored_offset = provider
                .stat_object(&file_upload.file_storage_path)
                .await
                .map(|metadata| metadata.size_bytes)
                .unwrap_or(0);
            let next_session = AudioSession {
                file_upload,
                metadata,
                chunk_duration_ms: app_state.config.audio_transcription.chunk_duration_seconds
                    * 1000,
                stored_offset,
                storage_writer: None,
            };
            let frame = session_state_frame(&next_session);
            *session = Some(next_session);
            Ok(Some(frame))
        }
        ClientControlFrame::RetryFailed { file_upload_id } => {
            ensure_audio_transcription_enabled(app_state)?;
            if let Some(file_upload_id) = file_upload_id {
                let file_upload_id =
                    Uuid::parse_str(&file_upload_id).wrap_err("Invalid file_upload_id")?;
                let file_upload = models::file_upload::get_audio_transcription_upload_for_mutation(
                    &app_state.db,
                    &me_user.to_subject(),
                    &file_upload_id,
                )
                .await?;
                let metadata = models::file_upload::get_audio_transcription_metadata(&file_upload)
                    .ok_or_eyre("File upload is not an audio transcription upload")?;
                let stored_offset = app_state
                    .default_file_storage_provider()
                    .stat_object(&file_upload.file_storage_path)
                    .await
                    .map(|metadata| metadata.size_bytes)
                    .unwrap_or(0);
                *session = Some(AudioSession {
                    file_upload,
                    metadata,
                    chunk_duration_ms: app_state.config.audio_transcription.chunk_duration_seconds
                        * 1000,
                    stored_offset,
                    storage_writer: None,
                });
            }

            let session = session
                .as_mut()
                .ok_or_eyre("Start or resume audio transcription before retrying failed chunks")?;
            retry_failed_chunks(app_state, session).await.map(Some)
        }
        ClientControlFrame::ChunkMetadata {
            chunk_index,
            start_ms,
            end_ms,
            content_type,
        } => {
            let session = session
                .as_mut()
                .ok_or_eyre("Start or resume audio transcription before sending chunks")?;
            if end_ms <= start_ms {
                return Err(eyre::eyre!("Chunk end_ms must be greater than start_ms"));
            }
            if end_ms - start_ms > session.chunk_duration_ms {
                return Err(eyre::eyre!(
                    "Chunk duration exceeds configured duration of {}ms",
                    session.chunk_duration_ms
                ));
            }
            enforce_audio_duration_limit(app_state, AudioFeature::Transcription, end_ms)?;
            let expected_index = next_chunk_index(&session.metadata);
            if chunk_index != expected_index {
                return Err(eyre::eyre!(
                    "Unexpected chunk index: got {}, expected {}",
                    chunk_index,
                    expected_index
                ));
            }
            let content_type = content_type.unwrap_or_else(|| {
                if chunk_index == 0 {
                    CANONICAL_AUDIO_CONTENT_TYPE.to_string()
                } else {
                    "audio/pcm".to_string()
                }
            });
            if chunk_index == 0 && content_type != CANONICAL_AUDIO_CONTENT_TYPE {
                return Err(eyre::eyre!("First chunk must be audio/wav"));
            }
            if chunk_index > 0
                && content_type != "audio/pcm"
                && content_type != CANONICAL_AUDIO_CONTENT_TYPE
            {
                return Err(eyre::eyre!("Later chunks must be audio/pcm or audio/wav"));
            }

            upsert_chunk(
                &mut session.metadata,
                AudioTranscriptionChunk {
                    index: chunk_index,
                    start_ms: Some(start_ms),
                    end_ms: Some(end_ms),
                    byte_start: Some(session.stored_offset),
                    byte_end: None,
                    status: "uploading".to_string(),
                    transcript: None,
                    attempts: 0,
                    error: None,
                },
            );
            persist_session_metadata(app_state, session).await?;
            *pending_chunk = Some(PendingChunk {
                chunk_index,
                start_ms,
                end_ms,
                content_type,
            });
            Ok(None)
        }
        ClientControlFrame::Finish => {
            let session = session
                .as_mut()
                .ok_or_eyre("Start or resume audio transcription before finishing")?;
            close_audio_storage_writer(session)
                .await
                .wrap_err("Failed to close audio transcription upload writer")?;
            app_state
                .default_file_storage_provider()
                .finalize_resumable_upload(&session.file_upload.file_storage_path)
                .await?;
            session.metadata.status = if session
                .metadata
                .chunks
                .as_ref()
                .is_some_and(|chunks| chunks.iter().all(|chunk| chunk.status == "completed"))
            {
                "completed".to_string()
            } else {
                "transcribing".to_string()
            };
            session.metadata.progress = Some(progress_for_metadata(&session.metadata));
            session.metadata.transcript = aggregate_completed_transcript(&session.metadata);
            persist_session_metadata(app_state, session).await?;
            Ok(Some(ServerControlFrame::Completed {
                file_upload_id: session.file_upload.id.to_string(),
                transcript: session.metadata.transcript.clone().unwrap_or_default(),
                audio_transcription: session.metadata.clone(),
            }))
        }
    }
}

async fn handle_audio_bytes(
    app_state: &AppState,
    session: &mut Option<AudioSession>,
    pending_chunk: &mut Option<PendingChunk>,
    bytes: Vec<u8>,
) -> Result<Vec<ServerControlFrame>, Report> {
    let session = session
        .as_mut()
        .ok_or_eyre("Start or resume audio transcription before sending audio bytes")?;
    let pending = pending_chunk
        .take()
        .ok_or_eyre("Send chunk_metadata before binary audio bytes")?;

    let validated_chunk = validate_audio_chunk(&pending, &bytes)?;
    debug!(
        chunk_index = pending.chunk_index,
        start_ms = pending.start_ms,
        end_ms = pending.end_ms,
        content_type = %pending.content_type,
        received_bytes = bytes.len(),
        provider_audio_bytes = validated_chunk.provider_audio_bytes.len(),
        append_bytes = validated_chunk.append_bytes.len(),
        "Validated audio transcription chunk"
    );
    let byte_start = session.stored_offset;
    enforce_audio_byte_limit(
        app_state,
        AudioFeature::Transcription,
        byte_start + validated_chunk.append_bytes.len() as u64,
    )?;
    write_audio_storage_bytes(
        app_state,
        session,
        byte_start,
        &validated_chunk.append_bytes,
    )
    .await?;
    let byte_end = byte_start + validated_chunk.append_bytes.len() as u64;
    debug!(
        file_upload_id = %session.file_upload.id,
        chunk_index = pending.chunk_index,
        byte_start,
        byte_end,
        stored_offset_before = byte_start,
        stored_offset_after = byte_end,
        "Stored audio transcription chunk bytes"
    );
    session.stored_offset = byte_end;
    let existing_attempts = chunk_attempts(&session.metadata, pending.chunk_index);
    update_chunk_status(
        &mut session.metadata,
        ChunkStatusUpdate {
            chunk_index: pending.chunk_index,
            status: "transcribing",
            byte_start: Some(byte_start),
            byte_end: Some(byte_end),
            transcript: None,
            error: None,
            attempts: existing_attempts,
        },
    );
    session.metadata.status = "transcribing".to_string();
    session.metadata.progress = Some(progress_for_metadata(&session.metadata));
    persist_session_metadata(app_state, session).await?;

    let ack = ServerControlFrame::ChunkAck {
        file_upload_id: session.file_upload.id.to_string(),
        chunk_index: pending.chunk_index,
        byte_start,
        byte_end,
    };

    let transcribed_chunk = match transcribe_audio_chunk_with_retry(
        app_state,
        AudioFeature::Transcription,
        &pending,
        validated_chunk.provider_audio_bytes,
    )
    .await
    {
        Ok(transcribed_chunk) => transcribed_chunk,
        Err(error) => {
            warn!(
                file_upload_id = %session.file_upload.id,
                chunk_index = pending.chunk_index,
                byte_start,
                byte_end,
                error = %error,
                "Audio transcription chunk failed"
            );
            update_chunk_status(
                &mut session.metadata,
                ChunkStatusUpdate {
                    chunk_index: pending.chunk_index,
                    status: "failed",
                    byte_start: Some(byte_start),
                    byte_end: Some(byte_end),
                    transcript: None,
                    error: Some(error.to_string()),
                    attempts: app_state.config.audio_transcription.max_attempts,
                },
            );
            session.metadata.status = "failed".to_string();
            session.metadata.error = Some(error.to_string());
            session.metadata.progress = Some(progress_for_metadata(&session.metadata));
            persist_session_metadata(app_state, session).await?;
            return Ok(vec![
                ack,
                ServerControlFrame::ChunkFailed {
                    file_upload_id: session.file_upload.id.to_string(),
                    chunk_index: pending.chunk_index,
                    error: error.to_string(),
                    audio_transcription: session.metadata.clone(),
                },
            ]);
        }
    };

    update_chunk_status(
        &mut session.metadata,
        ChunkStatusUpdate {
            chunk_index: pending.chunk_index,
            status: "completed",
            byte_start: Some(byte_start),
            byte_end: Some(byte_end),
            transcript: Some(transcribed_chunk.transcript.clone()),
            error: None,
            attempts: transcribed_chunk.attempts,
        },
    );
    upsert_segment(
        &mut session.metadata,
        pending.chunk_index,
        pending.start_ms,
        pending.end_ms,
        transcribed_chunk.transcript.clone(),
    );
    session.metadata.transcript = aggregate_completed_transcript(&session.metadata);
    debug!(
        file_upload_id = %session.file_upload.id,
        chunk_index = pending.chunk_index,
        byte_start,
        byte_end,
        attempts = transcribed_chunk.attempts,
        transcript_chars = transcribed_chunk.transcript.chars().count(),
        transcript_empty = transcribed_chunk.transcript.trim().is_empty(),
        "Audio transcription chunk completed"
    );
    session.metadata.status = "recording".to_string();
    session.metadata.progress = Some(progress_for_metadata(&session.metadata));
    persist_session_metadata(app_state, session).await?;

    Ok(vec![
        ack,
        ServerControlFrame::ChunkTranscribed {
            file_upload_id: session.file_upload.id.to_string(),
            chunk_index: pending.chunk_index,
            transcript: transcribed_chunk.transcript,
            audio_transcription: session.metadata.clone(),
        },
    ])
}

fn ensure_audio_transcription_enabled(app_state: &AppState) -> Result<(), Report> {
    if app_state.config.audio_transcription.enabled {
        Ok(())
    } else {
        Err(eyre::eyre!("Audio transcription is not enabled"))
    }
}

fn ensure_audio_dictation_enabled(app_state: &AppState) -> Result<(), Report> {
    if app_state.config.audio_dictation.enabled {
        Ok(())
    } else {
        Err(eyre::eyre!("Audio dictation is not enabled"))
    }
}

fn validate_chunk_metadata(
    app_state: &AppState,
    audio_feature: AudioFeature,
    chunk_index: usize,
    start_ms: u64,
    end_ms: u64,
    chunk_duration_ms: u64,
    expected_chunk_index: usize,
) -> Result<(), Report> {
    if end_ms <= start_ms {
        return Err(eyre::eyre!("Chunk end_ms must be greater than start_ms"));
    }
    if end_ms - start_ms > chunk_duration_ms {
        return Err(eyre::eyre!(
            "Chunk duration exceeds configured duration of {}ms",
            chunk_duration_ms
        ));
    }
    enforce_audio_duration_limit(app_state, audio_feature, end_ms)?;
    if chunk_index != expected_chunk_index {
        return Err(eyre::eyre!(
            "Unexpected chunk index: got {}, expected {}",
            chunk_index,
            expected_chunk_index
        ));
    }
    Ok(())
}

fn resolve_chunk_content_type(
    chunk_index: usize,
    content_type: Option<String>,
) -> Result<String, Report> {
    let content_type = content_type.unwrap_or_else(|| {
        if chunk_index == 0 {
            CANONICAL_AUDIO_CONTENT_TYPE.to_string()
        } else {
            "audio/pcm".to_string()
        }
    });
    if chunk_index == 0 && content_type != CANONICAL_AUDIO_CONTENT_TYPE {
        return Err(eyre::eyre!("First chunk must be audio/wav"));
    }
    if chunk_index > 0
        && content_type != "audio/pcm"
        && content_type != CANONICAL_AUDIO_CONTENT_TYPE
    {
        return Err(eyre::eyre!("Later chunks must be audio/pcm or audio/wav"));
    }
    Ok(content_type)
}

fn session_state_frame(session: &AudioSession) -> ServerControlFrame {
    ServerControlFrame::SessionState {
        file_upload_id: session.file_upload.id.to_string(),
        status: session.metadata.status.clone(),
        next_chunk_index: next_chunk_index(&session.metadata),
        stored_offset: session.stored_offset,
        chunk_duration_ms: session.chunk_duration_ms,
        audio_transcription: session.metadata.clone(),
    }
}

async fn persist_session_metadata(
    app_state: &AppState,
    session: &AudioSession,
) -> Result<(), Report> {
    models::file_upload::set_audio_transcription_metadata(
        &app_state.db,
        &session.file_upload.id,
        Some(session.metadata.clone()),
    )
    .await
}

async fn write_audio_storage_bytes(
    app_state: &AppState,
    session: &mut AudioSession,
    expected_offset: u64,
    bytes: &[u8],
) -> Result<(), Report> {
    if session.stored_offset != expected_offset {
        return Err(eyre::eyre!(
            "Audio writer offset mismatch for {}: expected {}, current {}",
            session.file_upload.file_storage_path,
            expected_offset,
            session.stored_offset
        ));
    }

    if session.storage_writer.is_none() {
        let existing_bytes = if expected_offset > 0 {
            app_state
                .default_file_storage_provider()
                .read_file_to_bytes(&session.file_upload.file_storage_path)
                .await
                .wrap_err("Failed to read committed audio bytes for resumed upload")?
        } else {
            Vec::new()
        };
        if existing_bytes.len() as u64 != expected_offset {
            return Err(eyre::eyre!(
                "Committed audio object size mismatch for {}: expected {}, current {}",
                session.file_upload.file_storage_path,
                expected_offset,
                existing_bytes.len()
            ));
        }

        let mut writer = app_state
            .default_file_storage_provider()
            .upload_file_writer(
                &session.file_upload.file_storage_path,
                Some(CANONICAL_AUDIO_CONTENT_TYPE),
            )
            .await
            .wrap_err("Failed to open audio transcription upload writer")?;
        if !existing_bytes.is_empty() {
            writer
                .write(existing_bytes)
                .await
                .wrap_err("Failed to seed resumed audio transcription upload writer")?;
        }
        session.storage_writer = Some(writer);
    }

    let writer = session
        .storage_writer
        .as_mut()
        .ok_or_eyre("Audio transcription upload writer is not open")?;
    writer
        .write(bytes.to_vec())
        .await
        .wrap_err("Failed to write audio transcription bytes")?;

    Ok(())
}

async fn close_audio_storage_writer(session: &mut AudioSession) -> Result<(), Report> {
    if let Some(mut writer) = session.storage_writer.take() {
        writer.close().await?;
    }
    Ok(())
}

fn next_chunk_index(metadata: &AudioTranscriptionMetadata) -> usize {
    metadata
        .chunks
        .as_ref()
        .and_then(|chunks| chunks.iter().map(|chunk| chunk.index).max())
        .map_or(0, |index| index + 1)
}

fn upsert_chunk(metadata: &mut AudioTranscriptionMetadata, chunk: AudioTranscriptionChunk) {
    let chunks = metadata.chunks.get_or_insert_with(Vec::new);
    if let Some(existing) = chunks
        .iter_mut()
        .find(|existing| existing.index == chunk.index)
    {
        *existing = chunk;
    } else {
        chunks.push(chunk);
        chunks.sort_by_key(|chunk| chunk.index);
    }
}

struct ChunkStatusUpdate {
    chunk_index: usize,
    status: &'static str,
    byte_start: Option<u64>,
    byte_end: Option<u64>,
    transcript: Option<String>,
    error: Option<String>,
    attempts: usize,
}

fn update_chunk_status(metadata: &mut AudioTranscriptionMetadata, update: ChunkStatusUpdate) {
    if let Some(chunk) = metadata
        .chunks
        .get_or_insert_with(Vec::new)
        .iter_mut()
        .find(|chunk| chunk.index == update.chunk_index)
    {
        chunk.status = update.status.to_string();
        chunk.byte_start = update.byte_start.or(chunk.byte_start);
        chunk.byte_end = update.byte_end.or(chunk.byte_end);
        chunk.transcript = update.transcript.or_else(|| chunk.transcript.clone());
        chunk.error = update.error;
        chunk.attempts = update.attempts;
    }
}

fn upsert_segment(
    metadata: &mut AudioTranscriptionMetadata,
    chunk_index: usize,
    start_ms: u64,
    end_ms: u64,
    text: String,
) {
    let segments = metadata.transcript_segments.get_or_insert_with(Vec::new);
    if let Some(existing) = segments
        .iter_mut()
        .find(|segment| segment.chunk_index == chunk_index)
    {
        existing.text = text;
        existing.start_ms = start_ms;
        existing.end_ms = end_ms;
    } else {
        segments.push(AudioTranscriptSegment {
            chunk_index,
            start_ms,
            end_ms,
            text,
        });
        segments.sort_by_key(|segment| segment.chunk_index);
    }
}

fn aggregate_completed_transcript(metadata: &AudioTranscriptionMetadata) -> Option<String> {
    let text = metadata
        .chunks
        .as_ref()?
        .iter()
        .filter(|chunk| chunk.status == "completed")
        .filter_map(|chunk| chunk.transcript.as_deref())
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join(" ");

    if text.is_empty() { None } else { Some(text) }
}

fn progress_for_metadata(metadata: &AudioTranscriptionMetadata) -> f64 {
    let Some(chunks) = metadata.chunks.as_ref() else {
        return 0.0;
    };
    if chunks.is_empty() {
        return 0.0;
    }

    let completed = chunks
        .iter()
        .filter(|chunk| chunk.status == "completed")
        .count();
    completed as f64 / chunks.len() as f64
}

fn chunk_attempts(metadata: &AudioTranscriptionMetadata, chunk_index: usize) -> usize {
    metadata
        .chunks
        .as_ref()
        .and_then(|chunks| chunks.iter().find(|chunk| chunk.index == chunk_index))
        .map(|chunk| chunk.attempts)
        .unwrap_or(0)
}

fn canonical_audio_max_bytes(app_state: &AppState, audio_feature: AudioFeature) -> u64 {
    canonical_audio_max_bytes_for_config(audio_feature.config(app_state))
}

fn canonical_audio_max_bytes_for_config(config: &crate::config::AudioTranscriptionConfig) -> u64 {
    44 + config.max_recording_duration_seconds
        * CANONICAL_SAMPLE_RATE_HZ as u64
        * CANONICAL_CHANNELS as u64
        * (CANONICAL_BITS_PER_SAMPLE as u64 / 8)
}

fn enforce_audio_byte_limit(
    app_state: &AppState,
    audio_feature: AudioFeature,
    next_offset: u64,
) -> Result<(), Report> {
    let max_bytes = canonical_audio_max_bytes(app_state, audio_feature);
    if next_offset > max_bytes {
        return Err(eyre::eyre!(
            "Audio recording exceeds configured maximum size of {} bytes",
            max_bytes
        ));
    }

    Ok(())
}

fn enforce_audio_duration_limit(
    app_state: &AppState,
    audio_feature: AudioFeature,
    end_ms: u64,
) -> Result<(), Report> {
    enforce_audio_duration_limit_config(audio_feature.config(app_state), end_ms)
}

fn enforce_audio_duration_limit_config(
    config: &crate::config::AudioTranscriptionConfig,
    end_ms: u64,
) -> Result<(), Report> {
    let max_ms = config.max_recording_duration_seconds * 1000;
    if end_ms > max_ms {
        return Err(eyre::eyre!(
            "Audio chunk exceeds configured maximum recording duration of {}ms",
            max_ms
        ));
    }

    Ok(())
}

fn validate_audio_chunk(
    pending: &PendingChunk,
    bytes: &[u8],
) -> Result<ValidatedAudioChunk, Report> {
    if pending.content_type == CANONICAL_AUDIO_CONTENT_TYPE {
        let data_range = validate_canonical_wav(bytes)?;
        let append_bytes = if pending.chunk_index == 0 {
            bytes.to_vec()
        } else {
            bytes[data_range].to_vec()
        };
        return Ok(ValidatedAudioChunk {
            provider_audio_bytes: bytes.to_vec(),
            append_bytes,
        });
    }

    validate_pcm_payload(bytes)?;
    let provider_audio_bytes = build_wav_from_pcm(bytes);
    Ok(ValidatedAudioChunk {
        provider_audio_bytes,
        append_bytes: bytes.to_vec(),
    })
}

fn validate_pcm_payload(bytes: &[u8]) -> Result<(), Report> {
    let frame_size = CANONICAL_CHANNELS as usize * (CANONICAL_BITS_PER_SAMPLE as usize / 8);
    if bytes.is_empty() || !bytes.len().is_multiple_of(frame_size) {
        return Err(eyre::eyre!(
            "Audio PCM chunk does not align to canonical frame size"
        ));
    }
    Ok(())
}

fn validate_canonical_wav(bytes: &[u8]) -> Result<Range<usize>, Report> {
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err(eyre::eyre!("Invalid WAV header"));
    }

    if &bytes[12..16] != b"fmt " || &bytes[36..40] != b"data" {
        return Err(eyre::eyre!(
            "Unsupported WAV layout: expected canonical 44-byte PCM WAV header"
        ));
    }

    let riff_size = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    let fmt_len = u32::from_le_bytes(bytes[16..20].try_into().unwrap());
    let audio_format = u16::from_le_bytes(bytes[20..22].try_into().unwrap());
    let channels = u16::from_le_bytes(bytes[22..24].try_into().unwrap());
    let sample_rate = u32::from_le_bytes(bytes[24..28].try_into().unwrap());
    let byte_rate = u32::from_le_bytes(bytes[28..32].try_into().unwrap());
    let block_align = u16::from_le_bytes(bytes[32..34].try_into().unwrap());
    let bits_per_sample = u16::from_le_bytes(bytes[34..36].try_into().unwrap());
    let data_len = u32::from_le_bytes(bytes[40..44].try_into().unwrap()) as usize;
    let expected_byte_rate =
        CANONICAL_SAMPLE_RATE_HZ * CANONICAL_CHANNELS as u32 * CANONICAL_BITS_PER_SAMPLE as u32 / 8;
    let expected_block_align = CANONICAL_CHANNELS * CANONICAL_BITS_PER_SAMPLE / 8;

    if fmt_len != 16
        || audio_format != 1
        || channels != CANONICAL_CHANNELS
        || sample_rate != CANONICAL_SAMPLE_RATE_HZ
        || byte_rate != expected_byte_rate
        || block_align != expected_block_align
        || bits_per_sample != CANONICAL_BITS_PER_SAMPLE
    {
        return Err(eyre::eyre!(
            "Unsupported WAV format: expected mono PCM s16le at 16kHz"
        ));
    }

    if data_len == 0 || bytes.len() != 44 + data_len || riff_size != bytes.len() - 8 {
        return Err(eyre::eyre!("Malformed canonical WAV length"));
    }

    validate_pcm_payload(&bytes[44..])?;
    Ok(44..bytes.len())
}

fn build_wav_from_pcm(pcm: &[u8]) -> Vec<u8> {
    let data_len = pcm.len() as u32;
    let byte_rate =
        CANONICAL_SAMPLE_RATE_HZ * CANONICAL_CHANNELS as u32 * CANONICAL_BITS_PER_SAMPLE as u32 / 8;
    let block_align = CANONICAL_CHANNELS * CANONICAL_BITS_PER_SAMPLE / 8;
    let mut wav = Vec::with_capacity(44 + pcm.len());
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_len).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&CANONICAL_CHANNELS.to_le_bytes());
    wav.extend_from_slice(&CANONICAL_SAMPLE_RATE_HZ.to_le_bytes());
    wav.extend_from_slice(&byte_rate.to_le_bytes());
    wav.extend_from_slice(&block_align.to_le_bytes());
    wav.extend_from_slice(&CANONICAL_BITS_PER_SAMPLE.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_len.to_le_bytes());
    wav.extend_from_slice(pcm);
    wav
}

async fn transcribe_audio_chunk_with_retry(
    app_state: &AppState,
    audio_feature: AudioFeature,
    pending: &PendingChunk,
    audio_bytes: Vec<u8>,
) -> Result<TranscribedChunk, Report> {
    let config = audio_feature.config(app_state);
    let max_attempts = config.max_attempts.max(1);
    let mut next_backoff_ms = config.initial_backoff_ms;
    let mut last_error: Option<Report> = None;

    for attempt in 1..=max_attempts {
        debug!(
            chunk_index = pending.chunk_index,
            attempt,
            max_attempts,
            audio_bytes = audio_bytes.len(),
            "Starting audio transcription provider attempt"
        );
        match transcribe_audio_chunk(app_state, audio_feature, pending, audio_bytes.clone()).await {
            Ok(transcript) => {
                if looks_like_hallucination_loop(config, &transcript) {
                    warn!(
                        chunk_index = pending.chunk_index,
                        attempt,
                        transcript_chars = transcript.chars().count(),
                        "Audio transcription provider response rejected as hallucination loop"
                    );
                    last_error = Some(eyre::eyre!("hallucination_loop_detected"));
                } else {
                    debug!(
                        chunk_index = pending.chunk_index,
                        attempt,
                        transcript_chars = transcript.chars().count(),
                        transcript_empty = transcript.trim().is_empty(),
                        "Audio transcription provider attempt succeeded"
                    );
                    return Ok(TranscribedChunk {
                        transcript,
                        attempts: attempt,
                    });
                }
            }
            Err(error) => {
                warn!(
                    chunk_index = pending.chunk_index,
                    attempt,
                    error = %error,
                    "Audio transcription provider attempt errored"
                );
                last_error = Some(error);
            }
        }

        if attempt < max_attempts {
            let jitter_ms = ((attempt as u64 * 37) % 97).min(next_backoff_ms.max(1));
            debug!(
                chunk_index = pending.chunk_index,
                attempt,
                backoff_ms = next_backoff_ms,
                jitter_ms,
                "Retrying audio transcription provider attempt after backoff"
            );
            sleep(Duration::from_millis(next_backoff_ms + jitter_ms)).await;
            next_backoff_ms = (next_backoff_ms.saturating_mul(2)).min(config.max_backoff_ms);
        }
    }

    Err(last_error.unwrap_or_else(|| eyre::eyre!("Audio transcription failed")))
}

async fn transcribe_audio_chunk(
    app_state: &AppState,
    audio_feature: AudioFeature,
    pending: &PendingChunk,
    audio_bytes: Vec<u8>,
) -> Result<String, Report> {
    let provider = audio_provider(app_state, audio_feature)?;
    debug!(
        chunk_index = pending.chunk_index,
        provider_id = %provider.chat_provider_id,
        model_name = %provider.chat_provider_config.model_name,
        provider_kind = %provider.chat_provider_config.provider_kind,
        audio_bytes = audio_bytes.len(),
        "Selected audio transcription provider"
    );
    transcribe_audio_chunk_genai(app_state, audio_feature, &provider, pending, audio_bytes).await
}

fn audio_provider(
    app_state: &AppState,
    audio_feature: AudioFeature,
) -> Result<ChatProviderConfigWithId, Report> {
    let config = audio_feature.config(app_state);
    let config_key = audio_feature.config_key();
    if let Some(provider_id) = config.chat_provider_id.as_deref() {
        let provider = app_state.config.get_chat_provider(provider_id);
        if !provider.model_capabilities.supports_audio_input {
            return Err(eyre::eyre!(
                "Configured {} provider '{}' does not support audio input",
                config_key,
                provider_id,
            ));
        }
        if !audio_provider_kind_supports_binary_audio(&provider.provider_kind) {
            return Err(eyre::eyre!(
                "Configured {} provider '{}' uses provider kind '{}' which does not support audio input through the current adapter",
                config_key,
                provider_id,
                provider.provider_kind,
            ));
        }
        return Ok(ChatProviderConfigWithId {
            chat_provider_id: provider_id.to_string(),
            chat_provider_config: provider.clone(),
        });
    }

    if let Some(chat_providers) = app_state.config.chat_providers.as_ref() {
        let provider_id = chat_providers
            .priority_order
            .iter()
            .find(|provider_id| {
                chat_providers
                    .providers
                    .get(*provider_id)
                    .is_some_and(|provider| {
                        provider.model_capabilities.supports_audio_input
                            && audio_provider_kind_supports_binary_audio(&provider.provider_kind)
                    })
            })
            .ok_or_eyre("No supported audio-capable chat provider configured")?;
        return Ok(ChatProviderConfigWithId {
            chat_provider_id: provider_id.clone(),
            chat_provider_config: app_state.config.get_chat_provider(provider_id).clone(),
        });
    }

    let provider = app_state
        .config
        .chat_provider
        .as_ref()
        .filter(|provider| {
            provider.model_capabilities.supports_audio_input
                && audio_provider_kind_supports_binary_audio(&provider.provider_kind)
        })
        .ok_or_eyre("No supported audio-capable chat provider configured")?;

    Ok(ChatProviderConfigWithId {
        chat_provider_id: "default".to_string(),
        chat_provider_config: provider.clone(),
    })
}

fn audio_provider_kind_supports_binary_audio(provider_kind: &str) -> bool {
    !matches!(provider_kind, "openai_responses" | "azure_openai_responses")
}

async fn transcribe_audio_chunk_genai(
    app_state: &AppState,
    audio_feature: AudioFeature,
    provider: &ChatProviderConfigWithId,
    pending: &PendingChunk,
    audio_bytes: Vec<u8>,
) -> Result<String, Report> {
    let client = AppState::build_genai_client(provider.chat_provider_config.clone())?;
    let max_output_tokens = max_output_tokens_for_chunk(app_state, audio_feature, pending);
    let audio_data_range = validate_canonical_wav(&audio_bytes).ok();
    let audio_pcm_bytes = audio_data_range
        .as_ref()
        .map(|range| range.end.saturating_sub(range.start));
    trace!(
        chunk_index = pending.chunk_index,
        start_ms = pending.start_ms,
        end_ms = pending.end_ms,
        provider_id = %provider.chat_provider_id,
        model_name = %provider.chat_provider_config.model_name,
        audio_bytes = audio_bytes.len(),
        audio_pcm_bytes,
        max_output_tokens,
        "Building genai audio transcription request"
    );
    let b64_audio = STANDARD.encode(audio_bytes);
    let user_content = MessageContent::from_parts(vec![
        GenAiContentPart::Text(
            "Transcribe the provided audio excerpt verbatim. Return only spoken words as plain text. The excerpt may start or end mid-sentence, so transcribe any audible partial speech. Do not summarize, add commentary, timestamps, markdown, speaker labels, or inferred missing words. Return an empty string only when there is no audible speech."
                .to_string(),
        ),
        GenAiContentPart::from_binary_base64(
            CANONICAL_AUDIO_CONTENT_TYPE,
            Arc::from(b64_audio.as_str()),
            Some(format!("audio-chunk-{}.wav", pending.chunk_index)),
        ),
    ]);
    let chat_request = ChatRequest::new(vec![GenAiChatMessage::user(user_content)])
        .with_system("You are a strict audio transcription engine.");
    let reasoning_effort = if matches!(
        provider.chat_provider_config.provider_kind.as_str(),
        "gemini" | "vertex_ai"
    ) {
        // Gemini treats an omitted thinking config differently from an explicit zero budget.
        // Audio transcription is an extraction task, so spend the response budget on text.
        ReasoningEffort::Budget(0)
    } else {
        ReasoningEffort::None
    };
    let chat_options = ChatOptions::default()
        .with_capture_content(true)
        .with_temperature(0.0)
        .with_reasoning_effort(reasoning_effort)
        .with_max_tokens(max_output_tokens);
    let response = client
        .exec_chat("PLACEHOLDER_MODEL", chat_request, Some(&chat_options))
        .await?;
    let transcript = response.first_text().unwrap_or_default().trim().to_string();
    debug!(
        chunk_index = pending.chunk_index,
        provider_id = %provider.chat_provider_id,
        model_name = %provider.chat_provider_config.model_name,
        transcript_chars = transcript.chars().count(),
        transcript_empty = transcript.is_empty(),
        "Received genai audio transcription response"
    );

    Ok(transcript)
}

fn max_output_tokens_for_chunk(
    app_state: &AppState,
    audio_feature: AudioFeature,
    pending: &PendingChunk,
) -> u32 {
    max_output_tokens_for_chunk_config(audio_feature.config(app_state), pending)
}

fn max_output_tokens_for_chunk_config(
    config: &crate::config::AudioTranscriptionConfig,
    pending: &PendingChunk,
) -> u32 {
    let chunk_duration_minutes =
        (pending.end_ms.saturating_sub(pending.start_ms) as f64) / 60_000.0;
    let computed = (chunk_duration_minutes
        * config.max_words_per_minute as f64
        * config.tokens_per_word
        * config.output_token_buffer_factor)
        .ceil() as u32;
    let computed = computed.saturating_add(config.fixed_output_token_budget);
    let computed = config
        .min_output_tokens
        .map_or(computed, |min_output_tokens| {
            computed.max(min_output_tokens)
        });
    config
        .max_output_tokens
        .map_or(computed, |max_output_tokens| {
            computed.min(max_output_tokens)
        })
}

fn looks_like_hallucination_loop(
    config: &crate::config::AudioTranscriptionConfig,
    transcript: &str,
) -> bool {
    let words = transcript
        .split_whitespace()
        .map(|word| {
            word.trim_matches(|ch: char| !ch.is_alphanumeric())
                .to_lowercase()
        })
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>();
    if words.len() < config.min_words_for_loop_check {
        return false;
    }
    let unique_words = words.iter().collect::<HashSet<_>>().len();
    let unique_ratio = unique_words as f64 / words.len() as f64;
    unique_ratio < config.min_unique_word_ratio
}

async fn retry_failed_chunks(
    app_state: &AppState,
    session: &mut AudioSession,
) -> Result<ServerControlFrame, Report> {
    let failed_chunks = session
        .metadata
        .chunks
        .as_ref()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|chunk| chunk.status == "failed")
        .collect::<Vec<_>>();
    if failed_chunks.is_empty() {
        return Ok(session_state_frame(session));
    }

    session.metadata.status = "transcribing".to_string();
    session.metadata.error = None;
    persist_session_metadata(app_state, session).await?;

    for chunk in failed_chunks {
        let byte_start = chunk
            .byte_start
            .ok_or_eyre("Cannot retry failed audio chunk without byte_start")?;
        let byte_end = chunk
            .byte_end
            .ok_or_eyre("Cannot retry failed audio chunk without byte_end")?;
        let bytes = app_state
            .default_file_storage_provider()
            .read_range(&session.file_upload.file_storage_path, byte_start, byte_end)
            .await?;
        let provider_audio_bytes = if byte_start == 0 {
            validate_canonical_wav(&bytes)?;
            bytes
        } else {
            validate_pcm_payload(&bytes)?;
            build_wav_from_pcm(&bytes)
        };
        let pending = PendingChunk {
            chunk_index: chunk.index,
            start_ms: chunk.start_ms.unwrap_or_default(),
            end_ms: chunk.end_ms.unwrap_or_default(),
            content_type: if byte_start == 0 {
                CANONICAL_AUDIO_CONTENT_TYPE.to_string()
            } else {
                "audio/pcm".to_string()
            },
        };

        match transcribe_audio_chunk_with_retry(
            app_state,
            AudioFeature::Transcription,
            &pending,
            provider_audio_bytes,
        )
        .await
        {
            Ok(transcribed_chunk) => {
                update_chunk_status(
                    &mut session.metadata,
                    ChunkStatusUpdate {
                        chunk_index: chunk.index,
                        status: "completed",
                        byte_start: Some(byte_start),
                        byte_end: Some(byte_end),
                        transcript: Some(transcribed_chunk.transcript.clone()),
                        error: None,
                        attempts: chunk.attempts + transcribed_chunk.attempts,
                    },
                );
                upsert_segment(
                    &mut session.metadata,
                    chunk.index,
                    pending.start_ms,
                    pending.end_ms,
                    transcribed_chunk.transcript,
                );
            }
            Err(error) => {
                update_chunk_status(
                    &mut session.metadata,
                    ChunkStatusUpdate {
                        chunk_index: chunk.index,
                        status: "failed",
                        byte_start: Some(byte_start),
                        byte_end: Some(byte_end),
                        transcript: None,
                        error: Some(error.to_string()),
                        attempts: chunk.attempts
                            + app_state.config.audio_transcription.max_attempts,
                    },
                );
                session.metadata.status = "failed".to_string();
                session.metadata.error = Some(error.to_string());
                session.metadata.progress = Some(progress_for_metadata(&session.metadata));
                persist_session_metadata(app_state, session).await?;
                return Ok(ServerControlFrame::ChunkFailed {
                    file_upload_id: session.file_upload.id.to_string(),
                    chunk_index: chunk.index,
                    error: error.to_string(),
                    audio_transcription: session.metadata.clone(),
                });
            }
        }
    }

    session.metadata.transcript = aggregate_completed_transcript(&session.metadata);
    session.metadata.progress = Some(progress_for_metadata(&session.metadata));
    session.metadata.status = if session
        .metadata
        .chunks
        .as_ref()
        .is_some_and(|chunks| chunks.iter().all(|chunk| chunk.status == "completed"))
    {
        "completed".to_string()
    } else {
        "transcribing".to_string()
    };
    persist_session_metadata(app_state, session).await?;

    Ok(session_state_frame(session))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_canonical_wav() {
        let wav = build_wav_from_pcm(&[0u8; 320]);
        validate_canonical_wav(&wav).expect("canonical WAV should validate");
    }

    #[test]
    fn rejects_wrong_sample_rate_wav() {
        let mut wav = build_wav_from_pcm(&[0u8; 320]);
        wav[24..28].copy_from_slice(&48_000u32.to_le_bytes());
        let error = validate_canonical_wav(&wav).expect_err("wrong sample rate should fail");
        assert!(error.to_string().contains("Unsupported WAV format"));
    }

    #[test]
    fn derives_audio_transcription_output_tokens_from_chunk_duration() {
        let config = crate::config::AppConfig {
            audio_transcription: crate::config::AudioTranscriptionConfig {
                enabled: true,
                chunk_duration_seconds: 30,
                max_words_per_minute: 200,
                tokens_per_word: 1.5,
                output_token_buffer_factor: 2.0,
                fixed_output_token_budget: 500,
                min_output_tokens: None,
                max_output_tokens: None,
                ..Default::default()
            },
            ..Default::default()
        };
        let pending = PendingChunk {
            chunk_index: 0,
            start_ms: 0,
            end_ms: 30_000,
            content_type: CANONICAL_AUDIO_CONTENT_TYPE.to_string(),
        };

        assert_eq!(
            max_output_tokens_for_chunk_config(&config.audio_transcription, &pending),
            800
        );
    }

    #[test]
    fn parses_audio_dictation_start_without_chat_or_file_upload() {
        let frame: DictationClientControlFrame =
            serde_json::from_str(r#"{"type":"start","chunk_duration_ms":5000}"#)
                .expect("dictation start should parse");

        match frame {
            DictationClientControlFrame::Start { chunk_duration_ms } => {
                assert_eq!(chunk_duration_ms, Some(5000));
            }
            _ => panic!("expected dictation start frame"),
        }
    }

    #[test]
    fn serializes_audio_dictation_transcript_without_file_upload_state() {
        let frame = DictationServerControlFrame::ChunkTranscribed {
            chunk_index: 2,
            transcript: "hello from dictation".to_string(),
        };

        let value = serde_json::to_value(frame).expect("dictation frame should serialize");
        assert_eq!(value["type"], "chunk_transcribed");
        assert_eq!(value["chunk_index"], 2);
        assert_eq!(value["transcript"], "hello from dictation");
        assert!(value.get("file_upload_id").is_none());
        assert!(value.get("audio_transcription").is_none());
    }

    #[test]
    fn audio_dictation_reuses_chunk_content_type_rules() {
        assert_eq!(
            resolve_chunk_content_type(0, None).expect("first chunk default should resolve"),
            CANONICAL_AUDIO_CONTENT_TYPE
        );
        assert_eq!(
            resolve_chunk_content_type(1, None).expect("later chunk default should resolve"),
            "audio/pcm"
        );
        assert!(resolve_chunk_content_type(0, Some("audio/pcm".to_string())).is_err());
        assert!(resolve_chunk_content_type(1, Some("audio/mpeg".to_string())).is_err());
    }

    #[test]
    fn audio_dictation_limits_can_differ_from_audio_transcription_limits() {
        let transcription_config = crate::config::AudioTranscriptionConfig {
            max_recording_duration_seconds: 1200,
            ..Default::default()
        };
        let dictation_config = crate::config::AudioTranscriptionConfig {
            max_recording_duration_seconds: 5,
            ..Default::default()
        };

        assert!(enforce_audio_duration_limit_config(&dictation_config, 5_001).is_err());
        assert!(enforce_audio_duration_limit_config(&transcription_config, 5_001).is_ok());
        assert!(
            canonical_audio_max_bytes_for_config(&dictation_config)
                < canonical_audio_max_bytes_for_config(&transcription_config)
        );
    }

    #[test]
    fn audio_provider_kind_rejects_openai_responses_until_audio_is_supported() {
        assert!(!audio_provider_kind_supports_binary_audio(
            "openai_responses"
        ));
        assert!(!audio_provider_kind_supports_binary_audio(
            "azure_openai_responses"
        ));
        assert!(audio_provider_kind_supports_binary_audio("openai"));
        assert!(audio_provider_kind_supports_binary_audio("gemini"));
    }
}
