//! What the voice says while the user waits for an answer in conversational
//! audio mode. The fixed lines are said in the answer's own voice: they are
//! synthesised with the conversational speech provider and kept under a key
//! that holds everything that shapes that voice, so a deployment that
//! changes its voice, model or provider gets new lines on the next request
//! and never mixes two voices. A tool call's line names what the call
//! reads, so it is synthesised when it is said, and only while the user's
//! own answer is still being generated.

use super::me_profile_middleware::MeProfile;
use super::read_aloud::{speech_language, speech_response};
use super::starting_assistant::{AudienceIdentity, subject_matches};
use crate::config::SpeechProviderConfig;
use crate::distribution::experience_policy::{
    AudienceWaitLines, ExperiencePolicyDocument, WAIT_LINES_SETTING, resolution_order_for,
};
use crate::models::chat::get_chat_by_message_id;
use crate::policy::engine::PolicyEngine;
use crate::services::sentry::log_internal_server_error;
use crate::services::speech::{self, CompleteAudio};
use crate::state::AppState;
use axum::{
    Extension, Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::Response,
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use chrono::{DateTime, Utc};
use erato_config::wait_lines::{WaitLineSlot, WaitLinesAmount, WaitLinesConfig};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::{Arc, LazyLock};
use std::time::Duration;
use utoipa::ToSchema;
use uuid::Uuid;

/// Where the caller's amount comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WaitLinesSource {
    Deployment,
    Audience,
    User,
}

/// When lines are due, in milliseconds from the end of the user's speech
/// unless said otherwise.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct WaitLinesTiming {
    pub first_after_ms: u32,
    /// From the start of a tool call.
    pub tool_after_ms: u32,
    pub still_after_ms: u32,
    /// Silence before the "still on it" line, from the end of the last line.
    pub still_quiet_ms: u32,
    pub long_after_ms: u32,
    /// After the long line, between "still on it" lines; `0` says it no more.
    pub still_repeat_ms: u32,
    /// From the end of one line to the start of the next.
    pub min_gap_ms: u32,
    pub max_per_turn: u32,
    /// Turns with an opener before the opener comes from the short set; `0`
    /// never shortens.
    pub taper_after_turns: u32,
}

/// One fixed line, ready to play.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct WaitLineAudio {
    pub slot: WaitLineSlot,
    pub text: String,
    /// Base64 of signed 16-bit little-endian mono PCM.
    pub audio: String,
    pub sample_rate: u32,
}

/// Templates for a running tool call's line. `search` holds `{search}`;
/// `items` and `list` hold `{table}`. Absent ones say nothing.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, ToSchema)]
pub struct WaitLineToolTemplates {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub search: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub items: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub list: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct WaitLinesResponse {
    pub amount: WaitLinesAmount,
    /// Where the last value that applied came from.
    pub source: WaitLinesSource,
    /// The audience whose value applies, by its display name.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub audience: Option<String>,
    /// Whether the caller may choose their own amount.
    pub user_choice: bool,
    /// The language the lines are in: the language the voice speaks to the
    /// caller.
    pub language: String,
    /// Changes whenever the voice that says the lines changes.
    pub voice: String,
    /// Changes whenever anything here changes: the voice, the language, the
    /// words, the timings or the amount. A client keeps its lines only as
    /// long as this stays the same.
    pub version: String,
    /// The caller already has this `version`: `lines` is left empty and
    /// nothing is synthesised.
    pub unchanged: bool,
    pub timing: WaitLinesTiming,
    /// Empty when the amount is `off`, in a language without lines, or when
    /// the voice could not say them.
    pub lines: Vec<WaitLineAudio>,
    pub tools: WaitLineToolTemplates,
}

/// The active audiences in the wait-lines order that match the caller and
/// set a value, first one first.
pub fn matching_audiences<'a>(
    policy: &'a ExperiencePolicyDocument,
    identity: AudienceIdentity<'_>,
    now: DateTime<Utc>,
) -> Vec<(&'a str, &'a AudienceWaitLines)> {
    resolution_order_for(policy, WAIT_LINES_SETTING)
        .filter_map(|(name, audience)| {
            let lines = audience.wait_lines.as_ref()?;
            (audience.is_active_at(now)
                && audience
                    .subjects
                    .iter()
                    .any(|subject| subject_matches(subject, identity)))
            .then_some((name, lines))
        })
        .collect()
}

