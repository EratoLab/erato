//! How waiting approval cards are read aloud for the caller: the
//! deployment's default, a supervisor's value for an audience the caller is
//! in, and the caller's own choice where that is allowed, in this order.

use super::me_profile_middleware::MeProfile;
use super::starting_assistant::{AudienceIdentity, subject_matches};
use crate::config::{ApprovalSpeechAmount, ApprovalSpeechConfig, ApprovalSpeechWording};
use crate::distribution::experience_policy::{
    APPROVAL_SPEECH_SETTING, AudienceApprovalSpeech, ExperiencePolicyDocument, resolution_order_for,
};
use crate::state::AppState;
use axum::{Extension, Json, extract::State, http::StatusCode};
use chrono::{DateTime, Utc};
use serde::Serialize;
use utoipa::ToSchema;

/// Where the caller's reading style comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalSpeechStyleSource {
    Deployment,
    Audience,
    User,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct ApprovalSpeechStyleResponse {
    pub amount: ApprovalSpeechAmount,
    /// Details a short reading says before it holds back the rest.
    pub short_details: u8,
    pub wording: ApprovalSpeechWording,
    /// Where the last value that applied came from.
    pub source: ApprovalSpeechStyleSource,
    /// The audience whose value applies, by its display name.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub audience: Option<String>,
    /// Whether the caller may choose their own amount and wording.
    pub user_choice: bool,
}

/// The first active audience in the approval-speech order that matches the
/// caller and sets a value. Only audiences the admin listed under this
/// setting take part.
pub fn winning_audience<'a>(
    policy: &'a ExperiencePolicyDocument,
    identity: AudienceIdentity<'_>,
    now: DateTime<Utc>,
) -> Option<(&'a str, &'a AudienceApprovalSpeech)> {
    resolution_order_for(policy, APPROVAL_SPEECH_SETTING).find_map(|(name, audience)| {
        let speech = audience.approval_speech.as_ref()?;
        (audience.is_active_at(now)
            && audience
                .subjects
                .iter()
                .any(|subject| subject_matches(subject, identity)))
        .then_some((name, speech))
    })
}

/// The style in resolution order: deployment, audience, the user's own.
pub fn resolve(
    config: &ApprovalSpeechConfig,
    audience: Option<(&str, &AudienceApprovalSpeech)>,
    own_amount: Option<ApprovalSpeechAmount>,
    own_wording: Option<ApprovalSpeechWording>,
) -> ApprovalSpeechStyleResponse {
    let mut style = ApprovalSpeechStyleResponse {
        amount: config.amount,
        short_details: config.short_details.min(crate::config::MAX_SHORT_DETAILS),
        wording: config.wording,
        source: ApprovalSpeechStyleSource::Deployment,
        audience: None,
        user_choice: config.user_choice,
    };
    if let Some((name, set)) = audience {
        style.amount = set.amount.unwrap_or(style.amount);
        style.short_details = set.short_details.map_or(style.short_details, |value| {
            value.min(crate::config::MAX_SHORT_DETAILS)
        });
        style.wording = set.wording.unwrap_or(style.wording);
        style.user_choice = set.user_choice.unwrap_or(style.user_choice);
        style.source = ApprovalSpeechStyleSource::Audience;
        style.audience = Some(name.to_string());
    }
    if style.user_choice && (own_amount.is_some() || own_wording.is_some()) {
        style.amount = own_amount.unwrap_or(style.amount);
        style.wording = own_wording.unwrap_or(style.wording);
        style.source = ApprovalSpeechStyleSource::User;
    }
    style
}

/// How waiting approval cards are read aloud for the caller.
#[utoipa::path(
    get,
    path = "/me/approval-speech-style",
    responses(
        (status = OK, body = ApprovalSpeechStyleResponse),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided")
    ),
    security(("bearer_auth" = []))
)]
pub async fn approval_speech_style(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
) -> Result<Json<ApprovalSpeechStyleResponse>, StatusCode> {
    let experience_policy = { app_state.reloadable.read().await.experience_policy.clone() };
    let identity = AudienceIdentity::from_profile(&me_user);
    let audience = experience_policy
        .as_ref()
        .and_then(|policy| winning_audience(policy, identity, Utc::now()));
    Ok(Json(resolve(
        &app_state.config.approval_speech,
        audience,
        me_user.preference_approval_speech_amount,
        me_user.preference_approval_speech_wording,
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn audience(user_choice: Option<bool>) -> AudienceApprovalSpeech {
        AudienceApprovalSpeech {
            amount: Some(ApprovalSpeechAmount::Short),
            short_details: Some(2),
            wording: None,
            user_choice,
        }
    }

    #[test]
    fn the_deployment_then_the_audience_then_the_user_where_allowed() {
        let config = ApprovalSpeechConfig::default();
        let plain = resolve(&config, None, None, None);
        assert_eq!(plain.amount, ApprovalSpeechAmount::Full);
        assert_eq!(plain.wording, ApprovalSpeechWording::Precise);
        assert_eq!(plain.source, ApprovalSpeechStyleSource::Deployment);

        let set = audience(None);
        let by_audience = resolve(&config, Some(("Vertrieb", &set)), None, None);
        assert_eq!(by_audience.amount, ApprovalSpeechAmount::Short);
        assert_eq!(by_audience.short_details, 2);
        assert_eq!(by_audience.wording, ApprovalSpeechWording::Precise);
        assert_eq!(by_audience.audience.as_deref(), Some("Vertrieb"));

        let own = resolve(
            &config,
            Some(("Vertrieb", &set)),
            None,
            Some(ApprovalSpeechWording::Natural),
        );
        assert_eq!(own.source, ApprovalSpeechStyleSource::User);
        assert_eq!(own.amount, ApprovalSpeechAmount::Short);
        assert_eq!(own.wording, ApprovalSpeechWording::Natural);

        // A supervisor who locks it keeps the user's own choice out.
        let locked = audience(Some(false));
        let kept = resolve(
            &config,
            Some(("Vertrieb", &locked)),
            Some(ApprovalSpeechAmount::Full),
            Some(ApprovalSpeechWording::Natural),
        );
        assert_eq!(kept.source, ApprovalSpeechStyleSource::Audience);
        assert_eq!(kept.amount, ApprovalSpeechAmount::Short);
        assert!(!kept.user_choice);

        // So does the deployment, unless an audience opens it again.
        let closed = ApprovalSpeechConfig {
            user_choice: false,
            ..ApprovalSpeechConfig::default()
        };
        assert_eq!(
            resolve(&closed, None, None, Some(ApprovalSpeechWording::Natural)).wording,
            ApprovalSpeechWording::Precise
        );
        let opened = audience(Some(true));
        assert_eq!(
            resolve(
                &closed,
                Some(("Pilot", &opened)),
                None,
                Some(ApprovalSpeechWording::Natural)
            )
            .wording,
            ApprovalSpeechWording::Natural
        );
    }
}
