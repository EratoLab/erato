import { DesktopSidecarClient } from "@erato/desktop-sidecar-protocol";
import { describe, expect, it, vi } from "vitest";

import { expectSidecarConfigurationAccepted } from "./__tests__/configurationTestUtils";
import {
  indexingStatusFixture,
  mailboxId as fixtureMailboxId,
  sourceId,
} from "./__tests__/indexingStatusFixture";
import {
  initializeMailboxConfiguration,
  mailboxCoverage,
  mailboxIndexingSummary,
  orderedMailboxes,
} from "./indexingConfiguration";

import type {
  IndexingStatusV1Result,
  OutlookMailbox,
  SidecarConfigureV1Params,
} from "@erato/desktop-sidecar-protocol";

const sharedId = "aabbccdd112244558899001122334455";
const sharedUuid = "aabbccdd-1122-4455-8899-001122334455";
const personalId = "bbccddee2233445599aa112233445566";
const personalUuid = "bbccddee-2233-4455-99aa-112233445566";

const mailboxes: OutlookMailbox[] = [
  {
    id: sharedId,
    displayName: "Shared",
    emailAddress: "shared@example.com",
    source: "pst",
  },
  {
    id: personalId,
    displayName: "Personal",
    emailAddress: "PERSONAL@example.com",
    source: "pst",
  },
];
const empty: SidecarConfigureV1Params = {
  user_configuration: { future_setting: true },
  organization_configuration: {},
};

describe("mailbox indexing configuration", () => {
  it("initializes a matching compact mailbox ID with a contract-valid UUID", async () => {
    const result = initializeMailboxConfiguration(
      empty,
      mailboxes,
      " personal@example.com ",
    );
    await expectSidecarConfigurationAccepted(result);
    expect(result.user_configuration).toEqual({
      future_setting: true,
      indexing_mailboxes: [
        { mailbox_id: personalUuid, enabled: true, priority: 0 },
      ],
    });
    expect(mailboxes[1].id).toBe(personalId);
    expect(
      initializeMailboxConfiguration(empty, mailboxes, "missing@example.com"),
    ).toBe(empty);
    expect(initializeMailboxConfiguration(empty, mailboxes, undefined)).toBe(
      empty,
    );
  });
  it("does not overwrite existing user or organization arrays, including empty ones", () => {
    for (const layer of [
      "user_configuration",
      "organization_configuration",
    ] as const) {
      for (const entries of [
        [],
        [{ mailbox_id: sharedUuid, enabled: false, priority: 3 }],
      ]) {
        const saved = { ...empty, [layer]: { indexing_mailboxes: entries } };
        expect(
          initializeMailboxConfiguration(
            saved,
            mailboxes,
            "personal@example.com",
          ),
        ).toBe(saved);
      }
    }
  });
  it("orders by explicit priority regardless of array order and inherits whole arrays", () => {
    const entries = [
      { mailbox_id: sharedUuid.toUpperCase(), enabled: false, priority: 10 },
      { mailbox_id: personalUuid, enabled: true, priority: 0 },
    ];
    for (const indexing_mailboxes of [entries, [...entries].reverse()]) {
      const ordered = orderedMailboxes(mailboxes, {
        user_configuration: { indexing_mailboxes: null },
        organization_configuration: { indexing_mailboxes },
      });
      expect(ordered.map((mailbox) => mailbox.id)).toEqual([
        personalId,
        sharedId,
      ]);
      expect(ordered[1].enabled).toBe(false);
      expect(ordered[1].priority).toBe(10);
    }
    expect(
      orderedMailboxes(mailboxes, {
        user_configuration: { indexing_mailboxes: [] },
        organization_configuration: { indexing_mailboxes: entries },
      }).map((mailbox) => mailbox.id),
    ).toEqual([sharedId, personalId]);
  });
  it("uses only active mailbox aggregates and preserves unknown counts", () => {
    const segment = {
      mailboxId: sharedUuid.toUpperCase(),
      kind: "file",
      fileType: null,
      coverage: { indexedCurrent: 2, knownEligible: 5 },
    };
    const status = {
      discovery: [],
      generations: [
        {
          role: "active",
          segments: [
            segment,
            { ...segment, fileType: "pdf" },
            { ...segment, mailboxId: null },
            { ...segment, mailboxId: personalUuid },
          ],
        },
        { role: "building", segments: [segment] },
      ],
    } as unknown as IndexingStatusV1Result;
    expect(mailboxCoverage(status, sharedId, "file")).toEqual({
      indexed: 2,
      total: 5,
    });
    expect(
      mailboxCoverage(status, "ccddee0033444455aabb223344556677", "file"),
    ).toEqual({
      indexed: null,
      total: null,
    });
    segment.coverage.knownEligible = null as unknown as number;
    expect(mailboxCoverage(status, sharedId, "file").total).toBeNull();
  });
});

