/* This file is generated from the canonical JSON schemas. Do not edit. */

/**
 * Up to 50 of the newest locally indexed emails in the selected mailbox.
 */
export interface OutlookListEmailsV1Result {
  mailbox: OutlookMailbox;
  /**
   * @maxItems 50
   */
  emails: OutlookEmailSummary[];
  [k: string]: unknown;
}
/**
 * A mailbox or message store available through the local Outlook installation.
 */
export interface OutlookMailbox {
  /**
   * Short opaque mailbox identifier. It is unique for the current sidecar runtime and logically stable across restarts while the Outlook profile and store identity remain unchanged.
   */
  id: string;
  displayName: string;
  emailAddress?: string;
  /**
   * Name of the Outlook profile containing this mailbox. Omitted when the platform or standalone store has no profile concept.
   */
  profileName?: string;
  /**
   * Implementation-defined local Outlook storage source. Known values include pst, ost, macOsProfile, and windowsOutlook.
   */
  source: string;
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
