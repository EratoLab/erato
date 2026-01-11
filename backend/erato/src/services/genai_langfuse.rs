use crate::models::message::ContentPart;
use crate::services::genai::into_openai_request_parts;
use crate::services::langfuse::{CreateTraceRequest, FinishGenerationRequest, TracingLangfuseClient, Usage};
use chrono::{DateTime, Utc};
use eyre::Result;
use genai::chat::{ChatRequest, Usage as GenAiUsage};
use sea_orm::prelude::Uuid;
use serde_json::{Value as JsonValue, json};
use std::time::SystemTime;

/// Helper to create Langfuse FinishGenerationRequest from genai components
pub struct LangfuseGenerationBuilder {
    observation_id: String,
    trace_id: String,
    name: Option<String>,
    model: Option<String>,
    start_time: Option<SystemTime>,
    end_time: Option<SystemTime>,
    completion_start_time: Option<SystemTime>,
    environment: Option<String>,
}

impl LangfuseGenerationBuilder {
    pub fn new(observation_id: String, trace_id: String) -> Self {
        Self {
            observation_id,
            trace_id,
            name: None,
            model: None,
            start_time: None,
            end_time: None,
            completion_start_time: None,
            environment: None,
        }
    }

    pub fn with_name(mut self, name: String) -> Self {
        self.name = Some(name);
        self
    }

    pub fn with_model(mut self, model: String) -> Self {
        self.model = Some(model);
        self
    }

    pub fn with_start_time(mut self, start_time: SystemTime) -> Self {
        self.start_time = Some(start_time);
        self
    }

    pub fn with_end_time(mut self, end_time: SystemTime) -> Self {
        self.end_time = Some(end_time);
        self
    }

    pub fn with_completion_start_time(mut self, completion_start_time: SystemTime) -> Self {
        self.completion_start_time = Some(completion_start_time);
        self
    }

    pub fn with_environment(mut self, environment: String) -> Self {
        self.environment = Some(environment);
        self
    }

    /// Build the FinishGenerationRequest from ChatRequest input and ContentPart output
    pub fn build(
        self,
        chat_request: &ChatRequest,
        output_content: &[ContentPart],
        usage: Option<&GenAiUsage>,
    ) -> Result<FinishGenerationRequest> {
        // Convert input to normalized OpenAI format
        let input_parts = into_openai_request_parts(chat_request)?;
        let input_json = json!({
            "messages": input_parts.messages,
            "tools": input_parts.tools
        });

        // Convert output ContentPart to JSON
        let output_json = convert_content_parts_to_json(output_content)?;

        // Convert usage information
        let langfuse_usage = usage.map(convert_genai_usage_to_langfuse_usage);

        // Convert timestamps to ISO 8601 strings
        let start_time_str = self.start_time.map(system_time_to_iso_string);
        let end_time_str = self.end_time.map(system_time_to_iso_string);
        let completion_start_time_str = self.completion_start_time.map(system_time_to_iso_string);

        Ok(FinishGenerationRequest {
            observation_id: self.observation_id,
            trace_id: self.trace_id,
            name: self.name,
            start_time: start_time_str,
            end_time: end_time_str,
            completion_start_time: completion_start_time_str,
            model: self.model,
            model_parameters: None, // Could be extended to include temperature, max_tokens, etc.
            input: Some(input_json),
            output: Some(output_json),
            usage: langfuse_usage,
            metadata: None,
            level: None, // Will default to "DEFAULT"
            status_message: None,
            parent_observation_id: None,
            version: None,
            environment: self.environment,
        })
    }
}

/// Convert our ContentPart array to JSON representation for Langfuse output
pub fn convert_content_parts_to_json(content_parts: &[ContentPart]) -> Result<JsonValue> {
    let mut output_parts = Vec::new();

    for part in content_parts {
        match part {
            ContentPart::Text(text_part) => {
                output_parts.push(json!({
                    "type": "text",
                    "text": text_part.text
                }));
            }
            ContentPart::ToolUse(tool_use) => {
                output_parts.push(json!({
                    "type": "tool_use",
                    "tool_call_id": tool_use.tool_call_id,
                    "tool_name": tool_use.tool_name,
                    "status": tool_use.status,
                    "input": tool_use.input,
                    "output": tool_use.output,
                    "progress_message": tool_use.progress_message
                }));
            }
            ContentPart::TextFilePointer(file_pointer) => {
                output_parts.push(json!({
                    "type": "text_file_pointer",
                    "file_upload_id": file_pointer.file_upload_id.to_string()
                }));
            }
            ContentPart::ImageFilePointer(file_pointer) => {
                output_parts.push(json!({
                    "type": "image_file_pointer",
                    "file_upload_id": file_pointer.file_upload_id.to_string()
                }));
            }
            ContentPart::Image(image) => {
                output_parts.push(json!({
                    "type": "image",
                    "content_type": image.content_type,
                    // Truncate base64 data for logging to avoid huge log entries
                    "base64_data_length": image.base64_data.len()
                }));
            }
        }
    }

    Ok(json!({
        "content": output_parts
    }))
}

