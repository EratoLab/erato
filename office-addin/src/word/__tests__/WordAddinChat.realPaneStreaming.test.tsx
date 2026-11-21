import {
  ChatContext,
  ChatMessage,
  FeatureConfigProvider,
  FileCapabilitiesProvider,
  ProfileProvider,
  ThemeProvider,
  chatMessagesQuery,
  componentRegistry,
  useChatSession,
  useMessagingStore,
} from "@erato/frontend/library";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import { useContext } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import retryAccepted from "../../../../frontend/src/lib/wordReview/__tests__/fixtures/history-retry-accepted.json";
import {
  AddinChatProviderCore,
  createNeutralAddinSessionController,
} from "../../core/AddinChatProviderCore";
import { SHARED_ADDIN_FEATURE_CONFIG } from "../../core/SharedAddinShell";
import {
  installMockWordDocument,
  uninstallMockWordDocument,
} from "../../test/mocks/word/document";
import { WordAddinChat } from "../WordAddinChat";
import { wordContextStore } from "../hooks/wordContextStore";
import { installWordComponentRegistrations } from "../installWordComponentRegistrations";

import type { ChatMessageProps } from "@erato/frontend/library";

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

const rendered = vi.hoisted(() => ({
  rows: [] as string[],
  sessions: [] as Record<string, unknown>[],
  kitReads: [] as { chatId: unknown; order: unknown; text: unknown }[],
}));

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

const CHAT_ID = "chat-1";
const SESSION_KEY = "erato.addin.test.realPaneStreaming.currentChat";
const SessionController = createNeutralAddinSessionController(SESSION_KEY);

type TestMessage = Record<string, unknown> & { id: string };

const TURNS = 6;
const LIVE_ID = "a-live";
const LIVE_AT = new Date(Date.UTC(2026, 0, 2)).toISOString();
const [fixtureUser, fixtureAnswer] = (
  retryAccepted as unknown as { messages: TestMessage[] }
).messages;

// Reads the chat as a component kit written against the context does.
function CountingRenderer(props: ChatMessageProps) {
  rendered.rows.push(props.message.id);
  const chat = useContext(ChatContext);
  if (props.message.id === LIVE_ID) {
    const parts = chat?.messages[LIVE_ID]?.content as
      | { text?: string }[]
      | undefined;
    rendered.kitReads.push({
      chatId: chat?.currentChatId,
      order: chat?.messageOrder.at(-1),
      text: parts?.at(-1)?.text,
    });
  }
  return <ChatMessage {...props} />;
}

function SessionReader() {
  rendered.sessions.push(useChatSession());
  return null;
}

const apiMessage = (
  message: TestMessage,
  id: string,
  createdAt: string,
  previousId?: string,
): TestMessage => ({
  ...(JSON.parse(JSON.stringify(message)) as TestMessage),
  id,
  chat_id: CHAT_ID,
  created_at: createdAt,
  updated_at: createdAt,
  files: [],
  input_files_ids: [],
  is_message_in_active_thread: true,
  ...(previousId ? { previous_message_id: previousId } : {}),
});

// The chat as the messages endpoint returns it: each turn a Word request
// answered with an accepted plan, so every finished row carries a plan card,
// and a last request that the streamed answer replies to.
const storedChat = () => {
  const messages: TestMessage[] = [];
  for (let turn = 0; turn <= TURNS; turn++) {
    const at = (minute: number) =>
      new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();
    messages.push(
      apiMessage(
        fixtureUser,
        `u${turn}`,
        at(turn * 2),
        turn > 0 ? `a${turn - 1}` : undefined,
      ),
    );
    if (turn < TURNS)
      messages.push(
        apiMessage(fixtureAnswer, `a${turn}`, at(turn * 2 + 1), `u${turn}`),
      );
  }
  return {
    messages,
    stats: {
      total_count: messages.length,
      current_offset: 0,
      returned_count: messages.length,
      has_more: false,
    },
  };
};

