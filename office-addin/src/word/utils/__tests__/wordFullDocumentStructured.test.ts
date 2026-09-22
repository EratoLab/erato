import { describe, expect, it } from "vitest";

import {
  packageXml,
  paragraph,
} from "../../../test/mocks/word/authoringFixtures";
import {
  wordDocumentFileToOoxml,
  wordDocumentOoxmlToFile,
} from "../wordDocumentPackage";
import {
  parseWordDocumentPlan,
  validateWordDocumentPlan,
  wordSourceReadRefs,
} from "../wordDocumentPlan";
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
  verifyWordPlanOutput,
} from "../wordDocumentXml";

import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
} from "../wordDocumentPlan";

function ready(xml: string): WordAuthoringSnapshot {
  const source = captureWordAuthoringSnapshot(xml, "doc-A", "Off", true);
  source.read = new Set(wordSourceReadRefs(source));
  source.readToken = "read-proof";
  source.ownerMessageId = "message-A";
  expect(source.issue).toBeUndefined();
  return source;
}
function base(source: WordAuthoringSnapshot): WordDocumentPlan {
  return {
    version: 1,
    snapshot: source.token,
    readToken: "read-proof",
    scope: "document",
    entries: [{ kind: "keep", source: source.blocks.map((b) => b.ref) }],
    deleted: [],
  };
}
function richFixture(): string {
  const source = ready(
    packageXml(paragraph("Original paragraph") + paragraph("Second paragraph")),
  );
  const plan = base(source);
  plan.stories = [
    {
      kind: "upsert",
      type: "header",
      id: "header",
      blocks: [
        { id: "header-text", type: "paragraph", text: "Original header" },
      ],
    },
    {
      kind: "upsert",
      type: "footer",
      id: "footer",
      blocks: [
        { id: "footer-text", type: "paragraph", text: "Original footer" },
      ],
    },
    {
      kind: "upsert",
      type: "footnote",
      id: "note",
      blocks: [{ id: "note-text", type: "paragraph", text: "Original note" }],
      anchor: { block: source.blocks[0].ref },
    },
    {
      kind: "upsert",
      type: "comment",
      id: "comment",
      blocks: [
        { id: "comment-text", type: "paragraph", text: "Original comment" },
      ],
      anchor: { block: source.blocks[1].ref },
    },
  ];
  plan.sections = [
    {
      id: "final",
      source: "section-1",
      headers: { default: "header" },
      footers: { default: "footer" },
    },
  ];
  expect(validateWordDocumentPlan(plan, source)).toBeNull();
  return compileWordDocumentPlan(plan, source);
}

describe("production structured full-document authoring", () => {
  it("reads every story, validates typed content, compiles native stories/layout, and verifies output", () => {
    const source = ready(packageXml(paragraph("Original body")));
    const plan = base(source);
    plan.stories = [
      {
        kind: "upsert",
        type: "header",
        id: "brand",
        blocks: [
          { id: "heading", type: "heading", level: 1, text: "New brand" },
        ],
      },
    ];
    plan.sections = [
      {
        id: "final",
        source: "section-1",
        layout: { orientation: "landscape", columns: 2, columnSpacing: 24 },
        headers: { default: "brand" },
      },
    ];
    const parsed = parseWordDocumentPlan(JSON.stringify(plan));
    expect(parsed).not.toBeNull();
    expect(validateWordDocumentPlan(parsed!, source)).toBeNull();
    const compiled = compileWordDocumentPlan(parsed!, source);
    const after = ready(
      wordDocumentFileToOoxml(wordDocumentOoxmlToFile(compiled)),
    );
    expect(after.stories?.find((s) => s.type === "header")?.text).toBe(
      "New brand",
    );
    expect(after.sections?.[0].layout).toMatchObject({
      orientation: "landscape",
      columns: 2,
      columnSpacing: 24,
    });
    expect(verifyWordPlanOutput(parsed!, source, after)).toBe(true);
    const wrong = ready(compiled.replace("New brand", "Lost brand"));
    expect(verifyWordPlanOutput(parsed!, source, wrong)).toBe(false);
  });

  it("rewrites native anchored body text and removes only annotations orphaned by that rewrite", () => {
    const source = ready(richFixture());
    const plan = base(source);
    plan.entries = [
      {
        kind: "replace",
        source: source.blocks.map((b) => b.ref),
        blocks: [
          {
            id: "replacement",
            type: "paragraph",
            text: "A completely new document structure",
          },
        ],
      },
    ];
    expect(validateWordDocumentPlan(plan, source)).toBeNull();
    const compiled = compileWordDocumentPlan(plan, source);
    const after = ready(compiled);
    expect(
      after.stories?.filter(
        (s) => s.type === "comment" || s.type === "footnote",
      ),
    ).toEqual([]);
    expect(after.stories?.find((s) => s.type === "header")?.text).toBe(
      "Original header",
    );
    expect(verifyWordPlanOutput(plan, source, after)).toBe(true);
  });

  it("clears a mixed document and its requested stories, retaining a valid empty Word document", () => {
    const source = ready(richFixture());
    const plan = base(source);
    plan.entries = [];
    plan.deleted = [
      {
        source: source.blocks.map((b) => b.ref),
        reason: "Clear the complete document as requested",
      },
    ];
    plan.stories = source.stories!.map((story) => ({
      kind: "delete",
      type: story.type,
      id: story.id,
    }));
    plan.sections = [{ id: "empty" }];
    const parsed = parseWordDocumentPlan(JSON.stringify(plan));
    expect(parsed).not.toBeNull();
    expect(validateWordDocumentPlan(parsed!, source)).toBeNull();
    const compiled = compileWordDocumentPlan(parsed!, source);
    const after = ready(compiled);
    expect(after.blocks).toHaveLength(1);
    expect(after.blocks[0].text).toBe("");
    expect(after.stories?.every((story) => story.text === "")).toBe(true);
    expect(after.sections).toHaveLength(1);
    expect(() => wordDocumentOoxmlToFile(compiled)).not.toThrow();
    expect(verifyWordPlanOutput(parsed!, source, after)).toBe(true);
  });
});
