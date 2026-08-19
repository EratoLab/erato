import { i18n, type Messages } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useGenerationStatusStore } from "@/hooks/chat/store/generationStatusStore";
import {
  useGetAssistant,
  useRecentChats,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { messages as enMessages } from "@/locales/en/messages.json";
import { useChatContext } from "@/providers/ChatProvider";
import { StaticFeatureConfigProvider } from "@/providers/FeatureConfigProvider";

import AssistantChatSpacePage from "../AssistantChatSpacePage";

import type { RecentChat } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ChatSession } from "@/types/chat";
import type React from "react";
import type { Mock } from "vitest";

import "@testing-library/jest-dom";

i18n.load("en", enMessages as unknown as Messages);
i18n.activate("en");

vi.mock("@/providers/ChatProvider", () => ({
  useChatContext: vi.fn(),
}));

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useGetAssistant: vi.fn(),
  useAvailableModels: vi.fn(() => ({ data: [] })),
  useRecentChats: vi.fn(() => ({ data: undefined, isLoading: false })),
  // The run header reads the chat it opened, whether or not it is a run.
  useChatDetail: vi.fn(() => ({ data: undefined })),
}));

vi.mock("@/components/ui/Chat/Chat", () => ({
  Chat: ({
    assistantId,
    assistantFiles,
    emptyStateComponent,
  }: {
    assistantId?: string;
    assistantFiles?: Array<{ filename: string; download_url: string }>;
    emptyStateComponent?: React.ReactNode;
  }) => (
    <div data-testid="chat">
      <div data-testid="assistant-id">{assistantId ?? "none"}</div>
      <div data-testid="assistant-file-count">
        {assistantFiles?.length ?? 0}
      </div>
      <div data-testid="assistant-file-names">
        {assistantFiles?.map((file) => file.filename).join(",") ?? ""}
      </div>
      <div data-testid="assistant-file-downloads">
        {assistantFiles?.map((file) => file.download_url).join(",") ?? ""}
      </div>
      {emptyStateComponent}
    </div>
  ),
}));

vi.mock("@/components/ui/Chat/ChatEmptyState", () => ({
  ChatEmptyState: ({
    variant,
    pastChats,
    delegatedRuns,
    delegationEnabled,
    isLoadingChats,
  }: {
    variant: "assistant" | "chat";
    pastChats?: ChatSession[];
    delegatedRuns?: ChatSession[];
    delegationEnabled?: boolean;
    isLoadingChats?: boolean;
  }) => (
    <div data-testid={`empty-state-${variant}`}>
      <div data-testid="past-chats">
        {pastChats?.map((chat) => chat.id).join(",") ?? ""}
      </div>
      <div data-testid="delegated-runs">
        {delegatedRuns?.map((chat) => chat.id).join(",") ?? ""}
      </div>
      <div data-testid="delegation-enabled">{String(delegationEnabled)}</div>
      <div data-testid="is-loading-chats">{String(isLoadingChats)}</div>
    </div>
  ),
}));

vi.mock("@/components/ui/Feedback/Alert", () => ({
  Alert: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="alert">{children}</div>
  ),
}));

const assistant = {
  id: "assistant-1",
  name: "Research Assistant",
  prompt: "Answer from the attached files",
  description: null,
  default_chat_provider: null,
  facet_ids: [],
  enforce_facet_settings: false,
  mcp_server_ids: [],
  updated_at: "2026-03-19T12:00:00.000Z",
  files: [],
};

const recentChat = (overrides: Partial<RecentChat> & { id: string }) =>
  ({
    title_resolved: overrides.id,
    can_edit: true,
    file_uploads: [],
    is_pinned: false,
    last_message_at: "2026-03-19T12:00:00.000Z",
    assistant_id: "assistant-1",
    ...overrides,
  }) as RecentChat;

const mockRecentChats = (chats: RecentChat[], isLoading = false) => {
  (useRecentChats as Mock).mockReturnValue({
    data: {
      chats,
      stats: {
        current_offset: 0,
        has_more: false,
        returned_count: chats.length,
        total_count: chats.length,
      },
    },
    isLoading,
  });
};

const renderPage = (
  initialEntry: string,
  featureConfig?: { assistants?: { delegationEnabled?: boolean } },
) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <StaticFeatureConfigProvider config={featureConfig}>
        <I18nProvider i18n={i18n}>
          <MemoryRouter initialEntries={[initialEntry]}>
            <Routes>
              <Route path="/a/:assistantId">
                <Route index element={<AssistantChatSpacePage />} />
                <Route path=":chatId" element={<AssistantChatSpacePage />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </I18nProvider>
      </StaticFeatureConfigProvider>
    </QueryClientProvider>,
  );
};

