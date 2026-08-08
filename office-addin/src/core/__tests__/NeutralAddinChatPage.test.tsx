import { i18n } from "@lingui/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NeutralAddinChatPage } from "../NeutralAddinChatPage";

import type { ChatContextValue } from "@erato/frontend/library";
import type { ReactNode } from "react";

const spies = vi.hoisted(() => ({
  messagingStore: {
    abortActiveSSE: vi.fn(),
    clearUserMessages: vi.fn(),
    resetStreaming: vi.fn(),
    setNavigationTransition: vi.fn(),
  },
  clearNewlyCreatedChatId: vi.fn(),
  useChatMessaging: vi.fn(() => ({
    messages: {},
    isLoading: false,
    isStreaming: false,
    isPendingResponse: false,
    isFinalizing: false,
    streamingContent: null,
    error: null,
    sendMessage: vi.fn(async () => undefined),
    editMessage: vi.fn(async () => undefined),
    regenerateMessage: vi.fn(async () => undefined),
    cancelMessage: vi.fn(),
    refetch: vi.fn(async () => undefined),
    newlyCreatedChatId: null,
    clearNewlyCreatedChatId: spies.clearNewlyCreatedChatId,
  })),
}));

vi.mock("@erato/frontend/library", async () => {
  const { createContext, useContext, useState } = await import("react");
  // Real context + throwing reader mirror the library, so these tests only
  // pass when AddinChatProviderCore actually provides the value AddinChatCore
  // consumes.
  const ChatContext = createContext<ChatContextValue | null>(null);

  return {
    ProfileProvider: ({ children }: { children?: ReactNode }) => children,
    FileCapabilitiesProvider: ({ children }: { children?: ReactNode }) =>
      children,

    ChatContext,
    useChatContext: () => {
      const context = useContext(ChatContext);
      if (!context) {
        throw new Error("useChatContext must be used within a ChatProvider");
      }
      return context;
    },

    getSupportedFileTypes: () => ({}),
    mapMessageToUiMessage: (message: unknown) => message,
    recentChatsQuery: () => ({ queryKey: ["recent-chats"] }),
    useArchiveChatEndpoint: () => ({
      mutateAsync: vi.fn(async () => undefined),
    }),
    useBudgetStatus: () => undefined,
    useChatMessaging: spies.useChatMessaging,
    useFileCapabilitiesContext: () => ({ capabilities: [] }),
    useFileDropzone: () => ({
      uploadFiles: vi.fn(async () => []),
      isUploading: false,
      uploadedFiles: [],
      error: null,
      clearFiles: vi.fn(),
    }),
    useFileUploadStore: (
      selector: (state: { silentChatId: string | null }) => unknown,
    ) => selector({ silentChatId: null }),
    useMessagingStore: Object.assign(() => spies.messagingStore, {
      getState: () => spies.messagingStore,
    }),
    useModelHistory: () => ({ currentChatLastModel: null }),
    usePersistedState: <T,>(_key: string, initialValue: T) =>
      useState(initialValue),
    useRecentChats: () => ({
      data: { chats: [] },
      isLoading: false,
      error: null,
      refetch: vi.fn(async () => undefined),
    }),

    ChatErrorBoundary: ({ children }: { children?: ReactNode }) => children,
    ChatInputControlsProvider: ({ children }: { children?: ReactNode }) =>
      children,
    ChatMessage: () => null,
    DefaultMessageControls: () => null,
    DocumentIcon: () => null,
    DropdownMenu: () => null,
    FeedbackCommentDialog: () => null,
    FeedbackViewDialog: () => null,
    FilePreviewModal: () => null,
    MessageList: () => <div data-testid="neutral-message-list" />,
    MessageEditProvider: ({ children }: { children?: ReactNode }) => children,
    chatMessagesQuery: () => ({ queryKey: ["chat-messages"] }),
    componentRegistry: {},
    extractTextFromContent: () => "",
    resolveComponentOverride: (override: unknown, fallback: unknown) =>
      override ?? fallback,
    transformEmailFencesForCopy: (value: string) => value,
    useActiveModelSelection: () => ({
      availableModels: [],
      selectedModel: null,
      setSelectedModel: vi.fn(),
      isSelectionReady: true,
    }),
    useConversationDropzone: () => ({
      getRootProps: () => ({}),
      getInputProps: () => ({}),
      isDragActive: false,
      isDragAccept: false,
    }),
    useFilePreviewModal: () => ({
      isPreviewModalOpen: false,
      fileToPreview: null,
      openPreviewModal: vi.fn(),
      closePreviewModal: vi.fn(),
    }),
    useFileUploadWithTokenCheck: () => ({
      uploadFiles: vi.fn(async () => []),
      uploadError: null,
      isUploading: false,
    }),
    useMessageFeedback: () => ({
      feedbackDialogState: { isOpen: false },
      feedbackViewDialogState: { isOpen: false, feedback: null },
      feedbackConfig: undefined,
      handleFeedbackSubmit: vi.fn(),
      handleFeedbackViewDialogRemove: vi.fn(),
      closeFeedbackDialog: vi.fn(),
      closeFeedbackViewDialog: vi.fn(),
      handleFeedbackDialogSubmit: vi.fn(),
      openFeedbackDialog: vi.fn(),
      openFeedbackViewDialog: vi.fn(),
      switchToEditMode: vi.fn(),
      canEditFeedback: vi.fn(() => false),
    }),
    useProfile: () => ({ profile: undefined }),
    useStandardMessageActions: () => vi.fn(),
  };
});

