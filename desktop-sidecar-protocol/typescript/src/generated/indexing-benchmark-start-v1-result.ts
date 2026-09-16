/* This file is generated from the canonical JSON schemas. Do not edit. */

export interface IndexingBenchmarkStartV1Result {
  runId: string;
  mailboxId: string;
  mode: "fiveMinutes" | "fullMailbox";
  state: "preparing" | "running" | "completed" | "failed";
  parallelism: number;
  elapsedSeconds: number;
  discoveredDocuments: number;
  indexedDocuments: number;
  failedDocuments: number;
  indexedByType: {
    [k: string]: number;
  };
  mailboxBytes: number;
  emailsWithUnknownSize: number;
  discoveryComplete: boolean;
  timedOut: boolean;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}
