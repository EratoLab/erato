use serde::{Deserialize, Serialize};
use synonym::Synonym;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all_fields = "lowercase")]
pub enum SubjectKind {
    User,
}

#[derive(Synonym)]
pub struct SubjectId(pub String);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Subject {
    User(String),
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
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy)]
pub enum ResourceKind {
    #[serde(rename = "chat")]
    Chat,
    #[serde(rename = "chat_singleton")]
    ChatSingleton,
}

#[derive(Synonym)]
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
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy)]
pub enum Action {
    #[serde(rename = "read")]
    Read,
    #[serde(rename = "create")]
    Create,
}
