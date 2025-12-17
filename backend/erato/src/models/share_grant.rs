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
    let user_id_str = subject.user_id();
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
    if subject_type != "user" && subject_type != "organization_group" {
        return Err(eyre!(
            "Invalid subject_type: {}. Only 'user' and 'organization_group' are currently supported",
            subject_type
        ));
    }

    // Validate subject_id_type
    if subject_id_type != "id"
        && subject_id_type != "organization_user_id"
        && subject_id_type != "organization_group_id"
    {
        return Err(eyre!(
            "Invalid subject_id_type: {}. Only 'id', 'organization_user_id', and 'organization_group_id' are currently supported",
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
    let user_id_str = subject.user_id();
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
    let user_id_str = subject.user_id();
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
///
/// This function checks for:
/// - Direct user shares (subject_type = "user" and subject_id = user_id)
/// - Organization group shares (subject_type = "organization_group" and subject_id in organization_group_ids)
pub async fn get_resources_shared_with_subject(
    conn: &DatabaseConnection,
    subject_id: &str,
    resource_type: &str,
) -> Result<Vec<share_grants::Model>, Report> {
    get_resources_shared_with_subject_and_groups(conn, subject_id, None, resource_type, &[]).await
}

/// Get all resources shared with a specific subject, including organization group grants
///
/// This function properly handles both internal user IDs and organization user IDs:
/// - `subject_id`: The internal user UUID from the database
/// - `organization_user_id`: Optional organization-specific user ID (e.g., Azure AD's "oid" claim)
/// - Share grants with `subject_id_type = "id"` are matched against `subject_id`
/// - Share grants with `subject_id_type = "organization_user_id"` are matched against `organization_user_id`
pub async fn get_resources_shared_with_subject_and_groups(
    conn: &DatabaseConnection,
    subject_id: &str,
    organization_user_id: Option<&str>,
    resource_type: &str,
    organization_group_ids: &[String],
) -> Result<Vec<share_grants::Model>, Report> {
    // Build condition for user grants with subject_id_type = "id"
    let mut condition = Condition::any().add(
        Condition::all()
            .add(share_grants::Column::SubjectType.eq("user"))
            .add(share_grants::Column::SubjectIdType.eq("id"))
            .add(share_grants::Column::SubjectId.eq(subject_id))
            .add(share_grants::Column::ResourceType.eq(resource_type)),
    );

    // If organization_user_id is provided, also check for grants using it
    if let Some(org_user_id) = organization_user_id {
        condition = condition.add(
            Condition::all()
                .add(share_grants::Column::SubjectType.eq("user"))
                .add(share_grants::Column::SubjectIdType.eq("organization_user_id"))
                .add(share_grants::Column::SubjectId.eq(org_user_id))
                .add(share_grants::Column::ResourceType.eq(resource_type)),
        );
    }

    // Add condition for organization group grants if any group IDs are provided
    if !organization_group_ids.is_empty() {
        condition = condition.add(
            Condition::all()
                .add(share_grants::Column::SubjectType.eq("organization_group"))
                .add(share_grants::Column::SubjectIdType.eq("organization_group_id"))
                .add(share_grants::Column::SubjectId.is_in(organization_group_ids.to_vec()))
                .add(share_grants::Column::ResourceType.eq(resource_type)),
        );
    }

    let grants = ShareGrants::find().filter(condition).all(conn).await?;

    Ok(grants)
}
