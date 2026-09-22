import { describe, expect, it } from "vitest";

import nativeSource from "../../../test/fixtures/word-authoring-state/mixed-source.xml?raw";
import {
  parseWordDocumentPlan,
  validateWordDocumentPlan,
  wordSourceReadRefs,
} from "../wordDocumentPlan";
import { captureWordAuthoringSnapshot } from "../wordDocumentXml";
import { wordSourceDetails } from "../wordRichContent";

import type { WordDocumentPlan, WordPlanBlock } from "../wordDocumentPlan";

function setup(xml = nativeSource) {
  const source = captureWordAuthoringSnapshot(xml, "doc-A", "Off", true);
  source.read = new Set(wordSourceReadRefs(source));
  source.readToken = "read-proof";
  expect(source.issue).toBeUndefined();
  const plan: WordDocumentPlan = {
    version: 1,
    snapshot: source.token,
    readToken: "read-proof",
    scope: "document",
    entries: [{ kind: "keep", source: source.blocks.map((b) => b.ref) }],
    deleted: [],
  };
  const insert = (block: WordPlanBlock) =>
    plan.entries.push({ kind: "insert", blocks: [block] });
  return { source, plan, insert };
}
const paragraph = (id: string, text = "New text"): WordPlanBlock => ({
  id,
  type: "paragraph",
  text,
});

