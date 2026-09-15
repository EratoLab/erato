use crate::db::entity::prelude::UserToolApprovalSettings;
use crate::db::entity::user_tool_approval_settings;
use eyre::Report;
use sea_orm::prelude::Uuid;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection, EntityTrait, QueryFilter,
    QueryOrder, Set, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// A user's persistent decision for one MCP tool. Rows exist only while a
/// decision is active; the absence of a row means the policy default applies.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum UserToolDecision {
    #[default]
    AlwaysAllow,
    /// Ask before every run, even where the policy would not.
    Ask,
    Denied,
}

impl UserToolDecision {
    pub fn as_str(self) -> &'static str {
        match self {
            UserToolDecision::AlwaysAllow => "always_allow",
            UserToolDecision::Ask => "ask",
            UserToolDecision::Denied => "denied",
        }
    }

    /// The column carries a CHECK constraint, so anything else is a schema
    /// drift; read it pessimistically as denied rather than as a grant.
    pub fn from_column(value: &str) -> Self {
        match value {
            "always_allow" => UserToolDecision::AlwaysAllow,
            "ask" => UserToolDecision::Ask,
            _ => UserToolDecision::Denied,
        }
    }
}

pub fn decision_of(model: &user_tool_approval_settings::Model) -> UserToolDecision {
    UserToolDecision::from_column(&model.decision)
}

/// The user's active decision for a tool, if any. The three decisions share
/// the table, so a reader must never take the presence of a row for a grant.
pub async fn find_active_decision(
    conn: &DatabaseConnection,
    user_id: Uuid,
    mcp_server_id: &str,
    tool_name: &str,
) -> Result<Option<UserToolDecision>, Report> {
    Ok(UserToolApprovalSettings::find()
        .filter(user_tool_approval_settings::Column::UserId.eq(user_id))
        .filter(user_tool_approval_settings::Column::McpServerId.eq(mcp_server_id))
        .filter(user_tool_approval_settings::Column::ToolName.eq(tool_name))
        .filter(user_tool_approval_settings::Column::Active.eq(true))
        .one(conn)
        .await?
        .as_ref()
        .map(decision_of))
}

pub async fn list_active(
    conn: &DatabaseConnection,
    user_id: Uuid,
) -> Result<Vec<user_tool_approval_settings::Model>, Report> {
    Ok(UserToolApprovalSettings::find()
        .filter(user_tool_approval_settings::Column::UserId.eq(user_id))
        .filter(user_tool_approval_settings::Column::Active.eq(true))
        .order_by_asc(user_tool_approval_settings::Column::McpServerId)
        .order_by_asc(user_tool_approval_settings::Column::ToolName)
        .all(conn)
        .await?)
}

pub async fn list_active_for_server<C: ConnectionTrait>(
    conn: &C,
    user_id: Uuid,
    mcp_server_id: &str,
) -> Result<Vec<user_tool_approval_settings::Model>, Report> {
    Ok(UserToolApprovalSettings::find()
        .filter(user_tool_approval_settings::Column::UserId.eq(user_id))
        .filter(user_tool_approval_settings::Column::McpServerId.eq(mcp_server_id))
        .filter(user_tool_approval_settings::Column::Active.eq(true))
        .order_by_asc(user_tool_approval_settings::Column::ToolName)
        .all(conn)
        .await?)
}

pub async fn list_denied(
    conn: &DatabaseConnection,
    user_id: Uuid,
) -> Result<Vec<user_tool_approval_settings::Model>, Report> {
    Ok(UserToolApprovalSettings::find()
        .filter(user_tool_approval_settings::Column::UserId.eq(user_id))
        .filter(user_tool_approval_settings::Column::Active.eq(true))
        .filter(user_tool_approval_settings::Column::Decision.eq(UserToolDecision::Denied.as_str()))
        .all(conn)
        .await?)
}

async fn find_row<C: ConnectionTrait>(
    conn: &C,
    user_id: Uuid,
    mcp_server_id: &str,
    tool_name: &str,
) -> Result<Option<user_tool_approval_settings::Model>, Report> {
    Ok(UserToolApprovalSettings::find()
        .filter(user_tool_approval_settings::Column::UserId.eq(user_id))
        .filter(user_tool_approval_settings::Column::McpServerId.eq(mcp_server_id))
        .filter(user_tool_approval_settings::Column::ToolName.eq(tool_name))
        .one(conn)
        .await?)
}

pub async fn upsert_active<C: ConnectionTrait>(
    conn: &C,
    user_id: Uuid,
    mcp_server_id: &str,
    tool_name: &str,
    decision: UserToolDecision,
) -> Result<user_tool_approval_settings::Model, Report> {
    if let Some(existing) = find_row(conn, user_id, mcp_server_id, tool_name).await? {
        let mut model: user_tool_approval_settings::ActiveModel = existing.into();
        model.active = Set(true);
        model.deactivated_at = Set(None);
        model.decision = Set(decision.as_str().to_string());
        Ok(model.update(conn).await?)
    } else {
        Ok(
            UserToolApprovalSettings::insert(user_tool_approval_settings::ActiveModel {
                id: Set(Uuid::new_v4()),
                user_id: Set(user_id),
                mcp_server_id: Set(mcp_server_id.to_string()),
                tool_name: Set(tool_name.to_string()),
                active: Set(true),
                decision: Set(decision.as_str().to_string()),
                ..Default::default()
            })
            .exec_with_returning(conn)
            .await?,
        )
    }
}

/// Deactivate the decision for one tool, returning to the policy default. A
/// tool without an active row is already there, so that is not an error.
pub async fn deactivate_tool<C: ConnectionTrait>(
    conn: &C,
    user_id: Uuid,
    mcp_server_id: &str,
    tool_name: &str,
) -> Result<(), Report> {
    if let Some(existing) = find_row(conn, user_id, mcp_server_id, tool_name).await?
        && existing.active
    {
        let mut model: user_tool_approval_settings::ActiveModel = existing.into();
        model.active = Set(false);
        model.deactivated_at = Set(Some(chrono::Utc::now().fixed_offset()));
        model.update(conn).await?;
    }
    Ok(())
}

/// Apply a set of decisions for one server atomically: `None` deactivates
/// the tool's row. Returns the server's active decisions afterwards. The
/// caller validates the entries beforehand; a failure here rolls back all.
pub async fn apply_batch(
    conn: &DatabaseConnection,
    user_id: Uuid,
    mcp_server_id: &str,
    decisions: &[(String, Option<UserToolDecision>)],
) -> Result<Vec<user_tool_approval_settings::Model>, Report> {
    let txn = conn.begin().await?;
    for (tool_name, decision) in decisions {
        match decision {
            Some(decision) => {
                upsert_active(&txn, user_id, mcp_server_id, tool_name, *decision).await?;
            }
            None => deactivate_tool(&txn, user_id, mcp_server_id, tool_name).await?,
        }
    }
    let settings = list_active_for_server(&txn, user_id, mcp_server_id).await?;
    txn.commit().await?;
    Ok(settings)
}

pub async fn deactivate(
    conn: &DatabaseConnection,
    user_id: Uuid,
    setting_id: Uuid,
) -> Result<bool, Report> {
    let Some(existing) = UserToolApprovalSettings::find_by_id(setting_id)
        .one(conn)
        .await?
    else {
        return Ok(false);
    };
    if existing.user_id != user_id {
        return Ok(false);
    }
    let mut model: user_tool_approval_settings::ActiveModel = existing.into();
    model.active = Set(false);
    model.deactivated_at = Set(Some(chrono::Utc::now().fixed_offset()));
    model.update(conn).await?;
    Ok(true)
}
