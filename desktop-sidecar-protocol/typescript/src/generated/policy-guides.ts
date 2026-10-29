/* This file is generated from the canonical JSON schemas. Do not edit. */

/**
 * Organization-managed policy definitions. Acceptance and application of outside configuration are decided by the sidecar.
 */
export interface PolicyGuides {
  policies: {
    [k: string]: PolicyGuide;
  };
  [k: string]: unknown;
}
export interface PolicyGuide {
  /**
   * Disabled definitions are retained but must not be evaluated.
   */
  enabled: boolean;
  question: string;
  /**
   * True predicate: the content should be refused.
   */
  choice_refuse: string;
  /**
   * False predicate: the content is allowed.
   */
  choice_allow: string;
  /**
   * Ordered provider IDs, highest priority first. No automatic fallback or local resolution is implied.
   */
  decision_providers: string[];
  /**
   * Arbitrary JSON values, preserved verbatim and not sent to the model.
   */
  metadata: {
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
