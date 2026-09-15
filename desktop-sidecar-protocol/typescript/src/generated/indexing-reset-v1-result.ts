/* This file is generated from the canonical JSON schemas. Do not edit. */

/**
 * Returned only after processing has stopped, database handles have closed, and every managed indexing file has been removed. Does not merely acknowledge scheduling a reset.
 */
export interface IndexingResetV1Result {
  completed: true;
  completedAt: string;
  state: "stopped";
  [k: string]: unknown;
}
