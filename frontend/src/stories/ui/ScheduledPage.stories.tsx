import { action } from "@storybook/addon-actions";
import { userEvent, within } from "@storybook/test";

import { ChatHistorySidebar } from "@/components/ui";
import {
  createScheduledItemFixtures,
  SCHEDULED_TEMPLATE_FIXTURES,
} from "@/components/ui/Scheduled/scheduledFixtures";
import { ScheduledPageView } from "@/pages/ScheduledPage";
import { FeatureConfigProvider } from "@/providers/FeatureConfigProvider";

import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Pages/Scheduled",
  component: ScheduledPageView,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The Scheduled page view with sample data; the route page feeds it from the scheduled items API. Page-level copy stays generic; the type and the channel only appear in a row's meta line.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ height: "100vh" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    items: createScheduledItemFixtures(new Date()),
    templates: SCHEDULED_TEMPLATE_FIXTURES,
    onNewReminder: action("New reminder"),
    onTemplateSelect: action("Template selected"),
    onEdit: action("Edit"),
    onSnooze: action("Snooze"),
    onCancel: action("Cancel"),
    onOpenLinkedChat: action("Open linked chat"),
    onScheduleAgain: action("Schedule again"),
    onDelete: action("Delete"),
  },
} satisfies Meta<typeof ScheduledPageView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing scheduled yet: the empty state with the templates. */
export const Empty: Story = {
  args: { items: [] },
};

/** Upcoming items by day, with the failed item as an alert above them. */
export const WithItems: Story = {};

/**
 * Past with a failed delivery, whose row says what to check, and an item
 * cancelled before its time, which was planned for it rather than due.
 */
export const PastTab: Story = {
  args: {
    initialTab: "past",
    items: [
      ...createScheduledItemFixtures(new Date()),
      {
        id: "fixture-cancelled-ahead",
        type: "reminder",
        name: "Remind the team about the stocktake",
        status: "cancelled",
        dueAt: new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString(),
        channel: "teams_chat",
      },
    ],
  },
};

/** Only upcoming items, so no failure alert. */
export const WithoutFailures: Story = {
  args: {
    items: createScheduledItemFixtures(new Date()).filter(
      (item) => item.status !== "failed",
    ),
  },
};

export const NewMenuOpen: Story = {
  args: { items: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The preview loads the catalog after the first render.
    await userEvent.click(
      await canvas.findByRole("button", { name: "New" }, { timeout: 5000 }),
    );
  },
};

/** "Create with chat" is enabled once a handler is passed (ERMAIN-1143). */
export const NewMenuWithCreateWithChat: Story = {
  args: { items: [], onCreateWithChat: action("Create with chat") },
  play: NewMenuOpen.play,
};

export const RowMenuOpen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole(
        "button",
        { name: "Actions for Follow up on the offer for Müller GmbH" },
        { timeout: 5000 },
      ),
    );
  },
};

/** A past row's menu: schedule the same again, or delete it for good. */
export const PastRowMenuOpen: Story = {
  args: { initialTab: "past" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole(
        "button",
        { name: "Actions for Call Ms Schulz back about the delivery date" },
        { timeout: 5000 },
      ),
    );
  },
};

/** Counts from the API, where Past lists only the latest items. */
export const WithApiCounts: Story = {
  args: { counts: { upcoming: 4, past: 128 } },
};

/** No delivery channel reaches the user yet. */
export const DeliveryNotSetUp: Story = {
  args: { notice: { kind: "delivery_not_set_up" } },
};

/** Nothing set up yet, on an empty page. */
export const DeliveryNotSetUpEmpty: Story = {
  args: { items: [], notice: { kind: "delivery_not_set_up" } },
};

/** The deployment delivers through no channel. */
export const DeliveryUnavailable: Story = {
  args: { notice: { kind: "delivery_unavailable" } },
};

/** The user has the maximum number of upcoming items (4 in the sample). */
export const LimitReached: Story = {
  args: { notice: { kind: "limit_reached", max: 4 }, maxUpcoming: 4 },
};

/** At the limit, New → Reminder is disabled and says why. */
export const LimitReachedNewMenu: Story = {
  args: LimitReached.args,
  play: NewMenuOpen.play,
};

export const Loading: Story = {
  args: { items: [], isLoading: true },
};

export const LoadError: Story = {
  args: { items: [], error: new Error("Network error") },
};

/** The sidebar entry, after Assistants, with the Scheduled flag on. */
export const SidebarEntry: Story = {
  render: () => (
    <FeatureConfigProvider
      config={{ scheduled: { enabled: true }, assistants: { enabled: true } }}
    >
      <ChatHistorySidebar
        sessions={[]}
        currentSessionId=""
        onSessionSelect={action("Session selected")}
        onSessionArchive={action("Session archived")}
        onSessionUnarchive={action("Session unarchived")}
        isLoading={false}
      />
    </FeatureConfigProvider>
  ),
};
