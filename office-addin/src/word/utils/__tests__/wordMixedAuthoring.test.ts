import { describe, expect, it } from "vitest";

import {
  readySnapshot,
  paragraph,
  packageXml,
} from "../../../test/mocks/word/authoringFixtures";
import { mixedAuthoringXml } from "../../../test/mocks/word/mixedAuthoringFixtures";
import {
  parseWordDocumentPlan,
  validateWordDocumentPlan,
  wordPlanOutput,
} from "../wordDocumentPlan";
import { WordDocumentReadSession } from "../wordDocumentReadTool";
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
  verifyWordPlanOutput,
  sameWordBodyContent,
} from "../wordDocumentXml";

import type { WordDocumentPlan } from "../wordDocumentPlan";

function mixedPlan() {
  const source = readySnapshot(mixedAuthoringXml());
  const plan: WordDocumentPlan = {
    version: 1,
    snapshot: source.token,
    readToken: "read-proof",
    scope: "body",
    entries: [
      {
        kind: "insert",
        blocks: [
          { id: "heading", type: "heading", level: 1, text: "Recommendation" },
        ],
      },
      {
        kind: "replace",
        source: [source.blocks.at(-1)!.ref, "b1"],
        blocks: [
          {
            id: "summary",
            type: "paragraph",
            text: "Start the pilot in October. Retain support; review at month end.",
          },
        ],
      },
      ...source.blocks
        .slice(1, -1)
        .reverse()
        .map((b) => ({ kind: "keep" as const, source: [b.ref] })),
    ],
    deleted: [],
  };
  return { source, plan };
}
describe("mixed document structural authoring", () => {
  it("fully reads a long mixed body beyond the paragraph excerpt without exposing native XML", async () => {
    const tail = Array.from({ length: 320 }, (_, i) =>
      paragraph(
        `Commitment ${i}: ${"Preserve the October deadline and the regional budget. ".repeat(5)}`,
      ),
    ).join("");
    const source = captureWordAuthoringSnapshot(
      mixedAuthoringXml().replace("</w:body>", tail + "</w:body>"),
      "doc-A",
      "Off",
    );
    const corrected = captureWordAuthoringSnapshot(
      mixedAuthoringXml().replace("<w:sectPr>", tail + "<w:sectPr>"),
      "doc-A",
      "Off",
    );
    expect(source.issueDetails).toContain("invalid-section-boundaries");
    expect(corrected.issue).toBeUndefined();
    const session = new WordDocumentReadSession();
    session.activate(corrected, { messageId: "message-A", chatId: "chat-A" });
    let cursor: string | null = null;
    const blocks: { ref: string; text: string }[] = [];
    let pages = 0;
    do {
      const response = await session.execute(
        { snapshot: corrected.token, cursor },
        { toolCallId: "read", messageId: "message-A", chatId: "chat-A" },
      );
      if (!response.ok) throw new Error(response.error);
      expect(JSON.stringify(response.result)).not.toMatch(/<w:|binaryData/);
      const page = response.result as {
        blocks: { ref: string; text: string }[];
        nextCursor: string | null;
      };
      blocks.push(...page.blocks);
      cursor = page.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBeGreaterThan(1);
    expect(pages).toBeLessThanOrEqual(12);
    expect(blocks.map((b) => b.text).join("\n")).toContain("Commitment 319");
    expect(corrected.read.size).toBe(corrected.blocks.length);
    expect(corrected.readToken).toBeTruthy();
  });
  it("restructures a body with native objects and preserves its package relationships", () => {
    const { source, plan } = mixedPlan();
    expect(source.issue).toBeUndefined();
    expect(
      source.blocks.filter((b) => b.type === "native").map((b) => b.nativeKind),
    ).toEqual([
      "table",
      "image",
      "field",
      "content-control",
      "anchored-content",
      "anchored-content",
      "anchored-content",
    ]);
    expect(source.blocks.find((b) => b.nativeKind === "table")?.text).toContain(
      "€42,000",
    );
    expect(
      source.blocks.find((b) => b.text.includes("Evidence start"))?.text,
    ).toContain("Evidence end");
    expect(source.preservedStories).toEqual([
      "header",
      "footer",
      "footnotes",
      "comments",
    ]);
    expect(validateWordDocumentPlan(plan, source)).toBeNull();
    const compiled = compileWordDocumentPlan(plan, source);
    const after = captureWordAuthoringSnapshot(compiled, "doc-A", "Off");
    expect(after.issue).toBeUndefined();
    expect(verifyWordPlanOutput(plan, source, after)).toBe(true);
    expect(after.blocks.map((b) => b.text)).toEqual(
      wordPlanOutput(plan, source).map((b) => b.block.text),
    );
  });
  it.each([
    "CONFIDENTIAL · Example project",
    "Retain this review note.",
    "Source: the October pilot decision.",
    "iVBORw0KGgo",
  ])("detects loss or changes in native related content: %s", (needle) => {
    const { source, plan } = mixedPlan();
    const compiled = compileWordDocumentPlan(plan, source).replace(
      needle,
      "CORRUPTED",
    );
    const after = captureWordAuthoringSnapshot(compiled, "doc-A", "Off");
    expect(verifyWordPlanOutput(plan, source, after)).toBe(false);
    expect(
      sameWordBodyContent(
        source,
        captureWordAuthoringSnapshot(
          source.ooxml.replace(needle, "CORRUPTED"),
          "doc-A",
          "Off",
        ),
      ),
    ).toBe(false);
  });
  it("accepts relationship and media-file renaming with identical linked content", () => {
    const { source, plan } = mixedPlan();
    const compiled = compileWordDocumentPlan(plan, source)
      .replaceAll("image1", "image77")
      .replaceAll("media/fixture.png", "media/image9.png");
    expect(
      verifyWordPlanOutput(
        plan,
        source,
        captureWordAuthoringSnapshot(compiled, "doc-A", "Off"),
      ),
    ).toBe(true);
  });
  it("allows explicit removal of native objects", () => {
    const { source, plan } = mixedPlan();
    plan.entries = plan.entries.filter(
      (e) => e.kind !== "keep" || !e.source.includes("b2"),
    );
    plan.deleted.push({ source: ["b2"], reason: "Remove table" });
    expect(source.issue).toBeUndefined();
    expect(validateWordDocumentPlan(plan, source)).toBeNull();
  });
  it("keeps cross-paragraph fields together and preserves hidden content without exposing it", () => {
    const source = readySnapshot(
      packageXml(
        '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PRIVATE FIELD CODE</w:instrText><w:fldChar w:fldCharType="separate"/><w:t>Visible result</w:t></w:r></w:p><w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>HIDDEN TEXT</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>' +
          paragraph("Editable"),
      ),
    );
    expect(source.issue).toBeUndefined();
    expect(source.blocks).toHaveLength(2);
    expect(source.blocks[0].text).toContain("Visible result");
    expect(source.blocks[0].text).not.toMatch(/PRIVATE|HIDDEN/);
    expect(source.blocks[0].xml).toContain("HIDDEN TEXT");
    expect(source.blocks[0].protected).toBe(false);
  });
  it("preserves section boundaries while allowing body restructuring", () => {
    const source = readySnapshot(
      packageXml(
        paragraph("First") +
          '<w:p><w:pPr><w:sectPr><w:type w:val="nextPage"/></w:sectPr></w:pPr></w:p>' +
          paragraph("Second") +
          '<w:p><w:pPr><w:sectPr><w:type w:val="continuous"/></w:sectPr></w:pPr></w:p>',
      ),
    );
    expect(source.issue).toBeUndefined();
    const plan: WordDocumentPlan = {
      version: 1,
      snapshot: source.token,
      readToken: "read-proof",
      scope: "body",
      entries: [{ kind: "keep", source: ["b3", "b2", "b1", "b4"] }],
      deleted: [],
    };
    expect(validateWordDocumentPlan(plan, source)).toBeNull();
    plan.entries = [{ kind: "keep", source: ["b3", "b4", "b1", "b2"] }];
    expect(validateWordDocumentPlan(plan, source)).toBe("section-order");
  });
  it("clears a text body using explicit deletion and one native final paragraph", () => {
    const source = readySnapshot(
      packageXml(
        Array.from({ length: 9 }, (_, i) =>
          paragraph(`Paragraph ${i + 1}`),
        ).join(""),
      ),
    );
    const plan: WordDocumentPlan = {
      version: 1,
      snapshot: source.token,
      readToken: "read-proof",
      scope: "body",
      entries: [],
      deleted: [
        {
          source: source.blocks.map((b) => b.ref),
          reason: "User requested removing all text",
        },
      ],
    };
    expect(parseWordDocumentPlan(JSON.stringify(plan))).toEqual(plan);
    expect(validateWordDocumentPlan(plan, source)).toBeNull();
    const after = captureWordAuthoringSnapshot(
      compileWordDocumentPlan(plan, source),
      "doc-A",
      "Off",
    );
    expect(after.blocks).toHaveLength(1);
    expect(after.blocks[0].text).toBe("");
    expect(verifyWordPlanOutput(plan, source, after)).toBe(true);
  });
  it.each([
    ['<w:p><w:bookmarkStart w:id="1"/></w:p>', "unbalanced-anchors"],
    [
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r></w:p>',
      "unbalanced-fields",
    ],
    [
      '<w:sdt><w:sdtPr><w:lock w:val="sdtContentLocked"/></w:sdtPr><w:sdtContent/></w:sdt>',
      "locked-content-control",
    ],
    ["<w:altChunk/>", "unreadable-imported-content"],
  ])("reports a concrete capture limitation for %s", (body, reason) => {
    const source = readySnapshot(packageXml(body));
    expect(source.issue).toBe("unsupported");
    expect(source.issueDetails).toContain(reason);
  });
});
