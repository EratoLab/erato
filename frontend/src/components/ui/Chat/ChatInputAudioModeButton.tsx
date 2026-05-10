import { t } from "@lingui/core/macro";

import { Waveform } from "./Waveform";
import { WaveformButton } from "./WaveformButton";
import { Button } from "../Controls/Button";

// Symmetric, gently peaked pattern shown in idle (resting) state. Values
// flow through the same `max(v, 2) * 2` scale + 14px clamp as live bars,
// so these map to {6px, 10px, 14px, 10px, 6px}.
export const AUDIO_MODE_STATIC_BAR_PATTERN: readonly number[] = [3, 5, 7, 5, 3];

interface ChatInputAudioModeButtonProps {
  /** Click handler — starts a recording when idle, stops one when active. */
  onClick: () => void;
  /** True while a transcription recording is active. */
  isRecording: boolean;
  /** Live bar heights from `useAudioTranscriptionRecorder.recordingBars`. */
  recordingBars?: readonly number[];
  /** Optional override for the resting-state pattern. */
  staticBars?: readonly number[];
  disabled?: boolean;
}

/**
 * Replaces the send button when the chat input is empty and audio
 * transcription is enabled. Idle state shows a static waveform; recording
 * state delegates to `WaveformButton` so it shares the active-audio
 * interaction with the dictation feature.
 */
export function ChatInputAudioModeButton({
  onClick,
  isRecording,
  recordingBars,
  staticBars = AUDIO_MODE_STATIC_BAR_PATTERN,
  disabled,
}: ChatInputAudioModeButtonProps) {
  if (isRecording) {
    return (
      <WaveformButton
        onClick={onClick}
        bars={recordingBars ?? staticBars}
        disabled={disabled}
        ariaLabel={t`Stop audio recording`}
        testId="chat-input-audio-mode-stop"
        waveformTestId="chat-input-audio-mode-recording-waveform"
        stopIconTestId="chat-input-audio-mode-stop-icon"
      />
    );
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={onClick}
      disabled={disabled}
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