describe("AssistantChatSpacePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useGenerationStatusStore.getState().reset();

    (useRecentChats as Mock).mockReturnValue({
      data: undefined,
      isLoading: false,
    });
    (useChatContext as Mock).mockReturnValue({
      messages: {},
      messageOrder: [],
      currentChatId: "chat-1",
      mountKey: "mount-key",
      pinnedChats: [],
      pinChat: vi.fn(),
    });
  });

  it("keeps rendering an existing chat when the assistant can no longer be fetched", () => {
    (useGetAssistant as Mock).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Assistant not found"),
    });

    renderPage("/a/assistant-1/chat-1");

    expect(screen.getByTestId("chat")).toBeInTheDocument();
    expect(screen.queryByTestId("alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("assistant-id")).toHaveTextContent("none");
    expect(screen.getByTestId("empty-state-chat")).toBeInTheDocument();
  });

  it("shows an error when the assistant landing page cannot load the assistant", () => {
    (useGetAssistant as Mock).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Assistant not found"),
    });

    renderPage("/a/assistant-1");

    expect(screen.getByTestId("alert")).toHaveTextContent(
      "Failed to load assistant. Please try again.",
    );
    expect(screen.queryByTestId("chat")).not.toBeInTheDocument();
  });

  it("passes preview-only assistant files through to chat for erato-file link resolution", () => {
    (useGetAssistant as Mock).mockReturnValue({
      data: {
        ...assistant,
        name: "Preview Assistant",
        files: [
          {
            id: "file-preview-only",
            filename: "sample-report-compressed.pdf",
            download_url: null,
            preview_url:
              "https://files.example.com/preview/sample-report-compressed.pdf",
            file_contents_unavailable_missing_permissions: false,
            file_capability: {
              can_read: true,
              can_search: true,
              can_extract_text: true,
              can_analyze: false,
              can_summarize: true,
              can_render_inline: true,
              is_supported: true,
              supported_operations: ["extract_text"],
            },
          },
        ],
      },
      isLoading: false,
      error: null,
    });

    renderPage("/a/assistant-1");

    expect(screen.getByTestId("chat")).toBeInTheDocument();
    expect(screen.getByTestId("assistant-file-count")).toHaveTextContent("1");
    expect(screen.getByTestId("assistant-file-names")).toHaveTextContent(
      "sample-report-compressed.pdf",
    );
    expect(screen.getByTestId("assistant-file-downloads")).toHaveTextContent(
      "",
    );
  });

  describe("delegated runs", () => {
    beforeEach(() => {
      (useGetAssistant as Mock).mockReturnValue({
        data: assistant,
        isLoading: false,
        error: null,
      });
    });

    it("asks for delegated runs instead of reusing the sidebar list", () => {
      renderPage("/a/assistant-1");

      expect(useRecentChats).toHaveBeenCalledWith(
        expect.objectContaining({
          queryParams: expect.objectContaining({ include_delegated: true }),
        }),
      );
    });

    it("splits this assistant's chats from its delegated runs", () => {
      mockRecentChats([
        recentChat({ id: "own-1" }),
        recentChat({ id: "delegated-1", provenance_kind: "delegation" }),
        recentChat({ id: "other-assistant", assistant_id: "assistant-2" }),
        recentChat({ id: "handoff-1", provenance_kind: "handoff_branch" }),
      ]);

      renderPage("/a/assistant-1");

      expect(screen.getByTestId("past-chats")).toHaveTextContent(
        "own-1,handoff-1",
      );
      expect(screen.getByTestId("delegated-runs")).toHaveTextContent(
        "delegated-1",
      );
    });

    it("orders each segment by most recent activity", () => {
      mockRecentChats([
        recentChat({ id: "own-old", last_message_at: "2026-03-01T00:00:00Z" }),
        recentChat({ id: "own-new", last_message_at: "2026-03-09T00:00:00Z" }),
      ]);

      renderPage("/a/assistant-1");

      expect(screen.getByTestId("past-chats")).toHaveTextContent(
        "own-new,own-old",
      );
    });

    it("reports the list loading state instead of claiming it is settled", () => {
      mockRecentChats([], true);

      renderPage("/a/assistant-1");

      expect(screen.getByTestId("is-loading-chats")).toHaveTextContent("true");
    });

    it("passes the delegation feature flag through to the welcome screen", () => {
      renderPage("/a/assistant-1", {
        assistants: { delegationEnabled: true },
      });

      expect(screen.getByTestId("delegation-enabled")).toHaveTextContent(
        "true",
      );
    });

    it("seeds running and parked delegated runs into the generation status store", () => {
      mockRecentChats([
        recentChat({
          id: "delegated-running",
          provenance_kind: "delegation",
          active_generation_started_at: "2026-03-19T12:00:00.000Z",
        }),
        recentChat({
          id: "delegated-parked",
          provenance_kind: "delegation",
          pending_tool_approval_at: "2026-03-19T12:01:00.000Z",
        }),
        recentChat({
          id: "own-running",
          active_generation_started_at: "2026-03-19T12:02:00.000Z",
        }),
      ]);

      renderPage("/a/assistant-1");

      const { statusByChatId } = useGenerationStatusStore.getState();
      expect(statusByChatId["delegated-running"]?.kind).toBe("running");
      expect(statusByChatId["delegated-parked"]?.kind).toBe("action_required");
      // Listed rows already seed themselves through the sidebar's own list.
      expect(statusByChatId["own-running"]).toBeUndefined();
    });
  });
});
