use crate::state::AppState;
use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::Response;

/// Provide a prepared configuration template and a fresh request-local fact
/// cache. Resource facts are loaded lazily by authorization, without a global
/// freshness barrier.
pub(crate) async fn policy_engine_middleware(
    State(app_state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let effective_config =
        crate::latency::stage("request.configuration", app_state.effective_config()).await;
    // Configuration preparation is shared across requests.
    let policy_engine = crate::latency::stage(
        "request.policy",
        app_state
            .global_policy_engine
            .request_engine(&app_state.db, &effective_config),
    )
    .await
    .map_err(|e| {
        tracing::error!("Failed to get policy engine: {:?}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Insert the policy engine into request extensions
    req.extensions_mut().insert(policy_engine);

    Ok(next.run(req).await)
}
