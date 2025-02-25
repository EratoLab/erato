use super::api::v1beta::ApiV1ApiDoc;
use crate::state::AppState;
use axum::routing::get;
// use utoipa::openapi::OpenApiBuilder;
use utoipa::OpenApi;
use utoipa_axum::router::OpenApiRouter;
// use utoipa_axum::routes;

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

pub fn router() -> OpenApiRouter<AppState> {
    // build our application with a route

    OpenApiRouter::new()
        .route("/health", get(health).head(health))
        .nest("/api/v1beta", crate::server::api::v1beta::router())
}

#[derive(OpenApi)]
#[openapi(
    paths(health),
    nest(
        (path = "api/v1beta", api = ApiV1ApiDoc)
    )
)]
pub struct MainRouterApiDoc;

pub const MAIN_ROUTER_DOC: &str = r#"The main API structure

- `/api/v1beta/` <- Most of the API is nested under here. All of the resources there are scoped to what is accessible by the authenticated identity.
- `/api/v1beta/me` <- Everything under this path is scoped to the subject of the authenticated identity.
This means that the identity may be authorized to view more resources, but this is the default view for them.
E.g. the chats route scoped under there will only list the chats created by the user, but the user may be authorized to also view chats shared by other users.
"#;
