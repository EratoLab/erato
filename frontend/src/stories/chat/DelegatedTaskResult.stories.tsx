import { fn } from "@storybook/test";
import { useEffect } from "react";

import { MessageList } from "../../components/ui/MessageList/MessageList";
import { useGenerationStatusStore } from "../../hooks/chat/store/generationStatusStore";
import { StaticFeatureConfigProvider } from "../../providers/FeatureConfigProvider";

import type { ChatMessage } from "../../components/ui/MessageList/MessageList";
import type {
  ContentPart,
  ContentPartTaskResult,
  UserProfile,
} from "../../lib/generated/v1betaApi/v1betaApiSchemas";
import type { Meta, StoryObj } from "@storybook/react";
import type { ReactNode } from "react";

const CHILD_CHAT_ID = "4f1c2a9e-0d7b-4c1e-9a55-1c7f0b8e2d31";

const at = (second: number) =>
  new Date(Date.UTC(2026, 9, 29, 17, 14, second)).toISOString();

const message = (
  id: string,
  role: "user" | "assistant",
  content: ContentPart[],
  second: number,
  previousMessageId?: string,
): ChatMessage => ({
  id,
  role,
  content,
  createdAt: at(second),
  updatedAt: at(second + 2),
  status: "complete",
  sender: role,
  authorId: role,
  previous_message_id: previousMessageId,
});

const text = (value: string): ContentPart => ({
  content_type: "text",
  text: value,
});

const taskResult = (
  overrides: Partial<ContentPartTaskResult>,
): ContentPart => ({
  content_type: "task_result",
  child_chat_id: CHILD_CHAT_ID,
  parent_tool_call_id: "call-search",
  status: "completed",
  summary: "",
  truncated: false,
  sequence: 0,
  redeliveries: 0,
  model: { chat_provider_id: "gpt-6.1-sol", display_name: "GPT 6.1 Sol" },
  ...overrides,
});

const prompt = message(
  "prompt",
  "user",
  [text('Such mir die Email "Please distribute passwords"')],
  0,
);

const dispatch = message(
  "dispatch",
  "assistant",
  [
    {
      content_type: "tool_use",
      tool_call_id: "call-search",
      tool_name: "delegate_task",
      status: "success",
      input: {
        task: "Suche lokal nach der E-Mail „Please distribute passwords“ und berichte Betreff, Absender und Datum der freigegebenen Treffer.",
      },
      output: {
        background: true,
        run_mode: "async",
        delegate_chat_id: CHILD_CHAT_ID,
      },
    } as unknown as ContentPart,
    text(
      "Die lokale Suche nach „Please distribute passwords“ läuft. Bitte prüfe und genehmige im nativen Sidecar-Fenster die Belege, die Du hier teilen möchtest.",
    ),
  ],
  2,
  "prompt",
);

const needsDecision = message(
  "needs-decision",
  "user",
  [taskResult({ status: "input_required", reason: "approval_pending" })],
  20,
  "dispatch",
);

const needsDecisionReply = message(
  "needs-decision-reply",
  "assistant",
  [
    text(
      "Die Suche wartet auf Deine Freigabe im nativen Sidecar-Fenster. Hier liegen noch keine freigegebenen Ergebnisse vor.",
    ),
  ],
  22,
  "needs-decision",
);

const SUMMARY = `**Ein freigegebener Treffer:**

- **Betreff:** „FW: Please distribute passwords“ — Betrefftreffer mit Weiterleitungspräfix, kein exakt identischer äußerer Betreff. Die eingebettete Originalnachricht trägt den exakten Betreff „Please distribute passwords“.
- **Absender:** windows1@ms.eratolabs.com; ursprünglicher Absender: Max Goisser <max@ms.eratolabs.com>.
- **Datum:** 29.10.2026; eingebettete Originalnachricht: 29.10.2026, 17:14 Uhr (Zeitzone nicht angegeben).

**Abdeckungsgrenzen:** Berücksichtigt wurde ausschließlich die im nativen Sidecar-Fenster ausdrücklich freigegebene Evidenz aus der lokalen Suche.`;

