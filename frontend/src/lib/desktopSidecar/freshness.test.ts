import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  conversationScope,
  documentScope,
  searchChanges,
  sidecarFreshness,
} from "./freshness";

import type { SearchQueryV1Result } from "@erato/desktop-sidecar-protocol";

type Coverage = NonNullable<SearchQueryV1Result["coverage"]>;
type Source = Coverage["sources"][number];

const READ_AT = Date.parse("2026-10-30T12:00:00Z");

const source = (overrides: Partial<Source> = {}): Source => ({
  sourceId: "source-a",
  mailboxId: null,
  product: "outlook",
  displayName: "Work",
  accountEmail: "jane@example.com",
  from: { at: "2026-01-01T00:00:00Z", inclusive: true },
  through: null,
  observedAt: "2026-10-30T12:00:01Z",
  pendingNewer: 0,
  olderPending: 0,
  unsearchable: 0,
  undated: 0,
  dateBasis: "emailReceivedAtThenSentAt",
  inventory: "localStore",
  unavailableReason: null,
  ...overrides,
});

const coverage = (sources: Source[]): Coverage => ({
  sampledAt: "2026-10-30T12:00:01Z",
  basis: "index",
  sources,
});

const sha256 = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");

describe("search freshness", () => {
  it("says none only for an index caught up since the read began", () => {
    expect(
      searchChanges(
        coverage([source(), source({ sourceId: "source-b" })]),
        READ_AT,
      ),
    ).toBe("none");
    expect(
      searchChanges(
        coverage([source({ observedAt: "2026-10-30T12:00:00Z" })]),
        READ_AT,
      ),
    ).toBe("none");
  });

  it.each<[string, Coverage | undefined]>([
    ["no coverage", undefined],
    ["no source", coverage([])],
    [
      "a source observed before the read",
      coverage([source({ observedAt: "2026-10-30T11:59:59Z" })]),
    ],
    ["an unknown observation", coverage([source({ observedAt: null })])],
    ["an unknown queue", coverage([source({ pendingNewer: null })])],
    [
      "newer items queued",
      coverage([
        source({
          pendingNewer: 1,
          through: { at: "2026-10-29T00:00:00Z", inclusive: true },
        }),
      ]),
    ],
    [
      "an unavailable source",
      coverage([source(), source({ unavailableReason: "not_configured" })]),
    ],
  ])("says unknown for %s", (_name, value) => {
    expect(searchChanges(value, READ_AT)).toBe("unknown");
  });

  it("reports when the read began, zero counts and no context version", () => {
    expect(sidecarFreshness(READ_AT)).toEqual({
      readAt: "2026-10-30T12:00:00.000Z",
      changes: "unknown",
      counts: { own: 0, local: 0, remote: 0, unknown: 0 },
    });
  });
});

describe("scope signal", () => {
  const unknownPosition = { position: "unknown", added: "unknown" };

  it("names a document by the index's own id", async () => {
    for (const subjectScope of [undefined, "subject"]) {
      expect(
        await documentScope(
          "AAAAAAAA-1111-4111-8111-111111111111",
          subjectScope,
          undefined,
        ),
      ).toEqual({
        kind: "document",
        id: "doc:aaaaaaaa-1111-4111-8111-111111111111",
        ...unknownPosition,
      });
    }
  });

  it("names a thread export by the thread its search hit is in", async () => {
    const hit = {
      kind: "email",
      sourceId: "11111111-2222-4333-8444-555555555555",
      mailboxId: "a".repeat(32),
      conversationKey: "conversation-1",
    };
    const scope = await documentScope("doc", "subject_with_thread", hit);
    expect(scope).toEqual({
      kind: "thread",
      id: `index-thread:${sha256(
        JSON.stringify([hit.sourceId, hit.mailboxId, hit.conversationKey]),
      )}`,
      ...unknownPosition,
    });
    expect(
      await documentScope("other-doc", "subject_with_thread", { ...hit }),
    ).toEqual(scope);
    expect(
      (
        await documentScope("doc", "subject_with_thread", {
          kind: "email",
          mailboxId: null,
          conversationKey: "conversation-1",
        })
      ).id,
    ).toBe(
      `index-thread:${sha256(JSON.stringify([null, null, "conversation-1"]))}`,
    );
  });

  it.each([
    ["no search hit", undefined],
    [
      "no conversation key",
      { kind: "email", mailboxId: null, conversationKey: null },
    ],
    [
      "an empty conversation key",
      { kind: "email", mailboxId: null, conversationKey: "" },
    ],
    // The hit carries the chat's or channel's key, wider than what the read
    // returns.
    [
      "a Teams message",
      {
        kind: "teams_message",
        sourceId: "11111111-2222-4333-8444-555555555555",
        mailboxId: null,
        conversationKey: "19:channel@thread.tacv2",
      },
    ],
  ])("leaves a thread export unknown with %s", async (_name, hit) => {
    expect(await documentScope("doc", "subject_with_thread", hit)).toEqual({
      kind: "thread",
      id: "unknown",
      ...unknownPosition,
    });
  });

  it("names a file by its own id even when its thread was asked for", async () => {
    // An attachment's hit carries its email's thread, which its export never
    // includes.
    expect(
      await documentScope("FILE-DOC", "subject_with_thread", {
        kind: "file",
        sourceId: "11111111-2222-4333-8444-555555555555",
        mailboxId: "a".repeat(32),
        conversationKey: "conversation-1",
      }),
    ).toEqual({ kind: "document", id: "doc:file-doc", ...unknownPosition });
  });

  const guid = "0123456789abcdef0123456789abcdef";
  const index = (thread: string, child = "") => `01d7a1b2c3d4${thread}${child}`;

  it("names a conversation by the thread its messages agree on", async () => {
    const mailbox = "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA";
    const scope = await conversationScope(mailbox, [
      { conversationIndex: index(guid.toUpperCase()) },
      { conversationIndex: index(guid, "0000012345") },
      {},
    ]);
    expect(scope).toEqual({
      kind: "thread",
      id: `outlook-thread:${sha256(JSON.stringify(["a".repeat(32), guid]))}`,
      ...unknownPosition,
    });
  });

  it.each([
    ["no conversation index", [{}, { conversationIndex: "abc" }]],
    [
      "disagreeing threads",
      [
        { conversationIndex: index(guid) },
        { conversationIndex: index("f".repeat(32)) },
      ],
    ],
  ])("leaves a conversation unknown with %s", async (_name, messages) => {
    expect(await conversationScope("a".repeat(32), messages)).toMatchObject({
      kind: "thread",
      id: "unknown",
    });
  });
});
