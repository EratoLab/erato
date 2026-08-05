/* This file is generated from the canonical JSON schemas. Do not edit. */

/**
 * Names the pending request whose on-device progress the client wants to observe. The request is identified by the JSON-RPC request ID the client generated for it; visibility is scoped to the Origin that issued that request.
 */
export interface SidecarProgressV1Params {
  requestId: string | number;
  [k: string]: unknown;
}
