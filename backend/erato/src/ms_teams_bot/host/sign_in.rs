//! Short-lived, database-backed continuation of requests awaiting Teams OAuth.

use super::Host;
use crate::db::entity::ms_teams_pending_sign_ins::{self as pending, Column, Entity};
use crate::ms_teams_bot::activity::Activity;
use crate::ms_teams_bot::user_token::SignInScope;
use eyre::{Report, eyre};
use sea_orm::sea_query::OnConflict;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, EntityTrait, IntoActiveModel, QueryFilter,
    QueryOrder, QuerySelect, TransactionTrait,
};

const SIGN_IN_TTL_MINUTES: i64 = 15;

fn scope_query(scope: &SignInScope) -> sea_orm::Select<Entity> {
    Entity::find()
        .filter(Column::BotAppId.eq(&scope.bot_app_id))
        .filter(Column::TenantId.eq(&scope.tenant_id))
        .filter(Column::ConnectionName.eq(&scope.connection_name))
        .filter(Column::ConversationId.eq(&scope.conversation_id))
        .filter(Column::MsTeamsUserId.eq(&scope.ms_teams_user_id))
        .filter(Column::EntraObjectId.eq(&scope.entra_object_id))
        .filter(Column::ExpiresAt.gt(chrono::Utc::now()))
}

fn source_query(scope: &SignInScope, activity: &Activity) -> sea_orm::Select<Entity> {
    Entity::find()
        .filter(Column::BotAppId.eq(&scope.bot_app_id))
        .filter(Column::TenantId.eq(&scope.tenant_id))
        .filter(Column::ConnectionName.eq(&scope.connection_name))
        .filter(Column::MsTeamsUserId.eq(&scope.ms_teams_user_id))
        .filter(Column::EntraObjectId.eq(&scope.entra_object_id))
        .filter(Column::SourceConversationId.eq(activity.conversation_id().unwrap_or_default()))
        .filter(Column::SourceActivityId.eq(activity.id.as_deref().unwrap_or_default()))
        .filter(Column::ExpiresAt.gt(chrono::Utc::now()))
}

impl Host {
    /// Includes consumed rows so a retried incoming activity cannot bypass the
    /// continuation claim once the token service has cached the user's token.
    pub async fn has_sign_in_request(
        &self,
        scope: &SignInScope,
        activity: &Activity,
    ) -> Result<bool, Report> {
        Ok(source_query(scope, activity)
            .one(&self.app_state.db)
            .await?
            .is_some())
    }

    /// Persist before sending the card: a fast Teams client may exchange its
    /// token before the Connector POST has returned. Never persist OAuth tokens.
    pub async fn remember_sign_in(
        &self,
        scope: &SignInScope,
        exchange_id: Option<&str>,
        activity: &Activity,
    ) -> Result<bool, Report> {
        let source_id = activity
            .id
            .as_deref()
            .filter(|id| !id.is_empty())
            .ok_or_else(|| eyre!("cannot resume a Teams message without its activity ID"))?;
        let source_conversation = activity
            .conversation_id()
            .ok_or_else(|| eyre!("cannot resume a Teams message without its conversation"))?;
        if activity.kind != "message" {
            return Err(eyre!("only message activities may wait for sign-in"));
        }
        if activity.tenant_id() != Some(scope.tenant_id.as_str())
            || activity.from.as_ref().map(|from| from.id.as_str())
                != Some(scope.ms_teams_user_id.as_str())
            || activity.from_aad_object_id() != Some(scope.entra_object_id.as_str())
        {
            return Err(eyre!(
                "pending sign-in does not belong to the original Teams sender"
            ));
        }
        Entity::delete_many()
            .filter(Column::ExpiresAt.lte(chrono::Utc::now()))
            .exec(&self.app_state.db)
            .await?;
        let row = pending::ActiveModel {
            bot_app_id: Set(scope.bot_app_id.clone()),
            tenant_id: Set(scope.tenant_id.clone()),
            connection_name: Set(scope.connection_name.clone()),
            conversation_id: Set(scope.conversation_id.clone()),
            ms_teams_user_id: Set(scope.ms_teams_user_id.clone()),
            entra_object_id: Set(scope.entra_object_id.clone()),
            source_conversation_id: Set(source_conversation.to_string()),
            source_activity_id: Set(source_id.to_string()),
            exchange_id: Set(exchange_id.map(ToOwned::to_owned)),
            activity: Set(Some(serde_json::to_value(activity)?)),
            expires_at: Set(
                (chrono::Utc::now() + chrono::Duration::minutes(SIGN_IN_TTL_MINUTES)).into(),
            ),
            ..Default::default()
        };
        let inserted = Entity::insert(row)
            .on_conflict(
                OnConflict::columns([
                    Column::BotAppId,
                    Column::TenantId,
                    Column::ConnectionName,
                    Column::MsTeamsUserId,
                    Column::SourceConversationId,
                    Column::SourceActivityId,
                ])
                .do_nothing()
                .to_owned(),
            )
            .exec_without_returning(&self.app_state.db)
            .await?;
        Ok(inserted > 0)
    }

    /// Allow a retry if card delivery failed; preserve an already consumed row.
    pub async fn discard_sign_in(
        &self,
        scope: &SignInScope,
        activity: &Activity,
    ) -> Result<(), Report> {
        if let Some(row) = source_query(scope, activity)
            .one(&self.app_state.db)
            .await?
        {
            Entity::delete_many()
                .filter(Column::Id.eq(row.id))
                .filter(Column::Activity.is_not_null())
                .exec(&self.app_state.db)
                .await?;
        }
        Ok(())
    }

    /// SSO claims the card's exchange ID; interactive sign-in (which supplies
    /// no exchange ID) claims the user's pending requests in that private chat.
    /// Row locks and payload clearing make both callbacks share one claim, even
    /// across replicas. Expired requests are never replayed.
    pub async fn claim_pending_sign_ins(
        &self,
        scope: &SignInScope,
        exchange_id: Option<&str>,
    ) -> Result<Vec<Activity>, Report> {
        let txn = self.app_state.db.begin().await?;
        let mut query = scope_query(scope).filter(Column::Activity.is_not_null());
        if let Some(id) = exchange_id {
            query = query.filter(Column::ExchangeId.eq(id));
        }
        let rows = query
            .order_by_asc(Column::CreatedAt)
            .order_by_asc(Column::Id)
            .lock_exclusive()
            .all(&txn)
            .await?;
        let mut activities = Vec::with_capacity(rows.len());
        for row in rows {
            if let Some(activity) = row.activity.clone() {
                activities.push(serde_json::from_value(activity)?);
                let mut row = row.into_active_model();
                row.activity = Set(None);
                row.update(&txn).await?;
            }
        }
        txn.commit().await?;
        Ok(activities)
    }
}
