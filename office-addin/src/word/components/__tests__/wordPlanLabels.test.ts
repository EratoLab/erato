import { i18n } from "@lingui/core";
import { beforeEach, describe, expect, it } from "vitest";

import { wordPlanScopeText } from "../wordPlanLabels";

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
