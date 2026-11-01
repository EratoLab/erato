import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";

import { setWordWebImport } from "../../../test/mocks/word/applyPolicy";
import { uninstallMockWordDocument } from "../../../test/mocks/word/document";
import { installWordOoxmlHost } from "../../../test/mocks/word/ooxmlHost";
import {
  captureRealisticSnapshot,
  realisticWordPackageXml,
  statusRewritePlan,
} from "../../../test/mocks/word/realisticWordFixtures";
import { applyWordDocumentPlan } from "../wordApplyDocumentPlan";
import {
  checkWordApprovalScope,
  wordApprovalScopeOptions,
} from "../wordApprovalScope";
import {
  beginWordOwnWrite,
  nameWordOwnWriteIds,
  noteWordActiveChat,
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
const CHAT = "chat-1";
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

/** The grant of a task the chat that holds the approval launched. */
const grant = (approvalScope?: ClientToolApprovalScope) => ({
  ownerChatId: CHAT,
  approvalScope,
});

function expectScopeChanged(scope: ClientToolApprovalScope) {
  const check = checkWordApprovalScope(grant(scope));
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
  noteWordActiveChat(CHAT);
});

afterEach(() => {
  resetWordChangeJournalForTests();
});

describe("checkWordApprovalScope", () => {
  it("reads a call allowed on its own, whatever changed", () => {
    changed(["p1"]);
    expect(checkWordApprovalScope(undefined)).toEqual({ read: true });
    expect(checkWordApprovalScope(grant())).toEqual({ read: true });
  });

  it("reads while nothing changed since the user allowed the document", () => {
    expect(checkWordApprovalScope(grant(allow()))).toEqual({ read: true });
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
    expect(checkWordApprovalScope(grant(scope))).toEqual({ read: true });
  });

  it.each([
    ["the user's edit", () => changed(["p1"])],
    ["the user's new paragraph", () => added(["n1"])],
    ["the user's deleted paragraph", () => deleted(["p1"])],
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

  it.each([
    ["another chat open in the pane", "chat-2"],
    ["no chat open in the pane", null],
  ])("answers scope_changed after a write with %s", (_name, chat) => {
    const scope = allow();
    noteWordActiveChat(chat);
    const write = beginWordOwnWrite("ids");
    nameWordOwnWriteIds(["p1"]);
    changed(["p1"]);
    write.end();
    expectScopeChanged(scope);
  });

  it("reads after the chat's own write that settles after another chat was opened", () => {
    const scope = allow();
    const write = beginWordOwnWrite("ids");
    nameWordOwnWriteIds(["p1"]);
    noteWordActiveChat("chat-2");
    changed(["p1"]);
    write.end();
    expect(checkWordApprovalScope(grant(scope))).toEqual({ read: true });
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
    expect(checkWordApprovalScope(grant(scope))).toEqual({ read: true });
  });
});

describe("a document approval and the chat's own Apply", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    uninstallMockWordDocument();
    delete window.WORD_FORCE_IMPORT_APPLY;
  });

  /** Sets the clock to `ms` after the moment this is called. */
  function clockFromNow(): (ms: number) => void {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now");
    return (ms) => clock.mockReturnValue(now + ms);
  }

  async function liveIds(): Promise<{ text: string; id: string }[]> {
    return globalThis.Word.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load("items/uniqueLocalId,items/text");
      await context.sync();
      return paragraphs.items.map((p) => ({
        text: p.text,
        id: p.uniqueLocalId,
      }));
    });
  }

  it("reads after an in-place Apply, and asks again after the user's edit beside it", async () => {
    installWordOoxmlHost(realisticWordPackageXml(), {
      profile: "word-pc-16.0.20326",
    });
    const snapshot = await captureRealisticSnapshot();
    const scope = allow();
    const result = await applyWordDocumentPlan(
      JSON.stringify(statusRewritePlan(snapshot, "Status: done.")),
      snapshot,
      snapshot.ownerMessageId,
    );
    expect(result.outcome?.route).toBe("in-place");
    const ids = await liveIds();
    const written = ids.find((p) => p.text.startsWith("Status: done."))!.id;
    const other = ids.find((p) => p.id !== written && p.text.trim())!.id;

    changed([written]);
    expect(checkWordApprovalScope(grant(scope))).toEqual({ read: true });
    changed([other]);
    expectScopeChanged(scope);
  });

  it("asks again after another chat's Apply in the same pane", async () => {
    installWordOoxmlHost(realisticWordPackageXml(), {
      profile: "word-pc-16.0.20326",
    });
    const snapshot = await captureRealisticSnapshot();
    const scope = allow();
    noteWordActiveChat("chat-2");
    const result = await applyWordDocumentPlan(
      JSON.stringify(statusRewritePlan(snapshot, "Status: done.")),
      snapshot,
      snapshot.ownerMessageId,
    );
    expect(result.outcome?.route).toBe("in-place");
    const written = (await liveIds()).find((p) =>
      p.text.startsWith("Status: done."),
    )!.id;

    changed([written]);
    expectScopeChanged(scope);
  });

  it("reads after an import Apply whose events Word reports for most of a minute", async () => {
    onTestFinished(setWordWebImport("confirm"));
    window.WORD_FORCE_IMPORT_APPLY = true;
    installWordOoxmlHost(realisticWordPackageXml(), { profile: "word-web" });
    const snapshot = await captureRealisticSnapshot();
    noteWordCapturedIds(["old-1", "old-2"]);
    const scope = allow();
    const result = await applyWordDocumentPlan(
      JSON.stringify(statusRewritePlan(snapshot, "Status: imported.")),
      snapshot,
      snapshot.ownerMessageId,
      undefined,
      undefined,
      { importConfirmed: true },
    );
    expect(result.outcome?.route).toBe("import");
    const later = clockFromNow();
    for (let k = 0; k <= 10; k++) {
      later(10 + k * 5_600);
      added([`new-${k}`]);
    }
    deleted(["old-1", "old-2"]);

    expect(checkWordApprovalScope(grant(scope))).toEqual({ read: true });
    later(10 + 10 * 5_600 + 2_001);
    added(["typed"]);
    expectScopeChanged(scope);
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
