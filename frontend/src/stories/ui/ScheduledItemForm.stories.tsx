import { action } from "@storybook/addon-actions";

import { Card } from "@/components/ui/Container/Card";
import { PageHeader } from "@/components/ui/Container/PageHeader";
import { ScheduledItemForm } from "@/components/ui/Scheduled/ScheduledItemForm";
import { SCHEDULED_TEMPLATE_FIXTURES } from "@/components/ui/Scheduled/scheduledFixtures";
import {
  emptyScheduledFormValues,
  scheduledFormValuesFromTemplate,
} from "@/components/ui/Scheduled/scheduledForm";

import type { ScheduledItemFormProps } from "@/components/ui/Scheduled/ScheduledItemForm";
import type { Meta, StoryObj } from "@storybook/react";

// Saturday, 7 November 2026, 12:00 in Berlin.
const NOW = new Date("2026-11-07T11:00:00Z");
const TIME_ZONE = "Europe/Berlin";

const CHATS = [
  { id: "chat-offer", title: "Offer Müller GmbH, sea freight" },
  { id: "chat-rates", title: "Q4 rate comparison" },
  { id: "chat-packing", title: "Packing list check, container 4711" },
];

const fromTemplate = scheduledFormValuesFromTemplate(
  SCHEDULED_TEMPLATE_FIXTURES[0],
  NOW,
  TIME_ZONE,
);

type StoryArgs = ScheduledItemFormProps & { title: string; subtitle: string };

/** The form inside the page's header and card, as the route renders it. */
function FormPage({ title, subtitle, ...form }: StoryArgs) {
  return (
    <div className="flex min-h-screen flex-col bg-theme-bg-secondary">
      <PageHeader density="compact" title={title} subtitle={subtitle} />
      <div className="mx-auto w-full max-w-4xl px-4 py-6">
        <Card variant="surface" size="xl">
          <ScheduledItemForm {...form} />
        </Card>
      </div>
    </div>
  );
}

const meta = {
  title: "Pages/Scheduled item form",
  component: FormPage,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The one form for creating and editing a scheduled item. Times are entered in the user's stored zone, which the form never names; only the delivery settings name a channel.",
      },
    },
  },
  args: {
    title: "New reminder",
    subtitle: "Choose when it happens and what you receive.",
    mode: "create",
    initialValues: emptyScheduledFormValues(NOW, TIME_ZONE),
    channelStatus: "connected",
    chats: CHATS,
    now: NOW,
    timeZone: TIME_ZONE,
    onSubmit: action("Submit"),
    onCancel: action("Cancel"),
  },
} satisfies Meta<typeof FormPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const New: Story = {};

export const FromTemplate: Story = {
  args: {
    subtitle:
      "Filled in from the template “Follow up on an offer”. Change anything you like.",
    initialValues: {
      ...fromTemplate,
      date: "2026-11-13",
      time: "10:00",
      linkedChatId: "chat-offer",
    },
  },
};

export const Edit: Story = {
  args: {
    title: "Edit reminder",
    subtitle: "Changes apply to what has not happened yet.",
    mode: "edit",
    initialValues: {
      ...fromTemplate,
      name: "Prepare for the Q4 rate call with Nordhafen Logistik",
      message: "Bring the rate comparison from last week.",
      date: "2026-11-09",
      time: "08:30",
      linkedChatId: "chat-rates",
    },
  },
};

/**
 * A snoozed item: the fields keep its schedule, the summary says the snooze
 * until the schedule is changed.
 */
export const EditSnoozed: Story = {
  args: {
    title: "Edit reminder",
    subtitle: "Changes apply to what has not happened yet.",
    mode: "edit",
    initialValues: {
      ...fromTemplate,
      date: "2026-11-07",
      time: "10:00",
    },
    snoozedUntil: "2026-11-08T08:00:00Z",
  },
};

export const RepeatingWeekly: Story = {
  args: {
    initialValues: {
      ...fromTemplate,
      triggerKind: "repeat",
      frequency: "weekly",
      weekdays: ["mon", "thu"],
      date: "2026-11-09",
      time: "09:00",
      endKind: "after_count",
      endCount: "8",
    },
  },
};

export const RepeatingMonthlyUntilADate: Story = {
  args: {
    initialValues: {
      ...fromTemplate,
      triggerKind: "repeat",
      frequency: "monthly",
      date: "2026-11-30",
      time: "16:00",
      endKind: "on_date",
      endDate: "2027-06-30",
    },
  },
};

/**
 * No channel reaches the user yet: the route opens the delivery settings up
 * front, so the setup hint shows before the first try.
 */
export const ChannelNotSetUp: Story = {
  args: {
    initialValues: fromTemplate,
    channelStatus: "not_set_up",
    teamsAppName: "Acme Assistant",
    initialAdvancedOpen: true,
  },
};

/**
 * The API refused the channel; the delivery settings open on the error and
 * the channel takes focus.
 */
export const ChannelRefused: Story = {
  args: {
    initialValues: fromTemplate,
    channelStatus: "not_set_up",
    serverErrors: {
      channel: "This delivery channel can't reach you yet. Set it up first.",
    },
  },
};

export const ValidationErrors: Story = {
  args: {
    initialValues: {
      ...emptyScheduledFormValues(NOW, TIME_ZONE),
      date: "2026-11-06",
    },
    initialShowErrors: true,
  },
};

export const RepeatingValidationErrors: Story = {
  args: {
    initialValues: {
      ...fromTemplate,
      triggerKind: "repeat",
      frequency: "weekly",
      weekdays: [],
      endKind: "after_count",
      endCount: "0",
    },
    initialShowErrors: true,
  },
};

/** A refusal for the form as a whole, next to the button, scrolled to and focused. */
export const LimitReached: Story = {
  args: {
    initialValues: fromTemplate,
    formError:
      "You have the maximum number of upcoming items. Cancel one first.",
  },
};

export const Submitting: Story = {
  args: { initialValues: fromTemplate, isSubmitting: true },
};
