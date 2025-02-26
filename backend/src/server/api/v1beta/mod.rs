pub mod me_profile_middleware;

use crate::models::chat::get_or_create_chat;
use crate::server::api::v1beta::me_profile_middleware::{MeProfile, UserProfile};
use crate::state::AppState;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::sse::Event;
use axum::response::{IntoResponse, Sse};
use axum::routing::{get, post};
use axum::{middleware, Extension, Json, Router};
use futures::stream::{self, Stream};
use serde::Serialize;
use serde_json;
use sqlx::types::Uuid;
use std::convert::Infallible;
use std::time::Duration;
use tokio_stream::StreamExt as _;
use utoipa::{OpenApi, ToSchema};
use utoipa_axum::router::OpenApiRouter;

pub fn router(app_state: AppState) -> OpenApiRouter<AppState> {
    // build our application with a route
    let me_routes = Router::new()
        .route("/profile", get(profile))
        .route("/messages/submitstream", post(message_submit_sse))
        .route_layer(middleware::from_fn_with_state(
            app_state,
            me_profile_middleware::user_profile_middleware,
        ));

    let app = Router::new()
        .route("/messages", get(messages))
        .route("/chats", get(chats))
        .nest("/me", me_routes)
        .fallback(fallback);
    app.into()
}

#[derive(OpenApi)]
#[openapi(
    paths(messages, chats, message_submit_sse, profile),
    components(schemas(
        Message,
        Chat,
        MessageSubmitStreamingResponseMessage,
        UserProfile,
        MessageSubmitRequest
    ))
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
    State(_app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
) -> Result<Json<UserProfile>, StatusCode> {
    Ok(Json(me_user.0))
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
// TODO: This is just an example so that we have multiple variants to test against
struct MessageSubmitStreamingResponseMessageOther {
    foo: String,
}

#[derive(serde::Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct MessageSubmitRequest {
    #[schema(example = "00000000-0000-0000-0000-000000000000")]
    /// The ID of the message that this message is a response to. If this is the first message in the chat, this should be empty.
    previous_message_id: Option<Uuid>,
    #[schema(example = "Hello, world!")]
    /// The text of the message.
    #[allow(dead_code)]
    user_message: String,
}

#[utoipa::path(
    post,
    path = "/me/messages/submitstream", 
    request_body = MessageSubmitRequest,
    responses(
        (status = OK, content_type="text/event-stream", body = MessageSubmitStreamingResponseMessage),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn message_submit_sse(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Json(request): Json<MessageSubmitRequest>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let _chat = get_or_create_chat(
        &app_state.db,
        app_state.policy(),
        &me_user.to_subject(),
        request.previous_message_id.as_ref(),
        &me_user.0.id,
    )
    .await;

    // Log the authenticated user ID
    dbg!(format!("Authenticated user ID: {}", me_user.0.id));

    // Log the previous_message_id if provided
    if let Some(prev_id) = &request.previous_message_id {
        dbg!(format!("Previous message ID: {}", prev_id));
    } else {
        dbg!("No previous message ID provided");
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
