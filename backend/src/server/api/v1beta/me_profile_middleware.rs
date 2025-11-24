use crate::models::user::get_or_create_user;
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
}

impl UserProfile {
    pub fn from_id_token_profile(profile: IdTokenProfile, user_id: String) -> Self {
        let preferred_language = profile.preferred_language.unwrap_or("en".to_string());
        Self {
            id: user_id,
            email: profile.email,
            name: profile.name,
            picture: profile.picture,
            preferred_language,
            groups: profile.groups,
        }
    }

    pub fn determine_final_language(&mut self) {
        // TODO: Include https://docs.rs/accept-language crate, and support at least a second language.
        let _supported_languages = ["en"];
        self.preferred_language = "en".to_string()
    }
}

#[derive(Debug, Clone)]
pub struct MeProfile(pub UserProfile);

impl MeProfile {
    pub fn to_subject(&self) -> Subject {
        Subject::User(self.0.id.clone())
    }
}

pub async fn user_profile_from_token(
    app_state: &AppState,
    token: &str,
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
    user_profile.determine_final_language();

    Ok(user_profile)
}

/// Middleware that extracts and validates user profile from JWT token
///
/// This middleware decodes the JWT token from the Authorization header,
/// normalizes the profile data, creates or retrieves the user from the database,
/// and adds the user profile to the request extensions for use by downstream handlers.
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

    if let Ok(current_user) = user_profile_from_token(&app_state, auth_header.token()).await {
        req.extensions_mut().insert(MeProfile(current_user));
        Ok(next.run(req).await)
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}
