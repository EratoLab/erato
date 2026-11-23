//! How a reply is spoken in conversational audio mode for the caller: the
//! deployment's default, a supervisor's value for an audience the caller is
//! in, and the caller's own choice where that is allowed, in this order. The
//! server resolves it again at turn time with the same `resolve`, so a user
//! value the admin does not allow never shapes a turn.

use super::me_profile_middleware::MeProfile;
use super::starting_assistant::{AudienceIdentity, matching_blocks, user_choice_open};
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
    /// Whether replies are spoken in conversational audio mode.
    pub spoken: bool,
    /// Where `spoken` comes from. The caller's own value counts only where
    /// `user_choice` allows it.
    pub spoken_source: ReplySpeechStyleSource,
    pub wording: ReplySpeechWording,
    /// Where the last value that applied came from.
    pub source: ReplySpeechStyleSource,
    /// The audience whose value applies, by its display name.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub audience: Option<String>,
    /// Whether the caller may choose their own wording and whether replies
    /// are spoken.
    pub user_choice: bool,
    /// Whether the chat shows what the voice said: the spoken text, folded,
    /// and a play button where the recording was kept. The caller may always
    /// choose it for themselves: it changes only what they see.
    pub show_in_chat: bool,
    /// Where `show_in_chat` comes from.
    pub show_in_chat_source: ReplySpeechStyleSource,
}

pub fn matching_audiences<'a>(
    policy: &'a ExperiencePolicyDocument,
    identity: AudienceIdentity<'_>,
    now: DateTime<Utc>,
) -> Vec<(&'a str, &'a AudienceReplySpeech)> {
    matching_blocks(
        policy,
        REPLY_SPEECH_SETTING,
        |audience| audience.reply_speech.as_ref(),
        identity,
        now,
    )
}

/// The caller's own values, from their preferences.
#[derive(Debug, Clone, Copy, Default)]
pub struct OwnReplySpeech {
    pub spoken: Option<bool>,
    pub wording: Option<ReplySpeechWording>,
    pub show_in_chat: Option<bool>,
}

