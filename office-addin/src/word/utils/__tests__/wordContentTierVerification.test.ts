import { describe, expect, it } from "vitest";

import {
  addUnreferencedWordNumbering,
  driftFirstParagraphSpacing,
  duplicateWordCustomProperties,
  duplicateWordCustomXml,
  editWordPackage,
  rePointWordLists,
  renameWordNsids,
} from "../../../test/mocks/word/ooxmlHost";
import {
  realisticSnapshot,
  realisticWordPackageXml,
  statusRewritePlan,
} from "../../../test/mocks/word/realisticWordFixtures";
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
  verifyWordPlanOutput,
  verifyWordPlanWrite,
  verifyWordRestore,
} from "../wordDocumentXml";

import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
} from "../wordDocumentPlan";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";
const all = (root: Document | Element, name: string) =>
  Array.from(root.getElementsByTagNameNS(W, name));
const part = (doc: Document, name: string) =>
  Array.from(doc.getElementsByTagNameNS(PKG, "part")).find(
    (p) => p.getAttributeNS(PKG, "name") === name,
  )!;
const body = (doc: Document) => all(part(doc, "/word/document.xml"), "body")[0];
const paragraphs = (doc: Document) =>
  Array.from(body(doc).children).filter((e) => e.localName === "p");
const numbering = (doc: Document) => part(doc, "/word/numbering.xml");
const definition = (doc: Document, id: string) =>
  all(numbering(doc), "abstractNum").find(
    (e) => e.getAttributeNS(W, "abstractNumId") === id,
  )!;
const listParagraphs = (doc: Document, numId: string) =>
  all(body(doc), "numId").filter((e) => e.getAttributeNS(W, "val") === numId);
const setSpacing = (paragraph: Element, name: string, value: string) => {
  const doc = paragraph.ownerDocument;
  let pPr = Array.from(paragraph.children).find((e) => e.localName === "pPr");
  if (!pPr) {
    pPr = doc.createElementNS(W, "w:pPr");
    paragraph.prepend(pPr);
  }
  let spacing = Array.from(pPr.children).find((e) => e.localName === "spacing");
  if (!spacing) {
    spacing = doc.createElementNS(W, "w:spacing");
    pPr.append(spacing);
  }
  spacing.setAttributeNS(W, `w:${name}`, value);
};

let seed = 0x00c0ffee;
const nsid = () => (seed++).toString(16).toUpperCase().padStart(8, "0");
/** What every Word PC import does to numbering, independent of the plan. */
const wordBookkeeping = (doc: Document) => {
  renameWordNsids(doc, nsid);
  addUnreferencedWordNumbering(doc, nsid());
};

function setup(plan?: (source: WordAuthoringSnapshot) => WordDocumentPlan) {
  const source = realisticSnapshot(realisticWordPackageXml());
  const written =
    plan?.(source) ?? statusRewritePlan(source, "Status: revised.");
  const compiled = compileWordDocumentPlan(written, source);
  const after = (...edits: ((doc: Document) => void)[]) =>
    captureWordAuthoringSnapshot(
      editWordPackage(compiled, (doc) => edits.forEach((edit) => edit(doc))),
      source.identity,
      "Off",
      true,
      "verify",
    );
  return { source, plan: written, compiled, after };
}

