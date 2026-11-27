use crate::config::{AppConfig, ChatProviderConfig};
use crate::metrics_constants::POSTGRES_QUERY_USER_SPENDING_BY_PROVIDER;
use crate::query_metrics::named_statement_from_sql_and_values;
use chrono::{DateTime, Duration, Utc};
use eyre::{Report, eyre};
use sea_orm::{DatabaseBackend, DatabaseConnection, FromQueryResult};
use std::collections::BTreeMap;

// The aggregate budget_usage field also includes timestamped settlements. Use it
// as a fallback only for messages written before settlements were timestamped.
const WINDOW_USAGE_SQL: &str = r#"
    WITH historical AS (
        SELECT m.created_at, m.generation_metadata AS metadata, m.generation_parameters
        FROM chats c
        JOIN messages m ON m.chat_id = c.id
        WHERE c.owner_user_id = $1
          AND m.raw_message->>'role' = 'assistant'
          AND m.generation_metadata IS NOT NULL
          AND m.created_at > $2 AND m.created_at <= $3
    ), usage AS (
        SELECT
            COALESCE(generation_parameters->>'generation_chat_provider_id', 'unknown') AS identifier,
            true AS legacy, created_at AS occurred_at,
            COALESCE((metadata->>'used_prompt_tokens')::numeric, 0) AS input_tokens,
            NULL::numeric AS cached_input_tokens,
            COALESCE((metadata->>'used_completion_tokens')::numeric, 0) +
                COALESCE((metadata->>'used_reasoning_tokens')::numeric, 0) AS output_tokens,
            COALESCE((metadata->>'used_total_tokens')::numeric, 0) AS total_tokens
        FROM historical
        WHERE metadata ? 'used_total_tokens'
        UNION ALL
        SELECT entry.key, false, created_at,
            (entry.value->>'prompt_tokens')::numeric,
            (entry.value->>'cached_input_tokens')::numeric,
            (entry.value->>'completion_tokens')::numeric,
            (entry.value->>'total_tokens')::numeric
        FROM historical
        CROSS JOIN LATERAL jsonb_each(COALESCE(NULLIF(
            CASE WHEN metadata ? 'budget_usage_settlements'
                 THEN metadata->'budget_usage_at_creation'
                 ELSE metadata->'budget_usage' END,
            'null'::jsonb),
            '{}'::jsonb
        )) AS entry
        UNION ALL
        SELECT entry.key, false, (settlement.value->>'settled_at')::timestamptz,
            (entry.value->>'prompt_tokens')::numeric,
            (entry.value->>'cached_input_tokens')::numeric,
            (entry.value->>'completion_tokens')::numeric,
            (entry.value->>'total_tokens')::numeric
        FROM chats c
        JOIN messages m ON m.chat_id = c.id
        CROSS JOIN LATERAL jsonb_array_elements(m.generation_metadata->'budget_usage_settlements') AS settlement
        CROSS JOIN LATERAL jsonb_each(settlement.value->'usage') AS entry
        WHERE c.owner_user_id = $1
          AND m.raw_message->>'role' = 'assistant'
          AND m.generation_metadata IS NOT NULL
          AND m.generation_metadata ? 'budget_usage_settlements'
          AND (settlement.value->>'settled_at')::timestamptz > $2
          AND (settlement.value->>'settled_at')::timestamptz <= $3
    )
    SELECT identifier, legacy, occurred_at <= $4 AS expiring,
        SUM(input_tokens)::double precision AS input_tokens,
        SUM(cached_input_tokens)::double precision AS cached_input_tokens,
        SUM(output_tokens)::double precision AS output_tokens,
        BOOL_OR(total_tokens > 0 AND input_tokens = 0 AND output_tokens = 0) AS unsplit_tokens
    FROM usage
    WHERE input_tokens > 0 OR output_tokens > 0 OR total_tokens > 0
    GROUP BY identifier, legacy, expiring
    ORDER BY identifier, legacy, expiring
"#;

#[derive(Debug, FromQueryResult)]
struct Usage {
    identifier: String,
    legacy: bool,
    expiring: bool,
    input_tokens: f64,
    cached_input_tokens: Option<f64>,
    output_tokens: f64,
    unsplit_tokens: bool,
}

