//! Which languages the voice may speak to the caller in conversational audio
//! mode: the deployment's value, a supervisor's value for an audience the
//! caller is in, and the caller's own languages where that is allowed, in
//! this order. The turn's language is then chosen among these from what the
//! caller says.

use super::me_profile_middleware::MeProfile;
use super::starting_assistant::{AudienceIdentity, matching_blocks, user_choice_open};
use crate::distribution::experience_policy::{
    AudienceSpokenLanguage, ExperiencePolicyDocument, SPOKEN_LANGUAGE_SETTING,
};
use crate::state::AppState;
use axum::{Extension, Json, extract::State, http::StatusCode};
use chrono::{DateTime, Utc};
use erato_config::spoken_language::{SpokenLanguageConfig, language_code};
use serde::Serialize;
use utoipa::ToSchema;

/// Where the caller's languages come from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SpokenLanguageSource {
    Deployment,
    Audience,
    User,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct SpokenLanguageResponse {
    /// Whether the voice follows the language the caller speaks. Off, it
    /// always speaks `main`; the candidates still tell the recognizer what
    /// the caller may say.
    pub follow_speaker: bool,
    /// The languages the voice chooses among, `main` first, as ISO 639-1
    /// codes. Empty means any language. Also the recognizer's expected
    /// languages when not empty.
    pub candidates: Vec<String>,
    /// The language the voice speaks when the caller's language is unclear.
    pub main: String,
    /// The languages people may speak here; empty means any.
    pub allowed: Vec<String>,
    /// The caller's own languages as stored, also where they do not apply.
    pub own: Vec<String>,
    /// The caller's app language as a language code: their main language
    /// while they list none.
    pub app_language: String,
    /// Where the last value that applied came from.
    pub source: SpokenLanguageSource,
    /// The audience whose value applies, by its display name.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub audience: Option<String>,
    /// Whether the caller may list their own languages.
    pub user_choice: bool,
}

impl SpokenLanguageResponse {
    /// The languages to send to a speech recognizer as expected ones, or
    /// `None` when any language may come.
    pub fn recognizer_hint(&self) -> Option<&[String]> {
        (!self.candidates.is_empty()).then_some(self.candidates.as_slice())
    }
}

pub fn matching_audiences<'a>(
    policy: &'a ExperiencePolicyDocument,
    identity: AudienceIdentity<'_>,
    now: DateTime<Utc>,
) -> Vec<(&'a str, &'a AudienceSpokenLanguage)> {
    matching_blocks(
        policy,
        SPOKEN_LANGUAGE_SETTING,
        |audience| audience.spoken_language.as_ref(),
        identity,
        now,
    )
}

/// Each field comes from the first audience in the order that sets it, else
/// from the deployment. The caller's own languages count only where allowed,
/// and only those on the allowed list; with none of them left, the first
/// allowed language is the main one. `follow_speaker` changes only what
/// the voice speaks, not which languages the caller may use.
pub fn resolve(
    config: &SpokenLanguageConfig,
    audiences: &[(&str, &AudienceSpokenLanguage)],
    own: Option<&[String]>,
    app_language: &str,
) -> SpokenLanguageResponse {
    let follow_speaker = audiences
        .iter()
        .find_map(|(_, set)| set.follow_speaker)
        .unwrap_or(config.follow_speaker);
    let allowed = audiences
        .iter()
        .find_map(|(_, set)| set.languages.clone())
        .unwrap_or_else(|| config.languages.clone());
    let user_choice = user_choice_open(
        config.user_choice,
        audiences.iter().map(|(_, set)| set.user_choice),
    );
    let (mut source, audience) = match audiences.first() {
        Some((name, _)) => (SpokenLanguageSource::Audience, Some((*name).to_string())),
        None => (SpokenLanguageSource::Deployment, None),
    };
    let is_allowed = |code: &str| allowed.is_empty() || allowed.iter().any(|known| known == code);
    let app_language = language_code(app_language).unwrap_or_else(|| "en".to_string());

    let stored = own.unwrap_or_default().to_vec();
    let kept: Vec<String> = own
        .filter(|_| user_choice)
        .unwrap_or_default()
        .iter()
        .filter(|code| is_allowed(code))
        .cloned()
        .collect();
    let (main, mut candidates) = if let Some(first) = kept.first() {
        source = SpokenLanguageSource::User;
        (first.clone(), kept.clone())
    } else {
        let main = if is_allowed(&app_language) {
            app_language.clone()
        } else {
            allowed[0].clone()
        };
        (main, allowed.clone())
    };
    if let Some(at) = candidates.iter().position(|code| *code == main) {
        candidates[..=at].rotate_right(1);
    }

    SpokenLanguageResponse {
        follow_speaker,
        candidates,
        main,
        allowed,
        own: stored,
        app_language,
        source,
        audience,
        user_choice,
    }
}

