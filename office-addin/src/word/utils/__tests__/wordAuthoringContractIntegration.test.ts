import { describe, expect, it, vi } from "vitest";

import nativeSource from "../../../test/fixtures/word-authoring-state/mixed-source.xml?raw";
import {
  escapeXml,
  packageXml,
  paragraph,
  W,
} from "../../../test/mocks/word/authoringFixtures";
import { checkWordAuthoringBudget } from "../wordAuthoringBudget";
import { WORD_AUTHORING_CONTRACT } from "../wordAuthoringContract";
import { wordReadableSourceBlock } from "../wordAuthoringReadData";
import {
  MAX_SOURCE_BYTES,
  parseWordDocumentPlan,
  validateWordDocumentPlan,
  wordSourceReadRefs,
} from "../wordDocumentPlan";
import { WordDocumentReadSession } from "../wordDocumentReadTool";
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
  verifyWordPlanOutput,
} from "../wordDocumentXml";
import { resolveWordSource, wordSourceDetails } from "../wordRichContent";
import { parseWordBlock } from "../wordRichPlan";

import type { WordAuthoringSnapshot } from "../wordDocumentPlan";

const estimate = vi.hoisted(() => vi.fn());
vi.mock("@erato/frontend/library", () => ({
  fetchTokenUsageEstimate: estimate,
}));
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length;
const context = {
  toolCallId: "read-A",
  messageId: "message-A",
  chatId: "chat-A",
};
const styledParagraph = (text: string) =>
  `<w:p><w:r><w:rPr><w:b/><w:rFonts w:ascii="Arial"/><w:sz w:val="24"/></w:rPr><w:t>${escapeXml(text)}</w:t></w:r></w:p>`;

function longSnapshot(): WordAuthoringSnapshot {
  const source = Array.from({ length: 335 }, (_, i) =>
    styledParagraph(
      `Section ${i + 1}: ${"Carefully reviewed detail remains visible. ".repeat(7)}`,
    ),
  ).join("");
  return captureWordAuthoringSnapshot(
    packageXml(source),
    "long-document",
    "Off",
    true,
  );
}

