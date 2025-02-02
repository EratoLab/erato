use serde::{Deserialize, Serialize};
use synonym::Synonym;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all_fields = "lowercase")]
pub enum SubjectKind {
    User,
}

#[derive(Synonym)]
pub struct SubjectId(String);

#[derive(Debug, Serialize, Deserialize, Clone, Copy)]
pub enum ResourceKind {
    #[serde(rename = "chat")]
    Chat,
    #[serde(rename = "chat_singleton")]
    ChatSingleton,
}

#[derive(Synonym)]
pub struct ResourceId(String);

#[derive(Debug, Serialize, Deserialize, Clone, Copy)]
pub enum Action {
    #[serde(rename = "read")]
    Read,
    #[serde(rename = "create")]
    Create,
}
