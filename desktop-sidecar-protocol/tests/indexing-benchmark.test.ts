import { describe, expect, it } from "vitest";
import {
  validateIndexingBenchmarkListV1Params,
  validateIndexingBenchmarkListV1Result,
  validateIndexingBenchmarkStartV1Params,
  validateIndexingBenchmarkStatusV1Params,
  validateIndexingBenchmarkStartV1Result,
  validateIndexingBenchmarkStatusV1Result,
} from "../typescript/src/generated/validators.mjs";

const id = "00000000-0000-4000-8000-000000000001";
describe("indexing benchmark contract", () => {
  it("requires mailbox/run IDs and limits the mode to supported passes", () => {
    expect(validateIndexingBenchmarkStartV1Params({ mailboxId: id })).toBe(
      true,
    );
    expect(
      validateIndexingBenchmarkStartV1Params({
        mailboxId: id.replaceAll("-", ""),
      }),
    ).toBe(true);
    for (const mode of ["fiveMinutes", "fullMailbox"])
      expect(
        validateIndexingBenchmarkStartV1Params({ mailboxId: id, mode }),
      ).toBe(true);
    for (const value of [
      {},
      { mailboxId: "bad" },
      { mailboxId: id, mode: "forever" },
      { mailboxId: id, parallelism: 1 },
    ])
      expect(validateIndexingBenchmarkStartV1Params(value)).toBe(false);
    expect(validateIndexingBenchmarkStatusV1Params({ runId: id })).toBe(true);
    expect(validateIndexingBenchmarkStatusV1Params({ mailboxId: id })).toBe(
      false,
    );
  });
  it("validates partial terminal statistics as well as in-progress snapshots", () => {
    const result = {
      runId: id,
      startedAt: "2026-09-16T10:00:00Z",
      finishedAt: "2026-09-16T10:05:00Z",
      mailboxId: id,
      mode: "fiveMinutes",
      state: "completed",
      parallelism: 8,
      elapsedSeconds: 300.5,
      discoveredDocuments: 20,
      indexedDocuments: 10,
      failedDocuments: 1,
      indexedByType: { email: 8, "application/pdf": 2 },
      mailboxBytes: 2048,
      emailsWithUnknownSize: 1,
      discoveryComplete: false,
      timedOut: true,
      error: null,
    };
    for (const validate of [
      validateIndexingBenchmarkStartV1Result,
      validateIndexingBenchmarkStatusV1Result,
    ]) {
      expect(validate(result)).toBe(true);
      for (const state of ["preparing", "running", "failed"])
        expect(validate({ ...result, state })).toBe(true);
      expect(validate({ ...result, parallelism: 0 })).toBe(false);
      expect(validate({ ...result, indexedDocuments: -1 })).toBe(false);
      expect(validate({ ...result, indexedByType: { email: -1 } })).toBe(false);
    }
  });
  it("validates bounded history pages and rediscoverable summaries", () => {
    expect(validateIndexingBenchmarkListV1Params({})).toBe(true);
    expect(
      validateIndexingBenchmarkListV1Params({ limit: 10, offset: 20 }),
    ).toBe(true);
    for (const value of [
      { limit: 0 },
      { limit: 101 },
      { offset: -1 },
      { offset: 0.5 },
    ])
      expect(validateIndexingBenchmarkListV1Params(value)).toBe(false);
    const run = {
      runId: id,
      mailboxId: id,
      mode: "fiveMinutes",
      state: "failed",
      startedAt: "2026-09-16T10:00:00Z",
      finishedAt: "2026-09-16T10:01:00Z",
    };
    expect(
      validateIndexingBenchmarkListV1Result({ runs: [run], nextOffset: 1 }),
    ).toBe(true);
    expect(
      validateIndexingBenchmarkListV1Result({ runs: [], nextOffset: null }),
    ).toBe(true);
    expect(
      validateIndexingBenchmarkListV1Result({
        runs: [{ ...run, startedAt: "bad" }],
        nextOffset: null,
      }),
    ).toBe(false);
  });
});
