import { componentRegistry } from "@erato/frontend/library";
import { i18n } from "@lingui/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NEUTRAL_CURRENT_CHAT_KEY } from "../../core/AddinChatProviderCore";
import ExcelApp from "../../excel/ExcelApp";
import { EXCEL_CURRENT_CHAT_KEY } from "../../excel/excelSession";
import PowerPointApp from "../../powerpoint/PowerPointApp";
import { POWERPOINT_CURRENT_CHAT_KEY } from "../../powerpoint/powerpointSession";

import type { LoginHintResolver } from "../../core/auth/AuthSource";
import type { ChatContextValue } from "@erato/frontend/library";
import type { ReactNode } from "react";

const spies = vi.hoisted(() => ({
  callLog: [] as string[],
  createEntraNaaAuthSource: vi.fn(),
  sessionAuthSource: vi.fn(),
  proxyLogin: vi.fn(),
  usePersistedState: vi.fn(),
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
    requireBridge?: boolean;
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

vi.mock("../../core/Oauth2ProxyLoginProvider", () => ({
  Oauth2ProxyLoginProvider: ({ children }: { children?: ReactNode }) => {
    spies.proxyLogin();
    return children;
  },
}));

vi.mock("../../core/SessionAuthProvider", async () => ({
  SessionAuthContext: (await import("react")).createContext(null),
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
  AddinChatInputCore: () => <div data-testid="pane-chat-input" />,
}));
vi.mock("../../core/AddinSettingsDialogCore", () => ({
  AddinSettingsDialogCore: () => null,
}));
vi.mock("../../core/AddinHistoryDrawerCore", () => ({
  AddinHistoryDrawerCore: () => null,
}));

vi.mock("@erato/frontend/library", async () => {
  const { createContext, useContext, useState } = await import("react");
  const mock = await import("../helpers/eratoLibraryMock");
  const ChatContext = createContext<ChatContextValue | null>(null);

  return mock.createEratoLibraryMock({
    useTheme: () => ({ setSystemThemeOverride: vi.fn() }),

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
      sidebar: { chatHistoryShowMetadata: true, chatHistorySources: [] },
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
    useUnarchiveChat: () => vi.fn(async () => undefined),
    useUpdateChatTitle: () => vi.fn(async () => undefined),

    MessageList: () => <div data-testid="pane-message-list" />,
  });
});

describe.each([
  {
    host: "Excel",
    platform: "excel",
    App: ExcelApp,
    storageKey: EXCEL_CURRENT_CHAT_KEY,
    otherKey: POWERPOINT_CURRENT_CHAT_KEY,
  },
  {
    host: "PowerPoint",
    platform: "powerpoint",
    App: PowerPointApp,
    storageKey: POWERPOINT_CURRENT_CHAT_KEY,
    otherKey: EXCEL_CURRENT_CHAT_KEY,
  },
])(
  "$host task pane composition",
  ({ host, platform, App, storageKey, otherKey }) => {
    beforeEach(() => {
      i18n.activate("en");
      spies.callLog.length = 0;
      const office = Office as unknown as Record<string, unknown>;
      const context = Office.context as unknown as Record<string, unknown>;
      context.requirements = { isSetSupported: () => true };
      // Bypasses the CDN script, which cannot load in jsdom.
      office.onReady = () => {
        spies.callLog.push("Office.onReady");
        return Promise.resolve({ host, platform: "OfficeOnline" });
      };
    });

    afterEach(() => {
      cleanup();
      const office = Office as unknown as Record<string, unknown>;
      const context = Office.context as unknown as Record<string, unknown>;
      delete context.requirements;
      delete office.onReady;
      vi.clearAllMocks();
    });

    const renderPane = async () => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      render(
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>,
      );
      // The pane remounts once when the sign-in probe settles on a path.
      await waitFor(() =>
        expect(
          spies.sessionAuthSource.mock.calls.length +
            spies.proxyLogin.mock.calls.length,
        ).toBeGreaterThan(0),
      );
      await screen.findByTestId("pane-message-list");
    };

    it("renders the neutral chat surface", async () => {
      await renderPane();

      expect(screen.getByTestId("pane-message-list")).toBeInTheDocument();
      expect(screen.getByTestId("pane-chat-input")).toBeInTheDocument();
    });

    it("stamps its own platform on messaging", async () => {
      await renderPane();

      expect(spies.useChatMessaging).toHaveBeenCalledWith(
        expect.objectContaining({ platform }),
      );
    });

    it("contributes nothing to the component registry", async () => {
      await renderPane();

      expect(Object.keys(componentRegistry)).toEqual([]);
    });

    it("keeps its chat selection under its own key", async () => {
      await renderPane();

      const keys = spies.usePersistedState.mock.calls.map(([key]) => key);
      expect(keys).toContain(storageKey);
      expect(keys).not.toContain(otherKey);
      expect(keys).not.toContain(NEUTRAL_CURRENT_CHAT_KEY);
    });

    it("signs in through NAA once office.js is ready", async () => {
      await renderPane();

      expect(spies.callLog).toContain("Office.onReady");
      expect(spies.sessionAuthSource).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "entra-msal" }),
      );
      expect(spies.createEntraNaaAuthSource).toHaveBeenCalledWith(
        expect.objectContaining({ requireBridge: true }),
      );
      expect(spies.proxyLogin).not.toHaveBeenCalled();
      expect(spies.callLog.indexOf("createEntraNaaAuthSource")).toBeGreaterThan(
        spies.callLog.indexOf("Office.onReady"),
      );
    });
  },
);
