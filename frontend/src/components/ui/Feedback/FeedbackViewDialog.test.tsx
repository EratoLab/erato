import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FeedbackViewDialog } from "./FeedbackViewDialog";

afterEach(() => {
  cleanup();
});

const feedback = {
  id: "feedback-id",
  sentiment: "negative" as const,
  comment: "Too long",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe("FeedbackViewDialog", () => {
  it("disables Remove and Edit while a removal is in flight", () => {
    render(
      <I18nProvider i18n={i18n}>
        <FeedbackViewDialog
          isOpen={true}
          onClose={vi.fn()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          feedback={feedback}
          canEdit={true}
          isRemoving={true}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole("button", { name: "Removing..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close" })).toBeEnabled();
  });

  it("announces a removal error", () => {
    render(
      <I18nProvider i18n={i18n}>
        <FeedbackViewDialog
          isOpen={true}
          onClose={vi.fn()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          feedback={feedback}
          canEdit={true}
          error="Failed to remove feedback. Please try again."
        />
      </I18nProvider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Failed to remove feedback. Please try again.",
    );
    expect(screen.getByRole("button", { name: "Remove" })).toBeEnabled();
  });
});
