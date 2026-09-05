import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { useGenerationStatusStore } from "@/hooks/chat/store/generationStatusStore";
import { useRecentChats } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { messages as enMessages } from "@/locales/en/messages.json";

import { Chat } from "./Chat";

import type { RecentChat } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";

// The surface under test is Chat's own composition — which chrome mounts
// where — so the heavyweight children are stubs and only the delegated-runs
// bar stays real.
vi.mock("./ChatHistorySidebar", () => ({
  ChatHistorySidebar: () => <div data-testid="sidebar-stub" />,
}));
// Mutable so a test can rerender the same tree under a different chat
// state or layout mode without swapping the mocks.
const testState = vi.hoisted(
  (): {
    chatContext: Record<string, unknown>;
    emptyStateLayout: "bottom" | "centered";
    showUsageAdvisory: boolean;
  } => ({
    chatContext: {},
    emptyStateLayout: "bottom",
    showUsageAdvisory: true,
  }),
);

// An uncontrolled textarea: its draft survives only if Chat keeps the node
// mounted, which is what the continuity tests check.
vi.mock("./ChatInput", () => ({
  ChatInput: (props: { disabled?: boolean }) => (
    <textarea
      data-testid="chat-input-stub"
      data-disabled={String(Boolean(props.disabled))}
    />
  ),
}));
vi.mock("../MessageList/MessageList", () => ({
  MessageList: () => <div data-testid="message-list-stub" />,
}));
vi.mock("./ChatMessage", () => ({ ChatMessage: () => null }));
vi.mock("./ChatShareDialog", () => ({ ChatShareDialog: () => null }));
vi.mock("./EditChatTitleDialog", () => ({ EditChatTitleDialog: () => null }));
vi.mock("../Feedback/FeedbackCommentDialog", () => ({
  FeedbackCommentDialog: () => null,
}));
vi.mock("../Feedback/FeedbackViewDialog", () => ({
  FeedbackViewDialog: () => null,
}));
vi.mock("@/components/ui/Modal/FilePreviewModal", () => ({
  FilePreviewModal: () => null,
}));

vi.mock("@/providers/ChatProvider", () => ({
  useChatContext: () => ({
    ...baseChatContext,
    ...testState.chatContext,
  }),
}));

const baseChatContext = {
  sendMessage: vi.fn(),
  editMessage: vi.fn(),
  regenerateMessage: vi.fn(),
  isMessagingLoading: false,
  isPendingResponse: false,
  chats: [],
  currentChatId: "origin-1",
  navigateToChat: vi.fn(),
  archiveChat: vi.fn(),
  updateChatTitle: vi.fn(),
  pinChat: vi.fn(),
  pinnedChats: [],
  createNewChat: vi.fn(),
  isHistoryLoading: false,
  historyError: null,
  refetchHistory: vi.fn(),
  fetchNextHistoryPage: vi.fn(),
  hasNextHistoryPage: false,
  isFetchingNextHistoryPage: false,
  currentChatLastModel: null,
};

vi.mock("@/hooks/chat", () => ({
  useActiveModelSelection: () => ({
    availableModels: [],
    selectedModel: null,
    setSelectedModel: vi.fn(),
    isSelectionReady: true,
  }),
  useChatActions: () => ({
    handleSendMessage: vi.fn().mockResolvedValue(undefined),
    handleMessageAction: vi.fn(),
  }),
  useModelSwitches: () => ({}),
  useStandardMessageActions: () => vi.fn(),
}));

vi.mock("@/hooks/chat/useMessageFeedback", () => ({
  useMessageFeedback: () => ({
    feedbackDialogState: { isOpen: false },
    feedbackViewDialogState: { isOpen: false, feedback: null, error: null },
    feedbackConfig: {},
    handleFeedbackSubmit: vi.fn(),
    handleFeedbackViewDialogRemove: vi.fn(),
    closeFeedbackDialog: vi.fn(),
    closeFeedbackViewDialog: vi.fn(),
    handleFeedbackDialogSubmit: vi.fn(),
    openFeedbackDialog: vi.fn(),
    openFeedbackViewDialog: vi.fn(),
    switchToEditMode: vi.fn(),
    canEditFeedback: () => false,
  }),
}));