describe("rich authoring read contract integration", () => {
  it("keeps internal output verification independent of the model read budget while retaining structural restrictions", () => {
    const source = captureWordAuthoringSnapshot(
      packageXml(paragraph("Original")),
      "document",
      "Off",
      true,
    );
    source.readToken = "read-proof";
    source.read = new Set(wordSourceReadRefs(source));
    const plan = parseWordDocumentPlan(
      JSON.stringify({
        version: 1,
        scope: "document",
        snapshot: source.token,
        readToken: source.readToken,
        entries: [
          {
            kind: "replace",
            source: ["b1"],
            blocks: [
              {
                id: "expanded",
                type: "paragraph",
                text: "X".repeat(MAX_SOURCE_BYTES + 1024),
              },
            ],
          },
        ],
        deleted: [],
      }),
    );
    expect(plan).not.toBeNull();
    expect(validateWordDocumentPlan(plan!, source)).toBeNull();
    const xml = compileWordDocumentPlan(plan!, source);
    expect(
      captureWordAuthoringSnapshot(xml, "document", "Off", true).issue,
    ).toBe("too-large");
    const verified = captureWordAuthoringSnapshot(
      xml,
      "document",
      "Off",
      true,
      "verify",
    );
    expect(verified.issue).toBeUndefined();
    expect(verifyWordPlanOutput(plan!, source, verified)).toBe(true);
    expect(
      captureWordAuthoringSnapshot(xml, "document", "TrackAll", true, "verify")
        .issue,
    ).toBe("tracking");
  });

  it("requires complete table, story and section metadata delivery and resolves returned object aliases to the same snapshot", async () => {
    const doc = new DOMParser().parseFromString(
      nativeSource,
      "application/xml",
    );
    const table = doc.getElementsByTagNameNS(W, "tbl")[0];
    const cellText = table.getElementsByTagNameNS(W, "t")[0];
    cellText.textContent = 'Quoted "table" content 🧩 漢字 \\ '.repeat(600);
    const snapshot = captureWordAuthoringSnapshot(
      new XMLSerializer().serializeToString(doc),
      "rich-document",
      "Off",
      true,
    );
    expect(snapshot.issue).toBeUndefined();
    const session = new WordDocumentReadSession();
    session.activate(snapshot, context);
    const delivered = new Map<
      string,
      { parts: number; seen: Set<number>; structure: Map<number, string> }
    >();
    let cursor: string | null = null;
    let calls = 0;
    do {
      const response = await session.execute(
        { snapshot: snapshot.token, cursor },
        context,
      );
      expect(response.ok).toBe(true);
      if (!response.ok) throw new Error(response.error);
      const result = response.result as {
        blocks: {
          ref: string;
          part: number;
          parts: number;
          structureJson?: string;
          structurePart?: number;
        }[];
        nextCursor: string | null;
        complete: boolean;
        blocksRead: number;
        blocksTotal: number;
      };
      expect(bytes(result)).toBeLessThan(64 * 1024);
      expect(JSON.stringify(result)).not.toContain("<w:");
      expect(JSON.stringify(result)).not.toContain("pkg:binaryData");
      for (const block of result.blocks) {
        const record = delivered.get(block.ref) ?? {
          parts: block.parts,
          seen: new Set<number>(),
          structure: new Map<number, string>(),
        };
        record.seen.add(block.part);
        if (block.structureJson !== undefined)
          record.structure.set(block.structurePart!, block.structureJson);
        delivered.set(block.ref, record);
      }
      const completelyDelivered = new Set(
        [...delivered]
          .filter(([, r]) => r.seen.size === r.parts)
          .map(([ref]) => ref),
      );
      expect(snapshot.read).toEqual(completelyDelivered);
      expect(result.blocksRead).toBe(completelyDelivered.size);
      expect(result.blocksTotal).toBe(wordSourceReadRefs(snapshot).length);
      cursor = result.nextCursor;
      calls++;
    } while (cursor);
    expect(calls).toBeGreaterThan(1);
    expect(snapshot.read).toEqual(new Set(wordSourceReadRefs(snapshot)));
    const decode = (ref: string) =>
      JSON.parse(
        [...delivered.get(ref)!.structure]
          .sort(([a], [b]) => a - b)
          .map(([, s]) => s)
          .join(""),
      );
    const sourceTable = snapshot.blocks.find((block) =>
      block.objects?.some((object) => object.kind === "table"),
    )!;
    expect(decode(sourceTable.ref).content).toEqual(sourceTable.content);
    for (const block of snapshot.blocks)
      for (const object of block.objects ?? [])
        if (typeof object.ref === "string")
          expect(resolveWordSource(snapshot, object.ref)).toBeDefined();
    for (const story of snapshot.stories ?? []) {
      const ref = `story_${story.id}`;
      expect(decode(ref).story).toMatchObject({
        id: story.id,
        type: story.type,
        text: story.text,
      });
      expect(decode(ref)).not.toHaveProperty("xml");
      expect(decode(ref).story).not.toHaveProperty("part");
      expect(decode(ref).story).not.toHaveProperty("nativeId");
      for (const object of wordSourceDetails(story.xml, ref).objects ?? [])
        if (typeof object.ref === "string")
          expect(resolveWordSource(snapshot, object.ref)?.part).toBe(
            story.part,
          );
    }
    expect(decode("document_sections").sections).toHaveLength(
      snapshot.sections!.length,
    );
    expect(
      decode("document_sections").sections.every(
        (section: Record<string, unknown>) => !("xml" in section),
      ),
    ).toBe(true);
  });

  it("accepts and compiles more than thirteen top-level story blocks without confusing their indexes with nesting depth", () => {
    const snapshot = captureWordAuthoringSnapshot(
      packageXml(paragraph("Main document")),
      "document",
      "Off",
      true,
    );
    snapshot.readToken = "read-proof";
    snapshot.read = new Set(wordSourceReadRefs(snapshot));
    const plan = parseWordDocumentPlan(
      JSON.stringify({
        version: 1,
        scope: "document",
        snapshot: snapshot.token,
        readToken: snapshot.readToken,
        entries: [{ kind: "keep", source: ["b1"] }],
        deleted: [],
        stories: [
          {
            kind: "upsert",
            type: "header",
            id: "long-header",
            blocks: Array.from({ length: 20 }, (_, i) => ({
              id: `header-${i}`,
              type: "paragraph",
              text: `Header record ${i}`,
            })),
          },
        ],
        sections: [
          {
            id: "page",
            source: "section-1",
            headers: { default: "long-header" },
          },
        ],
      }),
    );
    expect(plan).not.toBeNull();
    expect(validateWordDocumentPlan(plan!, snapshot)).toBeNull();
    const doc = new DOMParser().parseFromString(
      compileWordDocumentPlan(plan!, snapshot),
      "application/xml",
    );
    expect(
      doc.getElementsByTagNameNS(W, "hdr")[0].getElementsByTagNameNS(W, "p"),
    ).toHaveLength(20);
  });

  it("delivers a uniformly formatted 335-paragraph document under the existing read budget, with complete font metadata and no duplicated run text", async () => {
    const snapshot = longSnapshot();
    expect(
      bytes(snapshot.blocks.map(({ xml: _xml, ...block }) => block)),
    ).toBeGreaterThan(MAX_SOURCE_BYTES);
    expect(bytes(snapshot.blocks.map(wordReadableSourceBlock))).toBeLessThan(
      MAX_SOURCE_BYTES,
    );
    expect(snapshot.issue).toBeUndefined();
    const session = new WordDocumentReadSession();
    session.activate(snapshot, context);
    const text = new Map<string, string>();
    const structure = new Map<string, string[]>();
    let cursor: string | null = null;
    let count = 0;
    let maximumBytes = 0;
    do {
      const response = await session.execute(
        { snapshot: snapshot.token, cursor },
        context,
      );
      expect(response.ok).toBe(true);
      if (!response.ok) throw new Error(response.error);
      const result = response.result as {
        blocks: {
          ref: string;
          text: string;
          runs?: unknown;
          structureJson?: string;
          structurePart?: number;
          part: number;
          parts: number;
        }[];
        nextCursor: string | null;
        complete: boolean;
        readToken?: string;
        blocksRead: number;
        blocksTotal: number;
      };
      maximumBytes = Math.max(
        maximumBytes,
        bytes({
          chat_id: context.chatId,
          message_id: context.messageId,
          tool_call_id: context.toolCallId,
          result,
        }),
      );
      for (const block of result.blocks) {
        text.set(block.ref, (text.get(block.ref) ?? "") + block.text);
        expect(block.runs).toBeUndefined();
        if (block.structureJson !== undefined) {
          const fragments = structure.get(block.ref) ?? [];
          fragments[(block.structurePart ?? 1) - 1] = block.structureJson;
          structure.set(block.ref, fragments);
        }
      }
      expect(result.blocksRead).toBe(snapshot.read.size);
      expect(result.blocksTotal).toBe(wordSourceReadRefs(snapshot).length);
      if (!result.complete) expect(result.readToken).toBeUndefined();
      cursor = result.nextCursor;
      count++;
    } while (cursor);
    expect(count).toBeGreaterThan(1);
    expect(count).toBeLessThanOrEqual(12);
    expect(maximumBytes).toBeLessThan(64 * 1024);
    expect(snapshot.read).toEqual(new Set(wordSourceReadRefs(snapshot)));
    for (const block of snapshot.blocks) {
      expect(text.get(block.ref)).toBe(block.text);
      expect(JSON.parse(structure.get(block.ref)!.join(""))).toMatchObject({
        format: { font: { bold: true, fontFamily: "Arial", fontSize: 12 } },
      });
    }
  });

  it("keeps contract, maximum normal style metadata and image metadata within a 64KiB first-page envelope without exposing host identities", async () => {
    const snapshot = longSnapshot();
    snapshot.styles = Array.from({ length: 140 }, (_, i) => ({
      id: `custom-${i}`,
      type: "paragraph",
      name: `Company style ${i}: ${"title ".repeat(7)}`,
    }));
    expect(bytes(snapshot.styles)).toBeLessThan(16384);
    snapshot.assets = Array.from({ length: 20 }, (_, i) => ({
      ref: `asset_${i + 1}`,
      fileId: `host-file-${i}`,
      name: `${"n".repeat(235)}-${i}.png`,
      mime: "image/png" as const,
      base64: "HOST_ONLY_RASTER_BYTES",
      widthPx: 500,
      heightPx: 300,
      sizeBytes: 12000,
    }));
    snapshot.imageAssetIssues = [
      {
        fileId: "host-missing-file",
        name: "Unavailable illustration.png",
        reason: "unavailable",
      },
    ];
    const session = new WordDocumentReadSession();
    session.activate(snapshot, context);
    const response = await session.execute(
      { snapshot: snapshot.token },
      context,
    );
    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.error);
    const result = response.result as Record<string, unknown>;
    expect(result.contract).toEqual(WORD_AUTHORING_CONTRACT);
    expect(
      bytes({
        chat_id: context.chatId,
        message_id: context.messageId,
        tool_call_id: context.toolCallId,
        result,
      }),
    ).toBeLessThan(64 * 1024);
    const json = JSON.stringify(result);
    expect(json).not.toContain("HOST_ONLY_RASTER_BYTES");
    expect(json).not.toContain("host-file-");
    expect(json).not.toContain("host-missing-file");
    expect(json).not.toContain("<w:");
    expect(json).not.toContain("pkg:package");
    expect(json).not.toContain("paragraphOrdinal");
  });

  it("accepts every advertised typed block family with its documented shape", () => {
    const examples = [
      {
        id: "p",
        type: "paragraph",
        text: "Paragraph",
        format: { font: { color: "112233" } },
      },
      { id: "h", type: "heading", level: 2, text: "Heading" },
      {
        id: "l",
        type: "list-item",
        level: 0,
        list: "items",
        ordered: true,
        text: "First",
      },
      {
        id: "t",
        type: "table",
        columns: [80],
        rows: [
          {
            cells: [
              { blocks: [{ id: "cell", type: "paragraph", text: "Value" }] },
            ],
          },
        ],
      },
      { id: "i", type: "image", image: { assetRef: "asset_1", widthPt: 90 } },
      {
        id: "d",
        type: "drawing",
        drawing: { shape: "rect", text: "Draft", widthPt: 90, heightPt: 40 },
      },
      { id: "f", type: "field", field: { instruction: "PAGE", text: "1" } },
      {
        id: "b",
        type: "bookmark",
        bookmark: {
          name: "Target",
          children: [{ id: "marked", type: "paragraph", text: "Marked text" }],
        },
      },
      {
        id: "c",
        type: "content-control",
        control: {
          title: "Client",
          lock: "both",
          appearance: "tags",
          children: [{ id: "controlled", type: "paragraph", text: "Client" }],
        },
      },
      {
        id: "n",
        type: "native-edit",
        sourceRef: "b1",
        edits: [
          { kind: "field", target: "field-1", operation: "update", text: "2" },
        ],
      },
    ];
    for (const block of examples)
      expect(parseWordBlock(block), block.type).not.toBeNull();
  });

  it("budgets the same projected source, styles and attachment issues without original XML or binary assets", async () => {
    const snapshot = longSnapshot();
    snapshot.styles.push({
      id: "Brand",
      name: "Unique brand typography",
      type: "paragraph",
    });
    snapshot.imageAssetIssues = [
      {
        fileId: "host-file-issue",
        name: "Missing graphic.png",
        reason: "unavailable",
      },
    ];
    estimate.mockResolvedValue({
      stats: { total_tokens: 40000, max_tokens: 128000 },
    });
    expect(
      await checkWordAuthoringBudget(snapshot, {
        message: "Rewrite",
        chatId: null,
      }),
    ).toEqual({ ok: true });
    const request = estimate.mock.calls.at(-1)![0].body.user_message as string;
    const firstSource = JSON.parse(request.split("\n\n")[1]);
    expect(firstSource.blocks[0]).toEqual(
      wordReadableSourceBlock(snapshot.blocks[0]),
    );
    expect(firstSource.styles).toEqual(snapshot.styles);
    expect(firstSource.imageAssetIssues).toEqual([
      { name: "Missing graphic.png", reason: "unavailable" },
    ]);
    expect(request).not.toContain("host-file-issue");
    expect(request).not.toContain("<w:");
    expect(request).not.toContain("pkg:package");
  });
});
