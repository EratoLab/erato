/* This file is generated from the canonical JSON schemas. Do not edit. */

export interface OutlookListMailboxesV1Result {
  /**
   * @maxItems 1024
   */
  mailboxes: OutlookMailbox[];
  /**
   * @maxItems 1024
   */
  warnings: OutlookListingWarning[];
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
 * A local Outlook source that could not be inspected without hiding successful results.
 */
export interface OutlookListingWarning {
  path?: string;
  message: string;
  [k: string]: unknown;
}
