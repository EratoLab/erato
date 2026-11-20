import {
  ChatContextProviders,
  ChatMessage,
  FeatureConfigProvider,
  FileCapabilitiesProvider,
  ProfileProvider,
  ThemeProvider,
  componentRegistry,
} from "@erato/frontend/library";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import retryAccepted from "../../../../frontend/src/lib/wordReview/__tests__/fixtures/history-retry-accepted.json";
import { SHARED_ADDIN_FEATURE_CONFIG } from "../../core/SharedAddinShell";
import {
  AddinHistoryFilterStoreContext,
  getAddinChatHistoryFilterStore,
} from "../../core/addinChatHistoryFilterStore";
import {
  installMockWordDocument,
  uninstallMockWordDocument,
} from "../../test/mocks/word/document";
import { WordAddinChat } from "../WordAddinChat";
import { wordContextStore } from "../hooks/wordContextStore";
import { installWordComponentRegistrations } from "../installWordComponentRegistrations";

import type {
  ChatContextValue,
  ChatMessageProps,
} from "@erato/frontend/library";
import type { ReactNode } from "react";

interface Fiber {
  tag: number;
  type: unknown;
  memoizedProps: Record<string, unknown> | null;
  child: Fiber | null;
  sibling: Fiber | null;
  return: Fiber | null;
}

const CONTEXT_PROVIDER_TAG = 10;
const FINISHED_ROW = "a0";

// React hands every committed fiber tree to the DevTools hook, which has to
// exist before react-dom loads. A context whose value changes above the rows
// makes React search every row below it on each token, which no render count
// shows.
const commits = vi.hoisted(() => {
  const state = {
    injected: false,
    watching: false,
    previous: null as { context: unknown; value: unknown }[] | null,
    changedAboveRows: [] as string[],
  };
  const nameOf = (fiber: Fiber) => {
    const type = fiber.type as { displayName?: string; name?: string } | null;
    return typeof fiber.type === "function"
      ? (type?.displayName ?? type?.name)
      : undefined;
  };
  const findRow = (root: Fiber): Fiber | null => {
    const stack: Fiber[] = [root];
    while (stack.length > 0) {
      const fiber = stack.pop()!;
      if (fiber.memoizedProps?.messageId === FINISHED_ROW) return fiber;
      for (let child = fiber.child; child; child = child.sibling)
        stack.push(child);
    }
    return null;
  };
  (globalThis as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject: () => {
      state.injected = true;
      return 1;
    },
    checkDCE: () => {},
    onScheduleFiberRoot: () => {},
    onCommitFiberUnmount: () => {},
    onPostCommitFiberRoot: () => {},
    onCommitFiberRoot: (_renderer: number, root: { current: Fiber }) => {
      if (!state.watching) return;
      const row = findRow(root.current);
      if (!row) return;
      const providers: { context: unknown; value: unknown; owner?: string }[] =
        [];
      let owner: string | undefined;
      for (let fiber = row.return; fiber; fiber = fiber.return) {
        if (fiber.tag === CONTEXT_PROVIDER_TAG) {
          providers.push({
            context: fiber.type,
            value: fiber.memoizedProps?.value,
            owner,
          });
        }
        owner = nameOf(fiber) ?? owner;
      }
      const previous = state.previous;
      if (previous?.length === providers.length) {
        providers.forEach((provider, index) => {
          if (
            previous[index].context === provider.context &&
            !Object.is(previous[index].value, provider.value)
          ) {
            state.changedAboveRows.push(
              `the context right above ${provider.owner ?? "the row"}`,
            );
          }
        });
      }
      state.previous = providers;
    },
  };
  return state;
});

const rendered = vi.hoisted(() => ({ rows: [] as string[] }));

// One object, as the query cache returns it.
const FACETS = vi.hoisted(() => ({
  data: {
    action_facets: [
      {
        id: "word_document_authoring",
        display_name: "Write",
        client_actions: ["word.apply_document_plan"],
        presentation: "auto_prompt",
      },
    ],
  },
}));

vi.mock("@erato/frontend/library", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useFacets: () => FACETS,
}));

function CountingRenderer(props: ChatMessageProps) {
  rendered.rows.push(props.message.id);
  return <ChatMessage {...props} />;
}

type TestMessage = Record<string, unknown> & { id: string };

const TURNS = 6;
const LIVE_ID = "a-live";
const [fixtureUser, fixtureAnswer] = (
  retryAccepted as unknown as { messages: TestMessage[] }
).messages;

const clone = (message: TestMessage): TestMessage =>
  JSON.parse(JSON.stringify(message)) as TestMessage;

// Each turn is a Word request answered with an accepted plan, so every
// finished row carries the pane's plan card.
const finishedChat = () => {
  const messages: Record<string, TestMessage> = {};
  const order: string[] = [];
  for (let turn = 0; turn <= TURNS; turn++) {
    const user = clone(fixtureUser);
    user.id = `u${turn}`;
    user.createdAt = new Date(Date.UTC(2026, 0, 1, 0, turn * 2)).toISOString();
    if (turn > 0) user.previous_message_id = `a${turn - 1}`;
    messages[user.id] = { ...user, sender: "user", authorId: "user_id" };
    order.push(user.id);
    if (turn === TURNS) break;
    const answer = clone(fixtureAnswer);
    answer.id = `a${turn}`;
    answer.previous_message_id = user.id;
    answer.createdAt = new Date(
      Date.UTC(2026, 0, 1, 0, turn * 2 + 1),
    ).toISOString();
    answer.updatedAt = answer.createdAt;
    messages[answer.id] = {
      ...answer,
      sender: "assistant",
      authorId: "assistant_id",
    };
    order.push(answer.id);
  }
  order.push(LIVE_ID);
  return { messages, order };
};