#[derive(Debug)]
pub(crate) struct BudgetSnapshot {
    pub as_of: DateTime<Utc>,
    pub window_start: DateTime<Utc>,
    pub current_spending: f64,
    pub limit: f64,
    pub pricing_complete: bool,
    pub allowance_freed_next_24h: Option<f64>,
    pub models: Vec<ModelSpending>,
}

#[derive(Debug)]
pub(crate) struct ModelSpending {
    pub identifier: String,
    pub label: String,
    pub spending: Option<f64>,
    pub pricing_complete: bool,
}

/// Read one user-scoped snapshot for both display and budget admission decisions.
pub(crate) async fn user_budget(
    db: &DatabaseConnection,
    config: &AppConfig,
    user_id: &str,
    as_of: DateTime<Utc>,
) -> Result<BudgetSnapshot, Report> {
    let limit = config
        .budget
        .max_budget
        .ok_or_else(|| eyre!("Budget tracking requires a budget limit"))?;
    let window_start = as_of
        .checked_sub_signed(Duration::days(i64::from(config.budget.budget_period_days)))
        .ok_or_else(|| eyre!("Budget window start is outside the supported timestamp range"))?;
    let expiring_through = (window_start + Duration::days(1)).min(as_of);
    let rows = Usage::find_by_statement(named_statement_from_sql_and_values(
        DatabaseBackend::Postgres,
        POSTGRES_QUERY_USER_SPENDING_BY_PROVIDER,
        WINDOW_USAGE_SQL,
        vec![
            user_id.into(),
            window_start.into(),
            as_of.into(),
            expiring_through.into(),
        ],
    ))
    .all(db)
    .await?;

    Ok(price_usage(config, as_of, window_start, limit, rows))
}

fn price_usage(
    config: &AppConfig,
    as_of: DateTime<Utc>,
    window_start: DateTime<Utc>,
    limit: f64,
    rows: Vec<Usage>,
) -> BudgetSnapshot {
    let mut models = BTreeMap::new();
    let mut spend_after_expiration = 0.0;
    let mut expiring_spend = 0.0;
    for row in rows {
        let (identifier, provider) = resolve_provider(config, &row.identifier, row.legacy);
        let rates = config.budget.model_rates.get(&row.identifier).map_or_else(
            || {
                provider.map_or([None; 3], |provider| {
                    let capabilities = &provider.model_capabilities;
                    [
                        capabilities.cost_input_tokens_per_1m,
                        capabilities.cost_cached_input_tokens_per_1m,
                        capabilities.cost_output_tokens_per_1m,
                    ]
                })
            },
            |rates| {
                [
                    Some(rates.cost_input_tokens_per_1m),
                    rates.cost_cached_input_tokens_per_1m,
                    Some(rates.cost_output_tokens_per_1m),
                ]
            },
        );
        let [input_rate, cached_input_rate, output_rate] =
            rates.map(|rate| rate.filter(|rate| rate.is_finite() && *rate >= 0.0));
        let cached_input_tokens = row
            .cached_input_tokens
            .filter(|_| cached_input_rate.is_some())
            .unwrap_or_default();
        let regular_input_tokens = row.input_tokens - cached_input_tokens;
        let spending = [
            price_tokens(regular_input_tokens, input_rate),
            price_tokens(cached_input_tokens, cached_input_rate),
            price_tokens(row.output_tokens, output_rate),
        ]
        .into_iter()
        .flatten()
        .reduce(|left, right| left + right);
        let complete = (!row.unsplit_tokens
            || (input_rate == Some(0.0) && output_rate == Some(0.0)))
            && (regular_input_tokens == 0.0 || input_rate.is_some())
            && (row.output_tokens == 0.0 || output_rate.is_some());

        let model = models
            .entry(identifier.to_owned())
            .or_insert_with(|| ModelSpending {
                identifier: identifier.to_owned(),
                label: provider
                    .map_or(identifier, ChatProviderConfig::model_display_name)
                    .to_owned(),
                spending: None,
                pricing_complete: true,
            });
        model.pricing_complete &= complete;
        if let Some(spending) = spending.or(complete.then_some(0.0)) {
            *model.spending.get_or_insert(0.0) += spending;
            if row.expiring {
                expiring_spend += spending;
            } else {
                spend_after_expiration += spending;
            }
        }
    }
    let models: Vec<_> = models.into_values().collect();
    let current_spending = models
        .iter()
        .filter_map(|model| model.spending)
        .reduce(|total, spending| total + spending)
        .unwrap_or(0.0);
    let pricing_complete = models.iter().all(|model| model.pricing_complete);
    // Summing the non-expiring costs directly avoids cancellation near the limit.
    let allowance_freed_next_24h = pricing_complete.then(|| {
        ((limit - spend_after_expiration).max(0.0) - (limit - current_spending).max(0.0))
            .clamp(0.0, expiring_spend)
    });

    BudgetSnapshot {
        as_of,
        window_start,
        current_spending,
        limit,
        pricing_complete,
        allowance_freed_next_24h,
        models,
    }
}

