/* This file is generated from the canonical JSON schemas. Do not edit. */

/**
 * A provider whose tools this sidecar runs as jobs.
 */
export interface ToolProvider {
  id: string;
  tools: string[];
  readOnly: boolean;
  /**
   * Whether the provider's tools reach beyond this device: `none` or `open_world`. Open vocabulary; a client treats any other value as `open_world`.
   */
  egress: string;
  /**
   * False when the provider cannot run calls at all. A refusal of one tool, such as a content tool under strict mode while strict review on jobs is unavailable, is a per-call error instead.
   */
  available: boolean;
  [k: string]: unknown;
}
