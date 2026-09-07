//! Aggregate persisted responses without exposing conversations or user identities.
use crate::db::entity::prelude::Assistants;
use crate::models::assistant::can_subject_edit_assistant;
use crate::policy::engine::PolicyEngine;
use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use crate::state::AppState;
use axum::{
    Extension, Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use chrono::{Duration, NaiveDate, Utc};
use sea_orm::{DatabaseBackend, EntityTrait, FromQueryResult, Statement};
use serde::{Deserialize, Serialize};
use sqlx::types::Uuid;
use utoipa::{IntoParams, ToSchema};

#[derive(Deserialize, IntoParams)]
pub struct UsageQuery {
    /// One of 1, 4, 12, or 52. Defaults to 4.
    #[param(nullable = false)]
    pub weeks: Option<u32>,
}

#[derive(Serialize, ToSchema)]
pub struct UsageBucket {
    pub date: NaiveDate,
    pub invocations: i64,
    pub unique_users: i64,
}

#[derive(Serialize, ToSchema)]
pub struct AssistantUsage {
    pub assistant_name: String,
    pub total_invocations: i64,
    pub total_unique_users: i64,
    pub bucket_days: u32,
    pub buckets: Vec<UsageBucket>,
}

#[derive(FromQueryResult)]
struct UsageRow {
    bucket: Option<i32>,
    invocations: i64,
    unique_users: i64,
}

// GROUPING SETS computes distinct users over the whole range independently of
// bucket distinct counts. The indexed assistant/chat/date path bounds the scan.
const USAGE_SQL: &str = r#"
WITH assistant_ids AS (
    SELECT $1::uuid AS id
    UNION
    SELECT v.assistant_id FROM assistant_hub_assistant_versions v
    JOIN assistant_hub_assistants h ON h.id = v.assistant_hub_assistant_id
    WHERE h.source_assistant_id = $1
), usage AS (
    SELECT ((m.created_at AT TIME ZONE 'UTC')::date - ($2::timestamptz AT TIME ZONE 'UTC')::date) / $4::int AS bucket,
           c.owner_user_id
    FROM assistant_ids a
    JOIN chats c ON c.assistant_id = a.id
    JOIN messages m ON m.chat_id = c.id
    WHERE m.created_at >= $2 AND m.created_at < $3
      AND m.raw_message->>'role' = 'assistant'
      AND m.generation_metadata IS NOT NULL
)
SELECT bucket, count(*) AS invocations, count(DISTINCT owner_user_id) AS unique_users
FROM usage GROUP BY GROUPING SETS ((bucket), ())
"#;

#[utoipa::path(
    get, path = "/assistants/{assistant_id}/usage", tag = "assistants",
    params(("assistant_id" = Uuid, Path), UsageQuery),
    responses((status = OK, body = AssistantUsage), (status = BAD_REQUEST),
        (status = FORBIDDEN), (status = NOT_FOUND)),
    security(("bearer_auth" = []))
)]
pub async fn get_assistant_usage(
    State(state): State<AppState>,
    Extension(me): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    Path(assistant_id): Path<Uuid>,
    Query(query): Query<UsageQuery>,
) -> Result<Json<AssistantUsage>, StatusCode> {
    if !state.config.assistants.enabled || !state.config.assistants.usage_view_enabled {
        return Err(StatusCode::NOT_FOUND);
    }
    let weeks = query.weeks.unwrap_or(4);
    if !matches!(weeks, 1 | 4 | 12 | 52) {
        return Err(StatusCode::BAD_REQUEST);
    }
    if !can_subject_edit_assistant(&policy, &me.to_subject(), assistant_id).await {
        return Err(StatusCode::FORBIDDEN);
    }
    let assistant = Assistants::find_by_id(assistant_id)
        .one(&state.db)
        .await
        .map_err(|err| {
            tracing::error!(?err, "Loading usage assistant failed");
            StatusCode::INTERNAL_SERVER_ERROR
        })?
        .ok_or(StatusCode::NOT_FOUND)?;
    let end = (Utc::now().date_naive() + Duration::days(1))
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc();
    let start = end - Duration::weeks(i64::from(weeks));
    let bucket_days = if weeks <= 4 { 1 } else { 7 };
    let rows = UsageRow::find_by_statement(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        USAGE_SQL,
        vec![
            assistant_id.into(),
            start.into(),
            end.into(),
            (bucket_days as i32).into(),
        ],
    ))
    .all(&state.db)
    .await
    .map_err(|err| {
        tracing::error!(?err, "Assistant usage aggregation failed");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    let mut result = AssistantUsage {
        assistant_name: assistant.name,
        total_invocations: 0,
        total_unique_users: 0,
        bucket_days,
        buckets: (0..weeks * 7 / bucket_days)
            .map(|i| UsageBucket {
                date: start.date_naive() + Duration::days(i64::from(i * bucket_days)),
                invocations: 0,
                unique_users: 0,
            })
            .collect(),
    };
    for row in rows {
        if let Some(bucket) = row.bucket {
            if let Some(point) = result.buckets.get_mut(bucket as usize) {
                point.invocations = row.invocations;
                point.unique_users = row.unique_users;
            }
        } else {
            result.total_invocations = row.invocations;
            result.total_unique_users = row.unique_users;
        }
    }
    Ok(Json(result))
}
