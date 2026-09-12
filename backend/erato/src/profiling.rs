use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};

// Reject overlapping renders instead of queuing memory-heavy symbolization jobs.
static PROFILE_RENDER: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);

pub async fn memory_profile_pprof() -> Result<Response, (StatusCode, String)> {
    render_profile(false).await
}

pub async fn memory_profile_flamegraph() -> Result<Response, (StatusCode, String)> {
    render_profile(true).await
}

async fn render_profile(flamegraph: bool) -> Result<Response, (StatusCode, String)> {
    let permit = PROFILE_RENDER.try_acquire().map_err(|_| {
        (
            StatusCode::TOO_MANY_REQUESTS,
            "a memory profile is already being rendered".to_string(),
        )
    })?;
    let bytes = tokio::task::spawn_blocking(move || {
        // Keep the permit until rendering actually ends, even if HTTP disconnects.
        let _permit = permit;
        let mut prof_ctl = jemalloc_pprof::PROF_CTL
            .as_ref()
            .ok_or_else(|| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "jemalloc profiling control is unavailable".to_string(),
                )
            })?
            .blocking_lock();
        require_profiling_activated(&prof_ctl)?;
        if flamegraph {
            prof_ctl.dump_flamegraph().map_err(internal_error_response)
        } else {
            prof_ctl.dump_pprof().map_err(internal_error_response)
        }
    })
    .await
    .map_err(internal_error_response)??;
    let mut response = bytes.into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(if flamegraph {
            "image/svg+xml"
        } else {
            "application/octet-stream"
        }),
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
