//! Native binding and durable receipt extension; lifecycle belongs to attempts.
use sea_orm::entity::prelude::*;
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "local_evidence_exports")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub attempt_id: Uuid,
    pub binding: Json,
    pub origin: String,
    pub plan: Json,
    pub receipt: Option<String>,
    pub export_id: Option<String>,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: DateTimeWithTimeZone,
}
#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
impl ActiveModelBehavior for ActiveModel {}
