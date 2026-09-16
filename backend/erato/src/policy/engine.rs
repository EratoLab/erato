use super::facts::{Observation, PolicyFactsLoader, SharedFacts};
use crate::config::{AppConfig, FacetPermissionRule, McpServerPermissionRule, ModelPermissionRule};
use crate::db::entity::chats;
use crate::policy::types::{
    Action, Resource, ResourceId, ResourceKind, Subject, SubjectId, SubjectKind,
};
use axum::http::StatusCode;
use eyre::{Report, WrapErr, eyre};
use regorus::Engine;
use sea_orm::prelude::Uuid;
use sea_orm::{DatabaseConnection, EntityTrait};
use serde_json::{Value as JsonValue, json};
use std::sync::{Arc, OnceLock};
#[cfg(test)]
use std::time::Duration;
use tokio::sync::{OwnedSemaphorePermit, RwLock, Semaphore};

const BACKEND_POLICY: &str = include_str!("../../../policy/backend/backend.rego");
// Bound CPU-heavy evaluations across all policy engines, including reloads.
const MAX_CONCURRENT_POLICY_EVALUATIONS: usize = 4;
static EVALUATION_SLOTS: OnceLock<Arc<Semaphore>> = OnceLock::new();

fn config_resources_policy_data(resource_ids: impl IntoIterator<Item = String>) -> JsonValue {
    let mut attributes = serde_json::Map::new();
    for resource_id in resource_ids {
        attributes.insert(resource_id.clone(), json!({ "id": resource_id }));
    }
    json!(attributes)
}

fn model_permission_rule_to_json(rule: &ModelPermissionRule) -> JsonValue {
    match rule {
        ModelPermissionRule::AllowAll { chat_provider_ids } => json!({
            "rule_type": "allow-all",
            "resource_ids": chat_provider_ids,
        }),
        ModelPermissionRule::AllowForGroupMembers {
            chat_provider_ids,
            groups,
        } => json!({
            "rule_type": "allow-for-group-members",
            "resource_ids": chat_provider_ids,
            "groups": groups,
        }),
    }
}

fn mcp_server_permission_rule_to_json(rule: &McpServerPermissionRule) -> JsonValue {
    match rule {
        McpServerPermissionRule::AllowAll { mcp_server_ids } => json!({
            "rule_type": "allow-all",
            "resource_ids": mcp_server_ids,
        }),
        McpServerPermissionRule::AllowForGroupMembers {
            mcp_server_ids,
            groups,
        } => json!({
            "rule_type": "allow-for-group-members",
            "resource_ids": mcp_server_ids,
            "groups": groups,
        }),
    }
}

fn facet_permission_rule_to_json(rule: &FacetPermissionRule) -> JsonValue {
    match rule {
        FacetPermissionRule::AllowAll { facet_ids } => json!({
            "rule_type": "allow-all",
            "resource_ids": facet_ids,
        }),
        FacetPermissionRule::AllowForGroupMembers { facet_ids, groups } => json!({
            "rule_type": "allow-for-group-members",
            "resource_ids": facet_ids,
            "groups": groups,
        }),
    }
}

fn build_config_permissions_policy_data(config: &AppConfig) -> JsonValue {
    let chat_provider_rules: Vec<JsonValue> = config
        .model_permissions
        .rules
        .values()
        .map(model_permission_rule_to_json)
        .collect();
    let mcp_server_rules: Vec<JsonValue> = config
        .mcp_server_permissions
        .rules
        .values()
        .map(mcp_server_permission_rule_to_json)
        .collect();
    let facet_rules: Vec<JsonValue> = config
        .facet_permissions
        .rules
        .values()
        .map(facet_permission_rule_to_json)
        .collect();

    json!({
        "chat_provider": chat_provider_rules,
        "mcp_server": mcp_server_rules,
        "facet": facet_rules,
    })
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
    loader: Arc<RwLock<Option<PolicyFactsLoader>>>,
    shared_facts: SharedFacts,
    templates: moka::future::Cache<String, Arc<RwLock<Engine>>>,
    evaluation_slots: Arc<Semaphore>,
}

