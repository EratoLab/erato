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

## Match Rules

The server comes with pre-configured match rules:

| Pattern | Response | Delay |
|---------|----------|-------|
| "hello" | Friendly greeting | 50ms |
| "weather" | Weather information | 75ms |
| "test" | Test response | 100ms |
| "slow" | Slow streaming response | 500ms |
| "fast" | Quick response | 10ms |
| (default) | Generic response | 50ms |

Matching is case-insensitive and uses substring matching on the last user message.

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
- `matcher.rs`: Message matching logic with substring patterns
- `responses.rs`: Response builders and streaming utilities
- `endpoints/`: Individual endpoint handlers
  - `chat.rs`: Chat completions with SSE streaming
  - `embeddings.rs`: Embeddings generation
  - `images.rs`: Image generation
- `main.rs`: Server setup and configuration

## Extending

To add new match rules, modify the `rules` vector in `main.rs`:

```rust
let rules = vec![
    MatchRule {
        pattern: "your-pattern".to_string(),
        response: ResponseConfig {
            chunks: vec!["Your".to_string(), " response".to_string()],
            delay_ms: 50,
        },
    },
    // ... more rules
];
```

## Future Enhancements

- Support for other API standards (e.g., `/base-anthropic`, `/base-cohere`)
- Configuration file support for match rules
- Regex pattern matching
- Request/response logging to file
- Stateful conversations

