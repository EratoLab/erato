use sea_orm::entity::prelude::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum)]
#[sea_orm(rs_type = "String", db_type = "Text")]
pub enum ItemStatus {
    #[sea_orm(string_value = "active")]
    Active,
    #[sea_orm(string_value = "ended")]
    Ended,
    #[sea_orm(string_value = "cancelled")]
    Cancelled,
}

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "scheduled_items")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub user_id: Uuid,
    #[sea_orm(column_type = "Text")]
    pub kind: String,
    #[sea_orm(column_type = "Text")]
    pub name: String,
    #[sea_orm(column_type = "Text")]
    pub message: String,
    pub linked_chat_id: Option<Uuid>,
    #[sea_orm(column_type = "Text")]
    pub channel: String,
    #[sea_orm(column_type = "JsonBinary")]
    pub trigger: Json,
    #[sea_orm(column_type = "Text")]
    pub time_zone: String,
    pub status: ItemStatus,
    pub occurrence_at: Option<DateTimeWithTimeZone>,
    pub occurrence_count: i32,
    #[sea_orm(column_type = "JsonBinary")]
    pub origin: Json,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::chats::Entity",
        from = "Column::LinkedChatId",
        to = "super::chats::Column::Id",
        on_update = "NoAction",
        on_delete = "SetNull"
    )]
    Chats,
    #[sea_orm(
        belongs_to = "super::users::Entity",
        from = "Column::UserId",
        to = "super::users::Column::Id",
        on_update = "NoAction",
        on_delete = "Cascade"
    )]
    Users,
}

impl Related<super::chats::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Chats.def()
    }
}

impl Related<super::users::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Users.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
