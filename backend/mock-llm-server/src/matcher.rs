use colored::Colorize;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Static response configuration with chunks and delay
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StaticResponseConfig {
    /// The chunks to send in the streaming response
    pub chunks: Vec<String>,
    /// Delay between chunks in milliseconds
    pub delay_ms: u64,
    /// Optional initial delay before sending the first chunk (in milliseconds)
    /// If None, uses delay_ms for all chunks
    #[serde(default)]
    pub initial_delay_ms: Option<u64>,
}

/// Tool call response configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallResponseConfig {
    /// The tool name to call
    pub tool_name: String,
    /// The arguments as a JSON string
    pub arguments: String,
    /// Delay before sending the tool call (in milliseconds)
    #[serde(default)]
    pub delay_ms: u64,
}

/// Single tool call definition for multiple tool calls
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallDef {
    /// The tool name to call
    pub tool_name: String,
    /// The arguments as a JSON string
    pub arguments: String,
}

/// Multiple tool calls response configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallsResponseConfig {
    /// The tool calls to make
    pub tool_calls: Vec<ToolCallDef>,
    /// Delay before sending the tool calls (in milliseconds)
    #[serde(default)]
    pub delay_ms: u64,
}

/// Error response configuration (non-streaming)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorResponseConfig {
    /// HTTP status code to return
    pub status_code: u16,
    /// JSON error body to return
    pub body: Value,
}

/// Configuration for a response to return when a pattern matches
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ResponseConfig {
    /// Static response with predefined chunks
    Static(StaticResponseConfig),
    /// Tool call response (single tool call)
    ToolCall(ToolCallResponseConfig),
    /// Multiple tool calls response (parallel tool calls)
    ToolCalls(ToolCallsResponseConfig),
    /// Error response with status code and JSON body
    Error(ErrorResponseConfig),
}

/// Match rule that checks user message pattern using substring matching
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchRuleUserMessagePattern {
    /// Pattern to match (substring matching)
    pub pattern: String,
}

/// Match rule that checks if the last message is a user message with a pattern
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchRuleLastMessageIsUserWithPattern {
    /// Pattern to match (substring matching)
    pub pattern: String,
}

/// A rule that matches incoming messages
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MatchRule {
    /// Match based on user message pattern (looks at last user message anywhere in conversation)
    UserMessagePattern(MatchRuleUserMessagePattern),
    /// Match when the last message in the conversation is a tool result
    LastMessageIsToolResult,
    /// Match when the last message is a user message with a specific pattern
    LastMessageIsUserWithPattern(MatchRuleLastMessageIsUserWithPattern),
}

/// A mock with metadata, match rules, and response
#[derive(Debug, Clone)]
pub struct Mock {
    /// Name of the mock for identification
    pub name: String,
    /// Description of what this mock does
    pub description: String,
    /// Match rules to determine if this mock should be used
    pub match_rules: Vec<MatchRule>,
    /// Response configuration to use when matched
    pub response: ResponseConfig,
}

impl Mock {
    /// Print a summary of this mock for startup display
    pub fn print_summary(&self) {
        println!("  [{}]", self.name);
        println!("    {}: {}", "Description".bold(), self.description);

        // Print match rules
        if self.match_rules.len() == 1 {
            print!("    {}: ", "Match rule".bold());
            if let Some(rule) = self.match_rules.first() {
                match rule {
                    MatchRule::UserMessagePattern(pattern_rule) => {
                        println!("contains text \"{}\"", pattern_rule.pattern);
                    }
                    MatchRule::LastMessageIsToolResult => {
                        println!("last message is a tool result");
                    }
                    MatchRule::LastMessageIsUserWithPattern(pattern_rule) => {
                        println!(
                            "last message is user with text \"{}\"",
                            pattern_rule.pattern
                        );
                    }
                }
            }
        } else {
            println!("    {}:", "Match rules".bold());
            for rule in &self.match_rules {
                match rule {
                    MatchRule::UserMessagePattern(pattern_rule) => {
                        println!("      - contains text \"{}\"", pattern_rule.pattern);
                    }
                    MatchRule::LastMessageIsToolResult => {
                        println!("      - last message is a tool result");
                    }
                    MatchRule::LastMessageIsUserWithPattern(pattern_rule) => {
                        println!(
                            "      - last message is user with text \"{}\"",
                            pattern_rule.pattern
                        );
                    }
                }
            }
        }

        // Print response info
        match &self.response {
            ResponseConfig::Static(config) => {
                if let Some(initial_delay) = config.initial_delay_ms {
                    println!(
                        "    {}: {} chunks with {}ms initial delay, then {}ms between chunks",
                        "Response".bold(),
                        config.chunks.len(),
                        initial_delay,
                        config.delay_ms
                    );
                } else {
                    println!(
                        "    {}: {} chunks with {}ms delay",
                        "Response".bold(),
                        config.chunks.len(),
                        config.delay_ms
                    );
                }
            }
            ResponseConfig::ToolCall(config) => {
                println!(
                    "    {}: Tool call to '{}' with {}ms delay",
                    "Response".bold(),
                    config.tool_name,
                    config.delay_ms
                );
            }
            ResponseConfig::ToolCalls(config) => {
                println!(
                    "    {}: {} parallel tool calls with {}ms delay",
                    "Response".bold(),
                    config.tool_calls.len(),
                    config.delay_ms
                );
                for tool_call in &config.tool_calls {
                    println!("      - {}", tool_call.tool_name);
                }
            }
            ResponseConfig::Error(config) => {
                println!(
                    "    {}: error response with status {}",
                    "Response".bold(),
                    config.status_code
                );
            }
        }
        println!();
    }
}

