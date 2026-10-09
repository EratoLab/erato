/* This file is generated from the canonical JSON schemas. Do not edit. */

export type Eta = {
  [k: string]: unknown;
} & {
  state: "available" | "unavailable";
  estimatedRemainingSeconds: number | null;
  estimatedCompletionAt: string | null;
  basis: "knownBacklog";
  rateWindowSeconds: 60 | 300;
  observationSeconds: number;
  sampleCount: number;
  unavailableReason: string | null;
  [k: string]: unknown;
};

export interface IndexingStartV1Result {
  /**
   * Persisted layers for editing configuration without losing unrelated settings. Updated sidecars include both layers; absent on older servers.
   */
  configuration?: {
    user_configuration: SidecarConfiguration;
    organization_configuration: SidecarConfiguration;
    /**
     * The user signed in to the client, as its Entra ID identity. The sidecar enables by default the sources that read this work account. Null or absent means unknown; sources then keep their own defaults. Clients set it on every configure; older sidecars preserve it without applying it.
     */
    signed_in_user?: {
      /**
       * Entra object id (oid).
       */
      user_id: string;
      /**
       * Entra tenant id (tid), when known.
       */
      tenant_id?: string | null;
      email?: string | null;
      user_principal_name?: string | null;
      [k: string]: unknown;
    } | null;
    [k: string]: unknown;
  };
  sampledAt: string;
  sessionId: string;
  uptimeSeconds: number;
  state: "running" | "stopping" | "stopped" | "blocked";
  effectiveConfiguration: EffectiveIndexingConfiguration;
  resources: Resources;
  generations: Generation[];
  discovery: DiscoverySource[];
  search: SearchStatistics;
  /**
   * True while a full reset is draining activity or deleting files. State is stopping during reset. Optional; absence means false.
   */
  resetInProgress?: boolean;
  /**
   * Absolute local filesystem path of the sidecar-managed indexing root, in the sidecar OS native path syntax (not a URI). Report it even before initialization or after reset, without creating the directory. Updated implementations must include it; optional in the wire schema for compatibility with older v1 servers.
   */
  indexingDirectory?: string;
  [k: string]: unknown;
}
/**
 * An extensible configuration layer. Unknown properties must be accepted and preserved.
 */
export interface SidecarConfiguration {
  /**
   * Legacy compatibility view of source indexing policies. Mailbox writes map to all associated sources; use indexing_sources for new clients. Disabled source data is retained but excluded from search. Priority is explicit and independent of array order: lower numbers are processed first, with mailbox ID as a deterministic tie-breaker. Unlisted mailboxes remain enabled with priority 9007199254740991. Null inherits the other layer; an empty array explicitly uses defaults. Mailbox IDs must be unique.
   */
  indexing_mailboxes?:
    | {
        mailbox_id: string;
        enabled: boolean;
        /**
         * Indexing priority; lower numbers are processed first. Array order has no effect.
         */
        priority: number;
        [k: string]: unknown;
      }[]
    | null;
  /**
   * Whether the sidecar should show its system tray icon. Null leaves the decision to the other configuration layer or the sidecar default.
   */
  show_tray_icon?: boolean | null;
  /**
   * Maximum documents concurrently processed across all kinds and generations, including extraction and commit. Lowering it lets in-flight documents finish and prevents excess new starts. Null or absence inherits the other layer; the sidecar default is 1. Zero is invalid and does not pause indexing.
   */
  indexing_parallelism?: number | null;
  /**
   * Global maximum document-processing starts per rolling 60 seconds, shared by all workers, kinds and generations. Retry attempts consume this budget; one extraction shared by generations consumes it once. Deletion-only cleanup does not consume it. Null or absence inherits the other layer; the sidecar default is 40. Zero is invalid and does not pause indexing.
   */
  indexing_documents_per_minute?: number | null;
  /**
   * Source indexing overrides keyed by sourceId from sources.list.v1. Lower priorities are processed first, independent of array order. Source IDs must be unique. Null inherits the other layer; an empty array uses source defaults. Disabling stops new discovery and processing while retaining the existing index. This is authoritative when supported; indexing_mailboxes is a legacy projection. Older sidecars may preserve this field without applying it.
   */
  indexing_sources?:
    | {
        enabled: boolean;
        /**
         * Indexing priority; lower numbers are processed first. Array order has no effect.
         */
        priority: number;
        source_id: string;
        [k: string]: unknown;
      }[]
    | null;
  [k: string]: unknown;
}
export interface EffectiveIndexingConfiguration {
  parallelism: number;
  documentsPerMinute: number;
  [k: string]: unknown;
}
export interface Resources {
  sampledAt: string;
  observationSeconds: number;
  sidecar: ProcessResources;
  extractionWorkers: ProcessResources;
  disk: {
    sampledAt: string;
    allocatedBytes: number | null;
    logicalBytes: number | null;
    availableBytes: number | null;
    breakdown: {
      control: DiskUsage;
      catalog: DiskUsage;
      activeIndex: DiskUsage;
      buildingIndex: DiskUsage;
      retiredIndexes: DiskUsage;
      wal: DiskUsage;
      temporary: DiskUsage;
      [k: string]: unknown;
    };
    unavailableMetrics: UnavailableMetric[];
    [k: string]: unknown;
  };
  /**
   * Individual currently live workers. Their memory sums can double-count shared pages. Aggregate CPU/I/O above also includes workers that exited during the sample.
   */
  liveExtractionWorkers: {
    processId: number;
    sampledAt: string;
    resources: ProcessResources;
    [k: string]: unknown;
  }[];
  [k: string]: unknown;
}
/**
 * Sidecar measurements include search and discovery. Worker measurements aggregate extraction children, including CPU/I/O accrued by children that exit between samples. Resident sums may double-count shared pages; peak is the maximum simultaneously observed aggregate since process startup.
 */
