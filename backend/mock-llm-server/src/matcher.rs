use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Configuration for a response to return when a pattern matches
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResponseConfig {
    /// The chunks to send in the streaming response
    pub chunks: Vec<String>,
    /// Delay between chunks in milliseconds
    pub delay_ms: u64,
}

/// A rule that matches incoming messages and provides a response
#[derive(Debug, Clone)]
pub struct MatchRule {
    /// Pattern to match (substring matching)
    pub pattern: String,
    /// Response configuration to use when matched
    pub response: ResponseConfig,
}

/// Matcher that finds the appropriate response for a chat request
pub struct Matcher {
    rules: Vec<MatchRule>,
    default_response: ResponseConfig,
}

impl Matcher {
    /// Create a new matcher with the given rules
    pub fn new(rules: Vec<MatchRule>) -> Self {
        let default_response = ResponseConfig {
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
        };

        Self {
            rules,
            default_response,
        }
    }

    /// Match a chat request and return the appropriate response config
    pub fn match_request(
        &self,
        request: &ChatCompletionRequest,
        request_id: &str,
    ) -> ResponseConfig {
        // Extract the last user message
        if let Some(last_user_message) = self.extract_last_user_message(request) {
            crate::log::log_with_id(
                request_id,
                &format!("Matching against message: {}", last_user_message),
            );

            // Try to find a matching rule
            for rule in &self.rules {
                if last_user_message
                    .to_lowercase()
                    .contains(&rule.pattern.to_lowercase())
                {
                    crate::log::log_with_id(
                        request_id,
                        &format!("Matched pattern: {}", rule.pattern),
                    );
                    return rule.response.clone();
                }
            }
        }

        crate::log::log_with_id(request_id, "No match found, using default response");
        self.default_response.clone()
    }

    /// Extract the last user message from the request
    fn extract_last_user_message(&self, request: &ChatCompletionRequest) -> Option<String> {
        // Iterate through messages in reverse to find the last user message
        for message in request.messages.iter().rev() {
            if message.role == "user" {
                return Some(self.extract_content_text(&message.content));
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
    pub content: Value,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_matcher_exact_match() {
        let rules = vec![MatchRule {
            pattern: "hello".to_string(),
            response: ResponseConfig {
                chunks: vec!["Hi".to_string(), " there".to_string()],
                delay_ms: 100,
            },
        }];

        let matcher = Matcher::new(rules);

        let request: ChatCompletionRequest = serde_json::from_value(json!({
            "messages": [
                {"role": "user", "content": "hello world"}
            ],
            "stream": true
        }))
        .unwrap();

        let response = matcher.match_request(&request, "test0001");
        assert_eq!(response.chunks, vec!["Hi", " there"]);
    }

    #[test]
    fn test_matcher_case_insensitive() {
        let rules = vec![MatchRule {
            pattern: "HELLO".to_string(),
            response: ResponseConfig {
                chunks: vec!["Hi".to_string()],
                delay_ms: 100,
            },
        }];

        let matcher = Matcher::new(rules);

        let request: ChatCompletionRequest = serde_json::from_value(json!({
            "messages": [
                {"role": "user", "content": "hello world"}
            ]
        }))
        .unwrap();

        let response = matcher.match_request(&request, "test0002");
        assert_eq!(response.chunks, vec!["Hi"]);
    }

    #[test]
    fn test_matcher_no_match_uses_default() {
        let rules = vec![MatchRule {
            pattern: "specific".to_string(),
            response: ResponseConfig {
                chunks: vec!["Specific".to_string()],
                delay_ms: 100,
            },
        }];

        let matcher = Matcher::new(rules);

        let request: ChatCompletionRequest = serde_json::from_value(json!({
            "messages": [
                {"role": "user", "content": "something else"}
            ]
        }))
        .unwrap();

        let response = matcher.match_request(&request, "test0003");
        assert!(!response.chunks.is_empty());
        assert_eq!(response.delay_ms, 50);
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
}
