use crate::config::{AppConfig, FacetPermissionRule, McpServerPermissionRule, ModelPermissionRule};
use crate::db::entity::prelude::*;
use crate::db::entity::{
    assistant_file_uploads, assistants, chat_file_uploads, file_uploads, share_grants, share_links,
};
use crate::db::entity_ext::chats;
use crate::metrics_constants::POSTGRES_QUERY_POLICY_CHAT_VIEW_PERMISSION;
use crate::policy::types::{
    Action, Resource, ResourceId, ResourceKind, Subject, SubjectId, SubjectKind,
};
use crate::query_metrics::named_statement_from_string;
use axum::http::StatusCode;
use eyre::{Report, WrapErr, eyre};
use regorus::{
    Source,
    Engine,
    unstable::{
        Expr,
        Parser,
        RegoToSqlIrTranslator,
        Rule,
        RuleHead,
        SqlCodeGenerator,
        SqlDialect,
        SqlOperation,
        SqlOptimizer,
    },
};
use sea_orm::prelude::Uuid;
use sea_orm::{DatabaseConnection, DbBackend, EntityTrait, FromQueryResult, Iden, QuerySelect};
use serde_json::{Value as JsonValue, json};
use std::collections::HashMap;
use std::sync::Arc;
use regorus::unstable::{SqlInputValue, SqlLiteral};
use tokio::sync::RwLock;
use tracing::instrument;

const BACKEND_POLICY: &str = include_str!("../../../policy/backend/backend.rego");
const NOT_LOGGED_IN_SUBJECT_ID: &str = "__not_logged_in__";
const CHAT_VIEW_PERMISSION_QUERY_RULE_NAME: &str = "chat_view_permission_query";
const CHAT_VIEW_PERMISSION_QUERY_PLACEHOLDER_CHAT_ID: &str = "__ERATO_CHAT_VIEW_QUERY_CHAT_ID__";
const CHAT_VIEW_PERMISSION_QUERY_PLACEHOLDER_SUBJECT_ID: &str =
    "__ERATO_CHAT_VIEW_QUERY_SUBJECT_ID__";
const CHAT_VIEW_PERMISSION_QUERY_PLACEHOLDER_CHAT_SHARING_ENABLED: &str =
    "__ERATO_CHAT_VIEW_QUERY_CHAT_SHARING_ENABLED__";

#[derive(Debug, FromQueryResult)]
struct PolicyAuthorizationRow {
    allowed: bool,
}

/// Minimal chat attributes required for policy evaluation.
#[derive(Debug, FromQueryResult)]
struct ChatPolicyAttributes {
    id: Uuid,
    owner_user_id: String,
    archived_at: Option<sea_orm::prelude::DateTimeWithTimeZone>,
}