export interface ProcessResources {
  processCount: number;
  cpuCoresUsed: number | null;
  memoryResidentBytes: number | null;
  memoryResidentPeakBytes: number | null;
  diskReadBytesPerSecond: number | null;
  diskWriteBytesPerSecond: number | null;
  unavailableMetrics: UnavailableMetric[];
  [k: string]: unknown;
}
/**
 * Metric is a dotted path relative to its containing section. Every unavailable null measurement must have an entry; zero means an observed zero.
 */
export interface UnavailableMetric {
  metric: string;
  reason: string;
  [k: string]: unknown;
}
export interface DiskUsage {
  allocatedBytes: number | null;
  logicalBytes: number | null;
  [k: string]: unknown;
}
/**
 * Active and building counters have independent revision receipts. Never sum generations to estimate mailbox progress. An extraction shared across generations can appear in both generation throughput views.
 */
export interface Generation {
  instanceId: string;
  role: "active" | "building";
  sampledAt: string;
  segments: Segment[];
  chunks: number | null;
  terms: number | null;
  indexedAvgdl: number | null;
  observedAvgdl: number | null;
  unavailableReason: string | null;
  [k: string]: unknown;
}
/**
 * Null source/mailbox denotes an all-source aggregate. Non-null scopes are independent views, not additional documents. Null fileType denotes all file types; breakdowns apply only to file rows. There must be one 60-second and one 300-second throughput window per segment.
 */
export interface Segment {
  kind: "email" | "file" | "teams_message";
  sourceId: string | null;
  mailboxId: string | null;
  fileType: ("pdf" | "office" | "text" | "image" | "email" | "archive" | "other") | null;
  throughput: ThroughputWindow[];
  backlog: Backlog;
  eta: Eta;
  coverage: Coverage;
  depth: Depth;
  freshness: Latency;
  errors: ErrorWindow;
  [k: string]: unknown;
}
export interface ThroughputWindow {
  targetWindowSeconds: 60 | 300;
  observationSeconds: number;
  sampleCount: number;
  indexedPerMinute: number | null;
  emptyPerMinute: number | null;
  unindexablePerMinute: number | null;
  completedPerMinute: number | null;
  attemptsPerMinute: number | null;
  retriesPerMinute: number | null;
  deletionsPerMinute: number | null;
  extractedTextBytesPerSecond: number | null;
  unavailableReason: string | null;
  [k: string]: unknown;
}
/**
 * Counts concern current eligible revisions, not queue entries. remaining = ready + inProgress + retryDeferred + blocked = firstTime + updates. Incomplete discovery still permits exact counts for known work. Terminal outcomes and deletion-only cleanup are excluded.
 */
export interface Backlog {
  sampledAt: string;
  discoveryComplete: boolean;
  remaining: number | null;
  ready: number | null;
  inProgress: number | null;
  retryDeferred: number | null;
  blocked: number | null;
  firstTime: number | null;
  updates: number | null;
  unavailableReason: string | null;
  [k: string]: unknown;
}
/**
 * knownEligible is the sum of indexedCurrent, emptyCurrent, unindexableCurrent, missingFromLocalCacheCurrent (when reported), stale and neverProcessed. pendingDeletions is separate. These counts do not imply discovery is complete.
 */
export interface Coverage {
  sampledAt: string;
  knownEligible: number | null;
  indexedCurrent: number | null;
  emptyCurrent: number | null;
  unindexableCurrent: number | null;
  stale: number | null;
  neverProcessed: number | null;
  pendingDeletions: number | null;
  unavailableReason: string | null;
  /**
   * Current revisions whose body or attachment content is unavailable in the local cache. A separate terminal outcome from empty or unindexable. Older sidecars may omit this counter; null means unknown.
   */
  missingFromLocalCacheCurrent?: number | null;
  [k: string]: unknown;
}
/**
 * Only applicable to chronologically prioritized kinds. fullyIndexedSince requires current indexed/empty receipts; processedSince also accepts current terminal failures. Unknown dates are excluded from the boundary and counted explicitly. Oldest indexed date alone makes no coverage claim.
 */
