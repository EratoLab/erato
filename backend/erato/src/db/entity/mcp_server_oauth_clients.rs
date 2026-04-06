//! `SeaORM` Entity, hand-written to match the Sqitch schema.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "mcp_server_oauth_clients")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false, column_type = "Text")]
    pub mcp_server_id: String,
    #[sea_orm(column_type = "Text")]
    pub client_id: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub client_secret_encrypted: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub redirect_uri: String,
    #[sea_orm(column_type = "JsonBinary", nullable)]
    pub registration_metadata: Option<Json>,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
