/* This file is generated from the canonical JSON schemas. Do not edit. */

export interface JobsStatusV1Params {
  handle: string;
  /**
   * The longest the sidecar holds the response while the job stays in the pending state it had when the request arrived (queued and running count as one). It answers as soon as that state changes, and otherwise reports the current state when the wait elapses. The sidecar honors at most its discovered `jobs.maxWaitMs`.
   */
  wait_ms?: number;
  [k: string]: unknown;
}
