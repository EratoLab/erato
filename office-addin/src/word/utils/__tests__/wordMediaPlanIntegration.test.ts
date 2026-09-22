import { describe, expect, it } from "vitest";

import { packageXml } from "../../../test/mocks/word/authoringFixtures";
import {
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
import { compileWordImage, readWordImageData } from "../wordMediaContent";

import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
} from "../wordDocumentPlan";
import type { WordImageAsset } from "../wordImageAssetData";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
const gif = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const asset: WordImageAsset = {
  ref: "asset_1",
  fileId: "attached_file",
  name: "Replacement.gif",
  mime: "image/gif",
  base64: gif,
  widthPx: 1,
  heightPx: 1,
  sizeBytes: atob(gif).length,
};
const serialize = (node: Node) => new XMLSerializer().serializeToString(node);

function snapshot(withHeader = false): WordAuthoringSnapshot {
  const doc = new DOMParser().parseFromString(
    packageXml("<w:p><w:r><w:t>Body</w:t></w:r></w:p>"),
    "application/xml",
  );
  const body = doc.getElementsByTagNameNS(W, "body")[0];
  const image = compileWordImage(doc, {
    data: { mime: "image/png", base64: png },
    widthPt: 60,
    heightPt: 30,
    alt: "Existing image",
  });
  body.insertBefore(image, body.lastElementChild);
  if (withHeader) {
    const headerImage = compileWordImage(
      doc,
      {
        data: { mime: "image/png", base64: png },
        widthPt: 40,
        heightPt: 20,
        alt: "Header original",
      },
      { storyPart: "/word/header1.xml" },
    );
    const part = doc.createElementNS(PKG, "pkg:part");
    part.setAttributeNS(PKG, "pkg:name", "/word/header1.xml");
    part.setAttributeNS(
      PKG,
      "pkg:contentType",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml",
    );
    const data = doc.createElementNS(PKG, "pkg:xmlData"),
      header = doc.createElementNS(W, "w:hdr");
    header.append(headerImage);
    data.append(header);
    part.append(data);
    doc.documentElement.append(part);
    const relPart = Array.from(doc.getElementsByTagNameNS(PKG, "part")).find(
      (p) => p.getAttributeNS(PKG, "name") === "/word/_rels/document.xml.rels",
    )!;
    const relation = doc.createElementNS(REL, "Relationship");
    relation.setAttribute("Id", "headerRel");
    relation.setAttribute("Type", `${R}/header`);
    relation.setAttribute("Target", "header1.xml");
    relPart.firstElementChild!.firstElementChild!.append(relation);
    const ref = doc.createElementNS(W, "w:headerReference");
    ref.setAttributeNS(W, "w:type", "default");
    ref.setAttributeNS(R, "r:id", "headerRel");
    body.lastElementChild!.prepend(ref);
  }
  const value = captureWordAuthoringSnapshot(
    serialize(doc),
    "doc-A",
    "Off",
    true,
  );
  value.readToken = "read-proof";
  value.ownerMessageId = "message-A";
  wordSourceReadRefs(value).forEach((ref) => value.read.add(ref));
  value.assets = [asset];
  expect(value.issue).toBeUndefined();
  return value;
}
function plan(
  s: WordAuthoringSnapshot,
  overrides: Record<string, unknown>,
): WordDocumentPlan {
  const value = parseWordDocumentPlan(
    JSON.stringify({
      version: 1,
      scope: "document",
      snapshot: s.token,
      readToken: s.readToken,
      entries: [{ kind: "keep", source: s.blocks.map((b) => b.ref) }],
      deleted: [],
      ...overrides,
    }),
  );
  expect(value).not.toBeNull();
  return value!;
}
function compiled(plan: WordDocumentPlan, s: WordAuthoringSnapshot) {
  expect(validateWordDocumentPlan(plan, s)).toBeNull();
  const xml = compileWordDocumentPlan(plan, s);
  const result = captureWordAuthoringSnapshot(xml, "doc-A", "Off", true);
  expect(result.issue).toBeUndefined();
  expect(verifyWordPlanOutput(plan, s, result)).toBe(true);
  return {
    xml,
    snapshot: result,
    doc: new DOMParser().parseFromString(xml, "application/xml"),
  };
}

