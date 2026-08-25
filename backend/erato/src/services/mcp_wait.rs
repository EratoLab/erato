//! Synthetic wait tool for MCP servers that expose deferred results.

use genai::chat::{Tool, ToolName};
use serde_json::{Value, json};

pub const WAIT_TOOL_NAME: &str = "wait";

pub fn build_wait_tool(max_wait_seconds: u64, omit_tool_strict: bool) -> Tool {
    Tool {
        name: ToolName::Custom(WAIT_TOOL_NAME.to_string()),
        description: Some(
            "Wait for the requested number of seconds before continuing. Use this when an MCP "
                .to_string()
                + "tool reports that its deferred result is not ready yet. Also use this directly "
                + "after receiving a tool result from an MCP tool that indicates that the result "
                + "may need to be polled. If the initial MCP tool triggering pollable work doesn't "
                + "indicate a timeframe, wait for 5 seconds.",
        ),
        schema: Some(json!({
            "type": "object",
            "properties": {
                "seconds": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": max_wait_seconds,
                    "description": "Number of seconds to wait before continuing.",
                }
            },
            "required": ["seconds"],
            "additionalProperties": false,
        })),
        strict: if omit_tool_strict { None } else { Some(false) },
        config: None,
    }
}

pub fn parse_wait_seconds(input: &Value, max_wait_seconds: u64) -> Result<u64, String> {
    let seconds = input
        .get("seconds")
        .and_then(Value::as_u64)
        .ok_or_else(|| "missing required integer field 'seconds'".to_string())?;
    if seconds == 0 {
        return Err("'seconds' must be at least 1".to_string());
    }
    if seconds > max_wait_seconds {
        return Err(format!(
            "'seconds' must be at most {max_wait_seconds} for this deployment"
        ));
    }
    Ok(seconds)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_bounded_wait_tool() {
        let tool = build_wait_tool(30, false);
        assert_eq!(tool.name.to_string(), WAIT_TOOL_NAME);
        assert_eq!(tool.schema.unwrap()["properties"]["seconds"]["maximum"], 30);
    }

    #[test]
    fn parses_and_bounds_wait_seconds() {
        assert_eq!(parse_wait_seconds(&json!({"seconds": 5}), 10), Ok(5));
        assert!(parse_wait_seconds(&json!({"seconds": 0}), 10).is_err());
        assert!(parse_wait_seconds(&json!({"seconds": 11}), 10).is_err());
        assert!(parse_wait_seconds(&json!({"seconds": 1.5}), 10).is_err());
    }
}
