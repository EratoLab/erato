import { componentRegistry } from "@erato/frontend/library";
import { i18n } from "@lingui/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NEUTRAL_CURRENT_CHAT_KEY } from "../../core/AddinChatProviderCore";
import {
  MOCK_TEAMS_LOGIN_HINT,
  createMockTeamsContext,
  installMockNestedAppAuthBridge,
  uninstallMockNestedAppAuthBridge,
} from "../../test/mocks/teams/context";
import TeamsApp from "../TeamsApp";
import { TEAMS_CURRENT_CHAT_KEY } from "../teamsSession";

import type { LoginHintResolver } from "../../core/auth/AuthSource";
import type { ChatContextValue } from "@erato/frontend/library";
import type { ReactNode } from "react";

const spies = vi.hoisted(() => ({
  callLog: [] as string[],
  initialize: vi.fn(),
  getContext: vi.fn(),
  notifySuccess: vi.fn(),
  notifyFailure: vi.fn(),
  isNAAChannelRecommended: vi.fn(() => false),
  themeHandlers: [] as ((theme: string) => void)[],
  setSystemThemeOverride: vi.fn(),
  createEntraNaaAuthSource: vi.fn(),
  sessionAuthSource: vi.fn(),
  usePersistedState: vi.fn(),
  messagingStore: {
    abortActiveSSE: vi.fn(),
    clearUserMessages: vi.fn(),
    resetStreaming: vi.fn(),
    setNavigationTransition: vi.fn(),
  },
  chatListSelf: vi.fn(),
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
    clearNewlyCreatedChatId: vi.fn(),
  })),
}));

vi.mock("@microsoft/teams-js", () => ({
  app: {
    FailedReason: {
      AuthFailed: "AuthFailed",
      Timeout: "Timeout",
      Other: "Other",
    },
    initialize: spies.initialize,
    getContext: () => {
      spies.callLog.push("app.getContext");
      return spies.getContext();
    },
    registerOnThemeChangeHandler: (handler: (theme: string) => void) => {
      spies.themeHandlers.push(handler);
    },
    notifySuccess: spies.notifySuccess,
    notifyFailure: spies.notifyFailure,
  },
  nestedAppAuth: {
    isNAAChannelRecommended: spies.isNAAChannelRecommended,
  },
}));

vi.mock("../../auth/EntraNaaAuthSource", () => ({
  createEntraNaaAuthSource: (options: {
    resolveLoginHint: LoginHintResolver;
  }) => {
    spies.callLog.push("createEntraNaaAuthSource");
    spies.createEntraNaaAuthSource(options);
    return {
      mode: "entra-msal",
      initialize: vi.fn(async () => undefined),
      acquireBootstrapToken: vi.fn(async () => ({ idToken: "id-token" })),
      acquireGraphToken: vi.fn(),
    };
  },
}));

vi.mock("../../core/SessionAuthProvider", () => ({
  SessionAuthProvider: ({
    authSource,
    children,
  }: {
    authSource: unknown;
    children?: ReactNode;
  }) => {
    spies.sessionAuthSource(authSource);
    return children;
  },
  useSessionAuth: () => ({
    isInitialized: true,
    isAuthenticated: true,
    retryAuthentication: () => Promise.resolve(),
    error: null,
  }),
  useSessionRedeem: () => ({
    redeemSessionForToken: vi.fn(),
    lastRedeemedAtRef: { current: Number.MAX_SAFE_INTEGER },
  }),
}));

vi.mock("../hooks/useTeamsChatList", () => ({
  useTeamsChatList: (_fetcher: unknown, self: unknown) => {
    spies.chatListSelf(self);
    return {
      chats: [],
      chatsById: new Map(),
      isLoading: false,
      error: null,
      hasMore: false,
      loadMore: vi.fn(),
      reload: vi.fn(),
    };
  },
}));

vi.mock("../../core/AddinChatInputCore", () => ({
  AddinChatInputCore: () => <div data-testid="teams-chat-input" />,
}));
vi.mock("../../core/AddinSettingsDialogCore", () => ({
  AddinSettingsDialogCore: () => null,
}));

