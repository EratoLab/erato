import { describe, expect, it } from "vitest";

import { expectSidecarConfigurationAccepted } from "./__tests__/configurationTestUtils";
import {
  mailboxId,
  sourceId,
  sourceFixture,
  teamsSourceIds,
  multiSourceStatusFixture,
} from "./__tests__/indexingStatusFixture";
import {
  initializeMailboxConfiguration,
  sourceIndexingSummary,
} from "./indexingConfiguration";
import { indexingEntries, indexingEntryPatch } from "./indexingSources";

import type { SidecarConfigureV1Params } from "@erato/desktop-sidecar-protocol";

const mailbox = {
  id: mailboxId.replaceAll("-", ""),
  emailAddress: "person@example.com",
  displayName: "Person",
  source: "macOsHxAccount",
  sourceIds: [sourceId],
};
const sources = [
  sourceFixture(sourceId, false),
  ...teamsSourceIds.map((id) => sourceFixture(id)),
];
const configuration: SidecarConfigureV1Params = {
  user_configuration: {
    indexing_sources: [{ source_id: sourceId, enabled: false, priority: 0 }],
  },
  organization_configuration: {},
};

describe("source indexing settings", () => {
  it("shows Outlook once and keeps equally named Teams caches separate and stably numbered", () => {
    const entries = indexingEntries([mailbox], sources, configuration);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      id: sourceId,
      scope: "source",
      name: "person@example.com",
      enabled: false,
    });
    expect(entries.slice(1).map((entry) => [entry.id, entry.number])).toEqual([
      [teamsSourceIds[0], 1],
      [teamsSourceIds[1], 2],
    ]);
    expect(
      indexingEntries([mailbox], [...sources].reverse(), configuration),
    ).toEqual(entries);
  });

  it("inherits the whole source policy array and respects null versus empty", () => {
    const config = {
      user_configuration: { indexing_sources: null },
      organization_configuration: configuration.user_configuration,
    };
    expect(indexingEntries([mailbox], sources, config)[0].enabled).toBe(false);
    expect(
      indexingEntries([mailbox], sources, {
        ...config,
        user_configuration: { indexing_sources: [] },
      }).find((entry) => entry.id === sourceId)?.enabled,
    ).toBe(true);
  });

  it("preserves disconnected policies, future fields, and other source enablement on edits", async () => {
    const hidden = {
      source_id: "d1111111-b222-4333-8444-c55555555555",
      enabled: false,
      priority: 99,
      future: true,
    };
    const config = globalThis.structuredClone(configuration);
    config.user_configuration.indexing_sources?.push(hidden, {
      source_id: teamsSourceIds[0].toUpperCase(),
      enabled: true,
      priority: 10,
      future: "preserved",
    });
    const entries = indexingEntries([mailbox], sources, config);
    const teams = entries.find((entry) => entry.id === teamsSourceIds[0])!;
    const patch = indexingEntryPatch(config, [{ ...teams, enabled: false }]);
    expect(patch.indexing_sources).toEqual([
      config.user_configuration.indexing_sources![0],
      hidden,
      {
        source_id: teamsSourceIds[0],
        enabled: false,
        priority: 10,
        future: "preserved",
      },
    ]);
    expect(patch.indexing_mailboxes).toBeUndefined();
    await expectSidecarConfigurationAccepted({
      ...config,
      user_configuration: { ...config.user_configuration, ...patch },
    });
    const reordered = indexingEntryPatch(
      config,
      [...entries].reverse().map((entry, priority) => ({ ...entry, priority })),
    );
    expect(reordered.indexing_sources).toContainEqual(hidden);
    expect(
      reordered.indexing_sources?.find(
        (policy) => policy.source_id === sourceId,
      )?.enabled,
    ).toBe(false);
  });

  it("falls back to legacy mailbox controls while showing older Teams statistics read-only", () => {
    const config = { user_configuration: {}, organization_configuration: {} };
    const entries = indexingEntries([mailbox], sources, config);
    expect(entries).toHaveLength(3);
    expect(entries.find((entry) => entry.product === "outlook")).toMatchObject({
      scope: "mailbox",
      editable: true,
    });
    const teams = entries.find((entry) => entry.product === "teams")!;
    expect(teams.editable).toBe(false);
    expect(indexingEntryPatch(config, [{ ...teams, enabled: false }])).toEqual(
      {},
    );
    expect(indexingEntries([mailbox], undefined, config)).toHaveLength(1);
  });

  it("keeps mailboxes missing from the catalog visible and does not initialize over source policies", () => {
    expect(indexingEntries([mailbox], [], configuration)[0].scope).toBe(
      "mailbox",
    );
    expect(
      initializeMailboxConfiguration(
        configuration,
        [mailbox],
        mailbox.emailAddress,
      ),
    ).toBe(configuration);
  });
});

describe("source indexing statistics", () => {
  it("isolates Teams source counts from other logins, Outlook, aggregates, and building generations", () => {
    const status = multiSourceStatusFixture();
    status.generations.unshift({
      ...globalThis.structuredClone(status.generations[0]),
      role: "building",
    });
    status.discovery[1].state = "failed";
    status.discovery[1].discoveryComplete = false;
    expect(
      sourceIndexingSummary(
        status,
        teamsSourceIds[0].toUpperCase(),
        "teams",
        true,
      ),
    ).toMatchObject({ state: "scanFailed", indexed: 10, total: 10 });
    expect(
      sourceIndexingSummary(status, teamsSourceIds[1], "teams", true),
    ).toMatchObject({
      state: "current",
      indexed: 11,
      total: 11,
      percentage: 100,
    });
    expect(
      sourceIndexingSummary(status, sourceId, "outlook", true),
    ).toMatchObject({
      state: "partial",
      indexed: 552,
      total: 554,
      missingFromLocalCache: 2,
    });
    expect(
      sourceIndexingSummary(status, teamsSourceIds[1], "teams", false).state,
    ).toBe("disabled");
  });

  it("infers an empty Teams inventory only after a complete empty scan with measured Teams aggregates", () => {
    const status = multiSourceStatusFixture();
    status.generations[0].segments = status.generations[0].segments.filter(
      (row) => row.sourceId !== teamsSourceIds[0],
    );
    const summary = () =>
      sourceIndexingSummary(status, teamsSourceIds[0], "teams", true);
    expect(summary()).toMatchObject({ state: "unavailable", total: null });
    status.discovery[1].discoveredDocuments = 0;
    expect(summary()).toMatchObject({ state: "current", total: 0 });
    status.generations[0].segments = status.generations[0].segments.filter(
      (row) => row.sourceId !== null || row.kind !== "teams_message",
    );
    expect(summary()).toMatchObject({ state: "unavailable", total: null });
  });
});