describe("mailbox indexing summary", () => {
  function fixture() {
    const segment = {
      sourceId,
      mailboxId: sharedUuid,
      kind: "email",
      fileType: null,
      backlog: {
        discoveryComplete: true,
        remaining: 0,
        inProgress: 0,
        blocked: 0,
      },
      coverage: {
        indexedCurrent: 640,
        knownEligible: 640,
        emptyCurrent: 0,
        unindexableCurrent: 0,
        stale: 0,
        neverProcessed: 0,
        pendingDeletions: 0,
      },
    };
    return {
      state: "running",
      discovery: [
        {
          sourceId,
          mailboxId: sharedId,
          state: "complete",
          discoveryComplete: true,
          accessible: true,
          lastSuccessfulScanAt: "2026-09-22T10:00:00Z",
        },
      ],
      generations: [
        {
          role: "active",
          segments: [
            segment,
            {
              ...segment,
              kind: "file",
              coverage: {
                ...segment.coverage,
                indexedCurrent: 436,
                knownEligible: 436,
              },
            },
            { ...segment, mailboxId: null },
            { ...segment, fileType: "pdf" },
          ],
        },
        { role: "building", segments: [segment] },
      ],
    } as unknown as IndexingStatusV1Result;
  }
  it("combines only active mailbox aggregates and uses the successful scan", () => {
    expect(mailboxIndexingSummary(fixture(), sharedId, true)).toMatchObject({
      total: 1076,
      indexed: 1076,
      percentage: 100,
      state: "current",
      lastScan: Date.parse("2026-09-22T10:00:00Z"),
    });
  });
  it("prioritizes disabled, blocked and stopped states over completion", () => {
    const status = fixture();
    status.discovery[0].state = "failed";
    expect(mailboxIndexingSummary(status, sharedId, false).state).toBe(
      "disabled",
    );
    expect(mailboxIndexingSummary(status, sharedId, true).state).toBe(
      "scanFailed",
    );
    status.state = "stopped";
    expect(mailboxIndexingSummary(status, sharedId, true).state).toBe(
      "stopped",
    );
    status.state = "blocked";
    expect(mailboxIndexingSummary(status, sharedId, true).state).toBe(
      "indexingUnavailable",
    );
  });
  it("distinguishes inaccessible sources from blocked processing", () => {
    const status = fixture();
    status.discovery[0].accessible = false;
    status.discovery[0].state = "failed";
    expect(mailboxIndexingSummary(status, sharedId, true).state).toBe(
      "sourceUnavailable",
    );
    status.discovery[0].accessible = true;
    status.discovery[0].state = "complete";
    status.generations[0].segments[0].backlog.blocked = 1;
    expect(mailboxIndexingSummary(status, sharedId, true).state).toBe(
      "indexingUnavailable",
    );
    expect(mailboxIndexingSummary(status, sharedId, false).state).toBe(
      "disabled",
    );
  });
  it("does not mistake incomplete scans or unavailable counters for completion", () => {
    const status = fixture();
    status.discovery[0].discoveryComplete = false;
    expect(mailboxIndexingSummary(status, sharedId, true).state).toBe(
      "unavailable",
    );
    status.discovery[0].state = "scanning";
    expect(mailboxIndexingSummary(status, sharedId, true).state).toBe(
      "scanning",
    );
    status.discovery[0].lastSuccessfulScanAt = null;
    expect(mailboxIndexingSummary(status, sharedId, true).lastScan).toBeNull();
    status.generations[0].segments[0].coverage.knownEligible = null;
    expect(
      mailboxIndexingSummary(status, sharedId, true).percentage,
    ).toBeNull();
  });
  it("requires in-progress work for indexing and distinguishes queued work", () => {
    const status = fixture();
    const row = status.generations[0].segments[0];
    row.backlog.remaining = 1;
    expect(mailboxIndexingSummary(status, sharedId, true).state).toBe(
      "waiting",
    );
    row.backlog.inProgress = 1;
    expect(mailboxIndexingSummary(status, sharedId, true).state).toBe(
      "indexing",
    );
    row.backlog.inProgress = 0;
    row.backlog.remaining = 0;
    row.coverage.pendingDeletions = 1;
    expect(mailboxIndexingSummary(status, sharedId, true).state).toBe(
      "waiting",
    );
  });
  it("never rounds incomplete coverage to 100 and explains terminal outcomes", () => {
    const status = fixture();
    const row = status.generations[0].segments[0];
    row.coverage.indexedCurrent = 639;
    row.coverage.emptyCurrent = 1;
    expect(mailboxIndexingSummary(status, sharedId, true)).toMatchObject({
      percentage: 99,
      terminal: true,
      state: "complete",
    });
    row.coverage.emptyCurrent = 0;
    row.coverage.unindexableCurrent = 1;
    expect(mailboxIndexingSummary(status, sharedId, true)).toMatchObject({
      terminal: true,
      state: "partial",
    });
  });
  it("handles empty and missing inventories explicitly", () => {
    const status = fixture();
    for (const row of status.generations[0].segments) {
      row.coverage.knownEligible = 0;
      row.coverage.indexedCurrent = 0;
    }
    expect(mailboxIndexingSummary(status, sharedId, true)).toMatchObject({
      total: 0,
      percentage: null,
      state: "current",
    });
    status.generations = [];
    expect(mailboxIndexingSummary(status, sharedId, true)).toMatchObject({
      total: null,
      percentage: null,
      state: "unavailable",
    });
  });
});