describe("content-tier write verification", () => {
  it("accepts Word leaving out direct spacing the paragraph's style already gives it", () => {
    const withSpacing = (points: number) =>
      setup((source) => {
        const plan = statusRewritePlan(source, "Status: revised.");
        const entry = plan.entries[1];
        if (entry.kind !== "replace")
          throw new Error("Expected a replace entry.");
        entry.blocks = [
          {
            id: "status",
            type: "paragraph",
            text: "Status: revised.",
            format: { spacingAfter: points },
          },
        ];
        return plan;
      });
    const dropAfter = (doc: Document) =>
      all(body(doc), "spacing")
        .filter((e) => e.hasAttributeNS(W, "after"))
        .forEach((e) => e.removeAttributeNS(W, "after"));
    // The document default gives Normal paragraphs 8 pt after.
    const redundant = withSpacing(8);
    expect(
      verifyWordPlanWrite(
        redundant.plan,
        redundant.source,
        redundant.after(dropAfter),
      ),
    ).toEqual({
      ok: true,
      tier: "content",
      adjustments: ["style-redundant-spacing"],
    });
    const changed = withSpacing(4);
    expect(
      verifyWordPlanWrite(
        changed.plan,
        changed.source,
        changed.after(dropAfter),
      ),
    ).toMatchObject({ ok: false });
  });

  it("accepts Word dropping a page break before the first paragraph, which has no effect there", () => {
    const pageBreak = (index: number) => (doc: Document) => {
      const paragraph = paragraphs(doc)[index];
      let pPr = Array.from(paragraph.children).find(
        (e) => e.localName === "pPr",
      );
      if (!pPr) {
        pPr = doc.createElementNS(W, "w:pPr");
        paragraph.prepend(pPr);
      }
      pPr.append(doc.createElementNS(W, "w:pageBreakBefore"));
    };
    const dropped = (doc: Document) =>
      all(body(doc), "pageBreakBefore").forEach((e) => e.remove());
    const withBreak = (index: number) => {
      const source = realisticSnapshot(
        editWordPackage(realisticWordPackageXml(), pageBreak(index)),
      );
      const plan = statusRewritePlan(source, "Status: revised.");
      const written = captureWordAuthoringSnapshot(
        editWordPackage(compileWordDocumentPlan(plan, source), dropped),
        source.identity,
        "Off",
        true,
        "verify",
      );
      return verifyWordPlanWrite(plan, source, written);
    };
    expect(withBreak(0)).toEqual({
      ok: true,
      tier: "content",
      adjustments: ["first-paragraph-page-break"],
    });
    // A dropped page break anywhere else moves content to another page.
    expect(withBreak(2)).toMatchObject({ ok: false });
  });

  it("is strict when Word wrote exactly the compiled package", () => {
    const { source, plan, after } = setup();
    expect(verifyWordPlanWrite(plan, source, after())).toEqual({
      ok: true,
      tier: "strict",
      adjustments: [],
    });
  });

  it.each([
    [
      "renamed list definition nsid values",
      (doc: Document) => renameWordNsids(doc, nsid),
      ["numbering-identity"],
    ],
    [
      "an added unused list definition that a custom property id keeps alive in strict",
      (doc: Document) => addUnreferencedWordNumbering(doc, nsid()),
      ["numbering-identity"],
    ],
    [
      "kept lists moved to new, content-equal list instances",
      rePointWordLists,
      ["list-instance-renumbered"],
    ],
    [
      "a changed spacing-before on the kept first paragraph",
      (doc: Document) => driftFirstParagraphSpacing(doc),
      ["first-paragraph-spacing"],
    ],
    [
      "everything a Word PC import does at once",
      (doc: Document) => {
        wordBookkeeping(doc);
        rePointWordLists(doc);
        driftFirstParagraphSpacing(doc);
      },
      [
        "numbering-identity",
        "list-instance-renumbered",
        "first-paragraph-spacing",
      ],
    ],
  ])("accepts %s at the content tier only", (_name, edit, adjustments) => {
    const { source, plan, after } = setup();
    const written = after(edit);
    expect(verifyWordPlanOutput(plan, source, written)).toBe(false);
    expect(verifyWordPlanWrite(plan, source, written)).toEqual({
      ok: true,
      tier: "content",
      adjustments,
    });
  });

  it.each([
    [
      "two lists merged into one instance",
      (doc: Document) =>
        listParagraphs(doc, "3").forEach((e) =>
          e.setAttributeNS(W, "w:val", "1"),
        ),
    ],
    [
      "one list split into two instances",
      (doc: Document) => {
        const copy = all(numbering(doc), "num")[0].cloneNode(true) as Element;
        copy.setAttributeNS(W, "w:numId", "9");
        numbering(doc).getElementsByTagNameNS(W, "numbering")[0].append(copy);
        listParagraphs(doc, "1")[1].setAttributeNS(W, "w:val", "9");
      },
    ],
    [
      "a changed number format",
      (doc: Document) =>
        all(definition(doc, "0"), "numFmt")[0].setAttributeNS(
          W,
          "w:val",
          "lowerLetter",
        ),
    ],
    [
      "a changed level text",
      (doc: Document) =>
        all(definition(doc, "0"), "lvlText")[0].setAttributeNS(
          W,
          "w:val",
          "%1)",
        ),
    ],
    [
      "a changed start value",
      (doc: Document) =>
        all(definition(doc, "0"), "start")[0].setAttributeNS(W, "w:val", "3"),
    ],
    [
      "a lost restart override",
      (doc: Document) => all(numbering(doc), "lvlOverride")[0].remove(),
    ],
    [
      "changed paragraph text",
      (doc: Document) => {
        const text = all(body(doc), "t").find(
          (e) => e.textContent === "Closing paragraph.",
        )!;
        text.textContent = "Closing paragraph, changed.";
      },
    ],
    [
      "a dropped paragraph",
      (doc: Document) => paragraphs(doc).at(-1)!.remove(),
    ],
    [
      "spacing-before drift on the second paragraph",
      (doc: Document) => setSpacing(paragraphs(doc)[1], "before", "120"),
    ],
    [
      "a changed spacing-after on the first paragraph",
      (doc: Document) => setSpacing(paragraphs(doc)[0], "after", "120"),
    ],
    [
      "a changed theme",
      (doc: Document) =>
        Array.from(
          part(doc, "/word/theme/theme1.xml").getElementsByTagNameNS(
            "http://schemas.openxmlformats.org/drawingml/2006/main",
            "srgbClr",
          ),
        )[0].setAttribute("val", "FF0000"),
    ],
    [
      "changed header text",
      (doc: Document) => {
        all(part(doc, "/word/header1.xml"), "t")[0].textContent = "Other";
      },
    ],
    [
      "a changed style definition",
      (doc: Document) => {
        const heading = all(part(doc, "/word/styles.xml"), "style").find(
          (e) => e.getAttributeNS(W, "styleId") === "Heading1",
        )!;
        all(heading, "sz")[0].setAttributeNS(W, "w:val", "36");
      },
    ],
  ])("rejects %s even after Word's numbering bookkeeping", (_name, edit) => {
    const { source, plan, after } = setup();
    expect(verifyWordPlanWrite(plan, source, after(wordBookkeeping))).toEqual(
      expect.objectContaining({ ok: true, tier: "content" }),
    );
    expect(
      verifyWordPlanWrite(plan, source, after(wordBookkeeping, edit)),
    ).toEqual({ ok: false, reason: "output-mismatch" });
  });

  it("rejects first-paragraph spacing drift when the plan changed that paragraph's format", () => {
    const { source, plan, after } = setup((snapshot) => ({
      ...statusRewritePlan(snapshot, "Status: revised."),
      entries: [
        {
          kind: "replace",
          source: [snapshot.blocks[0].ref],
          blocks: [
            {
              id: "title",
              type: "heading",
              level: 1,
              text: snapshot.blocks[0].text,
              format: { spacingAfter: 6 },
            },
          ],
        },
        { kind: "keep", source: snapshot.blocks.slice(1).map((b) => b.ref) },
      ],
    }));
    expect(verifyWordPlanWrite(plan, source, after(wordBookkeeping)).ok).toBe(
      true,
    );
    expect(
      verifyWordPlanWrite(
        plan,
        source,
        after(wordBookkeeping, (doc) => driftFirstParagraphSpacing(doc)),
      ),
    ).toEqual({ ok: false, reason: "output-mismatch" });
  });

  it.each([
    ["an added customXml item", duplicateWordCustomXml],
    ["a duplicated custom document property", duplicateWordCustomProperties],
  ])("fails %s as package growth before any comparison", (_name, edit) => {
    const { source, plan, after } = setup();
    expect(verifyWordPlanWrite(plan, source, after(edit))).toEqual({
      ok: false,
      reason: "package-growth",
    });
  });

  it("verifies a restore with the same tiers and growth guard", () => {
    const original = realisticSnapshot(realisticWordPackageXml());
    const restored = (edit: (doc: Document) => void) =>
      captureWordAuthoringSnapshot(
        editWordPackage(original.ooxml, edit),
        "recovery",
        "Off",
        true,
        "verify",
      );
    expect(
      verifyWordRestore(
        original,
        restored(() => {}),
      ),
    ).toEqual({
      ok: true,
      tier: "strict",
      adjustments: [],
    });
    expect(
      verifyWordRestore(
        original,
        restored((doc) => {
          wordBookkeeping(doc);
          rePointWordLists(doc);
          driftFirstParagraphSpacing(doc);
        }),
      ),
    ).toEqual({
      ok: true,
      tier: "content",
      adjustments: [
        "numbering-identity",
        "list-instance-renumbered",
        "first-paragraph-spacing",
      ],
    });
    expect(
      verifyWordRestore(
        original,
        restored((doc) => {
          wordBookkeeping(doc);
          paragraphs(doc).at(-1)!.remove();
        }),
      ),
    ).toEqual({ ok: false, reason: "output-mismatch" });
    expect(
      verifyWordRestore(original, restored(duplicateWordCustomXml)),
    ).toEqual({ ok: false, reason: "package-growth" });
  });

  it("relaxes only list definition identity for a body write", () => {
    const source = captureWordAuthoringSnapshot(
      realisticWordPackageXml(),
      "doc-A",
      "Off",
    );
    source.read = new Set(source.blocks.map((b) => b.ref));
    const plan = statusRewritePlan(source, "Status: revised.");
    const compiled = compileWordDocumentPlan(plan, source);
    const after = (edit: (doc: Document) => void) =>
      captureWordAuthoringSnapshot(
        editWordPackage(compiled, edit),
        source.identity,
        "Off",
        false,
        "verify",
      );
    const renamed = after((doc) => renameWordNsids(doc, nsid));
    expect(verifyWordPlanOutput(plan, source, renamed)).toBe(false);
    expect(verifyWordPlanWrite(plan, source, renamed)).toEqual({
      ok: true,
      tier: "content",
      adjustments: ["numbering-identity"],
    });
    expect(
      verifyWordPlanWrite(
        plan,
        source,
        after((doc) => {
          renameWordNsids(doc, nsid);
          all(definition(doc, "1"), "lvlText")[0].setAttributeNS(
            W,
            "w:val",
            "-",
          );
        }),
      ),
    ).toEqual({ ok: false, reason: "output-mismatch" });
  });
});