impl Default for PolicyEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl PolicyEngine {
    pub fn new() -> Self {
        Self {
            engine: Arc::new(RwLock::new(Engine::new())),
            loader: Arc::new(RwLock::new(None)),
            shared_facts: SharedFacts::default(),
            templates: moka::future::Cache::new(16),
            evaluation_slots: EVALUATION_SLOTS
                .get_or_init(|| Arc::new(Semaphore::new(MAX_CONCURRENT_POLICY_EVALUATIONS)))
                .clone(),
        }
    }

    /// Prepare once per effective configuration, without any resource queries.
    pub(crate) async fn for_request(
        &self,
        db: &DatabaseConnection,
        config: &AppConfig,
    ) -> Result<Self, Report> {
        let data = configuration_data(config).to_string();
        let engine = self
            .templates
            .try_get_with(data.clone(), async move {
                tokio::task::spawn_blocking(move || {
                    prepare_template(&data).map(|engine| Arc::new(RwLock::new(engine)))
                })
                .await
                .map_err(|error| error.to_string())?
            })
            .await
            .map_err(|error| eyre!(error.to_string()))?;
        Ok(Self {
            engine,
            loader: Arc::new(RwLock::new(Some(PolicyFactsLoader::new(
                db.clone(),
                self.shared_facts.clone(),
            )))),
            shared_facts: self.shared_facts.clone(),
            templates: self.templates.clone(),
            evaluation_slots: self.evaluation_slots.clone(),
        })
    }

    #[cfg(test)]
    async fn set_data(&self, data: JsonValue) -> Result<(), Report> {
        let engine = prepare_template(&data.to_string()).map_err(|error| eyre!(error))?;
        *self.engine.write().await = engine;
        Ok(())
    }

    /// Compatibility for non-request callers. Existing request configuration
    /// must not be replaced by model helpers passing AppConfig::default().
    pub async fn rebuild_data_if_needed(
        &self,
        db: &DatabaseConnection,
        config: &AppConfig,
    ) -> Result<(), Report> {
        let mut loader = self.loader.write().await;
        if loader.is_none() {
            let request = self.for_request(db, config).await?;
            *self.engine.write().await = request.engine.read().await.clone();
            *loader = Some(PolicyFactsLoader::new(
                db.clone(),
                self.shared_facts.clone(),
            ));
        }
        Ok(())
    }

    pub async fn rebuild_data_if_needed_req(
        &self,
        db: &DatabaseConnection,
        config: &AppConfig,
    ) -> Result<(), StatusCode> {
        self.rebuild_data_if_needed(db, config)
            .await
            .map_err(|error| {
                tracing::error!(%error, "Failed to initialize policy configuration");
                StatusCode::INTERNAL_SERVER_ERROR
            })
    }

    /// Compatibility for older callers. Committed change notifications
    /// invalidate only affected in-memory generations.
    pub async fn invalidate_data(&self) {}

    pub(crate) async fn load_chat_model(
        &self,
        db: &DatabaseConnection,
        id: Uuid,
    ) -> Result<Option<chats::Model>, Report> {
        let loader = self.loader.read().await.clone();
        match loader {
            Some(loader) => loader.load_chat_model(id).await,
            None => Ok(chats::Entity::find_by_id(id).one(db).await?),
        }
    }

    pub(crate) async fn load_assistant_model(
        &self,
        db: &DatabaseConnection,
        id: Uuid,
    ) -> Result<Option<crate::db::entity::assistants::Model>, Report> {
        match self.loader.read().await.clone() {
            Some(loader) => loader.load_assistant_model(id).await,
            None => Ok(crate::db::entity::assistants::Entity::find_by_id(id)
                .one(db)
                .await?),
        }
    }

