use crate::models::user::get_or_create_user;
use crate::models::user_preference::get_user_preferences;
use crate::normalize_profile::{IdTokenProfile, normalize_profile};
use crate::policy::prelude::Subject;
use crate::state::AppState;
use axum::extract::{Request, State};
use axum::http;
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::Response;
use headers::authorization::{Bearer, Credentials};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tracing::instrument;
use utoipa::ToSchema;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct UserProfile {
    pub id: String,
    /// The user's email address. Shouldn't be used as a unique identifier, as it may change.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub email: Option<String>,
    /// The user's display name.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub name: Option<String>,
    /// The user's profile picture URL.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub picture: Option<String>,
    /// The user's preferred language.
    ///
    /// The final determined language is intersected with our supported languages, to determine the final language.
    ///
    /// Will be a BCP 47 language tag (e.g. "en" or "en-US").
    ///
    /// This is derived in the following order (highest priority first):
    /// - ID token claims
    /// - Browser Accept-Language header
    /// - Default to "en"
    pub preferred_language: String,
    /// List of groups the user belongs to.
    ///
    /// This is derived from the `groups` claim in the ID token.
    /// If the claim is not present, this will be an empty list.
    pub groups: Vec<String>,
    /// Organization user ID from the `oid` claim (Entra ID specific).
    ///
    /// This can be used as the subject_id when creating share grants
    /// with subject_id_type "organization_user_id".
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub organization_user_id: Option<String>,
    /// Organization group IDs from the `groups` claim.
    ///
    /// These can be used as subject_id when creating share grants
    /// with subject_id_type "organization_group_id".
    pub organization_group_ids: Vec<String>,
    /// Preferred name to address the user with.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub preference_nickname: Option<String>,
    /// User's job title.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub preference_job_title: Option<String>,
    /// Additional behaviour/style/tone preferences for the assistant.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub preference_assistant_custom_instructions: Option<String>,
    /// Additional contextual information about the user for the assistant.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub preference_assistant_additional_information: Option<String>,
}

impl UserProfile {
    pub fn from_id_token_profile(profile: IdTokenProfile, user_id: String) -> Self {
        let preferred_language = profile.preferred_language;
        Self {
            id: user_id,
            email: profile.email,
            name: profile.name,
            picture: profile.picture,
            preferred_language: preferred_language.unwrap_or("en".to_string()),
            groups: profile.groups,
            organization_user_id: profile.organization_user_id,
            organization_group_ids: profile.organization_group_ids,
            preference_nickname: None,
            preference_job_title: None,
            preference_assistant_custom_instructions: None,
            preference_assistant_additional_information: None,
        }
    }

    pub fn determine_final_language(&mut self, accept_language_header: Option<&str>) {
        let resolved_language = normalize_supported_language(Some(&self.preferred_language))
            .or_else(|| normalize_supported_language(accept_language_header))
            .unwrap_or("en");
        self.preferred_language = resolved_language.to_string();
    }

    pub fn apply_user_preferences(
        &mut self,
        prefs: Option<crate::db::entity::user_preferences::Model>,
    ) {
        if let Some(prefs) = prefs {
            self.preference_nickname = prefs.nickname;
            self.preference_job_title = prefs.job_title;
            self.preference_assistant_custom_instructions = prefs.assistant_custom_instructions;
            self.preference_assistant_additional_information =
                prefs.assistant_additional_information;
        }
    }
}

/// Header name for the forwarded access token (typically set by oauth2-proxy).
/// This token can be used for delegated access to external APIs like MS Graph.
pub const X_FORWARDED_ACCESS_TOKEN: &str = "X-Forwarded-Access-Token";

#[derive(Debug, Clone)]
pub struct MeProfile {
    /// The user profile extracted from the JWT token.
    pub profile: UserProfile,
    /// The raw OIDC token received via the Authorization header.
    pub oidc_token: String,
    /// The raw access token for external APIs like MS Graph.
    /// This is extracted from the X-Forwarded-Access-Token header,
    /// which is typically set by oauth2-proxy when configured to forward
    /// the original IdP access token.
    pub access_token: Option<String>,
}

// Implement Deref for backwards compatibility with code that uses MeProfile.0
impl std::ops::Deref for MeProfile {
    type Target = UserProfile;
    fn deref(&self) -> &Self::Target {
        &self.profile
    }
}

impl MeProfile {
    pub fn to_subject(&self) -> Subject {
        // Use UserWithGroups if we have organization-specific information
        // (either organization_user_id or organization_group_ids)
        if self.profile.organization_user_id.is_some()
            || !self.profile.organization_group_ids.is_empty()
        {
            Subject::UserWithOrganizationInfo {
                id: self.profile.id.clone(),
                organization_user_id: self.profile.organization_user_id.clone(),
                organization_group_ids: self.profile.organization_group_ids.clone(),
            }
        } else {
            Subject::User(self.profile.id.clone())
        }
    }
}

