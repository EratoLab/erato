import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installMockWordDocument,
  uninstallMockWordDocument,
} from "../../../test/mocks/word/document";
import {
  body,
  chapter,
  heading,
  okResult,
  readContext,
  sectionSnapshot,
} from "../../../test/mocks/word/sectionFixtures";
import { WORD_FRESHNESS_NOTICE } from "../wordAuthoringContract";
import {
  beginWordOwnWrite,
  nameWordOwnWriteIds,
  noteWordCapturedIds,
  noteWordChangeEventsActive,
  recordWordParagraphEvent,
  recordWordUnknownChange,
  resetWordChangeJournalForTests,
  wordChangePosition,
} from "../wordChangeJournal";
import { WordDocumentReadSession } from "../wordDocumentReadTool";

import type { SectionBlock } from "../../../test/mocks/word/sectionFixtures";
import type { WordDocumentBuild } from "../buildWordDocumentArgs";
import type { WordReadAccess } from "../wordReadAccess";
import type { WordReadCapture, WordReadFreshness } from "../wordReadFreshness";
import type { WordAuthoringSnapshot } from "@erato/frontend/word-review";

/** Three chapters, each with a table, and two paragraphs of the same text in chapter 2. */
function document(chapters = 3) {
  const blocks: SectionBlock[] = [];
  for (let n = 1; n <= chapters; n++) {
    blocks.push(...chapter(n, 4));
    if (n === 2) blocks.push(body("Same text."), body("Same text."));
  }
  const snapshot = sectionSnapshot(blocks);
  const ordinalMap: WordDocumentBuild["ordinalMap"] = new Map();
  /** The paragraph ids of each block: one, or a table's cell paragraphs. */
  const ids = new Map<string, string[]>();
  let ordinal = 0;
  for (const block of snapshot.blocks) {
    const texts =
      block.type === "native"
        ? block.content!.rows.flatMap((row) => row.cells.map((c) => c.text))
        : [block.text];
    const own = texts.map((text) => {
      ordinal += 1;
      const id = `${block.type === "native" ? "c" : "p"}${ordinal}`;
      ordinalMap.set(ordinal, { uniqueLocalId: id, text });
      return id;
    });
    ids.set(block.ref, own);
    if (block.type !== "native" && block.text !== "Same text.")
      block.paragraphOrdinal = ordinal;
  }
  return { snapshot, ordinalMap, ids };
}

const refOf = (snapshot: WordAuthoringSnapshot, text: string) =>
  snapshot.blocks.find((b) => b.text === text)!.ref;
const firstBody = (snapshot: WordAuthoringSnapshot, chapterNumber: number) => {
  const heading = snapshot.blocks.findIndex(
    (b) => b.text === `${chapterNumber}.1 Section ${chapterNumber}.1`,
  );
  return snapshot.blocks[heading + 1];
};

const event = (
  type: "ParagraphAdded" | "ParagraphChanged" | "ParagraphDeleted",
  ids: string[],
  source = "Local",
) => recordWordParagraphEvent({ type, source, uniqueLocalIds: ids });

function open(
  snapshot: WordAuthoringSnapshot,
  capture: WordReadCapture | undefined,
  access?: WordReadAccess,
) {
  const session = new WordDocumentReadSession();
  session.activate(snapshot, readContext, undefined, { access, capture });
  const base = {
    snapshot: snapshot.token,
    documentIdentity: snapshot.identity,
  };
  const call = (input: Record<string, unknown>, readOnly = false) =>
    readOnly
      ? session.executeReadOnly(input, readContext)
      : session.execute(input, readContext);
  return {
    section: async (ref: string, readOnly = true) =>
      okResult<{ freshness: WordReadFreshness }>(
        await call({ ...base, section: { ref } }, readOnly),
      ).freshness,
    target: async (ref: string, readOnly = false) =>
      okResult<{ freshness: WordReadFreshness }>(
        await call({ ...base, target: { ref } }, readOnly),
      ).freshness,
    queries: async (refs: string[], readOnly = false) =>
      okResult<{ freshness: WordReadFreshness }>(
        await call(
          { ...base, target: { queries: refs.map((ref) => ({ ref })) } },
          readOnly,
        ),
      ).freshness,
    cell: async (text: string, readOnly = false) =>
      okResult<{ status: string; freshness: WordReadFreshness }>(
        await call({ ...base, table_cell: { text } }, readOnly),
      ),
    raw: (input: Record<string, unknown>, readOnly = false) =>
      call({ ...base, ...input }, readOnly),
    complete: async () =>
      okResult<{ freshness: WordReadFreshness }>(
        await call({ snapshot: snapshot.token, cursor: null }),
      ).freshness,
  };
}

