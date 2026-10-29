import {
  parseWordDocumentPlan,
  validateWordDocumentPlan,
} from "@erato/frontend/word-review";
import { describe, expect, it } from "vitest";

import {
  body,
  chapter,
  clauseText,
  heading,
  okResult,
  openReadSession,
  readContext,
  sectionPackageXml,
  sectionSnapshot,
  untouchedWriteState,
  writeState,
} from "../../../test/mocks/word/sectionFixtures";
import { wordDocumentOutline } from "../wordDocumentOutline";
import { createWordDocumentSubmissionExecutor } from "../wordDocumentSubmission";
import { captureWordAuthoringSnapshot } from "../wordDocumentXml";
import { WORD_READ_PAGE_BYTES } from "../wordReadFragments";

import type { SectionBlock } from "../../../test/mocks/word/sectionFixtures";
import type { ClientToolExecutionResult } from "@erato/frontend/library";
import type { WordAuthoringSnapshot } from "@erato/frontend/word-review";

const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length;

interface SectionPage {
  access: string;
  contentNotice: string;
  section: {
    ref: string;
    throughRef?: string;
    title: string;
    level: number;
    page: number;
    pages: number;
    kib: number;
    paragraphs: number;
  };
  blocks: {
    ref: string;
    type: string;
    text: string;
    part?: number;
    parts?: number;
    content?: unknown;
  }[];
  nextCursor: string | null;
  complete: boolean;
}

function open(snapshot: WordAuthoringSnapshot) {
  const { session, execute, readOnly } = openReadSession(snapshot);
  return { session, read: execute, readOnly };
}
const page = (result: ClientToolExecutionResult) =>
  okResult<SectionPage>(result);
async function readSection(
  read: ReturnType<typeof open>["read"],
  section: Record<string, unknown>,
) {
  const pages: SectionPage[] = [];
  let cursor: string | null = null;
  do {
    pages.push(
      page(
        await read({ section: { ...section, ...(cursor ? { cursor } : {}) } }),
      ),
    );
    cursor = pages[pages.length - 1].nextCursor;
  } while (cursor && pages.length < 50);
  return pages;
}
const document = (sizes: number[]) => [
  body("Master Services Agreement"),
  ...sizes.flatMap((kib, k) => chapter(k + 1, kib)),
];