const liveAnswer = (chunk: number): TestMessage => ({
  id: LIVE_ID,
  role: "assistant",
  sender: "assistant",
  authorId: "assistant_id",
  status: "sending",
  content: [
    {
      content_type: "reasoning",
      text: `**Compare**\n\nNow I compare${" the totals".repeat(chunk + 1)}`,
    },
  ],
  createdAt: new Date(Date.UTC(2026, 0, 2)).toISOString(),
  previous_message_id: `u${TURNS}`,
  loading: { state: "typing" },
});

const pending = () => Promise.resolve(undefined as never);
const ignore = () => {};
const NONE: never[] = [];

// Shaped as AddinChatProviderCore hands it over while a reply streams: a new
// value per chunk, its callbacks and the finished messages and order kept.
const chatValue = (
  messages: Record<string, TestMessage>,
  order: string[],
): ChatContextValue =>
  ({
    chats: NONE,
    pinnedChats: NONE,
    currentChatId: "chat-1",
    isHistoryLoading: false,
    historyError: null,
    createNewChat: pending,
    archiveChat: pending,
    unarchiveChat: pending,
    updateChatTitle: pending,
    pinChat: pending,
    navigateToChat: ignore,
    refetchHistory: pending,
    fetchNextHistoryPage: pending,
    hasNextHistoryPage: false,
    isFetchingNextHistoryPage: false,
    messages,
    messageOrder: order,
    isStreaming: true,
    isPendingResponse: true,
    isFinalizing: false,
    streamingContent: messages[LIVE_ID]?.content ?? NONE,
    isMessagingLoading: false,
    messagingError: null,
    sendMessage: pending,
    editMessage: pending,
    regenerateMessage: pending,
    cancelMessage: ignore,
    refetchMessages: pending,
    uploadFiles: pending,
    isUploading: false,
    uploadError: null,
    uploadedFiles: NONE,
    clearUploadedFiles: ignore,
    isLoading: false,
    error: null,
    silentChatId: null,
    newChatCounter: 0,
    mountKey: "chat-1",
    currentChatLastModel: null,
  }) as unknown as ChatContextValue;

describe("the real Word pane while a reply streams", () => {
  beforeEach(() => {
    i18n.load("en", {});
    i18n.activate("en");
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
    installMockWordDocument([{ text: "Revenue grew." }]);
    installWordComponentRegistrations();
    (
      componentRegistry as unknown as Record<string, unknown>
    ).ChatMessageRenderer = CountingRenderer;
  });

  afterEach(() => {
    cleanup();
    uninstallMockWordDocument();
    wordContextStore.resetForTests();
    vi.unstubAllGlobals();
    for (const key of Object.keys(componentRegistry))
      delete (componentRegistry as unknown as Record<string, unknown>)[key];
  });

  it("renders only the streaming answer, with nothing above the rows changing", () => {
    const { messages: finished, order } = finishedChat();
    const stream: { push: (chunk: number) => void } = { push: () => {} };
    // The pane comes in as children, as AddinChatProviderCore receives it, so
    // only the chat value changes per chunk.
    function StreamingChat({ children }: { children: ReactNode }) {
      const [messages, setMessages] = useState(() => ({
        ...finished,
        [LIVE_ID]: liveAnswer(0),
      }));
      stream.push = (chunk) =>
        setMessages({ ...finished, [LIVE_ID]: liveAnswer(chunk) });
      return (
        <AddinHistoryFilterStoreContext.Provider
          value={getAddinChatHistoryFilterStore("word")}
        >
          <ChatContextProviders value={chatValue(messages, order)}>
            {children}
          </ChatContextProviders>
        </AddinHistoryFilterStoreContext.Provider>
      );
    }
    const { container } = render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <FeatureConfigProvider config={SHARED_ADDIN_FEATURE_CONFIG}>
          <ThemeProvider>
            <I18nProvider i18n={i18n}>
              <ProfileProvider>
                <FileCapabilitiesProvider>
                  <StreamingChat>
                    <WordAddinChat />
                  </StreamingChat>
                </FileCapabilitiesProvider>
              </ProfileProvider>
            </I18nProvider>
          </ThemeProvider>
        </FeatureConfigProvider>
      </QueryClientProvider>,
    );
    expect(commits.injected).toBe(true);
    expect(
      container.querySelectorAll(
        `[data-message-id="${FINISHED_ROW}"] [data-testid="word-document-plan-card"]`,
      ).length,
    ).toBeGreaterThan(0);

    rendered.rows.length = 0;
    commits.watching = true;
    const CHUNKS = 5;
    for (let chunk = 1; chunk <= CHUNKS; chunk++) {
      act(() => stream.push(chunk));
    }
    commits.watching = false;

    expect(rendered.rows.filter((id) => id !== LIVE_ID)).toEqual([]);
    expect(rendered.rows.filter((id) => id === LIVE_ID)).toHaveLength(CHUNKS);
    expect(commits.previous).not.toBeNull();
    expect(commits.changedAboveRows).toEqual([]);
  });
});
