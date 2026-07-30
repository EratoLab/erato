/* This file is generated from the canonical JSON schemas. Do not edit. */

/**
 * A message body carried inline in the JSON-RPC result. The sidecar decodes the stored bytes to text using the message code page before sending.
 */
export interface OutlookMessageBody {
  /**
   * Media type of the body, for example text/html or text/plain.
   */
  contentType: string;
  /**
   * The decoded body text.
   */
  content: string;
  [k: string]: unknown;
}
