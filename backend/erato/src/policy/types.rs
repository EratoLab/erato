use serde::{Deserialize, Serialize};
use synonym::Synonym;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SubjectKind {
    User,
}

#[derive(Synonym, Serialize)]
pub struct SubjectId(pub String);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Subject {
    User(String),
    UserWithOrganizationInfo {
        id: String,
        organization_user_id: Option<String>,
        organization_group_ids: Vec<String>,
    },
}

impl From<&Subject> for Subject {
    fn from(val: &Subject) -> Self {
        val.clone()
    }
}

impl Subject {
    pub fn into_parts(self) -> (SubjectKind, SubjectId) {
        match self {
            Subject::User(id) => (SubjectKind::User, SubjectId(id)),
            Subject::UserWithOrganizationInfo { id, .. } => (SubjectKind::User, SubjectId(id)),
        }
    }

    pub fn user_id(&self) -> &str {
        match self {
            Subject::User(id) => id,
            Subject::UserWithOrganizationInfo { id, .. } => id,
        }
    }

    pub fn organization_user_id(&self) -> Option<&str> {
        match self {
            Subject::User(_) => None,
            Subject::UserWithOrganizationInfo {
                organization_user_id,
                ..
            } => organization_user_id.as_deref(),
        }
    }

    pub fn organization_group_ids(&self) -> &[String] {
        match self {
            Subject::User(_) => &[],
            Subject::UserWithOrganizationInfo {
                organization_group_ids,
                ..
            } => organization_group_ids,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy)]
pub enum ResourceKind {
    #[serde(rename = "chat")]
    Chat,
    #[serde(rename = "chat_singleton")]
    ChatSingleton,
    #[serde(rename = "message")]
    Message,
    #[serde(rename = "message_feedback")]
    MessageFeedback,
    #[serde(rename = "assistant")]
    Assistant,
    #[serde(rename = "assistant_singleton")]
    AssistantSingleton,
    #[serde(rename = "share_grant")]
    ShareGrant,
}

#[derive(Synonym, Serialize)]
pub struct ResourceId(pub String);

impl ResourceId {
    pub fn singleton() -> Self {
        ResourceId("__singleton__".to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Resource {
    Chat(String),
    ChatSingleton,
    Message(String),
    MessageFeedback(String),
    Assistant(String),
    AssistantSingleton,
    ShareGrant(String),
}

impl From<&Resource> for Resource {
    fn from(val: &Resource) -> Self {
        val.clone()
    }
}

impl Resource {
    pub fn into_parts(self) -> (ResourceKind, ResourceId) {
        match self {
            Resource::Chat(id) => (ResourceKind::Chat, ResourceId(id)),
            Resource::ChatSingleton => (ResourceKind::ChatSingleton, ResourceId::singleton()),
            Resource::Message(id) => (ResourceKind::Message, ResourceId(id)),
            Resource::MessageFeedback(id) => (ResourceKind::MessageFeedback, ResourceId(id)),
            Resource::Assistant(id) => (ResourceKind::Assistant, ResourceId(id)),
            Resource::AssistantSingleton => {
                (ResourceKind::AssistantSingleton, ResourceId::singleton())
            }
            Resource::ShareGrant(id) => (ResourceKind::ShareGrant, ResourceId(id)),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy)]
pub enum Action {
    #[serde(rename = "read")]
    Read,
    #[serde(rename = "create")]
    Create,
    #[serde(rename = "update")]
    Update,
    #[serde(rename = "submit_message")]
    SubmitMessage,
    #[serde(rename = "submit_feedback")]
    SubmitFeedback,
    #[serde(rename = "delete")]
    Delete,
    #[serde(rename = "share")]
    Share,
}
