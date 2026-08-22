import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { skipToken } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  selectAttentionCount,
  selectPollDriverCount,
  useGenerationStatusStore,
} from "@/hooks/chat/store/generationStatusStore";
import { useRecentChats } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { messages as enMessages } from "@/locales/en/messages.json";
import { StaticFeatureConfigProvider } from "@/providers/FeatureConfigProvider";
import { resolveDelegatedRunStatus } from "@/utils/chatHistoryGrouping";

import { DelegatedRunsSection } from "./DelegatedRunsSection";

import type { RecentChat } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useRecentChats: vi.fn(() => ({ data: undefined, isLoading: false })),
}));

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

const recentChat = (overrides: Partial<RecentChat> & { id: string }) =>
  ({
    title_resolved: overrides.id,
    can_edit: false,
    file_uploads: [],
    is_pinned: false,
    last_message_at: "2026-08-19T12:00:00.000Z",
    assistant_id: "assistant-1",
    assistant_name: "Research Assistant",
    provenance_kind: "delegation",
    provenance_run_mode: "background",
    origin_chat_id: "origin-1",
    ...overrides,
  }) as RecentChat;

// Honours skipToken like the real hook: a skipped query never has data.
const mockRuns = (chats: RecentChat[]) => {
  (useRecentChats as Mock).mockImplementation((variables: unknown) =>
    variables === skipToken
      ? { data: undefined, isLoading: false }
      : {
          data: {
            chats,
            stats: {
              current_offset: 0,
              has_more: false,
              returned_count: chats.length,
              total_count: chats.length,
            },
          },
          isLoading: false,
        },
  );
};

const renderSection = (
  chatId: string | null,
  config: Parameters<typeof StaticFeatureConfigProvider>[0]["config"] = {
    assistants: { enabled: true, delegationEnabled: true },
  },
  onOpenRun?: (chat: RecentChat) => void,
) =>
  render(
    <StaticFeatureConfigProvider config={config}>
      <I18nProvider i18n={i18n}>
        <MemoryRouter>
          <DelegatedRunsSection chatId={chatId} onOpenRun={onOpenRun} />
        </MemoryRouter>
      </I18nProvider>
    </StaticFeatureConfigProvider>,
  );

const DELEGATION_ON: Parameters<
  typeof StaticFeatureConfigProvider
>[0]["config"] = {
  assistants: { enabled: true, delegationEnabled: true },
};

/** The bar starts collapsed; row-level assertions unfold it first. */
const expandRuns = () =>
  fireEvent.click(screen.getByTestId("delegated-runs-toggle"));

