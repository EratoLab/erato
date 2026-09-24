/* This file is generated from the canonical JSON schemas. Do not edit. */

/**
 * Cancel by opaque handle, or atomically create/cancel a logical binding tombstone after a lost start acknowledgement. Binding cancellation never starts collection.
 */
export type LocalTasksCancelV1Params =
  | {
      contextHandle: string;
      handle: string;
    }
  | {
      contextHandle: string;
      binding: LocalTaskBinding;
      plan: LocalTaskPlan;
    };

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
