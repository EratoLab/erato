import { t } from "@lingui/core/macro";

import { Waveform, audioLevelsToBarHeights } from "./Waveform";
import { WaveformButton } from "./WaveformButton";
import { Button } from "../Controls/Button";
import { LoadingIcon } from "../icons";

// Symmetric, gently peaked pattern shown in idle (resting) state. Values
// flow through the same `max(v, 2) * 2` scale + 14px clamp as live bars,
// so these map to {6px, 10px, 14px, 10px, 6px}.
export const AUDIO_MODE_STATIC_BAR_PATTERN: readonly number[] = [3, 5, 7, 5, 3];

type ChatInputAudioModeButtonCommonProps = {
  /** Toggle handler - starts listening when idle, stops when active. */
  onToggle: () => void;
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
    /** Live bar heights from the active conversational dictation session. */
    recordingBars: readonly number[];
    /**
     * True while the session is still starting up (handshake, VAD model
     * load, mic warm-up) — i.e. before real audio is captured. Shows a
     * loading spinner instead of a live-looking waveform so the user
     * isn't invited to speak before the microphone actually delivers
     * audio. Clicking still stops/cancels audio mode.
     */
    isStarting?: boolean;
  };

type ChatInputAudioModeButtonProps =
  | ChatInputAudioModeButtonIdleProps
  | ChatInputAudioModeButtonRecordingProps;

/**
 * Replaces the send button when the chat input is empty and conversational
 * audio mode is available. Idle state shows a static waveform; listening
 * state delegates to `WaveformButton` for the shared waveform-stop affordance.
 */
export function ChatInputAudioModeButton(props: ChatInputAudioModeButtonProps) {
  if (props.isRecording) {
    if (props.isStarting) {
      return (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={props.onToggle}
          disabled={props.disabled}
          aria-label={t`Stop audio mode`}
          title={t`Stop audio mode`}
          data-testid="chat-input-audio-mode-stop"
          icon={
            <LoadingIcon
              className="size-4 animate-spin text-[var(--theme-fg-primary)]"
              data-testid="chat-input-audio-mode-starting-icon"
            />
          }
        />
      );
    }

    return (
      <WaveformButton
        onClick={props.onToggle}
        bars={props.recordingBars}
        disabled={props.disabled}
        ariaLabel={t`Stop audio mode`}
        statusLabel={t`Listening`}
        testIds={{
          root: "chat-input-audio-mode-stop",
          waveform: "chat-input-audio-mode-recording-waveform",
          stopIcon: "chat-input-audio-mode-stop-icon",
        }}
      />
    );
  }

  const staticBars = props.staticBars ?? AUDIO_MODE_STATIC_BAR_PATTERN;

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={props.onToggle}
      disabled={props.disabled}
      aria-label={t`Start audio mode`}
      title={t`Start audio mode`}
      data-testid="chat-input-audio-mode-start"
      icon={
        <Waveform
          heights={audioLevelsToBarHeights(staticBars)}
          testId="chat-input-audio-mode-static-waveform"
          className="text-[var(--theme-fg-primary)]"
        />
      }
    />
  );
}
