use crate::state::AppState;
use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::Response;
use std::time::Duration;

/// Time threshold for rebuilding policy data
/// If the last rebuild was more than this duration ago, trigger a rebuild
const POLICY_REBUILD_THRESHOLD: Duration = Duration::from_secs(60); // 1 minute

/// Middleware that provides a PolicyEngine for each request
///
/// This middleware clones the global PolicyEngine from AppState. Before cloning,
/// it checks if the policy data needs to be rebuilt based on:
/// - Explicit invalidation (via `invalidate_data()`)
/// - Time threshold (if more than 1 minute has passed since the last rebuild)
///
/// The cloned engine is then added to the request extensions for use by downstream handlers.
pub(crate) async fn policy_engine_middleware(
    State(app_state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    // Get a cloned PolicyEngine from the global instance, with rebuild check
    let policy_engine = app_state
        .global_policy_engine
        .get_engine_with_rebuild_check(&app_state.db, POLICY_REBUILD_THRESHOLD)
        .await
        .map_err(|e| {
            tracing::error!("Failed to get policy engine: {:?}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // Insert the policy engine into request extensions
    req.extensions_mut().insert(policy_engine);

    Ok(next.run(req).await)
}
