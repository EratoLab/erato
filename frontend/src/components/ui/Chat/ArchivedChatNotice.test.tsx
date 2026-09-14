import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ArchivedChatNotice } from "./ArchivedChatNotice";

const unarchiveChat = vi.fn<(chatId: string) => Promise<void>>();
const notifyUnarchiveFailed = vi.fn();

vi.mock("@/providers/ChatProvider", () => ({
  useChatContext: () => ({ unarchiveChat }),
}));

vi.mock("./unarchiveFeedback", () => ({
  notifyUnarchiveFailed: () => notifyUnarchiveFailed(),
}));

const unarchiveButton = () =>
  screen.queryByRole("button", { name: "Unarchive" });

describe("ArchivedChatNotice", () => {
  beforeEach(() => {
    unarchiveChat.mockReset();
    unarchiveChat.mockResolvedValue(undefined);
    notifyUnarchiveFailed.mockClear();
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

    await waitFor(() => expect(notifyUnarchiveFailed).toHaveBeenCalled());
  });

  it("states the archive but withholds the way back for a delegated run", () => {
    render(<ArchivedChatNotice chatId="run-1" canUnarchive={false} />);

    expect(screen.getByTestId("archived-chat-notice")).toHaveTextContent(
      "This chat is archived",
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
