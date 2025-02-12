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
use std::convert::Infallible;
use std::time::Duration;
use tokio_stream::StreamExt as _;
use utoipa::{OpenApi, ToSchema};
use utoipa_axum::router::OpenApiRouter;

pub fn router() -> OpenApiRouter {
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
struct UserProfile {
    email: String,
}

#[derive(Debug, Deserialize)]
struct Claims {
    email: String,
    exp: usize,
    // Add other claims as needed
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
    TypedHeader(auth): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<UserProfile>, StatusCode> {
    // Get the JWT token from the Authorization header
    let token = auth.token();

    // TODO: In production, this should be a proper secret key from configuration
    let secret = b"placeholder";

    // We don't validate anything, as we always run behind oauth2-proxy which handles verification
    let mut validation = Validation::new(Algorithm::HS256);
    validation.insecure_disable_signature_validation();
    validation.validate_exp = false;
    validation.validate_aud = false;
    validation.validate_nbf = false;

    // Decode and validate the token
    let token_data = match decode::<Claims>(token, &DecodingKey::from_secret(secret), &validation) {
        Ok(data) => data,
        Err(_) => return Err(StatusCode::UNAUTHORIZED),
    };

    Ok(Json(UserProfile {
        email: token_data.claims.email,
    }))
}

#[derive(Serialize, ToSchema)]
struct Message {
    id: String,
}

#[derive(Serialize, ToSchema)]
struct Chat {
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
    ExampleOther(MessageSubmitStreamingResponseMessageOther),
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
struct MessageSubmitStreamingResponseMessageTextDelta {
    new_text: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
// TODO: This is just an example so that we have multiple variants to test agian
struct MessageSubmitStreamingResponseMessageOther {
    foo: String,
}

#[utoipa::path(post, path = "/messages/submitstream", responses((status = OK, content_type="text/event-stream", body = MessageSubmitStreamingResponseMessage)))]
pub async fn message_submit_sse(
    TypedHeader(user_agent): TypedHeader<headers::UserAgent>,
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
