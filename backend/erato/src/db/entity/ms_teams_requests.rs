use sea_orm::entity::prelude::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum)]
#[sea_orm(rs_type = "String", db_type = "Text")]
pub enum RequestState {
    #[sea_orm(string_value = "preparing")]
    Preparing,
    #[sea_orm(string_value = "running")]
    Running,
    #[sea_orm(string_value = "stopping")]
    Stopping,
    #[sea_orm(string_value = "stopped")]
    Stopped,
    #[sea_orm(string_value = "failed")]
    Failed,
    #[sea_orm(string_value = "completed")]
    Completed,
}

impl RequestState {
    pub fn is_active(self) -> bool {
        matches!(self, Self::Preparing | Self::Running | Self::Stopping)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum)]
#[sea_orm(rs_type = "String", db_type = "Text")]
pub enum ActionKind {
    #[sea_orm(string_value = "retry")]
    Retry,
    #[sea_orm(string_value = "edit")]
    Edit,
}

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "ms_teams_requests")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub conversation_id: String,
    pub source_activity_id: String,
    pub user_id: Uuid,
    pub chat_id: Uuid,
    pub user_message_id: Option<Uuid>,
    pub assistant_message_id: Option<Uuid>,
    pub control_activity_id: Option<String>,
    pub state: RequestState,
    pub tools_started: bool,
    pub native_stop_available: bool,
    pub pending_edit: Option<String>,
    pub last_edit_at: Option<DateTimeWithTimeZone>,
    pub action_token: Option<Uuid>,
    pub action_kind: Option<ActionKind>,
    pub action_expires_at: Option<DateTimeWithTimeZone>,
    pub run_id: Uuid,
    pub claimed_action_token: Option<Uuid>,
    pub controls_version: i64,
    pub controls_lease_owner: Option<Uuid>,
    pub controls_lease_until: Option<DateTimeWithTimeZone>,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
