//! How a reply is spoken in conversational audio mode for the caller: the
//! deployment's default, a supervisor's value for an audience the caller is
//! in, and the caller's own choice where that is allowed, in this order. The
//! server resolves it again at turn time with the same `resolve`, so a user
//! value the admin does not allow never shapes a turn.

use super::me_profile_middleware::MeProfile;
use super::starting_assistant::{AudienceIdentity, matching_audiences_for};
use crate::distribution::experience_policy::{
    AudienceReplySpeech, ExperiencePolicyDocument, REPLY_SPEECH_SETTING,
};
use crate::state::AppState;
use axum::{Extension, Json, extract::State, http::StatusCode};
use chrono::{DateTime, Utc};
use erato_config::reply_speech::{ReplySpeechConfig, ReplySpeechWording};
use serde::Serialize;
use utoipa::ToSchema;

/// Where the caller's reply wording comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReplySpeechStyleSource {
    Deployment,
    Audience,
    User,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct ReplySpeechStyleResponse {
    pub wording: ReplySpeechWording,
    /// Where the last value that applied came from.
    pub source: ReplySpeechStyleSource,
    /// The audience whose value applies, by its display name.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub audience: Option<String>,
    /// Whether the caller may choose their own wording.
    pub user_choice: bool,
}

pub fn matching_audiences<'a>(
    policy: &'a ExperiencePolicyDocument,
    identity: AudienceIdentity<'_>,
    now: DateTime<Utc>,
) -> Vec<(&'a str, &'a AudienceReplySpeech)> {
    matching_audiences_for(policy, REPLY_SPEECH_SETTING, identity, now, |audience| {
        audience.reply_speech.as_ref()
    })
}

/// Each field comes from the first audience in the order that sets it, else
/// from the deployment; the user's own value counts only where allowed.
pub fn resolve(
    config: &ReplySpeechConfig,
    audiences: &[(&str, &AudienceReplySpeech)],
    own: Option<ReplySpeechWording>,
) -> ReplySpeechStyleResponse {
    let mut style = ReplySpeechStyleResponse {
        wording: audiences
            .iter()
            .find_map(|(_, set)| set.wording)
            .unwrap_or(config.wording),
        source: ReplySpeechStyleSource::Deployment,
        audience: None,
        user_choice: audiences
            .iter()
            .find_map(|(_, set)| set.user_choice)
            .unwrap_or(config.user_choice),
    };
    if let Some((name, _)) = audiences.first() {
        style.source = ReplySpeechStyleSource::Audience;
        style.audience = Some((*name).to_string());
    }
    if style.user_choice
        && let Some(own) = own
    {
        style.wording = own;
        style.source = ReplySpeechStyleSource::User;
    }
    style
}

/// The caller's reply style, read from the live experience policy.
pub async fn resolve_for(app_state: &AppState, me_user: &MeProfile) -> ReplySpeechStyleResponse {
    let experience_policy = { app_state.reloadable.read().await.experience_policy.clone() };
    let identity = AudienceIdentity::from_profile(me_user);
    let audiences = experience_policy
        .as_ref()
        .map(|policy| matching_audiences(policy, identity, Utc::now()))
        .unwrap_or_default();
    resolve(
        &app_state.config.audio_conversational.reply_speech,
        &audiences,
        me_user.preference_reply_speech_wording,
    )
}

/// How replies are spoken for the caller in conversational audio mode.
#[utoipa::path(
    get,
    path = "/me/reply-speech-style",
    responses(
        (status = OK, body = ReplySpeechStyleResponse),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided")
    ),
    security(("bearer_auth" = []))
)]
pub async fn reply_speech_style(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
) -> Result<Json<ReplySpeechStyleResponse>, StatusCode> {
    Ok(Json(resolve_for(&app_state, &me_user).await))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn audience(
        wording: Option<ReplySpeechWording>,
        user_choice: Option<bool>,
    ) -> AudienceReplySpeech {
        AudienceReplySpeech {
            wording,
            user_choice,
        }
    }

    #[test]
    fn the_deployment_then_the_audience_then_the_user_where_allowed() {
        let config = ReplySpeechConfig::default();
        let plain = resolve(&config, &[], None);
        assert_eq!(plain.wording, ReplySpeechWording::Precise);
        assert_eq!(plain.source, ReplySpeechStyleSource::Deployment);
        assert!(plain.user_choice);

        let natural = audience(Some(ReplySpeechWording::Natural), None);
        let by_audience = resolve(&config, &[("Vertrieb", &natural)], None);
        assert_eq!(by_audience.wording, ReplySpeechWording::Natural);
        assert_eq!(by_audience.audience.as_deref(), Some("Vertrieb"));

        let own = resolve(
            &config,
            &[("Vertrieb", &natural)],
            Some(ReplySpeechWording::Precise),
        );
        assert_eq!(own.wording, ReplySpeechWording::Precise);
        assert_eq!(own.source, ReplySpeechStyleSource::User);
    }

    #[test]
    fn a_lock_keeps_the_users_own_value_out() {
        let config = ReplySpeechConfig::default();
        let locked = audience(Some(ReplySpeechWording::Natural), Some(false));
        let kept = resolve(
            &config,
            &[("Vertrieb", &locked)],
            Some(ReplySpeechWording::Precise),
        );
        assert_eq!(kept.wording, ReplySpeechWording::Natural);
        assert_eq!(kept.source, ReplySpeechStyleSource::Audience);
        assert!(!kept.user_choice);

        let closed = ReplySpeechConfig {
            wording: ReplySpeechWording::Natural,
            user_choice: false,
        };
        assert_eq!(
            resolve(&closed, &[], Some(ReplySpeechWording::Precise)).wording,
            ReplySpeechWording::Natural
        );
    }

    #[test]
    fn each_field_comes_from_the_first_audience_that_sets_it() {
        let config = ReplySpeechConfig::default();
        let lock_only = audience(None, Some(false));
        let wording_only = audience(Some(ReplySpeechWording::Natural), Some(true));
        let style = resolve(
            &config,
            &[("Pilot", &lock_only), ("Vertrieb", &wording_only)],
            Some(ReplySpeechWording::Precise),
        );
        assert_eq!(style.wording, ReplySpeechWording::Natural);
        assert!(!style.user_choice);
        assert_eq!(style.audience.as_deref(), Some("Pilot"));
    }
}
