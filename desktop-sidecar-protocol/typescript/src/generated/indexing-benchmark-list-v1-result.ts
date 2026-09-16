/* This file is generated from the canonical JSON schemas. Do not edit. */

export interface IndexingBenchmarkListV1Result {
  /**
   * @maxItems 100
   */
  runs: {
    runId: string;
    mailboxId: string;
    mode: "fiveMinutes" | "fullMailbox";
    state: "preparing" | "running" | "completed" | "failed";
    startedAt: string;
    finishedAt: string | null;
  }[];
  nextOffset: number | null;
}
