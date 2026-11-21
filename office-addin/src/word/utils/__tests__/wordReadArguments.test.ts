import { describe, expect, it } from "vitest";

import {
  body,
  chapter,
  heading,
  okResult,
  openReadSession,
  readContext,
  sectionSnapshot,
  untouchedWriteState,
  writeState,
} from "../../../test/mocks/word/sectionFixtures";
import { WordDocumentReadSession } from "../wordDocumentReadTool";
import { WORD_READ_PAGE_BYTES } from "../wordReadFragments";

import type { ClientToolExecutionResult } from "@erato/frontend/library";
import type { WordAuthoringSnapshot } from "@erato/frontend/word-review";

const snapshotOf = (extra: Partial<WordAuthoringSnapshot> = {}) =>
  sectionSnapshot(
    [
      body("Master Services Agreement"),
      ...chapter(1, 8),
      heading(1, "Fees"),
      body("Payment is due net 30."),
    ],
    extra,
  );

function issues(response: ClientToolExecutionResult) {
  expect(response.ok).toBe(false);
  return response.ok ? [] : (response.validationErrors ?? []);
}

/** The ready-made call a refusal carries, as the model would send it. */
function correctCall(response: ClientToolExecutionResult) {
  const [, example] = issues(response);
  expect(example).toMatchObject({ path: "", code: "read-arguments" });
  return JSON.parse(example.message.replace("A correct call: ", "")) as Record<
    string,
    unknown
  >;
}

const RECEIPT_NOTE =
  'This call belongs to an earlier user turn. Its full content is omitted from the conversation replay; only the fields under "kept" remain. Call the tool again if current data is needed.';

describe("a plain read of a capture too large for a complete read", () => {
  it("answers with the outline and a section call that reads", async () => {
    const snapshot = snapshotOf({ completeReadIssue: "too-large" });
    const { session } = openReadSession(snapshot);

    const response = await session.execute(
      { snapshot: snapshot.token, cursor: null },
      readContext,
    );
    const answer = okResult<{
      outline: string;
      exampleCall: Record<string, unknown>;
      next: string;
    }>(response);
    expect(answer).toMatchObject({
      snapshot: snapshot.token,
      documentIdentity: snapshot.identity,
      completeRead: "unavailable",
      reason: "too-large",
      complete: false,
      exampleCall: {
        snapshot: snapshot.token,
        documentIdentity: snapshot.identity,
        section: { ref: "b1" },
      },
      freshness: { context_ref: snapshot.token },
    });
    expect(answer.outline).toContain("[b2|H1|");
    expect(answer.outline).toContain("1. Chapter 1");
    expect(answer.next).toContain("section:{ref}");
    expect(answer).not.toHaveProperty("blocks");
    expect(answer).not.toHaveProperty("readToken");
    expect(
      new TextEncoder().encode(JSON.stringify(response)).length,
    ).toBeLessThan(WORD_READ_PAGE_BYTES);
    expect(writeState(snapshot)).toEqual(untouchedWriteState);

    const section = okResult(
      await session.execute(answer.exampleCall, readContext),
    );
    expect(section).toMatchObject({ section: { ref: "b1" } });
  });
});

describe("a plain read the model budget refuses", () => {
  it("answers with the outline, and a refusal shows a section call", async () => {
    const snapshot = snapshotOf();
    const session = new WordDocumentReadSession();
    session.activate(snapshot, readContext, async () => "model-budget");

    const answer = okResult<{ next: string; exampleCall: unknown }>(
      await session.execute({ snapshot: snapshot.token }, readContext),
    );
    expect(answer).toMatchObject({
      completeRead: "unavailable",
      reason: "model-budget",
      exampleCall: { section: { ref: "b1" } },
    });
    expect(answer.next).toMatch(/^The complete read is unavailable within/);

    const refused = await session.execute(
      { snapshot: snapshot.token, include: ["text"] },
      readContext,
    );
    expect(issues(refused)[0].message).toBe(
      "Unexpected field: include. The complete read is unavailable for this request; read the parts it needs with section:{ref}.",
    );
    okResult(await session.execute(correctCall(refused), readContext));
  });
});

