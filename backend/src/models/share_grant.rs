use crate::db::entity::prelude::*;
use crate::db::entity::share_grants;
use crate::policy::prelude::*;
use eyre::{ContextCompat, Report, WrapErr, eyre};
use sea_orm::prelude::*;
use sea_orm::{ColumnTrait, Condition, DatabaseConnection, EntityTrait, QueryFilter, Set};
use serde::Serialize;
use sqlx::types::Uuid;

/// Serializable share grant information for API responses
#[derive(Debug, Clone, Serialize)]
pub struct ShareGrantInfo {
    pub id: Uuid,
    pub resource_type: String,
    pub resource_id: String,
    pub subject_type: String,
    pub subject_id_type: String,
    pub subject_id: String,
    pub role: String,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: DateTimeWithTimeZone,
}

impl From<share_grants::Model> for ShareGrantInfo {
    fn from(grant: share_grants::Model) -> Self {
        Self {
            id: grant.id,
            resource_type: grant.resource_type,
            resource_id: grant.resource_id,
            subject_type: grant.subject_type,
            subject_id_type: grant.subject_id_type,
            subject_id: grant.subject_id,
            role: grant.role,
            created_at: grant.created_at,
            updated_at: grant.updated_at,
        }
    }
}

/// Create a new share grant
///
/// This function verifies that the user has permission to share the resource
/// by checking ownership of the resource.
#[allow(clippy::too_many_arguments)]
pub async fn create_share_grant(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    resource_type: String,
    resource_id: String,
    subject_type: String,
    subject_id_type: String,
    subject_id_value: String,
    role: String,
) -> Result<share_grants::Model, Report> {
    // Rebuild policy data if needed
    policy.rebuild_data_if_needed(conn).await?;

    // Get the user ID from subject
    let crate::policy::types::Subject::User(user_id_str) = &subject;
    let user_uuid = Uuid::parse_str(user_id_str).wrap_err("Invalid user ID format")?;

    // Verify the user owns the resource they're trying to share
    match resource_type.as_str() {
        "assistant" => {
            let resource_uuid =
                Uuid::parse_str(&resource_id).wrap_err("Invalid resource ID format")?;

            // Check that the assistant exists and is owned by the user
            let assistant = Assistants::find_by_id(resource_uuid)
                .one(conn)
                .await?
                .wrap_err("Assistant not found")?;

            if assistant.owner_user_id != user_uuid {
                return Err(eyre!("Access denied: User does not own this resource"));
            }

            // Authorize the share action
            authorize!(
                policy,
                subject,
                &Resource::Assistant(resource_id.clone()),
                Action::Share
            )?;
        }
        _ => {
            return Err(eyre!(
                "Unsupported resource type for sharing: {}",
                resource_type
            ));
        }
    }

    // Validate role
    if role != "viewer" {
        return Err(eyre!(
            "Invalid role: {}. Only 'viewer' role is currently supported",
            role
        ));
    }

    // Validate subject_type
    if subject_type != "user" {
        return Err(eyre!(
            "Invalid subject_type: {}. Only 'user' is currently supported",
            subject_type
        ));
    }

    // Validate subject_id_type
    if subject_id_type != "id" && subject_id_type != "oidc_issuer_and_subject" {
        return Err(eyre!(
            "Invalid subject_id_type: {}. Must be 'id' or 'oidc_issuer_and_subject'",
            subject_id_type
        ));
    }

    // Create the share grant record
    let new_share_grant = share_grants::ActiveModel {
        id: Set(Uuid::new_v4()),
        resource_type: Set(resource_type),
        resource_id: Set(resource_id),
        subject_type: Set(subject_type),
        subject_id_type: Set(subject_id_type),
        subject_id: Set(subject_id_value),
        role: Set(role),
        created_at: Set(chrono::Utc::now().into()),
        updated_at: Set(chrono::Utc::now().into()),
    };

    let created_grant = ShareGrants::insert(new_share_grant)
        .exec_with_returning(conn)
        .await?;

    // Invalidate policy data so it gets rebuilt with the new share grant
    policy.invalidate_data().await;

    Ok(created_grant)
}

