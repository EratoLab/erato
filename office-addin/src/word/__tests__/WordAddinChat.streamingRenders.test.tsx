import {
  ChatMessage,
  componentRegistry,
  FeatureConfigProvider,
  registerClientToolExecutor,
  MessageList,
  ThemeProvider,
} from "@erato/frontend/library";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SHARED_ADDIN_FEATURE_CONFIG } from "../../core/SharedAddinShell";
import { examplePlan } from "../../test/mocks/word/authoringFixtures";
import {
  installMockWordDocument,
  uninstallMockWordDocument,
} from "../../test/mocks/word/document";
import { WordAddinChat } from "../WordAddinChat";
import { WordApprovalItemCard } from "../components/WordApprovalItemCard";
import { wordContextStore } from "../hooks/wordContextStore";
import { WORD_APPLY_PLAN_TOOL } from "../utils/wordApplyCall";

import type { AddinChatController } from "../../core/AddinChatCore";
import type { ChatMessageProps, ContentPart } from "@erato/frontend/library";
import type { ReactNode } from "react";

const harness = vi.hoisted(() => {
  const messages: Record<string, object> = {};
  const messageOrder: string[] = [];
  const rows: string[] = [];
  const stamped: { current: Record<string, { hostArtifact?: object }> } = {
    current: {},
  };
  return { messages, messageOrder, rows, stamped };
});

const FACETS = {
  data: {
    action_facets: [
      {
        id: "word_document_review",
        display_name: "Review this document",
        client_actions: ["word.apply_edits"],
        presentation: "auto_prompt",
      },
      {
        id: "word_document_authoring",
        display_name: "Edit this document",
        client_actions: ["word.apply_document_plan"],
        presentation: "auto_prompt",
      },
    ],
  },
};

vi.mock("@erato/frontend/library", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useFacets: () => FACETS,
}));