    pub(crate) async fn load_file_model(
        &self,
        db: &DatabaseConnection,
        id: Uuid,
    ) -> Result<Option<crate::db::entity::file_uploads::Model>, Report> {
        match self.loader.read().await.clone() {
            Some(loader) => loader.load_file_model(id).await,
            None => Ok(crate::db::entity::file_uploads::Entity::find_by_id(id)
                .one(db)
                .await?),
        }
    }

    pub(crate) async fn observe_facts(&self) -> Result<Option<Observation>, Report> {
        match self.loader.read().await.clone() {
            Some(loader) => Ok(Some(loader.observe().await?)),
            None => Ok(None),
        }
    }

    pub(crate) async fn seed_chat_projection(
        &self,
        id: Uuid,
        owner_user_id: String,
        archived_at: Option<sea_orm::prelude::DateTimeWithTimeZone>,
        observation: Option<Observation>,
    ) {
        if let (Some(loader), Some(observation)) = (self.loader.read().await.clone(), observation) {
            loader
                .seed_chat_projection(id, owner_user_id, archived_at, observation)
                .await;
        }
    }

    pub(crate) async fn seed_committed_chat(
        &self,
        chat: &chats::Model,
        observation: Option<Observation>,
    ) {
        if let (Some(loader), Some(observation)) = (self.loader.read().await.clone(), observation) {
            loader.seed_chat(chat, observation).await;
        }
    }
}

fn prepare_template(data: &str) -> Result<Engine, String> {
    let mut engine = Engine::new();
    engine
        .add_policy("backend".to_string(), BACKEND_POLICY.to_string())
        .map_err(|error| error.to_string())?;
    engine
        .add_data_json(data)
        .map_err(|error| error.to_string())?;
    engine
        .set_input_json("{}")
        .map_err(|error| error.to_string())?;
    // Regorus 0.5 prepares on first evaluation; changing only input preserves it.
    engine
        .eval_bool_query("data.backend.allow".to_string(), false)
        .map_err(|error| error.to_string())?;
    Ok(engine)
}

fn configuration_data(config: &AppConfig) -> JsonValue {
    let chat_provider_data =
        config_resources_policy_data(if let Some(providers) = config.chat_providers.as_ref() {
            providers.providers.keys().cloned().collect()
        } else if config.chat_provider.is_some() {
            vec!["default".to_string()]
        } else {
            Vec::new()
        });
    json!({
        "resource_attributes": {
            "chat_provider": chat_provider_data,
            "mcp_server": config_resources_policy_data(config.mcp_servers.keys().cloned()),
            "facet": config_resources_policy_data(config.facets.facets.keys().cloned()),
        },
        "config": {
            "chat_sharing": { "enabled": config.chat_sharing.enabled },
            "assistants": { "enable_edit_sharing": config.assistants.enable_edit_sharing },
        },
        "config_permissions": build_config_permissions_policy_data(config),
    })
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
            &[],
        )
        .await
    }
}

impl PolicyEngine {
    /// Authorize with additional context (e.g., organization_group_ids).
    #[allow(clippy::too_many_arguments)]
    pub async fn authorize_with_context(
        &self,
        subject_kind: SubjectKind,
        subject_id: &SubjectId,
        resource_kind: ResourceKind,
        resource_id: &ResourceId,
        action: Action,
        organization_group_ids: &[String],
        groups: &[String],
    ) -> Result<(), Report> {
        authorize_general(resource_kind, action);
        let loader = self.loader.read().await.clone();
        let facts = match loader {
            Some(loader) => {
                let ids = if matches!(
                    resource_kind,
                    ResourceKind::Chat | ResourceKind::Assistant | ResourceKind::FileUpload
                ) {
                    vec![Uuid::parse_str(&resource_id.0).wrap_err("Invalid policy resource ID")?]
                } else {
                    vec![]
                };
                Some(loader.load(resource_kind, &ids, action).await?)
            }
            None => None,
        };
        let allowed = self
            .evaluate_authorization(
                subject_kind,
                subject_id,
                resource_kind,
                resource_id,
                action,
                organization_group_ids,
                groups,
                facts,
            )
            .await?;
        if allowed {
            Ok(())
        } else {
            Err(eyre!("User is not authorized to perform this action"))
        }
    }

