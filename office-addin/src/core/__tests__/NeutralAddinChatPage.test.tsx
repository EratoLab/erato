import { i18n } from "@lingui/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
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
  setGenerationCurrentChatId: vi.fn(),
  runOpenHandler: { current: null as ((chatId: string) => void) | null },
  useDelegatedRunHeader: vi.fn(
    (): { header: ReactNode; composerLocked: boolean } => ({
      header: null,
      composerLocked: false,
    }),
  ),
  useRecentChats: vi.fn(() => ({
    data: { chats: [] },
    isLoading: false,
    error: null,
    refetch: vi.fn(async () => undefined),
  })),
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
    useGenerationStatusStore: Object.assign(vi.fn(), {
      getState: () => ({
        setCurrentChatId: spies.setGenerationCurrentChatId,
      }),
    }),
    useMessagingStore: Object.assign(() => spies.messagingStore, {
      getState: () => spies.messagingStore,
    }),
    useModelHistory: () => ({ currentChatLastModel: null }),
    usePersistedState: <T,>(_key: string, initialValue: T) =>
      useState(initialValue),
    useRecentChats: spies.useRecentChats,

    ChatErrorBoundary: ({ children }: { children?: ReactNode }) => children,
    ChatInputControlsProvider: ({ children }: { children?: ReactNode }) =>
      children,
    ChatMessage: () => null,
    DefaultMessageControls: () => null,
    DelegatedRunOpenProvider: ({
      onOpen,
      children,
    }: {
      onOpen: (chatId: string) => void;
      children?: ReactNode;
    }) => {
      spies.runOpenHandler.current = onOpen;
      return children;
    },
    DelegatedRunsSection: ({
      chatId,
      onOpenRun,
    }: {
      chatId: string | null;
      onOpenRun?: (chat: { id: string }) => void;
    }) => (
      <button
        type="button"
        data-testid="neutral-delegated-runs"
        data-chat-id={chatId ?? ""}
        onClick={() => onOpenRun?.({ id: "run-77" })}
      />
    ),
    useDelegatedRunHeader: spies.useDelegatedRunHeader,
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
  AddinChatInputCore: ({ disabled }: { disabled?: boolean }) => (
    <div
      data-testid="neutral-chat-input"
      data-disabled={disabled ? "true" : "false"}
    />
  ),
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
      appendChild.mock.calls.some(
        ([node]) =>
          node instanceof HTMLScriptElement &&
          URL.canParse(node.src) &&
          new URL(node.src).hostname === "appsforoffice.microsoft.com",
      ),
    ).toBe(false);
  });

  it("uses the chat body surface behind both messages and the composer", () => {
    renderPage();

    const conversation = screen.getByRole("region", {
      name: "Chat conversation",
    });

    expect(conversation).toHaveClass("chat-body-skin");
    expect(conversation).not.toHaveClass("bg-theme-bg-secondary");
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

  it("lists chats without opting into delegated runs", () => {
    renderPage();

    expect(spies.useRecentChats).toHaveBeenCalled();
    for (const call of spies.useRecentChats.mock.calls) {
      expect(call).toEqual([{}]);
    }
  });

  it("wires New Chat through the provider's context value", () => {
    renderPage();

    fireEvent.click(screen.getByText("New Chat"));

    expect(spies.messagingStore.abortActiveSSE).toHaveBeenCalled();
    expect(spies.messagingStore.clearUserMessages).toHaveBeenCalled();
    expect(spies.messagingStore.resetStreaming).toHaveBeenCalled();
    expect(spies.clearNewlyCreatedChatId).toHaveBeenCalled();
  });

  it("hands the session's chat to the delegated-runs bar and opens a run in-pane", () => {
    renderPage();

    const bar = screen.getByTestId("neutral-delegated-runs");
    expect(bar).toHaveAttribute("data-chat-id", "");

    // The bar's open callback goes through the session controller, so the
    // pane itself rebinds: messaging re-keys and the bar follows the run.
    fireEvent.click(bar);

    expect(screen.getByTestId("neutral-delegated-runs")).toHaveAttribute(
      "data-chat-id",
      "run-77",
    );
    expect(spies.useChatMessaging).toHaveBeenLastCalledWith(
      expect.objectContaining({ chatId: "run-77" }),
    );
  });

  it("routes deep-surface run opens through the session controller", () => {
    renderPage();
    expect(spies.runOpenHandler.current).toBeTypeOf("function");

    // The trace's open-run affordance reaches this handler via context; it
    // must land on the same in-pane path as a picker selection.
    act(() => spies.runOpenHandler.current?.("run-88"));

    expect(spies.useChatMessaging).toHaveBeenLastCalledWith(
      expect.objectContaining({ chatId: "run-88" }),
    );
  });

  it("mirrors the open chat into the generation-status store", () => {
    renderPage();
    expect(spies.setGenerationCurrentChatId).toHaveBeenLastCalledWith(null);

    // Opening a run marks it viewed, which consumes a settled run's
    // attention notification exactly like the web ChatProvider does.
    fireEvent.click(screen.getByTestId("neutral-delegated-runs"));

    expect(spies.setGenerationCurrentChatId).toHaveBeenLastCalledWith("run-77");
  });

  it("locks the composer while a delegate still writes the open run", () => {
    spies.useDelegatedRunHeader.mockReturnValue({
      header: <div data-testid="neutral-run-banner" />,
      composerLocked: true,
    });

    renderPage();

    expect(screen.getByTestId("neutral-run-banner")).toBeInTheDocument();
    expect(screen.getByTestId("neutral-chat-input")).toHaveAttribute(
      "data-disabled",
      "true",
    );
  });
});
