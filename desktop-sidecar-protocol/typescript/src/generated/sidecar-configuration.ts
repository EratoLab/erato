/* This file is generated from the canonical JSON schemas. Do not edit. */

/**
 * An extensible configuration layer. Unknown properties must be accepted and preserved.
 */
export interface SidecarConfiguration {
  /**
   * Mailbox indexing overrides. Priority is explicit and independent of array order: lower numbers are processed first, with mailbox ID as a deterministic tie-breaker. Unlisted mailboxes remain enabled with priority 9007199254740991. Null inherits the other layer; an empty array explicitly uses defaults. Mailbox IDs must be unique. Disabling stops new discovery and processing but retains existing searchable data; in-flight work may finish.
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