describe("DelegatedRunsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useGenerationStatusStore.getState().reset();
    i18n.load("en", enMessages as unknown as Messages);
    i18n.activate("en");
    (useRecentChats as Mock).mockReturnValue({
      data: undefined,
      isLoading: false,
    });
  });

  it("requests only the open chat's delegated runs and renders their rows", () => {
    mockRuns([
      recentChat({ id: "run-1", active_generation_started_at: undefined }),
      // Spawned from the same origin but not by delegation: not a run row.
      recentChat({ id: "spawn-1", provenance_kind: undefined }),
    ]);

    renderSection("origin-1");
    expandRuns();

    expect(useRecentChats).toHaveBeenCalledWith({
      queryParams: {
        origin_chat_id: "origin-1",
        include_delegated: true,
        limit: 50,
      },
    });
    const rows = screen.getAllByTestId("delegated-run-item");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Research Assistant");
  });

  it("lists only background runs, not awaited delegations", () => {
    mockRuns([
      recentChat({ id: "run-bg" }),
      // An awaited delegation carries no run mode: its answer already
      // returned inline to the origin turn, so it is not a run to track.
      recentChat({ id: "run-awaited", provenance_run_mode: undefined }),
    ]);

    renderSection("origin-1");
    expandRuns();

    const rows = screen.getAllByTestId("delegated-run-item");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute("href", "/a/assistant-1/run-bg");
  });

  it("skips the query and renders nothing when delegation is disabled", () => {
    mockRuns([recentChat({ id: "run-1" })]);

    const { container } = renderSection("origin-1", {
      assistants: { enabled: true, delegationEnabled: false },
    });

    expect(useRecentChats).toHaveBeenCalledWith(skipToken);
    expect(
      container.querySelector('[data-ui="delegated-runs-section"]'),
    ).toBeNull();
  });

  it("hides the section entirely when the chat has no delegated runs", () => {
    mockRuns([]);

    const { container } = renderSection("origin-1");

    expect(
      container.querySelector('[data-ui="delegated-runs-section"]'),
    ).toBeNull();
    expect(screen.queryByTestId("delegated-run-item")).toBeNull();
  });

  it("seeds the generation-status store from the listing so the poll gate flips", () => {
    mockRuns([
      recentChat({
        id: "run-1",
        active_generation_started_at: "2026-08-19T12:00:00.000Z",
      }),
      recentChat({
        id: "run-2",
        pending_tool_approval_at: "2026-08-19T12:01:00.000Z",
      }),
    ]);

    renderSection("origin-1");

    const state = useGenerationStatusStore.getState();
    expect(state.statusByChatId["run-1"]?.kind).toBe("running");
    expect(state.statusByChatId["run-2"]?.kind).toBe("action_required");
    expect(selectPollDriverCount(state)).toBe(2);
  });

  it("renders a running row and flips it when the store observes the outcome", () => {
    mockRuns([
      recentChat({
        id: "run-1",
        active_generation_started_at: "2026-08-19T12:00:00.000Z",
      }),
    ]);

    renderSection("origin-1");
    expandRuns();

    expect(screen.getByTestId("chat-generation-status")).toHaveAttribute(
      "data-status",
      "running",
    );

    act(() => {
      useGenerationStatusStore
        .getState()
        .markTerminalLocal("run-1", "finished");
    });

    // The observed outcome reaches the row and raises the header hint too.
    const dots = screen.getAllByTestId("chat-generation-status");
    expect(dots).toHaveLength(2);
    for (const dot of dots) {
      expect(dot).toHaveAttribute("data-status", "finished");
    }
  });

  it("renders terminal rows from the listing's durable outcome", () => {
    mockRuns([
      recentChat({ id: "run-1", delegated_run_outcome: "completed" }),
      recentChat({ id: "run-2", delegated_run_outcome: "failed" }),
    ]);

    renderSection("origin-1");
    expandRuns();

    // The first dot is the header's aggregate hint; the rows follow.
    const dots = screen.getAllByTestId("chat-generation-status").slice(1);
    expect(dots[0]).toHaveAttribute("data-status", "finished");
    expect(dots[1]).toHaveAttribute("data-status", "error");
    // The status is announced, not just tinted.
    expect(
      screen.getByLabelText("Research Assistant, Finished"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Research Assistant, Error"),
    ).toBeInTheDocument();
  });

  it("links each row to its run chat, assistant-aware", () => {
    mockRuns([
      recentChat({ id: "run-1" }),
      recentChat({
        id: "run-2",
        assistant_id: undefined,
        assistant_name: undefined,
      }),
    ]);

    renderSection("origin-1");
    expandRuns();

    const rows = screen.getAllByTestId("delegated-run-item");
    expect(rows[0]).toHaveAttribute("href", "/a/assistant-1/run-1");
    expect(rows[1]).toHaveAttribute("href", "/chat/run-2");
    // Without a surviving assistant the row falls back to the run's title.
    expect(rows[1]).toHaveTextContent("run-2");
  });

  it("starts collapsed: the header counts the runs while the rows stay off the DOM", () => {
    mockRuns([recentChat({ id: "run-1" }), recentChat({ id: "run-2" })]);

    renderSection("origin-1");

    const toggle = screen.getByTestId("delegated-runs-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("delegated-runs-count")).toHaveTextContent("2");
    expect(screen.queryByTestId("delegated-run-item")).toBeNull();

    expandRuns();

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByTestId("delegated-run-item")).toHaveLength(2);
  });

  it("raises the header attention hint only when a run asks for it", () => {
    // A merely running run raises nothing — the count already says it.
    mockRuns([
      recentChat({
        id: "run-1",
        active_generation_started_at: "2026-08-19T12:00:00.000Z",
      }),
    ]);
    const { unmount } = renderSection("origin-1");
    expect(screen.queryByTestId("chat-generation-status")).toBeNull();
    unmount();

    // Terminal outcomes do, and the most demanding one wins.
    mockRuns([
      recentChat({ id: "run-2", delegated_run_outcome: "completed" }),
      recentChat({ id: "run-3", delegated_run_outcome: "failed" }),
    ]);
    renderSection("origin-1");
    expect(screen.getByTestId("chat-generation-status")).toHaveAttribute(
      "data-status",
      "error",
    );
  });

  it("rides the composer's width channel instead of claiming its own", () => {
    mockRuns([recentChat({ id: "run-1" })]);
    const { container } = renderSection("origin-1");

    const section = container.querySelector(
      '[data-ui="delegated-runs-section"]',
    );
    expect(section).toHaveClass("w-full");
    expect(section).toHaveStyle({
      maxWidth: "var(--theme-layout-chat-input-max-width)",
    });
  });

  it("labels the toggle with the count and status, wired to the list panel", () => {
    mockRuns([
      recentChat({ id: "run-1", delegated_run_outcome: "completed" }),
      recentChat({ id: "run-2", delegated_run_outcome: "failed" }),
    ]);
    renderSection("origin-1");

    // The badge and the dot are aria-hidden, so the name carries both.
    const toggle = screen.getByTestId("delegated-runs-toggle");
    expect(toggle).toHaveAccessibleName("Delegated runs (2), Error");

    const panelId = toggle.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    expandRuns();
    const panel = document.getElementById(panelId ?? "");
    expect(panel).not.toBeNull();
    expect(
      within(panel as HTMLElement).getAllByTestId("delegated-run-item"),
    ).toHaveLength(2);
  });

  it("reveals the open-in-new-window hint from the focusable row itself", () => {
    mockRuns([recentChat({ id: "run-1" })]);
    renderSection("origin-1");
    expandRuns();

    // The reveal group must sit on the anchor that receives focus — on an
    // inner div, group-focus-visible never fires and keyboard users never
    // see the icon.
    expect(screen.getByTestId("delegated-run-item")).toHaveClass("group/run");
  });

  it("expands as a plain disclosure without capturing focus", () => {
    mockRuns([recentChat({ id: "run-1" })]);
    renderSection("origin-1");

    const toggle = screen.getByTestId("delegated-runs-toggle");
    expect(toggle).toHaveAttribute("type", "button");
    expandRuns();

    // Nothing yanked focus during expansion — the composer keeps the caret.
    expect(document.activeElement).toBe(document.body);
  });
});

