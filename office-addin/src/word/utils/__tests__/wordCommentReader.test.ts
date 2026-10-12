import { afterEach, describe, expect, it, vi } from "vitest";

import {
  V3C_COMMENT_DOCUMENT,
  generatedCommentDocument,
  installWordCommentHost,
  uninstallWordCommentHost,
} from "../../../test/mocks/word/commentHost";
import { V3C_ANCHORS } from "../../../test/mocks/word/commentPackages";
import {
  WORD_COMMENT_SYNC_THREADS,
  readWordComments,
  renderWordCommentReadReport,
  wordCommentInventoryFromCapture,
} from "../wordCommentReader";

import type {
  CommentHost,
  CommentHostFlavour,
  CommentHostOptions,
} from "../../../test/mocks/word/commentHost";
import type {
  WordCommentReadOptions,
  WordCommentThreadRecord,
} from "../wordCommentReader";

const HOSTS: readonly CommentHostFlavour[] = ["pc", "mac", "web"];
const ROOTS = [
  "T1",
  "T2",
  "T3",
  "T4",
  "T5",
  "T6",
  "T7",
  "T7b",
  "T8",
  "T9",
  "T10",
  "T11",
  "PB1",
  "T14",
];

let host: CommentHost;

afterEach(() => uninstallWordCommentHost());

async function read(
  hostOptions: CommentHostOptions = {},
  options: Omit<WordCommentReadOptions, "now"> = {},
) {
  host = installWordCommentHost(hostOptions);
  const result = await readWordComments({ ...options, now: host.now });
  if (!result.ok) throw new Error(`read failed: ${result.error}`);
  return result;
}

const askFor =
  (...keys: string[]) =>
  () =>
    keys.map((key) => host.commentId(key));

function thread(
  threads: readonly WordCommentThreadRecord[],
  key: string,
): WordCommentThreadRecord {
  const found = threads.find((t) => t.id === host.commentId(key));
  if (!found) throw new Error(`no thread ${key}`);
  return found;
}

const keysOf = (threads: readonly WordCommentThreadRecord[]) =>
  threads.map((t) => ROOTS.find((key) => host.commentId(key) === t.id));

const phase = (result: Awaited<ReturnType<typeof read>>, name: string) =>
  result.diagnostics.phases.find((p) => p.phase === name);

describe("readWordComments: the Office.js record", () => {
  it.each(HOSTS)("lists every thread in document order on %s", async (h) => {
    const { threads } = await read({ host: h });
    expect(keysOf(threads)).toEqual(ROOTS);
    expect(threads.map((t) => t.order)).toEqual(ROOTS.map((_, i) => i));
  });

  it("returns the web's number ids as strings, replies included", async () => {
    const { threads } = await read({ host: "web" });
    expect(host.listedIds().every((id) => typeof id === "number")).toBe(true);
    const t1 = thread(threads, "T1");
    expect(t1.id).toBe(String(parseInt("4F6559BD", 16)));
    expect(t1.replies?.map((r) => r.id)).toEqual([
      host.commentId("R1a"),
      host.commentId("R1b"),
    ]);
    for (const t of threads) {
      expect(typeof t.id).toBe("string");
      for (const reply of t.replies ?? [])
        expect(typeof reply.id).toBe("string");
    }
  });

  it("reads author, email, status and content of roots and replies", async () => {
    const { threads } = await read();
    const t2 = thread(threads, "T2");
    expect(t2).toMatchObject({
      authorName: "Jonas Weber",
      authorEmail: "jonas.weber@contoso.test",
      resolved: true,
      content: "T2 root: delta echo is fine now.",
      readOnly: null,
    });
    expect(t2.replies).toEqual([
      {
        id: host.commentId("R2a"),
        authorName: "Lena Fischer",
        authorEmail: "lena.fischer@contoso.test",
        creationDate: new Date("2026-09-02T01:00:00Z"),
        content: "T2 reply: resolved, thanks.",
      },
    ]);
    expect(thread(threads, "T1").resolved).toBe(false);
  });

  describe("creation dates (F-4)", () => {
    it("cuts dateUtc to the minute on desktop and reads w:date in the host's zone without it", async () => {
      const { threads } = await read({ host: "pc" });
      expect(thread(threads, "T1").creationDate).toEqual(
        new Date("2026-09-03T08:15:00Z"),
      );
      expect(thread(threads, "T5").creationDate).toEqual(
        new Date("2026-09-06T06:00:00Z"),
      );
    });

    it("keeps seconds on the web and gives null without dateUtc", async () => {
      const { threads } = await read({ host: "web" });
      expect(thread(threads, "T1").creationDate).toEqual(
        new Date("2026-09-03T08:15:30Z"),
      );
      expect(thread(threads, "T5").creationDate).toBeNull();
    });
  });

  it("keeps the same records whatever order Word lists items in", async () => {
    const options = {
      exact: () => ROOTS.map((key) => host.commentId(key)),
    };
    for (const h of HOSTS) {
      const base = await read({ host: h }, options);
      const listed = host.listedIds();
      for (const seed of [1, 7, 42]) {
        const again = await read({ host: h, shuffle: seed }, options);
        expect(host.listedIds()).not.toEqual(listed);
        expect(again.threads).toEqual(base.threads);
      }
    }
  });

  it("never exports the file nor asks the selection for its comments", async () => {
    for (const h of HOSTS) {
      await read({ host: h }, { exact: () => ROOTS.map(host.commentId) });
      expect(host.getFileAsync).not.toHaveBeenCalled();
      expect(host.calls()).not.toContain("document.getSelection");
      expect(host.calls()).not.toContain("range.getComments");
    }
  });

  it("returns nothing to place for a document without comments", async () => {
    const result = await read({
      document: { body: [{ tag: "P1", segments: ["Plain."] }], comments: {} },
    });
    expect(result.threads).toEqual([]);
    expect(result.legacy).toBeNull();
    expect(host.syncCount()).toBe(1);
  });

  it("fails without text when the list itself fails", async () => {
    host = installWordCommentHost({ failList: true });
    const result = await readWordComments({ now: host.now });
    expect(result).toMatchObject({
      ok: false,
      error: "list: RichApi.Error (GeneralException)",
    });
  });
});

