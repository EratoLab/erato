/* This file is generated from the canonical JSON schemas. Do not edit. */

/**
 * Externally relatable identifiers for the document. Identifier keys are open-ended so new identifier kinds do not require a protocol change.
 */
export type DocumentExternalIds = {
  key: string;
  value: string;
  [k: string]: unknown;
}[];

export interface SearchQueryV1Result {
  hits: {
    documentId: string;
    /**
     * A URI identifying the document, ideally an externally retrievable URL.
     */
    uri?: string;
    external_ids?: DocumentExternalIds;
    chunkId: string | null;
    score: number;
    kind: string;
    title: string | null;
    sender: string | null;
    /**
     * Lowercase sender address: the email sender, or the Teams sender's profile email when Teams cached one. Omitted when unknown.
     */
    senderEmail?: string | null;
    mailboxId: string | null;
    /**
     * The source of the document, as in sources.list.v1, so clients can apply that source's capabilities. Older sidecars omit it.
     */
    sourceId?: string;
    date: number | null;
    /**
     * Unix seconds of the last edit Teams reported for a Teams message. Reactions and read state are not edits. Omitted when the message was never edited.
     */
    editedAt?: number | null;
    /**
     * True for a note the user wrote to themselves: a Teams "Chat with yourself" message, or an email from the mailbox owner addressed only to the owner. Omitted otherwise.
     */
    selfNote?: boolean;
    mimeType: string | null;
    conversationKey: string | null;
    topLevelParent?: TopLevelParent;
    [k: string]: unknown;
  }[];
  elapsedMs: number;
  blocksRead: number;
  candidatesScored: number;
  coverage?: SearchCoverage;
  /**
   * True when more documents matched than limit allowed to return. Older sidecars omit it.
   */
  limitReached?: boolean;
  [k: string]: unknown;
}
/**
 * The outermost containing document, never a folder. External IDs belong to that parent, not to the attachment.
 */
export interface TopLevelParent {
  /**
   * Catalog UUID, when indexed; can be passed to sources.get_document.v1.
   */
  documentId?: string;
  external_ids: DocumentExternalIds;
  [k: string]: unknown;
}
/**
 * The period each source consulted by this query covers. Older sidecars omit it.
 */
export interface SearchCoverage {
  /**
   * When the reported ranges were computed.
   */
  sampledAt: string;
  /**
   * index when the query matched indexed text, catalog when an empty-text listing read the discovered inventory. Extensible.
   */
  basis: string;
  sources: SearchCoverageSource[];
  [k: string]: unknown;
}
/**
 * A source's identity and its indexed range, with the same range fields and values as indexing.status.v1 discovery[].indexedRange.
 */
export interface SearchCoverageSource {
  sourceId: string;
  mailboxId: string | null;
  /**
   * Product family as in sources.list.v1, such as outlook or teams. Extensible.
   */
  product: string;
  displayName: string | null;
  /**
   * Lowercase address of the mailbox or Teams account, when known.
   */
  accountEmail: string | null;
  from: IndexedRangeBoundary | null;
  through: IndexedRangeBoundary | null;
  observedAt: string | null;
  pendingNewer: number | null;
  olderPending: number | null;
  unsearchable: number | null;
  undated: number | null;
  dateBasis: string;
  inventory: string;
  unavailableReason: string | null;
  [k: string]: unknown;
}
export interface IndexedRangeBoundary {
  at: string;
  inclusive: boolean;
  [k: string]: unknown;
}
