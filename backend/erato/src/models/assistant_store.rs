use crate::config::AssistantStoreConfig;
use crate::db::entity::prelude::*;
use crate::db::entity::{
    assistant_file_uploads, assistant_store_assistant_versions, assistant_store_assistants,
    assistants, users,
};
use crate::models::share_grant;
use crate::policy::engine::PolicyEngine;
use crate::policy::prelude::*;
use chrono::Utc;
use eyre::{ContextCompat, Report, WrapErr, eyre};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, Condition, DatabaseConnection, EntityTrait, IntoActiveModel,
    Order, QueryFilter, QueryOrder, QuerySelect, QueryTrait, Set,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value as JsonValue, json};
use sqlx::types::Uuid;

pub const STATUS_SUBMITTED: &str = "submitted";
pub const STATUS_REVIEW_ACCEPTED: &str = "review_accepted";
pub const STATUS_REVIEW_DECLINED: &str = "review_declined";
pub const STATUS_WITHDRAWN: &str = "withdrawn";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoreAudienceGrantInput {
    pub subject_type: String,
    pub subject_id_type: String,
    pub subject_id: String,
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoreSubmissionProfile {
    pub long_description: String,
    pub category_ids: Vec<String>,
    pub keywords: Vec<String>,
    pub version_number: String,
    pub version_comment: Option<String>,
    pub creator_review_comment: Option<String>,
}

#[derive(Debug, Clone)]
pub struct StoreVersionRecord {
    pub store_assistant: assistant_store_assistants::Model,
    pub version: assistant_store_assistant_versions::Model,
    pub assistant: assistants::Model,
    pub creator: users::Model,
}

fn ensure_enabled(config: &AssistantStoreConfig) -> Result<(), Report> {
    if !config.enabled {
        return Err(eyre!("Assistant store is not enabled"));
    }

    Ok(())
}

fn user_uuid(subject: &Subject) -> Result<Uuid, Report> {
    Uuid::parse_str(subject.user_id()).wrap_err("Invalid user ID format")
}

fn normalize_text_vec(values: Vec<String>) -> Option<Vec<String>> {
    let mut deduped = Vec::new();
    for value in values {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            let normalized = trimmed.to_string();
            if !deduped.contains(&normalized) {
                deduped.push(normalized);
            }
        }
    }

    (!deduped.is_empty()).then_some(deduped)
}

fn validate_profile(
    config: &AssistantStoreConfig,
    profile: &StoreSubmissionProfile,
) -> Result<(), Report> {
    if profile.long_description.trim().is_empty() {
        return Err(eyre!("long_description must not be empty"));
    }

    if profile.version_number.trim().is_empty() {
        return Err(eyre!("version_number must not be empty"));
    }

    for category_id in &profile.category_ids {
        if !config.categories.contains_key(category_id) {
            return Err(eyre!("Unknown assistant store category '{}'", category_id));
        }
    }

    Ok(())
}

fn ensure_reviewer(config: &AssistantStoreConfig, groups: &[String]) -> Result<(), Report> {
    if !config.can_review(groups) {
        return Err(eyre!(
            "Access denied: User is not an assistant store reviewer"
        ));
    }

    Ok(())
}

async fn ensure_creator_or_reviewer(
    conn: &DatabaseConnection,
    config: &AssistantStoreConfig,
    subject: &Subject,
    groups: &[String],
    store_assistant_id: Uuid,
) -> Result<assistant_store_assistants::Model, Report> {
    let store_assistant = AssistantStoreAssistants::find_by_id(store_assistant_id)
        .one(conn)
        .await?
        .wrap_err("Assistant store assistant not found")?;
    let user_id = user_uuid(subject)?;

    if store_assistant.owner_user_id == user_id || config.can_review(groups) {
        return Ok(store_assistant);
    }

    Err(eyre!(
        "Access denied: User cannot manage this assistant store item"
    ))
}

