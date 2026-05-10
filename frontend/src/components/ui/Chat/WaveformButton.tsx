import { Button } from "../Controls/Button";
import { StopIcon } from "../icons";
import { Waveform } from "./Waveform";

interface WaveformButtonProps {
  /** Click handler — typically stops the active audio session. */
  onClick: () => void;
  /** Live bar values driven by an audio level analyser. */
  bars: readonly number[];
  disabled?: boolean;
  ariaLabel: string;
  /** data-testid forwarded to the button itself. */
  testId?: string;
  /** data-testid forwarded to the inner waveform. */
  waveformTestId?: string;
  /** data-testid forwarded to the absolute stop-icon overlay. */
  stopIconTestId?: string;
}

/**
 * Composite control used while an audio session is actively running. Renders
 * a live waveform that swaps to a StopIcon on hover/focus so the user can
 * end the session. Built on the shared `Button` so outer geometry matches
 * sibling icon buttons (send, model selector, etc.).
 *
 * Both audio transcription and dictation render this when in their active
 * state — keeping the "waveform → stop" interaction visually identical.
 */
export function WaveformButton({
  onClick,
  bars,
  disabled,
  ariaLabel,
  testId,
  waveformTestId,
  stopIconTestId,
}: WaveformButtonProps) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className="group relative overflow-hidden"
      aria-label={ariaLabel}
      aria-pressed
      data-testid={testId}
      icon={
        <span className="relative flex size-5 items-center justify-center text-[var(--theme-fg-primary)]">
          <Waveform
            bars={bars}
            animated
            testId={waveformTestId}
            className="transition-opacity duration-150 group-hover:opacity-0 group-focus-visible:opacity-0"
          />
          <span
            data-testid={stopIconTestId}
            className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            <StopIcon className="size-4" />
          </span>
        </span>
      }
    />
  );
}
