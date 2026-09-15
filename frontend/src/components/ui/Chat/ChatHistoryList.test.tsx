import { I18nProvider } from "@lingui/react";
import { render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { chatHistoryListConformanceFailures } from "@/conformance/chatHistoryList";
import { useConfirmationRegistryStore } from "@/hooks/chat/store/confirmationRegistryStore";
import { useGenerationStatusStore } from "@/hooks/chat/store/generationStatusStore";
import { useChatHistoryStore } from "@/hooks/chat/useChatHistory";
import { messages as enMessages } from "@/locales/en/messages.json";

import {
  ChatHistoryList,
  ChatHistoryListSkeleton,
  useChatHistoryRowMenuItems,
  useChatHistoryRowPresentation,
} from "./ChatHistoryList";

import type { ChatHistoryRowMenuOptions } from "./ChatHistoryList";
import type { DropdownMenuItem } from "../Controls/DropdownMenu";
import type { ChatSession } from "@/types/chat";
import type { Messages } from "@lingui/core";
import type { ReactNode } from "react";

const timestampCreatedAtLog = vi.hoisted(() => [] as Date[]);
const dropdownItemsLog = vi.hoisted(() => [] as unknown[][]);

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
      confirmAction?: boolean;
      confirmMessage?: string;
    }>;
  }) => (
    dropdownItemsLog.push(items),
    (
      <div data-testid="row-menu">
        {items.map((item) => (
          <button
            key={String(item.label)}
            disabled={item.disabled}
            type="button"
            data-confirms={item.confirmAction ? "" : undefined}
            data-confirm-message={item.confirmMessage}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>
    )
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

    it("withholds Archive from a run but keeps it on ordinary chats", async () => {
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
        screen.queryByRole("button", { name: "Archive" }),
      ).not.toBeInTheDocument();

      rerender(ui(sessions[0]));
      expect(
        screen.getByRole("button", { name: "Archive" }),
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

  describe("archived rows", () => {
    const archivedSession: ChatSession = {
      ...sessions[0],
      archivedAt: new Date("2024-01-05").toISOString(),
    };

    const renderRow = async (session: ChatSession) => {
      const { i18n } = await import("@lingui/core");
      render(
        <I18nProvider i18n={i18n}>
          <ChatHistoryList
            sessions={[session]}
            currentSessionId={null}
            onSessionSelect={vi.fn()}
            onSessionArchive={vi.fn()}
            onSessionUnarchive={vi.fn()}
            onSessionEditTitle={vi.fn()}
            onSessionShare={vi.fn()}
            onSessionPin={vi.fn()}
          />
        </I18nProvider>,
      );
    };

    it("marks the row and carries the marker in its accessible name", async () => {
      await renderRow(archivedSession);

      expect(
        screen.getByTestId("chat-history-item-archived"),
      ).toHaveTextContent("Archived");
      expect(
        screen.getByRole("link", { name: "First chat, Archived" }),
      ).toBeInTheDocument();
    });

    it("offers Unarchive and Rename in place of Archive, Pin and Share", async () => {
      await renderRow(archivedSession);

      expect(
        screen.getByRole("button", { name: "Unarchive" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Rename" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Archive" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Pin" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Share" }),
      ).not.toBeInTheDocument();
    });

    it("withholds Unarchive as well as Archive from an archived run", async () => {
      await renderRow({
        ...archivedSession,
        provenanceKind: "delegation",
        originChatId: "origin-1",
        originChatTitle: "Q3 planning",
      });

      expect(
        screen.getByRole("button", { name: "Rename" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Unarchive" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Archive" }),
      ).not.toBeInTheDocument();
    });

    it("withholds them from a run whose origin no longer resolves", async () => {
      await renderRow({ ...archivedSession, provenanceKind: "delegation" });

      expect(
        screen.queryByRole("button", { name: "Unarchive" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Archive" }),
      ).not.toBeInTheDocument();
    });

    it("leaves an active row unmarked with its full menu", async () => {
      await renderRow(sessions[0]);

      expect(
        screen.queryByTestId("chat-history-item-archived"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "First chat" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Archive" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Pin" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Unarchive" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("useChatHistoryRowPresentation", () => {
    it("returns the archived marker and folds it into the accessible name", async () => {
      const { i18n } = await import("@lingui/core");
      useGenerationStatusStore.setState({
        statusByChatId: {
          "chat-1": {
            kind: "running",
            startedAt: new Date().toISOString(),
            localSeenAt: Date.now(),
          },
        },
        currentChatId: null,
      });

      const { result } = renderHook(
        () =>
          useChatHistoryRowPresentation({
            ...sessions[0],
            archivedAt: new Date("2024-01-05").toISOString(),
            provenanceKind: "delegation",
            originChatId: "origin-1",
            originChatTitle: "Q3 planning",
          }),
        {
          wrapper: ({ children }) => (
            <I18nProvider i18n={i18n}>{children}</I18nProvider>
          ),
        },
      );

      expect(result.current.archived).toBe(true);
      expect(result.current.archivedLabel).toBe("Archived");
      expect(result.current.ariaLabel).toBe(
        "First chat, Archived, From Q3 planning, Running",
      );
    });

    it("returns no marker for an active chat", async () => {
      const { i18n } = await import("@lingui/core");
      const { result } = renderHook(
        () => useChatHistoryRowPresentation(sessions[0]),
        {
          wrapper: ({ children }) => (
            <I18nProvider i18n={i18n}>{children}</I18nProvider>
          ),
        },
      );

      expect(result.current.archived).toBe(false);
      expect(result.current.archivedLabel).toBeNull();
      expect(result.current.ariaLabel).toBe("First chat");
    });

    // The badges node is the whole point of the seam: a kit renders it and
    // inherits whatever indicators the row grows later.
    describe("badges", () => {
      const renderBadges = async (session: ChatSession) => {
        const { i18n } = await import("@lingui/core");
        const { result } = renderHook(
          () => useChatHistoryRowPresentation(session),
          {
            wrapper: ({ children }) => (
              <I18nProvider i18n={i18n}>{children}</I18nProvider>
            ),
          },
        );
        render(<div>{result.current.badges}</div>);
      };

      it("carries the archived pill only for an archived row", async () => {
        await renderBadges({
          ...sessions[0],
          archivedAt: new Date("2024-01-05").toISOString(),
        });

        expect(
          screen.getByTestId("chat-history-item-archived"),
        ).toHaveTextContent("Archived");
      });

      it("leaves an active row without a pill", async () => {
        await renderBadges(sessions[0]);

        expect(
          screen.queryByTestId("chat-history-item-archived"),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByTestId("chat-generation-status"),
        ).not.toBeInTheDocument();
      });

      it("keeps the pill ahead of the title so a long title cannot push it out", async () => {
        const { i18n } = await import("@lingui/core");
        render(
          <I18nProvider i18n={i18n}>
            <ChatHistoryList
              sessions={[
                {
                  ...sessions[0],
                  archivedAt: new Date("2024-01-05").toISOString(),
                },
              ]}
              currentSessionId={null}
              onSessionSelect={vi.fn()}
            />
          </I18nProvider>,
        );

        const pill = screen.getByTestId("chat-history-item-archived");
        const title = screen.getByTitle("First chat");
        expect(
          pill.compareDocumentPosition(title) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      });

      it("carries the attention status dot", async () => {
        useGenerationStatusStore.setState({
          statusByChatId: {
            "chat-1": {
              kind: "running",
              startedAt: new Date().toISOString(),
              localSeenAt: Date.now(),
            },
          },
          currentChatId: null,
        });

        await renderBadges(sessions[0]);

        expect(screen.getByTestId("chat-generation-status")).toHaveAttribute(
          "data-status",
          "running",
        );
      });
    });

    // The second indicator the row already had. It rides the hook rather than
    // the row so an override inherits it the same way it inherits the badges.
    describe("subline", () => {
      const renderSubline = async (session: ChatSession) => {
        const { i18n } = await import("@lingui/core");
        const { result } = renderHook(
          () => useChatHistoryRowPresentation(session),
          {
            wrapper: ({ children }) => (
              <I18nProvider i18n={i18n}>{children}</I18nProvider>
            ),
          },
        );
        render(<div>{result.current.subline}</div>);
      };

      it("carries the delegated run's origin", async () => {
        await renderSubline({
          ...sessions[0],
          provenanceKind: "delegation",
          originChatId: "origin-1",
          originChatTitle: "Q3 planning",
        });

        expect(
          screen.getByTestId("chat-history-item-run-origin"),
        ).toHaveTextContent("From Q3 planning");
      });

      it("is empty for an ordinary chat", async () => {
        await renderSubline(sessions[0]);

        expect(
          screen.queryByTestId("chat-history-item-run-origin"),
        ).not.toBeInTheDocument();
      });
    });
  });

  describe("useChatHistoryRowMenuItems", () => {
    const renderMenu = async (
      session: ChatSession,
      options: Partial<ChatHistoryRowMenuOptions> = {},
    ) => {
      const { i18n } = await import("@lingui/core");
      const { result } = renderHook(
        () =>
          useChatHistoryRowMenuItems({
            session,
            pinnedChatsCount: 0,
            pinnedChatsLimit: 5,
            onArchive: vi.fn(),
            onUnarchive: vi.fn(),
            onEditTitle: vi.fn(),
            onShare: vi.fn(),
            onPin: vi.fn(),
            ...options,
          }),
        {
          wrapper: ({ children }) => (
            <I18nProvider i18n={i18n}>{children}</I18nProvider>
          ),
        },
      );
      return result.current;
    };

    const labels = (items: DropdownMenuItem[]) =>
      items.map((item) => String(item.label));

    const archivedSession: ChatSession = {
      ...sessions[0],
      archivedAt: new Date("2024-01-05").toISOString(),
    };
    const run: ChatSession = {
      ...sessions[0],
      provenanceKind: "delegation",
      originChatId: "origin-1",
      originChatTitle: "Q3 planning",
    };

    it("offers Unarchive in place of Archive, Pin and Share when archived", async () => {
      expect(labels(await renderMenu(archivedSession))).toEqual([
        "Rename",
        "Unarchive",
      ]);
    });

    it("keeps Archive, Pin and Share on an active row", async () => {
      expect(labels(await renderMenu(sessions[0]))).toEqual([
        "Pin",
        "Share",
        "Rename",
        "Archive",
      ]);
    });

    it("withholds both archive actions from a delegated run", async () => {
      expect(labels(await renderMenu(run))).not.toContain("Archive");
      expect(
        labels(await renderMenu({ ...run, ...archivedSession })),
      ).not.toContain("Unarchive");
    });

    it("confirms archiving only while the chat is still working", async () => {
      const idle = await renderMenu(sessions[0]);
      expect(idle.at(-1)?.confirmAction).toBe(false);

      useGenerationStatusStore.setState({
        statusByChatId: {
          "chat-1": {
            kind: "running",
            startedAt: new Date().toISOString(),
            localSeenAt: Date.now(),
          },
        },
        currentChatId: null,
      });
      const running = await renderMenu(sessions[0]);
      expect(running.at(-1)?.confirmAction).toBe(true);
      expect(running.at(-1)?.confirmMessage).toContain("still generating");

      useGenerationStatusStore.setState({
        statusByChatId: {},
        currentChatId: null,
      });
      useConfirmationRegistryStore.setState({
        pendingIdsByChatId: { "chat-1": ["approval-1"] },
      });
      const actionRequired = await renderMenu(sessions[0]);
      expect(actionRequired.at(-1)?.confirmAction).toBe(true);
      expect(actionRequired.at(-1)?.confirmMessage).toContain("tool approval");
    });

    it("disables pinning at the limit and everything without edit rights", async () => {
      const atLimit = await renderMenu(sessions[0], {
        pinnedChatsCount: 5,
        pinnedChatsLimit: 5,
      });
      expect(labels(atLimit)[0]).toBe("Pin limit reached");
      expect(atLimit[0].disabled).toBe(true);

      const readOnly = await renderMenu({ ...sessions[0], canEdit: false });
      // The array first: `every` on an empty one passes, so hiding the items
      // instead of disabling them would slip through the flag check alone.
      expect(labels(readOnly)).toEqual(["Pin", "Share", "Rename", "Archive"]);
      expect(
        readOnly
          .filter((item) => item.label !== "Archive")
          .every((item) => item.disabled),
      ).toBe(true);
    });

    it("drops the actions the caller supplies no handler for", async () => {
      expect(
        labels(
          await renderMenu(sessions[0], {
            onPin: undefined,
            onShare: undefined,
            onEditTitle: undefined,
          }),
        ),
      ).toEqual(["Archive"]);
    });
  });

  // The host runs its own contract suite so the cases cannot describe only
  // what this list happens to do; each kit runs the same export against its
  // override.
  it("satisfies the row conformance suite it publishes to kits", async () => {
    const { i18n } = await import("@lingui/core");

    expect(
      chatHistoryListConformanceFailures(ChatHistoryList, {
        render: (element) =>
          render(<I18nProvider i18n={i18n}>{element}</I18nProvider>),
        openRowMenu: () =>
          (dropdownItemsLog.at(-1) ?? []) as DropdownMenuItem[],
      }),
    ).toEqual([]);
  });

  describe("archive confirmation", () => {
    const renderArchiveItem = async () => {
      const { i18n } = await import("@lingui/core");
      render(
        <I18nProvider i18n={i18n}>
          <ChatHistoryList
            sessions={[sessions[0]]}
            currentSessionId={null}
            onSessionSelect={vi.fn()}
            onSessionArchive={vi.fn()}
          />
        </I18nProvider>,
      );
      return screen.getByRole("button", { name: "Archive" });
    };

    it("asks nothing of an idle row", async () => {
      expect(await renderArchiveItem()).not.toHaveAttribute("data-confirms");
    });

    it("warns that a running generation carries on", async () => {
      useGenerationStatusStore.setState({
        statusByChatId: {
          "chat-1": {
            kind: "running",
            startedAt: new Date().toISOString(),
            localSeenAt: Date.now(),
          },
        },
        currentChatId: null,
      });

      const item = await renderArchiveItem();

      expect(item).toHaveAttribute("data-confirms");
      expect(item.getAttribute("data-confirm-message")).toContain(
        "still generating",
      );
    });

    it("warns that a parked approval cannot be resumed", async () => {
      useConfirmationRegistryStore.setState({
        pendingIdsByChatId: { "chat-1": ["approval-1"] },
      });

      const item = await renderArchiveItem();

      expect(item).toHaveAttribute("data-confirms");
      expect(item.getAttribute("data-confirm-message")).toContain(
        "tool approval",
      );
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
    expect(historyItem).toHaveAttribute("data-selected");
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
    expect(historyItems[1]).not.toHaveAttribute("data-selected");
    // The other half of the selected/hover exchange: the fill and the tint are
    // alternatives, so a row that is not the open one still takes the tint.
    expect(historyItems[1]).toHaveClass(
      "hover:bg-[var(--theme-shell-sidebar-hover)]",
    );
  });

  it("uses the same sidebar tokens in the loading skeleton", () => {
    const { getAllByTestId } = render(<ChatHistoryListSkeleton />);

    const skeletonItem = getAllByTestId("chat-history-skeleton-item")[0];

    expect(skeletonItem).toHaveClass("sidebar-row-geometry");
    expect(skeletonItem).toHaveClass("sidebar-row-selected");
    // The row frame is a flex container, so the shimmer bars only stay stacked
    // while the column axis is spelled out here — Row sets none.
    expect(skeletonItem).toHaveClass("flex-col");
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
