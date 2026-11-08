/* This file is generated from the canonical JSON schemas. Do not edit. */

export interface JobsReviewV1Params {
  handle: string;
  /**
   * Who asks for the review (package 0.1.48), as the client declares it. Display data the sidecar does not check: the review window names the client and uses its language. A value the sidecar cannot use is dropped, not refused.
   */
  client?: {
    /**
     * The client's surface, its X-Erato-Platform value such as web or outlook.
     */
    platform?: string;
    /**
     * The client's active language as a BCP-47 tag.
     */
    locale?: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
