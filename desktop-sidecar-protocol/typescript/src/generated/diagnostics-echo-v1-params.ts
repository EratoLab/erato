/* This file is generated from the canonical JSON schemas. Do not edit. */

export interface DiagnosticsEchoV1Params {
  message: string;
  /**
   * Artificial pause before the sidecar answers, in milliseconds, so long-call mechanics — progress polling and cancellation — can be exercised without a real long-running capability. Sidecars report the pause as a `delay` trace step and MAY cap it lower.
   */
  delayMs?: number;
  [k: string]: unknown;
}