vi.mock("@/hooks/files/useConversationDropzone", () => ({
  useConversationDropzone: () => ({
    getRootProps: () => ({}),
    getInputProps: () => ({}),
    isDragActive: false,
    isDragAccept: false,
  }),
}));

vi.mock("@/hooks/files/useFileUploadWithTokenCheck", () => ({
  useFileUploadWithTokenCheck: () => ({
    uploadFiles: vi.fn(),
    uploadError: null,
    isUploading: false,
  }),
}));

vi.mock("@/hooks/ui", () => ({
  useSidebar: () => ({
    isOpen: false,
    toggle: vi.fn(),
    collapsedMode: "hidden",
  }),
  useFilePreviewModal: () => ({
    isPreviewModalOpen: false,
    fileToPreview: null,
    relatedFiles: [],
    openPreviewModal: vi.fn(),
    closePreviewModal: vi.fn(),
  }),
}));

vi.mock("@/hooks/useChatShareLink", () => ({
  useChatShareLink: () => ({ shareLink: null }),
}));

vi.mock("@/hooks/useProfile", () => ({
  useProfile: () => ({ profile: undefined }),
}));

vi.mock("@/providers/FeatureConfigProvider", () => ({
  useChatInputFeature: () => ({
    emptyStateLayout: testState.emptyStateLayout,
    showUsageAdvisory: testState.showUsageAdvisory,
    maxFiles: 5,
  }),
  useChatSharingFeature: () => ({ enabled: false }),
  usePinnedChatsFeature: () => ({ enabled: false, maxItems: 5 }),
  useSidebarFeature: () => ({ chatHistoryShowMetadata: false }),
  useAssistantsFeature: () => ({ enabled: true, delegationEnabled: true }),
}));

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  chatMessagesQuery: vi.fn(() => ({ queryKey: ["chatMessages"] })),
  useRecentChats: vi.fn(() => ({ data: undefined, isLoading: false })),
}));

const backgroundRun = (id: string) =>
  ({
    id,
    title_resolved: id,
    can_edit: false,
    file_uploads: [],
    is_pinned: false,
    last_message_at: "2026-08-19T12:00:00.000Z",
    assistant_id: "assistant-1",
    assistant_name: "Research Assistant",
    provenance_kind: "delegation",
    provenance_run_mode: "background",
    origin_chat_id: "origin-1",
  }) as RecentChat;

const mockRuns = (chats: RecentChat[]) => {
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
    isLoading: false,
  });
};

const chatTree = (props: Partial<Parameters<typeof Chat>[0]> = {}) => (
  <I18nProvider i18n={i18n}>
    <MemoryRouter>
      <Chat messages={{}} messageOrder={[]} controlsContext={{}} {...props} />
    </MemoryRouter>
  </I18nProvider>
);

const renderChat = (props: Partial<Parameters<typeof Chat>[0]> = {}) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={queryClient}>
      {chatTree(props)}
    </QueryClientProvider>,
  );
  return {
    ...result,
    rerenderChat: (nextProps: Partial<Parameters<typeof Chat>[0]> = {}) => {
      result.rerender(
        <QueryClientProvider client={queryClient}>
          {chatTree(nextProps)}
        </QueryClientProvider>,
      );
    },
  };
};

const welcome = <div data-testid="welcome-stub">Welcome</div>;
const supplementary = <div data-testid="below-stub">More</div>;
const firstMessage = {
  messages: {
    "user-1": {
      id: "user-1",
      content: [],
      role: "user" as const,
      sender: "user" as const,
      authorId: "user-1",
      createdAt: "2026-08-25T12:00:00.000Z",
      status: "complete" as const,
    },
  },
  messageOrder: ["user-1"],
};
const layoutModes = ["centered", "bottom"] as const;

