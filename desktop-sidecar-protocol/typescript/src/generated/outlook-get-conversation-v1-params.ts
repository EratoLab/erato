/* This file is generated from the canonical JSON schemas. Do not edit. */

export interface OutlookGetConversationV1Params {
  /**
   * Short opaque identifier returned by outlook.list_mailboxes.v1.
   */
  mailboxId: string;
  /**
   * RFC 5322 Message-ID of the anchor message, including angle brackets, as reported by outlook.list_emails.v1.
   */
  anchorInternetMessageId: string;
  [k: string]: unknown;
}
