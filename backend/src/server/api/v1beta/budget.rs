use crate::config::BudgetCurrency;
use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use crate::state::AppState;
use axum::extract::State;
use axum::{Extension, Json};
use chrono::{DateTime, Duration, Utc};
use eyre::Report;
use sea_orm::{DatabaseConnection, FromQueryResult, Statement};
use serde::Serialize;
use utoipa::ToSchema;

/// Budget status information for the current user
#[derive(Debug, ToSchema, Serialize)]
pub struct BudgetStatusResponse {
    /// Whether the budget feature is enabled
    enabled: bool,
    /// Number of days in the current budget period
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    budget_period_days: Option<u32>,
    /// Current spending in the budget period for the user (unit-less)
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
}

/// Database result for user token usage aggregation by chat provider
#[derive(Debug, FromQueryResult)]
struct UserTokenUsageByProvider {
    chat_provider_id: String,
    total_prompt_tokens: Option<i64>,
    total_completion_tokens: Option<i64>,
    total_reasoning_tokens: Option<i64>,
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
        }));
    }

    // Calculate current budget period dates
    let now = Utc::now();
    let period_duration = Duration::days(budget_config.budget_period_days as i64);

    // For simplicity, we'll calculate the period start as the beginning of the current period
    // This assumes periods start from a fixed point and roll over every N days
    // A more sophisticated implementation might use user-specific period starts
    let days_since_epoch = now.timestamp() / (24 * 60 * 60);
    let period_number = days_since_epoch / budget_config.budget_period_days as i64;
    let period_start_timestamp =
        period_number * budget_config.budget_period_days as i64 * 24 * 60 * 60;
    let current_period_start =
        DateTime::from_timestamp(period_start_timestamp, 0).unwrap_or(now - period_duration);
    let current_period_end = current_period_start + period_duration;

    // Calculate current spending for the user in this period
    let current_spending = match calculate_user_spending(
        &app_state.db,
        &me_user.0.id,
        current_period_start,
        current_period_end,
        &app_state,
    )
    .await
    {
        Ok(spending) => Some(spending),
        Err(e) => {
            tracing::error!("Failed to calculate user spending: {}", e);
            return Err(axum::http::StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    Ok(Json(BudgetStatusResponse {
        enabled: true,
        budget_period_days: Some(budget_config.budget_period_days),
        current_spending,
        warn_threshold: Some(budget_config.warn_threshold),
        budget_limit: budget_config.max_budget,
        budget_currency: Some(budget_config.budget_currency.clone()),
    }))
}

/// Calculate the total spending for a user in a given time period
async fn calculate_user_spending(
    db: &DatabaseConnection,
    user_id: &str,
    period_start: DateTime<Utc>,
    period_end: DateTime<Utc>,
    app_state: &AppState,
) -> Result<f64, Report> {
    // Use the updated view to get token usage grouped by chat provider
    let sql = r#"
        SELECT 
            chat_provider_id,
            SUM(total_prompt_tokens)::BIGINT as total_prompt_tokens,
            SUM(total_completion_tokens)::BIGINT as total_completion_tokens,
            SUM(total_reasoning_tokens)::BIGINT as total_reasoning_tokens
        FROM user_daily_token_usage
        WHERE user_id = $1
          AND usage_date >= $2::date
          AND usage_date < $3::date
        GROUP BY chat_provider_id
    "#;

    let usage_results =
        UserTokenUsageByProvider::find_by_statement(Statement::from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            sql,
            vec![
                user_id.into(),
                period_start.date_naive().into(),
                period_end.date_naive().into(),
            ],
        ))
        .all(db)
        .await?;

    let mut total_cost = 0.0;

    // Calculate cost for each provider separately using their specific pricing
    for usage in usage_results {
        let prompt_tokens = usage.total_prompt_tokens.unwrap_or(0) as f64;
        let completion_tokens = usage.total_completion_tokens.unwrap_or(0) as f64;
        let reasoning_tokens = usage.total_reasoning_tokens.unwrap_or(0) as f64;

        // Find the provider configuration for this usage
        let provider_config = if let Some(chat_providers) = &app_state.config.chat_providers {
            chat_providers.providers.get(&usage.chat_provider_id)
        } else if let Some(single_provider) = &app_state.config.chat_provider {
            // For legacy single provider, match any provider ID
            Some(single_provider)
        } else {
            None
        };

        if let Some(provider) = provider_config {
            // Calculate costs per million tokens using provider-specific pricing
            let prompt_cost = (prompt_tokens / 1_000_000.0)
                * provider.model_capabilities.cost_input_tokens_per_1m;
            let completion_cost = (completion_tokens / 1_000_000.0)
                * provider.model_capabilities.cost_output_tokens_per_1m;
            // Reasoning tokens are priced the same as output tokens
            let reasoning_cost = (reasoning_tokens / 1_000_000.0)
                * provider.model_capabilities.cost_output_tokens_per_1m;

            total_cost += prompt_cost + completion_cost + reasoning_cost;
        } else {
            // If we can't find the provider config, log a warning but continue
            tracing::warn!(
                "No provider configuration found for chat_provider_id: {}, skipping cost calculation",
                usage.chat_provider_id
            );
        }
    }

    Ok(total_cost)
}
