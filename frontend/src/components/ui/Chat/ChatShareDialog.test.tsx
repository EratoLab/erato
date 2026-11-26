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
import { useToastStore } from "../Toast/toastStore";

const setEnabled = vi.fn();
let shareLink: { id: string; enabled: boolean } | null = null;
const ERROR_TEXT = "Could not update the share link. Please try again.";

vi.mock("@/hooks/ui/useThemedIcon", () => ({
  useThemedIcon: () => "icon-id",
}));

vi.mock("@/hooks/useChatShareLink", () => ({
  useChatShareLink: () => ({
    shareLink,
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
  shareLink = null;
  useToastStore.setState({ toasts: [] });
});

function rejectLater() {
  let reject!: (reason: unknown) => void;
  setEnabled.mockReturnValue(
    new Promise((_, rej) => {
      reject = rej;
    }),
  );
  return (reason: unknown) => reject(reason);
}

afterEach(() => {
  cleanup();
  delete window.ERATO_SHELL;
  vi.unstubAllGlobals();
});

const SHARE_URL = `${window.location.origin}/chat-share/share-1`;

function withEnabledLink() {
  shareLink = { id: "share-1", enabled: true };
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  return writeText;
}

function withShareSheet(
  request: (method: string, params?: unknown) => unknown,
) {
  const shell = {
    contract: 1,
    capabilities: { shareSheet: 1 },
    request: vi.fn(request),
    on: () => () => {},
  };
  window.ERATO_SHELL = shell;
  return shell;
}

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

  it("toasts a failure that lands after the dialog was reopened for another chat", async () => {
    const reject = rejectLater();
    const { rerender } = render(renderDialog("chat-1"));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Toggle chat sharing" }),
    );

    rerender(renderDialog(null));
    rerender(renderDialog("chat-2"));
    reject({ status: 500 });

    await waitFor(() =>
      expect(useToastStore.getState().toasts).toMatchObject([
        { variant: "error", title: ERROR_TEXT, dedupeKey: "chat-share:chat-1" },
      ]),
    );
    expect(screen.queryByText(ERROR_TEXT)).toBeNull();
  });

  it("toasts a failure that lands after the dialog closed", async () => {
    const reject = rejectLater();
    const { rerender } = render(renderDialog("chat-1"));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Toggle chat sharing" }),
    );

    rerender(renderDialog(null));
    reject({ status: 500 });

    await waitFor(() =>
      expect(useToastStore.getState().toasts).toMatchObject([
        { variant: "error", title: ERROR_TEXT },
      ]),
    );
  });

  it("copies the link where no share sheet is offered", async () => {
    const writeText = withEnabledLink();
    render(renderDialog("chat-1"));

    fireEvent.click(screen.getByRole("button", { name: "Copy chat link" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SHARE_URL));
  });

  it("opens the host's share sheet for the link instead of copying it", async () => {
    const writeText = withEnabledLink();
    const shell = withShareSheet(() => Promise.resolve({ completed: true }));
    render(renderDialog("chat-1"));

    fireEvent.click(screen.getByRole("button", { name: "Share chat link" }));

    await waitFor(() =>
      expect(shell.request).toHaveBeenCalledWith("shareSheet.open", {
        url: SHARE_URL,
        anchor: { x: 0, y: 0, width: 0, height: 0 },
      }),
    );
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Copy chat link" })).toBeNull();
  });

  it("copies the link when the share sheet cannot open", async () => {
    const writeText = withEnabledLink();
    withShareSheet(() =>
      Promise.reject({ code: "unavailable", message: "busy" }),
    );
    render(renderDialog("chat-1"));

    fireEvent.click(screen.getByRole("button", { name: "Share chat link" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SHARE_URL));
  });
});
