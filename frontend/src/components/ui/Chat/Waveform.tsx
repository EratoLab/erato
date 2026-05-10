import clsx from "clsx";

export const DEFAULT_WAVEFORM_BAR_COUNT = 5;
export const DEFAULT_WAVEFORM_MAX_BAR_HEIGHT_PX = 14;

interface WaveformProps {
  /**
   * Per-bar raw values. Indexes beyond `bars.length` fall back to the
   * minimum height so the component is safe against short arrays.
   */
  bars: readonly number[];
  /** Number of bars to render. Defaults to 5 to match the audio hooks. */
  barCount?: number;
  /**
   * Maximum rendered bar height in pixels. Raw values are scaled with
   * `max(value, 2) * 2` and then clamped to this cap.
   */
  maxHeightPx?: number;
  /** Tailwind class for the container's vertical box (e.g. "h-5"). */
  containerHeightClassName?: string;
  /** Tailwind class for individual bar width (e.g. "w-0.5"). */
  barWidthClassName?: string;
  /** Tailwind class for the gap between bars (e.g. "gap-0.5"). */
  gapClassName?: string;
  /** When true, bars animate height transitions for live audio levels. */
  animated?: boolean;
  className?: string;
  /** Forwarded data-testid for tests/Storybook. */
  testId?: string;
}

function clampBarHeightPx(value: number, maxHeightPx: number): number {
  return Math.min(Math.max(value, 2) * 2, maxHeightPx);
}

/**
 * Pure visual primitive: renders N rounded bars whose heights come from the
 * `bars` prop. Has no audio knowledge — feed it any numeric array. Used by
 * `WaveformButton` for live audio levels and by the audio-mode button for
 * its static resting pattern.
 */
export function Waveform({
  bars,
  barCount = DEFAULT_WAVEFORM_BAR_COUNT,
  maxHeightPx = DEFAULT_WAVEFORM_MAX_BAR_HEIGHT_PX,
  containerHeightClassName = "h-5",
  barWidthClassName = "w-0.5",
  gapClassName = "gap-0.5",
  animated = false,
  className,
  testId,
}: WaveformProps) {
  return (
    <span
      data-testid={testId}
      className={clsx(
        "flex items-center justify-center",
        containerHeightClassName,
        gapClassName,
        className,
      )}
    >
      {Array.from({ length: barCount }).map((_, barIndex) => {
        const rawHeight = bars[barIndex] ?? 2;
        return (
          <span
            key={barIndex}
            className={clsx(
              "rounded-full bg-current",
              barWidthClassName,
              animated && "transition-[height] duration-75",
            )}
            style={{ height: `${clampBarHeightPx(rawHeight, maxHeightPx)}px` }}
          />
        );
      })}
    </span>
  );
}
