/* This file is generated from the canonical JSON schemas. Do not edit. */

export interface LocalTaskPlan {
  operation: "collect_evidence";
  /**
   * @minItems 1
   * @maxItems 8
   */
  queryVariants:
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string];
  maxHits: number;
  maxArtifacts: number;
  maxBytes: number;
  executionSeconds: number;
  expiresAt: number;
}
