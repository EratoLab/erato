use crate::models::message::{GenerationInputMessages, InputMessage, MessageContent, MessageRole};
use genai::chat::ChatMessage;
use genai::chat::ChatRequest;
use genai::chat::MessageContent as GenAiMessageContent;

impl From<MessageContent> for GenAiMessageContent {
    fn from(content: MessageContent) -> Self {
        match content {
            MessageContent::String(text) => GenAiMessageContent::Text(text),
            MessageContent::Array(texts) => GenAiMessageContent::Text(texts.join(" ")),
        }
    }
}

impl InputMessage {
    pub fn into_chat_message(self) -> ChatMessage {
        match self.role {
            MessageRole::System => ChatMessage::system(self.content),
            MessageRole::User => ChatMessage::user(self.content),
            MessageRole::Assistant => ChatMessage::assistant(self.content),
        }
    }
}

impl GenerationInputMessages {
    pub fn into_chat_request(self) -> ChatRequest {
        let messages = self
            .messages
            .into_iter()
            .map(InputMessage::into_chat_message)
            .collect();
        ChatRequest {
            messages,
            ..Default::default()
        }
    }
}
