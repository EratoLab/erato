//! Durable native delegation jobs and their application states.
use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(
    Clone,
    Copy,
    Debug,
    PartialEq,
    Eq,
    EnumIter,
    DeriveActiveEnum,
    Serialize,
    Deserialize,
    utoipa::ToSchema,
)]
#[sea_orm(rs_type = "String", db_type = "Text")]
#[serde(rename_all = "snake_case")]
pub enum JobState {
    #[sea_orm(string_value = "waiting_for_local_result")]
    WaitingForLocalResult,
    #[sea_orm(string_value = "awaiting_authenticated_resume")]
    AwaitingAuthenticatedResume,
    #[sea_orm(string_value = "continuing")]
    Continuing,
    #[sea_orm(string_value = "completed")]
    Completed,
    #[sea_orm(string_value = "cancelled")]
    Cancelled,
    #[sea_orm(string_value = "expired")]
    Expired,
}
/// Shared by persistence, generation recovery and chat liveness queries.
pub const ACTIVE_JOB_STATES_SQL: &str =
    "'waiting_for_local_result','awaiting_authenticated_resume','continuing'";

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "local_delegation_jobs")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub owner_user_id: String,
    pub chat_id: Uuid,
    pub message_id: Uuid,
    pub tool_call_id: String,
    pub attempt_id: Uuid,
    pub task_id: String,
    pub plan: Json,
    pub checkpoint: Json,
    pub binding: Option<Json>,
    pub origin: Option<String>,
    pub state: JobState,
    pub generation_id: Option<Uuid>,
    pub approved_export: Option<Json>,
    pub server_outcome: Option<Json>,
    pub receipt: Option<String>,
    pub export_id: Option<String>,
    pub manifest_digest: Option<String>,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: DateTimeWithTimeZone,
    pub expires_at: DateTimeWithTimeZone,
    pub accepted_at: Option<DateTimeWithTimeZone>,
}
#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::chats::Entity",
        from = "Column::ChatId",
        to = "super::chats::Column::Id",
        on_delete = "Cascade"
    )]
    Chats,
    #[sea_orm(
        belongs_to = "super::messages::Entity",
        from = "Column::MessageId",
        to = "super::messages::Column::Id",
        on_delete = "Cascade"
    )]
    Messages,
}
impl Related<super::chats::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Chats.def()
    }
}
impl Related<super::messages::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Messages.def()
    }
}
impl ActiveModelBehavior for ActiveModel {}
