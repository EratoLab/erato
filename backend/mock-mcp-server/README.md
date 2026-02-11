# Mock MCP Server

A standalone mock MCP server bundle for local/integration testing.

## Endpoints

The server exposes three MCP servers on different streamable HTTP endpoints:

- `GET /health` - health check
- `streamable HTTP /mcp/file` - file server (`list_files`, `read_file`)
- `streamable HTTP /mcp/error` - error simulation server (same tools, `read_file` errors)
- `streamable HTTP /mcp/progress` - progress simulation server (same tools, `read_file` emits progress notifications)

Default bind: `127.0.0.1:44321`

## Run

```bash
cargo run --bin mock-mcp-server
```

With custom address:

```bash
HOST=0.0.0.0 PORT=3000 cargo run --bin mock-mcp-server
```
