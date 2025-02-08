use axum::{Json, Router};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use serde::Serialize;
use utoipa::{OpenApi, ToSchema};
use utoipa_axum::router::OpenApiRouter;

pub fn router() -> OpenApiRouter {
    // build our application with a route
    let app = Router::new()
        .route("/messages", get(messages))
        .route("/chats", get(chats))
        .fallback(fallback);
    app.into()
}

#[derive(OpenApi)]
#[openapi(paths(messages, chats), components(schemas(Message, Chat)))]
pub struct ApiV1ApiDoc;

#[derive(Serialize, ToSchema)]
struct NotFound {
    error: String,
}

pub async fn fallback() -> impl IntoResponse {
    (StatusCode::NOT_FOUND, Json(NotFound {
        error: "There is no API route under the path (or path + method combination) you provided.".to_string()
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

