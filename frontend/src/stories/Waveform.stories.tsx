import { useSyntheticBars } from "./helpers/useSyntheticBars";
import {
  Waveform,
  audioLevelsToBarHeights,
} from "../components/ui/Chat/Waveform";

import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta<typeof Waveform> = {
  title: "UI/ChatInput/Waveform",
  component: Waveform,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Pure visual primitive: N rounded bars at the heights given. No audio knowledge — feed it any pre-computed pixel array. Audio-aware consumers should run their raw analyser values through `audioLevelsToBarHeights` first.",
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    heights: { control: "object" },
    barCount: { control: { type: "number", min: 1, max: 12, step: 1 } },
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
    heights: audioLevelsToBarHeights([3, 5, 7, 5, 3]),
  },
};

export const Flat: Story = {
  args: {
    heights: audioLevelsToBarHeights([2, 2, 2, 2, 2]),
  },
};

export const Asymmetric: Story = {
  args: {
    heights: audioLevelsToBarHeights([2, 3, 5, 7, 4]),
  },
};

export const Bolder: Story = {
  args: {
    heights: audioLevelsToBarHeights([3, 5, 7, 5, 3]),
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
    heights: audioLevelsToBarHeights([2, 4, 6, 8, 6, 4, 2], 24),
    barCount: 7,
    containerHeightClassName: "h-7",
  },
};

export const RawPixelHeights: Story = {
  args: {
    heights: [4, 8, 12, 16, 12, 8, 4],
    barCount: 7,
    containerHeightClassName: "h-5",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Demonstrates the primitive's intent: feed it pixel heights directly. Non-audio consumers can synthesize any visual without going through `audioLevelsToBarHeights`.",
      },
    },
  },
};

function AnimatedWaveform() {
  const bars = useSyntheticBars();
  return <Waveform heights={audioLevelsToBarHeights(bars)} animated />;
}

export const Animated: Story = {
  render: () => <AnimatedWaveform />,
  parameters: {
    docs: {
      description: {
        story:
          "Synthetic sine-wave drive of raw audio levels passed through `audioLevelsToBarHeights` — what live audio levels look like.",
      },
    },
  },
};
