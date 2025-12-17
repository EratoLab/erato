use crate::db::entity::prelude::*;
use crate::db::entity::{assistants, share_grants};
use crate::db::entity_ext::chats;
use crate::policy::types::{
    Action, Resource, ResourceId, ResourceKind, Subject, SubjectId, SubjectKind,
};
use axum::http::StatusCode;
use eyre::{Report, WrapErr, eyre};
use regorus::Engine;
use sea_orm::prelude::Uuid;
use sea_orm::{DatabaseConnection, EntityTrait, FromQueryResult, QuerySelect};
use serde_json::{Value as JsonValue, json};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::instrument;

const BACKEND_POLICY: &str = include_str!("../../../policy/backend/backend.rego");

/// Minimal chat attributes required for policy evaluation.
#[derive(Debug, FromQueryResult)]
struct ChatPolicyAttributes {
    id: Uuid,
    owner_user_id: String,
}

/// Fetch minimal chat data required for policy evaluation.
/// Only queries the `id` and `owner_user_id` fields.
async fn fetch_chat_policy_data(db: &DatabaseConnection) -> Result<JsonValue, Report> {
    let chats: Vec<ChatPolicyAttributes> = chats::Entity::find()
        .select_only()
        .column(chats::Column::Id)
        .column(chats::Column::OwnerUserId)
        .into_model::<ChatPolicyAttributes>()
        .all(db)
        .await?;

    let mut chat_attributes = serde_json::Map::new();
    for chat in chats {
        let id_str = chat.id.to_string();
        chat_attributes.insert(
            id_str.clone(),
            json!({
                "id": id_str,
                "owner_id": chat.owner_user_id,
            }),
        );
    }

    Ok(json!(chat_attributes))
}

/// Minimal assistant attributes required for policy evaluation.
#[derive(Debug, FromQueryResult)]
struct AssistantPolicyAttributes {
    id: Uuid,
    owner_user_id: Uuid,
}

/// Fetch minimal assistant data required for policy evaluation.
/// Only queries the `id` and `owner_user_id` fields.
async fn fetch_assistant_policy_data(db: &DatabaseConnection) -> Result<JsonValue, Report> {
    let assistants_list: Vec<AssistantPolicyAttributes> = Assistants::find()
        .select_only()
        .column(assistants::Column::Id)
        .column(assistants::Column::OwnerUserId)
        .into_model::<AssistantPolicyAttributes>()
        .all(db)
        .await?;

    let mut assistant_attributes = serde_json::Map::new();
    for assistant in assistants_list {
        let id_str = assistant.id.to_string();
        assistant_attributes.insert(
            id_str.clone(),
            json!({
                "id": id_str,
                "owner_id": assistant.owner_user_id.to_string(),
            }),
        );
    }

    Ok(json!(assistant_attributes))
}

/// Fetch share grants data for policy evaluation.
async fn fetch_share_grants_policy_data(db: &DatabaseConnection) -> Result<JsonValue, Report> {
    let grants: Vec<share_grants::Model> = ShareGrants::find().all(db).await?;

    let grants_array: Vec<JsonValue> = grants
        .into_iter()
        .map(|grant| {
            json!({
                "id": grant.id.to_string(),
                "resource_type": grant.resource_type,
                "resource_id": grant.resource_id,
                "subject_type": grant.subject_type,
                "subject_id_type": grant.subject_id_type,
                "subject_id": grant.subject_id,
                "role": grant.role,
            })
        })
        .collect();

    Ok(json!(grants_array))
}

// Define a macro that routes to the appropriate authorize implementation based on argument count
macro_rules! authorize {
    // Pattern for the short form (3 arguments)
    ($engine:expr, $subject:expr, $resource:expr, $action:expr) => {
        <crate::policy::engine::PolicyEngine as crate::policy::engine::AuthorizeShort>::authorize(
            &$engine, $subject, $resource, $action,
        )
        .await
    };

    // Pattern for the full form (5 arguments)
    ($engine:expr, $subject_kind:expr, $subject_id:expr, $resource_kind:expr, $resource_id:expr, $action:expr) => {
        <crate::policy::engine::PolicyEngine as crate::policy::engine::AuthorizeFull>::authorize(
            &$engine,
            $subject_kind,
            $subject_id,
            $resource_kind,
            $resource_id,
            $action,
        )
        .await
    };
}
pub(crate) use authorize;

