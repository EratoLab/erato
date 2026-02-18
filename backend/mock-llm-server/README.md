# Mock LLM Server

A standalone mock server for testing LLM integrations with multiple OpenAI-compatible streaming endpoints.

## Overview

This mock server provides HTTP endpoints that simulate LLM APIs with configurable responses and delays. All endpoints are nested under `/base-openai` to allow for future support of other API standards.

## Features

- **Multiple Endpoints**: Chat completions, embeddings, and image generation
- **Streaming Support**: SSE-based streaming responses with configurable delays
- **Pattern Matching**: Match incoming messages using substring matching
- **Configurable Responses**: Pre-defined responses with customizable chunks and delays

## Endpoints

### Health Check
```
GET /health
```

Returns server status.

### Chat Completions
```
POST /base-openai/v1/chat/completions
```

Accepts OpenAI-compatible chat completion requests and returns streaming SSE responses.

**Request Example:**
```json
{
  "messages": [
    {"role": "user", "content": "hello"}
  ],
  "stream": true
}
```

### Embeddings
```
POST /base-openai/v1/embeddings
```

Returns mock embedding vectors for input text.

**Request Example:**
```json
{
  "input": "text to embed",
  "model": "text-embedding-ada-002"
}
```

### Image Generation
```
POST /base-openai/v1/images/generations
```

Returns mock base64-encoded images.

**Request Example:**
```json
{
  "prompt": "A test image",
  "n": 1
}
```

## Running the Server

### Default Configuration

```bash
cargo run
```

Server will start on `127.0.0.1:44320` by default.

### Custom Host/Port

```bash
HOST=0.0.0.0 PORT=3000 cargo run
```

### With Debug Logging

```bash
RUST_LOG=debug cargo run
```

## Mocks

The server comes with pre-configured mocks:

| Name | Description | Pattern(s) | Response | Delay |
|------|-------------|-----------|----------|-------|
| Greeting | Responds to hello messages | "hello", "hi", "hey" | Friendly greeting | 50ms |
| Weather | Provides weather information | "weather" | Weather information | 75ms |
| Test | Test response for development | "test" | Test response | 100ms |
| Slow | Demonstrates slow streaming | "slow" | Slow streaming response | 500ms |
| Fast | Demonstrates fast streaming | "fast" | Quick response | 10ms |
| Delay | Demonstrates delayed response | "delay" | Medium-sized text | 5000ms (5s) |
| LongRunning | Demonstrates very long streaming | "long running" or "long running 30" | Countdown for requested seconds (default 90s) | 1000ms (1s) |
| TriggerMcpContentFilterToolCall | Triggers MCP content-filter error flow | "mcp content filter" | Tool call to `trigger_content_filter` | 100ms |
| (default) | Fallback when no match | - | Generic response | 50ms |

Each mock has:
- **Name**: Identifier for the mock
- **Description**: What the mock does
- **Match Rules**: One or more patterns to match (case-insensitive substring matching on the last user message)
- **Response**: Static response configuration with chunks and delay

## Testing with curl

### Chat Completion
```bash
curl -X POST http://localhost:44320/base-openai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "hello"}],
    "stream": true
  }'
```

### Embeddings
```bash
curl -X POST http://localhost:44320/base-openai/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{
    "input": "test string",
    "model": "text-embedding-ada-002"
  }'
```

### Image Generation
```bash
curl -X POST http://localhost:44320/base-openai/v1/images/generations \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A test image",
    "n": 1
  }'
```

## Architecture

The server is built with:
- **Axum**: Web framework
- **Tokio**: Async runtime
- **Tower-HTTP**: HTTP middleware (tracing, CORS)

The codebase is organized into:
- `matcher.rs`: Message matching logic with substring patterns and Mock struct
- `mocks/`: Mock definitions and configuration
  - `mod.rs`: Default mock configurations (extensible with submodules)
- `responses.rs`: Response builders and streaming utilities
- `endpoints/`: Individual endpoint handlers
  - `chat.rs`: Chat completions with SSE streaming
  - `embeddings.rs`: Embeddings generation
  - `images.rs`: Image generation
- `main.rs`: Server setup and configuration

## Extending

To add new mocks, modify the `get_default_mocks()` function in `src/mocks/mod.rs`:

```rust
let mocks = vec![
    Mock {
        name: "YourMock".to_string(),
        description: "Description of what this mock does".to_string(),
        match_rules: vec![
            MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: "your-pattern".to_string(),
            }),
            // Add more patterns for OR-style matching
        ],
        response: ResponseConfig::Static(StaticResponseConfig {
            chunks: vec!["Your".to_string(), " response".to_string()],
            delay_ms: 50,
        }),
    },
    // ... more mocks
];
```

### Extensibility

The architecture uses enums for both match rules and response configurations, making it easy to add new types:

- **Match Rules**: Currently supports `UserMessagePattern` for substring matching. Future variants could include regex patterns, JSON path matching, etc.
- **Response Configs**: Currently supports `Static` responses. Future variants could include dynamic responses, templated responses, etc.

### Organizing Complex Mocks

For complex scenarios, you can create submodules within `src/mocks/`:

```rust
// src/mocks/mod.rs
mod basic;
mod complex;

pub fn get_default_mocks() -> Vec<Mock> {
    let mut mocks = Vec::new();
    mocks.extend(basic::get_mocks());
    mocks.extend(complex::get_mocks());
    mocks
}
```

Each mock prints a summary at startup showing its name, description, match rules, and response configuration.

## Future Enhancements

- Support for other API standards (e.g., `/base-anthropic`, `/base-cohere`)
- Configuration file support for mocks (JSON/YAML)
- Additional match rule types:
  - Regex pattern matching
  - JSON path matching
  - Request header matching
- Additional response types:
  - Dynamic responses with templates
  - Conditional responses
  - Stateful responses
- Request/response logging to file
- Stateful conversations