/// The caller's languages, read from the live experience policy.
pub async fn resolve_for(app_state: &AppState, me_user: &MeProfile) -> SpokenLanguageResponse {
    let experience_policy = { app_state.reloadable.read().await.experience_policy.clone() };
    let identity = AudienceIdentity::from_profile(me_user);
    let audiences = experience_policy
        .as_ref()
        .map(|policy| matching_audiences(policy, identity, Utc::now()))
        .unwrap_or_default();
    resolve(
        &app_state.config.audio_conversational.spoken_language,
        &audiences,
        me_user.preference_spoken_languages.as_deref(),
        super::read_aloud::speech_language(app_state, me_user).code(),
    )
}

/// [`resolve_for`] with the caller's preferences read again. A socket keeps
/// the profile it was opened with, so a person who changes their languages
/// mid-conversation would otherwise keep the old ones until they reconnect.
pub async fn resolve_for_turn(app_state: &AppState, me_user: &MeProfile) -> SpokenLanguageResponse {
    let stored = match uuid::Uuid::parse_str(&me_user.id) {
        Ok(user_id) => {
            crate::models::user_preference::get_user_preferences(&app_state.db, &user_id)
                .await
                .inspect_err(
                    |error| tracing::warn!(%error, "Cannot read the user's languages again"),
                )
                .ok()
        }
        Err(_) => None,
    };
    let Some(stored) = stored else {
        return resolve_for(app_state, me_user).await;
    };
    let mut current = me_user.clone();
    current.profile.apply_user_preferences(stored);
    resolve_for(app_state, &current).await
}

