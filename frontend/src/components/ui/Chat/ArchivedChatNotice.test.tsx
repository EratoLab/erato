import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ArchivedChatNotice } from "./ArchivedChatNotice";
import { useToastStore } from "../Toast/toastStore";

const unarchiveChat = vi.fn<(chatId: string) => Promise<void>>();

vi.mock("@/providers/ChatProvider", async () =>
  (await import("@/test/chatProviderMock")).createChatProviderMock(() => ({
    unarchiveChat,
  })),
);

const unarchiveButton = () =>
  screen.queryByRole("button", { name: "Unarchive" });

const errorToasts = () =>
  useToastStore.getState().toasts.filter((toast) => toast.variant === "error");

describe("ArchivedChatNotice", () => {
  beforeEach(() => {
    unarchiveChat.mockReset();
    unarchiveChat.mockResolvedValue(undefined);
    useToastStore.getState().clear();
  });

  it("restores the chat through the shared context action", () => {
    render(<ArchivedChatNotice chatId="chat-1" />);

    fireEvent.click(unarchiveButton()!);

    expect(unarchiveChat).toHaveBeenCalledWith("chat-1");
  });

  it("reports a failed restore, since nothing on screen would change", async () => {
    unarchiveChat.mockRejectedValue(new Error("nope"));

    render(<ArchivedChatNotice chatId="chat-1" />);
    fireEvent.click(unarchiveButton()!);

    await waitFor(() => expect(errorToasts()).toHaveLength(1));
  });

  it("replaces the failure on a retry and retracts it once a retry restores the chat", async () => {
    unarchiveChat.mockRejectedValue(new Error("nope"));
    render(<ArchivedChatNotice chatId="chat-1" />);

    fireEvent.click(unarchiveButton()!);
    await waitFor(() => expect(errorToasts()).toHaveLength(1));
    await waitFor(() => expect(unarchiveButton()).toBeEnabled());
    fireEvent.click(unarchiveButton()!);
    await waitFor(() => expect(unarchiveChat).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(unarchiveButton()).toBeEnabled());
    expect(errorToasts()).toHaveLength(1);

    unarchiveChat.mockResolvedValue(undefined);
    fireEvent.click(unarchiveButton()!);

    await waitFor(() => expect(unarchiveChat).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(errorToasts()).toHaveLength(0));
  });

  it("stays busy until the restore and its refetches settle", async () => {
    let settle!: () => void;
    unarchiveChat.mockReturnValue(
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
    );
    render(<ArchivedChatNotice chatId="chat-1" />);

    fireEvent.click(unarchiveButton()!);

    expect(unarchiveButton()).toBeDisabled();
    expect(unarchiveButton()).toHaveAttribute("aria-busy", "true");
    await act(async () => {
      settle();
    });
    expect(unarchiveButton()).toBeEnabled();
  });

  it("does not carry a restore under way over to another archived chat", () => {
    unarchiveChat.mockReturnValue(new Promise<void>(() => {}));
    const { rerender } = render(<ArchivedChatNotice chatId="chat-1" />);

    fireEvent.click(unarchiveButton()!);
    rerender(<ArchivedChatNotice chatId="chat-2" />);

    expect(unarchiveButton()).toBeEnabled();
  });

  it("states the archive but withholds the way back for a delegated run", () => {
    render(<ArchivedChatNotice chatId="run-1" variant="run" />);

    expect(screen.getByTestId("archived-chat-notice")).toHaveTextContent(
      "This run is archived",
    );
    expect(unarchiveButton()).toBeNull();
  });

  it("promises no retention period, which no API knows", () => {
    render(<ArchivedChatNotice chatId="chat-1" />);

    expect(screen.getByTestId("archived-chat-notice").textContent).not.toMatch(
      /\d/,
    );
  });
});