describe("sparse mailbox status and missing local cache content", () => {
  const summary = (status = indexingStatusFixture()) =>
    mailboxIndexingSummary(status, fixtureMailboxId, true);

  it("matches compact mailbox IDs and case-insensitive source UUIDs", () => {
    const status = indexingStatusFixture();
    status.generations[0].segments[0].sourceId = sourceId.toUpperCase();
    status.discovery[0].mailboxId = fixtureMailboxId
      .replaceAll("-", "")
      .toUpperCase();
    expect(summary(status)).toMatchObject({
      total: 554,
      indexed: 552,
      state: "partial",
    });
  });

  it("accepts the sparse response through the real RPC validator and preserves the added counter", async () => {
    const status = indexingStatusFixture();
    const client = new DesktopSidecarClient({
      transport: {
        request: async (body: string) =>
          JSON.stringify({
            jsonrpc: "2.0",
            id: JSON.parse(body).id,
            result: status,
          }),
      },
      clientInfo: {
        name: "status-test",
        version: "1",
        host: { application: "test", runtime: "node" },
        os: { name: "test" },
      },
    });
    vi.spyOn(client, "supports").mockReturnValue(true);
    const response = await client.invoke("indexing.status.v1", {
      includeSourceBreakdowns: true,
      includeFileTypeBreakdowns: false,
    });
    expect(summary(response)).toMatchObject({
      total: 554,
      indexed: 552,
      percentage: 99,
      missingFromLocalCache: 2,
      state: "partial",
      terminal: false,
      hasUnindexable: false,
      lastScan: Date.parse(status.sampledAt),
    });
    expect(mailboxCoverage(response, fixtureMailboxId, "file")).toEqual({
      indexed: 0,
      total: 0,
    });
  });

  it.each(["email", "file"] as const)(
    "handles a mailbox containing only %s documents",
    (kind) => {
      const status = indexingStatusFixture();
      for (const row of status.generations[0].segments) {
        row.kind =
          row.kind === "email" ? kind : kind === "email" ? "file" : "email";
        if (row.coverage.knownEligible === 554) {
          row.coverage.indexedCurrent = 554;
          row.coverage.missingFromLocalCacheCurrent = 0;
        }
      }
      expect(summary(status)).toMatchObject({
        total: 554,
        indexed: 554,
        percentage: 100,
        state: "current",
      });
    },
  );

  it("recognizes a confirmed empty mailbox, without inventing counts before discovery", () => {
    const status = indexingStatusFixture();
    status.generations[0].segments = status.generations[0].segments.filter(
      (row) => row.mailboxId === null,
    );
    status.discovery[0].discoveredDocuments = 0;
    expect(summary(status)).toMatchObject({
      total: 0,
      indexed: 0,
      state: "current",
    });
    status.discovery[0].state = "notStarted";
    status.discovery[0].discoveryComplete = false;
    expect(summary(status)).toMatchObject({
      total: null,
      indexed: null,
      state: "waiting",
    });
    status.discovery = [];
    expect(summary(status)).toMatchObject({
      total: null,
      indexed: null,
      state: "unavailable",
      lastScan: null,
    });
  });

  it("does not infer zero when a known nonempty source has no breakdown", () => {
    const status = indexingStatusFixture();
    status.generations[0].segments = status.generations[0].segments.filter(
      (row) => row.mailboxId === null,
    );
    expect(summary(status)).toMatchObject({
      total: null,
      state: "unavailable",
    });
  });

  it("preserves unknown metrics and missing generations", () => {
    for (const damage of [
      (status: IndexingStatusV1Result) => {
        status.generations = [];
      },
      (status: IndexingStatusV1Result) => {
        status.generations[0].role = "building";
      },
      (status: IndexingStatusV1Result) => {
        status.generations[0].unavailableReason = "not_instrumented";
      },
      (status: IndexingStatusV1Result) => {
        status.generations[0].segments[0].coverage.knownEligible = null;
      },
      (status: IndexingStatusV1Result) => {
        status.generations[0].segments[0].coverage.unavailableReason =
          "not_instrumented";
      },
      (status: IndexingStatusV1Result) => {
        status.generations[0].segments[2].coverage.knownEligible = null;
      },
      (status: IndexingStatusV1Result) => {
        status.generations[0].segments[2].coverage.unavailableReason =
          "not_instrumented";
      },
      (status: IndexingStatusV1Result) => {
        status.generations[0].segments.pop();
      },
    ]) {
      const status = indexingStatusFixture();
      damage(status);
      expect(summary(status)).toMatchObject({
        total: null,
        percentage: null,
        state: "unavailable",
      });
    }
  });

  it("treats explicit null cache counters as unknown and omitted legacy counters as zero", () => {
    const status = indexingStatusFixture();
    const coverage = status.generations[0].segments[0].coverage;
    coverage.missingFromLocalCacheCurrent = null;
    expect(summary(status)).toMatchObject({
      total: 554,
      indexed: 552,
      missingFromLocalCache: null,
      state: "unavailable",
    });
    delete coverage.missingFromLocalCacheCurrent;
    expect(summary(status)).toMatchObject({
      missingFromLocalCache: 0,
      state: "unavailable",
    });
    coverage.indexedCurrent = 554;
    expect(summary(status)).toMatchObject({
      missingFromLocalCache: 0,
      state: "current",
    });
  });

  it("does not let terminal outcomes explain an unrelated coverage gap", () => {
    const status = indexingStatusFixture();
    const coverage = status.generations[0].segments[0].coverage;
    coverage.indexedCurrent = 550;
    coverage.emptyCurrent = 1;
    expect(summary(status)).toMatchObject({
      state: "unavailable",
      terminal: false,
    });
    coverage.unindexableCurrent = 1;
    expect(summary(status)).toMatchObject({
      state: "partial",
      terminal: true,
      hasUnindexable: true,
    });
  });

  it("supports all-missing mailboxes without classifying them as empty or failed extraction", () => {
    const status = indexingStatusFixture();
    Object.assign(status.generations[0].segments[0].coverage, {
      indexedCurrent: 0,
      missingFromLocalCacheCurrent: 554,
    });
    expect(summary(status)).toMatchObject({
      total: 554,
      indexed: 0,
      percentage: 0,
      missingFromLocalCache: 554,
      state: "partial",
      terminal: false,
    });
  });

  it("keeps lifecycle and failure states ahead of settled coverage", () => {
    const status = indexingStatusFixture();
    expect(mailboxIndexingSummary(status, fixtureMailboxId, false).state).toBe(
      "disabled",
    );
    status.state = "blocked";
    expect(summary(status).state).toBe("indexingUnavailable");
    status.state = "running";
    status.resetInProgress = true;
    expect(summary(status).state).toBe("stopped");
    status.resetInProgress = false;
    status.discovery[0].state = "failed";
    expect(summary(status).state).toBe("scanFailed");
    status.discovery[0].accessible = false;
    expect(summary(status).state).toBe("sourceUnavailable");
    status.discovery[0].accessible = true;
    status.discovery[0].state = "scanning";
    expect(summary(status)).toMatchObject({
      state: "scanning",
      total: 554,
      lastScan: Date.parse(status.sampledAt),
    });
    status.discovery[0].state = "complete";
    status.discovery[0].discoveryComplete = false;
    expect(summary(status).state).toBe("unavailable");
  });

  it("does not claim completion with pending or unknown work", () => {
    for (const damage of [
      (
        row: IndexingStatusV1Result["generations"][number]["segments"][number],
      ) => {
        row.backlog.remaining = 1;
      },
      (
        row: IndexingStatusV1Result["generations"][number]["segments"][number],
      ) => {
        row.backlog.retryDeferred = 1;
      },
      (
        row: IndexingStatusV1Result["generations"][number]["segments"][number],
      ) => {
        row.coverage.stale = 1;
      },
      (
        row: IndexingStatusV1Result["generations"][number]["segments"][number],
      ) => {
        row.coverage.neverProcessed = 1;
      },
      (
        row: IndexingStatusV1Result["generations"][number]["segments"][number],
      ) => {
        row.coverage.pendingDeletions = 1;
      },
    ]) {
      const status = indexingStatusFixture();
      damage(status.generations[0].segments[0]);
      expect(summary(status).state).toBe("waiting");
    }
    for (const field of ["remaining", "inProgress", "blocked"] as const) {
      const status = indexingStatusFixture();
      status.generations[0].segments[0].backlog[field] = null;
      expect(summary(status).state).toBe("unavailable");
    }
    const status = indexingStatusFixture();
    status.generations[0].segments[0].backlog.unavailableReason =
      "not_instrumented";
    expect(summary(status).state).toBe("unavailable");
  });

  it("sums distinct sources but never sums mailbox aggregates, file breakdowns or generations with them", () => {
    const status = indexingStatusFixture();
    const generation = status.generations[0];
    const row = generation.segments[0];
    const second = {
      ...globalThis.structuredClone(row),
      sourceId: "22222222-2222-4333-8444-555555555555",
    };
    generation.segments.push(second);
    status.discovery.push({
      ...status.discovery[0],
      sourceId: second.sourceId,
    });
    expect(summary(status)).toMatchObject({
      total: 1108,
      indexed: 1104,
      missingFromLocalCache: 4,
    });
    generation.segments.push({
      ...globalThis.structuredClone(row),
      fileType: "pdf",
    });
    status.generations.push({
      ...globalThis.structuredClone(generation),
      role: "building",
    });
    expect(summary(status).total).toBe(1108);
    generation.segments.push({
      ...globalThis.structuredClone(row),
      sourceId: null,
    });
    expect(summary(status)).toMatchObject({
      total: 554,
      indexed: 552,
      missingFromLocalCache: 2,
    });
    generation.segments = generation.segments.filter(
      (segment) => segment.sourceId === sourceId || segment.mailboxId === null,
    );
    expect(summary(status)).toMatchObject({
      total: null,
      state: "unavailable",
    });
  });
});
