import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installMockWordDocument,
  uninstallMockWordDocument,
} from "../../../test/mocks/word/document";
import {
  beginWordOwnWrite,
  markWordOwnAnchor,
  markWordOwnImport,
  nameWordOwnWriteIds,
  noteWordCapturedIds,
  noteWordChangeEventsActive,
  recordWordParagraphEvent,
  recordWordUnknownChange,
  resetWordChangeJournalForTests,
  wordChangePosition,
  wordChangesSince,
} from "../wordChangeJournal";

import type { WordChangeEntry } from "../wordChangeJournal";

const changed = (ids: string[], source = "Local") =>
  recordWordParagraphEvent({
    type: "ParagraphChanged",
    source,
    uniqueLocalIds: ids,
  });
const added = (ids: string[], source = "Local") =>
  recordWordParagraphEvent({
    type: "ParagraphAdded",
    source,
    uniqueLocalIds: ids,
  });
const deleted = (ids: string[], source = "Local") =>
  recordWordParagraphEvent({
    type: "ParagraphDeleted",
    source,
    uniqueLocalIds: ids,
  });

function since(position = start): readonly WordChangeEntry[] {
  const result = wordChangesSince(position);
  if (!result.ok) throw new Error(result.reason);
  return result.entries;
}
const sources = (position = start) => since(position).map((e) => e.source);

let start: ReturnType<typeof wordChangePosition>;

