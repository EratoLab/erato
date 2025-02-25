use crate::models::user::get_or_create_user;
use crate::normalize_profile::{normalize_profile, IdTokenProfile};
use crate::state::AppState;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::sse::Event;
use axum::response::{IntoResponse, Sse};
use axum::routing::{get, post};
use axum::{Json, Router};
use axum_extra::headers::{authorization::Bearer, Authorization};
use axum_extra::TypedHeader;
use futures::stream::{self, Stream};
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use serde_json;
use serde_json::Value;
use std::convert::Infallible;
use std::time::Duration;
use tokio_stream::StreamExt as _;
use utoipa::{OpenApi, ToSchema};
use utoipa_axum::router::OpenApiRouter;

pub fn router() -> OpenApiRouter<AppState> {
    // build our application with a route
    let app = Router::new()
        .route("/messages", get(messages))
        .route("/messages/submitstream", post(message_submit_sse))
        .route("/chats", get(chats))
        .route("/me/profile", get(profile))
        .fallback(fallback);
    app.into()
}

#[derive(OpenApi)]
#[openapi(
    paths(messages, chats, message_submit_sse, profile),
    components(schemas(Message, Chat, MessageSubmitStreamingResponseMessage, UserProfile))
)]
pub struct ApiV1ApiDoc;

#[derive(Serialize, ToSchema)]
struct NotFound {
    error: String,
}

pub async fn fallback() -> impl IntoResponse {
    (
        StatusCode::NOT_FOUND,
        Json(NotFound {
            error:
                "There is no API route under the path (or path + method combination) you provided."
                    .to_string(),
        }),
    )
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct UserProfile {
    pub id: String,
    /// The user's email address. Shouldn't be used as a unique identifier, as it may change.
    pub email: Option<String>,
    /// The user's display name.
    pub name: Option<String>,
    /// The user's profile picture URL.
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
        }
    }

    pub fn determine_final_language(&mut self) {
        // TODO: Include https://docs.rs/accept-language crate, and support at least a second language.
        let _supported_languages = ["en"];
        self.preferred_language = "en".to_string()
    }
}

#[utoipa::path(
    get,
    path = "/me/profile",
    responses(
        (status = OK, body = UserProfile),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn profile(
    State(app_state): State<AppState>,
    TypedHeader(auth): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<UserProfile>, StatusCode> {
    // Get the JWT token from the Authorization header
    let token = auth.token();

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

    // TODO: Move this to some kind of middleware for the /me routes
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

    Ok(Json(user_profile))
}

#[derive(Serialize, ToSchema)]
pub struct Message {
    id: String,
}

#[derive(Serialize, ToSchema)]
pub struct Chat {
    id: String,
}

#[utoipa::path(get, path = "/messages", responses((status = OK, body = Vec<Message>)))]
pub async fn messages() -> Json<Vec<Message>> {
    vec![].into()
}

#[utoipa::path(get, path = "/chats", responses((status = OK, body = Vec<Chat>)))]
pub async fn chats() -> Json<Vec<Chat>> {
    vec![].into()
}

#[derive(Serialize, ToSchema)]
#[serde(tag = "message_type")]
enum MessageSubmitStreamingResponseMessage {
    #[serde(rename = "text_delta")]
    TextDelta(MessageSubmitStreamingResponseMessageTextDelta),
    #[serde(rename = "example_other")]
    #[allow(unused)]
    ExampleOther(MessageSubmitStreamingResponseMessageOther),
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
struct MessageSubmitStreamingResponseMessageTextDelta {
    new_text: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
// TODO: This is just an example so that we have multiple variants to test again
struct MessageSubmitStreamingResponseMessageOther {
    foo: String,
}

#[utoipa::path(post, path = "/messages/submitstream", responses((status = OK, content_type="text/event-stream", body = MessageSubmitStreamingResponseMessage)))]
pub async fn message_submit_sse(
    headers: axum::http::HeaderMap,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    // Log all headers for debugging
    dbg!("Received headers:");
    for (name, value) in headers.iter() {
        if let Ok(value_str) = value.to_str() {
            dbg!("  {}: {}", name, value_str);
        }
    }

    let message = "Hey there this is the full message";
    let words: Vec<&str> = message.split_whitespace().collect();

    let stream = stream::iter(words)
        .map(|word| {
            let delta = MessageSubmitStreamingResponseMessageTextDelta {
                new_text: word.to_string(),
            };
            let message = MessageSubmitStreamingResponseMessage::TextDelta(delta);
            let json = serde_json::to_string(&message).unwrap();
            Ok(Event::default().event("text_delta").data(json))
        })
        .throttle(Duration::from_secs(1));

    Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(1))
            .text("keep-alive-text"),
    )
}
