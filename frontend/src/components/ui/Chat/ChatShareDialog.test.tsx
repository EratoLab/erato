import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatShareDialog } from "./ChatShareDialog";

const setEnabled = vi.fn();
const ERROR_TEXT = "Could not update the share link. Please try again.";

vi.mock("@/hooks/ui/useThemedIcon", () => ({
  useThemedIcon: () => "icon-id",
}));

vi.mock("@/hooks/useChatShareLink", () => ({
  useChatShareLink: () => ({
    shareLink: null,
    setEnabled,
    isUpdating: false,
  }),
}));

const renderDialog = (chatId: string | null) => (
  <I18nProvider i18n={i18n}>
    <ChatShareDialog
      isOpen={chatId !== null}
      chatId={chatId}
      onClose={vi.fn()}
    />
  </I18nProvider>
);

beforeEach(() => {
  setEnabled.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("ChatShareDialog", () => {
  it("shows an error in the dialog when the share link cannot be enabled", async () => {
    setEnabled.mockRejectedValue({ status: 403 });
    render(renderDialog("chat-1"));

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Toggle chat sharing" }),
    );

    expect(
      (await screen.findByText(ERROR_TEXT)).closest('[role="alert"]'),
    ).not.toBeNull();
    expect(setEnabled).toHaveBeenCalledWith(true);
    expect(
      screen.getByRole("checkbox", { name: "Toggle chat sharing" }),
    ).not.toBeChecked();
  });

  it("drops the error once the dialog is closed and opened again", async () => {
    setEnabled.mockRejectedValue({ status: 500 });
    const { rerender } = render(renderDialog("chat-1"));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Toggle chat sharing" }),
    );
    await screen.findByText(ERROR_TEXT);

    rerender(renderDialog(null));
    rerender(renderDialog("chat-1"));

    await waitFor(() => expect(screen.queryByText(ERROR_TEXT)).toBeNull());
  });
});
