import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  validateIndexingStatusV1Result,
  validateIndexingResetV1Params,
  validateIndexingResetV1Result,
  validateSidecarConfigureV1Params,
} from "../typescript/src/generated/validators.mjs";
import type { IndexingStatusV1Result } from "../typescript/src/index.js";
const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../conformance/fixtures/indexing-statistics.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as IndexingStatusV1Result;

describe("indexing statistics contract", () => {
  it("accepts native absolute directory paths and older v1 results", () => {
    for (const indexingDirectory of [
      "/Users/example/Library/Application Support/Erato/index",
      "C:\\Users\\example\\AppData\\Local\\Erato\\index",
      "\\\\server\\share\\Erato\\index",
    ]) {
      expect(
        validateIndexingStatusV1Result({ ...fixture, indexingDirectory }),
      ).toBe(true);
    }
    for (const indexingDirectory of [
      "",
      "relative/index",
      "~/index",
      "file:///tmp/index",
      "C:index",
    ]) {
      expect(
        validateIndexingStatusV1Result({ ...fixture, indexingDirectory }),
      ).toBe(false);
    }
    const legacy = structuredClone(fixture);
    delete legacy.indexingDirectory;
    expect(validateIndexingStatusV1Result(legacy)).toBe(true);
  });

  it("requires a completed and stopped reset response", () => {
    expect(validateIndexingResetV1Params({})).toBe(true);
    expect(validateIndexingResetV1Params(null)).toBe(false);
    expect(validateIndexingResetV1Params([])).toBe(false);
    const result = {
      completed: true,
      completedAt: "2026-09-15T12:00:00Z",
      state: "stopped",
    };
    expect(validateIndexingResetV1Result(result)).toBe(true);
    for (const bad of [
      { accepted: true },
      { ...result, completed: false },
      { ...result, state: "running" },
      { ...result, completedAt: "not-a-timestamp" },
    ])
      expect(validateIndexingResetV1Result(bad)).toBe(false);
  });

  it("validates a segmented active/rebuild snapshot and its arithmetic", () => {
    expect(validateIndexingStatusV1Result(fixture)).toBe(true);
    for (const generation of fixture.generations)
      for (const segment of generation.segments) {
        const b = segment.backlog;
        expect(b.remaining).toBe(
          b.ready! + b.inProgress! + b.retryDeferred! + b.blocked!,
        );
        expect(b.remaining).toBe(b.firstTime! + b.updates!);
        const c = segment.coverage;
        expect(c.knownEligible).toBe(
          c.indexedCurrent! +
            c.emptyCurrent! +
            c.unindexableCurrent! +
            c.stale! +
            c.neverProcessed!,
        );
        for (const w of segment.throughput)
          expect(w.completedPerMinute).toBe(
            w.indexedPerMinute! + w.emptyPerMinute! + w.unindexablePerMinute!,
          );
      }
  });
  it("allows unknown measurements and additive fields", () => {
    const data = structuredClone(fixture);
    data.resources.sidecar.cpuCoresUsed = null;
    data.resources.sidecar.unavailableMetrics = [
      { metric: "cpuCoresUsed", reason: "not_supported" },
    ];
    data.generations[0]!.segments[0]!.eta = {
      state: "unavailable",
      estimatedRemainingSeconds: null,
      estimatedCompletionAt: null,
      basis: "knownBacklog",
      rateWindowSeconds: 300,
      observationSeconds: 0,
      sampleCount: 0,
      unavailableReason: "warming_up",
    };
    expect(validateIndexingStatusV1Result({ ...data, futureField: true })).toBe(
      true,
    );
  });
  it("rejects negative counters, missing required statistics and misleading unavailable ETAs", () => {
    const data = structuredClone(fixture);
    data.generations[0]!.segments[0]!.backlog.remaining = -1;
    expect(validateIndexingStatusV1Result(data)).toBe(false);
    expect(
      validateIndexingStatusV1Result({ sampledAt: fixture.sampledAt }),
    ).toBe(false);
    data.generations[0]!.segments[0]!.backlog.remaining = 100;
    data.generations[0]!.segments[0]!.eta.state = "unavailable";
    expect(validateIndexingStatusV1Result(data)).toBe(false);
  });
  it("validates both nullable positive-integer knobs in either configuration layer", () => {
    for (const layer of ["user_configuration", "organization_configuration"]) {
      for (const key of [
        "indexing_parallelism",
        "indexing_documents_per_minute",
      ]) {
        for (const value of [null, 1, 120, 9007199254740991])
          expect(
            validateSidecarConfigureV1Params({
              user_configuration: {},
              organization_configuration: {},
              [layer]: { [key]: value },
            }),
          ).toBe(true);
        for (const value of [0, -1, 1.5, "2", false, 9007199254740992])
          expect(
            validateSidecarConfigureV1Params({
              user_configuration: {},
              organization_configuration: {},
              [layer]: { [key]: value },
            }),
          ).toBe(false);
      }
    }
  });
});
