/* This file is generated from the canonical JSON schemas. Do not edit. */

/**
 * One locally matched email for an outlook.search_emails.v1 query.
 */
export interface OutlookSearchHit {
  email: OutlookEmailSummary;
  /**
   * Short plain-text excerpt around the strongest match. Never a full message body.
   */
  snippet?: string;
  /**
   * Fields the query matched. Known values include subject, body, sender, attachmentName, and attachmentContent. Receivers ignore unknown values.
   *
   * @maxItems 16
   */
  matchedIn?:
    | []
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ];
  /**
   * File names of attachments whose name or extracted text matched the query.
   *
   * @maxItems 64
   */
  matchedAttachmentNames?: string[];
  [k: string]: unknown;
}
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