vi.mock("@erato/frontend/library", async () => {
  const { createContext, useContext, useState } = await import("react");
  const ChatContext = createContext<ChatContextValue | null>(null);
  const passthrough = ({ children }: { children?: ReactNode }) => children;

  return {
    ApiProvider: passthrough,
    DesktopSidecarProvider: passthrough,
    FeatureConfigProvider: passthrough,
    FileCapabilitiesProvider: passthrough,
    GenerationStatusPoller: () => null,
    I18nProvider: passthrough,
    ProfileProvider: passthrough,
    ThemeProvider: passthrough,
    Toaster: () => null,
    DelegatedRunsSection: () => null,
    useDelegatedRunHeader: () => ({ header: null, composerLocked: false }),
    toast: {
      info: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    },
    createBrowserClientInfo: (info: unknown) => info,
    useTheme: () => ({
      setSystemThemeOverride: spies.setSystemThemeOverride,
    }),

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
    useFeatureConfig: () => ({
      upload: { maxSizeBytes: 10 * 1024 * 1024 },
    }),
    useFileUploadStore: (
      selector: (state: { silentChatId: string | null }) => unknown,
    ) => selector({ silentChatId: null }),
    useMessagingStore: Object.assign(() => spies.messagingStore, {
      getState: () => spies.messagingStore,
    }),
    useModelHistory: () => ({ currentChatLastModel: null }),
    usePersistedState: <T,>(key: string, initialValue: T) => {
      spies.usePersistedState(key);
      return useState(initialValue);
    },
    useRecentChats: () => ({
      data: { chats: [] },
      isLoading: false,
      error: null,
      refetch: vi.fn(async () => undefined),
    }),

    ChatErrorBoundary: passthrough,
    ChatInputControlsProvider: passthrough,
    ChatMessage: () => null,
    DefaultMessageControls: () => null,
    DocumentIcon: () => null,
    DropdownMenu: () => null,
    FeedbackCommentDialog: () => null,
    FeedbackViewDialog: () => null,
    FilePreviewModal: () => null,
    MessageList: () => <div data-testid="teams-message-list" />,
    MessageEditProvider: passthrough,
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

describe("Teams personal tab composition", () => {
  const originalOffice = Object.getOwnPropertyDescriptor(globalThis, "Office");

  beforeEach(() => {
    i18n.activate("en");
    Reflect.deleteProperty(globalThis, "Office");
    spies.callLog.length = 0;
    spies.themeHandlers.length = 0;
    spies.getContext.mockResolvedValue(createMockTeamsContext());
    spies.initialize.mockImplementation(() => {
      spies.callLog.push("app.initialize");
      return Promise.resolve();
    });
    spies.notifySuccess.mockResolvedValue({ hasFinishedSuccessfully: true });
    installMockNestedAppAuthBridge();
  });

  afterEach(() => {
    cleanup();
    uninstallMockNestedAppAuthBridge();
    vi.clearAllMocks();
    if (originalOffice) {
      Object.defineProperty(globalThis, "Office", originalOffice);
    }
  });

  const renderTab = () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <TeamsApp />
      </QueryClientProvider>,
    );
  };

  it("renders the neutral chat surface with no Office global and no office.js script", async () => {
    const appendChild = vi.spyOn(document.head, "appendChild");

    renderTab();

    expect(await screen.findByTestId("teams-message-list")).toBeInTheDocument();
    expect(screen.getByTestId("teams-chat-input")).toBeInTheDocument();
    expect(screen.getByText("New Chat")).toBeInTheDocument();
    expect(globalThis).not.toHaveProperty("Office");
    expect(
      appendChild.mock.calls.some(
        ([node]) =>
          node instanceof HTMLScriptElement &&
          URL.canParse(node.src) &&
          new URL(node.src).hostname === "appsforoffice.microsoft.com",
      ),
    ).toBe(false);
  });

  it("stamps the teams platform on messaging", async () => {
    renderTab();
    await screen.findByTestId("teams-message-list");

    expect(spies.useChatMessaging).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "teams" }),
    );
  });

  it("installs only the Teams contributions, so no Outlook affordances appear", async () => {
    renderTab();
    await screen.findByTestId("teams-message-list");

    expect(Object.keys(componentRegistry)).toEqual([
      "ChatAddMenuExtraContent",
      "ChatAttachmentsPreview",
    ]);
  });

  it("selects chats under the Teams storage key, never the neutral one", async () => {
    renderTab();
    await screen.findByTestId("teams-message-list");

    const keys = spies.usePersistedState.mock.calls.map(([key]) => key);
    expect(keys).toContain(TEAMS_CURRENT_CHAT_KEY);
    expect(keys).not.toContain(NEUTRAL_CURRENT_CHAT_KEY);
  });

  it("builds no auth source at all until the TeamsJS handshake resolves", async () => {
    let completeHandshake: () => void = () => undefined;
    spies.initialize.mockImplementation(() => {
      spies.callLog.push("app.initialize");
      return new Promise<void>((resolve) => {
        completeHandshake = resolve;
      });
    });

    renderTab();

    expect(
      await screen.findByText("Loading Microsoft Teams tab..."),
    ).toBeInTheDocument();
    expect(spies.sessionAuthSource).not.toHaveBeenCalled();
    expect(spies.createEntraNaaAuthSource).not.toHaveBeenCalled();

    await act(async () => {
      completeHandshake();
    });

    expect(await screen.findByTestId("teams-message-list")).toBeInTheDocument();
    expect(spies.sessionAuthSource).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "entra-msal" }),
    );
    expect(spies.callLog.indexOf("createEntraNaaAuthSource")).toBeGreaterThan(
      spies.callLog.indexOf("app.getContext"),
    );
  });

  it("takes the login hint from the Teams context", async () => {
    renderTab();
    await screen.findByTestId("teams-message-list");

    const options = spies.createEntraNaaAuthSource.mock.calls.at(0)?.at(0) as
      | { resolveLoginHint: LoginHintResolver }
      | undefined;
    await expect(options?.resolveLoginHint()).resolves.toBe(
      MOCK_TEAMS_LOGIN_HINT,
    );
  });

  it("falls back to the unsupported source when the NAA bridge is absent", async () => {
    uninstallMockNestedAppAuthBridge();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    renderTab();
    await screen.findByTestId("teams-message-list");

    expect(spies.createEntraNaaAuthSource).not.toHaveBeenCalled();
    expect(spies.sessionAuthSource).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "unsupported" }),
    );
    // The warning comes from a passive effect, which can still be pending when
    // the message list is already in the DOM.
    await waitFor(() => {
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("nested app auth bridge"),
        expect.objectContaining({ hostName: "Teams", hostClientType: "web" }),
      );
    });
  });

  it("identifies the viewer by Entra object id, not just the login hint", async () => {
    renderTab();
    await screen.findByTestId("teams-message-list");

    expect(spies.chatListSelf).toHaveBeenCalledWith({
      userId: "00000000-0000-0000-0000-000000000001",
      userPrincipalName: MOCK_TEAMS_LOGIN_HINT,
    });
  });

  it("maps host themes onto the system theme override", async () => {
    renderTab();
    await screen.findByTestId("teams-message-list");

    // Set from a passive effect, which can still be pending here.
    await waitFor(() =>
      expect(spies.setSystemThemeOverride).toHaveBeenLastCalledWith("light"),
    );

    act(() => {
      spies.themeHandlers.forEach((handler) => handler("contrast"));
    });

    expect(spies.setSystemThemeOverride).toHaveBeenLastCalledWith("dark");
  });

  it("notifies the host once the tab has loaded", async () => {
    renderTab();
    await screen.findByTestId("teams-message-list");

    expect(spies.notifySuccess).toHaveBeenCalled();
    expect(spies.notifyFailure).not.toHaveBeenCalled();
  });

  it("keeps a loaded tab alive when the host rejects the load notification", async () => {
    spies.notifySuccess.mockRejectedValue(new Error("host said no"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    renderTab();
    await screen.findByTestId("teams-message-list");
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("teams-message-list")).toBeInTheDocument();
    expect(
      screen.queryByText("Could not connect to Microsoft Teams."),
    ).not.toBeInTheDocument();
    expect(spies.notifyFailure).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "Teams notifySuccess failed",
      expect.any(Error),
    );
  });

  it("reports a failed handshake to the host instead of showing a dead frame", async () => {
    spies.initialize.mockRejectedValue(new Error("host handshake refused"));

    renderTab();

    expect(
      await screen.findByText("Could not connect to Microsoft Teams."),
    ).toBeInTheDocument();
    expect(spies.notifyFailure).toHaveBeenCalledWith({
      reason: "Other",
      message: "host handshake refused",
    });
    expect(spies.createEntraNaaAuthSource).not.toHaveBeenCalled();
  });
});
