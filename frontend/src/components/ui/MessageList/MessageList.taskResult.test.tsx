import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { messages as enMessages } from "@/locales/en/messages.json";
import { StaticFeatureConfigProvider } from "@/providers/FeatureConfigProvider";

import { MessageList } from "./MessageList";

import type { ChatMessage } from "./MessageList";
import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";
import type { Messages } from "@lingui/core";

beforeAll(() => {
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
});

const row = (
  id: string,
  role: Message["role"],
  content: ContentPart[],
  minute: number,
  extra: Partial<ChatMessage> = {},
): ChatMessage => ({
  id,
  role,
  content,
  createdAt: `2026-01-01T00:0${minute}:00.000Z`,
  sender: role,
  authorId: role,
  status: "complete" as const,
  ...extra,
});

const taskResult: ContentPart = {
  content_type: "task_result",
  child_chat_id: "11111111-1111-1111-1111-111111111111",
  parent_tool_call_id: "call-1",
  status: "completed",
  summary: "THE-CHILD-ANSWER",
  truncated: false,
  sequence: 0,
  redeliveries: 0,
};

const conversation = {
  prompt: row("prompt", "user", [{ content_type: "text", text: "Find it" }], 0),
  dispatch: row(
    "dispatch",
    "assistant",
    [{ content_type: "text", text: "The search is running." }],
    1,
    { previous_message_id: "prompt" },
  ),
  result: row("result", "user", [taskResult], 2, {
    previous_message_id: "dispatch",
  }),
};

const renderList = (
  messages: Record<string, ChatMessage>,
  messageOrder: string[],
) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <StaticFeatureConfigProvider>
        <ThemeProvider enableCustomTheme={false}>
          <I18nProvider i18n={i18n}>
            <MessageList
              messages={messages}
              messageOrder={messageOrder}
              loadOlderMessages={vi.fn()}
              hasOlderMessages={false}
              isPending={false}
              currentSessionId="chat-1"
              controlsContext={{ canEdit: true }}
              onMessageAction={vi.fn(async () => true)}
            />
          </I18nProvider>
        </ThemeProvider>
      </StaticFeatureConfigProvider>
    </QueryClientProvider>,
  );

describe("MessageList with a delivered task result", () => {
  it("draws the result as the first step of the reply that answers it", () => {
    renderList(
      {
        ...conversation,
        reply: row(
          "reply",
          "assistant",
          [{ content_type: "text", text: "Here is what it found." }],
          3,
          { previous_message_id: "result" },
        ),
      },
      ["prompt", "dispatch", "result", "reply"],
    );

    expect(screen.getAllByTestId("message-user")).toHaveLength(1);
    const reply = screen.getAllByTestId("message-assistant").at(-1)!;
    expect(within(reply).getByTestId("task-result-step")).toBeInTheDocument();
    expect(reply).toHaveTextContent("Here is what it found.");
    expect(screen.getAllByTestId("task-result-step")).toHaveLength(1);
  });

  it("folds into a reply that is still streaming", () => {
    renderList(
      {
        ...conversation,
        reply: row("reply", "assistant", [], 3, {
          status: "sending",
          loading: { state: "typing" },
        }),
      },
      ["prompt", "dispatch", "result", "reply"],
    );

    expect(screen.getAllByTestId("message-user")).toHaveLength(1);
    const reply = screen.getAllByTestId("message-assistant").at(-1)!;
    expect(within(reply).getByTestId("task-result-step")).toBeInTheDocument();
  });

  it("draws a result nobody replied to on the assistant's side, without message actions", () => {
    renderList(conversation, ["prompt", "dispatch", "result"]);

    expect(screen.getAllByTestId("message-user")).toHaveLength(1);
    const standalone = screen.getAllByTestId("message-assistant").at(-1)!;
    expect(within(standalone).getByTestId("task-result-step")).toHaveAttribute(
      "data-task-result-status",
      "completed",
    );
    expect(
      within(standalone).queryByRole("button", { name: /edit message/i }),
    ).toBeNull();
  });

  it("draws the pieces after the user's message as one assistant turn", () => {
    renderList(
      {
        ...conversation,
        reply: row(
          "reply",
          "assistant",
          [{ content_type: "text", text: "Here is what it found." }],
          3,
          { previous_message_id: "result" },
        ),
      },
      ["prompt", "dispatch", "result", "reply"],
    );

    const [dispatch, reply] = screen.getAllByTestId("message-assistant");
    expect(dispatch).not.toHaveAttribute("data-continues-turn");
    expect(within(dispatch).getByText("Assistant")).toBeInTheDocument();
    expect(reply).toHaveAttribute("data-continues-turn", "true");
    expect(within(reply).queryByText("Assistant")).toBeNull();
  });
});
