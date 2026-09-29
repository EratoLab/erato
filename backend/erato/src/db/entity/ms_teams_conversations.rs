use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "ms_teams_conversations")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    #[sea_orm(column_type = "Text")]
    pub conversation_id: String,
    #[sea_orm(column_type = "Text")]
    pub conversation_type: String,
    pub user_id: Uuid,
    pub current_chat_id: Option<Uuid>,
    #[sea_orm(column_type = "Text")]
    pub service_url: String,
    #[sea_orm(column_type = "Text")]
    pub ms_teams_user_id: String,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
