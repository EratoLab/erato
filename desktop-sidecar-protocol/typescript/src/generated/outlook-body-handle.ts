/* This file is generated from the canonical JSON schemas. Do not edit. */

/**
 * A reference to a message body fetched through the binary transfer profile, so large bodies stay out of the JSON-RPC response.
 */
export interface OutlookBodyHandle {
  /**
   * Opaque handle for GET /erato/sidecar/transfer/v1/{handle}.
   */
  handle: string;
  /**
   * Media type of the body bytes, for example text/html or text/plain.
   */
  contentType: string;
  /**
   * Exact length of the body bytes.
   */
  size: number;
  [k: string]: unknown;
}