describe("batching", () => {
  it("reads anchors and replies for at most 50 threads per sync", async () => {
    const result = await read({
      document: generatedCommentDocument({
        paragraphs: 120,
        repliesPerThread: 1,
      }),
    });
    expect(result.threads).toHaveLength(120);
    expect(result.threads.every((t) => t.replies?.length === 1)).toBe(true);
    expect(phase(result, "anchors")).toMatchObject({
      syncs: 3,
      total: 120,
      done: 120,
    });
    expect(phase(result, "replies")).toMatchObject({ syncs: 3, done: 120 });
    const perSync = host.syncLog().map((entry) => entry.comments);
    expect(Math.max(...perSync)).toBe(WORD_COMMENT_SYNC_THREADS);
    expect(perSync.filter((n) => n > 0)).toEqual([50, 50, 20, 50, 50, 20]);
    expect(result.diagnostics.phases.reduce((n, p) => n + p.syncs, 0)).toBe(
      host.syncCount(),
    );
  });

  it("reports progress per batch", async () => {
    const onProgress = vi.fn();
    await read(
      { document: generatedCommentDocument({ paragraphs: 60 }) },
      { onProgress },
    );
    expect(onProgress.mock.calls).toEqual([
      [50, 60, "anchors"],
      [60, 60, "anchors"],
      [50, 60, "replies"],
      [60, 60, "replies"],
    ]);
  });
});

describe("replies", () => {
  it("isolates a failed reply load to its thread, which becomes read-only", async () => {
    const result = await read({ failReplies: ["T1"] });
    const t1 = thread(result.threads, "T1");
    expect(t1.replies).toBeNull();
    expect(t1.readOnly).toBe("replies-failed");
    expect(thread(result.threads, "T2").replies).toHaveLength(1);
    expect(thread(result.threads, "T2").readOnly).toBeNull();
    expect(result.diagnostics.counts.repliesFailed).toBe(1);
    expect(phase(result, "replies")?.syncs).toBe(1 + ROOTS.length);
    expect(result.diagnostics.errors[0]).toEqual({
      phase: "replies",
      error: "RichApi.Error",
      officeCode: "GeneralException",
    });
  });

  it("drops the root from a web reply list and marks the thread read-only (F-1)", async () => {
    const result = await read({ host: "web", repliesWithRoot: ["T1"] });
    const t1 = thread(result.threads, "T1");
    expect(t1.replies?.map((r) => r.id)).toEqual([host.commentId("R1a")]);
    expect(t1.readOnly).toBe("replies-repeated");
    expect(thread(result.threads, "T2").readOnly).toBeNull();
    expect(result.diagnostics.counts.repliesRepeated).toBe(1);
  });

  it("reads replies only for the requested threads when asked to", async () => {
    const result = await read(
      { host: "mac" },
      { replies: "requested", exact: askFor("T1") },
    );
    expect(thread(result.threads, "T1").replies).toHaveLength(2);
    expect(thread(result.threads, "T2").replies).toBeNull();
    expect(phase(result, "replies")).toMatchObject({ total: 1, done: 1 });
  });

  it("stops at the replies budget and leaves the rest unread, not read-only", async () => {
    const result = await read(
      {
        host: "mac",
        document: generatedCommentDocument({
          paragraphs: 120,
          repliesPerThread: 3,
        }),
      },
      { budgetsMs: { replies: 1 } },
    );
    expect(phase(result, "replies")).toMatchObject({
      done: 50,
      exhausted: true,
    });
    expect(result.threads.filter((t) => t.replies !== null)).toHaveLength(50);
    expect(result.threads.every((t) => t.readOnly === null)).toBe(true);
  });
});

