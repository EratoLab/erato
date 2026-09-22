import { describe, expect, it } from "vitest";

import mixedApplied from "../../../test/fixtures/word-authoring-state/mixed-applied.xml?raw";
import mixedPlan from "../../../test/fixtures/word-authoring-state/mixed-plan.json";
import mixedSource from "../../../test/fixtures/word-authoring-state/mixed-source.xml?raw";
import rewriteApplied from "../../../test/fixtures/word-authoring-state/rewrite-applied.xml?raw";
import rewritePlan from "../../../test/fixtures/word-authoring-state/rewrite-plan.json";
import rewriteRestored from "../../../test/fixtures/word-authoring-state/rewrite-restored.xml?raw";
import rewriteSource from "../../../test/fixtures/word-authoring-state/rewrite-source.xml?raw";
import { parseWordDocumentPlan } from "../wordDocumentPlan";
import {
  captureWordAuthoringSnapshot,
  sameWordBodyContent,
  verifyWordPlanOutput,
  wordDocumentFingerprint,
} from "../wordDocumentXml";
import { sameWordPreservedParts, wordMainBody } from "../wordNativeContent";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const snapshot = (xml: string) =>
  captureWordAuthoringSnapshot(xml, "disposable-fixture", "Off");
const verify = (actual: string) =>
  verifyWordPlanOutput(
    parseWordDocumentPlan(JSON.stringify(rewritePlan))!,
    snapshot(rewriteSource),
    snapshot(actual),
  );
function change(xml: string, edit: (doc: Document) => void): string {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  edit(doc);
  return new XMLSerializer().serializeToString(doc);
}

describe("native Apply/Revert verification", { timeout: 15_000 }, () => {
  it("verifies 49 requested blocks plus Word's empty terminal paragraph", () => {
    expect(snapshot(rewriteSource).blocks).toHaveLength(11);
    expect(snapshot(rewriteApplied).blocks).toHaveLength(50);
    expect(verify(rewriteApplied)).toBe(true);
  });
  it("verifies restoration despite reordered abstract numbering definitions", () => {
    expect(
      sameWordBodyContent(snapshot(rewriteSource), snapshot(rewriteRestored)),
    ).toBe(true);
  });
  it("verifies moving a native table and retaining drawings and annotations", () => {
    expect(
      verifyWordPlanOutput(
        parseWordDocumentPlan(JSON.stringify(mixedPlan))!,
        snapshot(mixedSource),
        snapshot(mixedApplied),
      ),
    ).toBe(true);
  });
  it("does not hide a second trailing blank paragraph or a real later edit", () => {
    const changed = change(rewriteApplied, (doc) => {
      const body = wordMainBody(doc)!;
      body.insertBefore(doc.createElementNS(W, "w:p"), body.lastElementChild);
    });
    expect(verify(changed)).toBe(false);
    expect(wordDocumentFingerprint(changed)).not.toBe(
      wordDocumentFingerprint(rewriteApplied),
    );
  });
  it("does not ignore layout properties on the terminal paragraph", () => {
    const changed = change(rewriteApplied, (doc) => {
      const body = wordMainBody(doc)!;
      const last = body.lastElementChild!.previousElementSibling!;
      const props = doc.createElementNS(W, "w:pPr");
      props.append(doc.createElementNS(W, "w:pageBreakBefore"));
      last.append(props);
    });
    expect(verify(changed)).toBe(false);
  });
  it("detects a retained list redirected to a different abstract definition", () => {
    const changed = change(rewriteApplied, (doc) => {
      const num = doc.getElementsByTagNameNS(W, "num")[0];
      num
        .getElementsByTagNameNS(W, "abstractNumId")[0]
        .setAttributeNS(W, "w:val", "0");
    });
    expect(sameWordPreservedParts(rewriteSource, changed)).toBe(false);
  });
  it("retains list-instance identity rather than merging equivalent definitions", () => {
    const changed = change(rewriteApplied, (doc) => {
      doc
        .getElementsByTagNameNS(W, "num")[0]
        .setAttributeNS(W, "w:numId", "9876");
    });
    expect(sameWordPreservedParts(rewriteSource, changed)).toBe(false);
  });
});
