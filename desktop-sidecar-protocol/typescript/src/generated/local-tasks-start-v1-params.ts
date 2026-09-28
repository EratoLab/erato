/* This file is generated from the canonical JSON schemas. Do not edit. */

export interface LocalTasksStartV1Params {
  contextHandle: string;
  binding: LocalTaskBinding;
  plan: LocalTaskPlan;
  authorization: string;
}
export interface LocalTaskBinding {
  backendOrigin: string;
  accountId: string;
  deviceId: string;
  taskId: string;
  jobId: string;
  attemptId: string;
  toolCallId: string;
  planDigest: string;
}
export interface LocalTaskPlan {
  operation: "collect_evidence";
  /**
   * @minItems 1
   * @maxItems 8
   */
  queryVariants: [string, ...string[]];
  maxHits: number;
  maxArtifacts: number;
  maxBytes: number;
  executionSeconds: number;
  expiresAt: number;
}
