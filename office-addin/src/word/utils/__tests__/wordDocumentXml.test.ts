import { describe, expect, it } from "vitest";

import {
  examplePlan,
  packageXml,
  paragraph,
  readySnapshot,
  W,
} from "../../../test/mocks/word/authoringFixtures";
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
  verifyWordPlanOutput,
  wordDocumentFingerprint,
} from "../wordDocumentXml";

describe("Word structural compiler", () => {
  it("creates native headings while preserving package and section properties", () => {
    const s = readySnapshot();
    const p = examplePlan(s.token);
    const xml = compileWordDocumentPlan(p, s);
    const after = captureWordAuthoringSnapshot(xml, "doc-A", "Off");
    expect(after.issue).toBeUndefined();
    expect(verifyWordPlanOutput(p, s, after)).toBe(true);
    expect(after.blocks.map((b) => b.type)).toEqual([
      "heading",
      "paragraph",
      "paragraph",
      "heading",
      "paragraph",
      "paragraph",
    ]);
    expect(xml).toContain('w:styleId="Heading2"');
    expect(xml).toContain('w:w="11906"');
  });
  it("constructs native numbered and bullet lists with separate list IDs", () => {
    const s = readySnapshot();
    const p = examplePlan(s.token);
    p.entries.push({
      kind: "insert",
      blocks: [
        {
          id: "l1",
          type: "list-item",
          list: "tasks",
          ordered: true,
          level: 0,
          text: "First",
        },
        {
          id: "l2",
          type: "list-item",
          list: "tasks",
          ordered: true,
          level: 1,
          text: "Nested",
        },
        {
          id: "l3",
          type: "list-item",
          list: "points",
          ordered: false,
          level: 0,
          text: "Point",
        },
      ],
    });
    const xml = compileWordDocumentPlan(p, s);
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    expect(doc.getElementsByTagNameNS(W, "num")).toHaveLength(2);
    expect(
      Array.from(doc.getElementsByTagNameNS(W, "numFmt")).map((n) =>
        n.getAttributeNS(W, "val"),
      ),
    ).toContain("bullet");
    expect(
      verifyWordPlanOutput(
        p,
        s,
        captureWordAuthoringSnapshot(xml, "doc-A", "Off"),
      ),
    ).toBe(true);
  });
  it("preserves unchanged emphasis and hyperlinks and escapes generated text", () => {
    const original = packageXml(
      '<w:p><w:hyperlink xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="link1"><w:r><w:rPr><w:b/></w:rPr><w:t>Linked source</w:t></w:r></w:hyperlink></w:p>',
    );
    const s = readySnapshot(original);
    const p = {
      version: 1 as const,
      snapshot: s.token,
      readToken: "read-proof",
      scope: "body" as const,
      entries: [
        { kind: "keep" as const, source: ["b1"] },
        {
          kind: "insert" as const,
          blocks: [
            {
              id: "n1",
              type: "paragraph" as const,
              text: '<script> & "text"',
              runs: [{ text: '<script> & "text"', italic: true }],
            },
          ],
        },
      ],
      deleted: [],
    };
    const xml = compileWordDocumentPlan(p, s);
    expect(xml).toContain('r:id="link1"');
    expect(xml).toContain("<w:b");
    expect(xml).toContain("<w:i");
    expect(xml).toContain("&lt;script&gt;");
    expect(
      captureWordAuthoringSnapshot(xml, "doc-A", "Off").blocks[1].text,
    ).toBe('<script> & "text"');
  });
  it("rejects an incomplete anchor instead of silently flattening it", () => {
    expect(
      captureWordAuthoringSnapshot(
        packageXml('<w:p><w:bookmarkStart w:id="1"/></w:p>'),
        "doc-A",
        "Off",
      ).issueDetails,
    ).toContain("unbalanced-anchors");
  });
  it("does not enable the rewrite channel with tracking on or unknown", () => {
    expect(
      captureWordAuthoringSnapshot(
        packageXml(paragraph("A")),
        "doc",
        "TrackAll",
      ).issue,
    ).toBe("tracking");
    expect(
      captureWordAuthoringSnapshot(packageXml(paragraph("A")), "doc", "unknown")
        .issue,
    ).toBe("tracking");
  });
  it("detects formatting-only changes in live preconditions", () => {
    const a = packageXml(paragraph("Same text"));
    const b = a.replace("<w:r>", "<w:r><w:rPr><w:b/></w:rPr>");
    expect(wordDocumentFingerprint(a)).not.toBe(wordDocumentFingerprint(b));
  });
  it("does not verify success if Word loses kept formatting or changes a list's kind", () => {
    const source = readySnapshot(
      packageXml(
        "<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Keep emphasis</w:t></w:r></w:p>",
      ),
    );
    const plan = {
      version: 1 as const,
      snapshot: source.token,
      readToken: "read-proof",
      scope: "body" as const,
      entries: [
        { kind: "keep" as const, source: ["b1"] },
        {
          kind: "insert" as const,
          blocks: [
            {
              id: "list1",
              type: "list-item" as const,
              list: "tasks",
              ordered: true,
              level: 0,
              text: "First task",
            },
          ],
        },
      ],
      deleted: [],
    };
    const compiled = compileWordDocumentPlan(plan, source);
    for (const changed of [
      compiled.replace(/<w:b\s*\/>/, ""),
      compiled.replaceAll('w:val="decimal"', 'w:val="bullet"'),
    ]) {
      expect(
        verifyWordPlanOutput(
          plan,
          source,
          captureWordAuthoringSnapshot(changed, "doc-A", "Off"),
        ),
      ).toBe(false);
    }
  });
});