    /// Resolve an entire collection and its relationships in batches in one
    /// coherent context. Database failures are errors, never partial allows.
    pub async fn filter_authorized_ids(
        &self,
        subject: &Subject,
        kind: ResourceKind,
        ids: &[Uuid],
        action: Action,
    ) -> Result<Vec<Uuid>, Report> {
        authorize_general(kind, action);
        let facts = match self.loader.read().await.clone() {
            Some(loader) => Some(loader.load(kind, ids, action).await?),
            None => None,
        };
        let (subject_kind, subject_id) = subject.clone().into_parts();
        let mut input = json!({
            "subject_kind": subject_kind, "subject_id": subject_id,
            "resource_kind": kind, "action": action,
            "organization_group_ids": subject.organization_group_ids(), "groups": [],
        });
        if let Some(facts) = facts {
            input["facts"] = facts;
        }
        let ids = ids.to_vec();
        let permit = self
            .evaluation_slots
            .clone()
            .acquire_owned()
            .await
            .wrap_err("Policy evaluation queue closed")?;
        evaluate_policy_snapshot(&self.engine, permit, move |mut engine| {
            let mut input =
                regorus::Value::from_json_str(&input.to_string()).map_err(|error| eyre!(error))?;
            let mut allowed = Vec::new();
            for id in ids {
                input.as_object_mut().map_err(|error| eyre!(error))?.insert(
                    regorus::Value::from("resource_id"),
                    regorus::Value::from(id.to_string()),
                );
                // Regorus values share their nested facts across input clones.
                engine.set_input(input.clone());
                if engine
                    .eval_bool_query("data.backend.allow".to_string(), false)
                    .map_err(|error| eyre!(error))?
                {
                    allowed.push(id);
                }
            }
            Ok(allowed)
        })
        .await
    }

    #[allow(clippy::too_many_arguments)]
    async fn evaluate_authorization(
        &self,
        subject_kind: SubjectKind,
        subject_id: &SubjectId,
        resource_kind: ResourceKind,
        resource_id: &ResourceId,
        action: Action,
        organization_group_ids: &[String],
        groups: &[String],
        facts: Option<JsonValue>,
    ) -> Result<bool, Report> {
        // Fact loading is complete before occupying CPU evaluation capacity.
        let permit = crate::latency::stage(
            "policy.evaluation_queue_wait",
            self.evaluation_slots.clone().acquire_owned(),
        )
        .await
        .wrap_err("Policy evaluation queue closed")?;
        let mut input = json!({
            "subject_kind": subject_kind, "subject_id": subject_id,
            "resource_kind": resource_kind, "resource_id": resource_id, "action": action,
            "organization_group_ids": organization_group_ids, "groups": groups,
        });
        if let Some(facts) = facts {
            input["facts"] = facts;
        }
        evaluate_policy_snapshot(&self.engine, permit, move |mut engine| {
            let _evaluation_timer = crate::latency::StageTimer::new("policy.evaluate");
            engine
                .set_input_json(&input.to_string())
                .map_err(|error| eyre!(error))?;
            engine
                .eval_bool_query("data.backend.allow".to_string(), false)
                .map_err(|error| eyre!(error))
        })
        .await
    }

