/* This file is generated from the canonical JSON schemas. Do not edit. */

export interface OutlookSearchEmailsV1Params {
  /**
   * Short opaque identifier returned by outlook.list_mailboxes.v1.
   */
  mailboxId: string;
  /**
   * Natural-language or keyword query. The sidecar may expand it into additional local search terms.
   */
  query: string;
  /**
   * Maximum number of hits to return. Defaults to 10.
   */
  limit?: number;
  /**
   * Also match against attachment file names and locally extractable attachment text. Defaults to true.
   */
  includeAttachments?: boolean;
  /**
   * Produce a locally generated plain-text summary of the hits when a local model is configured. Defaults to true.
   */
  summarize?: boolean;
  [k: string]: unknown;
}
