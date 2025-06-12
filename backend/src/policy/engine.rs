use crate::models::chat::get_all_chats;
use crate::policy::types::{
    Action, Resource, ResourceId, ResourceKind, Subject, SubjectId, SubjectKind,
};
use axum::http::StatusCode;
use eyre::{eyre, Report, WrapErr};
use regorus::Engine;
use sea_orm::DatabaseConnection;
use serde_json::{json, Value as JsonValue};
use std::sync::Arc;
use tokio::sync::RwLock;

const BACKEND_POLICY: &str = include_str!("../../policy/backend/backend.rego");

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
        engine.set_rego_v1(true);
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

    pub async fn rebuild_data(&self, db: &DatabaseConnection) -> Result<(), Report> {
        let all_chats = get_all_chats(db).await?;
        let mut chat_attributes = serde_json::Map::new();
        for chat in all_chats {
            chat_attributes.insert(
                chat.id.to_string(),
                json!({
                    "id": chat.id.to_string(),
                    "owner_id": chat.owner_user_id,
                }),
            );
        }
        let resource_attributes = json!({
            "chat": chat_attributes
        });
        let policy_data = json!({ "resource_attributes": resource_attributes });

        self.set_data(policy_data).await?;
        // info!("Finished policy data rebuild");
        Ok(())
    }

    pub async fn rebuild_data_if_needed(&self, db: &DatabaseConnection) -> Result<(), Report> {
        let data_needs_rebuild = { *self.data_needs_rebuild.read().await };
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
        AuthorizeFull::authorize(
            self,
            subject_kind,
            &subject_id,
            resource_kind,
            &resource_id,
            action,
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
}