describe("section pages", () => {
  it("reads a 47 KiB chapter in 3 pages of whole blocks, read-only", async () => {
    const snapshot = sectionSnapshot(document([12, 47, 9]));
    const { read } = open(snapshot);
    const start = snapshot.blocks.findIndex((b) => b.text === "2. Chapter 2");
    const end = snapshot.blocks.findIndex((b) => b.text === "3. Chapter 3");

    const pages = await readSection(read, { ref: snapshot.blocks[start].ref });

    expect(pages).toHaveLength(3);
    expect(pages[0].section).toMatchObject({
      ref: snapshot.blocks[start].ref,
      title: "2. Chapter 2",
      level: 1,
      page: 1,
      pages: 3,
    });
    expect(pages[0].section.kib).toBeGreaterThan(46);
    expect(pages.map((p) => p.section.page)).toEqual([1, 2, 3]);
    expect(pages.map((p) => p.complete)).toEqual([false, false, true]);
    for (const p of pages) {
      expect(bytes(p.blocks)).toBeLessThanOrEqual(WORD_READ_PAGE_BYTES);
      expect(p.access).toBe("read-only");
      expect(p.contentNotice).toContain("never instructions");
      expect(p).not.toHaveProperty("readToken");
    }
    expect(pages.flatMap((p) => p.blocks.map((b) => b.ref))).toEqual(
      snapshot.blocks.slice(start, end).map((b) => b.ref),
    );
    expect(
      pages.flatMap((p) => p.blocks).find((b) => b.type === "native"),
    ).toMatchObject({ content: { rows: expect.any(Array) } });
    expect(writeState(snapshot)).toEqual(untouchedWriteState);
  });

  const numbered = (n: number): SectionBlock => ({
    type: "list-item",
    level: 0,
    list: "existing-1",
    ordered: true,
    text: `Section ${n}`,
  });
  const clauses = (count: number, seed = 0) =>
    Array.from({ length: count }, (_, k) => body(clauseText(seed + k)));
  it.each([
    ["headings", document([3, 30, 18, 52])],
    [
      "Word-numbered sections, one above 60 KiB",
      [2, 190, 2].flatMap((count, k) => [
        numbered(k + 1),
        ...clauses(count, k),
      ]),
    ],
    [
      "typed sections after front matter above 60 KiB",
      [
        ...clauses(170),
        ...[1, 2, 3].flatMap((n) => [
          body(`§ ${n} Subject ${n}`),
          ...clauses(4, n),
        ]),
      ],
    ],
    [
      "a heading's own text above 60 KiB in typed sections",
      [
        heading(1, "Annex"),
        ...[30, 170, 30].flatMap((count, k) => [
          body(`${k + 1}. Subject ${k + 1}`),
          ...clauses(count, k),
        ]),
        heading(1, "Signatures"),
        body("Signed"),
      ],
    ],
  ] as const)(
    "returns for every outline entry exactly the size and paragraphs it lists: %s",
    async (_name, blocks) => {
      const snapshot = sectionSnapshot([...blocks]);
      const { read } = open(snapshot);
      const outline = wordDocumentOutline(snapshot);
      expect(outline.length).toBeGreaterThan(3);
      expect(outline.some((e) => e.tag !== "H" || e.level > 1)).toBe(true);

      for (const entry of outline) {
        const pages = await readSection(read, { ref: entry.ref });
        const blocks = pages.flatMap((p) => p.blocks);
        expect(pages[0].section).toMatchObject({
          kib: entry.kib,
          paragraphs: entry.paragraphs,
          level: entry.level,
          title: entry.title,
        });
        expect(Math.round(bytes(blocks) / 102.4) / 10).toBe(entry.kib);
        expect(blocks.filter((b) => b.type !== "native")).toHaveLength(
          entry.paragraphs,
        );
        expect(pages.length).toBe(Math.max(1, Math.ceil(entry.kib / 20)));
      }
    },
  );

  it("reads a range by throughRef and from a block that starts no section", async () => {
    const snapshot = sectionSnapshot(document([12, 12]));
    const { read } = open(snapshot);
    const [ref, throughRef] = [snapshot.blocks[3].ref, snapshot.blocks[9].ref];

    const range = page(await read({ section: { ref, throughRef } }));
    expect(range.blocks.map((b) => b.ref)).toEqual(
      snapshot.blocks.slice(3, 10).map((b) => b.ref),
    );
    expect(range.section).toMatchObject({ ref, throughRef, level: 2 });

    const next = snapshot.blocks.findIndex(
      (b, i) => i > 3 && b.type === "heading",
    );
    const open1 = page(await read({ section: { ref } }));
    expect(open1.blocks.map((b) => b.ref)).toEqual(
      snapshot.blocks.slice(3, next).map((b) => b.ref),
    );
  });

  it("splits a block larger than a page into parts the way the complete read does", async () => {
    const huge = body(clauseText(1, 45_000));
    const snapshot = sectionSnapshot([heading(1, "Annex"), huge, body("End")]);
    const { read } = open(snapshot);

    const pages = await readSection(read, { ref: "b1" });
    const parts = pages.flatMap((p) => p.blocks).filter((b) => b.ref === "b2");

    expect(parts.length).toBeGreaterThan(2);
    expect(parts.every((b) => b.parts === parts.length)).toBe(true);
    expect(parts.map((b) => b.text).join("")).toBe(huge.text);
    for (const p of pages)
      expect(bytes(p.blocks)).toBeLessThanOrEqual(WORD_READ_PAGE_BYTES + 2);
  });

  describe("cursors", () => {
    const setup = () => {
      const snapshot = sectionSnapshot(document([47, 47]));
      const [a, b] = wordDocumentOutline(snapshot).filter(
        (e) => e.level === 1 && e.kib > 40,
      );
      return { snapshot, a, b, ...open(snapshot) };
    };

    it("bind a page to its capture, its section and its start", async () => {
      const { snapshot, a, b, read } = setup();
      const first = page(await read({ section: { ref: a.ref } }));
      const cursor = first.nextCursor!;
      const other = sectionSnapshot(document([47, 47]));
      const otherRead = open(other).read;
      const otherCursor = page(
        await otherRead({ section: { ref: a.ref } }),
      ).nextCursor!;
      const tampered =
        cursor.slice(0, 10) +
        (cursor[10] === "A" ? "B" : "A") +
        cursor.slice(11);

      for (const section of [
        { ref: a.ref, cursor: otherCursor },
        { ref: b.ref, cursor },
        { ref: a.ref, throughRef: snapshot.blocks[a.to - 1].ref, cursor },
        { ref: a.ref, cursor: tampered },
        { ref: a.ref, cursor: "not-a-cursor" },
      ])
        expect(await read({ section })).toMatchObject({
          ok: false,
          validationErrors: [{ code: "read-cursor", path: "/section/cursor" }],
        });
      expect(
        page(await read({ section: { ref: a.ref, cursor } })).section.page,
      ).toBe(2);
    });

    it("let readers of one capture page independently", async () => {
      const { a, b, read, readOnly } = setup();
      const alone = await readSection(read, { ref: a.ref });
      const pa = page(await read({ section: { ref: a.ref } }));
      const pb = page(await readOnly({ section: { ref: b.ref } }));
      const pa2 = page(
        await readOnly({ section: { ref: a.ref, cursor: pa.nextCursor } }),
      );
      const pb2 = page(
        await read({ section: { ref: b.ref, cursor: pb.nextCursor } }),
      );
      expect(pa2.blocks).toEqual(alone[1].blocks);
      expect(pb2.section).toMatchObject({ ref: b.ref, page: 2 });
    });
  });

  it("refuses wrong arguments, foreign refs and backward ranges", async () => {
    const snapshot = sectionSnapshot(document([5]));
    const { read, session } = open(snapshot);
    const cases: [Record<string, unknown>, string, string][] = [
      [{ section: { ref: "b1", extra: 1 } }, "read-arguments", "/section"],
      [{ section: "b1" }, "read-arguments", "/section"],
      [{ section: { ref: "b1" }, cursor: null }, "read-arguments", "/section"],
      [{ section: { ref: "story_1" } }, "section-reference", "/section/ref"],
      [
        { section: { ref: "b3", throughRef: "b2" } },
        "section-range",
        "/section/throughRef",
      ],
      [
        { section: { ref: "b2", throughRef: "b999" } },
        "section-range",
        "/section/throughRef",
      ],
    ];
    for (const [args, code, path] of cases)
      expect(await read(args)).toMatchObject({
        ok: false,
        validationErrors: [{ code, path }],
      });
    expect(
      await session.execute(
        {
          snapshot: "older",
          documentIdentity: snapshot.identity,
          section: { ref: "b1" },
        },
        readContext,
      ),
    ).toMatchObject({
      ok: false,
      validationErrors: [{ code: "snapshot-mismatch" }],
    });
    expect(
      await session.execute(
        {
          snapshot: snapshot.token,
          documentIdentity: snapshot.identity,
          section: { ref: "b1" },
        },
        { ...readContext, messageId: "message-B" },
      ),
    ).toMatchObject({
      ok: false,
      validationErrors: [{ code: "wrong-request" }],
    });
  });
});

