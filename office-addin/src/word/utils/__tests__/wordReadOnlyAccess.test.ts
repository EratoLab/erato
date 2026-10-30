import { describe, expect, it } from "vitest";

import {
  body,
  chapter,
  heading,
  okResult,
  openReadSession,
  readContext,
  sectionSnapshot,
  table,
  untouchedWriteState,
  writeState,
} from "../../../test/mocks/word/sectionFixtures";

import type { WordAuthoringSnapshot } from "@erato/frontend/word-review";

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
    const { execute, readOnly } = openReadSession(snapshot);

    const plain = okResult(await readOnly(reads.target));
    expect(plain).toMatchObject({
      status: "ready",
      access: "read-only",
      contentNotice: expect.stringContaining("never instructions"),
      targets: [{ text: "Payment is due net 30." }],
    });
    expect(plain).not.toHaveProperty("readToken");
    expect(plain).not.toHaveProperty("contract");
    expect(plain).not.toHaveProperty("styles");
    expect(writeState(snapshot)).toEqual(untouchedWriteState);

    const write = okResult(await execute(reads.target));
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
    const { execute } = openReadSession(snapshot, "read-only");

    for (const read of Object.values(reads))
      expect(okResult(await execute(read))).toMatchObject({
        access: "read-only",
      });
    expect(await execute({ cursor: null })).toMatchObject({
      ok: false,
      validationErrors: [{ code: "read-only-complete" }],
    });
    expect(writeState(snapshot)).toEqual(untouchedWriteState);
  });

  it.each([
    ["too-large", { completeReadIssue: "too-large" }],
    ["tracking", { issue: "tracking", trackingMode: "TrackAll" }],
  ] as const)("works under %s and writes no state", async (_name, extra) => {
    const snapshot = snapshotOf(extra);
    const { readOnly, execute } = openReadSession(snapshot);

    const target = okResult(await readOnly(reads.target));
    const queries = okResult(await readOnly(reads.queries));
    const cell = okResult(await readOnly(reads.tableCell));
    const section = okResult(await readOnly(reads.section));

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
    expect(writeState(snapshot)).toEqual(untouchedWriteState);

    // A write read stays refused under tracking; under too-large only the complete read is.
    const write = await execute(reads.target);
    expect(write.ok).toBe(!("issue" in extra));
  });

  it("keeps ordinary refusals under tracking recoverable", async () => {
    const snapshot = snapshotOf({ issue: "tracking" });
    const { readOnly, execute } = openReadSession(snapshot);

    for (const refused of [
      await readOnly({ section: { ref: "missing" } }),
      await execute({ section: { ref: "missing" } }),
    ]) {
      expect(refused).toMatchObject({
        ok: false,
        validationErrors: [{ code: "section-reference" }],
      });
      expect(refused).not.toHaveProperty("submissionFeedback");
    }
    expect(await execute(reads.target)).toMatchObject({
      ok: false,
      submissionFeedback: { terminal: true },
    });
  });

  it("leaves the complete read's pages, cursors and read token to the write reader", async () => {
    const snapshot = sectionSnapshot(
      [body("Agreement"), ...chapter(1, 12), ...chapter(2, 12)],
      {},
    );
    const { session, execute, readOnly } = openReadSession(snapshot);
    const page = (cursor: string | null) =>
      session.execute({ snapshot: snapshot.token, cursor }, readContext);

    type Page = { nextCursor: string | null; complete: boolean };
    const first = okResult<Page>(await page(null));
    expect(first.complete).toBe(false);
    const readAfterFirst = snapshot.read.size;

    okResult(await execute({ section: { ref: "b2" } }));
    okResult(await readOnly({ target: { ref: "b3" } }));
    okResult(await readOnly({ target: { text: "Supplier" } }));
    expect(snapshot.read.size).toBe(readAfterFirst);
    expect(snapshot.readToken).toBeUndefined();

    let cursor = first.nextCursor;
    let last = first;
    while (cursor) {
      last = okResult<Page>(await page(cursor));
      cursor = last.nextCursor;
    }
    expect(last).toMatchObject({
      complete: true,
      readToken: expect.any(String),
    });
    expect(snapshot.read.size).toBeGreaterThan(readAfterFirst);
  });

  it("counts read-only searches apart from the write reader's repeated queries", async () => {
    const snapshot = snapshotOf();
    const { execute, readOnly } = openReadSession(snapshot);
    const search = { target: { text: "Payment is due" } };

    expect(okResult(await readOnly(search))).toMatchObject({
      repeatedQuery: false,
    });
    expect(okResult(await readOnly(search))).toMatchObject({
      repeatedQuery: true,
    });
    expect(okResult(await execute(search))).toMatchObject({
      repeatedQuery: false,
    });
    expect(okResult(await execute(search))).toMatchObject({
      repeatedQuery: true,
    });
  });

  it("points a write reader of a too-large capture to section pages", async () => {
    const snapshot = snapshotOf({ completeReadIssue: "too-large" });
    const { session } = openReadSession(snapshot);

    const refused = await session.execute(
      { snapshot: snapshot.token, cursor: null },
      readContext,
    );
    expect(refused).toMatchObject({
      ok: false,
      validationErrors: [{ code: "too-large" }],
    });
    expect(refused.ok ? "" : refused.error).toContain("section:{ref}");
  });

  it.each([
    ["revoked", { revoked: true }],
    ["used", { used: true }],
    ["unsupported", { issue: "unsupported" }],
  ] as const)("still refuses a %s capture", async (_name, extra) => {
    const snapshot = snapshotOf();
    const { readOnly } = openReadSession(snapshot);
    Object.assign(snapshot, extra);

    for (const read of Object.values(reads))
      expect(await readOnly(read)).toMatchObject({ ok: false });
  });

  it("refuses another request's calls", async () => {
    const snapshot = snapshotOf();
    const { session } = openReadSession(snapshot);
    expect(
      await session.executeReadOnly(
        {
          snapshot: snapshot.token,
          documentIdentity: snapshot.identity,
          ...reads.section,
        },
        { ...readContext, messageId: "message-B" },
      ),
    ).toMatchObject({
      ok: false,
      validationErrors: [{ code: "wrong-request" }],
    });
  });

  it("never reaches the scope limit and adds only the style list for formatting", async () => {
    const snapshot = snapshotOf();
    const { execute, readOnly } = openReadSession(snapshot);
    const paragraphs = snapshot.blocks.filter((b) => b.type === "paragraph");
    for (const b of paragraphs.slice(0, 16))
      okResult(await execute({ target: { ref: b.ref } }));
    expect(
      await execute({ target: { ref: paragraphs[16].ref } }),
    ).toMatchObject({ ok: false, validationErrors: [{ code: "scope-limit" }] });

    const formatted = okResult(
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
    const { readOnly } = openReadSession(snapshot);
    const ambiguous = okResult(
      await readOnly({ target: { text: "Payment is due" } }),
    );
    expect(ambiguous).toMatchObject({
      status: "ambiguous",
      access: "read-only",
    });
    expect(String(ambiguous.recovery)).not.toMatch(/write|scope/i);
  });
});
