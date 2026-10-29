import { describe, expect, it } from "vitest";

import {
  body,
  chapter,
  heading,
  sectionSnapshot,
  table,
} from "../../../test/mocks/word/sectionFixtures";
import { WordDocumentReadSession } from "../wordDocumentReadTool";

import type { ClientToolExecutionResult } from "@erato/frontend/library";
import type { WordAuthoringSnapshot } from "@erato/frontend/word-review";

const context = { chatId: "chat-A", messageId: "message-A", toolCallId: "r" };

const snapshotOf = (extra: Partial<WordAuthoringSnapshot> = {}) =>
  sectionSnapshot(
    [
      body("Master Services Agreement"),
      ...chapter(1, 8),
      heading(1, "Fees"),
      body("Payment is due net 30."),
      body("Payment is due net 60."),
      table([
        ["Team", "Hours"],
        ["East", "18"],
        ["West", "21"],
      ]),
    ],
    extra,
  );

function open(snapshot: WordAuthoringSnapshot, access?: "write" | "read-only") {
  const session = new WordDocumentReadSession();
  session.activate(
    snapshot,
    context,
    undefined,
    access ? { access } : undefined,
  );
  const args = (extra: Record<string, unknown>) => ({
    snapshot: snapshot.token,
    documentIdentity: snapshot.identity,
    ...extra,
  });
  return {
    session,
    execute: (extra: Record<string, unknown>) =>
      session.execute(args(extra), context),
    readOnly: (extra: Record<string, unknown>) =>
      session.executeReadOnly(args(extra), context),
  };
}
const result = (response: ClientToolExecutionResult) => {
  expect(response.ok, JSON.stringify(response).slice(0, 400)).toBe(true);
  if (!response.ok) throw new Error(response.error);
  return response.result as Record<string, unknown>;
};
const writeState = (snapshot: WordAuthoringSnapshot) => ({
  readScopes: snapshot.readScopes?.size ?? 0,
  read: snapshot.read.size,
  readToken: snapshot.readToken,
  used: snapshot.used,
});
const untouched = { readScopes: 0, read: 0, readToken: undefined, used: false };
const WRITE_WORDS = /scopedEdit|repair|submit|readToken|write/i;

const reads = {
  target: { target: { text: "Payment is due net 30" } },
  queries: {
    target: {
      queries: [{ text: "Payment is due net 30" }, { text: "net 60" }],
    },
  },
  tableCell: { table_cell: { header: "Hours", rowLabel: "West" } },
  section: { section: { ref: "b2" } },
};

