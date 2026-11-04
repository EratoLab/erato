/* This file is generated from the canonical JSON schemas. Do not edit. */

/**
 * Present in discovery when the sidecar runs tool calls through the jobs.* envelope, with its limits: the most calls one job carries and the longest `wait_ms` it honors. Absent from sidecars built before package 0.1.44; clients then use the direct RPCs.
 */
export interface JobsCapability {
  maxCalls: number;
  maxWaitMs: number;
  [k: string]: unknown;
}