/// Each field comes from the first audience in the order that sets it, else
/// from the deployment; the user's own wording and `spoken` count only where
/// allowed, and their own `show_in_chat` always.
pub fn resolve(
    config: &ReplySpeechConfig,
    audiences: &[(&str, &AudienceReplySpeech)],
    own: OwnReplySpeech,
) -> ReplySpeechStyleResponse {
    let mut style = ReplySpeechStyleResponse {
        spoken: config.spoken,
        spoken_source: ReplySpeechStyleSource::Deployment,
        wording: audiences
            .iter()
            .find_map(|(_, set)| set.wording)
            .unwrap_or(config.wording),
        source: ReplySpeechStyleSource::Deployment,
        audience: None,
        user_choice: user_choice_open(
            config.user_choice,
            audiences.iter().map(|(_, set)| set.user_choice),
        ),
        show_in_chat: config.show_in_chat,
        show_in_chat_source: ReplySpeechStyleSource::Deployment,
    };
    if let Some(spoken) = audiences.iter().find_map(|(_, set)| set.spoken) {
        style.spoken = spoken;
        style.spoken_source = ReplySpeechStyleSource::Audience;
    }
    if style.user_choice
        && let Some(spoken) = own.spoken
    {
        style.spoken = spoken;
        style.spoken_source = ReplySpeechStyleSource::User;
    }
    if let Some(shown) = audiences.iter().find_map(|(_, set)| set.show_in_chat) {
        style.show_in_chat = shown;
        style.show_in_chat_source = ReplySpeechStyleSource::Audience;
    }
    if let Some(shown) = own.show_in_chat {
        style.show_in_chat = shown;
        style.show_in_chat_source = ReplySpeechStyleSource::User;
    }
    if let Some((name, _)) = audiences.first() {
        style.source = ReplySpeechStyleSource::Audience;
        style.audience = Some((*name).to_string());
    }
    if style.user_choice
        && let Some(wording) = own.wording
    {
        style.wording = wording;
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
        OwnReplySpeech {
            spoken: me_user.preference_reply_speech_spoken,
            wording: me_user.preference_reply_speech_wording,
            show_in_chat: me_user.preference_reply_speech_show_in_chat,
        },
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
            spoken: None,
            wording,
            user_choice,
            show_in_chat: None,
        }
    }

    fn own(wording: ReplySpeechWording) -> OwnReplySpeech {
        OwnReplySpeech {
            spoken: None,
            wording: Some(wording),
            show_in_chat: None,
        }
    }

    #[test]
    fn the_deployment_then_the_audience_then_the_user_where_allowed() {
        let config = ReplySpeechConfig::default();
        let plain = resolve(&config, &[], OwnReplySpeech::default());
        assert_eq!(plain.wording, ReplySpeechWording::Precise);
        assert_eq!(plain.source, ReplySpeechStyleSource::Deployment);
        assert!(plain.user_choice);

        let natural = audience(Some(ReplySpeechWording::Natural), None);
        let by_audience = resolve(
            &config,
            &[("Vertrieb", &natural)],
            OwnReplySpeech::default(),
        );
        assert_eq!(by_audience.wording, ReplySpeechWording::Natural);
        assert_eq!(by_audience.audience.as_deref(), Some("Vertrieb"));

        let own = resolve(
            &config,
            &[("Vertrieb", &natural)],
            own(ReplySpeechWording::Precise),
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
            own(ReplySpeechWording::Precise),
        );
        assert_eq!(kept.wording, ReplySpeechWording::Natural);
        assert_eq!(kept.source, ReplySpeechStyleSource::Audience);
        assert!(!kept.user_choice);

        let closed = ReplySpeechConfig {
            wording: ReplySpeechWording::Natural,
            user_choice: false,
            ..ReplySpeechConfig::default()
        };
        assert_eq!(
            resolve(&closed, &[], own(ReplySpeechWording::Precise)).wording,
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
            own(ReplySpeechWording::Precise),
        );
        assert_eq!(style.wording, ReplySpeechWording::Natural);
        assert!(!style.user_choice);
        assert_eq!(style.audience.as_deref(), Some("Pilot"));
    }

    #[test]
    fn the_spoken_trace_is_hidden_unless_someone_shows_it() {
        let config = ReplySpeechConfig::default();
        assert!(!resolve(&config, &[], OwnReplySpeech::default()).show_in_chat);

        let shown = AudienceReplySpeech {
            show_in_chat: Some(true),
            ..AudienceReplySpeech::default()
        };
        let by_audience = resolve(&config, &[("Vertrieb", &shown)], OwnReplySpeech::default());
        assert!(by_audience.show_in_chat);
        assert_eq!(
            by_audience.show_in_chat_source,
            ReplySpeechStyleSource::Audience
        );

        let hide = OwnReplySpeech {
            show_in_chat: Some(false),
            ..OwnReplySpeech::default()
        };
        let mine = resolve(&config, &[("Vertrieb", &shown)], hide);
        assert!(!mine.show_in_chat);
        assert_eq!(mine.show_in_chat_source, ReplySpeechStyleSource::User);
        assert_eq!(mine.source, ReplySpeechStyleSource::Audience);
    }

    #[test]
    fn a_wording_lock_leaves_showing_the_trace_to_the_user() {
        let locked = AudienceReplySpeech {
            wording: Some(ReplySpeechWording::Natural),
            user_choice: Some(false),
            show_in_chat: Some(false),
            ..AudienceReplySpeech::default()
        };
        let style = resolve(
            &ReplySpeechConfig::default(),
            &[("Vertrieb", &locked)],
            OwnReplySpeech {
                wording: Some(ReplySpeechWording::Precise),
                show_in_chat: Some(true),
                ..OwnReplySpeech::default()
            },
        );
        assert_eq!(style.wording, ReplySpeechWording::Natural);
        assert!(!style.user_choice);
        assert!(style.show_in_chat);
        assert_eq!(style.show_in_chat_source, ReplySpeechStyleSource::User);
    }

    #[test]
    fn replies_are_spoken_unless_turned_off_where_allowed() {
        let config = ReplySpeechConfig::default();
        let on = resolve(&config, &[], OwnReplySpeech::default());
        assert!(on.spoken);
        assert_eq!(on.spoken_source, ReplySpeechStyleSource::Deployment);

        let off = OwnReplySpeech {
            spoken: Some(false),
            ..OwnReplySpeech::default()
        };
        let mine = resolve(&config, &[], off);
        assert!(!mine.spoken);
        assert_eq!(mine.spoken_source, ReplySpeechStyleSource::User);

        let quiet = AudienceReplySpeech {
            spoken: Some(false),
            ..AudienceReplySpeech::default()
        };
        let by_audience = resolve(&config, &[("Vertrieb", &quiet)], OwnReplySpeech::default());
        assert!(!by_audience.spoken);
        assert_eq!(by_audience.spoken_source, ReplySpeechStyleSource::Audience);

        let forced = AudienceReplySpeech {
            spoken: Some(true),
            user_choice: Some(false),
            ..AudienceReplySpeech::default()
        };
        let kept = resolve(&config, &[("Vertrieb", &forced)], off);
        assert!(kept.spoken);
        assert_eq!(kept.spoken_source, ReplySpeechStyleSource::Audience);

        let closed = ReplySpeechConfig {
            spoken: false,
            user_choice: false,
            ..ReplySpeechConfig::default()
        };
        let on_mine = OwnReplySpeech {
            spoken: Some(true),
            ..OwnReplySpeech::default()
        };
        assert!(!resolve(&closed, &[], on_mine).spoken);
    }
}
