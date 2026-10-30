import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  checkWordApprovalScope,
  wordApprovalScopeOptions,
} from "../wordApprovalScope";
import {
  beginWordOwnWrite,
  nameWordOwnWriteIds,
  noteWordCapturedIds,
  noteWordChangeEventsActive,
  recordWordParagraphEvent,
  resetWordChangeJournalForTests,
  wordChangePosition,
  wordChangesSince,
} from "../wordChangeJournal";

import type {
  ClientToolApprovalScope,
  ClientToolApprovalScopeRef,
} from "@erato/frontend/library";

const IDENTITY = "a".repeat(64);
const options = wordApprovalScopeOptions(() => IDENTITY);
const documentScope: ClientToolApprovalScopeRef = {
  hostContext: "word_document",
  scopeId: IDENTITY,
  covers: "document",
};

const event = (type: string, ids: string[], source = "Local") =>
  recordWordParagraphEvent({ type, source, uniqueLocalIds: ids });
const changed = (ids: string[], source?: string) =>
  event("ParagraphChanged", ids, source);
const added = (ids: string[]) => event("ParagraphAdded", ids);
const deleted = (ids: string[]) => event("ParagraphDeleted", ids);

/** What the card does when the user allows the document in this pane. */
function allow(): ClientToolApprovalScope {
  const anchor = options.anchorsApprovalScope?.(documentScope);
  if (!anchor) throw new Error("the pane takes no position");
  return { approvalId: "approval-1", scopeId: IDENTITY, position: anchor() };
}

const covered = (position: unknown): ClientToolApprovalScope => ({
  approvalId: "approval-1",
  scopeId: IDENTITY,
  position,
});

function expectScopeChanged(scope: ClientToolApprovalScope) {
  const check = checkWordApprovalScope(scope);
  expect(check.read).toBe(false);
  if (check.read) return;
  expect(check.result).toMatchObject({
    ok: false,
    validationErrors: [{ code: "scope_changed" }],
  });
  // Not terminal: the server asks the user again about the same call.
  expect(check.result).not.toHaveProperty("submissionFeedback");
}

beforeEach(() => {
  resetWordChangeJournalForTests();
  noteWordChangeEventsActive();
});

afterEach(() => {
  resetWordChangeJournalForTests();
});

describe("checkWordApprovalScope", () => {
  it("reads a call allowed on its own, whatever changed", () => {
    changed(["p1"]);
    expect(checkWordApprovalScope(undefined)).toEqual({ read: true });
  });

  it("reads while nothing changed since the user allowed the document", () => {
    expect(checkWordApprovalScope(allow())).toEqual({ read: true });
  });

  it("reads after the pane's own writes of every kind", () => {
    noteWordCapturedIds(["p1", "p2", "p3"]);
    const scope = allow();

    const ids = beginWordOwnWrite("ids");
    nameWordOwnWriteIds(["p1"]);
    changed(["p1"]);
    ids.end();

    const anchor = beginWordOwnWrite("anchor");
    added(["n1"]);
    changed(["p2"]);
    anchor.end();

    const imported = beginWordOwnWrite("import");
    added(["m1", "m2"]);
    deleted(["p1", "p2", "p3"]);
    imported.end();

    const since = wordChangesSince(scope.position as never);
    const sources = since.ok ? since.entries.map((entry) => entry.source) : [];
    expect(sources.length).toBeGreaterThan(0);
    expect(new Set(sources)).toEqual(new Set(["own"]));
    expect(checkWordApprovalScope(scope)).toEqual({ read: true });
  });

  it.each([
    ["the user's edit", () => changed(["p1"])],
    ["a co-author's edit", () => changed(["p1"], "Remote")],
    [
      "every paragraph id replaced",
      () => {
        noteWordCapturedIds(["p1", "p2"]);
        deleted(["p1", "p2"]);
      },
    ],
  ])("answers scope_changed without reading after %s", (_name, change) => {
    const scope = allow();
    change();
    expectScopeChanged(scope);
  });

  it("answers scope_changed after an outside change among the pane's own", () => {
    const scope = allow();
    const write = beginWordOwnWrite("ids");
    nameWordOwnWriteIds(["p1"]);
    changed(["p1"]);
    changed(["p2"]);
    write.end();
    expectScopeChanged(scope);
  });

  it("answers scope_changed after a reload of the pane", () => {
    const scope = allow();
    resetWordChangeJournalForTests();
    noteWordChangeEventsActive();
    expectScopeChanged(scope);
  });

  it("answers scope_changed for a position taken without paragraph events", () => {
    resetWordChangeJournalForTests();
    const position = wordChangePosition();
    noteWordChangeEventsActive();
    expect(position.events).toBe(false);
    expectScopeChanged(covered(position));
  });

  it("answers scope_changed once the journal no longer holds the position", () => {
    const scope = allow();
    const write = beginWordOwnWrite("anchor");
    for (let k = 0; k <= 1_000; k++) {
      // A position taken between events keeps each in an entry of its own.
      wordChangePosition();
      changed([`p${k}`]);
    }
    write.end();
    expect(wordChangesSince(scope.position as never)).toEqual({
      ok: false,
      reason: "out-of-range",
    });
    expectScopeChanged(scope);
  });

  it.each([
    ["no position", undefined],
    ["a null position", null],
    ["a string", "position"],
    ["an empty object", {}],
    ["a fractional seq", { journal: "j", seq: 1.5, events: true }],
    ["a numeric journal", { journal: 1, seq: 0, events: true }],
  ])("answers scope_changed for %s", (_name, position) => {
    expectScopeChanged(covered(position));
  });

  it("keeps the approval when returning to the pane recaptures the same paragraphs", () => {
    noteWordCapturedIds(["p1", "p2"]);
    const scope = allow();
    // A capture takes a position before it reads, then notes its ids; a Track Changes toggle
    // brings the same paragraphs back.
    wordChangePosition();
    noteWordCapturedIds(["p1", "p2"]);
    expect(checkWordApprovalScope(scope)).toEqual({ read: true });
  });
});

describe("wordApprovalScopeOptions", () => {
  it("lists the check only while paragraph events reach the journal", () => {
    expect(options.checksApprovalScope?.()).toBe(true);
    resetWordChangeJournalForTests();
    expect(options.checksApprovalScope?.()).toBe(false);
  });

  it("takes a position only for this pane's own document", () => {
    const anchor = options.anchorsApprovalScope?.(documentScope);
    expect(anchor).toBeTypeOf("function");
    const position = anchor?.();
    expect(wordChangesSince(position as never)).toEqual({
      ok: true,
      entries: [],
    });
    expect(
      options.anchorsApprovalScope?.({
        ...documentScope,
        scopeId: "b".repeat(64),
      }),
    ).toBeUndefined();
    expect(
      options.anchorsApprovalScope?.({
        ...documentScope,
        hostContext: "outlook_mailbox",
      }),
    ).toBeUndefined();
    expect(
      options.anchorsApprovalScope?.({ ...documentScope, covers: "turn" }),
    ).toBeUndefined();
    expect(
      wordApprovalScopeOptions(() => undefined).anchorsApprovalScope?.(
        documentScope,
      ),
    ).toBeUndefined();
  });

  it("takes no position without paragraph events", () => {
    resetWordChangeJournalForTests();
    expect(options.anchorsApprovalScope?.(documentScope)).toBeUndefined();
  });
});