const answered = (previous: string, second: number) =>
  message(
    "answered",
    "user",
    [taskResult({ summary: SUMMARY, sequence: 1 })],
    second,
    previous,
  );

const answeredReply = (second: number) =>
  message(
    "answered-reply",
    "assistant",
    [
      {
        content_type: "reasoning",
        text: "**Ergebnis zusammenfassen**\n\nDer Lauf hat einen freigegebenen Treffer gemeldet.",
      },
      text(`Ich habe einen freigegebenen Treffer gefunden:

- **Betreff:** „FW: Please distribute passwords“
- **Absender:** windows1@ms.eratolabs.com
- **Datum:** 29.10.2026
- **Enthaltene Originalnachricht:** „Please distribute passwords“ von **Max Goisser** (max@ms.eratolabs.com), gesendet am **29.10.2026 um 17:14 Uhr**`),
    ],
    second,
    "answered",
  );

/**
 * The retry is addressed through the chat the result was delivered into. The
 * preview's ChatProvider mirrors its route (no chat) into the store on mount,
 * so this sets it on the tick after.
 */
const InOriginChat = ({ children }: { children: ReactNode }) => {
  useEffect(() => {
    const timer = setTimeout(() =>
      useGenerationStatusStore.getState().setCurrentChatId("origin-chat"),
    );
    return () => clearTimeout(timer);
  }, []);
  return children;
};

const conversation = (...messages: ChatMessage[]) => ({
  messages: Object.fromEntries(messages.map((entry) => [entry.id, entry])),
  messageOrder: messages.map((entry) => entry.id),
});

const meta = {
  title: "Chat/DelegatedTaskResult",
  component: MessageList,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <InOriginChat>
        <Story />
      </InOriginChat>
    ),
    (Story) => (
      <StaticFeatureConfigProvider
        config={{
          assistants: {
            enabled: true,
            delegationEnabled: true,
            delegationTasksAllowAsync: true,
          },
        }}
      >
        <div style={{ height: "100vh", display: "flex" }}>
          <Story />
        </div>
      </StaticFeatureConfigProvider>
    ),
  ],
  args: {
    ...conversation(prompt),
    loadOlderMessages: fn(),
    hasOlderMessages: false,
    isPending: false,
    currentSessionId: "origin-chat",
    controlsContext: { canEdit: true },
    onMessageAction: fn(async () => true),
    showAvatars: true,
    showTimestamps: true,
    userProfile: { name: "Max Token" } as UserProfile,
  },
} satisfies Meta<typeof MessageList>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The task stopped for an approval, which needs no reply from the assistant,
 * and later answered; the assistant's reply opens with the step.
 */
export const AskedThenAnswered: Story = {
  args: conversation(
    prompt,
    dispatch,
    needsDecision,
    answered("needs-decision", 40),
    answeredReply(42),
  ),
};

/** The same run while the assistant still replies to the approval notice. */
export const AskedWithReplyThenAnswered: Story = {
  args: conversation(
    prompt,
    dispatch,
    needsDecision,
    needsDecisionReply,
    answered("needs-decision-reply", 40),
    answeredReply(42),
  ),
};

export const FailedWithRetry: Story = {
  args: conversation(
    prompt,
    dispatch,
    message(
      "failed",
      "user",
      [taskResult({ status: "failed", reason: "timeout" })],
      40,
      "dispatch",
    ),
    message(
      "failed-reply",
      "assistant",
      [
        text(
          "Die Suche ist abgelaufen, bevor sie Ergebnisse liefern konnte. Du kannst sie über „Aufgabe wiederholen“ erneut starten.",
        ),
      ],
      42,
      "failed",
    ),
  ),
};

/** A `silent` task's result is stored without a reply. */
export const SilentResult: Story = {
  args: conversation(prompt, dispatch, answered("dispatch", 40)),
};
