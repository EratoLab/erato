use axum::Json;
use axum::extract::State;
use axum::http::header;
use axum::response::IntoResponse;
use serde::Serialize;
use utoipa::ToSchema;

use crate::state::AppState;

#[derive(Serialize, ToSchema)]
struct Disclaimer {
    id: String,
    title: String,
    content: String,
}

#[derive(Serialize, ToSchema)]
pub(super) struct DisclaimersResponse {
    disclaimers: Vec<Disclaimer>,
}

/// List the configured notices for the Settings dialog.
#[utoipa::path(
    get,
    path = "/me/disclaimers",
    responses(
        (status = OK, body = DisclaimersResponse),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided")
    ),
    security(("bearer_auth" = []))
)]
pub(super) async fn list_disclaimers(State(app_state): State<AppState>) -> impl IntoResponse {
    let config = &app_state.config.disclaimers;
    let mut disclaimers = Vec::new();
    if config.settings_tab_visible() {
        disclaimers.extend(
            config
                .disclaimers
                .iter()
                .map(|(id, disclaimer)| Disclaimer {
                    id: id.clone(),
                    title: disclaimer.title.clone(),
                    content: disclaimer.content.clone(),
                }),
        );
        disclaimers.sort_unstable_by(|left, right| left.id.cmp(&right.id));
    }
    (
        [(header::CACHE_CONTROL, "no-store")],
        Json(DisclaimersResponse { disclaimers }),
    )
}
