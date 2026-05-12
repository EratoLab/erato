import clsx from "clsx";

import { Button } from "../Controls/Button";
import { StopIcon } from "../icons";
import { Waveform, audioLevelsToBarHeights } from "./Waveform";

interface WaveformButtonProps {
  /** Click handler — typically stops the active audio session. */
  onClick: () => void;
  /** Live bar values driven by an audio level analyser. */
  bars: readonly number[];
  disabled?: boolean;
  /** Action name on the button itself (e.g. "Stop dictation"). */
  ariaLabel: string;
  /**
   * State announcement for screen readers (e.g. "Dictating", "Recording").
   * Rendered as `role="status"` so assistive tech is told the audio session
   * has begun without the user having to focus the button.
   */
  statusLabel: string;
  /**
   * When true, the bars are dimmed to signal that the session is still
   * being established — audio is captured locally but not yet transmitted.
   * Pressing the button still cancels the in-flight startup.
   */
  isBuffering?: boolean;
  /**
   * Optional test-ids for the three rendered nodes. Existing tests keep
   * the legacy strings; new consumers should pick stable names per node.
   */
  testIds?: {
    /** data-testid forwarded to the button itself. */
    root?: string;
    /** data-testid forwarded to the inner waveform. */
    waveform?: string;
    /** data-testid forwarded to the absolute stop-icon overlay. */
    stopIcon?: string;
  };
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
  statusLabel,
  isBuffering = false,
  testIds,
}: WaveformButtonProps) {
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={onClick}
        disabled={disabled}
        className="group relative overflow-hidden"
        aria-label={ariaLabel}
        data-testid={testIds?.root}
        icon={
          <span className="relative flex size-5 items-center justify-center text-[var(--theme-fg-primary)]">
            <Waveform
              heights={audioLevelsToBarHeights(bars)}
              animated
              testId={testIds?.waveform}
              className={clsx(
                "group-hover:opacity-0 group-focus-visible:opacity-0 motion-safe:transition-opacity motion-safe:duration-150",
                isBuffering && "opacity-50",
              )}
            />
            <span
              data-testid={testIds?.stopIcon}
              className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 motion-safe:transition-opacity motion-safe:duration-150"
            >
              <StopIcon className="size-4" />
            </span>
          </span>
        }
      />
      <span role="status" className="sr-only">
        {statusLabel}
      </span>
    </>
  );
}
