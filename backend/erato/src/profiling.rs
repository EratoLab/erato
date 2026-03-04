use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};

pub async fn memory_profile_pprof() -> Result<Response, (StatusCode, String)> {
    let mut prof_ctl = jemalloc_pprof::PROF_CTL
        .as_ref()
        .ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "jemalloc profiling control is unavailable".to_string(),
            )
        })?
        .lock()
        .await;
    require_profiling_activated(&prof_ctl)?;

    let pprof = prof_ctl.dump_pprof().map_err(internal_error_response)?;

    let mut response = pprof.into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    Ok(response)
}

pub async fn memory_profile_flamegraph() -> Result<Response, (StatusCode, String)> {
    let mut prof_ctl = jemalloc_pprof::PROF_CTL
        .as_ref()
        .ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "jemalloc profiling control is unavailable".to_string(),
            )
        })?
        .lock()
        .await;
    require_profiling_activated(&prof_ctl)?;

    let flamegraph = prof_ctl
        .dump_flamegraph()
        .map_err(internal_error_response)?;

    let mut response = flamegraph.into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("image/svg+xml"),
    );
    Ok(response)
}

fn require_profiling_activated(
    prof_ctl: &jemalloc_pprof::JemallocProfCtl,
) -> Result<(), (StatusCode, String)> {
    if prof_ctl.activated() {
        Ok(())
    } else {
        Err((StatusCode::FORBIDDEN, "heap profiling not activated".into()))
    }
}

fn internal_error_response(error: impl std::fmt::Display) -> (StatusCode, String) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        format!("failed to render memory profile: {error}"),
    )
}
