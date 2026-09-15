/* This file is generated from the canonical JSON schemas. Do not edit. */

export interface SearchQueryV1Result {
  hits: {
    documentId: string;
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
