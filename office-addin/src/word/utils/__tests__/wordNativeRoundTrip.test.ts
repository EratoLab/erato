import { describe, expect, it } from "vitest";

import fixturePlan from "../../../test/fixtures/word-authoring-native/plan.json";
import rewrittenXml from "../../../test/fixtures/word-authoring-native/rewritten.xml?raw";
import sourceXml from "../../../test/fixtures/word-authoring-native/source.xml?raw";
import { parseWordDocumentPlan } from "../wordDocumentPlan";
import {
  captureWordAuthoringSnapshot,
  verifyWordPlanOutput,
} from "../wordDocumentXml";

/** Captured Word 16.113 (Mac) file imports/exports; these fixtures do not exercise Office.js insertion. */
describe("Word-native mixed document regression", () => {
  it("verifies the compiled rewrite after Word imports and saves it", () => {
    const before = captureWordAuthoringSnapshot(
      sourceXml,
      "native-fixture",
      "Off",
    );
    const after = captureWordAuthoringSnapshot(
      rewrittenXml,
      "native-fixture",
      "Off",
    );
    const plan = parseWordDocumentPlan(JSON.stringify(fixturePlan))!;
    expect(before.issue).toBeUndefined();
    expect(after.issue).toBeUndefined();
    expect(after.preservedStories).toEqual([
      "header",
      "footer",
      "footnotes",
      "endnotes",
      "comments",
    ]);
    expect(verifyWordPlanOutput(plan, before, after)).toBe(true);
  });
  it("still rejects a real change to inherited table margins", () => {
    const before = captureWordAuthoringSnapshot(
      sourceXml,
      "native-fixture",
      "Off",
    );
    const changed = rewrittenXml.replace(
      '<w:top w:w="0" w:type="dxa"/>',
      '<w:top w:w="240" w:type="dxa"/>',
    );
    expect(changed).not.toBe(rewrittenXml);
    const after = captureWordAuthoringSnapshot(
      changed,
      "native-fixture",
      "Off",
    );
    expect(
      verifyWordPlanOutput(
        parseWordDocumentPlan(JSON.stringify(fixturePlan))!,
        before,
        after,
      ),
    ).toBe(false);
  });
});
