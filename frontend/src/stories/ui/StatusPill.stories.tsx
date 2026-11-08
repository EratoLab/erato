import { StatusPill } from "@/components/ui/Feedback/StatusPill";
import {
  SCHEDULED_ITEM_STATUSES,
  ScheduledStatusPill,
} from "@/components/ui/Scheduled/ScheduledStatusPill";

import type { StatusPillTone } from "@/components/ui/Feedback/StatusPill";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/Feedback/StatusPill",
  component: StatusPill,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "A bordered pill naming an item's state. `ScheduledStatusPill` maps the generic scheduled-item statuses to one tone each: Scheduled info, Snoozed muted, Done success, Failed error, Cancelled muted.",
      },
    },
  },
} satisfies Meta<typeof StatusPill>;

export default meta;
type Story = StoryObj<typeof meta>;

const TONES: StatusPillTone[] = [
  "info",
  "success",
  "warning",
  "error",
  "muted",
];

export const Tones: Story = {
  args: { tone: "info", children: "Info" },
  render: () => (
    <div className="flex flex-wrap gap-2">
      {TONES.map((tone) => (
        <StatusPill key={tone} tone={tone}>
          {tone}
        </StatusPill>
      ))}
    </div>
  ),
};

export const ScheduledItemStatuses: Story = {
  args: { tone: "info", children: "Scheduled" },
  render: () => (
    <div className="flex flex-wrap gap-2">
      {SCHEDULED_ITEM_STATUSES.map((status) => (
        <ScheduledStatusPill key={status} status={status} />
      ))}
    </div>
  ),
};
