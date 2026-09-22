/* This file is generated from the canonical JSON schemas. Do not edit. */

/**
 * Externally relatable identifiers for the document. Identifier keys are open-ended so new identifier kinds do not require a protocol change.
 */
export type DocumentExternalIds = {
  key: string;
  value: string;
}[];

/**
 * Metadata and inline bytes for one attachment. When the bytes are available they are base64-encoded in contentBytes; otherwise unavailableReason explains why.
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
   * Exact length of the attachment bytes.
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
   * Lowercase hex SHA-256 of the attachment bytes, useful for de-duplicating attachments repeated across thread messages.
   */
  sha256?: string;
  /**
   * Base64-encoded attachment bytes, present when the bytes are available.
   */
  contentBytes?: string;
  /**
   * Stable code explaining why bytes are not available, present instead of contentBytes. Known values include unsupported_attachment.
   */
  unavailableReason?: string;
  external_ids?: DocumentExternalIds;
  topLevelParent?: TopLevelParent;
  [k: string]: unknown;
}
/**
 * The outermost containing document, never a folder. External IDs belong to that parent, not to the attachment.
 */
export interface TopLevelParent {
  /**
   * Catalog UUID, when indexed; can be passed to sources.get_document.v1.
   */
  documentId?: string;
  external_ids: DocumentExternalIds;
}
