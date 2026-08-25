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
import type { ReactNode } from "react";

const timestampCreatedAtLog = vi.hoisted(() => [] as Date[]);

vi.mock("@/components/ui", () => ({
  MessageTimestamp: ({ createdAt }: { createdAt: Date }) => {
    timestampCreatedAtLog.push(createdAt);
    return <span>{createdAt.toISOString()}</span>;
  },
}));

vi.mock("@/hooks/ui", () => ({
  useThemedIcon: () => null,
}));

vi.mock("../Controls/DropdownMenu", () => ({
  DropdownMenu: ({
    items,
  }: {
    items: Array<{
      label: ReactNode;
      icon?: ReactNode;
      disabled?: boolean;
    }>;
  }) => (
    <div data-testid="row-menu">
      {items.map((item) => (
        <button key={String(item.label)} disabled={item.disabled} type="button">
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  ),
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

  describe("delegated run rows", () => {
    const run: ChatSession = {
      id: "run-1",
      title: "Draft the summary",
      messages: [],
      updatedAt: new Date("2024-01-03").toISOString(),
      provenanceKind: "delegation",
      originChatId: "origin-1",
      originChatTitle: "Q3 planning",
      metadata: { fileCount: 0 },
    };

    const renderRun = async (session: ChatSession) => {
      const { i18n } = await import("@lingui/core");
      return render(
        <I18nProvider i18n={i18n}>
          <ChatHistoryList
            sessions={[session]}
            currentSessionId={null}
            onSessionSelect={vi.fn()}
          />
        </I18nProvider>,
      );
    };

    it("labels the row with where the run came from", async () => {
      await renderRun(run);

      expect(
        screen.getByTestId("chat-history-item-run-origin"),
      ).toHaveTextContent("From Q3 planning");
    });

    it("keeps its status from the durable outcome with an empty store", async () => {
      // The cold-start case the whole facet exists for: nothing seeded the
      // in-memory store, so only the listing's own outcome can carry it.
      await renderRun({ ...run, delegatedRunOutcome: "failed" });

      expect(screen.getByTestId("chat-generation-status")).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: /Draft the summary/ }),
      ).toHaveAccessibleName(/failed|error/i);
    });

    it("lets a live store status outrank a recorded outcome", async () => {
      useGenerationStatusStore.setState({
        statusByChatId: {
          "run-1": {
            kind: "running",
            startedAt: new Date().toISOString(),
            localSeenAt: Date.now(),
          },
        },
        currentChatId: null,
      });

      await renderRun({ ...run, delegatedRunOutcome: "completed" });

      expect(
        screen.getByRole("link", { name: /Draft the summary/ }),
      ).toHaveAccessibleName(/generating|running/i);
    });

    it("leaves ordinary chats without an origin line", async () => {
      await renderRun(sessions[0]);

      expect(
        screen.queryByTestId("chat-history-item-run-origin"),
      ).not.toBeInTheDocument();
    });

    it("withholds Remove from a run but keeps it on ordinary chats", async () => {
      // Archiving a run neither checks nor cancels an in-flight generation,
      // strands one parked on a tool approval, and cannot be undone.
      const { i18n } = await import("@lingui/core");
      const ui = (session: ChatSession) => (
        <I18nProvider i18n={i18n}>
          <ChatHistoryList
            sessions={[session]}
            currentSessionId={null}
            onSessionSelect={vi.fn()}
            onSessionArchive={vi.fn()}
          />
        </I18nProvider>
      );

      const { rerender } = render(ui(run));
      expect(
        screen.queryByRole("button", { name: "Remove" }),
      ).not.toBeInTheDocument();

      rerender(ui(sessions[0]));
      expect(
        screen.getByRole("button", { name: "Remove" }),
      ).toBeInTheDocument();
    });

    it("lets a pending confirmation outrank a recorded outcome", async () => {
      // The registry is the only channel for the open chat's parked approval;
      // dropping it would let a stale "completed" hide a decision to make.
      useConfirmationRegistryStore.setState({
        pendingIdsByChatId: { "run-1": ["approval-1"] },
      });

      await renderRun({ ...run, delegatedRunOutcome: "completed" });

      expect(
        screen.getByRole("link", { name: /Draft the summary/ }),
      ).toHaveAccessibleName(/action required/i);
    });
  });

  it("adds pin icons and disables pinning when the limit is reached", async () => {
    const { i18n } = await import("@lingui/core");
    render(
      <I18nProvider i18n={i18n}>
        <ChatHistoryList
          sessions={sessions}
          currentSessionId={null}
          onSessionSelect={vi.fn()}
          onSessionPin={vi.fn()}
          pinnedChatsCount={1}
          pinnedChatsLimit={1}
        />
      </I18nProvider>,
    );

    const pinItems = screen.getAllByRole("button", {
      name: "Pin limit reached",
    });
    expect(pinItems).toHaveLength(2);
    expect(pinItems[0]).toBeDisabled();
    expect(pinItems[0].querySelector("svg")).toBeInTheDocument();
  });

  it("shows an enabled unpin action with its icon for pinned chats", async () => {
    const { i18n } = await import("@lingui/core");
    render(
      <I18nProvider i18n={i18n}>
        <ChatHistoryList
          sessions={[{ ...sessions[0], isPinned: true }]}
          currentSessionId={null}
          onSessionSelect={vi.fn()}
          onSessionPin={vi.fn()}
          pinnedChatsCount={1}
          pinnedChatsLimit={1}
        />
      </I18nProvider>,
    );

    const unpinItem = screen.getByRole("button", { name: "Unpin" });
    expect(unpinItem).toBeEnabled();
    expect(unpinItem.querySelector("svg")).toBeInTheDocument();
  });

  it("keeps the MessageTimestamp Date instance stable across list re-renders", async () => {
    const { i18n } = await import("@lingui/core");
    // A fresh onSessionSelect per render defeats the list memo, so the rows
    // themselves re-render — the scenario the stable Date must survive.
    const makeUi = () => (
      <I18nProvider i18n={i18n}>
        <ChatHistoryList
          sessions={sessions}
          currentSessionId={null}
          onSessionSelect={vi.fn()}
        />
      </I18nProvider>
    );

    timestampCreatedAtLog.length = 0;
    const { rerender } = render(makeUi());
    const firstRenderDates = [...timestampCreatedAtLog];
    expect(firstRenderDates).toHaveLength(sessions.length);

    timestampCreatedAtLog.length = 0;
    rerender(makeUi());
    const secondRenderDates = [...timestampCreatedAtLog];
    expect(secondRenderDates).toHaveLength(sessions.length);

    secondRenderDates.forEach((createdAt, index) => {
      expect(createdAt).toBe(firstRenderDates[index]);
    });
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

    expect(firstSessionLink).toHaveClass("focus-ring-inset");
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

describe("disableRowLinks", () => {
  const renderRows = async (disableRowLinks: boolean, onSelect = vi.fn()) => {
    const { i18n } = await import("@lingui/core");
    i18n.load("en", enMessages as unknown as Messages);
    i18n.activate("en");
    render(
      <I18nProvider i18n={i18n}>
        <ChatHistoryList
          sessions={sessions}
          currentSessionId={null}
          onSessionSelect={onSelect}
          disableRowLinks={disableRowLinks}
        />
      </I18nProvider>,
    );
    return onSelect;
  };

  it("renders rows without hrefs so no click can navigate the host", async () => {
    const onSelect = await renderRows(true);

    const row = screen.getByRole("button", { name: "First chat" });
    expect(row).not.toHaveAttribute("href");

    const { fireEvent } = await import("@testing-library/react");
    // Modified clicks select in place: the host has no tab to open.
    fireEvent.click(row, { metaKey: true });
    expect(onSelect).toHaveBeenCalledWith("chat-1");
  });

  it("keeps the link escape hatch by default", async () => {
    const onSelect = await renderRows(false);

    const row = screen.getByRole("link", { name: "First chat" });
    expect(row).toHaveAttribute("href");

    const { fireEvent } = await import("@testing-library/react");
    const swallowNavigation = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("click", swallowNavigation);
    fireEvent.click(row, { metaKey: true });
    document.removeEventListener("click", swallowNavigation);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
