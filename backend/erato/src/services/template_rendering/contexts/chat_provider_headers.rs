use sea_orm::prelude::Uuid;
use serde_json::Value;

#[derive(Clone, Copy, Debug)]
pub struct ChatProviderHeadersEratoUserContext<'a> {
    pub id: &'a str,
}

#[derive(Clone, Copy, Debug)]
pub struct ChatProviderHeadersIdTokenContext<'a> {
    pub claims: &'a Value,
}

#[derive(Clone, Copy, Debug)]
pub struct ChatProviderHeadersContext<'a> {
    pub chat_id: Option<Uuid>,
    pub erato_user: ChatProviderHeadersEratoUserContext<'a>,
    pub id_token: ChatProviderHeadersIdTokenContext<'a>,
}

impl<'a> ChatProviderHeadersContext<'a> {
    pub fn with_chat_id(mut self, chat_id: Uuid) -> Self {
        self.chat_id = Some(chat_id);
        self
    }

    pub fn new(erato_user_id: &'a str, id_token_claims: &'a Value) -> Self {
        Self {
            chat_id: None,
            erato_user: ChatProviderHeadersEratoUserContext { id: erato_user_id },
            id_token: ChatProviderHeadersIdTokenContext {
                claims: id_token_claims,
            },
        }
    }
}