describe("Chat surface composition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testState.chatContext = {};
    testState.emptyStateLayout = "bottom";
    testState.showUsageAdvisory = true;
    useGenerationStatusStore.getState().reset();
    (useRecentChats as Mock).mockReturnValue({
      data: undefined,
      isLoading: false,
    });
    i18n.load("en", enMessages as unknown as Messages);
    i18n.activate("en");
  });

  it("mounts the delegated-runs bar directly above the composer", () => {
    mockRuns([backgroundRun("run-1")]);

    const { container } = renderChat();

    const bar = container.querySelector('[data-ui="delegated-runs-section"]');
    const input = screen.getByTestId("chat-input-stub");
    expect(bar).not.toBeNull();
    // The bar precedes the composer in the same conversation column.
    expect(
      bar!.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(bar!.parentElement).toBe(input.parentElement);
    // It queries the open chat's own runs.
    expect(useRecentChats).toHaveBeenCalledWith({
      queryParams: {
        origin_chat_id: "origin-1",
        include_delegated: true,
        limit: 50,
      },
    });
  });

  it("mounts no bar while the chat has no background runs", () => {
    mockRuns([]);

    const { container } = renderChat();

    expect(
      container.querySelector('[data-ui="delegated-runs-section"]'),
    ).toBeNull();
    expect(screen.getByTestId("chat-input-stub")).toBeInTheDocument();
  });

  it("disables the composer after a prompt injection guardrail blocks the last message", () => {
    mockRuns([]);

    renderChat({
      messages: {
        "assistant-error": {
          id: "assistant-error",
          content: [],
          role: "assistant",
          sender: "assistant",
          authorId: "assistant-1",
          createdAt: "2026-08-25T12:00:00.000Z",
          status: "error",
          error: {
            error_type: "content_filter",
            error_description: "blocked",
            filter_details: {
              pattern_id: "ignore-previous-instructions",
              matched_text: "Ignore previous instructions",
            },
          },
        },
      },
      messageOrder: ["assistant-error"],
    });

    expect(screen.getByTestId("chat-input-stub")).toHaveAttribute(
      "data-disabled",
      "true",
    );
  });

  it("does not disable the composer for a non-prompt content filter", () => {
    mockRuns([]);

    renderChat({
      messages: {
        "assistant-error": {
          id: "assistant-error",
          content: [],
          role: "assistant",
          sender: "assistant",
          authorId: "assistant-1",
          createdAt: "2026-08-25T12:00:00.000Z",
          status: "error",
          error: {
            error_type: "content_filter",
            error_description: "filtered",
            filter_details: {
              sexual: { filtered: true, severity: "high" },
            },
          },
        },
      },
      messageOrder: ["assistant-error"],
    });

    expect(screen.getByTestId("chat-input-stub")).toHaveAttribute(
      "data-disabled",
      "false",
    );
  });

  it("mounts neither the bar nor the composer in read-only mode", () => {
    mockRuns([backgroundRun("run-1")]);

    const { container } = renderChat({ readOnly: true });

    expect(
      container.querySelector('[data-ui="delegated-runs-section"]'),
    ).toBeNull();
    expect(screen.queryByTestId("chat-input-stub")).toBeNull();
  });
});

