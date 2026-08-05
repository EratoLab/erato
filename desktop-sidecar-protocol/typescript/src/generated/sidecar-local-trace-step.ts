/* This file is generated from the canonical JSON schemas. Do not edit. */

/**
 * One internal on-device processing step, shaped as an event: a stable `sequence` identity carrying a status that may evolve. Metadata only: never message content, snippets, or file names.
 */
export interface SidecarLocalTraceStep {
  /**
   * Stable identity of this step within the request, and its ordering key. A later step with the same sequence supersedes an earlier one, so the same payload works whether the log arrives complete or is appended to over time.
   */
  sequence: number;
  /**
   * Step identifier. Known values include expandQuery, buildIndex, match, and summarize. Receivers ignore unknown values and render them by their raw id.
   */
  id: string;
  /**
   * Step outcome. Known values include running, ok, skipped, degraded, and error. Receivers treat unknown values as running.
   */
  status: string;
  /**
   * Sequence of the step this one runs inside, when the sidecar nests work (for example a tool call made during a local model turn). Absent for top-level steps.
   */
  parentSequence?: number;
  /**
   * Milliseconds between the start of the request and the start of this step, so a client can order and place steps identically in both delivery modes.
   */
  startedAtOffsetMs?: number;
  durationMs?: number;
  /**
   * Identifier of the local model this step used, when it used one.
   */
  model?: string;
  /**
   * Whether this step was served from a local cache (for example the in-memory mailbox index).
   */
  cacheHit?: boolean;
  /**
   * Short non-sensitive note — the sidecar's counterpart of a progress message: why a step was skipped or degraded, or what it is doing.
   */
  detail?: string;
  /**
   * Item counts keyed by an open string. Known keys include keywordsIn, keywordsOut, messagesScanned, matched, and hitsReturned.
   */
  counts?: {
    [k: string]: number;
  };
  [k: string]: unknown;
}