/// Which languages the voice may speak to the caller in conversational audio
/// mode.
#[utoipa::path(
    get,
    path = "/me/spoken-language",
    responses(
        (status = OK, body = SpokenLanguageResponse),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided")
    ),
    security(("bearer_auth" = []))
)]
pub async fn spoken_language(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
) -> Result<Json<SpokenLanguageResponse>, StatusCode> {
    Ok(Json(resolve_for(&app_state, &me_user).await))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn codes(list: &[&str]) -> Vec<String> {
        list.iter().map(|code| code.to_string()).collect()
    }

    fn deployment(
        follow_speaker: bool,
        languages: &[&str],
        user_choice: bool,
    ) -> SpokenLanguageConfig {
        SpokenLanguageConfig {
            follow_speaker,
            languages: codes(languages),
            user_choice,
        }
    }

    fn audience(
        follow_speaker: Option<bool>,
        languages: Option<&[&str]>,
        user_choice: Option<bool>,
    ) -> AudienceSpokenLanguage {
        AudienceSpokenLanguage {
            follow_speaker,
            languages: languages.map(codes),
            user_choice,
        }
    }

    #[test]
    fn nothing_set_follows_any_language_from_the_app_language() {
        let resolved = resolve(&SpokenLanguageConfig::default(), &[], None, "de");
        assert!(resolved.follow_speaker);
        assert!(resolved.candidates.is_empty());
        assert_eq!(resolved.recognizer_hint(), None);
        assert_eq!(resolved.main, "de");
        assert_eq!(resolved.source, SpokenLanguageSource::Deployment);
        assert!(resolved.user_choice);
    }

    #[test]
    fn hindi_and_english_on_an_english_interface() {
        let own = codes(&["hi", "en"]);
        let resolved = resolve(&SpokenLanguageConfig::default(), &[], Some(&own), "en");
        assert_eq!(resolved.main, "hi");
        assert_eq!(resolved.candidates, ["hi", "en"]);
        assert_eq!(resolved.recognizer_hint(), Some(own.as_slice()));
        assert_eq!(resolved.app_language, "en");
        assert_eq!(resolved.source, SpokenLanguageSource::User);
    }

    #[test]
    fn one_language_means_always_that_language() {
        let own = codes(&["tr"]);
        let resolved = resolve(&SpokenLanguageConfig::default(), &[], Some(&own), "de");
        assert_eq!(resolved.main, "tr");
        assert_eq!(resolved.candidates, ["tr"]);
    }

    #[test]
    fn the_deployment_then_the_audience_then_the_user_where_allowed() {
        let config = deployment(true, &["de", "en", "fr"], true);
        let own = codes(&["fr", "de"]);

        let resolved = resolve(&config, &[], None, "en");
        assert_eq!(resolved.main, "en");
        assert_eq!(resolved.candidates, ["en", "de", "fr"]);

        let sales = audience(None, Some(&["de", "en"]), None);
        let resolved = resolve(&config, &[("Sales", &sales)], None, "en");
        assert_eq!(resolved.candidates, ["en", "de"]);
        assert_eq!(resolved.source, SpokenLanguageSource::Audience);
        assert_eq!(resolved.audience.as_deref(), Some("Sales"));

        let resolved = resolve(&config, &[("Sales", &sales)], Some(&own), "en");
        assert_eq!(resolved.main, "de");
        assert_eq!(resolved.candidates, ["de"]);
        assert_eq!(resolved.source, SpokenLanguageSource::User);

        let locked = audience(None, None, Some(false));
        let resolved = resolve(
            &config,
            &[("Pilot", &locked), ("Sales", &sales)],
            Some(&own),
            "en",
        );
        assert!(!resolved.user_choice);
        assert_eq!(resolved.main, "en");
        assert_eq!(resolved.candidates, ["en", "de"]);
        assert_eq!(resolved.source, SpokenLanguageSource::Audience);

        let reopened = audience(None, None, Some(true));
        let closed = deployment(true, &[], false);
        let resolved = resolve(&closed, &[("Pilot", &reopened)], Some(&own), "en");
        assert!(!resolved.user_choice);
        assert_eq!(resolved.main, "en");
    }

    #[test]
    fn an_admin_list_without_the_users_language_keeps_the_voice_inside_it() {
        let config = deployment(true, &["de", "fr"], true);
        let own = codes(&["hi"]);
        let resolved = resolve(&config, &[], Some(&own), "en");
        assert_eq!(resolved.main, "de");
        assert_eq!(resolved.candidates, ["de", "fr"]);
        assert!(
            resolved
                .candidates
                .iter()
                .all(|code| resolved.allowed.contains(code))
        );

        let resolved = resolve(&config, &[], None, "en");
        assert_eq!(resolved.main, "de");
        assert_eq!(resolved.candidates, ["de", "fr"]);
    }

    #[test]
    fn follow_speaker_off_always_gives_the_main_language() {
        let own = codes(&["hi", "en"]);
        let resolved = resolve(&deployment(false, &[], true), &[], Some(&own), "en");
        assert!(!resolved.follow_speaker);
        assert_eq!(resolved.main, "hi");
        assert_eq!(resolved.candidates, ["hi", "en"]);

        let off = audience(Some(false), None, None);
        let resolved = resolve(
            &SpokenLanguageConfig::default(),
            &[("Pilot", &off)],
            None,
            "de",
        );
        assert!(!resolved.follow_speaker);
        assert_eq!(resolved.main, "de");
    }

    #[test]
    fn an_audience_can_open_the_list_to_any_language() {
        let config = deployment(true, &["de"], true);
        let any = audience(None, Some(&[]), None);
        let own = codes(&["hi"]);
        let resolved = resolve(&config, &[("Global", &any)], Some(&own), "en");
        assert!(resolved.allowed.is_empty());
        assert_eq!(resolved.main, "hi");
    }
}