/// Convert genai Usage to Langfuse Usage
fn convert_genai_usage_to_langfuse_usage(genai_usage: &GenAiUsage) -> Usage {
    Usage {
        input: genai_usage.prompt_tokens,
        output: genai_usage.completion_tokens,
        total: genai_usage.total_tokens,
        unit: Some("TOKENS".to_string()),
        input_cost: None, // Cost information not available in current genai Usage
        output_cost: None,
        total_cost: None,
    }
}

/// Convert SystemTime to ISO 8601 string
fn system_time_to_iso_string(time: SystemTime) -> String {
    let datetime: DateTime<Utc> = time.into();
    datetime.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Convenience function to generate unique observation and trace IDs
pub fn generate_langfuse_ids() -> (String, String) {
    let observation_id = format!("obs_{}", Uuid::new_v4().simple());
    let trace_id = format!("trace_{}", Uuid::new_v4().simple());
    (observation_id, trace_id)
}

/// Create a simple generation name from the first user message
pub fn generate_name_from_chat_request(chat_request: &ChatRequest) -> Option<String> {
    // Look for the first user message and extract a short name from it
    for message in &chat_request.messages {
        if matches!(message.role, genai::chat::ChatRole::User)
            && let genai::chat::MessageContent::Text(text) = &message.content
        {
            // Take first 50 characters and clean up for a name
            let name = text
                .chars()
                .take(50)
                .collect::<String>()
                .trim()
                .replace('\n', " ")
                .replace('\r', "");

            if !name.is_empty() {
                return Some(name);
            }
        }
    }

    // Fallback to a generic name
    Some("chat_completion".to_string())
}

/// Create a Langfuse trace request from a chat request
pub fn create_trace_request_from_chat(
    trace_id: String,
    chat_request: &ChatRequest,
    user_id: Option<String>,
    session_id: Option<String>,
    environment: Option<String>,
) -> Result<CreateTraceRequest> {
    // Generate a name for the trace from the first user message
    let name = generate_name_from_chat_request(chat_request);

    // Convert input to normalized OpenAI format for the trace
    let input_parts = into_openai_request_parts(chat_request)?;
    let input_json = json!({
        "messages": input_parts.messages,
        "tools": input_parts.tools
    });

    Ok(CreateTraceRequest {
        id: trace_id,
        name,
        user_id,
        session_id,
        release: None,
        environment,
        input: Some(input_json),
        output: None, // Will be set when the trace is completed
        metadata: None,
        tags: None,
        public: None,
    })
}

/// Builder for creating generations using TracingLangfuseClient
///
/// This builder simplifies creating generations by using metadata stored in TracingLangfuseClient.
pub struct TracedGenerationBuilder {
    observation_id: String,
    name: Option<String>,
    model: Option<String>,
    start_time: Option<SystemTime>,
    end_time: Option<SystemTime>,
    completion_start_time: Option<SystemTime>,
}

impl TracedGenerationBuilder {
    pub fn new(observation_id: String) -> Self {
        Self {
            observation_id,
            name: None,
            model: None,
            start_time: None,
            end_time: None,
            completion_start_time: None,
        }
    }

    pub fn with_name(mut self, name: String) -> Self {
        self.name = Some(name);
        self
    }

    pub fn with_model(mut self, model: String) -> Self {
        self.model = Some(model);
        self
    }

    pub fn with_start_time(mut self, start_time: SystemTime) -> Self {
        self.start_time = Some(start_time);
        self
    }

    pub fn with_end_time(mut self, end_time: SystemTime) -> Self {
        self.end_time = Some(end_time);
        self
    }

    pub fn with_completion_start_time(mut self, completion_start_time: SystemTime) -> Self {
        self.completion_start_time = Some(completion_start_time);
        self
    }

    /// Build and send the generation to Langfuse using the TracingLangfuseClient
    pub async fn build_and_send(
        self,
        tracing_client: &TracingLangfuseClient,
        chat_request: &ChatRequest,
        output_content: &[ContentPart],
        usage: Option<&GenAiUsage>,
    ) -> Result<()> {
        // Convert input to normalized OpenAI format
        let input_parts = into_openai_request_parts(chat_request)?;
        let input_json = json!({
            "messages": input_parts.messages,
            "tools": input_parts.tools
        });

        // Convert output ContentPart to JSON
        let output_json = convert_content_parts_to_json(output_content)?;

        // Convert usage information
        let langfuse_usage = usage.map(convert_genai_usage_to_langfuse_usage);

        // Convert timestamps to ISO 8601 strings
        let start_time_str = self.start_time.map(system_time_to_iso_string);
        let end_time_str = self.end_time.map(system_time_to_iso_string);
        let completion_start_time_str = self.completion_start_time.map(system_time_to_iso_string);

        tracing_client
            .create_generation(
                self.observation_id,
                self.name,
                start_time_str,
                end_time_str,
                completion_start_time_str,
                self.model,
                None, // model_parameters
                Some(input_json),
                Some(output_json),
                langfuse_usage,
                None, // metadata
                None, // level
                None, // status_message
                None, // parent_observation_id
                None, // version
            )
            .await
    }
}

/// Create a trace in Langfuse using TracingLangfuseClient with a chat request
pub async fn create_trace_from_chat(
    tracing_client: &TracingLangfuseClient,
    chat_request: &ChatRequest,
) -> Result<()> {
    // Generate a name for the trace from the first user message
    let name = generate_name_from_chat_request(chat_request);

    // Convert input to normalized OpenAI format for the trace
    let input_parts = into_openai_request_parts(chat_request)?;
    let input_json = json!({
        "messages": input_parts.messages,
        "tools": input_parts.tools
    });

    tracing_client
        .create_trace(
            name,
            Some(input_json),
            None, // metadata
            None, // tags
        )
        .await
}

/// Create both trace and generation in a single batch using TracingLangfuseClient
pub async fn create_trace_with_generation_from_chat(
    tracing_client: &TracingLangfuseClient,
    observation_id: String,
    chat_request: &ChatRequest,
    output_content: &[ContentPart],
    usage: Option<&GenAiUsage>,
    model: Option<String>,
    generation_name: Option<String>,
    start_time: Option<SystemTime>,
    end_time: Option<SystemTime>,
    completion_start_time: Option<SystemTime>,
) -> Result<()> {
    // Generate a name for the trace from the first user message
    let trace_name = generate_name_from_chat_request(chat_request);

    // Convert input to normalized OpenAI format
    let input_parts = into_openai_request_parts(chat_request)?;
    let input_json = json!({
        "messages": input_parts.messages,
        "tools": input_parts.tools
    });

    // Convert output ContentPart to JSON
    let output_json = convert_content_parts_to_json(output_content)?;

    // Convert usage information
    let langfuse_usage = usage.map(convert_genai_usage_to_langfuse_usage);

    // Convert timestamps to ISO 8601 strings
    let start_time_str = start_time.map(system_time_to_iso_string);
    let end_time_str = end_time.map(system_time_to_iso_string);
    let completion_start_time_str = completion_start_time.map(system_time_to_iso_string);

    tracing_client
        .create_trace_with_generation(
            trace_name,
            Some(input_json.clone()),
            None, // trace_metadata
            None, // trace_tags
            observation_id,
            generation_name,
            start_time_str,
            end_time_str,
            completion_start_time_str,
            model,
            None, // model_parameters
            Some(input_json),
            Some(output_json),
            langfuse_usage,
            None, // generation_metadata
            None, // level
            None, // status_message
            None, // parent_observation_id
            None, // version
        )
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::message::{ContentPartText, ToolCallStatus, ToolUse};
    use genai::chat::ChatMessage;
    use serde_json::json;

    #[test]
    fn test_generate_langfuse_ids() {
        let (obs_id, trace_id) = generate_langfuse_ids();
        assert!(obs_id.starts_with("obs_"));
        assert!(trace_id.starts_with("trace_"));
        assert_ne!(obs_id, trace_id);
    }

    #[test]
    fn test_convert_content_parts_to_json() {
        let content_parts = vec![
            ContentPart::Text(ContentPartText {
                text: "Hello world".to_string(),
            }),
            ContentPart::ToolUse(ToolUse {
                tool_call_id: "call_123".to_string(),
                status: ToolCallStatus::Success,
                tool_name: "test_tool".to_string(),
                progress_message: None,
                input: Some(json!({"param": "value"})),
                output: Some(json!({"result": "success"})),
            }),
        ];

        let result = convert_content_parts_to_json(&content_parts).unwrap();
        let expected = json!({
            "content": [
                {
                    "type": "text",
                    "text": "Hello world"
                },
                {
                    "type": "tool_use",
                    "tool_call_id": "call_123",
                    "tool_name": "test_tool",
                    "status": "success",
                    "input": {"param": "value"},
                    "output": {"result": "success"},
                    "progress_message": null
                }
            ]
        });

        assert_eq!(result, expected);
    }

    #[test]
    fn test_generate_name_from_chat_request() {
        let chat_request = ChatRequest {
            messages: vec![
                ChatMessage::system("You are a helpful assistant"),
                ChatMessage::user("What is the capital of France?"),
            ],
            ..Default::default()
        };

        let name = generate_name_from_chat_request(&chat_request);
        assert_eq!(name, Some("What is the capital of France?".to_string()));
    }

    #[test]
    fn test_convert_genai_usage_to_langfuse_usage() {
        let genai_usage = GenAiUsage {
            prompt_tokens: Some(10),
            prompt_tokens_details: None,
            completion_tokens: Some(20),
            completion_tokens_details: None,
            total_tokens: Some(30),
        };

        let langfuse_usage = convert_genai_usage_to_langfuse_usage(&genai_usage);
        assert_eq!(langfuse_usage.input, Some(10));
        assert_eq!(langfuse_usage.output, Some(20));
        assert_eq!(langfuse_usage.total, Some(30));
        assert_eq!(langfuse_usage.unit, Some("TOKENS".to_string()));
        assert_eq!(langfuse_usage.input_cost, None);
        assert_eq!(langfuse_usage.output_cost, None);
        assert_eq!(langfuse_usage.total_cost, None);
    }
}
