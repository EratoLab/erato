import { action } from "@storybook/addon-actions";
import { useEffect } from "react";

import { ChatHistoryList } from "../components/ui/Chat/ChatHistoryList";
import { useConfirmationRegistryStore } from "../hooks/chat/store/confirmationRegistryStore";
import { useGenerationStatusStore } from "../hooks/chat/store/generationStatusStore";
import { useChatHistoryStore } from "../hooks/chat/useChatHistory";

import type { ChatSession } from "../types/chat";
import type { Meta, StoryObj } from "@storybook/react";

const now = Date.now();
const minutesAgo = (minutes: number) =>
  new Date(now - minutes * 60_000).toISOString();

const session = (
  id: string,
  title: string,
  updatedMinutesAgo: number,
): ChatSession => ({
  id,
  title,
  updatedAt: minutesAgo(updatedMinutesAgo),
  messages: [],
});

const SESSIONS: ChatSession[] = [
  // Untitled while running: the sidebar substitutes the recorded user-message
  // hint until the backend summary lands.
  session("chat-running", "Untitled Chat", 0),
  session("chat-finished", "Quarterly report summary", 4),
  session("chat-error", "Deployment pipeline question", 9),
  session("chat-action-required", "Draft reply to the vendor", 12),
  session("chat-plain", "Weekend trip packing list", 45),
  // Untitled without a hint (e.g. after a reload): localized fallback.
  session("chat-untitled", "Untitled Chat", 60),
];

/** Seeds the module stores the rows read their indicator state from. */
const SeedStores = ({ withStatuses }: { withStatuses: boolean }) => {
  useEffect(() => {
    const generation = useGenerationStatusStore.getState();
    const history = useChatHistoryStore.getState();
    const confirmations = useConfirmationRegistryStore.getState();

    if (withStatuses) {
      generation.seedRunning("chat-running", minutesAgo(1));
      generation.seedRunning("chat-finished", minutesAgo(5));
      generation.markTerminalLocal("chat-finished", "finished");
      generation.seedRunning("chat-error", minutesAgo(10));
      generation.markTerminalLocal("chat-error", "error");
      confirmations.registerConfirmation(
        "chat-action-required",
        "storybook-confirmation",
      );
      history.setTitleHint(
        "chat-running",
        "Summarize the attached meeting notes and…",
      );
    }

    return () => {
      generation.reset();
      confirmations.unregisterConfirmation(
        "chat-action-required",
        "storybook-confirmation",
      );
      history.clearTitleHint("chat-running");
    };
  }, [withStatuses]);

  return null;
};

const meta: Meta<typeof ChatHistoryList> = {
  title: "UI/Chat/ChatHistoryList",
  component: ChatHistoryList,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "History sidebar rows with per-chat generation status. The status renders as a colored dot (pulsing while running) whose text label lives in the hover title and the row link's aria-label. Rows without a backend title show the start of the user's message, falling back to a localized placeholder.",
      },
    },
  },
  tags: ["autodocs"],
  decorators: [
    (Story, context) => (
      <div className="w-72 bg-theme-bg-primary p-2">
        <SeedStores withStatuses={context.name !== "No statuses"} />
        <Story />
      </div>
    ),
  ],
  args: {
    sessions: SESSIONS,
    currentSessionId: "chat-plain",
    onSessionSelect: action("select"),
    onSessionArchive: action("archive"),
    onSessionEditTitle: action("edit title"),
    onSessionShare: action("share"),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const AllStatuses: Story = {
  name: "All statuses",
};

export const NoStatuses: Story = {
  name: "No statuses",
  parameters: {
    docs: {
      description: {
        story:
          "Without store entries every row renders exactly as before the feature — no dot, no reserved space.",
      },
    },
  },
};

export const CompactLayout: Story = {
  name: "Compact layout",
  args: {
    layout: "compact",
    showTimestamps: false,
  },
};
