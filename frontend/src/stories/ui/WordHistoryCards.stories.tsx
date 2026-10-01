import { ConversationMessagesProvider } from "../../components/ui/Message/ConversationMessages";
import { MessageContent } from "../../components/ui/Message/MessageContent";
import edits from "../../lib/wordReview/__tests__/fixtures/history-edits.json";
import noAccepted from "../../lib/wordReview/__tests__/fixtures/history-no-accepted.json";
import retryAccepted from "../../lib/wordReview/__tests__/fixtures/history-retry-accepted.json";

import type { Message } from "../../types/chat";
import type { Meta, StoryObj } from "@storybook/react";

function WordChat({
  messages,
  documentName,
}: {
  messages: unknown[];
  documentName?: string;
}) {
  const list = globalThis.structuredClone(messages) as Message[];
  if (documentName)
    list[0].action_facet_args = {
      ...list[0].action_facet_args,
      document_name: documentName,
    };
  const answer = list[list.length - 1];
  return (
    <ConversationMessagesProvider
      messages={Object.fromEntries(list.map((m) => [m.id, m]))}
    >
      <MessageContent content={answer.content} messageId={answer.id} />
    </ConversationMessagesProvider>
  );
}

const meta = {
  title: "UI/Word history cards",
  component: WordChat,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "How a stored Word answer reads outside Word: the accepted plan, reviewed against the reads in its chat, or the paragraph edits against the request's paragraphs. Nothing can be applied here, so each card points back to Word.",
      },
    },
  },
} satisfies Meta<typeof WordChat>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AcceptedPlan: Story = {
  args: { messages: retryAccepted.messages, documentName: "Quarterly.docx" },
};

export const NoChangesProposed: Story = {
  args: { messages: noAccepted.messages },
};

export const ParagraphEdits: Story = {
  args: { messages: edits.messages, documentName: "Help.docx" },
};
