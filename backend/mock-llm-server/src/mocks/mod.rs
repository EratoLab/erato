use crate::image_data;
use crate::matcher::{
    CiteFilesResponseConfig, ErrorResponseConfig, ImageMock, MatchRule,
    MatchRuleAnyUserMessageInCurrentTurnWithPattern, MatchRuleLastMessageIsUserWithPattern,
    MatchRuleUserMessagePattern, Mock, ResponseConfig, StaticResponseConfig, ToolCallDef,
    ToolCallResponseConfig, ToolCallsResponseConfig,
};
use serde_json::json;

/// Generate chunks for a long running response with second-by-second progress
fn generate_long_running_chunks(seconds: usize) -> Vec<String> {
    let mut chunks = Vec::with_capacity(seconds);
    for i in 1..=seconds {
        if i == 1 {
            chunks.push(format!("Second {} passed\n", i));
        } else if i == seconds {
            chunks.push(format!("Second {} passed. Complete!\n", i));
        } else {
            chunks.push(format!("Second {} passed\n", i));
        }
    }
    chunks
}

/// Get the default set of configured mocks
pub fn get_default_mocks() -> Vec<Mock> {
    vec![
        Mock {
            name: "CiteFiles".to_string(),
            description:
                "Lists erato-file links from all request messages when any user message in the current turn asks to cite files"
                    .to_string(),
            match_rules: vec![MatchRule::AnyUserMessageInCurrentTurnWithPattern(
                MatchRuleAnyUserMessageInCurrentTurnWithPattern {
                    pattern: "cite files".to_string(),
                },
            )],
            response: ResponseConfig::CiteFiles(CiteFilesResponseConfig { delay_ms: 50 }),
        },
        Mock {
            name: "Greeting".to_string(),
            description: "Responds to hello messages with a friendly greeting".to_string(),
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
                chunks: vec![
                    "Hello".to_string(),
                    "!".to_string(),
                    " How".to_string(),
                    " can".to_string(),
                    " I".to_string(),
                    " help".to_string(),
                    " you".to_string(),
                    " today".to_string(),
                    "?".to_string(),
                ],
                delay_ms: 50,
                ..Default::default()
            }),
        },
        Mock {
            name: "Weather".to_string(),
            description: "Provides weather information when asked".to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: "weather".to_string(),
            })],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec![
                    "The".to_string(),
                    " weather".to_string(),
                    " is".to_string(),
                    " sunny".to_string(),
                    " and".to_string(),
                    " warm".to_string(),
                    " today".to_string(),
                    ".".to_string(),
                ],
                delay_ms: 75,
                ..Default::default()
            }),
        },
        Mock {
            name: "Test".to_string(),
            description: "Test response for development and debugging".to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: "test".to_string(),
            })],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec![
                    "This".to_string(),
                    " is".to_string(),
                    " a".to_string(),
                    " test".to_string(),
                    " response".to_string(),
                    " from".to_string(),
                    " the".to_string(),
                    " mock".to_string(),
                    " server".to_string(),
                    ".".to_string(),
                ],
                delay_ms: 100,
                ..Default::default()
            }),
        },
        Mock {
            name: "Slow".to_string(),
            description: "Demonstrates slow streaming with high delay".to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: "slow".to_string(),
            })],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec![
                    "This".to_string(),
                    " response".to_string(),
                    " will".to_string(),
                    " be".to_string(),
                    " delivered".to_string(),
                    " very".to_string(),
                    " slowly".to_string(),
                    "...".to_string(),
                ],
                delay_ms: 500,
                ..Default::default()
            }),
        },
        Mock {
            name: "Fast".to_string(),
            description: "Demonstrates fast streaming with minimal delay".to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: "fast".to_string(),
            })],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec![
                    "Quick".to_string(),
                    " response".to_string(),
                    "!".to_string(),
                ],
                delay_ms: 10,
                ..Default::default()
            }),
        },
        Mock {
            name: "Delay".to_string(),
            description: "Demonstrates delayed response with 5 second wait before first chunk"
                .to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: "delay".to_string(),
            })],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec![
                    "After".to_string(),
                    " waiting".to_string(),
                    " for".to_string(),
                    " 5".to_string(),
                    " seconds".to_string(),
                    ",".to_string(),
                    " here".to_string(),
                    " is".to_string(),
                    " your".to_string(),
                    " response".to_string(),
                    ".".to_string(),
                    " This".to_string(),
                    " demonstrates".to_string(),
                    " how".to_string(),
                    " the".to_string(),
                    " system".to_string(),
                    " handles".to_string(),
                    " delayed".to_string(),
                    " streaming".to_string(),
                    " responses".to_string(),
                    " with".to_string(),
                    " medium".to_string(),
                    "-sized".to_string(),
                    " text".to_string(),
                    " content".to_string(),
                    ".".to_string(),
                ],
                delay_ms: 20,
                initial_delay_ms: Some(5000),
            }),
        },
        Mock {
            name: "LongRunning".to_string(),
            description: "Demonstrates very long streaming response (90 seconds)".to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: "long running".to_string(),
            })],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: generate_long_running_chunks(90),
                delay_ms: 1000,
                ..Default::default()
            }),
        },
        Mock {
            name: "ContentFilterError".to_string(),
            description: "Returns an OpenAI-style content filter error response".to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: "erotic".to_string(),
                },
            )],
            response: ResponseConfig::Error(ErrorResponseConfig {
                status_code: 400,
                body: json!({
                    "error": {
                        "code": "content_filter",
                        "message": "The response was filtered due to the prompt triggering content management policy.",
                        "innererror": {
                            "content_filter_result": {
                                "sexual": { "filtered": true, "severity": "medium" },
                                "violence": { "filtered": false, "severity": "low" },
                                "hate": { "filtered": false, "severity": "safe" },
                                "self_harm": { "filtered": false, "severity": "safe" }
                            }
                        }
                    }
                }),
            }),
        },
        Mock {
            name: "RateLimitError".to_string(),
            description: "Returns an OpenAI-style rate limit error response".to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: "rate limit".to_string(),
                },
            )],
            response: ResponseConfig::Error(ErrorResponseConfig {
                status_code: 429,
                body: json!({
                    "error": {
                        "code": "429",
                        "message": "Requests to the ChatCompletions_Create Operation under Azure OpenAI API version 2024-06-01 have exceeded call rate limit of your current OpenAI S0 pricing tier. Please retry after 8 seconds. Please go here: https://aka.ms/oai/quotaincrease if you would like to further increase the default rate limit. For Free Account customers, upgrade to Pay as you Go here: https://aka.ms/429TrialUpgrade."
                    }
                }),
            }),
        },
        Mock {
            name: "ReadSecretToolCall".to_string(),
            description: "Returns a tool call to read_text_file when last message is user asking to read secret"
                .to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: "read secret".to_string(),
                },
            )],
            response: ResponseConfig::ToolCall(ToolCallResponseConfig {
                tool_name: "read_text_file".to_string(),
                arguments: r#"{"path":"./secret.txt"}"#.to_string(),
                delay_ms: 100,
            }),
        },
        Mock {
            name: "GenerateCatMcpToolCall".to_string(),
            description:
                "Returns a tool call to generate_image when last message asks for generate cat mcp"
                    .to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: "generate cat mcp".to_string(),
                },
            )],
            response: ResponseConfig::ToolCall(ToolCallResponseConfig {
                tool_name: "generate_image".to_string(),
                arguments: r#"{"prompt":"A cute cat, studio lighting","num_images":1,"width":1024,"height":1024}"#
                    .to_string(),
                delay_ms: 100,
            }),
        },
        Mock {
            name: "TriggerMcpContentFilterToolCall".to_string(),
            description:
                "Returns a tool call to trigger_content_filter when last message asks for mcp content filter"
                    .to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: "mcp content filter".to_string(),
                },
            )],
            response: ResponseConfig::ToolCall(ToolCallResponseConfig {
                tool_name: "trigger_content_filter".to_string(),
                arguments: "{}".to_string(),
                delay_ms: 100,
            }),
        },
        Mock {
            name: "ToolResultResponse".to_string(),
            description: "Returns a text response when the last message is a tool result"
                .to_string(),
            match_rules: vec![MatchRule::LastMessageIsToolResult],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec![
                    "The".to_string(),
                    " secret".to_string(),
                    " content".to_string(),
                    " has".to_string(),
                    " been".to_string(),
                    " read".to_string(),
                    " successfully".to_string(),
                    ".".to_string(),
                ],
                delay_ms: 50,
                ..Default::default()
            }),
        },
        Mock {
            name: "ReadMultipleSecretsToolCalls".to_string(),
            description:
                "Returns multiple parallel tool calls to read secret.txt and secret2.txt"
                    .to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: "read multiple secrets".to_string(),
                },
            )],
            response: ResponseConfig::ToolCalls(ToolCallsResponseConfig {
                tool_calls: vec![
                    ToolCallDef {
                        tool_name: "read_text_file".to_string(),
                        arguments: r#"{"path":"/Users/hobofan/hobofan/erato/erato/backend/erato/tests/mcp-files/secret.txt"}"#
                            .to_string(),
                    },
                    ToolCallDef {
                        tool_name: "read_text_file".to_string(),
                        arguments: r#"{"path":"/Users/hobofan/hobofan/erato/erato/backend/erato/tests/mcp-files/secret2.txt"}"#
                            .to_string(),
                    },
                ],
                delay_ms: 100,
            }),
        },
    ]
}

/// Get the default set of configured image mocks
pub fn get_default_image_mocks() -> Vec<ImageMock> {
    vec![ImageMock {
        name: "Cat Image".to_string(),
        description: "Returns a cat image when prompt contains 'cat'".to_string(),
        pattern: "cat".to_string(),
        image_base64: image_data::CAT_IMAGE_BASE64.to_string(),
    }]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_default_image_mocks_count() {
        let image_mocks = get_default_image_mocks();

        // Verify we have the expected number of image mocks
        assert_eq!(image_mocks.len(), 1);

        // Verify all image mocks have names
        for mock in &image_mocks {
            assert!(!mock.name.is_empty());
            assert!(!mock.description.is_empty());
            assert!(!mock.pattern.is_empty());
            assert!(!mock.image_base64.is_empty());
        }
    }
}
