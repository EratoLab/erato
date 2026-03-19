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
    emptyStateComponent,
  }: {
    assistantId?: string;
    emptyStateComponent?: React.ReactNode;
  }) => (
    <div data-testid="chat">
      <div data-testid="assistant-id">{assistantId ?? "none"}</div>
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
});
