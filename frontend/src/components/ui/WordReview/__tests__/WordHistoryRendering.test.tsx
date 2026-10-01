import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { ConversationMessagesProvider } from "@/components/ui/Message/ConversationMessages";
import { MessageContent } from "@/components/ui/Message/MessageContent";
import {
  setWordLiveCards,
  useWordMessageLineage,
} from "@/components/ui/WordReview/useWordHistoryMessage";
import { componentRegistry } from "@/config/componentRegistry";
import earlierMessage from "@/lib/wordReview/__tests__/fixtures/history-earlier-message.json";
import edits from "@/lib/wordReview/__tests__/fixtures/history-edits.json";
import noAccepted from "@/lib/wordReview/__tests__/fixtures/history-no-accepted.json";
import retryAccepted from "@/lib/wordReview/__tests__/fixtures/history-retry-accepted.json";
import * as wordHistory from "@/lib/wordReview/wordHistory";
import { messages as enMessages } from "@/locales/en/messages.json";
import { StaticFeatureConfigProvider } from "@/providers/FeatureConfigProvider";

import type { HostCardCodeBlockProps } from "@/config/componentRegistry";
import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { HostArtifact, Message } from "@/types/chat";
import type { Messages } from "@lingui/core";

vi.mock("@/lib/wordReview/wordHistory", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/wordReview/wordHistory")>();
  return {
    ...actual,
    wordHistoryProposal: vi.fn(actual.wordHistoryProposal),
  };
});

beforeAll(() => {
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
});

const registry = { ...componentRegistry };
afterEach(() => {
  Object.assign(componentRegistry, registry);
  setWordLiveCards(false);
});

const messagesOf = (fixture: { messages: unknown[] }) =>
  globalThis.structuredClone(fixture.messages) as Message[];

const queryClient = new QueryClient();

function chatTree(
  messages: Message[],
  options: {
    messageId?: string;
    hostArtifact?: HostArtifact;
    isStreaming?: boolean;
  } = {},
) {
  const byId = Object.fromEntries(messages.map((m) => [m.id, m]));
  const message = options.messageId
    ? byId[options.messageId]
    : messages[messages.length - 1];
  return (
    <I18nProvider i18n={i18n}>
      <StaticFeatureConfigProvider>
        <ThemeProvider enableCustomTheme={false}>
          <QueryClientProvider client={queryClient}>
            <ConversationMessagesProvider messages={byId}>
              <MessageContent
                content={message.content}
                messageId={message.id}
                hostArtifact={options.hostArtifact}
                isStreaming={options.isStreaming}
              />
            </ConversationMessagesProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </StaticFeatureConfigProvider>
    </I18nProvider>
  );
}

const renderChat = (...args: Parameters<typeof chatTree>) =>
  render(chatTree(...args));

const toolNames = () =>
  screen
    .queryAllByTestId("tool-call-item")
    .map((item) => item.getAttribute("data-tool-name"));

const wordConversation = (
  assistantContent: ContentPart[],
  facetId = "word_document_authoring",
  documentName = "Report.docx",
): Message[] => [
  {
    id: "user-1",
    role: "user",
    content: [],
    createdAt: "2026-10-01T00:00:00Z",
    action_facet_id: facetId,
    action_facet_args: { document_name: documentName },
  },
  {
    id: "assistant-1",
    role: "assistant",
    previous_message_id: "user-1",
    content: assistantContent,
    createdAt: "2026-10-01T00:00:01Z",
  },
];

const isSubmit = (part: ContentPart) =>
  part.content_type === "tool_use" && part.tool_name === "submit_document_plan";

/** The fixture's accepted plan moved to the later message, its reads left behind. */
function planAfterEarlierReads(): Message[] {
  const messages = messagesOf(earlierMessage);
  const [, first, , last] = messages;
  const accepted = first.content.filter(isSubmit);
  first.content = first.content.filter((part) => !isSubmit(part));
  last.content = last.content.map((part) =>
    isSubmit(part) ? accepted[0] : part,
  );
  return messages;
}

const text = (value: string): ContentPart => ({
  content_type: "text",
  text: value,
});

const otherTool: ContentPart = {
  content_type: "tool_use",
  tool_name: "web_search",
  tool_call_id: "search-1",
  status: "success",
  input: { query: "style guide" },
  output: { results: [] },
} as unknown as ContentPart;

async function expectRejectedAttempts() {
  const note = await screen.findByTestId("word-history-not-accepted");
  expect(note).toHaveTextContent(
    "A change was proposed but did not pass validation, so there is nothing to apply.",
  );
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByTestId("word-history-plan")).toBeNull();
  expect(toolNames()).toContain("submit_document_plan");
}

const planFence = (plan: unknown) =>
  text(
    `Done.\n\n\`\`\`erato-word-document-plan\n${JSON.stringify(plan)}\n\`\`\``,
  );

const acceptedPlanOf = (messages: Message[]) =>
  wordHistory.acceptedWordPlanFromHistory(
    messages[messages.length - 1].content,
  )!.plan;

