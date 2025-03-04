use sea_orm::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "chats_latest_message")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub chat_id: Uuid,
    pub latest_message_id: Uuid,
    pub latest_message_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "crate::db::entity::chats::Entity",
        from = "Column::ChatId",
        to = "crate::db::entity::chats::Column::Id",
        on_update = "NoAction",
        on_delete = "NoAction"
    )]
    Chats,
}

impl Related<crate::db::entity::chats::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Chats.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
