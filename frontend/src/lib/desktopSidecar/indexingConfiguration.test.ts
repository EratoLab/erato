import { describe, expect, it } from "vitest";

import {
  initializeMailboxConfiguration,
  mailboxCoverage,
  orderedMailboxes,
} from "./indexingConfiguration";

import type {
  IndexingStatusV1Result,
  OutlookMailbox,
  SidecarConfigureV1Params,
} from "@erato/desktop-sidecar-protocol";

const mailboxes: OutlookMailbox[] = [
  {
    id: "a",
    displayName: "Shared",
    emailAddress: "shared@example.com",
    source: "pst",
  },
  {
    id: "b",
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
  it("initializes only a matching email and preserves unrelated settings", () => {
    const result = initializeMailboxConfiguration(
      empty,
      mailboxes,
      " personal@example.com ",
    );
    expect(result.user_configuration).toEqual({
      future_setting: true,
      indexing_mailboxes: [{ mailbox_id: "b", enabled: true, priority: 0 }],
    });
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
        [{ mailbox_id: "a", enabled: false, priority: 3 }],
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
      { mailbox_id: "a", enabled: false, priority: 10 },
      { mailbox_id: "b", enabled: true, priority: 0 },
    ];
    for (const indexing_mailboxes of [entries, [...entries].reverse()]) {
      const ordered = orderedMailboxes(mailboxes, {
        user_configuration: { indexing_mailboxes: null },
        organization_configuration: { indexing_mailboxes },
      });
      expect(ordered.map((mailbox) => mailbox.id)).toEqual(["b", "a"]);
      expect(ordered[1].enabled).toBe(false);
    }
    expect(
      orderedMailboxes(mailboxes, {
        user_configuration: { indexing_mailboxes: [] },
        organization_configuration: { indexing_mailboxes: entries },
      }).map((mailbox) => mailbox.id),
    ).toEqual(["a", "b"]);
  });
  it("uses only active mailbox aggregates and preserves unknown counts", () => {
    const segment = {
      mailboxId: "a",
      kind: "file",
      fileType: null,
      coverage: { indexedCurrent: 2, knownEligible: 5 },
    };
    const status = {
      generations: [
        {
          role: "active",
          segments: [
            segment,
            { ...segment, fileType: "pdf" },
            { ...segment, mailboxId: null },
          ],
        },
        { role: "building", segments: [segment] },
      ],
    } as unknown as IndexingStatusV1Result;
    expect(mailboxCoverage(status, "a", "file")).toEqual({
      indexed: 2,
      total: 5,
    });
    expect(mailboxCoverage(status, "missing", "file")).toEqual({
      indexed: null,
      total: null,
    });
    segment.coverage.knownEligible = null as unknown as number;
    expect(mailboxCoverage(status, "a", "file").total).toBeNull();
  });
});
