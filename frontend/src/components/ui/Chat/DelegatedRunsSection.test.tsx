import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { skipToken } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
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
) =>
  render(
    <StaticFeatureConfigProvider config={config}>
      <I18nProvider i18n={i18n}>
        <MemoryRouter>
          <DelegatedRunsSection chatId={chatId} />
        </MemoryRouter>
      </I18nProvider>
    </StaticFeatureConfigProvider>,
  );

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

  it("shows no indicator for a consumed outcome despite stale row markers", () => {
    expect(
      resolveDelegatedRunStatus(
        { active_generation_started_at: "2026-08-19T12:00:00.000Z" },
        { kind: "cleared", startedAt: null },
      ),
    ).toBeNull();
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
