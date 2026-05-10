import { action } from "@storybook/addon-actions";

import { useSyntheticBars } from "./helpers/useSyntheticBars";
import { ChatInputAudioModeButton } from "../components/ui/Chat/ChatInputAudioModeButton";


import type { Meta, StoryObj } from "@storybook/react";

// Loose typing because the component's props are a discriminated union and
// Storybook's `args` inference collapses to `never` for unions.
const meta: Meta = {
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
  decorators: [
    (Story) => (
      <div className="flex items-center justify-center bg-theme-bg-primary p-8">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj;

export const Idle: Story = {
  render: () => (
    <ChatInputAudioModeButton
      isRecording={false}
      onToggle={action("toggle")}
    />
  ),
};

export const IdleDisabled: Story = {
  render: () => (
    <ChatInputAudioModeButton
      isRecording={false}
      onToggle={action("toggle")}
      disabled
    />
  ),
};

export const RecordingStaticBars: Story = {
  name: "Recording (frozen bars)",
  render: () => (
    <ChatInputAudioModeButton
      isRecording
      recordingBars={[3, 5, 7, 5, 3]}
      onToggle={action("toggle")}
    />
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Recording state with a fixed bar snapshot — useful for visual review. Hover or focus the button to reveal the StopIcon.",
      },
    },
  },
};

/**
 * Drives `recordingBars` with a synthetic, deterministic waveform so the
 * recording state can be inspected in Storybook without microphone access.
 */
function AnimatedRecordingButton({ disabled }: { disabled?: boolean }) {
  const bars = useSyntheticBars();
  return (
    <ChatInputAudioModeButton
      isRecording
      recordingBars={bars}
      onToggle={action("toggle")}
      disabled={disabled}
    />
  );
}

export const RecordingAnimated: Story = {
  name: "Recording (live waveform)",
  render: () => <AnimatedRecordingButton />,
  parameters: {
    docs: {
      description: {
        story:
          "Synthetic waveform animates `recordingBars` so the live recording UI can be inspected without microphone permissions. Hover or focus to reveal the StopIcon overlay.",
      },
    },
  },
};
