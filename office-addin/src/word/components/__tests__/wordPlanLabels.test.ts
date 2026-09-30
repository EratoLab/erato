import { i18n } from "@lingui/core";
import { beforeEach, describe, expect, it } from "vitest";

import {
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
});
