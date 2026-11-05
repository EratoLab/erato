use sea_orm::entity::prelude::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum)]
#[sea_orm(rs_type = "String", db_type = "Text")]
pub enum DeliveryState {
    #[sea_orm(string_value = "pending")]
    Pending,
    #[sea_orm(string_value = "claimed")]
    Claimed,
    #[sea_orm(string_value = "delivered")]
    Delivered,
    #[sea_orm(string_value = "cancelled")]
    Cancelled,
    #[sea_orm(string_value = "snoozed")]
    Snoozed,
    #[sea_orm(string_value = "failed")]
    Failed,
}

impl DeliveryState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Claimed => "claimed",
            Self::Delivered => "delivered",
            Self::Cancelled => "cancelled",
            Self::Snoozed => "snoozed",
            Self::Failed => "failed",
        }
    }

    /// States the executor still takes a row from once it is due.
    pub fn is_open(self) -> bool {
        matches!(self, Self::Pending | Self::Snoozed)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum)]
#[sea_orm(rs_type = "String", db_type = "Text")]
pub enum CreatedBy {
    #[sea_orm(string_value = "system")]
    System,
    #[sea_orm(string_value = "user")]
    User,
}

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "scheduled_deliveries")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub user_id: Uuid,
    #[sea_orm(column_type = "Text")]
    pub kind: String,
    pub due_at: DateTimeWithTimeZone,
    pub created_by: CreatedBy,
    #[sea_orm(column_type = "JsonBinary")]
    pub origin: Json,
    #[sea_orm(column_type = "JsonBinary")]
    pub payload: Json,
    pub state: DeliveryState,
    #[sea_orm(column_type = "Text", nullable)]
    pub claim_token: Option<String>,
    pub claimed_at: Option<DateTimeWithTimeZone>,
    pub delivered_at: Option<DateTimeWithTimeZone>,
    #[sea_orm(column_type = "JsonBinary")]
    pub outcome: Json,
    #[sea_orm(column_type = "Text", nullable)]
    pub dedupe_key: Option<String>,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::users::Entity",
        from = "Column::UserId",
        to = "super::users::Column::Id",
        on_update = "NoAction",
        on_delete = "Cascade"
    )]
    Users,
}

impl Related<super::users::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Users.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