describe("Word chats shown outside Word", () => {
  it("folds the reads and attempts of an accepted plan into one read-only card with the full review", async () => {
    const messages = messagesOf(retryAccepted);
    messages[0].action_facet_args = {
      ...messages[0].action_facet_args,
      document_name: "Quarterly.docx",
    };
    renderChat(messages);

    const card = await screen.findByTestId("word-history-plan");
    expect(screen.getAllByTestId("word-history-plan")).toHaveLength(1);
    expect(toolNames()).toEqual([]);
    expect(within(card).getByText("From Word · Quarterly.docx")).toBeVisible();
    expect(
      within(card).getByText(
        "Open this chat in Word with the document to apply.",
      ),
    ).toBeVisible();
    expect(
      within(card).getByRole("button", { name: "Copy text" }),
    ).toBeVisible();
    expect(within(card).queryByText(/^Saved draft/)).toBeNull();
  });

  it("rebuilds the review from reads stored in an earlier message", async () => {
    renderChat(planAfterEarlierReads());

    const card = await screen.findByTestId("word-history-plan");
    expect(within(card).getByText("From Word")).toBeVisible();
    expect(within(card).queryByText(/^Saved draft/)).toBeNull();
    expect(toolNames()).toEqual([]);
  });

  it("falls back to the plan-only review when the reads are missing", async () => {
    renderChat(planAfterEarlierReads().slice(2));

    const card = await screen.findByTestId("word-history-plan");
    expect(within(card).getByText(/^Saved draft/)).toBeVisible();
  });

  it("keeps rejected attempts in the trace and says calmly that nothing can be applied", async () => {
    renderChat(messagesOf(noAccepted));
    await expectRejectedAttempts();
  });

  it("keeps a later answer's rejected retry in the trace", async () => {
    renderChat(messagesOf(earlierMessage));
    await expectRejectedAttempts();
  });

  it("says nothing about attempts while the answer still streams", () => {
    renderChat(messagesOf(noAccepted), { isStreaming: true });
    expect(screen.queryByTestId("word-history-not-accepted")).toBeNull();
    expect(toolNames()).toContain("submit_document_plan");
  });

  it("hides an echoed plan fence beside the accepted submission's card", async () => {
    const messages = messagesOf(retryAccepted);
    const assistant = messages[messages.length - 1];
    assistant.content = [
      ...assistant.content,
      planFence(acceptedPlanOf(messages)),
    ];
    renderChat(messages);

    expect(await screen.findAllByTestId("word-history-plan")).toHaveLength(1);
    expect(screen.queryByText(/"readToken"/)).toBeNull();
  });

  it("shows an echoed plan without an accepted submission as the plan-only card", async () => {
    const plan = acceptedPlanOf(messagesOf(retryAccepted));
    renderChat(wordConversation([planFence(plan)]));

    const card = await screen.findByTestId("word-history-plan");
    expect(within(card).getByText(/^Saved draft/)).toBeVisible();
    expect(within(card).getByText("From Word · Report.docx")).toBeVisible();
    expect(screen.queryByText(/"readToken"/)).toBeNull();
  });

  it("keeps an echoed plan that does not parse as code", async () => {
    renderChat(wordConversation([planFence({ version: 1 })]));

    expect(await screen.findByText(/"version"/)).toBeInTheDocument();
    expect(screen.queryByTestId("word-history-plan")).toBeNull();
  });

  it("does not rebuild the proposal for text streamed after the accepted plan", async () => {
    const messages = messagesOf(retryAccepted);
    const view = renderChat(messages, { isStreaming: true });
    await screen.findByTestId("word-history-plan");
    const built = vi.mocked(wordHistory.wordHistoryProposal).mock.calls.length;

    const assistant = messages[messages.length - 1];
    for (const token of ["Here", " is", " the plan."]) {
      assistant.content = [...assistant.content, text(token)];
      view.rerender(
        chatTree([...messages.slice(0, -1), { ...assistant }], {
          isStreaming: true,
        }),
      );
    }

    expect(screen.getByText(/the plan\./)).toBeInTheDocument();
    expect(vi.mocked(wordHistory.wordHistoryProposal).mock.calls).toHaveLength(
      built,
    );
  });

  it("shows paragraph edits before and after, against the request's paragraphs", async () => {
    const messages = messagesOf(edits);
    renderChat(messages);

    const card = await screen.findByTestId("word-history-edits");
    expect(within(card).getByText("Change 9 paragraphs")).toBeVisible();
    expect(within(card).getByText("Paragraphs 1–9")).toBeVisible();
    expect(
      within(card).getByRole("tab", { name: "Original" }),
    ).not.toBeDisabled();
    fireEvent.click(within(card).getByRole("tab", { name: "Original" }));
    expect(card).toHaveTextContent(
      "To help, please tell me what you want to do:",
    );
    fireEvent.click(within(card).getByRole("tab", { name: "Proposed" }));
    expect(card).toHaveTextContent(
      "To help you, tell me what you’d like to do:",
    );
    expect(within(card).getByText("From Word")).toBeVisible();
    expect(toolNames()).toEqual(["propose_client_action"]);
    expect(document.querySelector("pre.message-content-code-block")).toBeNull();
  });

  it("shows an insert fence as the text to insert", async () => {
    renderChat(
      wordConversation(
        [text("Here it is:\n\n```erato-word-insert\nDear team,\nThanks.\n```")],
        "word_compose",
      ),
    );

    const card = await screen.findByTestId("word-history-insert");
    expect(card).toHaveTextContent("Dear team, Thanks.");
    expect(within(card).getByText("From Word · Report.docx")).toBeVisible();
  });

  it("keeps an incomplete edits fence as code", () => {
    renderChat(
      wordConversation([text('```erato-word-edits\n{"edits":[{"paragr\n```')]),
    );

    expect(screen.queryByTestId("word-history-edits")).toBeNull();
    expect(screen.getByText(/"paragr/)).toBeInTheDocument();
  });

  it("keeps the other tool calls of a plan message", async () => {
    const [user, assistant] = messagesOf(retryAccepted);
    renderChat([
      user,
      { ...assistant, content: [otherTool, ...assistant.content] },
    ]);

    await screen.findByTestId("word-history-plan");
    expect(toolNames()).toEqual(["web_search"]);
  });

  it("leaves Word tool calls alone in a chat without a Word facet", () => {
    const [user, assistant] = messagesOf(retryAccepted);
    renderChat([{ ...user, action_facet_id: undefined }, assistant]);

    expect(screen.queryByTestId("word-history-plan")).toBeNull();
    expect(toolNames()).toContain("submit_document_plan");
  });

  it("keeps the erato-appointment card of a Word chat", () => {
    renderChat(
      wordConversation([
        text(
          '```erato-appointment\n{"start":"2026-07-09T10:00:00+02:00","end":"2026-07-09T11:00:00+02:00","subject":"Quarterly sync"}\n```',
        ),
      ]),
    );

    expect(screen.getByText("Suggested appointment")).toBeInTheDocument();
  });

  it("keeps a host's registered appointment renderer", () => {
    componentRegistry.EratoAppointmentCodeBlock = function Appointment({
      content,
    }) {
      return <div data-testid="appointment-block">{content}</div>;
    };
    renderChat(
      wordConversation([
        text(
          '```erato-appointment\n{"start":"2026-07-09T10:00:00+02:00"}\n```',
        ),
      ]),
    );

    expect(screen.getByTestId("appointment-block")).toBeInTheDocument();
  });
});

describe("Word chats in the Word host", () => {
  const stub = ({ language, content }: HostCardCodeBlockProps) => (
    <div data-testid="host-card" data-language={language}>
      {content}
    </div>
  );

  it("leaves stamped messages to the host renderer", () => {
    componentRegistry.HostCardCodeBlock = stub;
    const messages = messagesOf(edits);
    renderChat(messages, {
      hostArtifact: {
        facetId: "word_document_authoring",
        renderMode: "suggestions",
        cardFenceLanguages: ["erato-word-edits"],
      },
    });

    expect(screen.getByTestId("host-card")).toHaveAttribute(
      "data-language",
      "erato-word-edits",
    );
    expect(screen.queryByTestId("word-history-edits")).toBeNull();
  });

  it("does not fold or card unstamped Word messages once Word declares its live cards", () => {
    componentRegistry.HostCardCodeBlock = stub;
    setWordLiveCards(true);
    renderChat(messagesOf(retryAccepted));

    expect(screen.queryByTestId("word-history-plan")).toBeNull();
    expect(toolNames()).toContain("submit_document_plan");
  });

  it("still shows read-only Word cards in a host with a card renderer of its own", async () => {
    componentRegistry.HostCardCodeBlock = stub;
    renderChat(messagesOf(retryAccepted));

    expect(await screen.findByTestId("word-history-plan")).toBeVisible();
    expect(toolNames()).toEqual([]);
  });
});

describe("the Word lineage selector", () => {
  it("re-renders only when a message of its own branch changes", () => {
    let renders = 0;
    function Reader() {
      renders++;
      return <span>{useWordMessageLineage("b").length}</span>;
    }
    const reader = <Reader />;
    const message = (id: string, previous?: string, body = "") =>
      ({
        id,
        role: "assistant",
        previous_message_id: previous,
        createdAt: "2026-10-01T00:00:00Z",
        content: [text(body)],
      }) as Message;
    const a = message("a");
    const b = message("b", "a");
    const view = render(
      <ConversationMessagesProvider messages={{ a, b, c: message("c") }}>
        {reader}
      </ConversationMessagesProvider>,
    );
    expect(view.container).toHaveTextContent("2");
    const settled = renders;

    view.rerender(
      <ConversationMessagesProvider
        messages={{ a, b, c: message("c", undefined, "token") }}
      >
        {reader}
      </ConversationMessagesProvider>,
    );
    expect(renders).toBe(settled);

    view.rerender(
      <ConversationMessagesProvider
        messages={{ a: message("a", undefined, "edited"), b, c: message("c") }}
      >
        {reader}
      </ConversationMessagesProvider>,
    );
    expect(renders).toBe(settled + 1);
  });
});