describe("DelegatedRunsSection check-off", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useGenerationStatusStore.getState().reset();
    i18n.load("en", enMessages as unknown as Messages);
    i18n.activate("en");
  });

  const settledRuns = () =>
    mockRuns([
      recentChat({ id: "run-1", delegated_run_outcome: "completed" }),
      recentChat({ id: "run-2", delegated_run_outcome: "failed" }),
    ]);

  it("offers the dismiss action on settled rows only", () => {
    mockRuns([
      recentChat({
        id: "run-1",
        active_generation_started_at: "2026-08-19T12:00:00.000Z",
      }),
      recentChat({ id: "run-2", delegated_run_outcome: "completed" }),
      recentChat({
        id: "run-3",
        pending_tool_approval_at: "2026-08-19T12:01:00.000Z",
      }),
    ]);

    renderSection("origin-1");
    expandRuns();

    const dismissButtons = screen.getAllByTestId("delegated-run-dismiss");
    expect(dismissButtons).toHaveLength(1);
    expect(dismissButtons[0].closest('[data-chat-id="run-2"]')).not.toBeNull();
    expect(dismissButtons[0]).toHaveAccessibleName("Dismiss run");
    expect(dismissButtons[0]).toHaveAttribute("title", "Dismiss run");
    // The strong hover step — the row hover already paints --theme-bg-hover.
    expect(dismissButtons[0]).toHaveClass(
      "hover:!bg-[var(--theme-bg-hover-strong)]",
    );
  });

  it("removes the checked-off row, keeps the others, and survives a reload", () => {
    settledRuns();
    const { unmount } = renderSection("origin-1");
    expandRuns();

    let rows = screen.getAllByTestId("delegated-run-item");
    fireEvent.click(within(rows[0]).getByTestId("delegated-run-dismiss"));

    rows = screen.getAllByTestId("delegated-run-item");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute("href", "/a/assistant-1/run-2");
    expect(localStorage.getItem("erato.chat.dismissedDelegatedRuns")).toEqual(
      JSON.stringify(["run-1"]),
    );

    // Fresh mount with the listing unchanged (it still returns the run):
    // the persisted dismissal keeps the row out.
    unmount();
    renderSection("origin-1");
    expandRuns();
    rows = screen.getAllByTestId("delegated-run-item");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute("href", "/a/assistant-1/run-2");
  });

  it("hides the section entirely once every run is checked off", () => {
    mockRuns([recentChat({ id: "run-1", delegated_run_outcome: "completed" })]);
    const { container } = renderSection("origin-1");
    expandRuns();

    fireEvent.click(screen.getByTestId("delegated-run-dismiss"));

    expect(
      container.querySelector('[data-ui="delegated-runs-section"]'),
    ).toBeNull();
  });

  it("consumes a locally observed outcome so the attention badge drops", () => {
    mockRuns([recentChat({ id: "run-1" })]);
    act(() => {
      const store = useGenerationStatusStore.getState();
      store.seedRunning("run-1", "2026-08-19T12:00:00.000Z");
      store.markTerminalLocal("run-1", "finished");
    });

    renderSection("origin-1");
    expandRuns();
    expect(selectAttentionCount(useGenerationStatusStore.getState())).toBe(1);

    fireEvent.click(screen.getByTestId("delegated-run-dismiss"));

    expect(
      useGenerationStatusStore.getState().statusByChatId["run-1"],
    ).toMatchObject({ kind: "cleared" });
    expect(selectAttentionCount(useGenerationStatusStore.getState())).toBe(0);
  });

  it("keeps a visited run's settled state and check-off across a reload", () => {
    // The cached listing is stale — fetched while the run still ran — and
    // this client then watched the run finish before the user opened it.
    mockRuns([recentChat({ id: "run-1" })]);
    act(() => {
      const store = useGenerationStatusStore.getState();
      store.seedRunning("run-1", "2026-08-19T12:00:00.000Z");
      store.markTerminalLocal("run-1", "finished");
      store.setCurrentChatId("run-1");
    });

    const { unmount } = renderSection("origin-1");
    expandRuns();

    // Visiting consumed the notification, not the status: the row still
    // says finished and can still be checked off. (Regression: the volatile
    // tombstone used to blank both, and a reload — durable outcome, empty
    // store — brought them back, reading as dismissed runs reappearing.)
    const row = screen.getByTestId("delegated-run-item");
    expect(within(row).getByTestId("chat-generation-status")).toHaveAttribute(
      "data-status",
      "finished",
    );
    fireEvent.click(within(row).getByTestId("delegated-run-dismiss"));
    expect(screen.queryByTestId("delegated-run-item")).toBeNull();

    // Reload: memory gone, listing fresh with the durable outcome. The
    // persisted check-off keeps the row out.
    unmount();
    act(() => useGenerationStatusStore.getState().reset());
    mockRuns([recentChat({ id: "run-1", delegated_run_outcome: "completed" })]);
    const { container } = renderSection("origin-1");
    expect(
      container.querySelector('[data-ui="delegated-runs-section"]'),
    ).toBeNull();
  });

  it("opening a run still navigates while checking one off does not", () => {
    settledRuns();
    renderSection("origin-1");
    expandRuns();

    const rows = screen.getAllByTestId("delegated-run-item");
    fireEvent.click(rows[1]);
    expect(navigateMock).toHaveBeenCalledWith("/a/assistant-1/run-2");

    navigateMock.mockClear();
    fireEvent.click(within(rows[0]).getByTestId("delegated-run-dismiss"));
    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getAllByTestId("delegated-run-item")).toHaveLength(1);
  });
});