const liveContent = (chunk: number) => [
  {
    content_type: "reasoning",
    text: `**Compare**\n\nNow I compare${" the totals".repeat(chunk + 1)}`,
  },
];

// What the stream handlers write: the answer starts, then every delta
// replaces the streamed content.
const streamChunk = (chunk: number) =>
  useMessagingStore.getState().setStreaming(
    chunk === 0
      ? {
          isStreaming: true,
          currentMessageId: LIVE_ID,
          content: liveContent(0) as never,
          createdAt: LIVE_AT,
        }
      : { content: liveContent(chunk) as never },
    CHAT_ID,
  );

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 404 })),
    );
    localStorage.setItem(SESSION_KEY, JSON.stringify(CHAT_ID));
    installMockWordDocument([{ text: "Revenue grew." }]);
    installWordComponentRegistrations();
    (
      componentRegistry as unknown as Record<string, unknown>
    ).ChatMessageRenderer = CountingRenderer;
  });

  afterEach(() => {
    cleanup();
    useMessagingStore.getState().clearAllStreaming();
    useMessagingStore.getState().clearAllApiMessages();
    localStorage.removeItem(SESSION_KEY);
    uninstallMockWordDocument();
    wordContextStore.resetForTests();
    vi.unstubAllGlobals();
    for (const key of Object.keys(componentRegistry))
      delete (componentRegistry as unknown as Record<string, unknown>)[key];
  });

  it("renders only the streaming answer, with the session and everything above the rows unchanged", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    queryClient.setQueryData(
      chatMessagesQuery({ pathParams: { chatId: CHAT_ID } }).queryKey,
      storedChat(),
    );
    const { container } = render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <FeatureConfigProvider config={SHARED_ADDIN_FEATURE_CONFIG}>
            <ThemeProvider>
              <I18nProvider i18n={i18n}>
                <ProfileProvider>
                  <FileCapabilitiesProvider>
                    <AddinChatProviderCore
                      platform="word"
                      SessionController={SessionController}
                    >
                      <WordAddinChat />
                      <SessionReader />
                    </AddinChatProviderCore>
                  </FileCapabilitiesProvider>
                </ProfileProvider>
              </I18nProvider>
            </ThemeProvider>
          </FeatureConfigProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await settle();
    act(() => streamChunk(0));
    await settle();
    expect(commits.injected).toBe(true);
    expect(
      container.querySelectorAll(
        `[data-message-id="${FINISHED_ROW}"] [data-testid="word-document-plan-card"]`,
      ).length,
    ).toBeGreaterThan(0);
    expect(
      container.querySelector(`[data-message-id="${LIVE_ID}"]`),
    ).not.toBeNull();

    rendered.rows.length = 0;
    rendered.kitReads.length = 0;
    const session = rendered.sessions.at(-1)!;
    rendered.sessions.length = 0;
    commits.watching = true;
    const CHUNKS = 5;
    for (let chunk = 1; chunk <= CHUNKS; chunk++) {
      act(() => streamChunk(chunk));
    }
    commits.watching = false;

    const changedSessionFields = rendered.sessions.flatMap((next) =>
      Object.keys(next).filter((key) => !Object.is(next[key], session[key])),
    );
    expect(changedSessionFields).toEqual([]);
    expect(rendered.rows.filter((id) => id !== LIVE_ID)).toEqual([]);
    expect(rendered.rows.filter((id) => id === LIVE_ID)).toHaveLength(CHUNKS);
    expect(commits.previous).not.toBeNull();
    expect(commits.changedAboveRows).toEqual([]);
    expect(container.textContent).toContain(
      `Now I compare${" the totals".repeat(CHUNKS + 1)}`,
    );
    expect(rendered.kitReads.at(-1)).toEqual({
      chatId: CHAT_ID,
      order: LIVE_ID,
      text: liveContent(CHUNKS)[0].text,
    });
  });
});
