import { i18n } from "@lingui/core";
import { beforeEach, describe, expect, it } from "vitest";

import {
  layoutPropertyLabel,
  layoutValueLabel,
  wordPlanApplyLabel,
  wordPlanScopeText,
  wordPlanTitleText,
} from "../wordPlanLabels";

import type { WordDocumentPlan } from "../../utils/wordDocumentPlan";
import type {
  WordPlanReview,
  WordPlanScopePart,
} from "../../utils/wordPlanReview";

const plan = { entries: [{}] } as unknown as WordDocumentPlan;
const review = (unchanged: WordPlanScopePart[]) =>
  ({ scope: { wholeFile: false, unchanged } }) as unknown as WordPlanReview;

beforeEach(() => {
  i18n.load("en", {});
  i18n.activate("en");
});

describe("wordPlanScopeText", () => {
  it("agrees with the plural nouns of the parts that stay", () => {
    expect(wordPlanScopeText(review(["headers"]), plan)).toBe(
      "Headers stay as they are.",
    );
    expect(wordPlanScopeText(review(["headers", "layout"]), plan)).toBe(
      "Headers and page layout stay as they are.",
    );
  });

  it("uses the singular for page layout alone", () => {
    expect(wordPlanScopeText(review(["layout"]), plan)).toBe(
      "Page layout stays as it is.",
    );
  });
});

describe("whole-file plans", () => {
  const wholeFile = (size: WordPlanReview["size"]) =>
    ({
      size,
      title: { kind: "paragraphs-changed", n: 1 },
      scope: { wholeFile: true, unchanged: [] },
      rows: [{ family: "text" }],
      partsRows: [],
    }) as unknown as WordPlanReview;

  it("says the file is reloaded whatever scope the plan names", () => {
    const body = { entries: [{}], scope: "body" } as WordDocumentPlan;
    expect(wordPlanScopeText(wholeFile("small"), body)).toBe(
      "Word reloads the whole document file to apply this.",
    );
  });

  it("names the change on the button and keeps Replace document for large rewrites", () => {
    expect(wordPlanApplyLabel(wholeFile("small"))).toBe("Apply change");
    expect(wordPlanApplyLabel(wholeFile("large"))).toBe("Replace document");
  });
});

describe("wordPlanTitleText", () => {
  it("names sections the plan adds apart from those it updates", () => {
    expect(
      wordPlanTitleText({
        kind: "sections",
        changed: 1,
        total: 4,
        added: 1,
        parts: [],
        layout: false,
      }),
    ).toBe("Update 1 of 4 sections and add 1 section");
  });

  it("says when there is nothing to change", () => {
    expect(wordPlanTitleText({ kind: "none" })).toBe("Nothing to change");
  });

  it("names the page layout when a layout title carries no parts", () => {
    expect(wordPlanTitleText({ kind: "layout", sections: 0, parts: [] })).toBe(
      "Update page layout",
    );
  });
});

describe("section boundary values", () => {
  it("reads a boundary as the paragraph it ends after, a position, or the document end", () => {
    expect(layoutPropertyLabel("boundary")).toBe("Ends after");
    expect(layoutValueLabel("boundary", "Pilot in October.")).toBe(
      "Pilot in October.",
    );
    expect(layoutValueLabel("boundary", 4)).toBe("Item 4");
    expect(layoutValueLabel("boundary", false)).toBe("End of the document");
  });
});