vi.mock("../AddinChatInputCore", () => ({
  AddinChatInputCore: () => <div data-testid="neutral-chat-input" />,
}));
vi.mock("../AddinSettingsDialogCore", () => ({
  AddinSettingsDialogCore: () => null,
}));

describe("NeutralAddinChatPage host boundary", () => {
  const originalOffice = Object.getOwnPropertyDescriptor(globalThis, "Office");

  beforeEach(() => {
    i18n.activate("en");
    Reflect.deleteProperty(globalThis, "Office");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    if (originalOffice) {
      Object.defineProperty(globalThis, "Office", originalOffice);
    }
  });

  const renderPage = () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <NeutralAddinChatPage />
      </QueryClientProvider>,
    );
  };

  it("renders the full neutral page without Office.js or its CDN script", () => {
    const appendChild = vi.spyOn(document.head, "appendChild");

    expect(renderPage).not.toThrow();

    expect(screen.getByText("New Chat")).toBeInTheDocument();
    expect(screen.getByTestId("neutral-message-list")).toBeInTheDocument();
    expect(screen.getByTestId("neutral-chat-input")).toBeInTheDocument();
    expect(
      appendChild.mock.calls.some(([node]) =>
        node instanceof HTMLScriptElement
          ? node.src.includes("appsforoffice.microsoft.com")
          : false,
      ),
    ).toBe(false);
  });

  it("threads the default neutral platform into messaging", () => {
    renderPage();

    expect(spies.useChatMessaging).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "addin-neutral" }),
    );
  });

  it("does not render the chat surface without the provider", async () => {
    const { AddinChatCore } = await import("../AddinChatCore");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    expect(() =>
      render(
        <QueryClientProvider client={queryClient}>
          <AddinChatCore />
        </QueryClientProvider>,
      ),
    ).toThrow(/within a ChatProvider/);
    consoleError.mockRestore();
  });

  it("wires New Chat through the provider's context value", () => {
    renderPage();

    fireEvent.click(screen.getByText("New Chat"));

    expect(spies.messagingStore.abortActiveSSE).toHaveBeenCalled();
    expect(spies.messagingStore.clearUserMessages).toHaveBeenCalled();
    expect(spies.messagingStore.resetStreaming).toHaveBeenCalled();
    expect(spies.clearNewlyCreatedChatId).toHaveBeenCalled();
  });
});
