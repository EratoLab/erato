use axum::routing::{get, head};
use utoipa::OpenApi;
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
        .route("health", get(health).head(health))
        .nest("api/v1", crate::server::api::v1::router());
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