describe("DelegatedRunsSection host-open seam", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useGenerationStatusStore.getState().reset();
    i18n.load("en", enMessages as unknown as Messages);
    i18n.activate("en");
  });

  it("rows hand the run to onOpenRun and render without an href", () => {
    mockRuns([recentChat({ id: "run-1" })]);
    const onOpenRun = vi.fn();

    renderSection("origin-1", DELEGATION_ON, onOpenRun);
    expandRuns();

    const row = screen.getByTestId("delegated-run-item");
    // No href: a middle- or cmd-click cannot land on a chat route the host
    // does not serve.
    expect(row).not.toHaveAttribute("href");
    expect(row).toHaveAttribute("role", "button");

    fireEvent.click(row);
    expect(onOpenRun).toHaveBeenCalledTimes(1);
    expect(onOpenRun).toHaveBeenCalledWith(
      expect.objectContaining({ id: "run-1" }),
    );
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("activates from the keyboard like any button", () => {
    mockRuns([recentChat({ id: "run-1" })]);
    const onOpenRun = vi.fn();

    renderSection("origin-1", DELEGATION_ON, onOpenRun);
    expandRuns();

    fireEvent.keyDown(screen.getByTestId("delegated-run-item"), {
      key: "Enter",
    });
    expect(onOpenRun).toHaveBeenCalledWith(
      expect.objectContaining({ id: "run-1" }),
    );
  });

  it("checking a run off dismisses it without opening it", () => {
    mockRuns([recentChat({ id: "run-1", delegated_run_outcome: "completed" })]);
    const onOpenRun = vi.fn();

    renderSection("origin-1", DELEGATION_ON, onOpenRun);
    expandRuns();

    fireEvent.click(screen.getByTestId("delegated-run-dismiss"));
    expect(onOpenRun).not.toHaveBeenCalled();
    expect(screen.queryByTestId("delegated-run-item")).toBeNull();
  });
});

