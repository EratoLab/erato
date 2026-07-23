use crate::config::DesktopSidecarOrganizationConfiguration;
use crate::policy::engine::{PolicyEngine, authorize};
use crate::policy::types::{Action, Resource};
use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use crate::state::AppState;
use axum::extract::State;
use axum::http::StatusCode;
use axum::{Extension, Json};

#[utoipa::path(
    get,
    path = "/me/desktop-sidecar/organization-configuration",
    responses(
        (status = OK, body = DesktopSidecarOrganizationConfiguration),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn organization_configuration(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
) -> Result<Json<DesktopSidecarOrganizationConfiguration>, StatusCode> {
    policy
        .rebuild_data_if_needed_req(&app_state.db, &app_state.config)
        .await?;
    authorize!(
        policy,
        &me_user.to_subject(),
        &Resource::DesktopSidecarConfigurationSingleton,
        Action::Read
    )
    .map_err(|error| {
        tracing::warn!(%error, "Desktop sidecar configuration authorization failed");
        StatusCode::UNAUTHORIZED
    })?;

    Ok(Json(
        app_state
            .config
            .desktop_sidecar
            .organization_configuration
            .clone(),
    ))
}