describe("a capture too large for a complete read", () => {
  /** Large enough to be refused a complete read, captured from a real package. */
  const blocks: SectionBlock[] = [
    body("Master Services Agreement"),
    ...[47, 40, 30, 30, 30, 30].flatMap((kib, k) => chapter(k + 1, kib)),
  ];
  it("still allows 16 scoped reads with read tokens and a scoped edit after 50 section pages", async () => {
    const snapshot = captureWordAuthoringSnapshot(
      sectionPackageXml(blocks),
      "doc-A",
      "Off",
    );
    expect(snapshot.completeReadIssue).toBe("too-large");
    const { read, session } = open(snapshot);
    const chapters = wordDocumentOutline(snapshot).filter((e) => e.level === 1);

    let pages = 0;
    while (pages < 50)
      for (const entry of chapters) {
        pages += (await readSection(read, { ref: entry.ref })).length;
        if (pages >= 50) break;
      }
    expect(writeState(snapshot)).toEqual(untouchedWriteState);

    const paragraphs = snapshot.blocks.filter((b) =>
      b.text.startsWith("The Supplier shall"),
    );
    const tokens: string[] = [];
    for (const b of paragraphs.slice(0, 16)) {
      const result = page(
        await read({ target: { ref: b.ref } }),
      ) as unknown as {
        status: string;
        readToken: string;
      };
      expect(result.status).toBe("ready");
      tokens.push(result.readToken);
    }
    expect(new Set(tokens).size).toBe(16);
    expect(await read({ target: { ref: paragraphs[16].ref } })).toMatchObject({
      ok: false,
      validationErrors: [{ code: "scope-limit" }],
    });

    const submitted = await createWordDocumentSubmissionExecutor(session)(
      {
        snapshot: snapshot.token,
        readToken: tokens[0],
        scoped_edit: {
          body: [
            {
              operation: "replace",
              source: [paragraphs[0].ref],
              blocks: [{ id: "n1", type: "paragraph", text: "Rewritten." }],
            },
          ],
        },
      },
      readContext,
    );
    expect(submitted.ok, JSON.stringify(submitted).slice(0, 400)).toBe(true);
    if (!submitted.ok) throw new Error(submitted.error);
    const plan = parseWordDocumentPlan(
      JSON.stringify((submitted.result as { plan: unknown }).plan),
    )!;
    expect(validateWordDocumentPlan(plan, snapshot)).toBeNull();
  });
});