describe("resolveDelegatedRunStatus", () => {
  const runningStore = {
    kind: "running",
    startedAt: "2026-08-19T12:00:00.000Z",
    localSeenAt: 0,
  } as const;

  it("treats a row with no signal at all as a live pending run", () => {
    expect(resolveDelegatedRunStatus({}, undefined)).toBe("running");
  });

  it("lets a live store status outrank the listing's terminal outcome", () => {
    expect(
      resolveDelegatedRunStatus(
        { delegated_run_outcome: "completed" },
        runningStore,
      ),
    ).toBe("running");
  });

  it("shows no indicator for a tombstone that consumed no outcome, despite stale row markers", () => {
    expect(
      resolveDelegatedRunStatus(
        { active_generation_started_at: "2026-08-19T12:00:00.000Z" },
        { kind: "cleared", startedAt: null },
      ),
    ).toBeNull();
  });

  it("keeps stating the outcome a tombstone consumed, blocking stale live markers", () => {
    expect(
      resolveDelegatedRunStatus(
        { active_generation_started_at: "2026-08-19T12:00:00.000Z" },
        { kind: "cleared", startedAt: null, consumed: "finished" },
      ),
    ).toBe("finished");
  });

  it("maps a pending-approval marker to action required before seeding", () => {
    expect(
      resolveDelegatedRunStatus(
        { pending_tool_approval_at: "2026-08-19T12:00:00.000Z" },
        undefined,
      ),
    ).toBe("action_required");
  });
});
