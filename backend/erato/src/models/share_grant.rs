use crate::config::AppConfig;
use crate::db::entity::prelude::*;
use crate::db::entity::share_grants;
use crate::models::assistant_hub;
use crate::policy::prelude::*;
use eyre::{ContextCompat, Report, WrapErr, eyre};
use sea_orm::prelude::*;
use sea_orm::{ColumnTrait, Condition, DatabaseConnection, EntityTrait, QueryFilter, Set};
use serde::Serialize;
use sqlx::types::Uuid;

/// The stable subject values used for grants that target every user in the
/// organization.
pub const ORGANIZATION_SUBJECT_TYPE: &str = "organization";
pub const ORGANIZATION_SUBJECT_ID_TYPE: &str = "organization_id";
pub const ORGANIZATION_SUBJECT_ID: &str = "__organization__";

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
    create_share_grant_with_config(
        conn,
        policy,
        &AppConfig::default(),
        subject,
        resource_type,
        resource_id,
        subject_type,
        subject_id_type,
        subject_id_value,
        role,
    )
    .await
}

/// Create a share grant using the active application configuration.
#[allow(clippy::too_many_arguments)]
pub async fn create_share_grant_with_config(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    config: &AppConfig,
    subject: &Subject,
    resource_type: String,
    resource_id: String,
    subject_type: String,
    subject_id_type: String,
    subject_id_value: String,
    role: String,
) -> Result<share_grants::Model, Report> {
    // Rebuild policy data if needed
    policy.rebuild_data_if_needed(conn, config).await?;

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

            if role == "editor"
                && assistant_hub::is_hub_version_assistant(conn, resource_uuid).await?
            {
                return Err(eyre!(
                    "Assistant hub version assistants cannot be shared with edit access"
                ));
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
    if role != "viewer" && (role != "editor" || !config.assistants.enable_edit_sharing) {
        return Err(eyre!(
            "Invalid role: {}. Only 'viewer' role is supported, and 'editor' requires assistant edit sharing to be enabled",
            role
        ));
    }

    // Validate subject_type
    if subject_type != "user"
        && subject_type != "organization_group"
        && subject_type != ORGANIZATION_SUBJECT_TYPE
    {
        return Err(eyre!(
            "Invalid subject_type: {}. Only 'user', 'organization_group', and 'organization' are currently supported",
            subject_type
        ));
    }

    // Validate subject_id_type
    if subject_id_type != "id"
        && subject_id_type != "organization_user_id"
        && subject_id_type != "organization_group_id"
        && subject_id_type != ORGANIZATION_SUBJECT_ID_TYPE
    {
        return Err(eyre!(
            "Invalid subject_id_type: {}. Only 'id', 'organization_user_id', 'organization_group_id', and 'organization_id' are currently supported",
            subject_id_type
        ));
    }

    let valid_subject_target = match subject_type.as_str() {
        "user" => subject_id_type == "id" || subject_id_type == "organization_user_id",
        "organization_group" => subject_id_type == "organization_group_id",
        ORGANIZATION_SUBJECT_TYPE => {
            subject_id_type == ORGANIZATION_SUBJECT_ID_TYPE
                && subject_id_value == ORGANIZATION_SUBJECT_ID
        }
        _ => false,
    };
    if !valid_subject_target {
        return Err(eyre!(
            "Invalid subject target: subject_type '{}' cannot use subject_id_type '{}' and subject_id '{}'",
            subject_type,
            subject_id_type,
            subject_id_value
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
    policy
        .rebuild_data_if_needed(conn, &crate::config::AppConfig::default())
        .await?;

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
/// - Whole organization shares (subject_type = "organization")
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

    // An organization grant applies to every logged-in user in the
    // organization. The caller is authenticated before this helper is used,
    // so no per-user identifier is needed for this target.
    condition = condition.add(
        Condition::all()
            .add(share_grants::Column::SubjectType.eq(ORGANIZATION_SUBJECT_TYPE))
            .add(share_grants::Column::SubjectIdType.eq(ORGANIZATION_SUBJECT_ID_TYPE))
            .add(share_grants::Column::SubjectId.eq(ORGANIZATION_SUBJECT_ID))
            .add(share_grants::Column::ResourceType.eq(resource_type)),
    );

    let grants = ShareGrants::find().filter(condition).all(conn).await?;

    Ok(grants)
}

/// A share-grant subject to test a resource against: the
/// `(subject_type, subject_id_type, subject_id)` triple a `share_grants` row
/// stores, borrowed rather than owned so callers can build one per candidate
/// without allocating.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ShareSubject<'a> {
    pub subject_type: &'a str,
    pub subject_id_type: &'a str,
    pub subject_id: &'a str,
}

impl<'a> ShareSubject<'a> {
    /// The organization-wide subject, which every authenticated user is part of.
    #[must_use]
    pub fn organization() -> Self {
        Self {
            subject_type: ORGANIZATION_SUBJECT_TYPE,
            subject_id_type: ORGANIZATION_SUBJECT_ID_TYPE,
            subject_id: ORGANIZATION_SUBJECT_ID,
        }
    }

    /// A directory group, by the id the identity provider puts in the token.
    #[must_use]
    pub fn organization_group(organization_group_id: &'a str) -> Self {
        Self {
            subject_type: "organization_group",
            subject_id_type: "organization_group_id",
            subject_id: organization_group_id,
        }
    }

    /// One person by their directory user id (the `oid` claim).
    #[must_use]
    pub fn organization_user(organization_user_id: &'a str) -> Self {
        Self {
            subject_type: "user",
            subject_id_type: "organization_user_id",
            subject_id: organization_user_id,
        }
    }

    /// One person by their internal `users.id`.
    #[must_use]
    pub fn user(user_id: &'a str) -> Self {
        Self {
            subject_type: "user",
            subject_id_type: "id",
            subject_id: user_id,
        }
    }
}

/// Whether a resource is shared with ANY of `subjects`. An organization-wide
/// grant always counts, since it covers every subject.
///
/// This asks about the given SUBJECTS' access, not the caller's — a caller may
/// hold a direct grant to a resource the audience it matched cannot see, and
/// an audience pin must not survive on that.
///
/// NOTE (see PR #1072 review): this is grant interpretation living in Rust,
/// duplicating what `backend.rego` already knows about `share_grants`, and the
/// two can drift. The intended destination is the `PolicyEngine` — but the
/// question "does subject S reach resource R" cannot be asked of it today:
/// `SubjectKind` has only `User`, and every rego rule gates on
/// `input.subject_kind == subject_kind_user`, so a group or organization
/// subject has no way in. Closing that means either a `group` subject kind or
/// a dedicated non-`allow` query entrypoint. Deliberately not built here; do
/// not add a second predicate of this shape without doing it.
pub async fn is_resource_shared_with_any_subject(
    conn: &DatabaseConnection,
    resource_type: &str,
    resource_id: &str,
    subjects: &[ShareSubject<'_>],
) -> Result<bool, Report> {
    let mut condition = Condition::any().add(subject_condition(
        resource_type,
        resource_id,
        ShareSubject::organization(),
    ));
    for subject in subjects {
        condition = condition.add(subject_condition(resource_type, resource_id, *subject));
    }

    Ok(ShareGrants::find()
        .filter(condition)
        .one(conn)
        .await?
        .is_some())
}

fn subject_condition(
    resource_type: &str,
    resource_id: &str,
    subject: ShareSubject<'_>,
) -> Condition {
    Condition::all()
        .add(share_grants::Column::SubjectType.eq(subject.subject_type))
        .add(share_grants::Column::SubjectIdType.eq(subject.subject_id_type))
        .add(share_grants::Column::SubjectId.eq(subject.subject_id))
        .add(share_grants::Column::ResourceType.eq(resource_type))
        .add(share_grants::Column::ResourceId.eq(resource_id))
}