/// Matcher that finds the appropriate response for a chat request
pub struct Matcher {
    mocks: Vec<Mock>,
    default_response: ResponseConfig,
}

impl Matcher {
    /// Create a new matcher with the given mocks
    pub fn new(mocks: Vec<Mock>) -> Self {
        let default_response = ResponseConfig::Static(StaticResponseConfig {
            chunks: vec![
                "I".to_string(),
                " don't".to_string(),
                " have".to_string(),
                " a".to_string(),
                " specific".to_string(),
                " response".to_string(),
                " for".to_string(),
                " that".to_string(),
                ".".to_string(),
            ],
            delay_ms: 50,
            ..Default::default()
        });

        Self {
            mocks,
            default_response,
        }
    }

    /// Match a chat request and return the appropriate response config
    pub fn match_request(
        &self,
        request: &ChatCompletionRequest,
        request_id: &str,
    ) -> ResponseConfig {
        // Try to find a matching mock
        for mock in &self.mocks {
            if self.matches_any_rule(&mock.match_rules, request) {
                crate::log::log_with_id(request_id, &format!("Matched mock: {}", mock.name));
                return mock.response.clone();
            }
        }

        crate::log::log_with_id(request_id, "No match found, using default response");
        self.default_response.clone()
    }

    /// Check if any of the match rules match the request
    fn matches_any_rule(&self, rules: &[MatchRule], request: &ChatCompletionRequest) -> bool {
        for rule in rules {
            match rule {
                MatchRule::UserMessagePattern(pattern_rule) => {
                    if let Some(last_user_message) = self.extract_last_user_message(request) {
                        if last_user_message
                            .to_lowercase()
                            .contains(&pattern_rule.pattern.to_lowercase())
                        {
                            return true;
                        }
                    }
                }
                MatchRule::LastMessageIsToolResult => {
                    if self.is_last_message_tool_result(request) {
                        return true;
                    }
                }
                MatchRule::LastMessageIsUserWithPattern(pattern_rule) => {
                    if self.is_last_message_user_with_pattern(request, &pattern_rule.pattern) {
                        return true;
                    }
                }
            }
        }
        false
    }

    /// Check if the last message is a user message with a specific pattern
    fn is_last_message_user_with_pattern(
        &self,
        request: &ChatCompletionRequest,
        pattern: &str,
    ) -> bool {
        if let Some(last_message) = request.messages.last() {
            if last_message.role == "user" {
                if let Some(content) = &last_message.content {
                    let text = self.extract_content_text(content);
                    return text.to_lowercase().contains(&pattern.to_lowercase());
                }
            }
        }
        false
    }

    /// Check if the last message in the request is a tool result
    fn is_last_message_tool_result(&self, request: &ChatCompletionRequest) -> bool {
        if let Some(last_message) = request.messages.last() {
            return last_message.role == "tool";
        }
        false
    }