/// The amount in resolution order: deployment, audiences, the user's own
/// where allowed. Each setting comes from the first audience that sets it.
pub fn resolve(
    config: &WaitLinesConfig,
    audiences: &[(&str, &AudienceWaitLines)],
    own: Option<WaitLinesAmount>,
) -> (WaitLinesAmount, WaitLinesSource, Option<String>, bool) {
    let amount = audiences
        .iter()
        .find_map(|(_, set)| set.amount)
        .unwrap_or(config.amount);
    let user_choice = audiences
        .iter()
        .find_map(|(_, set)| set.user_choice)
        .unwrap_or(config.user_choice);
    let (mut source, audience) = match audiences.first() {
        Some((name, _)) => (WaitLinesSource::Audience, Some((*name).to_string())),
        None => (WaitLinesSource::Deployment, None),
    };
    let mut amount = amount;
    if user_choice && let Some(own) = own {
        amount = own;
        source = WaitLinesSource::User;
    }
    (amount, source, audience, user_choice)
}

/// Everything that shapes how the voice sounds, and nothing secret: two
/// providers with the same fingerprint say a line the same way.
pub fn voice_fingerprint(provider_id: &str, config: &SpeechProviderConfig) -> String {
    let mut hasher = Sha256::new();
    let sample_rate = config.sample_rate.to_string();
    for part in [
        provider_id,
        config.provider_kind.as_str(),
        config.model_name.as_str(),
        config.voice.as_str(),
        config.base_url.as_deref().unwrap_or_default(),
        config.instructions.as_deref().unwrap_or_default(),
        config.project_id.as_deref().unwrap_or_default(),
        config.location.as_deref().unwrap_or_default(),
        sample_rate.as_str(),
    ] {
        hasher.update(part.as_bytes());
        hasher.update([0u8]);
    }
    hasher
        .finalize()
        .iter()
        .take(16)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// The version of what a caller hears: everything the response holds,
/// except the audio, which follows from the voice and the words.
fn version_of(
    voice: &str,
    language: &str,
    amount: WaitLinesAmount,
    timing: &WaitLinesTiming,
    set: &erato_config::wait_lines::WaitLineSet,
) -> String {
    let mut hasher = Sha256::new();
    let parts = serde_json::json!([
        voice,
        language,
        amount,
        [
            timing.first_after_ms,
            timing.tool_after_ms,
            timing.still_after_ms,
            timing.still_quiet_ms,
            timing.long_after_ms,
            timing.still_repeat_ms,
            timing.min_gap_ms,
            timing.max_per_turn,
            timing.taper_after_turns,
        ],
        set.lines,
        [&set.search, &set.items, &set.list],
    ]);
    hasher.update(parts.to_string().as_bytes());
    hasher
        .finalize()
        .iter()
        .take(16)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Lines said once are kept per voice, language and text. A changed voice
/// has a new fingerprint, so its old lines are never played and age out.
static CLIPS: LazyLock<moka::future::Cache<String, Arc<CompleteAudio>>> = LazyLock::new(|| {
    moka::future::Cache::builder()
        .max_capacity(512)
        .time_to_idle(Duration::from_secs(7 * 24 * 3600))
        .build()
});

/// A line the voice could not say is not asked for again for a minute, so a
/// broken provider is not asked for every line at every turn.
static FAILED: LazyLock<moka::future::Cache<String, ()>> = LazyLock::new(|| {
    moka::future::Cache::builder()
        .max_capacity(512)
        .time_to_live(Duration::from_secs(60))
        .build()
});

const SYNTHESIS_TIMEOUT: Duration = Duration::from_secs(20);
/// Lines synthesised at once on a cold cache.
const PARALLEL_SYNTHESES: usize = 4;

async fn clip(
    config: &SpeechProviderConfig,
    voice: &str,
    language: &str,
    text: &str,
) -> Result<Arc<CompleteAudio>, Arc<eyre::Report>> {
    let key = format!("{voice}\n{language}\n{text}");
    if FAILED.contains_key(&key) {
        return Err(Arc::new(eyre::eyre!(
            "The voice failed on this line less than a minute ago"
        )));
    }
    let result = CLIPS
        .try_get_with(key.clone(), async {
            let provider = speech::provider(config)?;
            let audio = tokio::time::timeout(SYNTHESIS_TIMEOUT, provider.synthesize(text))
                .await
                .map_err(|_| eyre::eyre!("Speech for a wait line timed out"))?;
            let _ = provider.finish().await;
            Ok::<_, eyre::Report>(Arc::new(audio?))
        })
        .await;
    if result.is_err() {
        FAILED.insert(key, ()).await;
    }
    result
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct WaitLinesQuery {
    /// The `version` the caller already has.
    #[serde(default)]
    #[param(required = false)]
    pub known: String,
}

/// What the voice says while the caller waits, and the audio of its fixed
/// lines in the caller's language.
#[utoipa::path(
    get,
    path = "/me/wait-lines",
    params(WaitLinesQuery),
    responses(
        (status = OK, body = WaitLinesResponse),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided"),
        (status = NOT_FOUND, description = "Conversational audio mode has no voice")
    ),
    security(("bearer_auth" = []))
)]
pub async fn wait_lines(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Query(query): Query<WaitLinesQuery>,
) -> Result<Json<WaitLinesResponse>, StatusCode> {
    let Some((provider_id, provider_config)) = app_state.config.conversational_speech_provider()
    else {
        return Err(StatusCode::NOT_FOUND);
    };
    let config = &app_state.config.audio_conversational.wait_lines;
    let experience_policy = { app_state.reloadable.read().await.experience_policy.clone() };
    let identity = AudienceIdentity::from_profile(&me_user);
    let audiences = experience_policy
        .as_ref()
        .map(|policy| matching_audiences(policy, identity, Utc::now()))
        .unwrap_or_default();
    let (amount, source, audience, user_choice) =
        resolve(config, &audiences, me_user.preference_wait_lines_amount);

    let language = speech_language(&me_user).code().to_string();
    let voice = voice_fingerprint(provider_id, provider_config);
    let set = config.set_for(&language);
    let timing = WaitLinesTiming {
        first_after_ms: config.first_after_ms,
        tool_after_ms: config.tool_after_ms,
        still_after_ms: config.still_after_ms,
        still_quiet_ms: config.still_quiet_ms,
        long_after_ms: config.long_after_ms,
        still_repeat_ms: config.still_repeat_ms,
        min_gap_ms: config.min_gap_ms,
        max_per_turn: config.max_per_turn,
        taper_after_turns: config.taper_after_turns,
    };
    let version = version_of(&voice, &language, amount, &timing, &set);
    let unchanged = query.known == version;
    let lines = if amount == WaitLinesAmount::Off || unchanged {
        Vec::new()
    } else {
        let provider_config = Arc::new(provider_config.clone());
        futures::stream::iter(set.lines.clone())
            .map(|(slot, text)| {
                let provider_config = Arc::clone(&provider_config);
                let voice = voice.clone();
                let language = language.clone();
                async move {
                    match clip(&provider_config, &voice, &language, &text).await {
                        Ok(audio) => Some(WaitLineAudio {
                            slot,
                            audio: STANDARD.encode(&audio.pcm),
                            sample_rate: audio.sample_rate,
                            text,
                        }),
                        Err(error) => {
                            tracing::warn!(%error, "A wait line could not be said");
                            None
                        }
                    }
                }
            })
            .buffered(PARALLEL_SYNTHESES)
            .filter_map(futures::future::ready)
            .collect()
            .await
    };

    Ok(Json(WaitLinesResponse {
        amount,
        source,
        audience,
        user_choice,
        language,
        voice,
        version,
        unchanged,
        timing,
        lines,
        tools: WaitLineToolTemplates {
            search: set.search,
            items: set.items,
            list: set.list,
        },
    }))
}

/// A running tool call's line is a sentence, not a text to read.
pub const MAX_PROGRESS_CHARS: usize = 160;

#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct ProgressSpeechRequest {
    /// The line, composed by the client from the tool call's label.
    pub text: String,
}

