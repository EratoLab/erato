/* This file is generated from the canonical JSON schemas. Do not edit. */

/**
 * Metadata for one attachment. When its bytes are available they are fetched through the binary transfer profile via contentHandle, so any-size attachments stay out of the JSON-RPC body; otherwise unavailableReason explains why.
 */
export interface OutlookAttachmentReference {
  /**
   * File name, when present.
   */
  name?: string;
  /**
   * Media type of the bytes. Embedded messages are reported as message/rfc822.
   */
  contentType?: string;
  /**
   * Exact length of the transferable bytes.
   */
  size?: number;
  /**
   * True when the attachment is referenced from the message body by contentId.
   */
  isInline?: boolean;
  /**
   * Content-ID for an inline attachment, without angle brackets.
   */
  contentId?: string;
  /**
   * Lowercase hex SHA-256 of the transferable bytes, useful for de-duplicating attachments repeated across thread messages.
   */
  sha256?: string;
  /**
   * Opaque handle for GET /erato/sidecar/transfer/v1/{handle}. Present when the bytes are available.
   */
  contentHandle?: string;
  /**
   * Stable code explaining why bytes are not available, present instead of contentHandle. Known values include unsupported_attachment.
   */
  unavailableReason?: string;
  [k: string]: unknown;
}