/// List all share grants for a specific resource
///
/// Only the owner of the resource can list its share grants.
pub async fn list_share_grants_for_resource(
    conn: &DatabaseConnection,
    _policy: &PolicyEngine,
    subject: &Subject,
    resource_type: String,
    resource_id: String,
) -> Result<Vec<share_grants::Model>, Report> {
    // Get the user ID from subject
    let crate::policy::types::Subject::User(user_id_str) = &subject;
    let user_uuid = Uuid::parse_str(user_id_str).wrap_err("Invalid user ID format")?;

    // Verify the user owns the resource
    match resource_type.as_str() {
        "assistant" => {
            let resource_uuid =
                Uuid::parse_str(&resource_id).wrap_err("Invalid resource ID format")?;

            let assistant = Assistants::find_by_id(resource_uuid)
                .one(conn)
                .await?
                .wrap_err("Assistant not found")?;

            if assistant.owner_user_id != user_uuid {
                return Err(eyre!("Access denied: User does not own this resource"));
            }
        }
        _ => {
            return Err(eyre!("Unsupported resource type: {}", resource_type));
        }
    }

    // Query all share grants for the resource
    let grants = ShareGrants::find()
        .filter(
            Condition::all()
                .add(share_grants::Column::ResourceType.eq(resource_type))
                .add(share_grants::Column::ResourceId.eq(resource_id)),
        )
        .all(conn)
        .await?;

    Ok(grants)
}

/// Delete a share grant
///
/// Only the owner of the resource can delete its share grants.
pub async fn delete_share_grant(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    grant_id: Uuid,
) -> Result<(), Report> {
    // Rebuild policy data if needed
    policy.rebuild_data_if_needed(conn).await?;

    // Get the user ID from subject
    let crate::policy::types::Subject::User(user_id_str) = &subject;
    let user_uuid = Uuid::parse_str(user_id_str).wrap_err("Invalid user ID format")?;

    // Find the share grant
    let grant = ShareGrants::find_by_id(grant_id)
        .one(conn)
        .await?
        .wrap_err("Share grant not found")?;

    // Verify the user owns the resource
    match grant.resource_type.as_str() {
        "assistant" => {
            let resource_uuid =
                Uuid::parse_str(&grant.resource_id).wrap_err("Invalid resource ID format")?;

            let assistant = Assistants::find_by_id(resource_uuid)
                .one(conn)
                .await?
                .wrap_err("Assistant not found")?;

            if assistant.owner_user_id != user_uuid {
                return Err(eyre!("Access denied: User does not own this resource"));
            }

            // Authorize the delete action
            authorize!(
                policy,
                subject,
                &Resource::ShareGrant(grant_id.to_string()),
                Action::Delete
            )?;
        }
        _ => {
            return Err(eyre!("Unsupported resource type: {}", grant.resource_type));
        }
    }

    // Delete the share grant
    ShareGrants::delete_by_id(grant_id).exec(conn).await?;

    // Invalidate policy data so it gets rebuilt without this share grant
    policy.invalidate_data().await;

    Ok(())
}

/// Get all resources shared with a specific subject
///
/// This is used to populate the list of assistants available to a user
/// (both owned and shared).
pub async fn get_resources_shared_with_subject(
    conn: &DatabaseConnection,
    subject_id: &str,
    resource_type: &str,
) -> Result<Vec<share_grants::Model>, Report> {
    let grants = ShareGrants::find()
        .filter(
            Condition::all()
                .add(share_grants::Column::SubjectId.eq(subject_id))
                .add(share_grants::Column::ResourceType.eq(resource_type)),
        )
        .all(conn)
        .await?;

    Ok(grants)
}
