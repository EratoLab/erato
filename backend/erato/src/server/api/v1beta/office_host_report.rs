use crate::metrics::office_host::{office_host_labels, record_office_addin_pane_start};
use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use axum::http::StatusCode;
use axum::{Extension, Json};
use serde::Deserialize;
use utoipa::ToSchema;

/// What an Office add-in pane runs on, sent once when the pane has started and signed in.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct OfficeHostReportRequest {
    /// `Office.HostType` as `Office.onReady` reports it, e.g. `PowerPoint`.
    pub host: String,
    /// `Office.PlatformType`, e.g. `PC`, `Mac` or `OfficeOnline`.
    #[serde(default)]
    #[schema(nullable = false)]
    pub platform: Option<String>,
    /// PowerPoint only: the highest PowerPoint API set the pane detected, or `none`.
    #[serde(default)]
    #[schema(nullable = false)]
    pub api_set: Option<String>,
    /// PowerPoint only: the pane's read tier, `full`, `basic` or `none`.
    #[serde(default)]
    #[schema(nullable = false)]
    pub tier: Option<String>,
}

#[utoipa::path(
    post,
    path = "/me/office-host-report",
    request_body = OfficeHostReportRequest,
    responses(
        (status = NO_CONTENT, description = "Counted in erato_office_addin_pane_starts_total"),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided"),
        (status = UNPROCESSABLE_ENTITY, description = "When the body is not a report")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn office_host_report(
    Extension(_me_user): Extension<MeProfile>,
    Json(report): Json<OfficeHostReportRequest>,
) -> StatusCode {
    record_office_addin_pane_start(&office_host_labels(
        &report.host,
        report.platform.as_deref(),
        report.api_set.as_deref(),
        report.tier.as_deref(),
    ));
    StatusCode::NO_CONTENT
}
