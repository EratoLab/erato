/* This file is generated from the canonical JSON schemas. Do not edit. */

/**
 * A part of a conversation that could not be represented fully, without hiding the rest.
 */
export interface OutlookConversationWarning {
  /**
   * Stable machine-readable warning code. Known values include truncated, attachment_unavailable, embedded_attachments_omitted, body_preview_only, body_unavailable, body_truncated, and unsupported_source. body_preview_only means the message's body is only the preview its application cached. unsupported_source means the mailbox's store cannot be read as conversations at all: the result has no messages and retrying cannot help.
   */
  code: string;
  message?: string;
  /**
   * The message the warning is about, when it is message-scoped.
   */
  internetMessageId?: string;
  [k: string]: unknown;
}