describe("rich document plan reference validation", () => {
  it("reserves kept source references against new body and nested story block IDs", () => {
    const { source, plan, insert } = setup();
    insert(paragraph(source.blocks[0].ref));
    expect(validateWordDocumentPlan(plan, source)).toBe("invalid");
    plan.entries.pop();
    plan.stories = [
      {
        kind: "upsert",
        type: "header",
        id: "brand",
        blocks: [
          {
            id: "control",
            type: "content-control",
            text: "",
            control: { children: [paragraph(source.blocks[0].ref)] },
          },
        ],
      },
    ];
    expect(validateWordDocumentPlan(plan, source)).toBe("invalid");
  });

  it("does not allow notes or comments anchored in earlier story blocks", () => {
    const { source, plan } = setup();
    plan.stories = [
      {
        kind: "upsert",
        type: "header",
        id: "brand",
        blocks: [paragraph("header-text")],
      },
      {
        kind: "upsert",
        type: "footnote",
        id: "note",
        blocks: [paragraph("note-text")],
        anchor: { block: "header-text" },
      },
    ];
    expect(validateWordDocumentPlan(plan, source)).toBe("invalid");
  });

  it("requires new notes/comments to have a body anchor and checks its text offsets", () => {
    const { source, plan } = setup();
    plan.stories = [
      {
        kind: "upsert",
        type: "comment",
        id: "review",
        blocks: [paragraph("comment-text")],
      },
    ];
    expect(validateWordDocumentPlan(plan, source)).toBe("invalid");
    plan.stories[0].anchor = { block: source.blocks[0].ref, start: 100000 };
    expect(validateWordDocumentPlan(plan, source)).toBe("invalid");
    plan.stories[0].anchor = { block: source.blocks[0].ref };
    expect(validateWordDocumentPlan(plan, source)).toBeNull();
  });

  it("checks paragraph and table style references inside stories", () => {
    const { source, plan } = setup();
    plan.stories = [
      {
        kind: "upsert",
        type: "header",
        id: "brand",
        blocks: [{ ...paragraph("header-text"), styleRef: "missing-style" }],
      },
    ];
    expect(validateWordDocumentPlan(plan, source)).toBe("invalid");
    plan.stories[0].blocks = [
      {
        id: "header-table",
        type: "table",
        text: "",
        format: { styleRef: "missing-table-style" },
        rows: [{ cells: [{ blocks: [paragraph("cell")] }] }],
      },
    ];
    expect(validateWordDocumentPlan(plan, source)).toBe("invalid");
  });

  it("uses the same list definition consistency checks in body and stories", () => {
    const { source, plan, insert } = setup();
    insert({
      id: "body-list",
      type: "list-item",
      text: "One",
      list: "shared-list",
      level: 0,
      ordered: true,
    });
    plan.stories = [
      {
        kind: "upsert",
        type: "footer",
        id: "foot",
        blocks: [
          {
            id: "footer-list",
            type: "list-item",
            text: "Bullet",
            list: "shared-list",
            level: 0,
            ordered: false,
          },
        ],
      },
    ];
    expect(validateWordDocumentPlan(plan, source)).toBe("invalid");
  });

  it("rejects unknown sources, wrong source kinds, and unknown uploaded image refs", () => {
    const { source, plan, insert } = setup();
    insert({
      id: "img",
      type: "image",
      text: "",
      image: { sourceRef: "unknown" },
    });
    expect(validateWordDocumentPlan(plan, source)).toBe("invalid");
    plan.entries.pop();
    const table = source.blocks.find((b) =>
      b.objects?.some((o) => o.kind === "table"),
    )!;
    insert({
      id: "img",
      type: "image",
      text: "",
      image: {
        sourceRef: String(table.objects!.find((o) => o.kind === "table")!.ref),
      },
    });
    expect(validateWordDocumentPlan(plan, source)).toBe("invalid");
    plan.entries.pop();
    insert({
      id: "img",
      type: "image",
      text: "",
      image: { assetRef: "asset_missing" },
    });
    expect(validateWordDocumentPlan(plan, source)).toBe("invalid");
    source.assets = [
      {
        ref: "asset_missing",
        fileId: "file-A",
        name: "Fixture",
        mime: "image/png",
        base64: "AQIDBA==",
        widthPx: 1,
        heightPx: 1,
        sizeBytes: 4,
      },
    ];
    expect(validateWordDocumentPlan(plan, source)).toBeNull();
  });

  it("validates native selector existence, duplicate mutations and nested replacement asset refs", () => {
    const { source, plan, insert } = setup();
    const image = source.blocks.find((b) =>
      b.objects?.some((o) => o.kind === "image"),
    )!;
    const target = String(
      image.objects!.find((o) => o.kind === "image")!.target,
    );
    const block: WordPlanBlock = {
      id: "native-update",
      type: "native-edit",
      text: "",
      sourceRef: image.ref,
      edits: [
        {
          kind: "image",
          target,
          operation: "update",
          image: { assetRef: "unknown" },
        },
      ],
    };
    insert(block);
    expect(validateWordDocumentPlan(plan, source)).toBe("invalid");
    block.edits = [{ kind: "image", target: "image-999", operation: "delete" }];
    expect(validateWordDocumentPlan(plan, source)).toBe("invalid");
    block.edits = [
      { kind: "image", target, operation: "update", image: { widthPt: 50 } },
      { kind: "image", target, operation: "delete" },
    ];
    expect(validateWordDocumentPlan(plan, source)).toBe("invalid");
    block.edits = [
      { kind: "image", target, operation: "update", image: { widthPt: 50 } },
    ];
    expect(validateWordDocumentPlan(plan, source)).toBeNull();
  });

  it("requires source story assets to have been delivered by a complete-document read", () => {
    const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const xml = new DOMParser().parseFromString(
      nativeSource,
      "application/xml",
    );
    const footer = xml.getElementsByTagNameNS(w, "ftr")[0];
    const p = xml.createElementNS(w, "w:p"),
      field = xml.createElementNS(w, "w:fldSimple"),
      run = xml.createElementNS(w, "w:r"),
      text = xml.createElementNS(w, "w:t");
    field.setAttributeNS(w, "w:instr", "PAGE");
    text.textContent = "1";
    run.append(text);
    field.append(run);
    p.append(field);
    footer.append(p);
    const { source, plan, insert } = setup(
      new XMLSerializer().serializeToString(xml),
    );
    const story = source.stories!.find((s) =>
      wordSourceDetails(s.xml, "story_" + s.id).objects?.some(
        (o) => o.kind === "field",
      ),
    );
    expect(story).toBeDefined();
    const target = wordSourceDetails(
      story!.xml,
      "story_" + story!.id,
    ).objects!.find((o) => o.kind === "field")!;
    insert({
      id: "native-update",
      type: "native-edit",
      text: "",
      sourceRef: "story_" + story!.id,
      edits: [
        {
          kind: "field",
          target: String(target.target),
          operation: "update",
          text: "Preview",
        },
      ],
    });
    expect(validateWordDocumentPlan(plan, source)).toBeNull();
    source.fullDocument = false;
    plan.scope = "body";
    expect(validateWordDocumentPlan(plan, source)).toBe("invalid");
  });

  it("rejects unknown section clones, reversed boundaries and missing/wrong story bindings", () => {
    const { source, plan } = setup();
    plan.sections = [{ id: "last", source: "unknown" }];
    expect(validateWordDocumentPlan(plan, source)).toBe("invalid");
    plan.sections = [
      { id: "a", after: source.blocks[1].ref },
      { id: "b", after: source.blocks[0].ref },
      { id: "last" },
    ];
    expect(validateWordDocumentPlan(plan, source)).toBe("section-order");
    plan.sections = [{ id: "a", after: "unknown" }, { id: "last" }];
    expect(validateWordDocumentPlan(plan, source)).toBe("section-order");
    plan.sections = [
      {
        id: "last",
        headers: {
          default: source.stories!.find((s) => s.type === "footer")!.id,
        },
      },
    ];
    expect(validateWordDocumentPlan(plan, source)).toBe("invalid");
    plan.sections = [{ id: "last", headers: { default: "missing" } }];
    expect(validateWordDocumentPlan(plan, source)).toBe("invalid");
    plan.stories = [
      {
        kind: "upsert",
        type: "header",
        id: "new-header",
        blocks: [paragraph("new-header-text")],
      },
    ];
    plan.sections = [{ id: "last", headers: { default: "new-header" } }];
    expect(validateWordDocumentPlan(plan, source)).toBeNull();
  });

  it("requires body scope to leave story/section intent absent and still requires complete delivered reads", () => {
    const { source, plan } = setup();
    plan.scope = "body";
    plan.stories = [];
    expect(validateWordDocumentPlan(plan, source)).toBe("invalid");
    expect(parseWordDocumentPlan(JSON.stringify(plan))).toBeNull();
    plan.scope = "document";
    delete plan.stories;
    source.read.delete("story_" + source.stories![0].id);
    expect(validateWordDocumentPlan(plan, source)).toBe("incomplete");
  });
});
