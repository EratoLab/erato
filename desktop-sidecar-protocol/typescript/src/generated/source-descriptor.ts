/* This file is generated from the canonical JSON schemas. Do not edit. */

export interface SourceDescriptor {
  sourceId: string;
  sourceKind: string;
  sourceKey: string;
  locator: {
    [k: string]: unknown;
  };
  enabled: boolean;
  discoveryCursor: {
    [k: string]: unknown;
  } | null;
  completedScanId: string | null;
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
}
