use axum::routing::{get, head};
use utoipa::OpenApi;
use utoipa::openapi::OpenApiBuilder;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use super::api::v1::ApiV1ApiDoc;

/// Get health of the API.
#[utoipa::path(
    method(get, head),
    path = "health",
    responses(
        (status = OK, description = "Success", body = str, content_type = "text/plain")
    )
)]
async fn health() -> &'static str {
    "OK"
}

pub fn router() -> OpenApiRouter {
    // build our application with a route
    let app = OpenApiRouter::new()
        .route("/health", get(health).head(health))
        .nest("/api/v1", crate::server::api::v1::router());
    app
}

#[derive(OpenApi)]
#[openapi(
    paths(health),
    nest(
        (path = "api/v1", api = ApiV1ApiDoc)
    )
)]
pub struct MainRouterApiDoc;

pub const MAIN_ROUTER_DOC: &'static str = r#"The main API structure

- `/api/v1/` <- Most of the API is nested under here. All of the resources there are scoped to what is accessible by the authenticated identity.
- `/api/v1/me` <- Everything under this path is scoped to the subject of the authenticated identity.
This means that the identity may be authorized to view more resources, but this is the default view for them.
E.g. the chats route scoped under there will only list the chats created by the user, but the user may be authorized to also view chats shared by other users.
"#;
