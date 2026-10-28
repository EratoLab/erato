import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FeedbackCommentDialog } from "./FeedbackCommentDialog";

afterEach(() => {
  cleanup();
});

describe("FeedbackCommentDialog", () => {
  it("does not submit on the Ctrl+Enter that confirms an IME candidate", async () => {
    const onSubmit = vi.fn();
    render(
      <I18nProvider i18n={i18n}>
        <FeedbackCommentDialog
          isOpen={true}
          onClose={vi.fn()}
          onSubmit={onSubmit}
          sentiment="negative"
        />
      </I18nProvider>,
    );
    const textarea = screen.getByLabelText("Feedback comment");

    fireEvent.keyDown(textarea, {
      key: "Enter",
      ctrlKey: true,
      keyCode: 229,
      isComposing: true,
    });
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it("keeps the typed comment when the submit fails and the dialog stays open", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const props = {
      onClose: vi.fn(),
      onSubmit,
      sentiment: "negative" as const,
    };
    const { rerender } = render(
      <I18nProvider i18n={i18n}>
        <FeedbackCommentDialog isOpen={true} {...props} />
      </I18nProvider>,
    );
    const textarea = screen.getByLabelText("Feedback comment");
    fireEvent.change(textarea, { target: { value: "Missed the point" } });

    fireEvent.click(
      screen.getByRole("button", { name: "Submit feedback with comment" }),
    );
    await waitFor(() => expect(textarea).not.toBeDisabled());
    rerender(
      <I18nProvider i18n={i18n}>
        <FeedbackCommentDialog
          isOpen={true}
          {...props}
          error="Failed to submit feedback. Please try again."
        />
      </I18nProvider>,
    );

    expect(onSubmit).toHaveBeenCalledWith("Missed the point");
    expect(screen.getByLabelText("Feedback comment")).toHaveValue(
      "Missed the point",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Failed to submit feedback. Please try again.",
    );
  });

  it("opens empty again after a submit closed it", async () => {
    const props = {
      onClose: vi.fn(),
      onSubmit: vi.fn().mockResolvedValue(undefined),
      sentiment: "positive" as const,
    };
    const { rerender } = render(
      <I18nProvider i18n={i18n}>
        <FeedbackCommentDialog isOpen={true} {...props} />
      </I18nProvider>,
    );
    fireEvent.change(screen.getByLabelText("Feedback comment"), {
      target: { value: "Great answer" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Submit feedback with comment" }),
    );
    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledTimes(1));

    rerender(
      <I18nProvider i18n={i18n}>
        <FeedbackCommentDialog isOpen={false} {...props} />
      </I18nProvider>,
    );
    rerender(
      <I18nProvider i18n={i18n}>
        <FeedbackCommentDialog isOpen={true} {...props} />
      </I18nProvider>,
    );

    expect(screen.getByLabelText("Feedback comment")).toHaveValue("");
  });
});
