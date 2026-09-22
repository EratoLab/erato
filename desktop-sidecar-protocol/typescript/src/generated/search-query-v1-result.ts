/* This file is generated from the canonical JSON schemas. Do not edit. */

/**
 * Externally relatable identifiers for the document. Identifier keys are open-ended so new identifier kinds do not require a protocol change.
 */
export type DocumentExternalIds = {
  key: string;
  value: string;
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
    mailboxId: string | null;
    date: number | null;
    mimeType: string | null;
    conversationKey: string | null;
    topLevelParent?: TopLevelParent;
  }[];
  elapsedMs: number;
  blocksRead: number;
  candidatesScored: number;
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
}
