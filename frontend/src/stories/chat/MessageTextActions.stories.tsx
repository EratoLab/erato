import { fn } from "@storybook/test";
import { useEffect, useRef } from "react";

import { resolveMessageTextSelection } from "../../components/ui/Message/messageTextBlocks";
import { MessageList } from "../../components/ui/MessageList/MessageList";
import { useMessageExplainStore } from "../../hooks/chat/store/messageExplainStore";
import { StaticFeatureConfigProvider } from "../../providers/FeatureConfigProvider";

import type { ChatMessage } from "../../components/ui/MessageList/MessageList";
import type { MessageExplainTurnState } from "../../hooks/chat/store/messageExplainStore";
import type { UserProfile } from "../../lib/generated/v1betaApi/v1betaApiSchemas";
import type { Meta, StoryObj } from "@storybook/react";
import type { ReactNode } from "react";

const at = (minute: number) =>
  new Date(Date.UTC(2026, 10, 13, 9, minute)).toISOString();

const question: ChatMessage = {
  id: "question",
  role: "user",
  content: [
    {
      content_type: "text",
      text: "Our cloud bill went up again last quarter. What are the main levers to bring it down without slowing the teams?",
    },
  ],
  createdAt: at(0),
  sender: "user",
  authorId: "user",
};

const answer: ChatMessage = {
  id: "answer",
  role: "assistant",
  content: [
    {
      content_type: "text",
      text: `Most of the increase comes from compute that is sized for peak load but runs all day. Three levers usually pay off first.

**Right-sizing:** match each service to what it actually uses. Many workloads still run on machines chosen from a first estimate nobody revisited.

**Committed-use discounts:** if you need a baseline of capacity all year, committing to it for one or three years costs much less than paying on demand. Start with the part of the load that never goes away.

**Egress fees:** moving data out of the provider’s network is billed per gigabyte. Nightly exports of large tables to an external reporting tool are a common hidden cost.

I would start with right-sizing. It needs no contract, and the savings show up on the next bill.`,
    },
  ],
  createdAt: at(1),
  updatedAt: at(1),
  sender: "assistant",
  authorId: "assistant",
  previous_message_id: "question",
};

const EXPLANATION = `A **committed-use discount** is a deal with the cloud provider: you promise to pay for a fixed amount of computing power for one or three years, and in return you get a lower price for it.

It works like a yearly rail pass:

- If you travel every day, the pass is cheaper than single tickets.
- If you stop travelling, you have still paid for it.`;

const FOLLOW_UP = "What happens if we need less than we committed to?";

const turn = (
  id: number,
  patch: Partial<MessageExplainTurnState>,
): MessageExplainTurnState => ({
  id,
  question: null,
  answer: "",
  status: "done",
  ...patch,
});

/** The text node holding `text`, and where it starts and ends in that node. */
const locate = (root: Element, text: string) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const index = (node as Text).data.indexOf(text);
    if (index !== -1 && node.parentElement?.closest("[data-text-block]")) {
      return { node, start: index, end: index + text.length };
    }
  }
  return null;
};

const showToolbarAgain = () =>
  document.dispatchEvent(new Event("selectionchange"));

interface SceneProps {
  /** Start of the marked text; the whole passage unless `markedUntil` is set. */
  marked: string;
  /** Text the marked passage ends with, for one across several blocks. */
  markedUntil?: string;
  /** Opens the small chat in this state instead of showing the toolbar. */
  explain?: MessageExplainTurnState[];
  width?: number;
  children: ReactNode;
}

/**
 * Marks the passage once the list has rendered. No pointer is involved, so
 * the toolbar shows after the same pause as for a keyboard selection.
 */
