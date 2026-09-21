import { describe, expect, it } from "vitest";

import { expectSidecarConfigurationAccepted } from "./__tests__/configurationTestUtils";
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
