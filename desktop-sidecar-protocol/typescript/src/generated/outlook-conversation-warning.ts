/* This file is generated from the canonical JSON schemas. Do not edit. */

/**
 * A part of a conversation that could not be represented fully, without hiding the rest.
 */
export interface OutlookConversationWarning {
  /**
   * Stable machine-readable warning code. Known values include truncated, attachment_unavailable, and embedded_attachments_omitted.
   */
  code: string;
  message?: string;
  /**
   * The message the warning is about, when it is message-scoped.
   */
  internetMessageId?: string;
  [k: string]: unknown;
}
