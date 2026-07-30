/* This file is generated from the canonical JSON schemas. Do not edit. */

/**
 * One message of an Outlook conversation, with its body and attachment bytes carried inline.
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
  body?: OutlookMessageBody;
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
  [k: string]: unknown;
}