describe("structured image plan integration", () => {
  it("parses an attachment reference, compiles native image content, and reads back its intended bytes", () => {
    const s = snapshot();
    const p = plan(s, {
      entries: [
        { kind: "keep", source: s.blocks.map((b) => b.ref) },
        {
          kind: "insert",
          blocks: [
            {
              id: "added",
              type: "image",
              image: {
                assetRef: "asset_1",
                widthPt: 100,
                alt: "Attached artwork",
              },
            },
          ],
        },
      ],
    });
    const result = compiled(p, s);
    const added = result.snapshot.blocks.at(-1)!;
    expect(added.objects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "image",
          widthPt: 100,
          alt: "Attached artwork",
        }),
      ]),
    );
    expect(readWordImageData(result.doc, added.xml)?.base64).toBe(gif);
  });

  it("replaces an existing source image with an attachment while preserving its native dimensions", () => {
    const s = snapshot();
    const p = plan(s, {
      entries: [
        { kind: "keep", source: ["b1"] },
        {
          kind: "replace",
          source: ["b2"],
          blocks: [
            {
              id: "changed",
              type: "image",
              image: {
                sourceRef: "b2_image_1",
                assetRef: "asset_1",
                alt: "Replacement",
              },
            },
          ],
        },
      ],
    });
    const result = compiled(p, s);
    const changed = result.snapshot.blocks[1];
    expect(changed.objects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          widthPt: 60,
          heightPt: 30,
          alt: "Replacement",
        }),
      ]),
    );
    expect(readWordImageData(result.doc, changed.xml)?.mime).toBe("image/gif");
  });

  it("surgically replaces a header image with an attached asset and retains body image bytes", () => {
    const s = snapshot(true);
    const p = plan(s, {
      stories: [
        {
          kind: "upsert",
          type: "header",
          id: "header1",
          blocks: [
            {
              id: "headerChange",
              type: "native-edit",
              sourceRef: "story_header1",
              edits: [
                {
                  kind: "image",
                  target: "image-1",
                  operation: "update",
                  image: { assetRef: "asset_1", widthPt: 80 },
                },
              ],
            },
          ],
        },
      ],
    });
    const result = compiled(p, s);
    const header = result.snapshot.stories!.find((v) => v.id === "header1")!;
    expect(
      readWordImageData(result.doc, header.xml, 0, header.part)?.base64,
    ).toBe(gif);
    expect(
      readWordImageData(result.doc, result.snapshot.blocks[1].xml)?.base64,
    ).toBe(png);
  });

  it("resolves body image references when replacing a header object across relationship scopes", () => {
    const s = snapshot(true);
    const p = plan(s, {
      stories: [
        {
          kind: "upsert",
          type: "header",
          id: "header1",
          blocks: [
            {
              id: "headerChange",
              type: "native-edit",
              sourceRef: "story_header1",
              edits: [
                {
                  kind: "image",
                  target: "image-1",
                  operation: "update",
                  image: {
                    sourceRef: "b2_image_1",
                    widthPt: 120,
                    alt: "Copied from body",
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    const result = compiled(p, s);
    const header = result.snapshot.stories!.find((v) => v.id === "header1")!;
    expect(
      readWordImageData(result.doc, header.xml, 0, header.part)?.base64,
    ).toBe(png);
    expect(header.xml).toContain("Copied from body");
  });

  it("rejects unknown asset references before compilation, including inside story edits", () => {
    const s = snapshot(true);
    const p = plan(s, {
      stories: [
        {
          kind: "upsert",
          type: "header",
          id: "header1",
          blocks: [
            { id: "bad", type: "image", image: { assetRef: "not_attached" } },
          ],
        },
      ],
    });
    expect(validateWordDocumentPlan(p, s)).toBe("invalid");
  });

  it("exposes attachment metadata to the model without disclosing captured binary data or file IDs", async () => {
    const s = snapshot();
    const session = new WordDocumentReadSession();
    session.activate(s, { messageId: "message-A", chatId: "chat-A" });
    const result = await session.execute(
      { snapshot: s.token },
      { toolCallId: "call", messageId: "message-A", chatId: "chat-A" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.result).toHaveProperty("assets", [
      expect.objectContaining({
        ref: "asset_1",
        name: "Replacement.gif",
        mime: "image/gif",
      }),
    ]);
    expect(JSON.stringify(result.result)).not.toContain(gif);
    expect(JSON.stringify(result.result)).not.toContain("attached_file");
  });
});