describe("wordChangeJournal", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-10-29T12:00:00Z") });
    resetWordChangeJournalForTests();
    noteWordChangeEventsActive();
    start = wordChangePosition();
  });

  afterEach(() => {
    vi.useRealTimers();
    uninstallMockWordDocument();
  });

  it("keeps each event's kind, source and ids", () => {
    changed(["p1"]);
    added(["n1"], "Remote");
    deleted(["p2"]);

    expect(
      since().map(({ kind, source, ids }) => ({ kind, source, ids })),
    ).toEqual([
      { kind: "changed", source: "local", ids: ["p1"] },
      { kind: "added", source: "remote", ids: ["n1"] },
      { kind: "deleted", source: "local", ids: ["p2"] },
    ]);
  });

  it("keeps one journal across captures while the pane stays open", () => {
    changed(["p1"]);
    const second = wordChangePosition();
    changed(["p2"]);

    expect(since(start).map((e) => e.ids)).toEqual([["p1"], ["p2"]]);
    expect(since(second).map((e) => e.ids)).toEqual([["p2"]]);
  });

  it("does not know a position from before a reload", () => {
    changed(["p1"]);
    resetWordChangeJournalForTests();
    noteWordChangeEventsActive();

    expect(wordChangesSince(start)).toEqual({
      ok: false,
      reason: "other-journal",
    });
  });

  it("reads a position older than the oldest kept entry as out of range", () => {
    for (let k = 0; k < 1_001; k++) changed([`p${k}`]);

    expect(wordChangesSince(start)).toEqual({
      ok: false,
      reason: "out-of-range",
    });
    expect(wordChangesSince({ ...start, seq: 1 })).toMatchObject({ ok: true });
  });

  it("knows nothing without paragraph events, also for a position taken before they started", () => {
    resetWordChangeJournalForTests();
    const before = wordChangePosition();
    expect(wordChangesSince(before)).toEqual({
      ok: false,
      reason: "no-events",
    });

    noteWordChangeEventsActive();
    expect(wordChangesSince(before)).toEqual({
      ok: false,
      reason: "no-events",
    });
  });

  it("keeps a blind spot the pane noticed as an unknown entry", () => {
    recordWordUnknownChange("tracking-mode");

    expect(since().map(({ source, reason }) => ({ source, reason }))).toEqual([
      { source: "unknown", reason: "tracking-mode" },
    ]);
  });

  describe("the pane's own writes", () => {
    it("claims events naming only the ids an in-place write named, until 3 s after it", () => {
      const write = beginWordOwnWrite("ids");
      nameWordOwnWriteIds(["p1", null, undefined]);
      changed(["p1"]);
      changed(["p2"]);
      changed(["p1", "p2"]);
      write.end();
      vi.advanceTimersByTime(3_000);
      changed(["p1"]);
      vi.advanceTimersByTime(1);
      changed(["p1"]);

      expect(since().map((e) => [e.source, e.ids])).toEqual([
        ["own", ["p1", "p1"]],
        ["local", ["p2"]],
        ["local", ["p1", "p2"]],
        ["local", ["p1"]],
      ]);
    });

    it("claims every Local event of a write that names no ids, such as an insert or a comment", () => {
      const write = beginWordOwnWrite("anchor");
      changed(["p1"]);
      write.end();
      vi.advanceTimersByTime(1_300);
      changed(["p9"]);
      vi.advanceTimersByTime(2_000);
      changed(["p9"]);

      expect(since().map((e) => [e.source, e.ids])).toEqual([
        ["own", ["p1", "p9"]],
        ["local", ["p9"]],
      ]);
    });

    it("never claims a co-author's edit", () => {
      const write = beginWordOwnWrite("anchor");
      changed(["p1"], "Remote");
      write.end();

      expect(sources()).toEqual(["remote"]);
    });

    it("claims an import's burst until Word goes quiet for 2 s, at most 30 s after it", () => {
      const write = beginWordOwnWrite("ids");
      markWordOwnImport();
      write.end();
      for (let k = 0; k < 15; k++) {
        vi.advanceTimersByTime(1_000);
        added([`n${k}`]);
      }
      deleted(["p1", "p2"]);
      vi.advanceTimersByTime(2_001);
      changed(["n1"]);

      expect(since().map(({ kind, source }) => `${kind}:${source}`)).toEqual([
        "added:own",
        "deleted:own",
        "changed:local",
      ]);
      expect(since()[0].ids).toHaveLength(15);
    });

    it("ends an import's window 30 s after it however busy Word stays", () => {
      const write = beginWordOwnWrite("import");
      write.end();
      for (let k = 0; k < 31; k++) {
        vi.advanceTimersByTime(1_000);
        changed([`n${k}`]);
      }

      expect(sources().at(-1)).toBe("local");
      expect(sources().filter((s) => s === "own")).toHaveLength(1);
    });

    it("claims every Local event only from the write on, not during the checks before it", () => {
      const anchor = beginWordOwnWrite("ids");
      changed(["p1"]);
      markWordOwnAnchor();
      changed(["p2"]);
      anchor.end();
      vi.advanceTimersByTime(3_001);
      const replace = beginWordOwnWrite("ids");
      changed(["p3"]);
      markWordOwnImport();
      changed(["p4"]);
      replace.end();

      expect(sources()).toEqual(["local", "own", "local", "own"]);
    });

    it("ends a write still open after 60 s, so a run that never settles claims nothing later", () => {
      const anchor = beginWordOwnWrite("anchor");
      const replace = beginWordOwnWrite("import");
      vi.advanceTimersByTime(60_000);
      changed(["p1"]);
      vi.advanceTimersByTime(3_001);
      changed(["p2"]);
      vi.advanceTimersByTime(60_000);
      changed(["p3"]);
      anchor.end();
      replace.end();

      expect(sources()).toEqual(["own", "local", "local"]);
    });

    it("keeps an import's interleaved Added and Deleted in one entry each, so earlier positions stay in range", () => {
      const write = beginWordOwnWrite("import");
      for (let k = 0; k < 2_404; k++) {
        added([`n${k}`]);
        deleted([`p${k}`]);
      }
      write.end();

      expect(
        since().map(({ kind, source, ids }) => [kind, source, ids.length]),
      ).toEqual([
        ["added", "own", 2_404],
        ["deleted", "own", 2_404],
      ]);
    });

    it("keeps an own entry that a later position may count from", () => {
      const write = beginWordOwnWrite("anchor");
      changed(["p1"]);
      const middle = wordChangePosition();
      changed(["p2"]);
      write.end();

      expect(since(middle).map((e) => e.ids)).toEqual([["p2"]]);
    });
  });

  describe("a capture's ids replaced", () => {
    it("reads one Deleted naming at least half of the capture's ids as unknown", () => {
      noteWordCapturedIds(["p1", "p2", "p3", "p4", null]);
      deleted(["p1"]);
      deleted(["p1", "p2", "p3"]);

      expect(
        since().map(({ kind, source, reason }) => ({ kind, source, reason })),
      ).toEqual([
        { kind: "deleted", source: "local", reason: undefined },
        { kind: "unknown", source: "unknown", reason: "ids-replaced" },
      ]);
    });

    it("leaves the pane's own import as own", () => {
      noteWordCapturedIds(["p1", "p2"]);
      const write = beginWordOwnWrite("import");
      deleted(["p1", "p2"]);
      write.end();

      expect(sources()).toEqual(["own"]);
    });
  });

  describe("an added paragraph's neighbours", () => {
    const install = (ids: string[]) =>
      installMockWordDocument(
        ids.map((id) => ({ text: id, uniqueLocalId: id })),
      );

    it("reads the nearest captured paragraph before it once the burst settles", async () => {
      install(["p1", "p2", "n1", "n2", "p3"]);
      noteWordCapturedIds(["p1", "p2", "p3"]);
      added(["n1"]);
      added(["n2"]);
      const entries = since();
      expect(entries[0].location?.size).toBe(0);

      await vi.advanceTimersByTimeAsync(100);

      expect(entries[0].location?.get("n1")).toEqual(["p2"]);
      expect(entries[1].location?.get("n2")).toEqual(["n1", "p2"]);
    });

    it("reads the next paragraphs for one that starts the document", async () => {
      install(["n1", "p1"]);
      noteWordCapturedIds(["p1"]);
      added(["n1"]);

      await vi.advanceTimersByTimeAsync(100);

      expect(since()[0].location?.get("n1")).toEqual(["p1"]);
    });

    it("leaves the whole burst unplaced when Word no longer has one of its paragraphs", async () => {
      install(["p1", "n1"]);
      noteWordCapturedIds(["p1"]);
      added(["n1"]);
      added(["gone"]);

      await vi.advanceTimersByTimeAsync(100);

      expect(since().map((e) => e.location?.get(e.ids[0]))).toEqual([
        null,
        null,
      ]);
    });

    it("does not look up a paragraph deleted before the burst settles, so the rest keep their place", async () => {
      install(["p1", "n1"]);
      noteWordCapturedIds(["p1"]);
      added(["n1"]);
      added(["gone"]);
      deleted(["gone"]);

      await vi.advanceTimersByTimeAsync(100);

      expect(since()[0].location?.get("n1")).toEqual(["p1"]);
      expect(since()[1].location?.get("gone")).toBeNull();
    });

    it("leaves a burst of more than 50 ids unresolved", async () => {
      const ids = Array.from({ length: 51 }, (_, k) => `n${k}`);
      const host = install(["p1", ...ids]);
      noteWordCapturedIds(["p1"]);
      for (const id of ids) added([id]);

      await vi.advanceTimersByTimeAsync(100);

      expect(since().every((e) => e.location?.get(e.ids[0]) === null)).toBe(
        true,
      );
      expect(host.word.run).not.toHaveBeenCalled();
    });

    it("does not look up the pane's own additions", async () => {
      const host = install(["p1", "n1"]);
      const write = beginWordOwnWrite("anchor");
      added(["n1"]);
      write.end();

      await vi.advanceTimersByTimeAsync(100);

      expect(since()[0].location).toBeUndefined();
      expect(host.word.run).not.toHaveBeenCalled();
    });
  });
});
