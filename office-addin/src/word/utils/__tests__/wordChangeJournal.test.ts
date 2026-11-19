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

/** Word PC's import of chaptered.docx (ERMAIN-1010 gate, F3-import run 2), from Apply resolved
 * on: Added one id each from +10 ms to +58.5 s with pauses of 3.1, 5.6, 3.9 and 4.3 s, then in the
 * last half second the rest of the Added and a Deleted for each old paragraph, 162 of them ones
 * the capture did not list. */
function pcImport(old: string[]) {
  const t0 = Date.now();
  const at = (ms: number) => vi.setSystemTime(t0 + ms);
  let n = 0;
  const add = () => added([`n${n++}`]);
  for (const [ms, count] of [
    [10, 16],
    [3_695, 3],
    [9_257, 3],
    [13_193, 5],
    [17_544, 3],
  ]) {
    at(ms);
    for (let k = 0; k < count; k++) add();
  }
  for (let ms = 18_564; n < 1_580; ms += 25) {
    at(ms);
    add();
  }
  const gone = [...old, ...Array.from({ length: 162 }, (_, k) => `x${k}`)];
  for (let k = 0; k < gone.length; k++) {
    at(58_000 + Math.floor(k / 5));
    if (n < 2_404) add();
    deleted([gone[k]]);
  }
  at(58_520);
}

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
    for (let k = 0; k < 1_001; k++) {
      vi.advanceTimersByTime(251);
      changed([`p${k}`]);
    }

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

  it("merges a burst of local or remote events of one kind and source into one entry", () => {
    changed(["p1"]);
    vi.advanceTimersByTime(200);
    changed(["p2"], "Remote");
    added(["n1"]);
    changed(["p2"]);
    vi.advanceTimersByTime(250);
    changed(["p1"]);
    vi.advanceTimersByTime(251);
    changed(["p3"]);

    expect(since().map((e) => `${e.kind}:${e.source}:${e.ids}`)).toEqual([
      "changed:local:p1,p2",
      "changed:remote:p2",
      "added:local:n1",
      "changed:local:p3",
    ]);
  });

  it("keeps the first 64 ids of a burst and counts the rest", () => {
    for (let k = 0; k < 4_808; k++) {
      vi.advanceTimersByTime(10);
      deleted([`p${k}`]);
    }

    expect(since().map((e) => [e.ids.length, e.moreIds])).toEqual([
      [64, 4_744],
    ]);
  });

  it("starts a new entry after a position, which must not see an entry grow behind it", () => {
    changed(["p1"]);
    const middle = wordChangePosition();
    changed(["p2"]);

    expect(since(middle).map((e) => e.ids)).toEqual([["p2"]]);
    expect(since().map((e) => e.ids)).toEqual([["p1"], ["p2"]]);
  });

  describe("the pane's own writes", () => {
    it("claims events naming only the ids an in-place write named, until 6 s after it", () => {
      const write = beginWordOwnWrite("ids");
      nameWordOwnWriteIds(["p1", null, undefined]);
      changed(["p1"]);
      changed(["p2"]);
      vi.advanceTimersByTime(251);
      changed(["p1", "p2"]);
      write.end();
      vi.advanceTimersByTime(6_000);
      changed(["p1"]);
      vi.advanceTimersByTime(1);
      changed(["p1"]);

      expect(since().map((e) => [e.source, e.ids])).toEqual([
        ["own", ["p1"]],
        ["local", ["p2"]],
        ["local", ["p1", "p2"]],
        ["local", ["p1"]],
      ]);
    });

    it("claims a Revert's event for its paragraph that Word PC sent 4.1 s after the Revert", () => {
      const write = beginWordOwnWrite("ids");
      nameWordOwnWriteIds(["p1"]);
      vi.advanceTimersByTime(662);
      write.end();
      vi.advanceTimersByTime(4_100);
      changed(["p1"]);

      expect(sources()).toEqual(["own"]);
    });

    it("claims every Local event of a write that names no ids, such as an insert or a comment, until 3 s after it", () => {
      const write = beginWordOwnWrite("anchor");
      changed(["p1"]);
      write.end();
      vi.advanceTimersByTime(1_300);
      changed(["p9"]);
      vi.advanceTimersByTime(1_701);
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

    it("claims Word PC's import of a 2,242-paragraph capture: 58.5 s of Added with pauses up to 5.6 s, the Deleted last", () => {
      const old = Array.from({ length: 2_242 }, (_, k) => `p${k}`);
      noteWordCapturedIds(old);
      added(["typed"]);
      deleted(["p0"]);
      vi.advanceTimersByTime(251);
      const before = wordChangePosition();
      const write = beginWordOwnWrite("ids");
      vi.advanceTimersByTime(4_000);
      markWordOwnImport();
      vi.advanceTimersByTime(8_000);
      write.end();
      pcImport([...old.slice(1), "typed"]);

      expect(
        since(before).map(({ kind, source, ids, moreIds }) => [
          kind,
          source,
          ids.length + (moreIds ?? 0),
        ]),
      ).toEqual([
        ["added", "own", 2_404],
        ["deleted", "own", 2_404],
      ]);
      vi.advanceTimersByTime(2_001);
      added(["n-user"]);
      expect(sources(before).at(-1)).toBe("local");
    });

    it("counts a user's Changed for another paragraph during an import's window as local", () => {
      noteWordCapturedIds(["p1", "p2"]);
      const write = beginWordOwnWrite("import");
      write.end();
      vi.advanceTimersByTime(10);
      added(["n1"]);
      vi.advanceTimersByTime(5_600);
      changed(["p9"]);
      added(["n2"]);
      vi.advanceTimersByTime(5_600);
      deleted(["p1"]);
      deleted(["p2"]);

      expect(since().map(({ kind, source }) => `${kind}:${source}`)).toEqual([
        "added:own",
        "changed:local",
        "deleted:own",
      ]);
    });

    it("ends an import's window 120 s after it when Word never reports a paragraph from before it deleted", () => {
      noteWordCapturedIds(["p1", "kept"]);
      const write = beginWordOwnWrite("import");
      write.end();
      vi.advanceTimersByTime(10);
      deleted(["p1"]);
      vi.advanceTimersByTime(119_990);
      added(["n1"]);
      vi.advanceTimersByTime(1);
      added(["n2"]);

      expect(since().map((e) => `${e.kind}:${e.source}:${e.ids}`)).toEqual([
        "deleted:own:p1",
        "added:own:n1",
        "added:local:n2",
      ]);
    });

    it("claims nothing after its tail for an import Word reported nothing of, as one refused at its sync", () => {
      noteWordCapturedIds(["p1", "p2", "p3"]);
      const write = beginWordOwnWrite("import");
      write.end();
      vi.advanceTimersByTime(3_001);
      deleted(["p1"]);

      expect(sources()).toEqual(["local"]);
    });

    it("claims every Local event only from the write on, not during the checks before it", () => {
      const anchor = beginWordOwnWrite("ids");
      changed(["p1"]);
      markWordOwnAnchor();
      changed(["p2"]);
      anchor.end();
      vi.advanceTimersByTime(3_001);
      const replace = beginWordOwnWrite("ids");
      added(["n3"]);
      markWordOwnImport();
      added(["n4"]);
      replace.end();

      expect(sources()).toEqual(["local", "own", "local", "own"]);
    });

    it("ends a write still open after 60 s, so a run that never settles claims nothing later", () => {
      const anchor = beginWordOwnWrite("anchor");
      const replace = beginWordOwnWrite("import");
      vi.advanceTimersByTime(60_000);
      added(["n1"]);
      vi.advanceTimersByTime(3_001);
      added(["n2"]);
      vi.advanceTimersByTime(60_000);
      added(["n3"]);
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
        since().map(({ kind, source, ids, moreIds }) => [
          kind,
          source,
          ids.length,
          moreIds,
        ]),
      ).toEqual([
        ["added", "own", 64, 2_340],
        ["deleted", "own", 64, 2_340],
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
      const [entry] = since();
      expect(entry.location?.size).toBe(0);

      await vi.advanceTimersByTimeAsync(100);

      expect(entry.location?.get("n1")).toEqual(["p2"]);
      expect(entry.location?.get("n2")).toEqual(["n1", "p2"]);
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

      expect([...since()[0].location!]).toEqual([
        ["n1", null],
        ["gone", null],
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
      expect(since()[0].location?.get("gone")).toBeNull();
    });

    it("leaves a burst of more than 50 ids unresolved", async () => {
      const ids = Array.from({ length: 51 }, (_, k) => `n${k}`);
      const host = install(["p1", ...ids]);
      noteWordCapturedIds(["p1"]);
      for (const id of ids) added([id]);

      await vi.advanceTimersByTimeAsync(100);

      expect(
        since().every((e) => e.ids.every((id) => e.location?.get(id) === null)),
      ).toBe(true);
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
