/* This file is generated from the canonical JSON schemas. Do not edit. */

export interface JobsStartV1Params {
  /**
   * Independent calls; each has its own result or error.
   *
   * @minItems 1
   * @maxItems 16
   */
  calls: [JobToolCall, ...JobToolCall[]];
  /**
   * The longest the sidecar holds the response while the job is pending (queued, running, awaiting_approval or ready_for_review). It answers as soon as the job has results or ends, and reports the current state when the wait elapses. The sidecar honors at most its discovered `jobs.maxWaitMs`.
   */
  wait_ms?: number;
  [k: string]: unknown;
}
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
