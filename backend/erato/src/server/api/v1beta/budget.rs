use crate::config::BudgetCurrency;
use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use crate::services::budget::{BudgetSnapshot, user_budget};
use crate::state::AppState;
use axum::extract::State;
use axum::{Extension, Json};
use chrono::{DateTime, Utc};
use serde::Serialize;
use utoipa::ToSchema;

/// Budget status information for the current user
#[derive(Debug, ToSchema, Serialize)]
pub struct BudgetStatusResponse {
    /// Whether the budget feature is enabled
    enabled: bool,
    /// Number of days in the rolling budget window
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    budget_period_days: Option<u32>,
    /// Known spending in the rolling window for the user (unit-less)
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    current_spending: Option<f64>,
    /// The warning threshold (0.0 to 1.0)
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    warn_threshold: Option<f64>,
    /// The budget limit for the time period (unit-less)
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    budget_limit: Option<f64>,
    /// The currency configured for display purposes
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    budget_currency: Option<BudgetCurrency>,
    /// Extra detail for the optional Budget tab in web Settings
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    user_settings: Option<BudgetUserSettings>,
}

#[derive(Debug, ToSchema, Serialize)]
pub struct BudgetUserSettings {
    pub as_of: DateTime<Utc>,
    pub window_start: DateTime<Utc>,
    pub models: Vec<BudgetModelSpending>,
    pub pricing_complete: bool,
    /// Extra allowance that becomes spendable in the next 24 hours with no new spend.
    #[schema(required = true)]
    pub allowance_freed_next_24h: Option<f64>,
}

#[derive(Debug, ToSchema, Serialize)]
pub struct BudgetModelSpending {
    pub identifier: String,
    pub label: String,
    /// Known spending. Null when none of this model's usage could be priced.
    #[schema(required = true)]
    pub spending: Option<f64>,
    pub pricing_complete: bool,
}

impl From<BudgetSnapshot> for BudgetUserSettings {
    fn from(snapshot: BudgetSnapshot) -> Self {
        Self {
            as_of: snapshot.as_of,
            window_start: snapshot.window_start,
            models: snapshot
                .models
                .into_iter()
                .map(|model| BudgetModelSpending {
                    identifier: model.identifier,
                    label: model.label,
                    spending: model.spending,
                    pricing_complete: model.pricing_complete,
                })
                .collect(),
            pricing_complete: snapshot.pricing_complete,
            allowance_freed_next_24h: snapshot.allowance_freed_next_24h,
        }
    }
}

#[utoipa::path(
    get,
    path = "/me/budget",
    responses(
        (status = OK, body = BudgetStatusResponse),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided"),
        (status = INTERNAL_SERVER_ERROR, description = "When an internal server error occurs")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn budget_status(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
) -> Result<Json<BudgetStatusResponse>, axum::http::StatusCode> {
    let budget_config = &app_state.config.budget;

    // If budget is not enabled, return minimal response
    if !budget_config.enabled {
        return Ok(Json(BudgetStatusResponse {
            enabled: false,
            budget_period_days: None,
            current_spending: None,
            warn_threshold: None,
            budget_limit: None,
            budget_currency: None,
            user_settings: None,
        }));
    }

    let snapshot = user_budget(&app_state.db, &app_state.config, &me_user.id, Utc::now())
        .await
        .map_err(|error| {
            tracing::error!(%error, "Failed to calculate user budget");
            axum::http::StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(Json(BudgetStatusResponse {
        enabled: true,
        budget_period_days: Some(budget_config.budget_period_days),
        current_spending: Some(snapshot.current_spending),
        warn_threshold: Some(budget_config.warn_threshold),
        budget_limit: Some(snapshot.limit),
        budget_currency: Some(budget_config.budget_currency.clone()),
        user_settings: budget_config
            .frontend_tab_enabled()
            .then(|| snapshot.into()),
    }))
}