async fn validate_source_assistant(
    conn: &DatabaseConnection,
    subject: &Subject,
    source_assistant_id: Uuid,
) -> Result<assistants::Model, Report> {
    let user_id = user_uuid(subject)?;
    let source_assistant = Assistants::find_by_id(source_assistant_id)
        .one(conn)
        .await?
        .wrap_err("Source assistant not found")?;

    if source_assistant.owner_user_id != user_id {
        return Err(eyre!("Access denied: User does not own source assistant"));
    }

    let is_store_version = AssistantStoreAssistantVersions::find()
        .filter(assistant_store_assistant_versions::Column::AssistantId.eq(source_assistant_id))
        .one(conn)
        .await?
        .is_some();

    if is_store_version {
        return Err(eyre!(
            "Store version assistants cannot be used as source assistants"
        ));
    }

    Ok(source_assistant)
}

async fn get_or_create_store_assistant(
    conn: &DatabaseConnection,
    subject: &Subject,
    source_assistant_id: Uuid,
) -> Result<assistant_store_assistants::Model, Report> {
    let source_assistant = validate_source_assistant(conn, subject, source_assistant_id).await?;

    if let Some(existing) = AssistantStoreAssistants::find()
        .filter(assistant_store_assistants::Column::SourceAssistantId.eq(source_assistant_id))
        .one(conn)
        .await?
    {
        return Ok(existing);
    }

    let now = Utc::now().into();
    let store_assistant = assistant_store_assistants::ActiveModel {
        id: Set(Uuid::new_v4()),
        source_assistant_id: Set(source_assistant_id),
        owner_user_id: Set(source_assistant.owner_user_id),
        featured: Set(false),
        created_at: Set(now),
        updated_at: Set(now),
    };

    Ok(AssistantStoreAssistants::insert(store_assistant)
        .exec_with_returning(conn)
        .await?)
}

async fn ensure_unique_version_number(
    conn: &DatabaseConnection,
    store_assistant_id: Uuid,
    version_number: &str,
) -> Result<(), Report> {
    let existing = AssistantStoreAssistantVersions::find()
        .filter(
            Condition::all()
                .add(
                    assistant_store_assistant_versions::Column::AssistantStoreAssistantId
                        .eq(store_assistant_id),
                )
                .add(assistant_store_assistant_versions::Column::VersionNumber.eq(version_number)),
        )
        .one(conn)
        .await?;

    if existing.is_some() {
        return Err(eyre!(
            "version_number '{}' has already been submitted for this assistant",
            version_number
        ));
    }

    Ok(())
}

