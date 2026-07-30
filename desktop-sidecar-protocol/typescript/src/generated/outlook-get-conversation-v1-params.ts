/* This file is generated from the canonical JSON schemas. Do not edit. */

export interface OutlookGetConversationV1Params {
  /**
   * Short opaque identifier returned by outlook.list_mailboxes.v1.
   */
  mailboxId: string;
  /**
   * The message the conversation is resolved from.
   */
  anchor: {
    /**
     * RFC 5322 Message-ID of the anchor message, including angle brackets, as reported by outlook.list_emails.v1. Not the Office.js conversationId.
     */
    internetMessageId: string;
    [k: string]: unknown;
  };
  /**
   * Cap on the number of returned messages. When the conversation has more, the result is reported as partial.
   */
  maxMessages?: number;
  [k: string]: unknown;
}
