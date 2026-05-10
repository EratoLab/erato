import { action } from "@storybook/addon-actions";

import { useSyntheticBars } from "./helpers/useSyntheticBars";
import { WaveformButton } from "../components/ui/Chat/WaveformButton";

import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta<typeof WaveformButton> = {
  title: "UI/ChatInput/WaveformButton",
  component: WaveformButton,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Button used while an audio session is actively running. Renders a live waveform that swaps to a StopIcon on hover/focus. Both audio transcription and dictation use this for their active state — keeping the interaction visually identical.",
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    onClick: { action: "stop clicked" },
    bars: { control: "object" },
    disabled: { control: "boolean" },
    ariaLabel: { control: "text" },
  },
  decorators: [
    (Story) => (
      <div className="flex items-center justify-center bg-theme-bg-primary p-8">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const StaticBars: Story = {
  name: "Static bars (no live drive)",
  args: {
    onClick: action("stop"),
    bars: [3, 5, 7, 5, 3],
    ariaLabel: "Stop audio recording",
    statusLabel: "Recording audio",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Snapshot of the active state with a fixed bar pattern. Hover or focus to reveal the StopIcon overlay.",
      },
    },
  },
};

export const Disabled: Story = {
  args: {
    onClick: action("stop"),
    bars: [3, 5, 7, 5, 3],
    ariaLabel: "Stop audio recording",
    statusLabel: "Recording audio",
    disabled: true,
  },
};

function AnimatedBars({
  onClick,
  ariaLabel,
  statusLabel,
  disabled,
}: {
  onClick: () => void;
  ariaLabel: string;
  statusLabel: string;
  disabled?: boolean;
}) {
  const bars = useSyntheticBars();
  return (
    <WaveformButton
      onClick={onClick}
      bars={bars}
      ariaLabel={ariaLabel}
      statusLabel={statusLabel}
      disabled={disabled}
    />
  );
}

export const Animated: Story = {
  name: "Live waveform (synthetic)",
  render: (args) => (
    <AnimatedBars
      onClick={() => args.onClick()}
      ariaLabel={args.ariaLabel}
      statusLabel={args.statusLabel}
      disabled={args.disabled}
    />
  ),
  args: {
    onClick: action("stop"),
    bars: [3, 5, 7, 5, 3],
    ariaLabel: "Stop audio recording",
    statusLabel: "Recording audio",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Synthetic sine-wave drive of `bars` so the recording UI animates without microphone access. Hover or focus to reveal the StopIcon.",
      },
    },
  },
};
