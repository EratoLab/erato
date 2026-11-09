/* This file is generated from the canonical JSON schemas. Do not edit. */

export interface JobsReviewV1Params {
  handle: string;
  /**
   * Who asks for the review (package 0.1.48) and how that person has the client set up (package 0.1.49), as the client declares it. Display data the sidecar does not check: the review window names the client and follows its language, colour mode and text size. A value the sidecar cannot use is dropped, not refused.
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
    /**
     * The person's colour mode: light, dark or system.
     */
    theme_mode?: string;
    /**
     * The person's text size: small, default, large or x-large.
     */
    text_size?: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
