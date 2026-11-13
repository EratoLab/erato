import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { ChatInputControlsProvider } from "@/components/ui/Chat/ChatInputControlsContext";
import { MessageContent } from "@/components/ui/Message/MessageContent";
import { useMessageExplainStore } from "@/hooks/chat/store/messageExplainStore";
import { messages as enMessages } from "@/locales/en/messages.json";
import { StaticFeatureConfigProvider } from "@/providers/FeatureConfigProvider";

import { MessageList } from "./MessageList";

import type { ChatMessage } from "./MessageList";
import type { ChatInputControls } from "../Chat/ChatInputControlsContext";
import type { ChatMessageProps } from "../Chat/ChatMessage";
import type { Messages } from "@lingui/core";

vi.mock("@/utils/sse/sseClient", () => ({
  createSSEConnection: vi.fn(() => vi.fn()),
}));

beforeAll(() => {
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
});

afterEach(() => {
  document.getSelection()?.removeAllRanges();
  act(() => useMessageExplainStore.getState().close());
});

const SETTLE_MS = 320;
const settle = () =>
  act(() => new Promise((resolve) => setTimeout(resolve, SETTLE_MS)));

const message = (
  id: string,
  role: "user" | "assistant",
  text: string,
  loading?: ChatMessage["loading"],
): ChatMessage => ({
  id,
  role,
  content: [{ content_type: "text", text }],
  createdAt: "2026-01-01T00:00:00.000Z",
  sender: role,
  authorId: role,
  loading,
});

const finishedChat = {
  user1: message("user1", "user", "What are the main levers?"),
  assistant1: message(
    "assistant1",
    "assistant",
    "Committed-use discounts cost less.\n\nEgress fees are billed per gigabyte.",
  ),
};

/**
 * What a component kit's message renderer gives the host: the two markers on
 * the message root and the host's own `MessageContent`. No `message-body`.
 */
function KitLikeRenderer({ message: shown }: ChatMessageProps) {
  return (
    <div data-message-id={shown.id} data-ui="chat-message">
      <MessageContent
        messageId={shown.id}
        content={shown.content}
        isStreaming={!!shown.loading && shown.loading.state !== "done"}
      />
      <button type="button">Copy message</button>
    </div>
  );
}

const noopControls: ChatInputControls = {
  setDraftMessage: vi.fn(),
  focusInput: vi.fn(),
  setSelectedFacetIds: vi.fn(),
  setSelectedChatProviderId: vi.fn(),
  toggleFacetId: vi.fn(),
  addUploadedFiles: vi.fn(),
  removeUploadedFiles: vi.fn(),
  clearQueuedMessage: vi.fn(),
};

interface ListOptions {
  messages?: Record<string, ChatMessage>;
  messageOrder?: string[];
  quoteEnabled?: boolean;
  explainEnabled?: boolean;
  controls?: ChatInputControls;
}

const list = ({
  messages = finishedChat,
  messageOrder = Object.keys(messages),
  quoteEnabled = true,
  explainEnabled = true,
  controls = { ...noopControls, appendToDraft: vi.fn() },
}: ListOptions = {}) => (
  <QueryClientProvider client={queryClient}>
    <StaticFeatureConfigProvider
      config={{ messageTextActions: { quoteEnabled, explainEnabled } }}
    >
      <ThemeProvider enableCustomTheme={false}>
        <I18nProvider i18n={i18n}>
          <ChatInputControlsProvider value={controls}>
            <MessageList
              messages={messages}
              messageOrder={messageOrder}
              loadOlderMessages={vi.fn()}
              hasOlderMessages={false}
              isPending={false}
              currentSessionId="chat-1"
              controlsContext={{ canEdit: true }}
              onMessageAction={vi.fn(async () => true)}
              messageRenderer={KitLikeRenderer}
            />
          </ChatInputControlsProvider>
        </I18nProvider>
      </ThemeProvider>
    </StaticFeatureConfigProvider>
  </QueryClientProvider>
);

const queryClient = new QueryClient();

const textNodeOf = (text: string) =>
  screen.getByText(text, { exact: false }).firstChild as Text;

/** Marks text the way a mouse does: press, drag, release. */
const mark = (start: [Node, number], end: [Node, number]) => {
  fireEvent.pointerDown(start[0].parentElement!);
  const range = document.createRange();
  range.setStart(...start);
  range.setEnd(...end);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  fireEvent.pointerUp(end[0].parentElement!);
};

const markInAssistantMessage = () => {
  const node = textNodeOf("Committed-use discounts");
  mark([node, 0], [node, "Committed-use discounts".length]);
};

const toolbar = () => screen.findByRole("toolbar");
const actionNames = async () =>
  Array.from((await toolbar()).querySelectorAll("button")).map(
    (button) => button.textContent,
  );