describe("coarse anchors", () => {
  it.each(HOSTS)(
    "maps each anchor's first and last paragraph to review ordinals on %s",
    async (h) => {
      const { threads } = await read({ host: h });
      const at = (key: string) => {
        const { first, last, single } = thread(threads, key).anchor!;
        return [first.ordinal, last.ordinal, single, first.via];
      };
      expect(at("T1")).toEqual([host.ordinalOf("T1P"), 2, true, "id"]);
      expect(at("T3")).toEqual([5, 7, false, "id"]);
      expect(at("T14")).toEqual([18, 19, false, "id"]);
      expect(thread(threads, "T4").anchor?.first).toMatchObject({
        nesting: 1,
        cell: { row: 0, cell: 0 },
        table: 1,
      });
      expect(thread(threads, "T14").anchor?.last).toMatchObject({
        cell: { row: 0, cell: 1 },
        table: 2,
      });
      expect(thread(threads, "T1").anchor?.first).toMatchObject({
        nesting: 0,
        cell: null,
        table: null,
      });
    },
  );

  it("reads a light inventory with heading levels and heading texts only", async () => {
    const { inventory } = await read();
    expect(inventory?.source).toBe("light");
    expect(inventory?.paragraphs.slice(0, 5)).toEqual([
      {
        ordinal: 1,
        id: "{0000-H1}",
        text: "Introduction",
        heading: 1,
        nesting: 0,
      },
      { ordinal: 2, id: "{0000-T1P}", heading: null, nesting: 0 },
      { ordinal: 3, id: "{0000-T2P}", heading: null, nesting: 0 },
      {
        ordinal: 4,
        id: "{0000-H2}",
        text: "Spans and cells",
        heading: 2,
        nesting: 0,
      },
      { ordinal: 5, id: "{0000-T3A}", heading: null, nesting: 0 },
    ]);
  });

  it("keeps the range's text as each host gives it", async () => {
    const pc = await read({ host: "pc" });
    expect(thread(pc.threads, "T14").anchor?.rangeText).toBe(
      "start sigma\tXC2 Cross cell end",
    );
    expect(thread(pc.threads, "T5").anchor?.rangeText).toBe("");
    const web = await read({ host: "web" });
    expect(thread(web.threads, "T6").anchor?.rangeText).toBe(
      "lima mike november\u0005 oscar\u0005",
    );
    expect(thread(web.threads, "T3").anchor?.rangeText).toBe(
      "foxtrot.\rT3B Middle span paragraph golf.\rT3C Last span\u0005",
    );
  });

  it("uses the Send capture's ordinals instead of reading the body", async () => {
    host = installWordCommentHost();
    const ordinalMap = new Map(
      V3C_COMMENT_DOCUMENT.body
        .flatMap((block) => ("table" in block ? block.table.flat() : [block]))
        .map((p, i) => [i + 1, { uniqueLocalId: `{0000-${p.tag}}`, text: "" }]),
    );
    const result = await readWordComments({
      now: host.now,
      inventory: wordCommentInventoryFromCapture(ordinalMap),
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.diagnostics.inventory).toBe("capture");
    expect(phase(result, "inventory")).toBeUndefined();
    expect(thread(result.threads, "T8").anchor?.first.ordinal).toBe(13);
    expect(thread(result.threads, "T14").anchor?.first.table).toBe(2);
  });

  it("proves ordinals by a unique text and compareLocationWith without paragraph ids", async () => {
    const { threads, diagnostics } = await read({ nullParagraphIds: true });
    expect(thread(threads, "T3").anchor).toMatchObject({
      first: { ordinal: 5, via: "text" },
      last: { ordinal: 7, via: "text" },
      single: false,
    });
    expect(thread(threads, "T6").anchor?.single).toBe(true);
    expect(keysOf(threads)).toEqual(ROOTS);
    expect(diagnostics.counts.positionUnknown).toBe(0);
    expect(host.calls()).toContain("range.compareLocationWith");
  });

  it("leaves a paragraph whose text repeats position-unknown, still in document order", async () => {
    const { threads, diagnostics } = await read({
      nullParagraphIds: true,
      document: generatedCommentDocument({
        paragraphs: 4,
        text: (i) => (i === 2 || i === 3 ? "Twin" : `G${i} Paragraph`),
        anchor: (i) => (i === 2 || i === 3 ? "twin words" : `anchor ${i}`),
      }),
    });
    expect(threads.map((t) => t.anchor?.first.ordinal ?? null)).toEqual([
      1,
      null,
      null,
      4,
    ]);
    expect(threads.map((t) => t.content)).toEqual([
      "Comment 1.",
      "Comment 2.",
      "Comment 3.",
      "Comment 4.",
    ]);
    expect(diagnostics.counts.positionUnknown).toBe(2);
  });

  it("isolates a failed range read to its thread, ordered last", async () => {
    const { threads, diagnostics } = await read({ failRanges: ["T6"] });
    expect(thread(threads, "T6").anchor).toBeNull();
    expect(keysOf(threads)).toEqual([...ROOTS.filter((k) => k !== "T6"), "T6"]);
    expect(diagnostics.counts.anchorsFailed).toBe(1);
  });
});

describe("exact anchors", () => {
  const expected = {
    T1: { quote: "alpha bravo" },
    T2: { quote: "delta echo" },
    T3: { quote: "foxtrot.…T3C Last span" },
    T4: { quote: "india juliet" },
    T5: { quote: "", point: true, after: "comment after kilo" },
    T6: { quote: "lima mike november oscar" },
    T7: { quote: "mike november" },
    T7b: { quote: "oscar papa quebec" },
    T8: { quote: "sierra tango", occurrence: 2 },
    T9: { quote: "uniform victor" },
    T10: { quote: "whiskey xray" },
    T11: { quote: "yankee zulu" },
    PB1: { quote: "anchor pb" },
    T14: { quote: "start sigma…XC2 Cross cell end", multi_cell: true },
  };

  it.each(HOSTS)("places every requested anchor on %s", async (h) => {
    const { threads, diagnostics } = await read(
      { host: h },
      { exact: () => ROOTS.map(host.commentId) },
    );
    for (const key of ROOTS) {
      const placement = thread(threads, key).placement;
      expect(placement?.status, key).toBe("placed");
      expect(placement?.anchor, key).toEqual(
        expected[key as keyof typeof expected],
      );
      if (placement?.status !== "placed") continue;
      const truth = V3C_ANCHORS[key];
      expect(
        [placement.offsets.start.visible, placement.offsets.end.visible],
        key,
      ).toEqual([truth.start, truth.end]);
    }
    expect(diagnostics.counts.placed).toBe(ROOTS.length);
  });

  it("joins single-paragraph marks by durableId on every host, and multi-paragraph ones by range package on desktop only", async () => {
    for (const h of HOSTS) {
      const { threads } = await read(
        { host: h },
        { exact: () => ROOTS.map(host.commentId) },
      );
      const joined = (key: string) => {
        const p = thread(threads, key).placement;
        return p?.status === "placed" ? p.joinedBy : p?.status;
      };
      expect(joined("T1")).toBe("durableId");
      expect(joined("T9")).toBe("durableId");
      expect(joined("T3")).toBe(h === "web" ? "text" : "durableId");
      expect(joined("T14")).toBe(h === "web" ? "text" : "durableId");
      expect(host.calls().includes("range.getOoxml")).toBe(h !== "web");
    }
  });

  it("offsets web anchors in paragraph.text past U+0005 and hidden text", async () => {
    const { threads } = await read(
      { host: "web" },
      { exact: askFor("T7b", "T10") },
    );
    const offsets = (key: string) => {
      const p = thread(threads, key).placement;
      return p?.status === "placed" ? p.offsets : null;
    };
    expect(offsets("T7b")).toEqual({
      start: { range: 32, visible: 31 },
      end: { range: 50, visible: 48 },
    });
    expect(offsets("T10")?.start).toEqual({ range: 19, visible: 12 });
  });

  it("reads one package for threads that share a paragraph", async () => {
    const result = await read({}, { exact: askFor("T6", "T7", "T7b") });
    expect(
      host.calls().filter((call) => call === "paragraph.getOoxml"),
    ).toHaveLength(1);
    expect(phase(result, "exact")).toMatchObject({
      total: 3,
      done: 3,
      syncs: 1,
    });
  });

  it("places only the threads asked for", async () => {
    const { threads } = await read({}, { exact: askFor("T8") });
    expect(threads.filter((t) => t.placement).map((t) => t.id)).toEqual([
      host.commentId("T8"),
    ]);
  });

  it("places selection threads first and degrades the rest honestly past the budget", async () => {
    const onProgress = vi.fn();
    const asked = ["T8", "T9", "T10", "T11", "T1", "T2", "T3"];
    const { threads, diagnostics } = await read(
      { host: "web" },
      { exact: askFor(...asked), budgetsMs: { exact: 1500 }, onProgress },
    );
    const status = (key: string) => thread(threads, key).placement?.status;
    expect(asked.map(status)).toEqual([
      "placed",
      "placed",
      "placed",
      "placed",
      "budget",
      "budget",
      "budget",
    ]);
    expect(thread(threads, "T1").placement?.anchor).toEqual({
      quote: "alpha bravo",
      position: "unknown",
    });
    expect(thread(threads, "T1").anchor?.first.ordinal).toBe(2);
    expect(thread(threads, "T5").placement).toBeUndefined();
    expect(phase({ threads, diagnostics } as never, "exact")).toMatchObject({
      total: 7,
      done: 4,
      exhausted: true,
      budgetMs: 1500,
    });
    expect(diagnostics.counts.budget).toBe(3);
    expect(onProgress).toHaveBeenCalledWith(4, 7, "exact");
    expect(renderWordCommentReadReport(diagnostics)).toContain(
      "exact: 2810 ms, 1 sync, 4/7 (budget 1500 ms, used up)",
    );
  });

  it("gives the coarse threads to the exact request in document order", async () => {
    const exact = vi.fn(() => []);
    await read({ host: "web" }, { exact });
    const [given] = exact.mock.calls[0] as unknown as [
      WordCommentThreadRecord[],
    ];
    expect(keysOf(given)).toEqual(ROOTS);
    expect(given.every((t) => t.anchor !== null)).toBe(true);
  });
});

describe("legacy files (F-2a, O-17)", () => {
  it("flags a modern file as not legacy from one probed package", async () => {
    const result = await read();
    expect(result.legacy).toBe(false);
    expect(phase(result, "legacy")).toMatchObject({ syncs: 1, done: 1 });
    expect(
      host.calls().filter((call) => call === "paragraph.getOoxml"),
    ).toHaveLength(1);
  });

  it.each(HOSTS)(
    "flags a file without commentsIds and matches its anchors by content on %s",
    async (h) => {
      const result = await read(
        { host: h, legacy: true },
        { exact: askFor("T1", "T6", "T7", "T8") },
      );
      expect(result.legacy).toBe(true);
      expect(phase(result, "legacy")).toBeUndefined();
      for (const key of ["T1", "T6", "T7", "T8"]) {
        const placement = thread(result.threads, key).placement;
        expect(placement?.status, key).toBe("placed");
        expect(placement?.status === "placed" && placement.joinedBy, key).toBe(
          "content",
        );
      }
      expect(result.diagnostics.counts.matchedByContent).toBe(4);
    },
  );
});

describe("renderWordCommentReadReport", () => {
  it("lists phases with syncs and timings", async () => {
    const result = await read({}, { exact: askFor("T1") });
    const report = renderWordCommentReadReport(result.diagnostics);
    expect(report.split("\n").slice(0, 2)).toEqual([
      "Word comment read: 14 threads, 3 replies",
      `Host: PC · inventory light · legacy no · ${result.diagnostics.totalMs} ms`,
    ]);
    expect(report).toMatch(/^list: \d+ ms, 1 sync, 1\/1$/m);
    expect(report).toMatch(/^anchors: \d+ ms, 1 sync, 14\/14 \(budget/m);
    expect(report).toContain("Anchors: placed 1");
  });
});
