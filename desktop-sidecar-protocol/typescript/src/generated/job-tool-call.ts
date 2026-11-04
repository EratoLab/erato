/* This file is generated from the canonical JSON schemas. Do not edit. */

/**
 * One tool call of a job. `server` names the provider: `sidecar` is reserved for the desktop app's built-in tools (providers/sidecar.json); other ids are reserved for organization-declared local MCP servers.
 */
export interface JobToolCall {
  server: string;
  name: string;
  /**
   * The tool's arguments, as in MCP `tools/call`. Absent means an empty object.
   */
  arguments?: {
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