function Scene({ marked, markedUntil, explain, width, children }: SceneProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // The list renders after the preview's providers have loaded, so the
    // passage is looked for until it is there.
    const timer = setInterval(() => {
      const root = rootRef.current;
      const start = root && locate(root, marked);
      const end = root && markedUntil ? locate(root, markedUntil) : start;
      const selection = document.getSelection();
      if (!root || !start || !end || !selection) {
        return;
      }
      clearInterval(timer);
      const range = document.createRange();
      range.setStart(start.node, start.start);
      range.setEnd(end.node, end.end);
      selection.removeAllRanges();
      selection.addRange(range);
      if (!explain) {
        document.dispatchEvent(new Event("selectionchange"));
        // A long list scrolls to its end on mount, which hides the toolbar
        // like any scroll does; the marked text is still there to offer it.
        window.addEventListener("scroll", showToolbarAgain, true);
        return;
      }
      const passage = resolveMessageTextSelection(selection, root);
      selection.removeAllRanges();
      if (passage) {
        useMessageExplainStore.setState({
          card: {
            messageId: passage.messageId,
            passage: passage.text,
            anchor: passage.anchor,
            turns: explain,
          },
        });
      }
    }, 200);
    return () => {
      clearInterval(timer);
      window.removeEventListener("scroll", showToolbarAgain, true);
      document.getSelection()?.removeAllRanges();
      useMessageExplainStore.getState().close();
    };
  }, [explain, marked, markedUntil]);

  return (
    <div
      ref={rootRef}
      style={{ height: "100vh", display: "flex", width: width ?? "100%" }}
    >
      {children}
    </div>
  );
}

const meta = {
  title: "Chat/MessageTextActions",
  component: MessageList,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <StaticFeatureConfigProvider
        config={{
          messageTextActions: { quoteEnabled: true, explainEnabled: true },
        }}
      >
        <Story />
      </StaticFeatureConfigProvider>
    ),
  ],
  args: {
    messages: { question, answer },
    messageOrder: ["question", "answer"],
    loadOlderMessages: fn(),
    hasOlderMessages: false,
    isPending: false,
    currentSessionId: "chat",
    controlsContext: { canEdit: true },
    onMessageAction: fn(async () => true),
    showAvatars: true,
    showTimestamps: true,
    userProfile: { name: "You" } as UserProfile,
  },
} satisfies Meta<typeof MessageList>;

export default meta;
type Story = StoryObj<typeof meta>;

const scene = (props: Omit<SceneProps, "children">): Story["render"] =>
  function SceneStory(args) {
    return (
      <Scene {...props}>
        <MessageList {...args} />
      </Scene>
    );
  };

const PASSAGE = "Committed-use discounts";

/** Frame 1: the toolbar above text marked in one line of an assistant message. */
export const Toolbar: Story = { render: scene({ marked: PASSAGE }) };

/** Frame 2a: the marked text runs across two paragraphs. */
export const ToolbarAcrossParagraphs: Story = {
  render: scene({
    marked: "Many workloads still run",
    markedUntil: "all year",
  }),
};

/** Frame 2b: a user message offers Quote alone. */
export const ToolbarOnUserMessage: Story = {
  render: scene({ marked: "main levers" }),
};

/** Frame 4: the small chat just opened, the explanation streaming in. */
export const ExplainStreaming: Story = {
  render: scene({
    marked: PASSAGE,
    explain: [
      turn(1, {
        status: "streaming",
        answer:
          "A **committed-use discount** is a deal with the cloud provider: you promise to pay for a fixed amount of computing power for one or three years, and in return you get",
      }),
    ],
  }),
};

/** Before the first words arrive, the card shows the app's loading line. */
export const ExplainLoading: Story = {
  render: scene({ marked: PASSAGE, explain: [turn(1, { status: "loading" })] }),
};

const answeredTurns = [
  turn(1, { answer: EXPLANATION }),
  turn(2, {
    question: FOLLOW_UP,
    answer:
      "You still pay for the full amount until the term ends. That is why the answer suggests committing only to the part of the load that never goes away, and paying the normal price for everything on top.",
  }),
];

/** Frame 5: answered, with one follow-up. */
export const ExplainAnswered: Story = {
  render: scene({ marked: PASSAGE, explain: answeredTurns }),
};

/** Frame 6: the explanation failed. */
export const ExplainError: Story = {
  render: scene({ marked: PASSAGE, explain: [turn(1, { status: "error" })] }),
};

/** Frame 7a: the toolbar at add-in pane width. */
export const NarrowToolbar: Story = {
  render: scene({ marked: PASSAGE, width: 320 }),
};

/** Frame 7b: at add-in pane width, a follow-up just sent. */
export const NarrowExplainWaiting: Story = {
  render: scene({
    marked: PASSAGE,
    width: 320,
    explain: [
      turn(1, { answer: EXPLANATION }),
      turn(2, { question: FOLLOW_UP, status: "loading" }),
    ],
  }),
};

/** Frame 8a. */
export const DarkToolbar: Story = {
  ...Toolbar,
  globals: { theme: "dark" },
};

/** Frame 8b. */
export const DarkExplainAnswered: Story = {
  ...ExplainAnswered,
  globals: { theme: "dark" },
};