#[derive(Debug, Clone)]
pub struct PolicyEngine {
    engine: Arc<RwLock<Engine>>,
    data_needs_rebuild: Arc<RwLock<bool>>,
}

impl Default for PolicyEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl PolicyEngine {
    #[allow(unused)]
    pub fn new() -> Self {
        let mut engine = Engine::new();
        engine
            .add_policy("backend".to_string(), BACKEND_POLICY.to_string())
            .map_err(|err| eyre!(Box::new(err)))
            .wrap_err("Failed to read backend policy")
            .unwrap();
        Self {
            engine: Arc::new(RwLock::new(engine)),
            data_needs_rebuild: Arc::new(RwLock::new(true)),
        }
    }

    /// Clone the engine for use in a request handler.
    /// Unlike regular Clone, this creates an independent `data_needs_rebuild` state
    /// set to `false`, so that invalidating the global engine doesn't affect
    /// cloned request-scoped engines.
    pub fn clone_for_request(&self) -> Self {
        Self {
            engine: self.engine.clone(),
            data_needs_rebuild: Arc::new(RwLock::new(false)),
        }
    }

    async fn set_data(&self, data: JsonValue) -> Result<(), Report> {
        let mut guard = self.engine.write().await;
        guard.clear_data();
        guard
            .add_data_json(&data.to_string())
            .map_err(|e| eyre!(e))?;
        *self.data_needs_rebuild.write().await = false;
        Ok(())
    }

    pub async fn invalidate_data(&self) {
        *self.data_needs_rebuild.write().await = true;
        // info!("Invalidated policy data");
    }

    #[instrument(skip_all)]
    pub async fn rebuild_data(&self, db: &DatabaseConnection) -> Result<(), Report> {
        // Fetch policy data for each resource type
        let chat_data = fetch_chat_policy_data(db).await?;
        let assistant_data = fetch_assistant_policy_data(db).await?;
        let share_grants_data = fetch_share_grants_policy_data(db).await?;

        // Combine all resource attributes
        let resource_attributes = json!({
            "chat": chat_data,
            "assistant": assistant_data
        });
        let policy_data = json!({
            "resource_attributes": resource_attributes,
            "share_grants": share_grants_data
        });

        self.set_data(policy_data).await?;
        // info!("Finished policy data rebuild");
        Ok(())
    }

    #[instrument(skip_all)]
    pub async fn rebuild_data_if_needed(&self, db: &DatabaseConnection) -> Result<(), Report> {
        let data_needs_rebuild = { *self.data_needs_rebuild.read().await };
        tracing::trace!(data_needs_rebuild = data_needs_rebuild);
        if data_needs_rebuild {
            self.rebuild_data(db).await?;
        }
        Ok(())
    }

