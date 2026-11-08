import { action } from "@storybook/addon-actions";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { MessageContent } from "@/components/ui/Message/MessageContent";
import { ReminderConfirmationCardView } from "@/components/ui/Scheduled/ReminderConfirmationCard";
import { getScheduledItemQuery } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { StaticFeatureConfigProvider } from "@/providers/FeatureConfigProvider";

import type { ReminderConfirmation } from "@/components/ui/Scheduled/reminderConfirmation";
import type {
  ContentPart,
  ScheduledItem,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Meta, StoryObj } from "@storybook/react";
import type { ReactNode } from "react";

const english: ReminderConfirmation = {
  itemId: "item-offer",
  heading: "Reminder scheduled",
  name: "Follow up on the offer",
  when: "Friday, 13 Nov, 10:00",
  repeats: null,
  delivery: "Delivered via Teams chat",
  cancelLabel: "Cancel",
  openScheduledLabel: "Open in Scheduled",
  scheduledPath: "/scheduled",
};

const german: ReminderConfirmation = {
  ...english,
  heading: "Erinnerung geplant",
  name: "Angebot nachfassen",
  when: "Freitag, 13. Nov., 10:00",
  delivery: "Zustellung per Teams-Chat",
  cancelLabel: "Abbrechen",
  openScheduledLabel: "In „Geplant“ öffnen",
};

const meta = {
  title: "Chat/ReminderConfirmationCard",
  component: ReminderConfirmationCardView,
  parameters: {
    docs: {
      description: {
        component:
          "The card a chat shows after it scheduled a reminder. Its texts come from the backend with the tool's result, in the user's language and the same as on the Teams card; Cancel shows while the reminder is still upcoming, and editing happens on the Scheduled page.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 640, padding: 16 }}>
        <Story />
      </div>
    ),
  ],
  args: {
    confirmation: english,
    status: "scheduled",
    onCancel: action("Cancel"),
  },
} satisfies Meta<typeof ReminderConfirmationCardView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Scheduled: Story = {};

/** The zone shows only when the reminder's differs from the user's own. */
export const OtherTimeZone: Story = {
  args: {
    confirmation: { ...english, when: "Friday, 13 Nov, 10:00 (New York time)" },
  },
};

export const Repeating: Story = {
  args: {
    confirmation: {
      ...english,
      name: "Weekly status report",
      when: "Monday, 16 Nov, 9:00",
      repeats: "Every week on Monday and Thursday at 9:00",
    },
  },
};

/** For a user whose stored language is German, worded with "Sie". */
export const German: Story = {
  args: { confirmation: german },
};

export const Cancelling: Story = {
  args: { isCancelling: true },
};

export const Cancelled: Story = {
  args: { status: "cancelled" },
};

/** A reloaded chat whose reminder already arrived: no Cancel any more. */
export const AlreadyHappened: Story = {
  args: { status: "done" },
};

export const Snoozed: Story = {
  args: { status: "snoozed" },
};

export const Failed: Story = {
  args: { status: "failed" },
};

/** The reminder was deleted from the Scheduled page since. */
export const NoLongerExists: Story = {
  args: { status: "gone" },
};

export const CancelRefused: Story = {
  args: {
    status: "done",
    cancelError: "This item is already over.",
  },
};

/** Without a Scheduled page in this app, only Cancel remains. */
export const WithoutScheduledPage: Story = {
  args: { showOpenScheduled: false },
};

const storedItem: ScheduledItem = {
  id: english.itemId,
  type: "reminder",
  name: english.name,
  message: "Ask whether they decided.",
  trigger: { kind: "once", date: "2026-11-13", time: "10:00" },
  time_zone: "Europe/Berlin",
  status: "scheduled",
  occurrence_count: 1,
  channel: "teams_personal",
  channel_status: "connected",
  created_at: "2026-11-08T10:00:00Z",
  updated_at: "2026-11-08T10:00:00Z",
};

/** Seeds the reminder's live status before the card first asks for it. */
const SeedStoredItem = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();
  useState(() =>
    queryClient.setQueryData(
      getScheduledItemQuery({ pathParams: { itemId: english.itemId } })
        .queryKey,
      storedItem,
    ),
  );
  return <>{children}</>;
};

const reminderTurn = [
  {
    content_type: "tool_use",
    tool_call_id: "call-reminder",
    tool_name: "create_reminder",
    status: "success",
    input: {
      name: english.name,
      message: "Ask whether they decided.",
      trigger: { kind: "once", date: "2026-11-13", time: "10:00" },
    },
    output: {
      status: "created",
      reminder: { id: english.itemId, name: english.name },
      confirmation: {
        item_id: english.itemId,
        language: "en",
        heading: english.heading,
        name: english.name,
        when: english.when,
        repeats: null,
        delivery: english.delivery,
        cancel_label: english.cancelLabel,
        open_scheduled_label: english.openScheduledLabel,
        scheduled_path: english.scheduledPath,
      },
    },
  },
  {
    content_type: "text",
    text: "Done. I'll remind you on Friday at 10:00.",
  },
  // The generated schema types a tool's free-form input and output as void.
] as unknown as ContentPart[];

/** In the chat: below the call, outside the trace that folds away. */
export const InChat: Story = {
  render: () => (
    <StaticFeatureConfigProvider config={{ scheduled: { enabled: true } }}>
      <SeedStoredItem>
        <MessageContent
          messageId="message-reminder"
          content={reminderTurn}
          createdAt="2026-11-08T10:00:00Z"
          updatedAt="2026-11-08T10:00:04Z"
        />
      </SeedStoredItem>
    </StaticFeatureConfigProvider>
  ),
};
