use crate::models::message::{ContentPart, GenerationInputMessages, InputMessage, MessageRole};
use eyre::Result;
use genai::chat::ChatRequest;
use genai::chat::ChatRole as GenAiChatRole;
use genai::chat::MessageContent as GenAiMessageContent;
use genai::chat::{ChatMessage, ToolResponse};
use serde_json::{Value as JsonValue, json};
use std::sync::Arc;

impl From<ContentPart> for GenAiMessageContent {
    fn from(content: ContentPart) -> Self {
        match content {
            ContentPart::Text(text) => GenAiMessageContent::from_text(text),
            ContentPart::ToolUse(tool_use) => {
                GenAiMessageContent::from_parts(vec![genai::chat::ContentPart::ToolResponse(
                    ToolResponse {
                        call_id: tool_use.tool_call_id,
                        content: serde_json::to_string(&tool_use.output)
                            .expect("Failed to serialize tool output"),
                    },
                )])
            }
            ContentPart::TextFilePointer(_) => {
                // This should never happen after resolve_file_pointers_in_generation_input
                // Log error and return empty text
                tracing::error!(
                    "TextFilePointer found during LLM conversion - should have been resolved"
                );
                GenAiMessageContent::from_text(String::new())
            }
            ContentPart::ImageFilePointer(_) => {
                // This should never happen after resolve_file_pointers_in_generation_input
                // Log error and return empty text
                tracing::error!(
                    "ImageFilePointer found during LLM conversion - should have been resolved"
                );
                GenAiMessageContent::from_text(String::new())
            }
            ContentPart::Image(image) => {
                // Convert our Image content part to genai's binary content
                let binary_part = genai::chat::ContentPart::from_binary_base64(
                    image.content_type,
                    Arc::from(image.base64_data.as_str()),
                    None,
                );
                GenAiMessageContent::from_parts(vec![binary_part])
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

/// OpenAI-compatible request parts for normalization
#[derive(Debug, Clone)]
pub struct OpenAIRequestParts {
    pub messages: Vec<JsonValue>,
    pub tools: Option<Vec<JsonValue>>,
}

/// Convert a ChatRequest into OpenAI-compatible request parts for normalization
/// Adapted from rust-genai's OpenAI adapter implementation
pub fn into_openai_request_parts(chat_req: &ChatRequest) -> Result<OpenAIRequestParts> {
    let mut messages: Vec<JsonValue> = Vec::new();

    // -- Process the system message if present
    if let Some(system_msg) = &chat_req.system {
        messages.push(json!({"role": "system", "content": system_msg}));
    }

    // -- Process the messages
    for msg in &chat_req.messages {
        match msg.role {
            GenAiChatRole::System => {
                if let Some(text) = msg.content.first_text() {
                    messages.push(json!({"role": "system", "content": text}));
                }
            }
            GenAiChatRole::User => {
                // Skip tool calls and responses in user messages for normalization
                if msg.content.contains_tool_call() || msg.content.contains_tool_response() {
                    continue;
                }

                let content = if msg.content.is_text_only() {
                    // Simple text content
                    msg.content
                        .first_text()
                        .map(|text| json!(text))
                        .unwrap_or(json!(""))
                } else {
                    // Multi-part content
                    json!(
                        msg.content
                            .parts()
                            .iter()
                            .filter_map(|part| match part {
                                genai::chat::ContentPart::Text(text) => {
                                    Some(json!({"type": "text", "text": text.clone()}))
                                }
                                // For now, skip other content types as they're not in our current model
                                _ => None,
                            })
                            .collect::<Vec<JsonValue>>()
                    )
                };
                messages.push(json!({"role": "user", "content": content}));
            }
            GenAiChatRole::Assistant => {
                let tool_calls = msg.content.tool_calls();
                if !tool_calls.is_empty() {
                    let tool_calls_json = tool_calls
                        .iter()
                        .map(|tool_call| {
                            json!({
                                "type": "function",
                                "id": tool_call.call_id,
                                "function": {
                                    "name": tool_call.fn_name,
                                    "arguments": tool_call.fn_arguments.to_string(),
                                }
                            })
                        })
                        .collect::<Vec<JsonValue>>();
                    messages.push(json!({
                        "role": "assistant",
                        "tool_calls": tool_calls_json,
                        "content": ""
                    }));
                } else if let Some(text) = msg.content.first_text() {
                    messages.push(json!({"role": "assistant", "content": text}));
                }
                // Skip other content types for normalization
            }
            GenAiChatRole::Tool => {
                let tool_responses = msg.content.tool_responses();
                for tool_response in tool_responses {
                    messages.push(json!({
                        "role": "tool",
                        "content": tool_response.content,
                        "tool_call_id": tool_response.call_id,
                    }));
                }
            }
        }
    }

    // -- Process the tools
    let tools = chat_req.tools.as_ref().map(|tools| {
        tools
            .iter()
            .map(|tool| {
                json!({
                    "type": "function",
                    "function": {
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.schema.clone().unwrap_or_else(|| json!({})),
                        "strict": false,
                    }
                })
            })
            .collect::<Vec<JsonValue>>()
    });

    Ok(OpenAIRequestParts { messages, tools })
}
