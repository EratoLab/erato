/* This file is generated from the canonical JSON schemas. Do not edit. */

export interface SearchQueryV1Result {
  hits: {
    documentId: string;
    /**
     * A URI identifying the document, ideally an externally retrievable URL.
     */
    uri?: string;
    /**
     * Externally relatable identifiers for the document. Identifier keys are open-ended so new identifier kinds do not require a protocol change.
     */
    external_ids?: {
      key: string;
      value: string;
    }[];
    chunkId: string | null;
    score: number;
    kind: string;
    title: string | null;
    sender: string | null;
    mailboxId: string | null;
    date: number | null;
    mimeType: string | null;
    conversationKey: string | null;
  }[];
  elapsedMs: number;
  blocksRead: number;
  candidatesScored: number;
}
