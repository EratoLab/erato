/* This file is generated from the canonical JSON schemas. Do not edit. */

/**
 * The `structuredContent` of a `sidecar` provider tool: under each composed RPC method that ran, its outcome as the direct request would have answered, `result` or the JSON-RPC `error`. File bytes are moved out of `result` into the call's `content`.
 */
export interface SidecarStructuredContent {
  [k: string]:
    | {
        result: {
          [k: string]: unknown;
        };
        [k: string]: unknown;
      }
    | {
        error: JsonRpcError;
        [k: string]: unknown;
      };
}
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
  [k: string]: unknown;
}
