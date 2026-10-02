import { i18n } from "@lingui/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TestTheme } from "../../../test/helpers/TestTheme";
import {
  WordApplyButton,
  WordDiagnosticDetails,
  wordStatusAlertProps,
} from "../WordReviewCardParts";

import type * as EratoLibrary from "@erato/frontend/library";

vi.mock("@erato/frontend/library", async (importOriginal) => ({
  ...(await importOriginal<typeof EratoLibrary>()),
  // The real button needs the host's feature config provider.
  CopyErrorButton: ({ report }: { report?: string }) => (
    <button type="button" data-report={report}>
      Copy error report
    </button>
  ),
}));

beforeEach(() => {
  i18n.load("en", {});
  i18n.activate("en");
});
afterEach(cleanup);

describe("WordReviewCardParts", () => {
  it("keeps the Word diagnostic code behind the support disclosure", () => {
    render(
      <WordDiagnosticDetails
        diagnostic={{
          stage: "write",
          reason: "host-error",
          officeCode: "GeneralException",
          officeLocation: "Body.insertOoxml",
        }}
      />,
      { wrapper: TestTheme },
    );
    const toggle = screen.getByRole("button", { name: "Details for support" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/GeneralException/)).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByText("GeneralException · Body.insertOoxml"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy error report" }),
    ).toHaveAttribute(
      "data-report",
      "Word diagnostic: GeneralException · Body.insertOoxml",
    );
  });

  it("renders no disclosure without an Office code or location", () => {
    const { container } = render(
      <WordDiagnosticDetails
        diagnostic={{ stage: "write", reason: "host-error" }}
      />,
      { wrapper: TestTheme },
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps the busy apply button focusable and labelled with the stage", () => {
    const onApply = vi.fn();
    const view = render(
      <WordApplyButton
        applying={false}
        applyStage={undefined}
        disabled={false}
        label="Apply changes"
        onApply={onApply}
      />,
      { wrapper: TestTheme },
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    view.rerender(
      <WordApplyButton
        applying
        applyStage="backup"
        disabled
        label="Apply changes"
        onApply={onApply}
      />,
    );
    const busy = screen.getByRole("button", { name: /Saving backup/ });
    expect(busy).not.toBeDisabled();
    expect(busy).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(busy);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("announces failures as alerts and everything else politely", () => {
    for (const status of ["error", "write-failed", "revert-failed"] as const)
      expect(wordStatusAlertProps(status)).toEqual({
        type: "error",
        role: "alert",
      });
    for (const status of ["done", "reverting", "denied", "reverted"] as const)
      expect(wordStatusAlertProps(status)).toEqual({
        type: "info",
        role: "status",
      });
  });
});