/// Fetch minimal chat data required for policy evaluation.
/// Only queries the `id` and `owner_user_id` fields.
async fn fetch_chat_policy_data(db: &DatabaseConnection) -> Result<JsonValue, Report> {
    let chats: Vec<ChatPolicyAttributes> = chats::Entity::find()
        .select_only()
        .column(chats::Column::Id)
        .column(chats::Column::OwnerUserId)
        .column(chats::Column::ArchivedAt)
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
                "archived_at": chat.archived_at,
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

/// Minimal file upload attributes required for policy evaluation.
#[derive(Debug, FromQueryResult)]
struct FileUploadPolicyAttributes {
    id: Uuid,
    owner_user_id: String,
}

/// Fetch minimal file upload data required for policy evaluation.
/// Only queries the `id` and `owner_user_id` fields.
async fn fetch_file_upload_policy_data(db: &DatabaseConnection) -> Result<JsonValue, Report> {
    let file_uploads_list: Vec<FileUploadPolicyAttributes> = FileUploads::find()
        .select_only()
        .column(file_uploads::Column::Id)
        .column(file_uploads::Column::OwnerUserId)
        .into_model::<FileUploadPolicyAttributes>()
        .all(db)
        .await?;

    let chat_relations: Vec<(Uuid, Uuid)> = ChatFileUploads::find()
        .select_only()
        .column(chat_file_uploads::Column::FileUploadId)
        .column(chat_file_uploads::Column::ChatId)
        .into_tuple::<(Uuid, Uuid)>()
        .all(db)
        .await?;

    let assistant_relations: Vec<(Uuid, Uuid)> = AssistantFileUploads::find()
        .select_only()
        .column(assistant_file_uploads::Column::FileUploadId)
        .column(assistant_file_uploads::Column::AssistantId)
        .into_tuple::<(Uuid, Uuid)>()
        .all(db)
        .await?;

    let mut linked_chat_ids_by_file: HashMap<Uuid, Vec<String>> = HashMap::new();
    for (file_upload_id, chat_id) in chat_relations {
        linked_chat_ids_by_file
            .entry(file_upload_id)
            .or_default()
            .push(chat_id.to_string());
    }

    let mut linked_assistant_ids_by_file: HashMap<Uuid, Vec<String>> = HashMap::new();
    for (file_upload_id, assistant_id) in assistant_relations {
        linked_assistant_ids_by_file
            .entry(file_upload_id)
            .or_default()
            .push(assistant_id.to_string());
    }

    let mut file_upload_attributes = serde_json::Map::new();
    for file_upload in file_uploads_list {
        let id_str = file_upload.id.to_string();
        let linked_chat_ids = linked_chat_ids_by_file
            .get(&file_upload.id)
            .cloned()
            .unwrap_or_default();
        let linked_assistant_ids = linked_assistant_ids_by_file
            .get(&file_upload.id)
            .cloned()
            .unwrap_or_default();
        file_upload_attributes.insert(
            id_str.clone(),
            json!({
                "id": id_str,
                "owner_id": file_upload.owner_user_id,
                "linked_chat_ids": linked_chat_ids,
                "linked_assistant_ids": linked_assistant_ids,
            }),
        );
    }

    Ok(json!(file_upload_attributes))
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

async fn fetch_share_links_policy_data(db: &DatabaseConnection) -> Result<JsonValue, Report> {
    let links: Vec<share_links::Model> = ShareLinks::find().all(db).await?;

    let links_array: Vec<JsonValue> = links
        .into_iter()
        .map(|link| {
            json!({
                "id": link.id.to_string(),
                "resource_type": link.resource_type,
                "resource_id": link.resource_id,
                "enabled": link.enabled,
            })
        })
        .collect();

    Ok(json!(links_array))
}

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
    pub async fn rebuild_data(
        &self,
        db: &DatabaseConnection,
        config: &AppConfig,
    ) -> Result<(), Report> {
        // Fetch policy data for each resource type
        let chat_data = fetch_chat_policy_data(db).await?;
        let assistant_data = fetch_assistant_policy_data(db).await?;
        let file_upload_data = fetch_file_upload_policy_data(db).await?;
        let share_grants_data = fetch_share_grants_policy_data(db).await?;
        let share_links_data = fetch_share_links_policy_data(db).await?;
        let chat_provider_data = config_resources_policy_data(
            if let Some(chat_providers) = config.chat_providers.as_ref() {
                chat_providers.providers.keys().cloned().collect()
            } else if config.chat_provider.is_some() {
                vec!["default".to_string()]
            } else {
                Vec::new()
            },
        );
        let mcp_server_data = config_resources_policy_data(config.mcp_servers.keys().cloned());
        let facet_data =
            config_resources_policy_data(config.experimental_facets.facets.keys().cloned());

        // Combine all resource attributes
        let resource_attributes = json!({
            "chat": chat_data,
            "assistant": assistant_data,
            "file_upload": file_upload_data,
            "chat_provider": chat_provider_data,
            "mcp_server": mcp_server_data,
            "facet": facet_data,
        });
        let policy_data = json!({
            "resource_attributes": resource_attributes,
            "share_grants": share_grants_data,
            "share_links": share_links_data,
            "config": {
                "chat_sharing": {
                    "enabled": config.chat_sharing.enabled,
                },
            },
            "config_permissions": build_config_permissions_policy_data(config),
        });

        self.set_data(policy_data).await?;
        // info!("Finished policy data rebuild");
        Ok(())
    }

    #[instrument(skip_all)]
    pub async fn rebuild_data_if_needed(
        &self,
        db: &DatabaseConnection,
        config: &AppConfig,
    ) -> Result<(), Report> {
        let data_needs_rebuild = { *self.data_needs_rebuild.read().await };
        tracing::trace!(data_needs_rebuild = data_needs_rebuild);
        if data_needs_rebuild {
            self.rebuild_data(db, config).await?;
        }
        Ok(())
    }

    pub async fn rebuild_data_if_needed_req(
        &self,
        db: &DatabaseConnection,
        config: &AppConfig,
    ) -> Result<(), StatusCode> {
        self.rebuild_data_if_needed(db, config).await.map_err(|e| {
            tracing::error!("Failed to rebuild policy data: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })
    }

    fn chat_view_permission_query_template(
        subject_id: &str,
        chat_id: &str,
        chat_sharing_enabled: bool,
    ) -> String {
        BACKEND_POLICY
            // .replace(
            //     CHAT_VIEW_PERMISSION_QUERY_PLACEHOLDER_CHAT_ID,
            //     &format!("\"{chat_id}\""),
            // )
            // .replace(
            //     CHAT_VIEW_PERMISSION_QUERY_PLACEHOLDER_SUBJECT_ID,
            //     &format!("\"{subject_id}\""),
            // )
            .replace(
                "data.config.chat_sharing.enabled",
                &chat_sharing_enabled.to_string(),
            )
    }

    fn rule_name_for_set_head(rule_head: &RuleHead) -> Option<String> {
        match rule_head {
            RuleHead::Set { refr, .. } => match refr.as_ref() {
                Expr::Var { value, .. } => value.as_string().ok().map(|value| value.to_string()),
                Expr::RefDot {
                    refr: inner_refr, ..
                } => match inner_refr.as_ref() {
                    Expr::Var { value, .. } => {
                        value.as_string().ok().map(|value| value.to_string())
                    }
                    _ => None,
                },
                _ => None,
            },
            _ => None,
        }
    }

    fn specialize_postgres_chat_view_permission_sql(sql: String, chat_id: &str) -> String {
        sql.replace(
            &format!("= '{chat_id}'"),
            &format!("= CAST('{chat_id}' AS UUID)"),
        )
        .replace("c.id = sl.resource_id", "c.id = CAST(sl.resource_id AS UUID)")
    }

    fn build_chat_view_permission_query(
        subject_id: &str,
        chat_id: &str,
        chat_sharing_enabled: bool,
        pretty_print: bool,
    ) -> Result<String, Report> {
        let source = Source::from_contents(
            "backend_view_permission_query.rego".to_string(),
            Self::chat_view_permission_query_template(subject_id, chat_id, chat_sharing_enabled),
            // BACKEND_POLICY.to_string()
        )
        .map_err(|err| eyre!(err))?;
        let mut parser = Parser::new(&source).map_err(|err| eyre!(err))?;
        parser.enable_rego_v1().map_err(|err| eyre!(err))?;
        let module = parser.parse().map_err(|err| eyre!(err))?;

        let mut query_rules = Vec::new();
        for rule in &module.policy {
            let rule = rule.as_ref();
            match rule {
                Rule::Spec { head, bodies, .. } => {
                    if Self::rule_name_for_set_head(head).as_deref()
                        == Some(CHAT_VIEW_PERMISSION_QUERY_RULE_NAME)
                    {
                        if bodies.is_empty() {
                            continue;
                        }
                        query_rules.push(rule);
                    }
                }
                Rule::Default { .. } => {}
            }
        }

        if query_rules.is_empty() {
            return Err(eyre!(
                "No '{}' rules found in chat view permission policy",
                CHAT_VIEW_PERMISSION_QUERY_RULE_NAME
            ));
        }

        let mut translated_queries = Vec::with_capacity(query_rules.len());
        for rule in query_rules {
            let mut translator = RegoToSqlIrTranslator::new(None)
                .with_input_binding("resource_id".to_string(), SqlInputValue::Literal(SqlLiteral::String(chat_id.to_string())))
                .with_input_binding("subject_id".to_string(), SqlInputValue::Literal(SqlLiteral::String(subject_id.to_string())));
            let query = translator
                .translate_rule(rule)
                .map_err(|err| eyre!(err))
                .wrap_err("Failed to translate chat view permission rule to SQL")?;
            translated_queries.push(query);
        }

        let mut combined_query =
            translated_queries
                .into_iter()
                .reduce(|mut acc, query| {
                    acc.pipeline.push(SqlOperation::Union(Box::new(query)));
                    acc
                })
                .ok_or_else(|| eyre!("Failed to combine chat view permission SQL rules"))?;

        let optimizer = SqlOptimizer::new();
        let optimized_query = optimizer.optimize(&combined_query);

        let mut generator = SqlCodeGenerator::new()
            .with_dialect(SqlDialect::PostgreSQL)
            .with_pretty_print(pretty_print);

        combined_query = optimized_query;
        Ok(Self::specialize_postgres_chat_view_permission_sql(
            generator.generate(&combined_query),
            chat_id,
        ))
    }

    pub fn build_chat_view_permission_sql(
        &self,
        subject: &Subject,
        chat_id: &str,
        chat_sharing_enabled: bool,
        pretty_print: bool,
    ) -> Result<String, Report> {
        if subject.user_id() == NOT_LOGGED_IN_SUBJECT_ID {
            return Err(eyre!("Anonymous subjects cannot view chats"));
        }

        Self::build_chat_view_permission_query(
            subject.user_id(),
            chat_id,
            chat_sharing_enabled,
            pretty_print,
        )
    }

    /// Example query-based authorization path derived from `data.backend.can_view_chat`.
    pub async fn authorize_chat_view_via_query(
        &self,
        db: &DatabaseConnection,
        config: &AppConfig,
        subject: &Subject,
        chat_id: &str,
    ) -> Result<(), Report> {
        let sql = self.build_chat_view_permission_sql(
            subject,
            chat_id,
            config.chat_sharing.enabled,
            false,
        )?;
        let statement = named_statement_from_string(
            DbBackend::Postgres,
            POSTGRES_QUERY_POLICY_CHAT_VIEW_PERMISSION,
            sql,
        );

        let row = PolicyAuthorizationRow::find_by_statement(statement)
            .one(db)
            .await?;

        if row.is_some_and(|row| row.allowed) {
            Ok(())
        } else {
            Err(eyre!("User is not authorized to view this chat"))
        }
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
            "groups": groups,
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
        (ResourceKind::Chat, Action::Update) => true,
        (ResourceKind::Chat, Action::SubmitMessage) => true,
        (ResourceKind::Chat, Action::Share) => true,
        (ResourceKind::ChatSingleton, Action::Create) => true,
        (ResourceKind::PromptOptimizerSingleton, Action::Create) => true,
        (ResourceKind::MessageFeedback, Action::SubmitFeedback) => true,
        (ResourceKind::Assistant, Action::Read) => true,
        (ResourceKind::Assistant, Action::Update) => true,
        (ResourceKind::Assistant, Action::Share) => true,
        (ResourceKind::FileUpload, Action::Read) => true,
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

    #[test]
    fn test_build_chat_view_permission_sql_pretty_prints_for_specific_user() {
        let engine = PolicyEngine::new();
        let subject = Subject::User("user-123".to_string());
        let chat_id = "00000000-0000-0000-0000-000000000456";
        let sql = engine
            .build_chat_view_permission_sql(&subject, chat_id, true, true)
            .unwrap();

        println!("{sql}");

        assert!(sql.contains("SELECT TRUE AS allowed"));
        assert!(sql.contains("FROM chats"));
        assert!(sql.contains("owner_user_id = 'user-123'"));
        assert!(sql.contains(&format!("CAST('{chat_id}' AS UUID)")));
        assert!(sql.contains("UNION"));
        assert!(sql.contains("JOIN share_links"));
        assert!(sql.contains("CAST(sl.resource_id AS UUID)"));
        assert!(sql.contains("resource_type = 'chat'"));
        assert!(sql.contains("enabled = TRUE"));
    }
}
