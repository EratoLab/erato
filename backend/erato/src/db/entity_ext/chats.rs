use sea_orm::entity::prelude::*;

pub use super::super::entity::chats::ActiveModel;
pub use super::super::entity::chats::Column;
pub use super::super::entity::chats::ColumnIter;
pub use super::super::entity::chats::Entity;
pub use super::super::entity::chats::Model;
pub use super::super::entity::chats::PrimaryKey;
pub use super::super::entity::chats::PrimaryKeyIter;

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::messages::Entity")]
    Messages,
    #[sea_orm(has_one = "super::chats_latest_message::Entity")]
    ChatsLatestMessage,
}

impl Related<super::chats_latest_message::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::ChatsLatestMessage.def()
    }
}