export interface Depth {
  state: "applicable" | "notApplicable" | "unknown";
  dateBasis: ("emailReceivedAtThenSentAt" | "parentEmailReceivedAtThenSentAt" | "sourceDefined") | null;
  sourceDateField: string | null;
  discoveryComplete: boolean;
  oldestIndexedDocumentAt: string | null;
  fullyIndexedSince: DepthBoundary | null;
  processedSince: DepthBoundary | null;
  pendingDocuments: number | null;
  unindexableDocuments: number | null;
  undatedDocuments: number | null;
  /**
   * Current-revision documents whose content is unavailable in the local cache. Older sidecars omit it.
   */
  missingFromLocalCacheDocuments?: number;
  unavailableReason: string | null;
  [k: string]: unknown;
}
/**
 * All known eligible dated documents between this boundary and the snapshot are covered; inclusive says whether documents exactly at the boundary are included. An old pending document makes an exclusive boundary possible without rounding timestamps.
 */
export interface DepthBoundary {
  at: string;
  inclusive: boolean;
  [k: string]: unknown;
}
/**
 * Freshness is measured from discovery of a revision until its first searchable commit. Retry attempts do not reset the start; failed/empty/deleted revisions are excluded.
 */
export interface Latency {
  observationSeconds: number;
  sampleCount: number;
  p50Seconds: number | null;
  p95Seconds: number | null;
  unavailableReason: string | null;
  [k: string]: unknown;
}
/**
 * Bounded recent error-code histogram, without content or filesystem paths. Counts include all failures even when byCode is truncated.
 */
export interface ErrorWindow {
  observationSeconds: number;
  attemptFailures: number;
  terminalFailures: number;
  byCode: ErrorCount[];
  truncated: boolean;
  [k: string]: unknown;
}
export interface ErrorCount {
  code: string;
  count: number;
  lastOccurredAt: string;
  [k: string]: unknown;
}
/**
 * discoveryComplete refers to the current inventory snapshot; a successful older scan does not imply a current scan is complete. Older sidecars omit indexedRange.
 */
export interface DiscoverySource {
  sourceId: string;
  mailboxId: string | null;
  state: "notStarted" | "scanning" | "complete" | "failed" | "disabled";
  discoveryComplete: boolean;
  scanStartedAt: string | null;
  lastSuccessfulScanAt: string | null;
  discoveredDocuments: number | null;
  accessible: boolean;
  lastErrorCode: string | null;
  indexedRange?: IndexedRange;
  [k: string]: unknown;
}
/**
 * Period of this source's dated documents that search can rely on, measured in the active generation with search visibility rules. Every document dated inside the range is searchable or terminal.
 */
export interface IndexedRange {
  /**
   * Oldest bound of the range. Null when no range can be claimed; unavailableReason says why.
   */
  from: IndexedRangeBoundary | null;
  /**
   * Newest bound, set only while newer documents are still queued (pendingNewer). Null means the range reaches observedAt.
   */
  through: IndexedRangeBoundary | null;
  /**
   * When the sidecar last confirmed the local store: the end of a complete enumeration or a passed unchanged-store check. Null before the first complete enumeration.
   */
  observedAt: string | null;
  /**
   * Unprocessed dated documents newer than the range. Zero when through is null.
   */
  pendingNewer: number | null;
  /**
   * Unprocessed dated documents older than the range, or all of them when from is null.
   */
  olderPending: number | null;
  /**
   * Documents inside the range that ended unindexable or missing from the local cache. They do not break the range.
   */
  unsearchable: number | null;
  /**
   * Documents without a usable date, in any state. They are excluded from the range.
   */
  undated: number | null;
  /**
   * Which document date the bounds use, such as emailReceivedAtThenSentAt or teamsMessageTimestamp. Extensible.
   */
  dateBasis: string;
  /**
   * localStore when the sidecar enumerates a complete local store, syncCache when it enumerates the complete local cache of a synchronizing client, cacheObservations when it sees only what the application cached. Extensible; clients treat unknown values as cacheObservations.
   */
  inventory: string;
  /**
   * Why from is null, such as not_enumerated or no_searchable_documents. Null when a range is claimed.
   */
  unavailableReason: string | null;
  [k: string]: unknown;
}
/**
 * A document date bounding the indexed range; inclusive says whether documents dated exactly at it are inside the range.
 */
export interface IndexedRangeBoundary {
  at: string;
  inclusive: boolean;
  [k: string]: unknown;
}
export interface SearchStatistics {
  sampledAt: string;
  observationSeconds: number;
  queryCount: number;
  errorCount: number;
  inFlight: number;
  p50LatencyMilliseconds: number | null;
  p95LatencyMilliseconds: number | null;
  unavailableReason: string | null;
  [k: string]: unknown;
}
