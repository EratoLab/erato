/* This file is generated from the canonical JSON schemas. Do not edit. */

export interface SourcesListV1Result {
  sources: SourceDescriptor[];
  [k: string]: unknown;
}
export interface SourceDescriptor {
  sourceId: string;
  sourceKind: string;
  sourceKey: string;
  /**
   * Human-readable source name for direct presentation. Older sidecars may omit it.
   */
  displayName?: string;
  /**
   * Effective persisted indexing policy for this source, independent of scheduler activity or scan health. Older sidecars may omit it.
   */
  indexingEnabled?: boolean;
  /**
   * Stable product family, such as outlook or teams. Older sidecars may omit it; values are extensible.
   */
  product?: string;
  /**
   * Product variant inferred from the discovered store/source type, such as outlook_classic. Older sidecars may omit it; values are extensible.
   */
  product_variant?: string;
  locator: {
    [k: string]: unknown;
  };
  /**
   * Existing catalog source-enabled flag. It is distinct from effective persisted indexing policy in indexingEnabled.
   */
  enabled: boolean;
  discoveryCursor: {
    [k: string]: unknown;
  } | null;
  completedScanId: string | null;
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
  [k: string]: unknown;
}
