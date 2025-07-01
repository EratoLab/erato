use crate::state::AppState;
use axum::http::StatusCode;
use axum::Router;
use eyre::Report;

pub fn setup_sentry(
    _sentry_dsn: Option<&String>,
    _environment: String,
    _sentry_guard: &mut Option<()>,
) {
}

#[allow(unused_mut)]
pub fn extend_with_sentry_layers(mut router: Router<AppState>) -> Router<AppState> {
    router
}

pub fn log_internal_server_error(err: Report) -> StatusCode {
    tracing::error!("{}", err.to_string());
    StatusCode::INTERNAL_SERVER_ERROR
}

pub fn capture_report(err: &Report) {
    tracing::error!("{}", err.to_string());
}
