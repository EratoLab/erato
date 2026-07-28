/* This file is generated from the canonical JSON schemas. Do not edit. */

/**
 * Metadata for one attachment. The bytes are fetched separately through the binary transfer profile, so any-size attachments stay out of the JSON-RPC body.
 */
export interface OutlookAttachmentReference {
  /**
   * File name, when present.
   */
  name?: string;
  /**
   * MIME type. Embedded messages are reported as message/rfc822.
   */
  mimeType?: string;
  /**
   * Content-ID for an inline attachment, without angle brackets.
   */
  contentId?: string;
  /**
   * True when the attachment is referenced from the message body by contentId.
   */
  isInline?: boolean;
  /**
   * Implementation-defined attachment kind. Known values include binary and embeddedMessage.
   */
  kind?: string;
  /**
   * Exact length of the transferable bytes.
   */
  sizeBytes: number;
  /**
   * Lowercase hex SHA-256 of the transferable bytes.
   */
  sha256?: string;
  /**
   * Opaque handle for GET /erato/sidecar/transfer/v1/{handle} within the same sidecar runtime.
   */
  transferHandle: string;
  [k: string]: unknown;
}
