import { action } from "@storybook/addon-actions";
import { useEffect, useRef, useState } from "react";

import { ChatInputAudioModeButton } from "../components/ui/Chat/ChatInputAudioModeButton";

import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta<typeof ChatInputAudioModeButton> = {
  title: "UI/ChatInput/AudioModeButton",
  component: ChatInputAudioModeButton,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Replaces the chat-input send button when the input is empty and audio transcription is enabled. Idle state shows a static waveform; recording state mirrors the dictation pattern (live bars + StopIcon on hover/focus).",
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    onClick: { action: "audio-mode toggled" },
    isRecording: { control: "boolean" },
    disabled: { control: "boolean" },
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

export const Idle: Story = {
  args: {
    onClick: action("toggle"),
    isRecording: false,
    disabled: false,
  },
};

export const IdleDisabled: Story = {
  args: {
    onClick: action("toggle"),
    isRecording: false,
    disabled: true,
  },
};

export const RecordingStaticBars: Story = {
  name: "Recording (no live bars)",
  args: {
    onClick: action("toggle"),
    isRecording: true,
    disabled: false,
  },
  parameters: {
    docs: {
      description: {
        story:
          "Recording state without `recordingBars` provided — falls back to the static pattern. Hover or focus the button to reveal the StopIcon.",
      },
    },
  },
};

/**
 * Drives `recordingBars` with a synthetic, deterministic waveform so the
 * recording state can be inspected in Storybook without microphone access.
 */
function AnimatedRecordingButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  const [bars, setBars] = useState<number[]>([2, 4, 6, 4, 2]);
  const tickRef = useRef(0);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      tickRef.current += 1;
      const t = tickRef.current;
      setBars([
        2 + Math.round(Math.abs(Math.sin(t * 0.6)) * 6),
        2 + Math.round(Math.abs(Math.sin(t * 0.6 + 0.6)) * 6),
        2 + Math.round(Math.abs(Math.sin(t * 0.6 + 1.2)) * 6),
        2 + Math.round(Math.abs(Math.sin(t * 0.6 + 1.8)) * 6),
        2 + Math.round(Math.abs(Math.sin(t * 0.6 + 2.4)) * 6),
      ]);
    }, 90);
    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <ChatInputAudioModeButton
      onClick={onClick}
      isRecording
      recordingBars={bars}
      disabled={disabled}
    />
  );
}

export const RecordingAnimated: Story = {
  name: "Recording (live waveform)",
  render: (args) => (
    <AnimatedRecordingButton
      onClick={() => args.onClick()}
      disabled={args.disabled}
    />
  ),
  args: {
    onClick: action("toggle"),
    isRecording: true,
    disabled: false,
  },
  parameters: {
    docs: {
      description: {
        story:
          "Synthetic waveform animates `recordingBars` so the live recording UI can be inspected without microphone permissions. Hover or focus to reveal the StopIcon overlay.",
      },
    },
  },
};