describe("Chat empty-state shell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testState.chatContext = {};
    testState.emptyStateLayout = "centered";
    testState.showUsageAdvisory = true;
    useGenerationStatusStore.getState().reset();
    mockRuns([]);
    i18n.load("en", enMessages as unknown as Messages);
    i18n.activate("en");
  });

  const shell = (container: HTMLElement, hook: string) =>
    container.querySelector(`[data-ui="${hook}"]`);

  it("centers the welcome by default and swaps to the bottom shell when configured", () => {
    const { container, rerenderChat } = renderChat({
      emptyStateComponent: welcome,
    });

    expect(shell(container, "chat-empty-state-centered-shell")).not.toBeNull();
    expect(screen.getByTestId("welcome-stub")).toBeInTheDocument();
    expect(screen.queryByTestId("message-list-stub")).toBeNull();

    testState.emptyStateLayout = "bottom";
    rerenderChat({ emptyStateComponent: welcome });

    expect(shell(container, "chat-empty-state-bottom-shell")).not.toBeNull();
    expect(shell(container, "chat-empty-state-centered-shell")).toBeNull();
    expect(screen.getByTestId("welcome-stub")).toBeInTheDocument();
    expect(screen.queryByTestId("message-list-stub")).toBeNull();
  });

  it.each(layoutModes)(
    "keeps the same composer node and draft through pending and first message (%s)",
    (mode) => {
      testState.emptyStateLayout = mode;
      const { container, rerenderChat } = renderChat({
        emptyStateComponent: welcome,
      });
      const textbox = screen.getByTestId("chat-input-stub");
      fireEvent.change(textbox, { target: { value: "draft in progress" } });

      testState.chatContext = { isPendingResponse: true };
      rerenderChat({ emptyStateComponent: welcome });
      expect(screen.queryByTestId("welcome-stub")).toBeNull();
      expect(screen.getByTestId("message-list-stub")).toBeInTheDocument();
      expect(screen.getByTestId("chat-input-stub")).toBe(textbox);

      testState.chatContext = {};
      rerenderChat({ emptyStateComponent: welcome, ...firstMessage });
      expect(shell(container, "chat-conversation-shell")).not.toBeNull();
      expect(screen.getByTestId("message-list-stub")).toBeInTheDocument();
      expect(screen.getByTestId("chat-input-stub")).toBe(textbox);
      expect((textbox as HTMLTextAreaElement).value).toBe("draft in progress");
    },
  );

  it.each(layoutModes)(
    "renders the usage advisory once, in the row below the composer (%s)",
    (mode) => {
      testState.emptyStateLayout = mode;
      const { container } = renderChat({ emptyStateComponent: welcome });

      const advisories = container.querySelectorAll(
        '[data-ui="chat-usage-advisory"]',
      );
      expect(advisories).toHaveLength(1);
      expect(advisories[0].closest('[data-ui="welcome-below"]')).not.toBeNull();
      expect(
        screen
          .getByTestId("chat-input-stub")
          .closest('[data-ui="composer-cluster"]'),
      ).not.toBeNull();
    },
  );

  it("omits the advisory when the feature is off", () => {
    testState.showUsageAdvisory = false;
    const { container } = renderChat({ emptyStateComponent: welcome });

    expect(
      container.querySelector('[data-ui="chat-usage-advisory"]'),
    ).toBeNull();
  });

  it("places supplementary content after the advisory in centered mode", () => {
    const { container } = renderChat({
      emptyStateComponent: welcome,
      emptyStateBelowComponent: supplementary,
    });

    const below = shell(container, "welcome-below")!;
    const advisory = below.querySelector('[data-ui="chat-usage-advisory"]')!;
    const extra = screen.getByTestId("below-stub");
    expect(below.contains(extra)).toBe(true);
    expect(
      advisory.compareDocumentPosition(extra) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(shell(container, "welcome-above")!.contains(extra)).toBe(false);
  });

  it("places supplementary content after the welcome, above the composer, in bottom mode", () => {
    testState.emptyStateLayout = "bottom";
    const { container } = renderChat({
      emptyStateComponent: welcome,
      emptyStateBelowComponent: supplementary,
    });

    const above = shell(container, "welcome-above")!;
    const extra = screen.getByTestId("below-stub");
    expect(above.contains(extra)).toBe(true);
    expect(
      screen.getByTestId("welcome-stub").compareDocumentPosition(extra) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(shell(container, "welcome-below")!.contains(extra)).toBe(false);
  });

  it("drops supplementary content once messages exist", () => {
    renderChat({
      emptyStateComponent: welcome,
      emptyStateBelowComponent: supplementary,
      ...firstMessage,
    });

    expect(screen.queryByTestId("below-stub")).toBeNull();
    expect(screen.queryByTestId("welcome-stub")).toBeNull();
  });

  it("renders a read-only forced-centered state without composer or advisory", () => {
    testState.emptyStateLayout = "bottom";
    const { container } = renderChat({
      emptyStateComponent: welcome,
      forceCenteredEmptyState: true,
      readOnly: true,
    });

    expect(shell(container, "chat-empty-state-centered-shell")).not.toBeNull();
    expect(screen.getByTestId("welcome-stub")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-input-stub")).toBeNull();
    expect(
      container.querySelector('[data-ui="chat-usage-advisory"]'),
    ).toBeNull();
  });
});
