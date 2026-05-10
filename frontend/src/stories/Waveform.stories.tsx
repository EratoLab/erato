import { useEffect, useState } from "react";

import { Waveform } from "../components/ui/Chat/Waveform";

import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta<typeof Waveform> = {
  title: "UI/ChatInput/Waveform",
  component: Waveform,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Pure visual primitive: N rounded bars with heights driven by the `bars` array. No audio knowledge — feed it any numeric series. Used by `WaveformButton` for live audio levels and by the audio-mode button for its resting pattern.",
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    bars: { control: "object" },
    barCount: { control: { type: "number", min: 1, max: 12, step: 1 } },
    maxHeightPx: { control: { type: "number", min: 4, max: 64, step: 1 } },
    containerHeightClassName: { control: "text" },
    barWidthClassName: { control: "text" },
    gapClassName: { control: "text" },
    animated: { control: "boolean" },
  },
  decorators: [
    (Story) => (
      <div className="flex items-center justify-center bg-theme-bg-primary p-8 text-[var(--theme-fg-primary)]">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const StaticPeak: Story = {
  args: {
    bars: [3, 5, 7, 5, 3],
  },
};

export const Flat: Story = {
  args: {
    bars: [2, 2, 2, 2, 2],
  },
};

export const Asymmetric: Story = {
  args: {
    bars: [2, 3, 5, 7, 4],
  },
};

export const Bolder: Story = {
  args: {
    bars: [3, 5, 7, 5, 3],
    barWidthClassName: "w-1",
    gapClassName: "gap-1",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Reverts to the original (pre-cleanup) bolder bar style — useful for comparing density.",
      },
    },
  },
};

export const SevenBarsTaller: Story = {
  args: {
    bars: [2, 4, 6, 8, 6, 4, 2],
    barCount: 7,
    maxHeightPx: 24,
    containerHeightClassName: "h-7",
  },
};

function AnimatedWaveform() {
  const [bars, setBars] = useState<number[]>([2, 4, 6, 4, 2]);

  useEffect(() => {
    let tick = 0;
    const intervalId = window.setInterval(() => {
      tick += 1;
      setBars([
        2 + Math.round(Math.abs(Math.sin(tick * 0.6)) * 6),
        2 + Math.round(Math.abs(Math.sin(tick * 0.6 + 0.6)) * 6),
        2 + Math.round(Math.abs(Math.sin(tick * 0.6 + 1.2)) * 6),
        2 + Math.round(Math.abs(Math.sin(tick * 0.6 + 1.8)) * 6),
        2 + Math.round(Math.abs(Math.sin(tick * 0.6 + 2.4)) * 6),
      ]);
    }, 90);
    return () => window.clearInterval(intervalId);
  }, []);

  return <Waveform bars={bars} animated />;
}

export const Animated: Story = {
  render: () => <AnimatedWaveform />,
  parameters: {
    docs: {
      description: {
        story:
          "Synthetic sine-wave drive of the `bars` prop with `animated` enabled — what live audio levels look like.",
      },
    },
  },
};