async fn clone_source_assistant(
    conn: &DatabaseConnection,
    source_assistant_id: Uuid,
) -> Result<assistants::Model, Report> {
    let source = Assistants::find_by_id(source_assistant_id)
        .one(conn)
        .await?
        .wrap_err("Source assistant not found")?;

    let now = Utc::now().into();
    let cloned = assistants::ActiveModel {
        id: Set(Uuid::new_v4()),
        owner_user_id: Set(source.owner_user_id),
        name: Set(source.name),
        description: Set(source.description),
        prompt: Set(source.prompt),
        mcp_server_ids: Set(source.mcp_server_ids),
        facet_ids: Set(source.facet_ids),
        default_chat_provider: Set(source.default_chat_provider),
        enforce_facet_settings: Set(source.enforce_facet_settings),
        archived_at: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    };

    let cloned = Assistants::insert(cloned).exec_with_returning(conn).await?;

    let file_links = AssistantFileUploads::find()
        .filter(assistant_file_uploads::Column::AssistantId.eq(source_assistant_id))
        .all(conn)
        .await?;

    for file_link in file_links {
        let new_link = assistant_file_uploads::ActiveModel {
            assistant_id: Set(cloned.id),
            file_upload_id: Set(file_link.file_upload_id),
            created_at: Set(now),
            updated_at: Set(now),
        };
        AssistantFileUploads::insert(new_link).exec(conn).await?;
    }

    Ok(cloned)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoreDiffFile {
    pub id: String,
    pub filename: String,
}

async fn files_for_assistant(
    conn: &DatabaseConnection,
    assistant_id: Uuid,
) -> Result<Vec<StoreDiffFile>, Report> {
    let links = AssistantFileUploads::find()
        .filter(assistant_file_uploads::Column::AssistantId.eq(assistant_id))
        .order_by_asc(assistant_file_uploads::Column::FileUploadId)
        .all(conn)
        .await?;

    let mut files = Vec::with_capacity(links.len());
    for link in links {
        let file = FileUploads::find_by_id(link.file_upload_id)
            .one(conn)
            .await?
            .wrap_err("Assistant file upload not found")?;
        files.push(StoreDiffFile {
            id: file.id.to_string(),
            filename: file.filename,
        });
    }

    Ok(files)
}

fn diff_field<T: Serialize + PartialEq>(field: &str, before: Option<T>, after: T) -> JsonValue {
    let changed = before.as_ref() != Some(&after);
    json!({
        "field": field,
        "before": before,
        "after": after,
        "changed": changed,
    })
}

async fn previous_accepted_version(
    conn: &DatabaseConnection,
    store_assistant_id: Uuid,
) -> Result<Option<StoreVersionRecord>, Report> {
    let Some(version) = AssistantStoreAssistantVersions::find()
        .filter(
            Condition::all()
                .add(
                    assistant_store_assistant_versions::Column::AssistantStoreAssistantId
                        .eq(store_assistant_id),
                )
                .add(assistant_store_assistant_versions::Column::Status.eq(STATUS_REVIEW_ACCEPTED)),
        )
        .order_by(
            assistant_store_assistant_versions::Column::ReviewedAt,
            Order::Desc,
        )
        .order_by(
            assistant_store_assistant_versions::Column::SubmittedAt,
            Order::Desc,
        )
        .one(conn)
        .await?
    else {
        return Ok(None);
    };

    let store_assistant =
        AssistantStoreAssistants::find_by_id(version.assistant_store_assistant_id)
            .one(conn)
            .await?
            .wrap_err("Assistant store assistant not found")?;
    let assistant = Assistants::find_by_id(version.assistant_id)
        .one(conn)
        .await?
        .wrap_err("Version assistant not found")?;
    let creator = Users::find_by_id(store_assistant.owner_user_id)
        .one(conn)
        .await?
        .wrap_err("Assistant store creator not found")?;

    Ok(Some(StoreVersionRecord {
        store_assistant,
        version,
        assistant,
        creator,
    }))
}

pub async fn build_submission_diff(
    conn: &DatabaseConnection,
    config: &AssistantStoreConfig,
    subject: &Subject,
    source_assistant_id: Uuid,
    profile: &StoreSubmissionProfile,
) -> Result<JsonValue, Report> {
    ensure_enabled(config)?;
    validate_profile(config, profile)?;

    let source = validate_source_assistant(conn, subject, source_assistant_id).await?;
    let store_assistant = AssistantStoreAssistants::find()
        .filter(assistant_store_assistants::Column::SourceAssistantId.eq(source_assistant_id))
        .one(conn)
        .await?;
    let source_files = files_for_assistant(conn, source_assistant_id).await?;
    let previous = if let Some(store_assistant) = store_assistant {
        previous_accepted_version(conn, store_assistant.id).await?
    } else {
        None
    };

    let (baseline_version_id, baseline_assistant, baseline_files, baseline_version) =
        if let Some(previous) = previous {
            let files = files_for_assistant(conn, previous.assistant.id).await?;
            (
                Some(previous.version.id.to_string()),
                Some(previous.assistant),
                Some(files),
                Some(previous.version),
            )
        } else {
            (None, None, None, None)
        };

    let category_ids = normalize_text_vec(profile.category_ids.clone()).unwrap_or_default();
    let keywords = normalize_text_vec(profile.keywords.clone()).unwrap_or_default();

    Ok(json!({
        "baseline_version_id": baseline_version_id,
        "changes": [
            diff_field("name", baseline_assistant.as_ref().map(|a| a.name.clone()), source.name),
            diff_field("description", baseline_assistant.as_ref().map(|a| a.description.clone()), source.description),
            diff_field("prompt", baseline_assistant.as_ref().map(|a| a.prompt.clone()), source.prompt),
            diff_field("mcp_server_ids", baseline_assistant.as_ref().map(|a| a.mcp_server_ids.clone().unwrap_or_default()), source.mcp_server_ids.unwrap_or_default()),
            diff_field("facet_ids", baseline_assistant.as_ref().map(|a| a.facet_ids.clone().unwrap_or_default()), source.facet_ids.unwrap_or_default()),
            diff_field("default_chat_provider", baseline_assistant.as_ref().map(|a| a.default_chat_provider.clone()), source.default_chat_provider),
            diff_field("enforce_facet_settings", baseline_assistant.as_ref().map(|a| a.enforce_facet_settings), source.enforce_facet_settings),
            diff_field("files", baseline_files, source_files),
            diff_field("long_description", baseline_version.as_ref().map(|v| v.long_description.clone()), profile.long_description.clone()),
            diff_field("category_ids", baseline_version.as_ref().map(|v| v.category_ids.clone().unwrap_or_default()), category_ids),
            diff_field("keywords", baseline_version.as_ref().map(|v| v.keywords.clone().unwrap_or_default()), keywords),
        ],
    }))
}

#[allow(clippy::too_many_arguments)]
pub async fn submit_version(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    config: &AssistantStoreConfig,
    subject: &Subject,
    source_assistant_id: Uuid,
    profile: StoreSubmissionProfile,
    audience_grants: Vec<StoreAudienceGrantInput>,
) -> Result<StoreVersionRecord, Report> {
    ensure_enabled(config)?;
    let mut profile = profile;
    profile.version_number = profile.version_number.trim().to_string();
    validate_profile(config, &profile)?;

    let store_assistant = get_or_create_store_assistant(conn, subject, source_assistant_id).await?;
    ensure_unique_version_number(conn, store_assistant.id, &profile.version_number).await?;
    let cloned = clone_source_assistant(conn, source_assistant_id).await?;
    policy.invalidate_data().await;

    let diff_summary =
        build_submission_diff(conn, config, subject, source_assistant_id, &profile).await?;
    let now = Utc::now().into();
    let version = assistant_store_assistant_versions::ActiveModel {
        id: Set(Uuid::new_v4()),
        assistant_store_assistant_id: Set(store_assistant.id),
        assistant_id: Set(cloned.id),
        status: Set(STATUS_SUBMITTED.to_string()),
        is_published: Set(false),
        is_current_published_version: Set(false),
        version_number: Set(profile.version_number),
        version_comment: Set(profile.version_comment),
        creator_review_comment: Set(profile.creator_review_comment),
        reviewer_review_comment: Set(None),
        long_description: Set(profile.long_description),
        category_ids: Set(normalize_text_vec(profile.category_ids)),
        keywords: Set(normalize_text_vec(profile.keywords)),
        diff_summary: Set(diff_summary),
        submitted_at: Set(now),
        reviewed_at: Set(None),
        withdrawn_at: Set(None),
        published_at: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    };

    let version = AssistantStoreAssistantVersions::insert(version)
        .exec_with_returning(conn)
        .await?;
    let creator = Users::find_by_id(store_assistant.owner_user_id)
        .one(conn)
        .await?
        .wrap_err("Assistant store creator not found")?;

    for grant in audience_grants {
        share_grant::create_share_grant(
            conn,
            policy,
            subject,
            "assistant".to_string(),
            cloned.id.to_string(),
            grant.subject_type,
            grant.subject_id_type,
            grant.subject_id,
            grant.role,
        )
        .await?;
    }

    Ok(StoreVersionRecord {
        store_assistant,
        version,
        assistant: cloned,
        creator,
    })
}

pub async fn list_my_store_versions(
    conn: &DatabaseConnection,
    config: &AssistantStoreConfig,
    subject: &Subject,
) -> Result<Vec<StoreVersionRecord>, Report> {
    ensure_enabled(config)?;
    let user_id = user_uuid(subject)?;
    let store_assistants = AssistantStoreAssistants::find()
        .filter(assistant_store_assistants::Column::OwnerUserId.eq(user_id))
        .all(conn)
        .await?;
    let store_ids: Vec<Uuid> = store_assistants.iter().map(|store| store.id).collect();

    if store_ids.is_empty() {
        return Ok(Vec::new());
    }

    let versions = AssistantStoreAssistantVersions::find()
        .filter(
            assistant_store_assistant_versions::Column::AssistantStoreAssistantId.is_in(store_ids),
        )
        .order_by_desc(assistant_store_assistant_versions::Column::SubmittedAt)
        .all(conn)
        .await?;

    records_for_versions(conn, versions).await
}

pub async fn list_review_versions(
    conn: &DatabaseConnection,
    config: &AssistantStoreConfig,
    groups: &[String],
) -> Result<Vec<StoreVersionRecord>, Report> {
    ensure_enabled(config)?;
    ensure_reviewer(config, groups)?;

    let versions = AssistantStoreAssistantVersions::find()
        .order_by_desc(assistant_store_assistant_versions::Column::SubmittedAt)
        .all(conn)
        .await?;

    records_for_versions(conn, versions).await
}

async fn records_for_versions(
    conn: &DatabaseConnection,
    versions: Vec<assistant_store_assistant_versions::Model>,
) -> Result<Vec<StoreVersionRecord>, Report> {
    let mut records = Vec::with_capacity(versions.len());
    for version in versions {
        let store_assistant =
            AssistantStoreAssistants::find_by_id(version.assistant_store_assistant_id)
                .one(conn)
                .await?
                .wrap_err("Assistant store assistant not found")?;
        let assistant = Assistants::find_by_id(version.assistant_id)
            .one(conn)
            .await?
            .wrap_err("Version assistant not found")?;
        let creator = Users::find_by_id(store_assistant.owner_user_id)
            .one(conn)
            .await?
            .wrap_err("Assistant store creator not found")?;
        records.push(StoreVersionRecord {
            store_assistant,
            version,
            assistant,
            creator,
        });
    }

    Ok(records)
}

pub async fn list_published_current_versions(
    conn: &DatabaseConnection,
    config: &AssistantStoreConfig,
    subject: &Subject,
) -> Result<Vec<StoreVersionRecord>, Report> {
    ensure_enabled(config)?;
    let user_id = user_uuid(subject)?;
    let grants = share_grant::get_resources_shared_with_subject_and_groups(
        conn,
        subject.user_id(),
        subject.organization_user_id(),
        "assistant",
        subject.organization_group_ids(),
    )
    .await?;
    let shared_assistant_ids: Vec<Uuid> = grants
        .iter()
        .filter_map(|grant| Uuid::parse_str(&grant.resource_id).ok())
        .collect();

    let mut condition = Condition::all()
        .add(assistant_store_assistant_versions::Column::Status.eq(STATUS_REVIEW_ACCEPTED))
        .add(assistant_store_assistant_versions::Column::IsPublished.eq(true))
        .add(assistant_store_assistant_versions::Column::IsCurrentPublishedVersion.eq(true));

    let access_condition = Condition::any()
        .add(assistant_store_assistant_versions::Column::AssistantId.is_in(shared_assistant_ids))
        .add(
            assistant_store_assistant_versions::Column::AssistantStoreAssistantId.in_subquery(
                AssistantStoreAssistants::find()
                    .select_only()
                    .column(assistant_store_assistants::Column::Id)
                    .filter(assistant_store_assistants::Column::OwnerUserId.eq(user_id))
                    .into_query(),
            ),
        );
    condition = condition.add(access_condition);

    let versions = AssistantStoreAssistantVersions::find()
        .filter(condition)
        .order_by_desc(assistant_store_assistant_versions::Column::PublishedAt)
        .all(conn)
        .await?;

    let mut records = records_for_versions(conn, versions).await?;
    records.sort_by(|left, right| {
        right
            .store_assistant
            .featured
            .cmp(&left.store_assistant.featured)
            .then_with(|| right.version.published_at.cmp(&left.version.published_at))
    });
    Ok(records)
}

pub async fn get_published_current_version(
    conn: &DatabaseConnection,
    config: &AssistantStoreConfig,
    subject: &Subject,
    store_assistant_id: Uuid,
) -> Result<StoreVersionRecord, Report> {
    let versions = list_published_current_versions(conn, config, subject).await?;
    versions
        .into_iter()
        .find(|record| record.store_assistant.id == store_assistant_id)
        .wrap_err("Assistant store item not found or not accessible")
}

pub async fn review_version(
    conn: &DatabaseConnection,
    config: &AssistantStoreConfig,
    groups: &[String],
    version_id: Uuid,
    accepted: bool,
    reviewer_review_comment: Option<String>,
) -> Result<StoreVersionRecord, Report> {
    ensure_enabled(config)?;
    ensure_reviewer(config, groups)?;

    let version = AssistantStoreAssistantVersions::find_by_id(version_id)
        .one(conn)
        .await?
        .wrap_err("Assistant store version not found")?;

    if version.status != STATUS_SUBMITTED {
        return Err(eyre!("Only submitted versions can be reviewed"));
    }

    let mut active = version.into_active_model();
    active.status = Set(if accepted {
        STATUS_REVIEW_ACCEPTED.to_string()
    } else {
        STATUS_REVIEW_DECLINED.to_string()
    });
    active.reviewer_review_comment = Set(reviewer_review_comment);
    active.reviewed_at = Set(Some(Utc::now().into()));
    let version = active.update(conn).await?;

    records_for_versions(conn, vec![version])
        .await?
        .into_iter()
        .next()
        .wrap_err("Updated assistant store version not found")
}

pub async fn withdraw_version(
    conn: &DatabaseConnection,
    config: &AssistantStoreConfig,
    subject: &Subject,
    version_id: Uuid,
) -> Result<StoreVersionRecord, Report> {
    ensure_enabled(config)?;
    let version = AssistantStoreAssistantVersions::find_by_id(version_id)
        .one(conn)
        .await?
        .wrap_err("Assistant store version not found")?;
    let store_assistant =
        AssistantStoreAssistants::find_by_id(version.assistant_store_assistant_id)
            .one(conn)
            .await?
            .wrap_err("Assistant store assistant not found")?;

    if store_assistant.owner_user_id != user_uuid(subject)? {
        return Err(eyre!(
            "Access denied: Only the creator can withdraw a submission"
        ));
    }

    if version.status != STATUS_SUBMITTED {
        return Err(eyre!("Only submitted versions can be withdrawn"));
    }

    let mut active = version.into_active_model();
    active.status = Set(STATUS_WITHDRAWN.to_string());
    active.withdrawn_at = Set(Some(Utc::now().into()));
    let version = active.update(conn).await?;

    records_for_versions(conn, vec![version])
        .await?
        .into_iter()
        .next()
        .wrap_err("Updated assistant store version not found")
}

pub async fn set_published(
    conn: &DatabaseConnection,
    config: &AssistantStoreConfig,
    subject: &Subject,
    groups: &[String],
    version_id: Uuid,
    is_published: bool,
) -> Result<StoreVersionRecord, Report> {
    ensure_enabled(config)?;
    let version = AssistantStoreAssistantVersions::find_by_id(version_id)
        .one(conn)
        .await?
        .wrap_err("Assistant store version not found")?;
    ensure_creator_or_reviewer(
        conn,
        config,
        subject,
        groups,
        version.assistant_store_assistant_id,
    )
    .await?;

    if version.status != STATUS_REVIEW_ACCEPTED {
        return Err(eyre!("Only review-accepted versions can be published"));
    }

    let mut active = version.into_active_model();
    active.is_published = Set(is_published);
    active.published_at = Set(is_published.then(|| Utc::now().into()));
    if !is_published {
        active.is_current_published_version = Set(false);
    }
    let version = active.update(conn).await?;

    records_for_versions(conn, vec![version])
        .await?
        .into_iter()
        .next()
        .wrap_err("Updated assistant store version not found")
}

pub async fn set_current_published_version(
    conn: &DatabaseConnection,
    config: &AssistantStoreConfig,
    subject: &Subject,
    groups: &[String],
    version_id: Uuid,
) -> Result<StoreVersionRecord, Report> {
    ensure_enabled(config)?;
    let version = AssistantStoreAssistantVersions::find_by_id(version_id)
        .one(conn)
        .await?
        .wrap_err("Assistant store version not found")?;
    ensure_creator_or_reviewer(
        conn,
        config,
        subject,
        groups,
        version.assistant_store_assistant_id,
    )
    .await?;

    if version.status != STATUS_REVIEW_ACCEPTED || !version.is_published {
        return Err(eyre!(
            "Only published review-accepted versions can be current"
        ));
    }

    let clear_current = assistant_store_assistant_versions::ActiveModel {
        is_current_published_version: Set(false),
        ..Default::default()
    };
    AssistantStoreAssistantVersions::update_many()
        .set(clear_current)
        .filter(
            assistant_store_assistant_versions::Column::AssistantStoreAssistantId
                .eq(version.assistant_store_assistant_id),
        )
        .exec(conn)
        .await?;

    let mut active = version.into_active_model();
    active.is_current_published_version = Set(true);
    let version = active.update(conn).await?;

    records_for_versions(conn, vec![version])
        .await?
        .into_iter()
        .next()
        .wrap_err("Updated assistant store version not found")
}

pub async fn set_featured(
    conn: &DatabaseConnection,
    config: &AssistantStoreConfig,
    groups: &[String],
    version_id: Uuid,
    featured: bool,
) -> Result<StoreVersionRecord, Report> {
    ensure_enabled(config)?;
    ensure_reviewer(config, groups)?;

    let version = AssistantStoreAssistantVersions::find_by_id(version_id)
        .one(conn)
        .await?
        .wrap_err("Assistant store version not found")?;

    if version.status != STATUS_REVIEW_ACCEPTED {
        return Err(eyre!("Only review-accepted versions can be featured"));
    }

    let store_assistant =
        AssistantStoreAssistants::find_by_id(version.assistant_store_assistant_id)
            .one(conn)
            .await?
            .wrap_err("Assistant store assistant not found")?;

    let mut active_store_assistant = store_assistant.into_active_model();
    active_store_assistant.featured = Set(featured);
    active_store_assistant.update(conn).await?;

    records_for_versions(conn, vec![version])
        .await?
        .into_iter()
        .next()
        .wrap_err("Updated assistant store version not found")
}

pub async fn is_store_version_assistant(
    conn: &DatabaseConnection,
    assistant_id: Uuid,
) -> Result<bool, Report> {
    Ok(AssistantStoreAssistantVersions::find()
        .filter(assistant_store_assistant_versions::Column::AssistantId.eq(assistant_id))
        .one(conn)
        .await?
        .is_some())
}

pub async fn store_version_allows_generic_assistant_read(
    conn: &DatabaseConnection,
    subject: &Subject,
    assistant_id: Uuid,
) -> Result<bool, Report> {
    let Some(version) = AssistantStoreAssistantVersions::find()
        .filter(assistant_store_assistant_versions::Column::AssistantId.eq(assistant_id))
        .one(conn)
        .await?
    else {
        return Ok(true);
    };

    let store_assistant =
        AssistantStoreAssistants::find_by_id(version.assistant_store_assistant_id)
            .one(conn)
            .await?
            .wrap_err("Assistant store assistant not found")?;

    if store_assistant.owner_user_id == user_uuid(subject)? {
        return Ok(true);
    }

    Ok(version.status == STATUS_REVIEW_ACCEPTED
        && version.is_published
        && version.is_current_published_version)
}
