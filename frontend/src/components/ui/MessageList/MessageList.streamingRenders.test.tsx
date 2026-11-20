import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { Profiler } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { messages as enMessages } from "@/locales/en/messages.json";
import { StaticFeatureConfigProvider } from "@/providers/FeatureConfigProvider";

import { MessageList } from "./MessageList";
import { ChatMessage } from "../Chat/ChatMessage";

import type { ChatMessage as ListMessage } from "./MessageList";
import type { ChatMessageProps } from "../Chat/ChatMessage";
import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";
import type { ReactNode } from "react";

const renders = vi.hoisted(() => ({
  rows: [] as string[],
  markdown: [] as string[],
  json: [] as unknown[],
}));

vi.mock("react-markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-markdown")>();
  const Markdown = actual.default;
  return {
    ...actual,
    default: function CountedMarkdown(props: Parameters<typeof Markdown>[0]) {
      renders.markdown.push(String(props.children));
      return <Markdown {...props} />;
    },
  };
});

vi.mock("@/components/ui/ToolCall/JsonDisplay", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/components/ui/ToolCall/JsonDisplay")
    >();
  const { JsonDisplay } = actual;
  return {
    ...actual,
    JsonDisplay: function CountedJsonDisplay(
      props: Parameters<typeof JsonDisplay>[0],
    ) {
      renders.json.push(props.data);
      return <JsonDisplay {...props} />;
    },
  };
});

beforeAll(() => {
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
});

const FINISHED_TURNS = 12;
const LIVE_SECTION = "Now I compare the totals";

const toolUse = (id: string) =>
  ({
    content_type: "tool_use",
    tool_call_id: id,
    tool_name: "read_document_blocks",
    status: "success",
    input: { blocks: [id], include: "text" },
    output: { result: { blocks: [{ ref: id, text: `Text of ${id}.` }] } },
    progress_message: null,
  }) as unknown as ContentPart;

const finishedChat = (): Record<string, ListMessage> => {
  const messages: Record<string, ListMessage> = {};
  for (let turn = 0; turn < FINISHED_TURNS; turn++) {
    messages[`u${turn}`] = {
      id: `u${turn}`,
      role: "user",
      content: [{ content_type: "text", text: `Question ${turn}` }],
      createdAt: "2026-01-01T00:00:00.000Z",
      ...(turn > 0 ? { previous_message_id: `a${turn - 1}` } : {}),
    } as ListMessage;
    messages[`a${turn}`] = {
      id: `a${turn}`,
      role: "assistant",
      content: [
        {
          content_type: "reasoning",
          text: `**Plan ${turn}**\n\nRead block ${turn} first.\n\n`,
        },
        toolUse(`call-${turn}`),
        { content_type: "text", text: `Answer ${turn} with **bold** text.` },
      ],
      createdAt: "2026-01-01T00:01:00.000Z",
      updatedAt: "2026-01-01T00:02:00.000Z",
      previous_message_id: `u${turn}`,
    } as ListMessage;
  }
  messages[`u${FINISHED_TURNS}`] = {
    id: `u${FINISHED_TURNS}`,
    role: "user",
    content: [{ content_type: "text", text: "Next question" }],
    createdAt: "2026-01-01T00:02:30.000Z",
    previous_message_id: `a${FINISHED_TURNS - 1}`,
  } as ListMessage;
  return messages;
};

const LIVE_ID = "a-live";
const liveBase: ContentPart[] = [
  {
    content_type: "reasoning",
    text: "**Look**\n\nThe table has three columns.\n\n**Check**\n\nThe second run differs.\n\n",
  },
  toolUse("call-live"),
];

// Shaped the way the chat providers hand them over while a reply streams:
// finished messages keep their objects, the streaming one is new each chunk.
const streamingChat = (
  finished: Record<string, ListMessage>,
  chunk: number,
) => {
  const tail = ` and the overlap, step ${chunk}`.repeat(chunk + 1);
  return {
    ...finished,
    [LIVE_ID]: {
      id: LIVE_ID,
      role: "assistant",
      content: [
        ...liveBase,
        {
          content_type: "reasoning",
          text: `**Compare**\n\n${LIVE_SECTION}${tail}`,
        },
      ],
      createdAt: "2026-01-01T00:03:00.000Z",
      previous_message_id: `u${FINISHED_TURNS}`,
      loading: { state: "typing" },
    } as ListMessage,
  };
};

const order = [
  ...Array.from({ length: FINISHED_TURNS }, (_, turn) => [
    `u${turn}`,
    `a${turn}`,
  ]).flat(),
  `u${FINISHED_TURNS}`,
  LIVE_ID,
];

function CountingRenderer(props: ChatMessageProps) {
  return (
    <Profiler
      id={props.message.id}
      onRender={(id) => {
        renders.rows.push(id);
      }}
    >
      <ChatMessage {...props} />
    </Profiler>
  );
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
const Wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    <StaticFeatureConfigProvider>
      <ThemeProvider enableCustomTheme={false}>
        <I18nProvider i18n={i18n}>{children}</I18nProvider>
      </ThemeProvider>
    </StaticFeatureConfigProvider>
  </QueryClientProvider>
);

const list = (messages: Record<string, ListMessage>) => (
  <MessageList
    messages={messages}
    messageOrder={order}
    loadOlderMessages={vi.fn()}
    hasOlderMessages={false}
    isPending={false}
    currentSessionId="chat-1"
    controlsContext={{ canEdit: true }}
    onMessageAction={vi.fn(async () => true)}
    messageRenderer={CountingRenderer}
    pageSize={order.length}
  />
);

describe("MessageList while a reply streams", () => {
  it("renders only the streaming reply's live section", () => {
    const finished = finishedChat();
    const { rerender, container } = render(list(streamingChat(finished, 0)), {
      wrapper: Wrapper,
    });
    expect(
      container.querySelectorAll('[data-testid="tool-call-item"]'),
    ).toHaveLength(FINISHED_TURNS + 1);

    renders.rows.length = 0;
    renders.markdown.length = 0;
    renders.json.length = 0;
    for (let chunk = 1; chunk <= 5; chunk++) {
      rerender(list(streamingChat(finished, chunk)));
    }

    expect(renders.rows.filter((id) => id !== LIVE_ID)).toEqual([]);
    expect(renders.rows.filter((id) => id === LIVE_ID)).toHaveLength(5);
    expect(
      renders.markdown.filter((text) => !text.startsWith(LIVE_SECTION)),
    ).toEqual([]);
    expect(renders.markdown).toHaveLength(5);
    expect(renders.json).toEqual([]);
  });
});