describe("MessageTextActionsToolbar", () => {
  it("offers Quote and Explain on text marked in a finished assistant message", async () => {
    render(list());

    markInAssistantMessage();

    expect(await actionNames()).toEqual(["Quote", "Explain"]);
    expect(await toolbar()).toHaveAccessibleName("Actions on marked text");
  });

  it("offers Quote alone on a user message", async () => {
    render(list());
    const node = textNodeOf("What are the main levers?");

    mark([node, 0], [node, 4]);

    expect(await actionNames()).toEqual(["Quote"]);
  });

  it("offers only the actions that are enabled", async () => {
    const { unmount } = render(list({ quoteEnabled: false }));
    markInAssistantMessage();
    expect(await actionNames()).toEqual(["Explain"]);
    unmount();
    document.getSelection()?.removeAllRanges();

    render(list({ quoteEnabled: false, explainEnabled: false }));
    markInAssistantMessage();
    await settle();
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  });

  it("shows nothing for a selection across two messages or outside the text", async () => {
    render(list());

    mark(
      [textNodeOf("What are the main levers?"), 0],
      [textNodeOf("Committed-use discounts"), 9],
    );
    await settle();
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();

    const button = screen.getAllByText("Copy message")[1].firstChild as Text;
    mark([textNodeOf("Egress fees"), 0], [button, 4]);
    await settle();
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  });

  it("shows nothing on the message that is still streaming", async () => {
    render(
      list({
        messages: {
          ...finishedChat,
          assistant1: {
            ...finishedChat.assistant1,
            loading: { state: "typing" },
          },
        },
      }),
    );

    markInAssistantMessage();
    await settle();

    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  });

  it("shows after a keyboard selection has stopped changing", async () => {
    render(list());
    const node = textNodeOf("Egress fees");
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 6);
    document.getSelection()!.addRange(range);

    fireEvent(document, new Event("selectionchange"));

    expect(await actionNames()).toEqual(["Quote", "Explain"]);
  });

  it("quotes the marked text into the composer and releases the selection", async () => {
    const appendToDraft = vi.fn();
    render(list({ controls: { ...noopControls, appendToDraft } }));
    mark(
      [textNodeOf("Committed-use discounts"), 0],
      [textNodeOf("Egress fees"), "Egress fees".length],
    );

    fireEvent.click(await screen.findByRole("button", { name: "Quote" }));

    expect(appendToDraft).toHaveBeenCalledTimes(1);
    expect(appendToDraft.mock.calls[0][0]).toMatch(
      /^> Committed-use discounts cost less\.\n(>\n)?> Egress fees$/,
    );
    expect(document.getSelection()?.isCollapsed).toBe(true);
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  });

  it("offers no Quote when the composer handle predates the append method", async () => {
    render(list({ controls: noopControls }));

    markInAssistantMessage();

    expect(await actionNames()).toEqual(["Explain"]);
  });

  it("opens the small chat below the block of the passage, one at a time", async () => {
    render(list());
    markInAssistantMessage();

    fireEvent.click(await screen.findByRole("button", { name: "Explain" }));

    const card = await screen.findByRole("group", {
      name: "Explain: Committed-use discounts",
    });
    expect(card.previousElementSibling).toHaveTextContent(
      "Committed-use discounts cost less.",
    );
    expect(card.nextElementSibling).toHaveTextContent("Egress fees");
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    expect(document.getSelection()?.isCollapsed).toBe(true);

    const node = textNodeOf("Egress fees");
    mark([node, 0], [node, "Egress fees".length]);
    fireEvent.click(await screen.findByRole("button", { name: "Explain" }));

    await screen.findByRole("group", { name: "Explain: Egress fees" });
    expect(screen.getAllByRole("group", { name: /^Explain:/ })).toHaveLength(1);
  });

  it("offers no actions on text marked inside the small chat", async () => {
    render(list());
    markInAssistantMessage();
    fireEvent.click(await screen.findByRole("button", { name: "Explain" }));
    const title = (
      await screen.findByRole("group", { name: /^Explain:/ })
    ).querySelector("span")!.firstChild as Text;

    mark([title, 0], [title, 4]);
    await settle();

    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  });

  it("hides on Escape and keeps the marked text, and hides on scroll", async () => {
    render(list());
    markInAssistantMessage();
    await toolbar();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    expect(document.getSelection()?.toString()).toBe("Committed-use discounts");

    fireEvent(document, new Event("selectionchange"));
    await toolbar();
    fireEvent.scroll(screen.getByTestId("message-list"));
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  });

  it("is reachable with Tab, walks its actions with the arrow keys and gives focus back", async () => {
    render(list());
    markInAssistantMessage();
    await toolbar();

    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Quote" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(screen.getByRole("button", { name: "Explain" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(screen.getByRole("button", { name: "Quote" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    expect(document.body).toHaveFocus();
  });

  it("leaves what a copy of the selection puts on the clipboard unchanged", async () => {
    const copied = (enabled: boolean) => {
      const { unmount } = render(
        list({ quoteEnabled: enabled, explainEnabled: enabled }),
      );
      markInAssistantMessage();
      const setData = vi.fn();
      fireEvent.copy(screen.getByTestId("message-list"), {
        clipboardData: { clearData: vi.fn(), setData },
      });
      unmount();
      document.getSelection()?.removeAllRanges();
      return setData.mock.calls;
    };

    const withActions = copied(true);

    expect(withActions).toContainEqual([
      "text/plain",
      "Committed-use discounts",
    ]);
    expect(withActions).toEqual(copied(false));
  });

  it("discards the small chat when its message is regenerated, edited away or streams again", async () => {
    const { rerender } = render(list());
    const openCard = async () => {
      markInAssistantMessage();
      fireEvent.click(await screen.findByRole("button", { name: "Explain" }));
      await screen.findByRole("group", { name: /^Explain:/ });
    };

    await openCard();
    rerender(
      list({
        messages: {
          ...finishedChat,
          assistant1: {
            ...finishedChat.assistant1,
            loading: { state: "typing" },
          },
        },
      }),
    );
    await waitFor(() =>
      expect(useMessageExplainStore.getState().card).toBeNull(),
    );

    rerender(list());
    await openCard();
    rerender(list({ messageOrder: ["user1"] }));
    await waitFor(() =>
      expect(useMessageExplainStore.getState().card).toBeNull(),
    );
  });

  it("discards the small chat when the list goes away", async () => {
    const { unmount } = render(list());
    markInAssistantMessage();
    fireEvent.click(await screen.findByRole("button", { name: "Explain" }));
    await screen.findByRole("group", { name: /^Explain:/ });

    unmount();

    expect(useMessageExplainStore.getState().card).toBeNull();
  });
});
