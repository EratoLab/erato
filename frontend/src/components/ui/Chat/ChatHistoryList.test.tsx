import { I18nProvider } from "@lingui/react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useConfirmationRegistryStore } from "@/hooks/chat/store/confirmationRegistryStore";
import { useGenerationStatusStore } from "@/hooks/chat/store/generationStatusStore";
import { useChatHistoryStore } from "@/hooks/chat/useChatHistory";
import { messages as enMessages } from "@/locales/en/messages.json";

import { ChatHistoryList, ChatHistoryListSkeleton } from "./ChatHistoryList";

import type { ChatSession } from "@/types/chat";
import type { Messages } from "@lingui/core";

vi.mock("@/components/ui", () => ({
  MessageTimestamp: ({ createdAt }: { createdAt: Date }) => (
    <span>{createdAt.toISOString()}</span>
  ),
}));

vi.mock("@/hooks/ui", () => ({
  useThemedIcon: () => null,
}));

vi.mock("../Controls/DropdownMenu", () => ({
  DropdownMenu: () => <div data-testid="row-menu" />,
}));

const sessions: ChatSession[] = [
  {
    id: "chat-1",
    title: "First chat",
    messages: [],
    updatedAt: new Date("2024-01-01").toISOString(),
    metadata: {
      fileCount: 2,
    },
  },
  {
    id: "chat-2",
    title: "Second chat",
    messages: [],
    updatedAt: new Date("2024-01-02").toISOString(),
    metadata: {
      fileCount: 0,
    },
  },
];

