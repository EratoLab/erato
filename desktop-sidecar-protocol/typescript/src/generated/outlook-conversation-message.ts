/* This file is generated from the canonical JSON schemas. Do not edit. */

/**
 * One message of an Outlook conversation. Its body is referenced by transfer handle and its attachments by transfer handle, so no bytes are inline.
 */
export interface OutlookConversationMessage {
  internetMessageId?: string;
  subject?: string;
  from?: OutlookMessageRecipient;
  to?: OutlookMessageRecipient[];
  cc?: OutlookMessageRecipient[];
  /**
   * UTC Unix timestamp in whole seconds.
   */
  sentAtUnixSeconds?: number;
  /**
   * UTC Unix timestamp in whole seconds.
   */
  receivedAtUnixSeconds?: number;
  /**
   * True when the message is an unsent draft.
   */
  isDraft?: boolean;
  /**
   * Lowercase hex PidTagConversationIndex; its embedded GUID groups the thread.
   */
  conversationIndex?: string;
  bodyHandle?: OutlookBodyHandle;
  attachments: OutlookAttachmentReference[];
  [k: string]: unknown;
}
/**
 * One recipient of an Outlook message.
 */
export interface OutlookMessageRecipient {
  /**
   * Display name, when present.
   */
  name?: string;
  /**
   * SMTP address. Omitted when only a non-routable Exchange address is stored locally.
   */
  emailAddress?: string;
  [k: string]: unknown;
}
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
