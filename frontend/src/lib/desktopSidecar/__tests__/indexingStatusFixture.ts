import example from "../../../../../desktop-sidecar-protocol/examples/indexing-statistics.json";

import type {
  IndexingStatusV1Result,
  SourcesListV1Result,
} from "@erato/desktop-sidecar-protocol";

export const mailboxId = "aabbccdd-1122-4455-8899-001122334455";
export const sourceId = "a1111111-b222-4333-8444-c55555555555";
export const teamsSourceIds = [
  "b1111111-b222-4333-8444-c55555555555",
  "c1111111-b222-4333-8444-c55555555555",
];

export function sourceFixture(
  id: string,
  teams = true,
): SourcesListV1Result["sources"][number] {
  return {
    sourceId: id,
    sourceKind: teams ? "teams" : "macos hx account",
    sourceKey: id,
    displayName: teams ? "Microsoft Teams local cache" : "Example mailbox",
    product: teams ? "teams" : "outlook",
    indexingEnabled: true,
    enabled: true,
    locator: teams ? {} : { mailboxId },
    discoveryCursor: null,
    completedScanId: null,
    lastSuccessAt: null,
    lastErrorCode: null,
  };
}

export function multiSourceStatusFixture(): IndexingStatusV1Result {
  const status = indexingStatusFixture();
  status.configuration = {
    user_configuration: { indexing_sources: [] },
    organization_configuration: {},
  };
  for (const [index, id] of teamsSourceIds.entries()) {
    const row = globalThis.structuredClone(status.generations[0].segments[0]);
    Object.assign(row, {
      sourceId: id,
      mailboxId: null,
      kind: "teams_message",
    });
    Object.assign(row.coverage, {
      knownEligible: 10 + index,
      indexedCurrent: 10 + index,
      missingFromLocalCacheCurrent: 0,
    });
    status.generations[0].segments.push(row);
    status.discovery.push({
      ...status.discovery[0],
      sourceId: id,
      mailboxId: null,
      discoveredDocuments: 10 + index,
    });
  }
  const aggregate = globalThis.structuredClone(
    status.generations[0].segments[3],
  );
  aggregate.sourceId = null;
  aggregate.coverage.knownEligible = 21;
  aggregate.coverage.indexedCurrent = 21;
  status.generations[0].segments.push(aggregate);
  return status;
}

/** A contract-valid sparse snapshot: email documents, no mailbox file row.
 * All identities are synthetic. Counters reproduce the reported Mac issue.
 */
export function indexingStatusFixture(): IndexingStatusV1Result {
  const sample = example.messages.find(
    ({ message }) => message.id === "indexing-status" && "result" in message,
  )?.message.result;
  const status = globalThis.structuredClone(
    sample,
  ) as unknown as IndexingStatusV1Result;
  const generation = status.generations[0];
  const email = generation.segments[0];
  Object.assign(email, { kind: "email", sourceId, mailboxId, fileType: null });
  Object.assign(email.coverage, {
    knownEligible: 554,
    indexedCurrent: 552,
    missingFromLocalCacheCurrent: 2,
    emptyCurrent: 0,
    unindexableCurrent: 0,
    stale: 0,
    neverProcessed: 0,
    pendingDeletions: 0,
    unavailableReason: null,
  });
  Object.assign(email.backlog, {
    discoveryComplete: true,
    remaining: 0,
    ready: 0,
    inProgress: 0,
    retryDeferred: 0,
    blocked: 0,
    firstTime: 0,
    updates: 0,
    unavailableReason: null,
  });
  const aggregate = {
    ...globalThis.structuredClone(email),
    sourceId: null,
    mailboxId: null,
  };
  const files = {
    ...globalThis.structuredClone(aggregate),
    kind: "file" as const,
    coverage: {
      ...aggregate.coverage,
      knownEligible: 0,
      indexedCurrent: 0,
      missingFromLocalCacheCurrent: 0,
    },
  };
  generation.role = "active";
  generation.unavailableReason = null;
  generation.segments = [email, aggregate, files];
  status.generations = [generation];
  status.state = "running";
  status.resetInProgress = false;
  status.discovery = [
    {
      sourceId,
      mailboxId,
      state: "complete",
      discoveryComplete: true,
      scanStartedAt: status.sampledAt,
      lastSuccessfulScanAt: status.sampledAt,
      discoveredDocuments: 554,
      accessible: true,
      lastErrorCode: null,
    },
  ];
  return status;
}