    pub async fn rebuild_data_if_needed_req(
        &self,
        db: &DatabaseConnection,
    ) -> Result<(), StatusCode> {
        self.rebuild_data_if_needed(db).await.map_err(|e| {
            tracing::error!("Failed to rebuild policy data: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })
    }
}

#[async_trait::async_trait]
impl AuthorizeFull for PolicyEngine {
    async fn authorize(
        &self,
        subject_kind: SubjectKind,
        subject_id: &SubjectId,
        resource_kind: ResourceKind,
        resource_id: &ResourceId,
        action: Action,
    ) -> Result<(), Report> {
        self.authorize_with_context(
            subject_kind,
            subject_id,
            resource_kind,
            resource_id,
            action,
            &[],
        )
        .await
    }
}

impl PolicyEngine {
    /// Authorize with additional context (e.g., organization_group_ids).
    pub async fn authorize_with_context(
        &self,
        subject_kind: SubjectKind,
        subject_id: &SubjectId,
        resource_kind: ResourceKind,
        resource_id: &ResourceId,
        action: Action,
        organization_group_ids: &[String],
    ) -> Result<(), Report> {
        // info!("Authorizing");
        if *self.data_needs_rebuild.read().await {
            return Err(eyre!(
                "Policy data is stale and needs to be rebuilt before authorization"
            ));
        }
        // First validate the resource_kind-action combination as an assertion
        authorize_general(resource_kind, action);

        let engine = self.engine.read().await;
        let mut engine = engine.clone();

        let input = json!({
            "subject_kind": subject_kind,
            "subject_id": subject_id,
            "resource_kind": resource_kind,
            "resource_id": resource_id,
            "action": action,
            "organization_group_ids": organization_group_ids,
        });

        engine
            .set_input_json(&serde_json::to_string(&input)?)
            .map_err(|e| eyre!(e))?;

        let result = engine
            .eval_bool_query("data.backend.allow".to_string(), false)
            .map_err(|e| eyre!(e))?;

        if result {
            Ok(())
        } else {
            Err(eyre!("User is not authorized to perform this action"))
        }
    }
}

// impl Authorize for PolicyEngine {}

#[async_trait::async_trait]
pub trait AuthorizeFull {
    async fn authorize(
        &self,
        subject_kind: SubjectKind,
        subject_id: &SubjectId,
        resource_kind: ResourceKind,
        resource_id: &ResourceId,
        action: Action,
    ) -> Result<(), Report>;
}

#[async_trait::async_trait]
pub trait AuthorizeShort {
    async fn authorize<S, R>(&self, subject: S, resource: R, action: Action) -> Result<(), Report>
    where
        S: Into<Subject> + Send,
        R: Into<Resource> + Send;
}

// pub trait Authorize: AuthorizeFull + AuthorizeShort {}

#[async_trait::async_trait]
impl AuthorizeShort for PolicyEngine {
    async fn authorize<S, R>(&self, subject: S, resource: R, action: Action) -> Result<(), Report>
    where
        S: Into<Subject> + Send,
        R: Into<Resource> + Send,
    {
        let subject: Subject = subject.into();
        let resource: Resource = resource.into();
        let (subject_kind, subject_id) = subject.clone().into_parts();
        let (resource_kind, resource_id) = resource.clone().into_parts();
        let organization_group_ids = subject.organization_group_ids();
        self.authorize_with_context(
            subject_kind,
            &subject_id,
            resource_kind,
            &resource_id,
            action,
            organization_group_ids,
        )
        .await
    }
}

// Compile-time validation of resource-action combinations
pub const fn is_valid_resource_action(resource: ResourceKind, action: Action) -> bool {
    #[allow(clippy::match_like_matches_macro)]
    match (resource, action) {
        (ResourceKind::Chat, Action::Read) => true,
        (ResourceKind::Chat, Action::Update) => true,
        (ResourceKind::Chat, Action::SubmitMessage) => true,
        (ResourceKind::ChatSingleton, Action::Create) => true,
        (ResourceKind::MessageFeedback, Action::SubmitFeedback) => true,
        (ResourceKind::Assistant, Action::Read) => true,
        (ResourceKind::Assistant, Action::Update) => true,
        (ResourceKind::Assistant, Action::Share) => true,
        (ResourceKind::AssistantSingleton, Action::Create) => true,
        (ResourceKind::ShareGrant, Action::Create) => true,
        (ResourceKind::ShareGrant, Action::Read) => true,
        (ResourceKind::ShareGrant, Action::Delete) => true,
        _ => false,
    }
}

pub const fn authorize_general(resource_kind: ResourceKind, action: Action) {
    assert!(
        is_valid_resource_action(resource_kind, action),
        "This resource kind can not be used with this action"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_authorize_macro_success() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let subject_kind = SubjectKind::User;
            let subject_id = SubjectId("user_1".to_string());
            let resource_kind = ResourceKind::Chat;
            let resource_id = ResourceId("chat_1".to_string());
            let action = Action::Read;

            let engine = PolicyEngine::new();
            engine
                .set_data(json!({
                    "resource_attributes": {
                        "chat": {
                            "chat_1": {
                                "id": "chat_1",
                                "owner_id": "user_1"
                            }
                        }
                    }
                }))
                .await
                .unwrap();
            // This should work as Chat + Read is a valid combination
            let result = authorize!(
                engine,
                subject_kind,
                &subject_id,
                resource_kind,
                &resource_id,
                action
            );
            assert!(result.is_ok());
        });
    }

    #[tokio::test]
    #[should_panic(expected = "This resource kind can not be used with this action")]
    async fn test_authorize_macro_invalid_combination() {
        let subject_kind = SubjectKind::User;
        let subject_id = SubjectId("user1".to_string());
        let resource_kind = ResourceKind::Chat;
        let resource_id = ResourceId("chat1".to_string());
        let action = Action::Create;

        // This should panic as Chat + Create is not a valid combination
        let engine = PolicyEngine::new();
        engine.set_data(json!({})).await.unwrap();
        authorize!(
            engine,
            subject_kind,
            &subject_id,
            resource_kind,
            &resource_id,
            action
        )
        .unwrap();
    }

    #[tokio::test]
    async fn test_authorize_short_form() {
        let subject = Subject::User("user_1".to_string());
        let resource = Resource::Chat("chat_1".to_string());
        let action = Action::Read;

        let engine = PolicyEngine::new();
        engine
            .set_data(json!({
                "resource_attributes": {
                    "chat": {
                        "chat_1": {
                            "id": "chat_1",
                            "owner_id": "user_1"
                        }
                    }
                }
            }))
            .await
            .unwrap();
        // This should work using the short form
        let result = authorize!(engine, &subject, &resource, action);
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_authorize_with_organization_group_share_grant() {
        let subject = Subject::UserWithGroups {
            id: "user_3".to_string(),
            organization_user_id: None,
            organization_group_ids: vec!["org-group-1".to_string(), "org-group-2".to_string()],
        };
        let resource = Resource::Assistant("assistant_2".to_string());
        let action = Action::Read;

        let engine = PolicyEngine::new();
        engine
            .set_data(json!({
                "resource_attributes": {
                    "assistant": {
                        "assistant_2": {
                            "id": "assistant_2",
                            "owner_id": "user_2"
                        }
                    }
                },
                "share_grants": [
                    {
                        "id": "grant-2",
                        "resource_type": "assistant",
                        "resource_id": "assistant_2",
                        "subject_type": "organization_group",
                        "subject_id_type": "organization_group_id",
                        "subject_id": "org-group-1",
                        "role": "viewer"
                    }
                ]
            }))
            .await
            .unwrap();
        // User should be able to read the assistant because they're in org-group-1
        let result = authorize!(engine, &subject, &resource, action);
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_authorize_without_organization_group_share_grant() {
        let subject = Subject::UserWithGroups {
            id: "user_3".to_string(),
            organization_user_id: None,
            organization_group_ids: vec!["org-group-2".to_string()], // Not in org-group-1
        };
        let resource = Resource::Assistant("assistant_2".to_string());
        let action = Action::Read;

        let engine = PolicyEngine::new();
        engine
            .set_data(json!({
                "resource_attributes": {
                    "assistant": {
                        "assistant_2": {
                            "id": "assistant_2",
                            "owner_id": "user_2"
                        }
                    }
                },
                "share_grants": [
                    {
                        "id": "grant-2",
                        "resource_type": "assistant",
                        "resource_id": "assistant_2",
                        "subject_type": "organization_group",
                        "subject_id_type": "organization_group_id",
                        "subject_id": "org-group-1",
                        "role": "viewer"
                    }
                ]
            }))
            .await
            .unwrap();
        // User should NOT be able to read the assistant because they're not in org-group-1
        let result = authorize!(engine, &subject, &resource, action);
        assert!(result.is_err());
    }
}