describe("a refused read", () => {
  it("names the unexpected fields and shows the plain call while it is open", async () => {
    const snapshot = snapshotOf();
    const { session } = openReadSession(snapshot);

    const refused = await session.execute(
      {
        snapshot: snapshot.token,
        documentIdentity: snapshot.identity,
        include: ["text"],
      },
      readContext,
    );
    expect(issues(refused)[0].message).toMatch(
      /^Unexpected fields: documentIdentity, include\. Expected a snapshot token/,
    );
    const call = correctCall(refused);
    expect(call).toEqual({ snapshot: snapshot.token, cursor: null });
    okResult(await session.execute(call, readContext));
  });

  it("shows a section call when the complete read is unavailable", async () => {
    const snapshot = snapshotOf({ completeReadIssue: "too-large" });
    const { session } = openReadSession(snapshot);

    const refused = await session.execute(
      { snapshot: snapshot.token, documentIdentity: snapshot.identity },
      readContext,
    );
    expect(issues(refused)[0].message).toContain(
      "Unexpected field: documentIdentity.",
    );
    const call = correctCall(refused);
    expect(call).toEqual({
      snapshot: snapshot.token,
      documentIdentity: snapshot.identity,
      section: { ref: "b1" },
    });
    okResult(await session.execute(call, readContext));
  });

  it("refuses a section read with include by name, never dropping it", async () => {
    const snapshot = snapshotOf();
    const { execute, session } = openReadSession(snapshot);

    const refused = await execute({
      section: { ref: "b2", extra: 1 },
      include: ["text"],
    });
    const [first] = issues(refused);
    expect(first).toMatchObject({ path: "/section", code: "read-arguments" });
    expect(first.message).toMatch(
      /^Unexpected fields: include, section\.extra\. Expected snapshot, documentIdentity and section/,
    );
    const call = correctCall(refused);
    expect(call).toEqual({
      snapshot: snapshot.token,
      documentIdentity: snapshot.identity,
      section: { ref: "b2" },
    });
    expect(okResult(await session.execute(call, readContext))).toMatchObject({
      section: { ref: "b2", title: "1. Chapter 1" },
    });
  });

  it("fixes a section call copied from an earlier turn in one refusal", async () => {
    const snapshot = snapshotOf();
    const { session } = openReadSession(snapshot);

    const refused = await session.execute(
      {
        snapshot: "earlier-turn",
        documentIdentity: snapshot.identity,
        section: { ref: "b2" },
        include: ["text"],
      },
      readContext,
    );
    const [first, fix] = issues(refused);
    expect(first).toMatchObject({ code: "snapshot-mismatch" });
    expect(first.message).toBe(
      "Unexpected field: include. Use this request's exact snapshot and documentIdentity.",
    );
    expect(fix.code).toBe("snapshot-mismatch");
    const call = JSON.parse(fix.message.replace("A correct call: ", ""));
    expect(okResult(await session.execute(call, readContext))).toMatchObject({
      section: { ref: "b2" },
    });
  });

  it("gives a target read with an earlier snapshot this request's values", async () => {
    const snapshot = snapshotOf();
    const { session } = openReadSession(snapshot);

    const [first, fix] = issues(
      await session.execute(
        {
          snapshot: "earlier-turn",
          documentIdentity: snapshot.identity,
          target: { text: "Payment" },
          include: ["edits"],
        },
        readContext,
      ),
    );
    expect(first).toMatchObject({ path: "/target", code: "snapshot-mismatch" });
    expect(fix.message).toBe(
      `This request's snapshot and documentIdentity: ${JSON.stringify({ snapshot: snapshot.token, documentIdentity: snapshot.identity })}`,
    );
  });

  it("keeps the call whole when the document identity is long", async () => {
    const snapshot = snapshotOf({
      identity: `https://contoso.example/${"Vertr%C3%A4ge/".repeat(40)}x.docx`,
    });
    const { execute } = openReadSession(snapshot);

    const [, example] = issues(
      await execute({ section: { ref: "b2" }, include: ["text"] }),
    );
    expect(example.message.length).toBeLessThanOrEqual(512);
    expect(example.message).toBe(
      'A correct call sends this request\'s snapshot and documentIdentity with {"section":{"ref":"b2"}}.',
    );
  });
});

describe("a read sent as a replay record", () => {
  it("reads what the record keeps", async () => {
    const snapshot = snapshotOf();
    const { session } = openReadSession(snapshot);

    const record = await session.execute(
      {
        omitted_from_replay: RECEIPT_NOTE,
        kept: { snapshot: snapshot.token, cursor: null },
      },
      readContext,
    );
    const page = okResult<{ blocksRead: number; blocksTotal: number }>(record);
    expect(page).toMatchObject({ snapshot: snapshot.token, complete: true });
    expect(page.blocksRead).toBe(page.blocksTotal);

    const bare = await session.execute(
      { kept: { snapshot: snapshot.token, cursor: null } },
      readContext,
    );
    expect(okResult(bare)).toMatchObject({ snapshot: snapshot.token });

    const section = await session.execute(
      {
        omitted_from_replay: RECEIPT_NOTE,
        kept: {
          snapshot: snapshot.token,
          documentIdentity: snapshot.identity,
          section: { ref: "b2" },
        },
      },
      readContext,
    );
    expect(okResult(section)).toMatchObject({
      section: { ref: "b2" },
      access: "read-only",
    });
  });

  it("says it is a replay record when the record holds no read", async () => {
    const snapshot = snapshotOf();
    const { session } = openReadSession(snapshot);

    for (const input of [
      { omitted_from_replay: RECEIPT_NOTE, kept: {} },
      {
        omitted_from_replay: RECEIPT_NOTE,
        kept: { snapshot: snapshot.token },
        cursor: null,
      },
      { kept: "snapshot" },
    ]) {
      const refused = await session.execute(input, readContext);
      const [first] = issues(refused);
      expect(first.code).toBe("read-arguments");
      expect(first.message).toMatch(
        /^These arguments are a replay record of an earlier call \(omitted_from_replay, kept\), not a call\./,
      );
      expect(first.message).not.toContain("Unexpected fields: omitted");
      expect(correctCall(refused)).toEqual({
        snapshot: snapshot.token,
        cursor: null,
      });
    }
    expect(snapshot.read.size).toBe(0);
  });
});
