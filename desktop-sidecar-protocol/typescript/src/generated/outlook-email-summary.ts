/* This file is generated from the canonical JSON schemas. Do not edit. */

/**
 * Metadata for one locally indexed Outlook email.
 */
export interface OutlookEmailSummary {
  /**
   * Source-specific stable message identifier.
   */
  id: string;
  subject?: string;
  senderName?: string;
  senderEmailAddress?: string;
  /**
   * UTC Unix timestamp in whole seconds.
   */
  receivedAtUnixSeconds?: number;
  internetMessageId?: string;
  [k: string]: unknown;
}