function CountingRenderer(props: ChatMessageProps) {
  return (
    <Profiler
      id={props.message.id}
      onRender={(id) => {
        harness.rows.push(id);
      }}
    >
      <ChatMessage {...props} />
    </Profiler>
  );
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

// The pane's own shell, minus everything but the message list it hands the stamped messages to.
vi.mock("../../core/AddinChatCore", () => {
  const controller = {
    hostCallbacksRef: { current: {} },
    chatInputControls: {
      addUploadedFiles: () => {},
      setDraftMessage: () => {},
    },
    uploadFiles: () => {},
    acceptedFileTypes: [],
    isUploading: false,
    composerLocked: false,
    currentChatId: "chat-1",
    setIsSettingsOpen: () => {},
    get messages() {
      return harness.messages;
    },
    get messageOrder() {
      return harness.messageOrder;
    },
  } as unknown as AddinChatController;
  return {
    AddinChatCore: ({
      Host,
    }: {
      Host: (props: { controller: AddinChatController }) => ReactNode;
    }) => <Host controller={controller} />,
    AddinChatCoreView: ({
      messages,
    }: {
      messages: AddinChatController["messages"];
    }) => {
      harness.stamped.current = messages;
      return (
        <MessageList
          messages={messages}
          messageOrder={harness.messageOrder}
          loadOlderMessages={() => {}}
          hasOlderMessages={false}
          isPending={false}
          currentSessionId="chat-1"
          controlsContext={{ canEdit: true }}
          onMessageAction={async () => true}
          messageRenderer={CountingRenderer}
          pageSize={harness.messageOrder.length}
        />
      );
    },
  };
});

const pane = () => (
  <QueryClientProvider client={queryClient}>
    <FeatureConfigProvider config={SHARED_ADDIN_FEATURE_CONFIG}>
      <ThemeProvider>
        <I18nProvider i18n={i18n}>
          <WordAddinChat />
        </I18nProvider>
      </ThemeProvider>
    </FeatureConfigProvider>
  </QueryClientProvider>
);

const FINISHED_TURNS = 10;
const LIVE_ID = "a-live";

const toolUse = (id: string): ContentPart =>
  ({
    content_type: "tool_use",
    tool_call_id: id,
    tool_name: "read_document_blocks",
    status: "success",
    input: { blocks: [id] },
    output: { result: { blocks: [{ ref: id, text: `Text of ${id}.` }] } },
    progress_message: null,
  }) as unknown as ContentPart;

const userMessage = (turn: number) => ({
  id: `u${turn}`,
  role: "user",
  content: [{ content_type: "text", text: `Question ${turn}` }],
  createdAt: "2026-01-01T00:00:00.000Z",
  action_facet_id: "word_document_review",
  ...(turn > 0 ? { previous_message_id: `a${turn - 1}` } : {}),
});

const liveMessage = (chunk: number) => ({
  id: LIVE_ID,
  role: "assistant",
  content: [
    { content_type: "reasoning", text: "**Look**\n\nThe table has rows.\n\n" },
    toolUse("call-live"),
    {
      content_type: "reasoning",
      text: `**Compare**\n\nNow I compare${" the totals".repeat(chunk + 1)}`,
    },
  ],
  createdAt: "2026-01-01T00:03:00.000Z",
  previous_message_id: `u${FINISHED_TURNS}`,
  loading: { state: "typing" },
});

describe("the Word pane while a reply streams", () => {
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
    harness.rows.length = 0;
    harness.messageOrder.length = 0;
    harness.messages = {};
    for (let turn = 0; turn < FINISHED_TURNS; turn++) {
      harness.messages[`u${turn}`] = userMessage(turn);
      harness.messages[`a${turn}`] = {
        id: `a${turn}`,
        role: "assistant",
        content: [
          {
            content_type: "reasoning",
            text: `**Plan ${turn}**\n\nRead block ${turn}.\n\n`,
          },
          toolUse(`call-${turn}`),
          { content_type: "text", text: `Answer ${turn}.` },
        ],
        createdAt: "2026-01-01T00:01:00.000Z",
        updatedAt: "2026-01-01T00:02:00.000Z",
        previous_message_id: `u${turn}`,
      };
      harness.messageOrder.push(`u${turn}`, `a${turn}`);
    }
    harness.messages[`u${FINISHED_TURNS}`] = userMessage(FINISHED_TURNS);
    harness.messageOrder.push(`u${FINISHED_TURNS}`, LIVE_ID);
  });

  afterEach(() => {
    cleanup();
    uninstallMockWordDocument();
    wordContextStore.resetForTests();
    vi.unstubAllGlobals();
  });

  it("leaves an earlier answer whose change the server applied alone", () => {
    const plan = { ...examplePlan("snap-0"), readToken: "read-0" };
    harness.messages.u0 = {
      ...userMessage(0),
      action_facet_id: "word_document_authoring",
    };
    harness.messages.a0 = {
      ...harness.messages.a0,
      content: [
        {
          content_type: "tool_use",
          tool_call_id: "submit-0",
          tool_name: "submit_document_plan",
          status: "success",
          input: plan,
          output: {
            status: "success",
            submission: { status: "accepted" },
            result: {
              draft_id: "submit-0",
              snapshot: "snap-0",
              action: "word.apply_document_plan",
            },
            apply: { call_id: "submit-0.apply" },
          },
        },
        {
          content_type: "tool_use",
          tool_call_id: "submit-0.apply",
          tool_name: "apply_document_plan",
          status: "success",
          input: {},
          output: { status: "success", result: { status: "applied" } },
        },
        { content_type: "text", text: "Done." },
      ],
    };
    harness.messages = { ...harness.messages, [LIVE_ID]: liveMessage(0) };
    const { rerender } = render(pane());
    expect(harness.stamped.current.a0.hostArtifact).toMatchObject({
      submittedCards: [expect.objectContaining({ toolCallId: "submit-0" })],
    });

    harness.rows.length = 0;
    for (let chunk = 1; chunk <= 5; chunk++) {
      harness.messages = {
        ...harness.messages,
        [LIVE_ID]: liveMessage(chunk),
      };
      rerender(pane());
    }

    expect(harness.rows.filter((id) => id !== LIVE_ID)).toEqual([]);
  });

  it("renders no more while a chained change waits in an earlier answer's decision place", () => {
    let cardShown = false;
    const rowsWhileStreaming = () => {
      const { rerender, unmount, container } = render(pane());
      cardShown = !!container.querySelector(
        '[data-message-id="a0"] [data-testid="word-chained-read-again"], [data-message-id="a0"] [data-testid="word-decision-choices"]',
      );
      harness.rows.length = 0;
      for (let chunk = 1; chunk <= 5; chunk++) {
        harness.messages = {
          ...harness.messages,
          [LIVE_ID]: liveMessage(chunk),
        };
        rerender(pane());
      }
      const rows = [...harness.rows];
      unmount();
      return rows;
    };
    harness.messages = { ...harness.messages, [LIVE_ID]: liveMessage(0) };
    const without = rowsWhileStreaming();

    const plan = { ...examplePlan("snap-0"), readToken: "read-0" };
    const display = {
      title: "Change “Vertrag.docx”",
      description: "Updates 1 of 3 sections: § 2",
    };
    const chained = { submission_call_id: "submit-0", decide_on_screen: false };
    harness.messages.u0 = {
      ...userMessage(0),
      action_facet_id: "word_document_authoring",
    };
    harness.messages.a0 = {
      ...harness.messages.a0,
      content: [
        {
          content_type: "tool_use",
          tool_call_id: "submit-0",
          tool_name: "submit_document_plan",
          status: "success",
          input: plan,
          output: {
            status: "success",
            submission: { status: "accepted" },
            result: {
              draft_id: "submit-0",
              snapshot: "snap-0",
              action: "word.apply_document_plan",
            },
            apply: { call_id: "submit-0.apply" },
          },
        },
        {
          content_type: "tool_approval_request",
          tool_call_id: "submit-0.apply",
          tool_name: "apply_document_plan",
          mcp_server_id: "word",
          input: { submission_call_id: "submit-0", draft_id: "submit-0" },
          allow_always: true,
          requested_at: "2026-01-01T00:01:30Z",
          kind: "client_tool",
          display,
          approvals: [
            {
              approval_id: "submit-0.apply",
              tool_call_id: "submit-0.apply",
              tool_name: "apply_document_plan",
              input: { submission_call_id: "submit-0", draft_id: "submit-0" },
              display,
              child: null,
              chained,
            },
          ],
        },
      ],
    };
    harness.messages = { ...harness.messages, [LIVE_ID]: liveMessage(0) };
    const previous = componentRegistry.ApprovalItemCard;
    componentRegistry.ApprovalItemCard = WordApprovalItemCard;
    // As the pane's input registers it: the change can be made here.
    const unregister = registerClientToolExecutor(
      WORD_APPLY_PLAN_TOOL,
      async () => ({ ok: true, result: {} }),
    );
    // jsdom has no scrolling; the card scrolls itself into view when it mounts.
    Element.prototype.scrollIntoView = () => {};
    try {
      const withCard = rowsWhileStreaming();
      expect(cardShown).toBe(true);
      expect(withCard.filter((id) => id !== LIVE_ID)).toEqual([]);
      expect(withCard.length).toBeLessThanOrEqual(without.length);
    } finally {
      componentRegistry.ApprovalItemCard = previous;
      unregister();
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });

  it("renders only the streaming reply's row", () => {
    harness.messages = { ...harness.messages, [LIVE_ID]: liveMessage(0) };
    const { rerender, container } = render(pane());
    expect(container.querySelectorAll('[data-message-id="a0"]')).toHaveLength(
      1,
    );

    harness.rows.length = 0;
    for (let chunk = 1; chunk <= 5; chunk++) {
      // As the chat provider hands them over: only the streaming message is new.
      harness.messages = {
        ...harness.messages,
        [LIVE_ID]: liveMessage(chunk),
      };
      rerender(pane());
    }

    expect(harness.rows.filter((id) => id !== LIVE_ID)).toEqual([]);
    expect(harness.rows.filter((id) => id === LIVE_ID)).toHaveLength(5);
    expect(harness.stamped.current.a0.hostArtifact).toBeDefined();
    expect(harness.stamped.current[LIVE_ID].hostArtifact).toBeDefined();
  });
});