    async fn filter_authorized_config_resources(
        &self,
        subject: &Subject,
        groups: &[String],
        resource_ids: &[String],
        to_resource: fn(String) -> Resource,
    ) -> Result<Vec<String>, Report> {
        let mut allowed = Vec::new();
        let (subject_kind, subject_id) = subject.clone().into_parts();
        let resource_kind_name = if let Some(first_id) = resource_ids.first() {
            let (resource_kind, _) = to_resource(first_id.clone()).into_parts();
            format!("{resource_kind:?}")
        } else {
            "Unknown".to_string()
        };

        tracing::trace!(
            subject = ?subject,
            groups = ?groups,
            resource_kind = resource_kind_name,
            requested_resource_ids = ?resource_ids,
            "Filtering authorized config resources"
        );

        for resource_id in resource_ids {
            let (resource_kind, _) = to_resource(resource_id.clone()).into_parts();
            let is_allowed = self
                .authorize_with_context(
                    subject_kind,
                    &subject_id,
                    resource_kind,
                    &ResourceId(resource_id.clone()),
                    Action::Read,
                    subject.organization_group_ids(),
                    groups,
                )
                .await
                .is_ok();

            tracing::trace!(
                subject = ?subject,
                groups = ?groups,
                resource_kind = ?resource_kind,
                resource_id = resource_id,
                allowed = is_allowed,
                "Config resource authorization result"
            );

            if is_allowed {
                allowed.push(resource_id.clone());
            }
        }

        tracing::trace!(
            subject = ?subject,
            groups = ?groups,
            resource_kind = resource_kind_name,
            allowed_resource_ids = ?allowed,
            "Finished filtering authorized config resources"
        );

        Ok(allowed)
    }

    pub async fn filter_authorized_chat_provider_ids(
        &self,
        subject: &Subject,
        groups: &[String],
        resource_ids: &[String],
    ) -> Result<Vec<String>, Report> {
        self.filter_authorized_config_resources(
            subject,
            groups,
            resource_ids,
            Resource::ChatProvider,
        )
        .await
    }

    pub async fn filter_authorized_mcp_server_ids(
        &self,
        subject: &Subject,
        groups: &[String],
        resource_ids: &[String],
    ) -> Result<Vec<String>, Report> {
        self.filter_authorized_config_resources(subject, groups, resource_ids, Resource::McpServer)
            .await
    }

    pub async fn filter_authorized_facet_ids(
        &self,
        subject: &Subject,
        groups: &[String],
        resource_ids: &[String],
    ) -> Result<Vec<String>, Report> {
        self.filter_authorized_config_resources(subject, groups, resource_ids, Resource::Facet)
            .await
    }
}

/// Clone under a short read lock, then evaluate on the blocking pool. The
/// permit lives inside the job: cancellation of its async caller cannot release
/// capacity while synchronous work is still running.
async fn evaluate_policy_snapshot<T: Send + 'static>(
    shared_engine: &RwLock<Engine>,
    permit: OwnedSemaphorePermit,
    evaluate: impl FnOnce(Engine) -> Result<T, Report> + Send + 'static,
) -> Result<T, Report> {
    let snapshot = {
        let engine = crate::latency::stage("policy.engine_read_wait", shared_engine.read()).await;
        let _read_hold_timer = crate::latency::StageTimer::new("policy.engine_read_hold");
        let _clone_timer = crate::latency::StageTimer::new("policy.engine_clone");
        crate::latency::sync_span("policy.engine_clone").in_scope(|| engine.clone())
    };

    let dispatch_wait = crate::latency::StageTimer::new("policy.blocking_dispatch_wait");
    let parent_span = tracing::Span::current();
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        drop(dispatch_wait);
        parent_span.in_scope(|| evaluate(snapshot))
    })
    .await
    .wrap_err("Policy evaluation blocking task failed")?
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
            &[],
        )
        .await
    }
}

