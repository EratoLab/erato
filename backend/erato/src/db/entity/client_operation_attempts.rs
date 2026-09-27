use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Serialize, Deserialize, ToSchema,
)]
#[sea_orm(rs_type = "String", db_type = "Text")]
#[serde(rename_all = "snake_case")]
pub enum AttemptState {
    #[sea_orm(string_value = "pending")]
    Pending,
    #[sea_orm(string_value = "claimed")]
    Claimed,
    #[sea_orm(string_value = "ready")]
    Ready,
    #[sea_orm(string_value = "continuing")]
    Continuing,
    #[sea_orm(string_value = "completed")]
    Completed,
}

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "client_operation_attempts")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub attempt_id: Uuid,
    pub account_id: Uuid,
    pub chat_id: Uuid,
    pub message_id: Uuid,
    pub tool_call_id: String,
    pub generation_id: Uuid,
    pub request: Json,
    pub state: AttemptState,
    pub claim_token: Option<Uuid>,
    pub claim_binding: Option<Json>,
    pub claim_expires_at: Option<DateTimeWithTimeZone>,
    pub result: Option<Json>,
    pub validated_result: Option<Json>,
    pub expires_at: DateTimeWithTimeZone,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: DateTimeWithTimeZone,
}
#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
impl ActiveModelBehavior for ActiveModel {}
