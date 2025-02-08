use axum::http::StatusCode;
use axum::response::sse::Event;
use axum::response::{IntoResponse, Sse};
use axum::routing::{get, post};
use axum::{Json, Router};
use axum_extra::TypedHeader;
use futures::stream::{self, Stream};
use serde::Serialize;
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
        .fallback(fallback);
    app.into()
}

#[derive(OpenApi)]
#[openapi(
    paths(messages, chats, message_submit_sse),
    components(schemas(Message, Chat, MessageSubmitStreamingResponseMessage))
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
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
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