// Compile-time validation of resource-action combinations
pub const fn is_valid_resource_action(resource: ResourceKind, action: Action) -> bool {
    #[allow(clippy::match_like_matches_macro)]
    match (resource, action) {
        (ResourceKind::Chat, Action::Read) => true,
        (ResourceKind::Chat, Action::SharedRead) => true,
        (ResourceKind::Chat, Action::Update) => true,
        (ResourceKind::Chat, Action::SubmitMessage) => true,
        (ResourceKind::Chat, Action::Share) => true,
        (ResourceKind::ChatSingleton, Action::Create) => true,
        (ResourceKind::PromptOptimizerSingleton, Action::Create) => true,
        (ResourceKind::DesktopSidecarConfigurationSingleton, Action::Read) => true,
        (ResourceKind::MessageFeedback, Action::SubmitFeedback) => true,
        (ResourceKind::Assistant, Action::Read) => true,
        (ResourceKind::Assistant, Action::Update) => true,
        (ResourceKind::Assistant, Action::Share) => true,
        (ResourceKind::FileUpload, Action::Read) => true,
        (ResourceKind::FileUpload, Action::Update) => true,
        (ResourceKind::AssistantSingleton, Action::Create) => true,
        (ResourceKind::ShareGrant, Action::Create) => true,
        (ResourceKind::ShareGrant, Action::Read) => true,
        (ResourceKind::ShareGrant, Action::Delete) => true,
        (ResourceKind::ChatProvider, Action::Read) => true,
        (ResourceKind::McpServer, Action::Read) => true,
        (ResourceKind::Facet, Action::Read) => true,
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

    #[tokio::test]
    async fn blocking_evaluation_releases_read_lock_and_keeps_permit_after_cancellation() {
        let engine = Arc::new(RwLock::new(Engine::new()));
        let slots = Arc::new(Semaphore::new(1));
        let permit = slots.clone().acquire_owned().await.unwrap();
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let caller_thread = std::thread::current().id();
        let shared = engine.clone();
        let task = tokio::spawn(async move {
            evaluate_policy_snapshot(&shared, permit, move |_| {
                assert_ne!(std::thread::current().id(), caller_thread);
                started_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                Ok(())
            })
            .await
        });
        tokio::time::timeout(Duration::from_secs(5), started_rx)
            .await
            .unwrap()
            .unwrap();
        assert!(
            engine.try_write().is_ok(),
            "evaluation must not retain the read lock"
        );
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        assert_eq!(
            slots.available_permits(),
            0,
            "running job still owns capacity"
        );
        release_tx.send(()).unwrap();
        let _permit = tokio::time::timeout(Duration::from_secs(5), slots.acquire())
            .await
            .unwrap()
            .unwrap();
    }

    #[tokio::test]
    async fn blocking_evaluation_panic_returns_error_and_releases_capacity() {
        let engine = RwLock::new(Engine::new());
        let slots = Arc::new(Semaphore::new(1));
        let permit = slots.clone().acquire_owned().await.unwrap();
        let result =
            evaluate_policy_snapshot::<()>(&engine, permit, |_| panic!("test panic")).await;
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("blocking task failed")
        );
        assert_eq!(slots.available_permits(), 1);
        assert!(engine.try_write().is_ok());
    }

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
        let subject = Subject::UserWithOrganizationInfo {
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
        let subject = Subject::UserWithOrganizationInfo {
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

    #[tokio::test]
    async fn test_authorize_with_organization_share_grant() {
        let subject = Subject::UserWithOrganizationInfo {
            id: "user_3".to_string(),
            organization_user_id: None,
            organization_group_ids: vec![],
        };
        let resource = Resource::Assistant("assistant_2".to_string());

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
                "share_grants": [{
                    "id": "grant-organization-1",
                    "resource_type": "assistant",
                    "resource_id": "assistant_2",
                    "subject_type": "organization",
                    "subject_id_type": "organization_id",
                    "subject_id": "__organization__",
                    "role": "viewer"
                }]
            }))
            .await
            .unwrap();

        assert!(authorize!(engine, &subject, &resource, Action::Read).is_ok());
    }

    #[tokio::test]
    async fn test_authorize_file_upload_read_via_linked_chat() {
        let subject = Subject::User("user_1".to_string());
        let resource = Resource::FileUpload("file_1".to_string());
        let action = Action::Read;

        let engine = PolicyEngine::new();
        engine
            .set_data(json!({
                "resource_attributes": {
                    "chat": {
                        "chat_1": { "id": "chat_1", "owner_id": "user_1" }
                    },
                    "assistant": {},
                    "file_upload": {
                        "file_1": {
                            "id": "file_1",
                            "owner_id": "other_user",
                            "linked_chat_ids": ["chat_1"],
                            "linked_assistant_ids": []
                        }
                    }
                },
                "share_grants": []
            }))
            .await
            .unwrap();

        let result = authorize!(engine, &subject, &resource, action);
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_authorize_file_upload_read_via_linked_assistant_owner() {
        let subject = Subject::User("user_2".to_string());
        let resource = Resource::FileUpload("file_2".to_string());
        let action = Action::Read;

        let engine = PolicyEngine::new();
        engine
            .set_data(json!({
                "resource_attributes": {
                    "chat": {},
                    "assistant": {
                        "assistant_2": { "id": "assistant_2", "owner_id": "user_2" }
                    },
                    "file_upload": {
                        "file_2": {
                            "id": "file_2",
                            "owner_id": "other_user",
                            "linked_chat_ids": [],
                            "linked_assistant_ids": ["assistant_2"]
                        }
                    }
                },
                "share_grants": []
            }))
            .await
            .unwrap();

        let result = authorize!(engine, &subject, &resource, action);
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_authorize_file_upload_read_via_linked_assistant_user_share_grant() {
        let subject = Subject::User("user_2".to_string());
        let resource = Resource::FileUpload("file_3".to_string());
        let action = Action::Read;

        let engine = PolicyEngine::new();
        engine
            .set_data(json!({
                "resource_attributes": {
                    "chat": {},
                    "assistant": {
                        "assistant_1": { "id": "assistant_1", "owner_id": "user_1" }
                    },
                    "file_upload": {
                        "file_3": {
                            "id": "file_3",
                            "owner_id": "other_user",
                            "linked_chat_ids": [],
                            "linked_assistant_ids": ["assistant_1"]
                        }
                    }
                },
                "share_grants": [
                    {
                        "id": "grant-1",
                        "resource_type": "assistant",
                        "resource_id": "assistant_1",
                        "subject_type": "user",
                        "subject_id_type": "id",
                        "subject_id": "user_2",
                        "role": "viewer"
                    }
                ]
            }))
            .await
            .unwrap();

        let result = authorize!(engine, &subject, &resource, action);
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_authorize_file_upload_read_via_linked_assistant_org_group_share_grant() {
        let subject = Subject::UserWithOrganizationInfo {
            id: "user_3".to_string(),
            organization_user_id: None,
            organization_group_ids: vec!["org-group-1".to_string()],
        };
        let resource = Resource::FileUpload("file_4".to_string());
        let action = Action::Read;

        let engine = PolicyEngine::new();
        engine
            .set_data(json!({
                "resource_attributes": {
                    "chat": {},
                    "assistant": {
                        "assistant_2": { "id": "assistant_2", "owner_id": "user_2" }
                    },
                    "file_upload": {
                        "file_4": {
                            "id": "file_4",
                            "owner_id": "other_user",
                            "linked_chat_ids": [],
                            "linked_assistant_ids": ["assistant_2"]
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

        let result = authorize!(engine, &subject, &resource, action);
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_authorize_file_upload_read_denied_without_owner_or_links() {
        let subject = Subject::User("user_2".to_string());
        let resource = Resource::FileUpload("file_5".to_string());
        let action = Action::Read;

        let engine = PolicyEngine::new();
        engine
            .set_data(json!({
                "resource_attributes": {
                    "chat": {},
                    "assistant": {},
                    "file_upload": {
                        "file_5": {
                            "id": "file_5",
                            "owner_id": "user_1",
                            "linked_chat_ids": [],
                            "linked_assistant_ids": []
                        }
                    }
                },
                "share_grants": []
            }))
            .await
            .unwrap();

        let result = authorize!(engine, &subject, &resource, action);
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_authorize_file_upload_update_by_owner() {
        let subject = Subject::User("user_1".to_string());
        let resource = Resource::FileUpload("file_1".to_string());
        let action = Action::Update;

        let engine = PolicyEngine::new();
        engine
            .set_data(json!({
                "resource_attributes": {
                    "chat": {
                        "chat_1": {
                            "id": "chat_1",
                            "owner_id": "user_1"
                        }
                    },
                    "assistant": {},
                    "file_upload": {
                        "file_1": {
                            "id": "file_1",
                            "owner_id": "user_1",
                            "linked_chat_ids": ["chat_1"],
                            "linked_assistant_ids": []
                        }
                    }
                },
                "share_grants": []
            }))
            .await
            .unwrap();

        let result = authorize!(engine, &subject, &resource, action);
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_authorize_file_upload_update_denied_for_non_owner() {
        let subject = Subject::User("user_2".to_string());
        let resource = Resource::FileUpload("file_1".to_string());
        let action = Action::Update;

        let engine = PolicyEngine::new();
        engine
            .set_data(json!({
                "resource_attributes": {
                    "chat": {},
                    "assistant": {},
                    "file_upload": {
                        "file_1": {
                            "id": "file_1",
                            "owner_id": "user_1",
                            "linked_chat_ids": [],
                            "linked_assistant_ids": []
                        }
                    }
                },
                "share_grants": []
            }))
            .await
            .unwrap();

        let result = authorize!(engine, &subject, &resource, action);
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_authorize_unknown_chat_is_denied_without_policy_error() {
        let engine = PolicyEngine::new();
        engine
            .set_data(json!({
                "resource_attributes": {
                    "chat": {}
                }
            }))
            .await
            .unwrap();

        let result = authorize!(
            engine,
            &Subject::User("user_1".to_string()),
            &Resource::Chat("missing-chat".to_string()),
            Action::Read
        );

        assert!(result.is_err());
        let error = result.unwrap_err();
        assert!(error.to_string().contains("not authorized"));
    }

    async fn build_config_resource_test_engine() -> PolicyEngine {
        let engine = PolicyEngine::new();
        engine
            .set_data(json!({
                "resource_attributes": {
                    "chat_provider": {
                        "mock-llm": { "id": "mock-llm" },
                        "fallback-llm": { "id": "fallback-llm" }
                    },
                    "mcp_server": {
                        "server-1": { "id": "server-1" },
                        "server-2": { "id": "server-2" }
                    },
                    "facet": {
                        "web_search": { "id": "web_search" },
                        "extended_thinking": { "id": "extended_thinking" }
                    }
                },
                "share_grants": [],
                "config_permissions": {
                    "chat_provider": [],
                    "mcp_server": [],
                    "facet": []
                }
            }))
            .await
            .unwrap();
        engine
    }

    #[tokio::test]
    async fn test_filter_authorized_chat_provider_ids_allows_all_when_no_rules_configured() {
        let engine = build_config_resource_test_engine().await;
        let subject = Subject::User("user_1".to_string());
        let requested_ids = vec!["mock-llm".to_string(), "fallback-llm".to_string()];

        let allowed = engine
            .filter_authorized_chat_provider_ids(&subject, &[], &requested_ids)
            .await
            .unwrap();

        assert_eq!(allowed, requested_ids);
    }

    #[tokio::test]
    async fn test_filter_authorized_mcp_server_ids_allows_all_when_no_rules_configured() {
        let engine = build_config_resource_test_engine().await;
        let subject = Subject::User("user_1".to_string());
        let requested_ids = vec!["server-1".to_string(), "server-2".to_string()];

        let allowed = engine
            .filter_authorized_mcp_server_ids(&subject, &[], &requested_ids)
            .await
            .unwrap();

        assert_eq!(allowed, requested_ids);
    }

    #[tokio::test]
    async fn test_filter_authorized_facet_ids_allows_all_when_no_rules_configured() {
        let engine = build_config_resource_test_engine().await;
        let subject = Subject::User("user_1".to_string());
        let requested_ids = vec!["web_search".to_string(), "extended_thinking".to_string()];

        let allowed = engine
            .filter_authorized_facet_ids(&subject, &[], &requested_ids)
            .await
            .unwrap();

        assert_eq!(allowed, requested_ids);
    }
}
