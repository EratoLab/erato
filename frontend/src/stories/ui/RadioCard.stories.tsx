import { useState } from "react";

import { RadioCard } from "@/components/ui/Controls/RadioCard";
import { StatusPill } from "@/components/ui/Feedback/StatusPill";
import { ChatBubbleIcon, ComputerIcon } from "@/components/ui/icons";

import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/RadioCard",
  component: RadioCard,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "One row of a radio group as a clickable card. The helper text steps up from the muted to the secondary foreground on the chosen card, so it keeps 4.5:1 against the selected fill in light and dark theme.",
      },
    },
  },
} satisfies Meta<typeof RadioCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const ChannelPicker = ({ size }: { size: "sm" | "md" }) => {
  const [value, setValue] = useState("teams");

  return (
    <fieldset className="grid max-w-xl gap-3">
      <legend className="mb-2 font-semibold text-theme-fg-primary">
        Deliver via
      </legend>
      <RadioCard
        name={`channel-${size}`}
        value="teams"
        checked={value === "teams"}
        onChange={() => setValue("teams")}
        size={size}
        icon={<ChatBubbleIcon className="size-5" />}
        label="Teams chat"
        helper="Your chat with Erato in Microsoft Teams"
        trailing={<StatusPill tone="success">Connected</StatusPill>}
      />
      <RadioCard
        name={`channel-${size}`}
        value="browser"
        checked={value === "browser"}
        onChange={() => setValue("browser")}
        size={size}
        icon={<ComputerIcon className="size-5" />}
        label="Browser notification"
        helper="A notification from your browser while Erato is open"
      />
      <RadioCard
        name={`channel-${size}`}
        value="desktop"
        checked={false}
        onChange={() => undefined}
        size={size}
        disabled
        icon={<ComputerIcon className="size-5" />}
        label="Desktop notification"
        helper="A notification on your computer, through the Erato desktop app"
        trailing={<StatusPill tone="muted">Coming later</StatusPill>}
      />
    </fieldset>
  );
};

/** The chosen card's helper text, at the compact and the tile size. */
export const SelectedHelperText: Story = {
  args: {
    name: "channel",
    value: "teams",
    checked: true,
    onChange: () => undefined,
    label: "Teams chat",
  },
  render: () => (
    <div className="space-y-8">
      <ChannelPicker size="sm" />
      <ChannelPicker size="md" />
    </div>
  ),
};