    /// Extract the last user message from the request
    fn extract_last_user_message(&self, request: &ChatCompletionRequest) -> Option<String> {
        // Iterate through messages in reverse to find the last user message
        for message in request.messages.iter().rev() {
            if message.role == "user" {
                if let Some(content) = &message.content {
                    return Some(self.extract_content_text(content));
                }
            }
        }
        None
    }

    /// Extract text content from a message content field
    /// Handles both string and array formats
    fn extract_content_text(&self, content: &Value) -> String {
        match content {
            Value::String(s) => s.clone(),
            Value::Array(parts) => {
                // Extract text from content parts array
                parts
                    .iter()
                    .filter_map(|part| {
                        if let Some(obj) = part.as_object() {
                            if obj.get("type")?.as_str()? == "text" {
                                return obj.get("text")?.as_str().map(|s| s.to_string());
                            }
                        }
                        None
                    })
                    .collect::<Vec<_>>()
                    .join(" ")
            }
            _ => String::new(),
        }
    }
}

/// OpenAI chat completion request structure
#[derive(Debug, Deserialize)]
pub struct ChatCompletionRequest {
    pub messages: Vec<Message>,
    #[serde(default)]
    pub stream: bool,
    #[serde(default)]
    pub model: Option<String>,
}

/// A message in the chat completion request
#[derive(Debug, Deserialize)]
pub struct Message {
    pub role: String,
    #[serde(default)]
    pub content: Option<Value>,
}