describe("ChatHistoryList", () => {
  beforeEach(async () => {
    const { i18n } = await import("@lingui/core");
    i18n.load("en", enMessages as unknown as Messages);
    i18n.activate("en");
    useGenerationStatusStore.setState({
      statusByChatId: {},
      currentChatId: null,
    });
    useConfirmationRegistryStore.setState({ pendingIdsByChatId: {} });
  });

  it("uses the sidebar token surface for active history rows", async () => {
    const { i18n } = await import("@lingui/core");
    const { container } = render(
      <I18nProvider i18n={i18n}>
        <ChatHistoryList
          sessions={sessions}
          currentSessionId="chat-1"
          onSessionSelect={vi.fn()}
          onSessionArchive={vi.fn()}
          onSessionEditTitle={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(
      container.querySelector('[data-ui="chat-history-list"]'),
    ).toBeTruthy();
    const historyItem = container.querySelector(
      '[data-ui="chat-history-item"]',
    );
    const historyItems = container.querySelectorAll(
      '[data-ui="chat-history-item"]',
    );

    expect(historyItem).toHaveClass("sidebar-row-geometry");
    expect(historyItem).toHaveClass("sidebar-row-selected");
    expect(historyItem?.getAttribute("style") ?? "").toBe("");
    expect(historyItem).not.toHaveClass(
      "hover:bg-[var(--theme-shell-sidebar-hover)]",
    );
    expect(
      container.querySelector('[data-ui="chat-history-list"]'),
    ).toHaveStyle({
      padding:
        "calc(var(--theme-spacing-shell-padding-y) / 2) calc(var(--theme-spacing-shell-padding-x) / 2)",
    });
    expect(historyItems[1]).not.toHaveClass("sidebar-row-selected");
  });

  it("uses the same sidebar tokens in the loading skeleton", () => {
    const { getAllByTestId } = render(<ChatHistoryListSkeleton />);

    const skeletonItem = getAllByTestId("chat-history-skeleton-item")[0];

    expect(skeletonItem).toHaveClass("sidebar-row-geometry");
    expect(skeletonItem).toHaveClass("sidebar-row-selected");
    expect(screen.getByTestId("chat-history-skeleton")).toHaveStyle({
      padding:
        "calc(var(--theme-spacing-shell-padding-y) / 2) calc(var(--theme-spacing-shell-padding-x) / 2)",
    });
  });

  it("keeps session rows as links while the inner layout wrapper stays presentational", async () => {
    const { i18n } = await import("@lingui/core");
    const { container } = render(
      <I18nProvider i18n={i18n}>
        <ChatHistoryList
          sessions={sessions}
          currentSessionId="chat-1"
          onSessionSelect={vi.fn()}
          onSessionArchive={vi.fn()}
          onSessionEditTitle={vi.fn()}
        />
      </I18nProvider>,
    );

    const firstSessionLink = screen.getByRole("link", { name: "First chat" });
    const firstSessionItem = container.querySelector(
      '[data-chat-id="chat-1"]',
    ) as HTMLElement;

    expect(firstSessionLink).toHaveClass("focus-ring-tight");
    expect(firstSessionLink).toHaveAttribute("aria-current", "page");
    expect(firstSessionItem).not.toHaveAttribute("role");
    expect(firstSessionItem).not.toHaveAttribute("tabindex");
  });

  describe("generation status indicator", () => {
    const renderList = async () => {
      const { i18n } = await import("@lingui/core");
      return render(
        <I18nProvider i18n={i18n}>
          <ChatHistoryList
            sessions={sessions}
            currentSessionId="chat-1"
            onSessionSelect={vi.fn()}
            onSessionArchive={vi.fn()}
            onSessionEditTitle={vi.fn()}
          />
        </I18nProvider>,
      );
    };

    it("renders nothing for chats without a known status", async () => {
      await renderList();

      expect(
        screen.queryByTestId("chat-generation-status"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "First chat" }),
      ).toBeInTheDocument();
    });

    it("renders a running indicator and appends the status to the row label", async () => {
      useGenerationStatusStore
        .getState()
        .seedRunning("chat-1", new Date().toISOString());
      await renderList();

      const indicator = screen.getByTestId("chat-generation-status");
      expect(indicator).toHaveAttribute("data-status", "running");
      expect(indicator).toHaveAttribute("title", "Running");
      expect(indicator).not.toHaveTextContent("Running");
      expect(
        screen.getByRole("link", { name: "First chat, Running" }),
      ).toBeInTheDocument();
    });

    it("renders finished and error indicators", async () => {
      const store = useGenerationStatusStore.getState();
      store.seedRunning("chat-1", new Date().toISOString());
      store.markTerminalLocal("chat-1", "finished");
      store.seedRunning("chat-2", new Date().toISOString());
      store.markTerminalLocal("chat-2", "error");
      await renderList();

      const indicators = screen.getAllByTestId("chat-generation-status");
      expect(indicators).toHaveLength(2);
      expect(indicators[0]).toHaveAttribute("data-status", "finished");
      expect(indicators[0]).toHaveAttribute("title", "Finished");
      expect(indicators[1]).toHaveAttribute("data-status", "error");
      expect(indicators[1]).toHaveAttribute("title", "Error");
      expect(
        screen.getByRole("link", { name: "Second chat, Error" }),
      ).toBeInTheDocument();
    });

    it("prioritizes a pending confirmation over the generation state", async () => {
      useGenerationStatusStore
        .getState()
        .seedRunning("chat-1", new Date().toISOString());
      useConfirmationRegistryStore
        .getState()
        .registerConfirmation("chat-1", "registration-1");
      await renderList();

      const indicator = screen.getByTestId("chat-generation-status");
      expect(indicator).toHaveAttribute("data-status", "action_required");
      expect(indicator).toHaveAttribute("title", "Action required");
    });
  });

  describe("row title", () => {
    const untitledSessions: ChatSession[] = [
      {
        id: "chat-untitled",
        title: "Untitled Chat",
        messages: [],
        updatedAt: new Date("2024-01-03").toISOString(),
      },
    ];

    const renderUntitled = async () => {
      const { i18n } = await import("@lingui/core");
      return render(
        <I18nProvider i18n={i18n}>
          <ChatHistoryList
            sessions={untitledSessions}
            currentSessionId={null}
            onSessionSelect={vi.fn()}
          />
        </I18nProvider>,
      );
    };

    beforeEach(() => {
      useChatHistoryStore.setState({ titleHintByChatId: {} });
    });

    it("replaces the backend untitled sentinel with the localized placeholder", async () => {
      await renderUntitled();

      expect(
        screen.getByRole("link", { name: "New Chat" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("Untitled Chat")).not.toBeInTheDocument();
    });

    it("prefers the recorded user-message hint over the placeholder", async () => {
      useChatHistoryStore
        .getState()
        .setTitleHint("chat-untitled", "Plan the offsite agenda…");
      await renderUntitled();

      expect(
        screen.getByRole("link", { name: "Plan the offsite agenda…" }),
      ).toBeInTheDocument();
    });

    it("lets a real title win over the hint", async () => {
      useChatHistoryStore.getState().setTitleHint("chat-1", "Should not show");
      const { i18n } = await import("@lingui/core");
      render(
        <I18nProvider i18n={i18n}>
          <ChatHistoryList
            sessions={sessions}
            currentSessionId={null}
            onSessionSelect={vi.fn()}
          />
        </I18nProvider>,
      );

      expect(
        screen.getByRole("link", { name: "First chat" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("Should not show")).not.toBeInTheDocument();
    });
  });
});
