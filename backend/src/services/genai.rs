use crate::models::message::{ContentPart, GenerationInputMessages, InputMessage, MessageRole};
use genai::chat::ChatRequest;
use genai::chat::ChatRole as GenAiChatRole;
use genai::chat::MessageContent as GenAiMessageContent;
use genai::chat::{ChatMessage, ToolResponse};

impl From<ContentPart> for GenAiMessageContent {
    fn from(content: ContentPart) -> Self {
        match content {
            ContentPart::Text(text) => GenAiMessageContent::Text(text.into()),
            ContentPart::ToolUse(tool_use) => {
                GenAiMessageContent::ToolResponses(vec![ToolResponse {
                    call_id: tool_use.tool_call_id,
                    content: serde_json::to_string(&tool_use.output)
                        .expect("Failed to serialize tool output"),
                }])
            }
        }
    }
}

impl InputMessage {
    pub fn into_chat_message(self) -> ChatMessage {
        match self.role {
            MessageRole::System => ChatMessage::system(self.content),
            MessageRole::User => ChatMessage::user(self.content),
            MessageRole::Assistant => ChatMessage::assistant(self.content),
            MessageRole::Tool => ChatMessage {
                role: GenAiChatRole::Tool,
                content: self.content.into(),
                options: None,
            },
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