/// Image generation mock configuration
#[derive(Debug, Clone)]
pub struct ImageMock {
    /// Name of the mock for identification
    pub name: String,
    /// Description of what this mock does
    pub description: String,
    /// Pattern to match in the prompt (case-insensitive substring matching)
    pub pattern: String,
    /// Base64 encoded image data to return
    pub image_base64: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_matcher_exact_match() {
        let mocks = vec![Mock {
            name: "Test".to_string(),
            description: "Test mock".to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: "hello".to_string(),
            })],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec!["Hi".to_string(), " there".to_string()],
                delay_ms: 100,
                ..Default::default()
            }),
        }];

        let matcher = Matcher::new(mocks);

        let request: ChatCompletionRequest = serde_json::from_value(json!({
            "messages": [
                {"role": "user", "content": "hello world"}
            ],
            "stream": true
        }))
        .unwrap();

        let response = matcher.match_request(&request, "test0001");
        match response {
            ResponseConfig::Static(config) => {
                assert_eq!(config.chunks, vec!["Hi", " there"]);
            }
            _ => panic!("Expected Static response"),
        }
    }

    #[test]
    fn test_matcher_case_insensitive() {
        let mocks = vec![Mock {
            name: "Test".to_string(),
            description: "Test mock".to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: "HELLO".to_string(),
            })],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec!["Hi".to_string()],
                delay_ms: 100,
                ..Default::default()
            }),
        }];

        let matcher = Matcher::new(mocks);

        let request: ChatCompletionRequest = serde_json::from_value(json!({
            "messages": [
                {"role": "user", "content": "hello world"}
            ]
        }))
        .unwrap();

        let response = matcher.match_request(&request, "test0002");
        match response {
            ResponseConfig::Static(config) => {
                assert_eq!(config.chunks, vec!["Hi"]);
            }
            _ => panic!("Expected Static response"),
        }
    }

    #[test]
    fn test_matcher_no_match_uses_default() {
        let mocks = vec![Mock {
            name: "Test".to_string(),
            description: "Test mock".to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: "specific".to_string(),
            })],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec!["Specific".to_string()],
                delay_ms: 100,
                ..Default::default()
            }),
        }];

        let matcher = Matcher::new(mocks);

        let request: ChatCompletionRequest = serde_json::from_value(json!({
            "messages": [
                {"role": "user", "content": "something else"}
            ]
        }))
        .unwrap();

        let response = matcher.match_request(&request, "test0003");
        match response {
            ResponseConfig::Static(config) => {
                assert!(!config.chunks.is_empty());
                assert_eq!(config.delay_ms, 50);
            }
            _ => panic!("Expected Static response"),
        }
    }

    #[test]
    fn test_extract_last_user_message() {
        let matcher = Matcher::new(vec![]);

        let request: ChatCompletionRequest = serde_json::from_value(json!({
            "messages": [
                {"role": "system", "content": "You are a helpful assistant"},
                {"role": "user", "content": "First message"},
                {"role": "assistant", "content": "Response"},
                {"role": "user", "content": "Second message"}
            ]
        }))
        .unwrap();

        let last_msg = matcher.extract_last_user_message(&request);
        assert_eq!(last_msg, Some("Second message".to_string()));
    }

    #[test]
    fn test_mock_with_multiple_match_rules() {
        let mocks = vec![Mock {
            name: "Greeting".to_string(),
            description: "Responds to multiple greeting patterns".to_string(),
            match_rules: vec![
                MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                    pattern: "hello".to_string(),
                }),
                MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                    pattern: "hi".to_string(),
                }),
                MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                    pattern: "hey".to_string(),
                }),
            ],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec!["Greetings!".to_string()],
                delay_ms: 50,
                ..Default::default()
            }),
        }];

        let matcher = Matcher::new(mocks);

        // Test first pattern
        let request1: ChatCompletionRequest = serde_json::from_value(json!({
            "messages": [{"role": "user", "content": "hello there"}]
        }))
        .unwrap();
        let response1 = matcher.match_request(&request1, "test0004");
        match response1 {
            ResponseConfig::Static(config) => {
                assert_eq!(config.chunks, vec!["Greetings!"]);
            }
            _ => panic!("Expected Static response"),
        }

        // Test second pattern
        let request2: ChatCompletionRequest = serde_json::from_value(json!({
            "messages": [{"role": "user", "content": "hi friend"}]
        }))
        .unwrap();
        let response2 = matcher.match_request(&request2, "test0005");
        match response2 {
            ResponseConfig::Static(config) => {
                assert_eq!(config.chunks, vec!["Greetings!"]);
            }
            _ => panic!("Expected Static response"),
        }

        // Test third pattern
        let request3: ChatCompletionRequest = serde_json::from_value(json!({
            "messages": [{"role": "user", "content": "hey buddy"}]
        }))
        .unwrap();
        let response3 = matcher.match_request(&request3, "test0006");
        match response3 {
            ResponseConfig::Static(config) => {
                assert_eq!(config.chunks, vec!["Greetings!"]);
            }
            _ => panic!("Expected Static response"),
        }
    }

    #[test]
    fn test_mock_metadata() {
        let mock = Mock {
            name: "Test Mock".to_string(),
            description: "A test mock for unit testing".to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: "test".to_string(),
            })],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec!["Test response".to_string()],
                delay_ms: 100,
                ..Default::default()
            }),
        };

        assert_eq!(mock.name, "Test Mock");
        assert_eq!(mock.description, "A test mock for unit testing");
        assert_eq!(mock.match_rules.len(), 1);
    }

    #[test]
    fn test_response_config_enum_variant() {
        let config = ResponseConfig::Static(StaticResponseConfig {
            chunks: vec!["Test".to_string()],
            delay_ms: 50,
            ..Default::default()
        });

        match config {
            ResponseConfig::Static(static_config) => {
                assert_eq!(static_config.chunks, vec!["Test"]);
                assert_eq!(static_config.delay_ms, 50);
            }
            _ => panic!("Expected Static response"),
        }
    }

    #[test]
    fn test_match_rule_enum_variant() {
        let rule = MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
            pattern: "test".to_string(),
        });

        match rule {
            MatchRule::UserMessagePattern(pattern_rule) => {
                assert_eq!(pattern_rule.pattern, "test");
            }
            _ => panic!("Expected UserMessagePattern"),
        }
    }

    #[test]
    fn test_print_summary_single_rule() {
        let mock = Mock {
            name: "Test Mock".to_string(),
            description: "A test mock".to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: "hello".to_string(),
            })],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec!["Hi".to_string()],
                delay_ms: 50,
                ..Default::default()
            }),
        };

        // This test just ensures print_summary doesn't panic
        // In a real scenario, you'd capture stdout to verify the output
        mock.print_summary();
    }

    #[test]
    fn test_print_summary_multiple_rules() {
        let mock = Mock {
            name: "Multi-Pattern Mock".to_string(),
            description: "A mock with multiple patterns".to_string(),
            match_rules: vec![
                MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                    pattern: "hello".to_string(),
                }),
                MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                    pattern: "hi".to_string(),
                }),
                MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                    pattern: "hey".to_string(),
                }),
            ],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec!["Greetings!".to_string()],
                delay_ms: 50,
                ..Default::default()
            }),
        };

        // This test just ensures print_summary doesn't panic with multiple rules
        mock.print_summary();
    }
}
