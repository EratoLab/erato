use crate::db::entity::prelude::*;
use crate::db::entity::share_links;
use crate::policy::engine::authorize;
use crate::policy::prelude::*;
use eyre::{ContextCompat, Report, WrapErr, eyre};
use sea_orm::prelude::*;
use sea_orm::{ColumnTrait, Condition, DatabaseConnection, EntityTrait, QueryFilter, Set};
use serde::Serialize;
use sqlx::types::Uuid;

#[derive(Debug, Clone, Serialize)]
pub struct ShareLinkInfo {
    pub id: Uuid,
    pub resource_type: String,
    pub resource_id: String,
    pub enabled: bool,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: DateTimeWithTimeZone,
}

impl From<share_links::Model> for ShareLinkInfo {
    fn from(link: share_links::Model) -> Self {
        Self {
            id: link.id,
            resource_type: link.resource_type,
            resource_id: link.resource_id,
            enabled: link.enabled,
            created_at: link.created_at,
            updated_at: link.updated_at,
        }
    }
}

fn ensure_chat_sharing_enabled(config: &crate::config::AppConfig) -> Result<(), Report> {
    if !config.chat_sharing.enabled {
        return Err(eyre!("Chat sharing is disabled"));
    }
    Ok(())
}

async fn authorize_shareable_resource(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    resource_type: &str,
    resource_id: &str,
) -> Result<(), Report> {
    match resource_type {
        "chat" => {
            let chat_id = Uuid::parse_str(resource_id).wrap_err("Invalid chat ID format")?;
            let chat = Chats::find_by_id(chat_id)
                .one(conn)
                .await?
                .wrap_err("Chat not found")?;

            if chat.archived_at.is_some() {
                return Err(eyre!("Archived chats cannot be shared"));
            }

            authorize!(
                policy,
                subject,
                &Resource::Chat(resource_id.to_string()),
                Action::Share
            )?;
            Ok(())
        }
        _ => Err(eyre!(
            "Unsupported resource type for share links: {}",
            resource_type
        )),
    }
}

pub async fn get_share_link_for_resource(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    resource_type: &str,
    resource_id: &str,
) -> Result<Option<share_links::Model>, Report> {
    match resource_type {
        "chat" => {
            authorize!(
                policy,
                subject,
                &Resource::Chat(resource_id.to_string()),
                Action::Share
            )?;
        }
        _ => return Err(eyre!("Unsupported resource type: {}", resource_type)),
    }

    ShareLinks::find()
        .filter(
            Condition::all()
                .add(share_links::Column::ResourceType.eq(resource_type))
                .add(share_links::Column::ResourceId.eq(resource_id)),
        )
        .one(conn)
        .await
        .map_err(Into::into)
}

pub async fn set_share_link_enabled(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    config: &crate::config::AppConfig,
    resource_type: String,
    resource_id: String,
    enabled: bool,
) -> Result<share_links::Model, Report> {
    ensure_chat_sharing_enabled(config)?;
    policy.rebuild_data_if_needed(conn, config).await?;
    authorize_shareable_resource(conn, policy, subject, &resource_type, &resource_id).await?;

    if let Some(existing) = ShareLinks::find()
        .filter(
            Condition::all()
                .add(share_links::Column::ResourceType.eq(resource_type.clone()))
                .add(share_links::Column::ResourceId.eq(resource_id.clone())),
        )
        .one(conn)
        .await?
    {
        let mut active_model: share_links::ActiveModel = existing.into();
        active_model.enabled = Set(enabled);
        let updated = active_model.update(conn).await?;
        policy.invalidate_data().await;
        return Ok(updated);
    }

    let created = ShareLinks::insert(share_links::ActiveModel {
        id: Set(Uuid::new_v4()),
        resource_type: Set(resource_type),
        resource_id: Set(resource_id),
        enabled: Set(enabled),
        created_at: Set(chrono::Utc::now().into()),
        updated_at: Set(chrono::Utc::now().into()),
    })
    .exec_with_returning(conn)
    .await?;

    policy.invalidate_data().await;
    Ok(created)
}

pub async fn get_active_share_link_by_id(
    conn: &DatabaseConnection,
    config: &crate::config::AppConfig,
    share_link_id: &Uuid,
) -> Result<share_links::Model, Report> {
    ensure_chat_sharing_enabled(config)?;

    let link = ShareLinks::find_by_id(*share_link_id)
        .one(conn)
        .await?
        .wrap_err("Share link not found")?;

    if !link.enabled {
        return Err(eyre!("Share link is disabled"));
    }

    if link.resource_type == "chat" {
        let chat_id = Uuid::parse_str(&link.resource_id).wrap_err("Invalid chat ID format")?;
        let chat = Chats::find_by_id(chat_id)
            .one(conn)
            .await?
            .wrap_err("Chat not found")?;

        if chat.archived_at.is_some() {
            return Err(eyre!(
                "Archived chats cannot be viewed through a share link"
            ));
        }
    }

    Ok(link)
}

pub async fn delete_share_links_for_resources(
    conn: &impl sea_orm::ConnectionTrait,
    resource_type: &str,
    resource_ids: &[Uuid],
) -> Result<u64, Report> {
    if resource_ids.is_empty() {
        return Ok(0);
    }

    let result = ShareLinks::delete_many()
        .filter(share_links::Column::ResourceType.eq(resource_type))
        .filter(
            share_links::Column::ResourceId.is_in(
                resource_ids
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>(),
            ),
        )
        .exec(conn)
        .await?;

    Ok(result.rows_affected)
}