/// Says one line about a running tool call of the caller's own answer.
///
/// Answers only while that answer is still being generated, and only for a
/// short sentence: the voice never says free text at any other time.
#[utoipa::path(
    post,
    path = "/me/messages/{message_id}/progress-speech",
    params(("message_id" = Uuid, Path, description = "The assistant message being generated")),
    request_body = ProgressSpeechRequest,
    responses(
        (status = OK, content_type = "text/event-stream", body = super::read_aloud::ReadAloudStreamEvent),
        (status = BAD_REQUEST, description = "The line is empty, too long or holds control characters"),
        (status = NOT_FOUND, description = "No voice, or the message is not in the caller's own chat"),
        (status = CONFLICT, description = "The answer is no longer being generated")
    ),
    security(("bearer_auth" = []))
)]
pub async fn progress_speech(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    Path(message_id): Path<Uuid>,
    Json(request): Json<ProgressSpeechRequest>,
) -> Result<Response, StatusCode> {
    let Some((_, provider_config)) = app_state.config.conversational_speech_provider() else {
        return Err(StatusCode::NOT_FOUND);
    };
    let text = request.text.trim();
    if text.is_empty()
        || text.chars().count() > MAX_PROGRESS_CHARS
        || text.chars().any(char::is_control)
        || erato_config::config::has_hidden_chars(text)
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    policy
        .rebuild_data_if_needed_req(&app_state.db, &app_state.config)
        .await?;
    let subject = me_user.to_subject();
    let chat = get_chat_by_message_id(&app_state.db, &policy, &subject, &message_id)
        .await
        .map_err(|error| {
            let text = error.to_string().to_lowercase();
            if text.contains("not found") || text.contains("not authorized") {
                StatusCode::NOT_FOUND
            } else {
                log_internal_server_error(error)
            }
        })?;
    if chat.owner_user_id != me_user.id {
        return Err(StatusCode::NOT_FOUND);
    }
    let generating = app_state
        .background_tasks
        .active_generation(&chat.id)
        .await
        .and_then(|generation| generation.message_id())
        == Some(message_id);
    if !generating {
        return Err(StatusCode::CONFLICT);
    }
    let language = speech_language(&me_user);
    speech_response(
        provider_config,
        &[text.to_string()],
        &language,
        false,
        message_id,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn audience(amount: Option<WaitLinesAmount>, user_choice: Option<bool>) -> AudienceWaitLines {
        AudienceWaitLines {
            amount,
            user_choice,
        }
    }

    #[test]
    fn the_deployment_then_the_audience_then_the_user_where_allowed() {
        let config = WaitLinesConfig::default();
        let (amount, source, _, choice) = resolve(&config, &[], None);
        assert_eq!(amount, WaitLinesAmount::Normal);
        assert_eq!(source, WaitLinesSource::Deployment);
        assert!(choice);

        let sales = audience(Some(WaitLinesAmount::LongOnly), None);
        let (amount, source, name, _) = resolve(&config, &[("Vertrieb", &sales)], None);
        assert_eq!(amount, WaitLinesAmount::LongOnly);
        assert_eq!(source, WaitLinesSource::Audience);
        assert_eq!(name.as_deref(), Some("Vertrieb"));

        let (amount, source, _, _) =
            resolve(&config, &[("Vertrieb", &sales)], Some(WaitLinesAmount::Off));
        assert_eq!(amount, WaitLinesAmount::Off);
        assert_eq!(source, WaitLinesSource::User);

        // A supervisor who locks it keeps the user's own choice out.
        let locked = audience(None, Some(false));
        let (amount, source, _, choice) = resolve(
            &config,
            &[("Pilot", &locked), ("Vertrieb", &sales)],
            Some(WaitLinesAmount::Off),
        );
        assert_eq!(amount, WaitLinesAmount::LongOnly);
        assert_eq!(source, WaitLinesSource::Audience);
        assert!(!choice);
    }

    #[test]
    fn the_fingerprint_follows_the_voice_and_never_the_key() {
        let voice: SpeechProviderConfig = serde_json::from_value(serde_json::json!({
            "provider_kind": "openai", "model_name": "tts", "voice": "alloy", "api_key": "one"
        }))
        .unwrap();
        let same_with_other_key: SpeechProviderConfig = serde_json::from_value(serde_json::json!({
            "provider_kind": "openai", "model_name": "tts", "voice": "alloy", "api_key": "two"
        }))
        .unwrap();
        let other_voice: SpeechProviderConfig = serde_json::from_value(serde_json::json!({
            "provider_kind": "openai", "model_name": "tts", "voice": "nova", "api_key": "one"
        }))
        .unwrap();
        let other_model: SpeechProviderConfig = serde_json::from_value(serde_json::json!({
            "provider_kind": "openai", "model_name": "tts-2", "voice": "alloy", "api_key": "one"
        }))
        .unwrap();
        let base = voice_fingerprint("assistant_voice", &voice);
        assert_eq!(
            base,
            voice_fingerprint("assistant_voice", &same_with_other_key)
        );
        assert_ne!(base, voice_fingerprint("assistant_voice", &other_voice));
        assert_ne!(base, voice_fingerprint("assistant_voice", &other_model));
        assert_ne!(base, voice_fingerprint("other_voice", &voice));
        assert_eq!(base.len(), 32);
    }
}
