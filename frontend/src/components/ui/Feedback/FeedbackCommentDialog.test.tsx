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
});
