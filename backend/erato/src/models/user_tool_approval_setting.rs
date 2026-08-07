use crate::db::entity::prelude::UserToolApprovalSettings;
use crate::db::entity::user_tool_approval_settings;
use eyre::Report;
use sea_orm::prelude::Uuid;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder, Set,
};

pub async fn find_active(
    conn: &DatabaseConnection,
    user_id: Uuid,
    mcp_server_id: &str,
    tool_name: &str,
) -> Result<Option<user_tool_approval_settings::Model>, Report> {
    Ok(UserToolApprovalSettings::find()
        .filter(user_tool_approval_settings::Column::UserId.eq(user_id))
        .filter(user_tool_approval_settings::Column::McpServerId.eq(mcp_server_id))
        .filter(user_tool_approval_settings::Column::ToolName.eq(tool_name))
        .filter(user_tool_approval_settings::Column::Active.eq(true))
        .one(conn)
        .await?)
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

pub async fn upsert_active(
    conn: &DatabaseConnection,
    user_id: Uuid,
    mcp_server_id: &str,
    tool_name: &str,
) -> Result<user_tool_approval_settings::Model, Report> {
    let existing = UserToolApprovalSettings::find()
        .filter(user_tool_approval_settings::Column::UserId.eq(user_id))
        .filter(user_tool_approval_settings::Column::McpServerId.eq(mcp_server_id))
        .filter(user_tool_approval_settings::Column::ToolName.eq(tool_name))
        .one(conn)
        .await?;
    if let Some(existing) = existing {
        let mut model: user_tool_approval_settings::ActiveModel = existing.into();
        model.active = Set(true);
        model.deactivated_at = Set(None);
        Ok(model.update(conn).await?)
    } else {
        Ok(
            UserToolApprovalSettings::insert(user_tool_approval_settings::ActiveModel {
                id: Set(Uuid::new_v4()),
                user_id: Set(user_id),
                mcp_server_id: Set(mcp_server_id.to_string()),
                tool_name: Set(tool_name.to_string()),
                active: Set(true),
                ..Default::default()
            })
            .exec_with_returning(conn)
            .await?,
        )
    }
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
