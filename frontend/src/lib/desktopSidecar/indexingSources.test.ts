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
  DEFAULT_MAILBOX_PRIORITY,
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

  it("knows which Outlook a source or legacy mailbox belongs to", () => {
    const hx = {
      ...sourceFixture(sourceId, false),
      sourceKind: "macOS Hx account",
    };
    expect(indexingEntries([mailbox], [hx], configuration)[0].variant).toBe(
      "newOutlookForMac",
    );
    const legacy = indexingEntries([mailbox], undefined, {
      user_configuration: {},
      organization_configuration: {},
    });
    expect(legacy[0]).toMatchObject({
      scope: "mailbox",
      variant: "newOutlookForMac",
    });
    expect(
      indexingEntries([{ ...mailbox, source: "pst" }], undefined, {
        user_configuration: {},
        organization_configuration: {},
      })[0].variant,
    ).toBe("classic");
  });

  it("marks the sources the sidecar matched to the work account", () => {
    const entries = indexingEntries(
      [mailbox],
      [
        { ...sourceFixture(sourceId, false), defaultReason: "workAccount" },
        { ...sourceFixture(teamsSourceIds[0]), defaultReason: "workAccount" },
        { ...sourceFixture(teamsSourceIds[1]), defaultReason: "guestAccount" },
      ],
      configuration,
    );
    expect(
      entries.map((entry) => [entry.id, entry.workAccount ?? false]),
    ).toEqual([
      [sourceId, true],
      [teamsSourceIds[0], true],
      [teamsSourceIds[1], false],
    ]);
  });

  it("lists sources per application, then by priority", () => {
    const entries = indexingEntries([mailbox], sources, {
      user_configuration: {
        indexing_sources: [
          { source_id: teamsSourceIds[1], enabled: true, priority: 0 },
          { source_id: sourceId, enabled: true, priority: 5 },
          { source_id: teamsSourceIds[0], enabled: true, priority: 1 },
        ],
      },
      organization_configuration: {},
    });
    expect(entries.map((entry) => [entry.product, entry.id])).toEqual([
      ["outlook", sourceId],
      ["teams", teamsSourceIds[1]],
      ["teams", teamsSourceIds[0]],
    ]);
  });

  it("starts sources without a policy from the priority the sidecar resolved", () => {
    const entries = indexingEntries(
      [mailbox],
      [
        { ...sourceFixture(sourceId, false), indexingPriority: 7 },
        { ...sourceFixture(teamsSourceIds[0]), indexingPriority: 0 },
        sourceFixture(teamsSourceIds[1]),
      ],
      configuration,
    );
    expect(entries.map((entry) => [entry.id, entry.priority])).toEqual([
      [sourceId, 0],
      [teamsSourceIds[0], 0],
      [teamsSourceIds[1], DEFAULT_MAILBOX_PRIORITY],
    ]);
    expect(
      indexingEntryPatch(configuration, [{ ...entries[1], enabled: false }])
        .indexing_sources,
    ).toContainEqual({
      source_id: teamsSourceIds[0],
      enabled: false,
      priority: 0,
    });
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

  it("shows each Teams account by organisation and keeps guest tenants next to their home account", () => {
    const teams = (
      id: string,
      account: NonNullable<(typeof sources)[number]["account"]>,
      displayName = "Daniel Person",
    ) => ({ ...sourceFixture(id), displayName, account });
    const home = {
      tenantId: "tenant-home",
      userId: "user-home",
      email: "daniel@home.example",
      userPrincipalName: "daniel@home.example",
      tenantName: "Home Org",
      userType: "Member",
    };
    const ids = [
      "e1111111-b222-4333-8444-c55555555555",
      "e2222222-b222-4333-8444-c55555555555",
      "e3333333-b222-4333-8444-c55555555555",
      "e4444444-b222-4333-8444-c55555555555",
      "e5555555-b222-4333-8444-c55555555555",
    ];
    const teamsSources = [
      teams(ids[0], {
        ...home,
        tenantId: "tenant-zeta",
        userId: "guest-zeta",
        userPrincipalName: "daniel_home.example#EXT#@zeta.onmicrosoft.com",
        tenantName: "Zeta Customer",
        userType: "Guest",
      }),
      teams(ids[1], {
        tenantId: "tenant-other",
        userId: "user-other",
        email: "Daniel@Other.example",
        tenantName: "Other Org",
        userType: "Member",
      }),
      teams(ids[2], home),
      teams(ids[3], {
        ...home,
        tenantId: "tenant-alpha",
        userId: "guest-alpha",
        tenantName: "Alpha Customer",
        userType: "Guest",
      }),
      teams(
        ids[4],
        {
          tenantId: "tenant-unknown",
          userId: "user-unknown",
          userPrincipalName: "daniel_home.example#EXT#@unknown.onmicrosoft.com",
        },
        "Teams account (tenant db4b298b…)",
      ),
    ];
    const config = {
      user_configuration: { indexing_sources: [] },
      organization_configuration: {},
    };
    const entries = indexingEntries([], teamsSources, config);
    expect(
      entries.map((entry) => [entry.id, entry.name, entry.account]),
    ).toEqual([
      [
        ids[4],
        "Teams account (tenant db4b298b…)",
        { email: null, guest: false },
      ],
      [ids[2], "Home Org", { email: "daniel@home.example", guest: false }],
      [ids[3], "Alpha Customer", { email: "daniel@home.example", guest: true }],
      [ids[0], "Zeta Customer", { email: "daniel@home.example", guest: true }],
      [ids[1], "Other Org", { email: "daniel@other.example", guest: false }],
    ]);
    expect(entries.every((entry) => entry.editable && !entry.number)).toBe(
      true,
    );
    expect(indexingEntries([], [...teamsSources].reverse(), config)).toEqual(
      entries,
    );

    const guest = entries.find((entry) => entry.id === ids[0])!;
    expect(
      indexingEntryPatch(config, [{ ...guest, enabled: false }])
        .indexing_sources,
    ).toEqual([
      { source_id: ids[0], enabled: false, priority: guest.priority },
    ]);
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
  it("isolates Teams source status from other logins, Outlook, aggregates, and building generations", () => {
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
    ).toMatchObject({
      state: "scanFailed",
      range: { kind: "indexed", from: Date.parse("2026-06-01T12:00:00Z") },
    });
    expect(
      sourceIndexingSummary(status, teamsSourceIds[1], "teams", true),
    ).toEqual({
      state: "current",
      range: {
        kind: "indexed",
        from: Date.parse("2026-06-02T12:00:00Z"),
        fromInclusive: true,
        through: null,
        olderPending: false,
      },
      observedAt: Date.parse("2026-09-15T12:00:00Z"),
      notices: { unreadable: false, notStoredLocally: false, cachedOnly: true },
    });
    expect(
      sourceIndexingSummary(status, sourceId, "outlook", true),
    ).toMatchObject({
      state: "current",
      range: { kind: "indexed", from: Date.parse("2025-03-14T12:00:00Z") },
      notices: { notStoredLocally: true, cachedOnly: false },
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
    expect(summary().state).toBe("unavailable");
    status.discovery[1].discoveredDocuments = 0;
    expect(summary().state).toBe("current");
    status.generations[0].segments = status.generations[0].segments.filter(
      (row) => row.sourceId !== null || row.kind !== "teams_message",
    );
    expect(summary().state).toBe("unavailable");
  });
});