#[instrument(skip_all)]
pub async fn user_profile_from_token(
    app_state: &AppState,
    token: &str,
    accept_language_header: Option<&str>,
) -> Result<UserProfile, StatusCode> {
    // Placeholder secret, as we don't validate signature anyway
    let secret = b"placeholder";

    // We don't validate anything, as we always run behind oauth2-proxy which handles verification
    let mut validation = Validation::new(Algorithm::HS256);
    validation.insecure_disable_signature_validation();
    validation.validate_exp = false;
    validation.validate_aud = false;
    validation.validate_nbf = false;

    // Decode and validate the token
    let token_data = match decode::<Value>(token, &DecodingKey::from_secret(secret), &validation) {
        Ok(data) => data,
        Err(_) => return Err(StatusCode::UNAUTHORIZED),
    };

    let normalized_profile = normalize_profile(token_data.claims);
    let normalized_profile = normalized_profile.map_err(|_e| StatusCode::INTERNAL_SERVER_ERROR)?;

    let user = get_or_create_user(
        &app_state.db,
        &normalized_profile.iss,
        &normalized_profile.sub,
        normalized_profile.email.as_deref(),
    )
    .await
    .map_err(|_e| StatusCode::INTERNAL_SERVER_ERROR)?;

    let user_id = user.id.to_string();
    let mut user_profile = UserProfile::from_id_token_profile(normalized_profile, user_id);
    user_profile.determine_final_language(accept_language_header);
    let prefs = get_user_preferences(&app_state.db, &user.id)
        .await
        .map_err(|_e| StatusCode::INTERNAL_SERVER_ERROR)?;
    user_profile.apply_user_preferences(prefs);

    Ok(user_profile)
}

/// Middleware that extracts and validates user profile from JWT token
///
/// This middleware decodes the JWT token from the Authorization header,
/// normalizes the profile data, creates or retrieves the user from the database,
/// and adds the user profile to the request extensions for use by downstream handlers.
///
/// If the `X-Forwarded-Access-Token` header is present (typically set by oauth2-proxy),
/// it will be stored in the `MeProfile` for use with external APIs like MS Graph.
pub(crate) async fn user_profile_middleware(
    State(app_state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let auth_header = req
        .headers()
        .get(http::header::AUTHORIZATION)
        .and_then(Bearer::decode)
        .ok_or(StatusCode::UNAUTHORIZED)?;

    // Extract the forwarded access token if present (for external API access like MS Graph)
    let forwarded_access_token = req
        .headers()
        .get(X_FORWARDED_ACCESS_TOKEN)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let accept_language_header = req
        .headers()
        .get(http::header::ACCEPT_LANGUAGE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);

    if let Ok(current_user) = user_profile_from_token(
        &app_state,
        auth_header.token(),
        accept_language_header.as_deref(),
    )
    .await
    {
        req.extensions_mut().insert(MeProfile {
            profile: current_user,
            oidc_token: auth_header.token().to_string(),
            access_token: forwarded_access_token,
        });
        Ok(next.run(req).await)
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

const SUPPORTED_LANGUAGES: [&str; 5] = ["en", "de", "fr", "pl", "es"];

fn normalize_supported_language(raw_language: Option<&str>) -> Option<&str> {
    let raw_language = raw_language?;

    for candidate in parse_language_candidates(raw_language) {
        if let Some(language) = SUPPORTED_LANGUAGES.iter().copied().find(|supported| {
            candidate == *supported
                || candidate
                    .strip_prefix(*supported)
                    .is_some_and(|suffix| suffix.starts_with('-'))
        }) {
            return Some(language);
        }
    }

    None
}

fn parse_language_candidates(raw_language: &str) -> Vec<String> {
    raw_language
        .split(',')
        .filter_map(|entry| entry.split(';').next())
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(|entry| entry.replace('_', "-").to_ascii_lowercase())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{normalize_supported_language, parse_language_candidates};

    #[test]
    fn parses_accept_language_candidates_in_priority_order() {
        assert_eq!(
            parse_language_candidates("de-DE,de;q=0.9,en;q=0.8"),
            vec!["de-de".to_string(), "de".to_string(), "en".to_string()]
        );
    }

    #[test]
    fn normalizes_supported_language_from_exact_locale() {
        assert_eq!(normalize_supported_language(Some("fr-FR")), Some("fr"));
    }

    #[test]
    fn normalizes_supported_language_from_accept_language_header() {
        assert_eq!(
            normalize_supported_language(Some("it-IT,it;q=0.9,de-DE;q=0.8")),
            Some("de")
        );
    }

    #[test]
    fn returns_none_for_unsupported_language() {
        assert_eq!(normalize_supported_language(Some("it-IT,it;q=0.9")), None);
    }
}
