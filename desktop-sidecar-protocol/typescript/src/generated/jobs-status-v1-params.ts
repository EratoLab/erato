/* This file is generated from the canonical JSON schemas. Do not edit. */

export interface JobsStatusV1Params {
  handle: string;
  /**
   * The longest the sidecar holds the response while the job is pending (queued, running, awaiting_approval or ready_for_review). It answers as soon as the job has results or ends, and reports the current state when the wait elapses. The sidecar honors at most its discovered `jobs.maxWaitMs`.
   */
  wait_ms?: number;
  [k: string]: unknown;
}
