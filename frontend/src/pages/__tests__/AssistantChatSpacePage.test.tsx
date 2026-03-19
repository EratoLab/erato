import { i18n, Messages } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useGetAssistant } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { messages as enMessages } from "@/locales/en/messages.json";
import { useChatContext } from "@/providers/ChatProvider";

import AssistantChatSpacePage from "../AssistantChatSpacePage";

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
  ChatEmptyState: ({ variant }: { variant: "assistant" | "chat" }) => (
    <div data-testid={`empty-state-${variant}`}>{variant}</div>
  ),
}));

vi.mock("@/components/ui/Feedback/Alert", () => ({
  Alert: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="alert">{children}</div>
  ),
}));

const renderPage = (initialEntry: string) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
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
    </QueryClientProvider>,
  );
};

describe("AssistantChatSpacePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (useChatContext as Mock).mockReturnValue({
      messages: {},
      messageOrder: [],
      chats: [],
      currentChatId: "chat-1",
      mountKey: "mount-key",
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
        id: "assistant-1",
        name: "Preview Assistant",
        prompt: "Use attached files",
        description: null,
        default_chat_provider: null,
        facet_ids: [],
        enforce_facet_settings: false,
        mcp_server_ids: [],
        updated_at: "2026-03-19T12:00:00.000Z",
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
});
