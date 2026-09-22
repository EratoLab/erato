import { componentRegistry } from "@erato/frontend/library";
import { i18n } from "@lingui/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NEUTRAL_CURRENT_CHAT_KEY } from "../../core/AddinChatProviderCore";
import {
  installMockWordDocument,
  uninstallMockWordDocument,
} from "../../test/mocks/word/document";
import WordApp from "../WordApp";
import { WORD_CURRENT_CHAT_KEY } from "../wordSession";

import type { LoginHintResolver } from "../../core/auth/AuthSource";
import type { MockWordHost } from "../../test/mocks/word/document";
import type { ChatContextValue } from "@erato/frontend/library";
import type { ReactNode } from "react";

const spies = vi.hoisted(() => ({
  callLog: [] as string[],
  setSystemThemeOverride: vi.fn(),
  createEntraNaaAuthSource: vi.fn(),
  sessionAuthSource: vi.fn(),
  usePersistedState: vi.fn(),
  unarchiveChat: vi.fn(async () => undefined),
  updateChatTitle: vi.fn(async () => undefined),
  messagingStore: {
    abortActiveSSE: vi.fn(),
    clearUserMessages: vi.fn(),
    resetStreaming: vi.fn(),
    setNavigationTransition: vi.fn(),
  },
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

vi.mock("../../core/AddinChatInputCore", () => ({
  AddinChatInputCore: () => <div data-testid="word-chat-input" />,
}));
vi.mock("../../core/AddinSettingsDialogCore", () => ({
  AddinSettingsDialogCore: () => null,
}));
vi.mock("../../core/AddinHistoryDrawerCore", () => ({
  AddinHistoryDrawerCore: () => null,
}));

vi.mock("@erato/frontend/library", async () => {
  const { createContext, useContext, useState } = await import("react");
  const mock = await import("../../test/helpers/eratoLibraryMock");
  const ChatContext = createContext<ChatContextValue | null>(null);

  return mock.createEratoLibraryMock({
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

    useChatMessaging: spies.useChatMessaging,
    useFeatureConfig: () => ({
      upload: { maxSizeBytes: 10 * 1024 * 1024 },
    }),
    useUploadFeature: () => ({
      enabled: true,
      maxSizeBytes: 10 * 1024 * 1024,
      maxSizeFormatted: "10 MB",
    }),
    useMessagingStore: Object.assign(() => spies.messagingStore, {
      getState: () => spies.messagingStore,
    }),
    usePersistedState: <T,>(key: string, initialValue: T) => {
      spies.usePersistedState(key);
      return useState(initialValue);
    },
    useUnarchiveChat: () => spies.unarchiveChat,
    useUpdateChatTitle: () => spies.updateChatTitle,

    MessageList: () => <div data-testid="word-message-list" />,
  });
});

describe("Word task pane composition", () => {
  let word: MockWordHost;

  beforeEach(() => {
    i18n.activate("en");
    spies.callLog.length = 0;
    word = installMockWordDocument();
    word.onReady.mockImplementation(
      (): Promise<{ host: string; platform: string }> => {
        spies.callLog.push("Office.onReady");
        return Promise.resolve({ host: "Word", platform: "OfficeOnline" });
      },
    );
  });

  afterEach(() => {
    cleanup();
    uninstallMockWordDocument();
    vi.clearAllMocks();
  });

  const renderPane = () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <WordApp />
      </QueryClientProvider>,
    );
  };

  it("renders the chat surface and loads no office.js from the CDN", async () => {
    const appendChild = vi.spyOn(document.head, "appendChild");

    renderPane();

    expect(await screen.findByTestId("word-message-list")).toBeInTheDocument();
    expect(screen.getByTestId("word-chat-input")).toBeInTheDocument();
    expect(
      screen.getByTestId("addin-history-drawer-trigger"),
    ).toBeInTheDocument();
    expect(
      appendChild.mock.calls.some(
        ([node]) =>
          node instanceof HTMLScriptElement &&
          URL.canParse(node.src) &&
          new URL(node.src).hostname === "appsforoffice.microsoft.com",
      ),
    ).toBe(false);
  });

  it("stamps the word platform on messaging", async () => {
    renderPane();
    await screen.findByTestId("word-message-list");

    expect(spies.useChatMessaging).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "word" }),
    );
  });

  it("contributes exactly one registry slot, and no slot another host claims", async () => {
    renderPane();
    await screen.findByTestId("word-message-list");

    expect(Object.keys(componentRegistry)).toEqual(["HostCardCodeBlock"]);
  });

  it("selects chats under the Word storage key, never the neutral one", async () => {
    renderPane();
    await screen.findByTestId("word-message-list");

    const keys = spies.usePersistedState.mock.calls.map(([key]) => key);
    expect(keys).toContain(WORD_CURRENT_CHAT_KEY);
    expect(keys).not.toContain(NEUTRAL_CURRENT_CHAT_KEY);
  });

  it("waits for office.js before building the auth source", async () => {
    renderPane();
    await screen.findByTestId("word-message-list");

    expect(spies.sessionAuthSource).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "entra-msal" }),
    );
    expect(spies.callLog.indexOf("createEntraNaaAuthSource")).toBeGreaterThan(
      spies.callLog.indexOf("Office.onReady"),
    );
  });

  it("takes the login hint from the Office auth context, with no mailbox fallback", async () => {
    (Office as unknown as Record<string, unknown>).auth = {
      getAuthContext: () =>
        Promise.resolve({ userPrincipalName: "erato.user@contoso.test" }),
    };

    renderPane();
    await screen.findByTestId("word-message-list");

    const options = spies.createEntraNaaAuthSource.mock.calls.at(0)?.at(0) as
      | { resolveLoginHint: LoginHintResolver }
      | undefined;
    await expect(options?.resolveLoginHint()).resolves.toBe(
      "erato.user@contoso.test",
    );

    delete (Office as unknown as Record<string, unknown>).auth;
  });

  it("resolves no login hint when the host exposes no auth context", async () => {
    renderPane();
    await screen.findByTestId("word-message-list");

    const options = spies.createEntraNaaAuthSource.mock.calls.at(0)?.at(0) as
      | { resolveLoginHint: LoginHintResolver }
      | undefined;
    await expect(options?.resolveLoginHint()).resolves.toBeUndefined();
  });

  it("falls back to the unsupported source when the host reports no NAA", async () => {
    word.isSetSupported.mockImplementation(
      (name: string) => name !== "NestedAppAuth",
    );

    renderPane();
    await screen.findByTestId("word-message-list");

    expect(spies.createEntraNaaAuthSource).not.toHaveBeenCalled();
    expect(spies.sessionAuthSource).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "unsupported" }),
    );
  });
});