fn price_tokens(tokens: f64, rate: Option<f64>) -> Option<f64> {
    rate.filter(|_| tokens > 0.0)
        .map(|rate| tokens / 1_000_000.0 * rate)
}

fn resolve_provider<'a>(
    config: &'a AppConfig,
    identifier: &'a str,
    legacy: bool,
) -> (&'a str, Option<&'a ChatProviderConfig>) {
    if let Some(providers) = &config.chat_providers {
        (identifier, providers.providers.get(identifier))
    } else if identifier == "default" {
        (identifier, config.chat_provider.as_ref())
    } else if legacy
        && config.chat_provider.is_some()
        && !config.budget.model_rates.contains_key(identifier)
    {
        ("default", config.chat_provider.as_ref())
    } else {
        (identifier, None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::BudgetModelRate;
    use chrono::TimeZone;
    use sea_orm::SqlxPostgresConnector;
    use serde_json::{Value, json};
    use sqlx::PgPool;
    use uuid::Uuid;

    static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("../sqitch/deploy");

    #[sqlx::test(migrator = "MIGRATOR")]
    async fn rolling_budget_counts_each_user_settlement_at_its_own_timestamp(pool: PgPool) {
        let as_of = Utc.with_ymd_and_hms(2026, 10, 25, 12, 0, 0).unwrap();
        let start = as_of - Duration::days(7);
        let cutoff = start + Duration::days(1);
        let first_inside = start + Duration::microseconds(1);
        let chat = insert_chat(&pool, "budget-user").await;

        let legacy = json!({
            "used_prompt_tokens": 5,
            "used_completion_tokens": 3,
            "used_reasoning_tokens": 2,
            "used_total_tokens": 10
        });
        insert_usage(&pool, chat, start, legacy.clone()).await;
        insert_usage(&pool, chat, first_inside, legacy).await;
        insert_usage(&pool, chat, cutoff, json!({
            "budget_usage_at_creation": {"chat": {"prompt_tokens": 5, "cached_input_tokens": 2, "completion_tokens": 0, "total_tokens": 5}},
            "budget_usage": {"chat": tokens(1004)},
            "budget_usage_settlements": [
                {"settled_at": (as_of + Duration::days(1) + Duration::microseconds(1)).to_rfc3339(), "usage": {"chat": tokens(999)}}
            ]
        })).await;
        // This message was created long before the window and its tool ran
        // after a late approval. Neither its old total nor its rollup is billed.
        insert_usage(
            &pool,
            chat,
            start - Duration::days(10),
            json!({
                "budget_usage_at_creation": {"chat": tokens(50)},
                "budget_usage": {"chat": tokens(120), "image": tokens(25)},
                "budget_usage_settlements": [
                    {"settled_at": start.to_rfc3339(), "usage": {"chat": tokens(500)}},
                    {"settled_at": cutoff.to_rfc3339(), "usage": {"chat": {"prompt_tokens": 10, "cached_input_tokens": 4, "completion_tokens": 0, "total_tokens": 10}}},
                    {"settled_at": as_of.to_rfc3339(), "usage": {"chat": tokens(60), "image": tokens(25)}}
                ]
            }),
        )
        .await;
        insert_usage(
            &pool,
            chat,
            as_of + Duration::days(2),
            json!({
                "budget_usage": {"chat": tokens(500)}
            }),
        )
        .await;

        let other = insert_chat(&pool, "other-user").await;
        insert_usage(
            &pool,
            other,
            first_inside,
            json!({
                "budget_usage": {"image": tokens(500)}
            }),
        )
        .await;

        let db = SqlxPostgresConnector::from_sqlx_postgres_pool(pool.clone());
        let mut config = AppConfig::default();
        config.budget.enabled = true;
        config.budget.max_budget = Some(100.0);
        config.budget.budget_period_days = 7;
        for name in ["chat", "image"] {
            add_rate(&mut config, name, 1_000_000.0);
        }
        let snapshot = user_budget(&db, &config, "budget-user", as_of)
            .await
            .unwrap();
        assert_eq!((snapshot.window_start, snapshot.as_of), (start, as_of));
        assert_eq!(snapshot.current_spending, 110.0);
        assert_eq!(snapshot.allowance_freed_next_24h, Some(15.0));
        assert!(snapshot.pricing_complete);
        assert_eq!(
            snapshot
                .models
                .iter()
                .map(|row| (row.identifier.as_str(), row.spending))
                .collect::<Vec<_>>(),
            [("chat", Some(85.0)), ("image", Some(25.0))]
        );

        let mut discounted_config = config.clone();
        discounted_config.budget.max_budget = Some(200.0);
        discounted_config
            .budget
            .model_rates
            .get_mut("chat")
            .unwrap()
            .cost_cached_input_tokens_per_1m = Some(500_000.0);
        let discounted = user_budget(&db, &discounted_config, "budget-user", as_of)
            .await
            .unwrap();
        assert_eq!(discounted.current_spending, 107.0);
        assert_eq!(discounted.allowance_freed_next_24h, Some(22.0));
        assert!(discounted.pricing_complete);

        config.budget.frontend_tab.enabled = true;
        let enabled = user_budget(&db, &config, "budget-user", as_of)
            .await
            .unwrap();
        assert_eq!(enabled.current_spending, snapshot.current_spending);

        let later = user_budget(&db, &config, "budget-user", as_of + Duration::days(1))
            .await
            .unwrap();
        assert_eq!(later.current_spending, 85.0);
        assert!(later.current_spending < later.limit);
        config.budget.budget_period_days = 1;
        let one_day = user_budget(&db, &config, "budget-user", as_of)
            .await
            .unwrap();
        assert_eq!(one_day.current_spending, 85.0);
        assert_eq!(one_day.allowance_freed_next_24h, Some(85.0));

        let empty = user_budget(&db, &config, "no-usage", as_of).await.unwrap();
        assert_eq!(empty.current_spending, 0.0);
        assert!(empty.current_spending.is_sign_positive());
        assert_eq!(empty.allowance_freed_next_24h, Some(0.0));
        assert!(empty.pricing_complete);
        assert!(empty.models.is_empty());

        add_rate(&mut config, "free", 0.0);
        insert_usage(
            &pool,
            chat,
            as_of,
            json!({
                "budget_usage": {"unpriced": tokens(100), "free": tokens(100)}
            }),
        )
        .await;
        let partial = user_budget(&db, &config, "budget-user", as_of)
            .await
            .unwrap();
        assert_eq!(partial.current_spending, 85.0);
        assert!(!partial.pricing_complete);
        assert_eq!(partial.allowance_freed_next_24h, None);
        let spending_for = |id: &str| {
            partial
                .models
                .iter()
                .find(|row| row.identifier == id)
                .unwrap()
                .spending
        };
        assert_eq!(spending_for("free"), Some(0.0));
        assert_eq!(spending_for("unpriced"), None);
    }

    fn tokens(prompt: u64) -> Value {
        json!({"prompt_tokens": prompt, "completion_tokens": 0, "total_tokens": prompt})
    }

    fn add_rate(config: &mut AppConfig, identifier: &str, cost: f64) {
        config.budget.model_rates.insert(
            identifier.into(),
            BudgetModelRate {
                cost_input_tokens_per_1m: cost,
                cost_cached_input_tokens_per_1m: None,
                cost_output_tokens_per_1m: cost,
            },
        );
    }

    async fn insert_chat(pool: &PgPool, owner: &str) -> Uuid {
        sqlx::query_scalar("INSERT INTO chats (owner_user_id) VALUES ($1) RETURNING id")
            .bind(owner)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    async fn insert_usage(pool: &PgPool, chat: Uuid, created_at: DateTime<Utc>, metadata: Value) {
        sqlx::query(
            r#"INSERT INTO messages (chat_id, created_at, raw_message, generation_parameters, generation_metadata)
               VALUES ($1, $2, '{"role":"assistant","content":[]}', '{"generation_chat_provider_id":"chat"}', $3)"#,
        )
        .bind(chat)
        .bind(created_at)
        .bind(metadata)
        .execute(pool)
        .await
        .unwrap();
    }
}