const CAPTURED_AT = "2026-10-29T12:00:00.000Z";

let doc: ReturnType<typeof document>;
let capture: WordReadCapture;

function captureNow() {
  doc = document();
  noteWordCapturedIds([...doc.ordinalMap.values()].map((p) => p.uniqueLocalId));
  capture = {
    changes: { position: wordChangePosition(), capturedAt: CAPTURED_AT },
    ordinalMap: doc.ordinalMap,
  };
}

describe("read freshness", () => {
  beforeEach(() => {
    resetWordChangeJournalForTests();
    noteWordChangeEventsActive();
    captureNow();
  });

  afterEach(() => {
    vi.useRealTimers();
    uninstallMockWordDocument();
  });

  it("names the capture and its time, and reports none while nothing changed", async () => {
    const reads = open(doc.snapshot, capture);

    expect(await reads.section(refOf(doc.snapshot, "1. Chapter 1"))).toEqual({
      context_ref: doc.snapshot.token,
      capturedAt: CAPTURED_AT,
      changes: "none",
      counts: { own: 0, local: 0, remote: 0, unknown: 0 },
      sections: [],
    });
  });

  it("carries the block on every read shape, write and read-only, within 512 bytes, which replay keeps whole", async () => {
    event("ParagraphChanged", doc.ids.get(firstBody(doc.snapshot, 3).ref)!);
    const reads = open(doc.snapshot, capture);
    const ref = firstBody(doc.snapshot, 1).ref;
    const shapes = [
      await reads.section(refOf(doc.snapshot, "1. Chapter 1")),
      await reads.target(ref),
      await reads.target(ref, true),
      await reads.queries([ref]),
      await reads.queries([ref], true),
      (await reads.cell("Service 1")).freshness,
      (await reads.cell("Service 1", true)).freshness,
      await reads.complete(),
    ];
    for (const freshness of shapes) {
      expect(freshness).toMatchObject({
        context_ref: doc.snapshot.token,
        capturedAt: CAPTURED_AT,
        counts: { own: 0, local: 1, remote: 0, unknown: 0 },
      });
      expect(
        new TextEncoder().encode(JSON.stringify(freshness)).length,
      ).toBeLessThanOrEqual(512);
    }
  });

  it("names the blind spots in the guidance it returns", async () => {
    const session = new WordDocumentReadSession();
    session.activate(doc.snapshot, readContext, undefined, { capture });
    const first = okResult<{ contract: { freshness: string } }>(
      await session.execute(
        { snapshot: doc.snapshot.token, cursor: null },
        readContext,
      ),
    );
    const section = okResult<{ freshnessNotice: string }>(
      await session.executeReadOnly(
        {
          snapshot: doc.snapshot.token,
          documentIdentity: doc.snapshot.identity,
          section: { ref: refOf(doc.snapshot, "1. Chapter 1") },
        },
        readContext,
      ),
    );

    expect(first.contract.freshness).toBe(WORD_FRESHNESS_NOTICE);
    expect(section.freshnessNotice).toBe(WORD_FRESHNESS_NOTICE);
    expect(WORD_FRESHNESS_NOTICE).toContain(
      'changes:"none" means no text change',
    );
  });

  describe("in scope or elsewhere", () => {
    beforeEach(() => {
      event("ParagraphChanged", doc.ids.get(firstBody(doc.snapshot, 3).ref)!);
    });

    it("tells a section read whether the change lies in it", async () => {
      const reads = open(doc.snapshot, capture);
      const chapter3 = await reads.section(refOf(doc.snapshot, "3. Chapter 3"));
      const chapter1 = await reads.section(refOf(doc.snapshot, "1. Chapter 1"));

      expect(chapter3.changes).toBe("in-scope");
      expect(chapter1.changes).toBe("elsewhere");
      expect(chapter1.sections).toEqual([
        refOf(doc.snapshot, "3.1 Section 3.1"),
      ]);
    });

    it("tells a target read by the outline entries of the blocks it read", async () => {
      const reads = open(doc.snapshot, capture);
      const neighbour = doc.snapshot.blocks.at(
        doc.snapshot.blocks.indexOf(firstBody(doc.snapshot, 3)) + 1,
      )!;

      expect((await reads.target(neighbour.ref)).changes).toBe("in-scope");
      expect(
        (await reads.queries([firstBody(doc.snapshot, 1).ref])).changes,
      ).toBe("elsewhere");
      expect(
        (await reads.target(refOf(doc.snapshot, "3.2 Section 3.2"))).changes,
      ).toBe("elsewhere");
    });

    it("tells a table_cell read by its table's section", async () => {
      const reads = open(doc.snapshot, capture);

      expect((await reads.cell("Service 3")).freshness.changes).toBe(
        "in-scope",
      );
      expect((await reads.cell("Service 2", true)).freshness.changes).toBe(
        "elsewhere",
      );
    });

    it("counts any change as in scope for a search that found no single target, which looked through the whole capture", async () => {
      const session = new WordDocumentReadSession();
      session.activate(doc.snapshot, readContext, undefined, { capture });
      const read = async (input: Record<string, unknown>) =>
        okResult<{ status: string; freshness: WordReadFreshness }>(
          await session.execute(
            {
              snapshot: doc.snapshot.token,
              documentIdentity: doc.snapshot.identity,
              ...input,
            },
            readContext,
          ),
        );
      const ambiguous = await read({ target: { text: "Section 1." } });
      const missing = await read({ target: { text: "Not in this document" } });
      const unresolved = await read({
        target: {
          queries: [
            { ref: firstBody(doc.snapshot, 1).ref },
            { text: "Not in this document" },
          ],
        },
      });
      const cells = await read({ table_cell: { text: "Service" } });

      expect(
        [ambiguous, missing, unresolved, cells].map((r) => [
          r.status,
          r.freshness.changes,
        ]),
      ).toEqual([
        ["ambiguous", "in-scope"],
        ["not-found", "in-scope"],
        ["not-found", "in-scope"],
        ["ambiguous", "in-scope"],
      ]);
    });

    it("counts any change as in scope for the complete read", async () => {
      expect((await open(doc.snapshot, capture).complete()).changes).toBe(
        "in-scope",
      );
    });

    it("counts a co-author's change as remote", async () => {
      event(
        "ParagraphChanged",
        doc.ids.get(firstBody(doc.snapshot, 2).ref)!,
        "Remote",
      );
      const freshness = await open(doc.snapshot, capture).section(
        refOf(doc.snapshot, "2. Chapter 2"),
      );

      expect(freshness).toMatchObject({
        changes: "in-scope",
        counts: { own: 0, local: 1, remote: 1, unknown: 0 },
        sections: [
          refOf(doc.snapshot, "2.1 Section 2.1"),
          refOf(doc.snapshot, "3.1 Section 3.1"),
        ],
      });
    });
  });

  describe("mapping paragraphs no block maps to", () => {
    it("places a table-cell paragraph in its table", async () => {
      const table = doc.snapshot.blocks.find(
        (b) => b.type === "native" && b.text.includes("Service 2"),
      )!;
      event("ParagraphChanged", [doc.ids.get(table.ref)![3]]);
      const reads = open(doc.snapshot, capture);

      expect((await reads.cell("Service 2")).freshness.changes).toBe(
        "in-scope",
      );
      expect((await reads.target(table.ref)).changes).toBe("in-scope");
      expect(
        (await reads.section(refOf(doc.snapshot, "1. Chapter 1"))).sections,
      ).toEqual([refOf(doc.snapshot, "2.1 Section 2.1")]);
    });

    it("places a paragraph whose text repeats between its mapped neighbours", async () => {
      const twin = doc.snapshot.blocks.filter((b) => b.text === "Same text.");
      event("ParagraphChanged", doc.ids.get(twin[1].ref)!);
      const reads = open(doc.snapshot, capture);

      expect((await reads.target(twin[0].ref)).changes).toBe("in-scope");
      expect(
        (await reads.section(refOf(doc.snapshot, "3. Chapter 3"))).changes,
      ).toBe("elsewhere");
    });

    it("places an added paragraph by its captured neighbour", async () => {
      vi.useFakeTimers();
      const anchor = firstBody(doc.snapshot, 3);
      const live = [...doc.ordinalMap.values()].flatMap((p) =>
        p.uniqueLocalId === doc.ids.get(anchor.ref)![0]
          ? [p.uniqueLocalId, "new-1"]
          : [p.uniqueLocalId!],
      );
      installMockWordDocument(
        live.map((id) => ({ text: id, uniqueLocalId: id })),
      );
      event("ParagraphAdded", ["new-1"]);
      event("ParagraphChanged", ["new-1"]);
      await vi.advanceTimersByTimeAsync(100);
      const reads = open(doc.snapshot, capture);

      expect(
        (await reads.section(refOf(doc.snapshot, "3. Chapter 3"))).changes,
      ).toBe("in-scope");
      expect(
        await reads.section(refOf(doc.snapshot, "1. Chapter 1")),
      ).toMatchObject({
        changes: "elsewhere",
        sections: [refOf(doc.snapshot, "3.1 Section 3.1")],
      });
    });

    it("reads an added paragraph whose place Word could not tell as unknown, never none", async () => {
      vi.useFakeTimers();
      installMockWordDocument([{ text: "x", uniqueLocalId: "elsewhere-1" }]);
      event("ParagraphAdded", ["new-1"]);
      await vi.advanceTimersByTimeAsync(100);
      const reads = open(doc.snapshot, capture);

      expect(
        (await reads.section(refOf(doc.snapshot, "1. Chapter 1"))).changes,
      ).toBe("unknown");
      expect(await reads.complete()).toMatchObject({ changes: "in-scope" });
    });

    it("reads an added paragraph still being placed as unknown", async () => {
      event("ParagraphAdded", ["new-1"]);

      expect(
        (
          await open(doc.snapshot, capture).section(
            refOf(doc.snapshot, "1. Chapter 1"),
          )
        ).changes,
      ).toBe("unknown");
    });
  });

  describe("the pane's own writes", () => {
    it("count as own and never change what the read reports", async () => {
      const written = doc.ids.get(firstBody(doc.snapshot, 1).ref)!;
      const inPlace = beginWordOwnWrite("ids");
      nameWordOwnWriteIds(written);
      event("ParagraphChanged", written);
      inPlace.end();
      const insert = beginWordOwnWrite("anchor");
      event("ParagraphAdded", ["new-1"]);
      insert.end();

      expect(
        await open(doc.snapshot, capture).section(
          refOf(doc.snapshot, "1. Chapter 1"),
        ),
      ).toMatchObject({
        changes: "none",
        counts: { own: 2, local: 0, remote: 0, unknown: 0 },
        sections: [],
      });
    });
  });

  describe("unknown", () => {
    const sectionRead = () =>
      open(doc.snapshot, capture).section(refOf(doc.snapshot, "1. Chapter 1"));

    it("without paragraph events, never none", async () => {
      resetWordChangeJournalForTests();
      captureNow();

      expect(await sectionRead()).toMatchObject({
        changes: "unknown",
        counts: { own: 0, local: 0, remote: 0, unknown: 0 },
      });
    });

    it("after the pane noticed a Track Changes toggle", async () => {
      recordWordUnknownChange("tracking-mode");

      expect(await sectionRead()).toMatchObject({
        changes: "unknown",
        counts: { own: 0, local: 0, remote: 0, unknown: 1 },
      });
    });

    it("for a capture taken while Word was still tagging languages, which fires no events", async () => {
      const freshness = await open(doc.snapshot, {
        ...capture,
        changes: { ...capture.changes!, proofingPending: true },
      }).section(refOf(doc.snapshot, "1. Chapter 1"));

      expect(freshness.changes).toBe("unknown");
    });

    it("for a capture without paragraph ids", async () => {
      const ordinalMap = new Map(
        [...doc.ordinalMap].map(([k, p]) => [k, { ...p, uniqueLocalId: null }]),
      );
      const freshness = await open(doc.snapshot, {
        ...capture,
        ordinalMap,
      }).section(refOf(doc.snapshot, "1. Chapter 1"));

      expect(freshness.changes).toBe("unknown");
    });

    it("once the capture's ids were replaced", async () => {
      event("ParagraphDeleted", [...doc.ids.values()].flat());

      expect(await sectionRead()).toMatchObject({
        changes: "unknown",
        counts: { own: 0, local: 0, remote: 0, unknown: 1 },
      });
    });

    it("for a capture from before a reload", async () => {
      resetWordChangeJournalForTests();
      noteWordChangeEventsActive();

      expect((await sectionRead()).changes).toBe("unknown");
    });

    it("for a capture older than the journal keeps", async () => {
      for (let k = 0; k < 1_001; k++) recordWordUnknownChange("tracking-mode");

      expect(await sectionRead()).toMatchObject({
        changes: "unknown",
        counts: { own: 0, local: 0, remote: 0, unknown: 0 },
      });
    });

    it("without a capture record, with no time", async () => {
      const freshness = await open(doc.snapshot, undefined).section(
        refOf(doc.snapshot, "1. Chapter 1"),
      );

      expect(freshness).toEqual({
        context_ref: doc.snapshot.token,
        changes: "unknown",
        counts: { own: 0, local: 0, remote: 0, unknown: 0 },
        sections: [],
      });
    });
  });

  it("drops the last section refs to stay within 512 bytes", async () => {
    resetWordChangeJournalForTests();
    noteWordChangeEventsActive();
    doc = document(40);
    doc.snapshot.token = `snapshot-${"t".repeat(200)}`;
    capture = {
      changes: { position: wordChangePosition(), capturedAt: CAPTURED_AT },
      ordinalMap: doc.ordinalMap,
    };
    for (let n = 1; n <= 40; n++)
      event("ParagraphChanged", doc.ids.get(firstBody(doc.snapshot, n).ref)!);

    const freshness = await open(doc.snapshot, capture).section(
      refOf(doc.snapshot, "1. Chapter 1"),
    );

    expect(freshness.sections.length).toBeGreaterThan(0);
    expect(freshness.sections.length).toBeLessThan(32);
    expect(freshness.sections[0]).toBe(refOf(doc.snapshot, "1.1 Section 1.1"));
    expect(
      new TextEncoder().encode(JSON.stringify(freshness)).length,
    ).toBeLessThanOrEqual(512);
  });

  it.each(["write", "read-only"] as const)(
    "keeps a %s target response within its 24 KiB with the freshness block",
    async (access) => {
      const statuses = new Set<string>();
      for (let bytes = 4_000; !statuses.has("unsupported"); bytes += 32) {
        const snapshot = sectionSnapshot(
          [heading(1, "1. One"), body("x".repeat(bytes))],
          { token: `snapshot-${"t".repeat(300)}` },
        );
        const response = okResult<{ status: string }>(
          await open(snapshot, {
            changes: {
              position: wordChangePosition(),
              capturedAt: CAPTURED_AT,
            },
          }).raw({ target: { ref: "b2" } }, access === "read-only"),
        );
        statuses.add(response.status);
        expect(
          new TextEncoder().encode(JSON.stringify(response)).length,
        ).toBeLessThanOrEqual(24 * 1024);
      }
      expect([...statuses].sort()).toEqual(["ready", "unsupported"]);
    },
  );

  it("lists at most 32 changed sections and stays within 512 bytes, which replay keeps whole", async () => {
    resetWordChangeJournalForTests();
    noteWordChangeEventsActive();
    doc = document(40);
    capture = {
      changes: { position: wordChangePosition(), capturedAt: CAPTURED_AT },
      ordinalMap: doc.ordinalMap,
    };
    for (let n = 1; n <= 40; n++)
      event("ParagraphChanged", doc.ids.get(firstBody(doc.snapshot, n).ref)!);

    const freshness = await open(doc.snapshot, capture).section(
      refOf(doc.snapshot, "1. Chapter 1"),
    );

    expect(freshness.changes).toBe("in-scope");
    expect(freshness.sections).toHaveLength(32);
    expect(freshness.sections[0]).toBe(refOf(doc.snapshot, "1.1 Section 1.1"));
    expect(
      new TextEncoder().encode(JSON.stringify(freshness)).length,
    ).toBeLessThanOrEqual(512);
  });
});
