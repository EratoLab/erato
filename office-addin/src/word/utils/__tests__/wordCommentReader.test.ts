import { afterEach, describe, expect, it, vi } from "vitest";

import {
  V3C_COMMENT_DOCUMENT,
  generatedCommentDocument,
  installWordCommentHost,
  uninstallWordCommentHost,
} from "../../../test/mocks/word/commentHost";
import {
  V3C_ANCHORS,
  V3C_COMMENTS,
  V3C_PARAGRAPHS,
} from "../../../test/mocks/word/commentPackages";
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
  WordCommentAnchorCache,
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

/** T6, T7 and T7b start in T6P; on the web only offsets order them, and the id meanwhile. */
const T6P_THREADS = ["T6", "T7", "T7b"];
const byIdInT6P = () => {
  const ids = T6P_THREADS.map(
    (key) => [key, Number(host.commentId(key))] as const,
  );
  const shared = ids.sort((a, b) => a[1] - b[1]).map(([key]) => key);
  return ROOTS.flatMap((key) =>
    key === "T6" ? shared : T6P_THREADS.includes(key) ? [] : [key],
  );
};

describe("readWordComments: the Office.js record", () => {
  it.each(["pc", "mac"] as const)(
    "lists every thread in document order on %s",
    async (h) => {
      const { threads } = await read({ host: h });
      expect(keysOf(threads)).toEqual(ROOTS);
      expect(threads.map((t) => t.order)).toEqual(ROOTS.map((_, i) => i));
      expect(threads.some((t) => t.orderUnsure)).toBe(false);
    },
  );

  it("lists threads in document order on the web, where nothing orders those in one paragraph", async () => {
    const { threads } = await read({ host: "web" });
    expect(keysOf(threads)).toEqual(byIdInT6P());
    expect(
      ROOTS.filter((key) => thread(threads, key).orderUnsure === true),
    ).toEqual(T6P_THREADS);
  });

  it("orders the threads of one paragraph by their offsets once packages placed them on the web", async () => {
    const { threads } = await read(
      { host: "web" },
      { exact: () => ROOTS.map(host.commentId) },
    );
    expect(keysOf(threads)).toEqual(ROOTS);
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

  it("asks the selection for its comments only on the web, never on desktop (F-11)", async () => {
    for (const h of HOSTS) {
      await read(
        { host: h, selection: { tag: "T1P", offset: 25 } },
        { selection: true },
      );
      expect(host.calls().includes("range.getComments")).toBe(h === "web");
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

  it("reads no package without packages: the requested threads get replies only", async () => {
    const result = await read(
      { host: "pc" },
      {
        replies: "requested",
        exact: askFor("T1", "T3"),
        packages: false,
        legacy: false,
      },
    );
    expect(thread(result.threads, "T1").replies).toHaveLength(2);
    expect(thread(result.threads, "T1").placement).toBeUndefined();
    expect(thread(result.threads, "T2").replies).toBeNull();
    expect(result.legacy).toBe(false);
    expect(host.calls()).not.toContain("paragraph.getOoxml");
    expect(host.calls()).not.toContain("range.getOoxml");
    expect(phase(result, "exact")).toBeUndefined();
    expect(phase(result, "legacy")).toBeUndefined();
  });

  it("reads no package on the web without packages, hidden text or not", async () => {
    const result = await read(
      { host: "web" },
      { replies: "requested", exact: askFor("T1", "T3"), packages: false },
    );
    expect(thread(result.threads, "T1").placement).toBeUndefined();
    expect(thread(result.threads, "T10").placement).toBeUndefined();
    expect(thread(result.threads, "T10").anchor?.first.ordinal).toBe(
      host.ordinalOf("T10P"),
    );
    expect(host.calls()).not.toContain("paragraph.getOoxml");
    expect(phase(result, "exact")).toBeUndefined();
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

  it("keeps the range's text as desktop gives it", async () => {
    const pc = await read({ host: "pc" });
    expect(thread(pc.threads, "T14").anchor?.rangeText).toBe(
      "start sigma\tXC2 Cross cell end",
    );
    expect(thread(pc.threads, "T5").anchor?.rangeText).toBe("");
  });

  it("locates every thread on the web from its paragraphs' own comments, with no comment range", async () => {
    const result = await read({ host: "web" });
    expect(result.threads.every((t) => t.anchor?.rangeText === null)).toBe(
      true,
    );
    expect(host.calls()).not.toContain("comment.getRange");
    expect(
      host.calls().filter((call) => call === "paragraph.getComments"),
    ).toHaveLength(host.ordinalOf("END"));
    expect(phase(result, "anchors")).toMatchObject({
      total: ROOTS.length,
      done: ROOTS.length,
      syncs: 3,
    });
    expect(result.diagnostics.counts).toMatchObject({
      anchorsUnlisted: 0,
      anchorsSkipped: 0,
      anchorsFailed: 0,
    });
  });

  it("keeps no anchor for a comment no paragraph lists on the web, and counts it", async () => {
    const { threads, diagnostics } = await read({
      host: "web",
      unlistedByParagraphs: ["T8"],
    });
    expect(thread(threads, "T8").anchor).toBeNull();
    expect(thread(threads, "T9").anchor?.first.ordinal).toBe(
      host.ordinalOf("T9P"),
    );
    expect(diagnostics.counts.anchorsUnlisted).toBe(1);
    expect(renderWordCommentReadReport(diagnostics)).toContain(
      "anchors no paragraph lists 1",
    );
  });

  it("leaves a thread named once before a failed listing with its first paragraph only", async () => {
    const generated = generatedCommentDocument({ paragraphs: 600 });
    const body = [...generated.body];
    body.splice(1, 0, {
      tag: "SPAN",
      segments: ["Span ", { cs: "S" }, "starts"],
    });
    body.splice(550, 0, {
      tag: "END",
      segments: ["Span ends", { ce: "S" }, " here."],
    });
    const document = {
      body,
      comments: {
        ...generated.comments,
        S: { ...generated.comments.G1, durableId: "0ABCDEF1" },
      },
    };
    const { threads, diagnostics } = await read({
      host: "web",
      document,
      failParagraphComments: ["G560"],
    });
    const span = thread(threads, "S");
    expect(span.anchor).toMatchObject({
      first: { ordinal: 2 },
      last: { ordinal: 2 },
      single: false,
    });
    expect(thread(threads, "G1").anchor?.single).toBe(false);
    expect(thread(threads, "G599").anchor).toBeNull();
    expect(diagnostics.errors[0]).toMatchObject({ phase: "anchors" });
    expect(diagnostics.counts.anchorsSkipped).toBeGreaterThan(0);
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

  /** Across paragraphs only a range's text or package tells where, and the web reads neither. */
  const ACROSS = ["T3", "T14"];

  it.each(["pc", "mac"] as const)(
    "places every requested anchor on %s",
    async (h) => {
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
    },
  );

  it("places every requested anchor inside one paragraph on the web, and leaves the others' position unknown", async () => {
    const { threads, diagnostics } = await read(
      { host: "web" },
      { exact: () => ROOTS.map(host.commentId) },
    );
    for (const key of ROOTS.filter((k) => !ACROSS.includes(k))) {
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
    for (const key of ACROSS)
      expect(thread(threads, key).placement, key).toEqual({
        status: "unplaced",
        anchor: { quote: "", position: "unknown" },
        source: { kind: "unplaced", rangeText: "" },
      });
    expect(thread(threads, "T3").anchor).toMatchObject({
      first: { ordinal: host.ordinalOf("T3A") },
      last: { ordinal: host.ordinalOf("T3C") },
      single: false,
    });
    expect(diagnostics.counts).toMatchObject({
      placed: ROOTS.length - ACROSS.length,
      unplaced: ACROSS.length,
    });
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
      expect(joined("T3")).toBe(h === "web" ? "unplaced" : "durableId");
      expect(joined("T14")).toBe(h === "web" ? "unplaced" : "durableId");
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
    const asked = ["T8", "T9", "T6", "T11", "T1", "T2", "T3"];
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
      "unplaced",
    ]);
    expect(thread(threads, "T1").placement?.anchor).toEqual({
      quote: "",
      position: "unknown",
    });
    expect(thread(threads, "T1").anchor?.first.ordinal).toBe(2);
    expect(thread(threads, "T5").placement).toBeUndefined();
    expect(phase({ threads, diagnostics } as never, "exact")).toMatchObject({
      total: 7,
      done: 5,
      exhausted: true,
      budgetMs: 1500,
    });
    expect(diagnostics.counts.budget).toBe(2);
    expect(onProgress).toHaveBeenCalledWith(5, 7, "exact");
    expect(renderWordCommentReadReport(diagnostics)).toContain(
      "exact: 2810 ms, 1 sync, 5/7 (budget 1500 ms, used up)",
    );
  });

  it.each(HOSTS)(
    "gives the coarse threads to the exact request in document order on %s",
    async (h) => {
      const exact = vi.fn(() => []);
      await read({ host: h }, { exact });
      const [given] = exact.mock.calls[0] as unknown as [
        WordCommentThreadRecord[],
      ];
      expect(keysOf(given)).toEqual(h === "web" ? byIdInT6P() : ROOTS);
      expect(given.every((t) => t.anchor !== null)).toBe(true);
    },
  );
});

describe("legacy files (F-2a, O-17, gate F2)", () => {
  it("flags a modern file as not legacy from one probed package", async () => {
    const result = await read();
    expect(result.legacy).toBe(false);
    expect(phase(result, "legacy")).toMatchObject({ syncs: 1, done: 1 });
    expect(
      host.calls().filter((call) => call === "paragraph.getOoxml"),
    ).toHaveLength(1);
  });

  it("probes on past a package without dateUtc until one has it", async () => {
    const result = await read({}, { exact: askFor("T5") });
    expect(result.legacy).toBe(false);
    expect(phase(result, "legacy")).toMatchObject({ done: 1 });
  });

  it.each(["pc", "mac"] as const)(
    "takes a file legacy on %s once three packages show no dateUtc, though they carry the session's ids",
    async (h) => {
      const result = await read({ host: h, legacy: true });
      expect(result.legacy).toBe(true);
      expect(phase(result, "legacy")).toMatchObject({ syncs: 3, done: 3 });
    },
  );

  it("counts the exact phase's packages towards the legacy answer", async () => {
    const result = await read(
      { legacy: true },
      { exact: askFor("T1", "T6", "T7", "T8") },
    );
    expect(result.legacy).toBe(true);
    expect(phase(result, "legacy")).toBeUndefined();
    for (const key of ["T1", "T6", "T7", "T8"]) {
      const placement = thread(result.threads, key).placement;
      expect(placement?.status === "placed" && placement.joinedBy, key).toBe(
        "durableId",
      );
    }
  });

  it("answers from Word's dates on the web, with no package read for it", async () => {
    const modern = await read({ host: "web" });
    expect(modern.legacy).toBe(false);
    const legacy = await read({ host: "web", legacy: true });
    expect(legacy.legacy).toBe(true);
    expect(phase(legacy, "legacy")).toBeUndefined();
  });

  it("keeps what an earlier read of the document found", async () => {
    const result = await read({ legacy: true }, { legacy: false });
    expect(result.legacy).toBe(false);
    expect(phase(result, "legacy")).toBeUndefined();
    expect(host.calls()).not.toContain("paragraph.getOoxml");
  });
});

describe("Word for the web reads no comment range (gates F1 and F2)", () => {
  const ALL = { exact: () => ROOTS.map(host.commentId), selection: true };

  it("places T10 from its paragraph's package and leaves its hidden text hidden", async () => {
    const result = await read({ host: "web" }, ALL);
    expect(host.rangesRead()).toEqual([]);
    expect(host.unhidden()).toEqual([]);
    const t10 = thread(result.threads, "T10");
    expect(t10.anchor?.first.ordinal).toBe(host.ordinalOf("T10P"));
    expect(t10.placement).toMatchObject({
      status: "placed",
      joinedBy: "durableId",
      anchor: { quote: "whiskey xray" },
      offsets: { start: { range: 19, visible: 12 } },
    });
  });

  it("reads ranges as before on desktop", async () => {
    await read({ host: "pc" });
    expect(host.rangesRead()).toContain("T10");
    expect(host.calls()).not.toContain("paragraph.getComments");
  });

  it("places a thread past a page break, which only paragraph.text shows (U+000C)", async () => {
    const { threads } = await read({ host: "web" }, { exact: askFor("PB1") });
    const pb1 = thread(threads, "PB1");
    expect(pb1.anchor?.first.rangeText).toContain("\u000C");
    expect(pb1.placement).toMatchObject({
      status: "placed",
      joinedBy: "durableId",
      anchor: { quote: "anchor pb" },
      offsets: {
        start: { visible: V3C_ANCHORS.PB1.start },
        end: { visible: V3C_ANCHORS.PB1.end },
      },
    });
  });

  it("leaves only the threads of a paragraph its package cannot explain unplaced", async () => {
    const odd = {
      ...V3C_COMMENTS.T1,
      paraId: "0D000001",
      durableId: "0E000001",
      content: "Odd root.",
    };
    const { threads, diagnostics } = await read(
      {
        host: "web",
        bareParagraphPackages: ["X1"],
        document: {
          v3c: true,
          comments: { ...V3C_COMMENTS, ODD: odd },
          body: [
            { tag: "T1P", segments: V3C_PARAGRAPHS.T1P },
            {
              tag: "X1",
              segments: ["Lead ", { cs: "ODD" }, "odd", { ce: "ODD" }, "."],
            },
            { tag: "T10P", segments: V3C_PARAGRAPHS.T10P },
          ],
        },
      },
      { exact: askFor("T1", "ODD", "T10") },
    );
    expect(thread(threads, "ODD").placement).toMatchObject({
      status: "unplaced",
      anchor: { quote: "", position: "unknown" },
    });
    expect(thread(threads, "ODD").anchor?.first.ordinal).toBe(2);
    for (const key of ["T1", "T10"])
      expect(thread(threads, key).placement?.status, key).toBe("placed");
    expect(diagnostics.counts).toMatchObject({ placed: 2, unplaced: 1 });
  });

  it("places a legacy file's threads by content, whose packages name other ids (gate F2)", async () => {
    const result = await read({ host: "web", legacy: true }, ALL);
    expect(result.legacy).toBe(true);
    const single = ROOTS.filter((key) => !["T3", "T14"].includes(key));
    for (const key of single) {
      const placement = thread(result.threads, key).placement;
      expect(placement?.status === "placed" && placement.joinedBy, key).toBe(
        "content",
      );
    }
    expect(result.diagnostics.counts.matchedByContent).toBe(single.length);
    expect(thread(result.threads, "PB1").placement?.anchor).toEqual({
      quote: "anchor pb",
    });
  });

  it("pairs no legacy thread whose content and author another in its paragraph shares", async () => {
    const same = { content: "Same root.", author: V3C_COMMENTS.T6.author };
    const { threads } = await read(
      {
        host: "web",
        legacy: true,
        document: {
          ...V3C_COMMENT_DOCUMENT,
          comments: {
            ...V3C_COMMENTS,
            T6: { ...V3C_COMMENTS.T6, ...same },
            T7: { ...V3C_COMMENTS.T7, ...same },
          },
        },
      },
      { exact: askFor("T6", "T7", "T7b", "T1") },
    );
    expect(thread(threads, "T6").placement?.status).toBe("unplaced");
    expect(thread(threads, "T7").placement?.status).toBe("unplaced");
    for (const key of ["T7b", "T1"]) {
      const placement = thread(threads, key).placement;
      expect(placement?.status === "placed" && placement.joinedBy, key).toBe(
        "content",
      );
    }
  });
});

describe("dateUtc from the packages read (F-4)", () => {
  it("names the comments the packages showed with and without dateUtc", async () => {
    const result = await read({}, { exact: askFor("T1", "T5") });
    expect(Object.fromEntries(result.dateUtc.byId)).toEqual({
      [host.commentId("T1")]: true,
      [host.commentId("R1a")]: true,
      [host.commentId("R1b")]: true,
      [host.commentId("T5")]: false,
    });
    expect(result.dateUtc.otherwise).toBeNull();
  });

  it("never takes the comments no package showed for UTC", async () => {
    const result = await read({}, { exact: askFor("T1") });
    expect(result.dateUtc.otherwise).toBeNull();
  });

  it("knows nothing when no package was read", async () => {
    const result = await read({ document: { body: [], comments: {} } });
    expect(result.dateUtc).toEqual({ byId: new Map(), otherwise: null });
  });

  it("finds no dateUtc in a legacy file", async () => {
    const result = await read({ legacy: true }, { exact: askFor("T1") });
    expect([...result.dateUtc.byId.values()].every((utc) => !utc)).toBe(true);
    expect(result.dateUtc.otherwise).toBe(false);
  });
});

describe("the user's selection", () => {
  const relationOf = (
    threads: readonly WordCommentThreadRecord[],
    key: string,
  ) => thread(threads, key).selection;

  it.each(["pc", "mac"] as const)(
    "relates only the anchors around a caret to it on %s",
    async (h) => {
      let seen: unknown = "not called";
      const result = await read(
        { host: h, selection: { tag: "T6P", offset: 20 } },
        {
          selection: true,
          exact: (_threads, live) => {
            seen = live;
            return [];
          },
        },
      );
      const ordinal = host.ordinalOf("T6P");
      expect(result.selection).toEqual({
        collapsed: true,
        first: ordinal,
        last: ordinal,
      });
      expect(seen).toEqual(result.selection);
      expect(relationOf(result.threads, "T6")).toBe("Contains");
      expect(relationOf(result.threads, "T7")).toBe("Contains");
      expect(relationOf(result.threads, "T7b")).toBe("After");
      expect(relationOf(result.threads, "T1")).toBeUndefined();
      expect(phase(result, "relations")).toMatchObject({ total: 3, done: 3 });
      expect(host.calls()).not.toContain("range.getComments");
      expect(result.threads.some((t) => t.touchesSelection)).toBe(false);
    },
  );

  it("takes the threads the selection names as touching it on the web, and relates no range", async () => {
    const result = await read(
      { host: "web", selection: { tag: "T6P", offset: 20 } },
      { selection: true },
    );
    const touching = ROOTS.filter(
      (key) => thread(result.threads, key).touchesSelection === true,
    );
    expect(touching).toEqual(["T6", "T7"]);
    expect(result.threads.every((t) => t.selection === undefined)).toBe(true);
    expect(phase(result, "relations")).toMatchObject({ total: 0, done: 0 });
  });

  it("relates a selection across paragraphs to every anchor reaching them", async () => {
    const result = await read(
      {
        selection: { tag: "T3A", offset: 0, to: { tag: "T3B", offset: 5 } },
      },
      { selection: true },
    );
    expect(result.selection).toEqual({
      collapsed: false,
      first: host.ordinalOf("T3A"),
      last: host.ordinalOf("T3B"),
    });
    expect(relationOf(result.threads, "T3")).toBe("OverlapsAfter");
    expect(relationOf(result.threads, "T2")).toBeUndefined();
  });

  it("relates nothing to a selection the inventory cannot place", async () => {
    const result = await read(
      { nullParagraphIds: true, selection: { tag: "T1P", offset: 25 } },
      { selection: true },
    );
    expect(result.selection).toEqual({
      collapsed: true,
      first: null,
      last: null,
    });
    expect(result.threads.some((t) => t.selection !== undefined)).toBe(false);
    expect(phase(result, "relations")).toBeUndefined();
  });

  it("reads no selection unless asked", async () => {
    const result = await read({ selection: { tag: "T1P", offset: 25 } });
    expect(result.selection).toBeNull();
    expect(host.calls()).not.toContain("document.getSelection");
  });
});

describe("anchors kept between reads", () => {
  const NO_ANCHORS = (): WordCommentAnchorCache => ({
    generation: 0,
    snapshot: null,
  });
  async function readWith(
    hostOptions: CommentHostOptions,
    anchors: { cache: WordCommentAnchorCache; reuse: boolean },
    options: Omit<WordCommentReadOptions, "now" | "anchors"> = {},
  ) {
    return read(hostOptions, {
      selection: true,
      packages: false,
      legacy: false,
      replies: "requested",
      exact: (_threads, live) =>
        live?.first == null ? [] : askFor("T6", "T7")(),
      anchors,
      ...options,
    });
  }
  const view = (result: Awaited<ReturnType<typeof read>>) => ({
    selection: result.selection,
    threads: result.threads.map((t) => ({
      id: t.id,
      order: t.order,
      anchor: t.anchor,
      placement: t.placement,
      selection: t.selection,
      touchesSelection: t.touchesSelection,
      orderUnsure: t.orderUnsure,
      replies: t.replies?.length ?? null,
    })),
  });
  const PASSAGE_T1 = { tag: "T1P", offset: 22, to: { tag: "T1P", offset: 33 } };
  const T6_CARET = { tag: "T6P", offset: 20 };

  it.each(HOSTS)(
    "relate a moved caret as a full read does, reading only the ranges around it, on %s",
    async (h) => {
      const cache = NO_ANCHORS();
      await readWith(
        { host: h, selection: PASSAGE_T1 },
        { cache, reuse: false },
      );
      expect(cache.snapshot?.ids).toHaveLength(ROOTS.length);

      const kept = await readWith(
        { host: h, selection: T6_CARET },
        { cache, reuse: true },
      );
      expect(host.calls()).not.toContain("paragraphs.load");
      expect([...host.rangesRead()].sort()).toEqual(
        h === "web" ? [] : ["T6", "T7", "T7b"],
      );
      expect(host.unhidden()).toEqual([]);

      const full = await readWith(
        { host: h, selection: T6_CARET },
        { cache: NO_ANCHORS(), reuse: true },
      );
      expect(host.calls()).toContain("paragraphs.load");
      expect(view(kept)).toEqual(view(full));
    },
  );

  it("read everything again in a later generation or for other comments", async () => {
    const cache = NO_ANCHORS();
    await readWith({ selection: PASSAGE_T1 }, { cache, reuse: false });
    cache.generation += 1;
    await readWith({ selection: T6_CARET }, { cache, reuse: true });
    expect(host.calls()).toContain("paragraphs.load");

    const other = await readWith(
      {
        document: generatedCommentDocument({ paragraphs: 3 }),
        selection: { tag: "G2", offset: 3 },
      },
      { cache, reuse: true },
      { exact: () => [] },
    );
    expect(host.calls()).toContain("paragraphs.load");
    expect(other.threads).toHaveLength(3);
  });

  it("keep nothing from a read that did not place every anchor", async () => {
    const cache = NO_ANCHORS();
    await readWith(
      { selection: PASSAGE_T1 },
      { cache, reuse: false },
      { budgetsMs: { anchors: 0 } },
    );
    expect(cache.snapshot).toBeNull();
  });

  it("relate a caret on the web by the selection's own comments, reading no range", async () => {
    const cache = NO_ANCHORS();
    await readWith(
      { host: "web", selection: PASSAGE_T1 },
      { cache, reuse: false },
    );
    const kept = await readWith(
      { host: "web", selection: { tag: "T10P", offset: 22 } },
      { cache, reuse: true },
    );
    expect(host.calls()).not.toContain("paragraphs.load");
    expect(host.unhidden()).toEqual([]);
    const t10 = thread(kept.threads, "T10");
    expect(t10.anchor?.first.ordinal).toBe(host.ordinalOf("T10P"));
    expect(t10.touchesSelection).toBe(true);
    expect(thread(kept.threads, "T1").touchesSelection).toBeUndefined();
  });
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

describe("the web host's guard", () => {
  it("fails the test that reads a comment range on Word for the web", async () => {
    host = installWordCommentHost({ host: "web" });
    await Word.run(async (context) => {
      const comments = context.document.body.getComments();
      comments.load("items/id");
      await context.sync();
      expect(() => comments.items[0].getRange()).toThrow(/gate F1/);
    });
    expect(() => uninstallWordCommentHost()).toThrow(
      /Comment\.getRange\(\) was called on Word for the web/,
    );
  });
});
