import { i18n } from "@lingui/core";
import { beforeAll, describe, expect, it } from "vitest";

import { wordDocumentDiagnosticText } from "../wordAuthoringMessages";

import type { WordDocumentDiagnostic } from "../wordApplyDocumentPlan";

beforeAll(() => {
  i18n.load("en", {});
  i18n.activate("en");
});

const mismatch = (locations: string[]): WordDocumentDiagnostic => ({
  stage: "restore",
  reason: "output-mismatch",
  details: { route: "in-place", locations },
});

describe("wordDocumentDiagnosticText", () => {
  it("says which part of an in-place Revert did not come back when it is the paragraph style", () => {
    expect(
      wordDocumentDiagnosticText(
        mismatch(["/word/document.xml body block 6: style"]),
        true,
      ),
    ).toBe(
      "Word did not put the original paragraph style back, so Revert is incomplete. Check that paragraph's style in Word. Your saved original is still available for recovery.",
    );
    for (const location of ["signature", "list"])
      expect(
        wordDocumentDiagnosticText(
          mismatch([`/word/document.xml body block 6: ${location}`]),
          true,
        ),
      ).toBe(
        "Word could not verify the restored document. Your saved original is still available for recovery.",
      );
  });
});
