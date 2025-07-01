use crate::state::AppState;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::Router;
use eyre::Report;
use sentry::{event_from_error, Hub};
use std::error::Error;

pub fn setup_sentry(
    sentry_dsn: Option<&String>,
    environment: String,
    _sentry_guard: &mut Option<sentry::ClientInitGuard>,
) {
    if let Some(sentry_dsn) = sentry_dsn {
        *_sentry_guard = Some(sentry::init((
            sentry_dsn.as_str(),
            sentry::ClientOptions {
                release: sentry::release_name!(),
                debug: std::env::var("SENTRY_DEBUG").is_ok(),
                environment: Some(environment.into()),
                ..Default::default()
            },
        )));
    } else {
        println!("No SENTRY_DSN specified. Observability via Sentry is disabled");
    }
}

pub fn extend_with_sentry_layers(mut router: Router<AppState>) -> Router<AppState> {
    router = router.layer(sentry_tower::NewSentryLayer::<Request<Body>>::new_from_top());
    router = router.layer(sentry_tower::SentryHttpLayer::new().enable_transaction());
    router
}

pub fn capture_report(report: &Report) {
    Hub::with_active(|hub| {
        let err: &dyn Error = report.as_ref();
        let event = event_from_error(err);
        // if let Some(exc) = event.exception.iter_mut().last() {
        //     let backtrace = err.backtrace();
        //     exc.stacktrace = sentry_backtrace::parse_stacktrace(&format!("{backtrace:#}"));
        // }

        hub.capture_event(event);
    });
}

pub fn log_internal_server_error(report: Report) -> StatusCode {
    tracing::error!("{}", report.to_string());
    Hub::with_active(|hub| {
        let err: &dyn Error = report.as_ref();
        let event = event_from_error(err);
        // if let Some(exc) = event.exception.iter_mut().last() {
        //     let backtrace = err.backtrace();
        //     exc.stacktrace = sentry_backtrace::parse_stacktrace(&format!("{backtrace:#}"));
        // }

        hub.capture_event(event);
    });
    StatusCode::INTERNAL_SERVER_ERROR
}
