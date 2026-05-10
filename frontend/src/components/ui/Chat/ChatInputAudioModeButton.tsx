import { t } from "@lingui/core/macro";

import { Waveform } from "./Waveform";
import { WaveformButton } from "./WaveformButton";
import { Button } from "../Controls/Button";

// Symmetric, gently peaked pattern shown in idle (resting) state. Values
// flow through the same `max(v, 2) * 2` scale + 14px clamp as live bars,
// so these map to {6px, 10px, 14px, 10px, 6px}.
export const AUDIO_MODE_STATIC_BAR_PATTERN: readonly number[] = [3, 5, 7, 5, 3];

type ChatInputAudioModeButtonCommonProps = {
  /** Click handler — starts a recording when idle, stops one when active. */
  onClick: () => void;
  disabled?: boolean;
};

type ChatInputAudioModeButtonIdleProps = ChatInputAudioModeButtonCommonProps & {
  isRecording: false;
  /** Optional override for the resting-state pattern. */
  staticBars?: readonly number[];
};

type ChatInputAudioModeButtonRecordingProps =
  ChatInputAudioModeButtonCommonProps & {
    isRecording: true;
    /** Live bar heights from `useAudioTranscriptionRecorder.recordingBars`. */
    recordingBars: readonly number[];
  };

type ChatInputAudioModeButtonProps =
  | ChatInputAudioModeButtonIdleProps
  | ChatInputAudioModeButtonRecordingProps;

/**
 * Replaces the send button when the chat input is empty and audio
 * transcription is enabled. Idle state shows a static waveform; recording
 * state delegates to `WaveformButton` so it shares the active-audio
 * interaction with the dictation feature.
 */
export function ChatInputAudioModeButton(props: ChatInputAudioModeButtonProps) {
  if (props.isRecording) {
    return (
      <WaveformButton
        onClick={props.onClick}
        bars={props.recordingBars}
        disabled={props.disabled}
        ariaLabel={t`Stop audio recording`}
        statusLabel={t`Recording audio`}
        testId="chat-input-audio-mode-stop"
        waveformTestId="chat-input-audio-mode-recording-waveform"
        stopIconTestId="chat-input-audio-mode-stop-icon"
      />
    );
  }

  const staticBars = props.staticBars ?? AUDIO_MODE_STATIC_BAR_PATTERN;

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={t`Start audio mode`}
      data-testid="chat-input-audio-mode-start"
      icon={
        <Waveform
          bars={staticBars}
          testId="chat-input-audio-mode-static-waveform"
          className="text-[var(--theme-fg-primary)]"
        />
      }
    />
  );
}
