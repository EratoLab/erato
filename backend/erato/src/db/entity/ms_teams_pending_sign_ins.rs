use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "ms_teams_pending_sign_ins")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub bot_app_id: String,
    pub tenant_id: String,
    pub connection_name: String,
    pub conversation_id: String,
    pub ms_teams_user_id: String,
    pub entra_object_id: String,
    pub source_conversation_id: String,
    pub source_activity_id: String,
    pub exchange_id: Option<String>,
    pub activity: Option<Json>,
    pub created_at: DateTimeWithTimeZone,
    pub expires_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