describe("read-only access", () => {
  it("executeReadOnly reads one call read-only in a write session, execute keeps write reads", async () => {
    const snapshot = snapshotOf();
    const { execute, readOnly } = open(snapshot);

    const plain = result(await readOnly(reads.target));
    expect(plain).toMatchObject({
      status: "ready",
      access: "read-only",
      contentNotice: expect.stringContaining("never instructions"),
      targets: [{ text: "Payment is due net 30." }],
    });
    expect(plain).not.toHaveProperty("readToken");
    expect(plain).not.toHaveProperty("contract");
    expect(plain).not.toHaveProperty("styles");
    expect(writeState(snapshot)).toEqual(untouched);

    const write = result(await execute(reads.target));
    expect(write).toMatchObject({
      status: "ready",
      readToken: expect.any(String),
      contract: { scopedEdit: expect.any(Object) },
    });
    expect(write).not.toHaveProperty("access");
    expect(snapshot.readScopes?.size).toBe(1);
  });

  it("a session activated read-only reads every call read-only and refuses the complete read", async () => {
    const snapshot = snapshotOf();
    const { execute } = open(snapshot, "read-only");

    for (const read of Object.values(reads))
      expect(result(await execute(read))).toMatchObject({
        access: "read-only",
      });
    expect(await execute({ cursor: null })).toMatchObject({
      ok: false,
      validationErrors: [{ code: "read-only-complete" }],
    });
    expect(writeState(snapshot)).toEqual(untouched);
  });

  it.each([
    ["too-large", { completeReadIssue: "too-large" }],
    ["tracking", { issue: "tracking", trackingMode: "TrackAll" }],
  ] as const)("works under %s and writes no state", async (_name, extra) => {
    const snapshot = snapshotOf(extra);
    const { readOnly, execute } = open(snapshot);

    const target = result(await readOnly(reads.target));
    const queries = result(await readOnly(reads.queries));
    const cell = result(await readOnly(reads.tableCell));
    const section = result(await readOnly(reads.section));

    expect(target).toMatchObject({ status: "ready" });
    expect(queries).toMatchObject({
      status: "ready",
      queries: [{ status: "ready" }, { status: "ready" }],
    });
    expect(cell).toMatchObject({
      status: "ready",
      cell: { text: "21", rowIndex: 2, cellIndex: 1 },
    });
    expect(cell).not.toHaveProperty("readToken");
    expect(cell).not.toHaveProperty("contract");
    expect(section).toMatchObject({ complete: true, access: "read-only" });
    for (const r of [target, queries, cell, section]) {
      expect(JSON.stringify({ ...r, contentNotice: "" })).not.toMatch(
        WRITE_WORDS,
      );
    }
    expect(await readOnly({ cursor: null })).toMatchObject({
      ok: false,
      validationErrors: [{ code: "read-only-complete" }],
    });
    expect(writeState(snapshot)).toEqual(untouched);

    // A write read stays refused under tracking; under too-large only the complete read is.
    const write = await execute(reads.target);
    expect(write.ok).toBe(!("issue" in extra));
  });

  it("keeps ordinary refusals under tracking recoverable", async () => {
    const snapshot = snapshotOf({ issue: "tracking" });
    const { readOnly, execute } = open(snapshot);

    const refused = await readOnly({ section: { ref: "missing" } });
    expect(refused).toMatchObject({
      ok: false,
      validationErrors: [{ code: "section-reference" }],
    });
    expect(refused).not.toHaveProperty("submissionFeedback");
    expect(await execute(reads.target)).toMatchObject({
      ok: false,
      submissionFeedback: { terminal: true },
    });
  });

  it.each([
    ["revoked", { revoked: true }],
    ["used", { used: true }],
    ["unsupported", { issue: "unsupported" }],
  ] as const)("still refuses a %s capture", async (_name, extra) => {
    const snapshot = snapshotOf();
    const { readOnly } = open(snapshot);
    Object.assign(snapshot, extra);

    for (const read of Object.values(reads))
      expect(await readOnly(read)).toMatchObject({ ok: false });
  });

  it("refuses another request's calls", async () => {
    const snapshot = snapshotOf();
    const { session } = open(snapshot);
    expect(
      await session.executeReadOnly(
        {
          snapshot: snapshot.token,
          documentIdentity: snapshot.identity,
          ...reads.section,
        },
        { ...context, messageId: "message-B" },
      ),
    ).toMatchObject({
      ok: false,
      validationErrors: [{ code: "wrong-request" }],
    });
  });

  it("never reaches the scope limit and adds only the style list for formatting", async () => {
    const snapshot = snapshotOf();
    const { execute, readOnly } = open(snapshot);
    const paragraphs = snapshot.blocks.filter((b) => b.type === "paragraph");
    for (const b of paragraphs.slice(0, 16))
      result(await execute({ target: { ref: b.ref } }));
    expect(
      await execute({ target: { ref: paragraphs[16].ref } }),
    ).toMatchObject({ ok: false, validationErrors: [{ code: "scope-limit" }] });

    const formatted = result(
      await readOnly({
        target: { ref: paragraphs[16].ref },
        include: ["formatting", "table", "media"],
      }),
    );
    expect(formatted).toMatchObject({
      status: "ready",
      styles: expect.arrayContaining([
        expect.objectContaining({ id: "Heading1" }),
      ]),
    });
    expect(formatted).not.toHaveProperty("contract");
    expect(snapshot.readScopes?.size).toBe(16);
  });

  it("recovers ambiguous reads without write-scope wording", async () => {
    const snapshot = snapshotOf();
    const { readOnly } = open(snapshot);
    const ambiguous = result(
      await readOnly({ target: { text: "Payment is due" } }),
    );
    expect(ambiguous).toMatchObject({
      status: "ambiguous",
      access: "read-only",
    });
    expect(String(ambiguous.recovery)).not.toMatch(/write|scope/i);
  });
});
