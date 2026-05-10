import clsx from "clsx";

export const DEFAULT_WAVEFORM_BAR_COUNT = 5;
export const DEFAULT_WAVEFORM_MAX_BAR_HEIGHT_PX = 14;

interface WaveformProps {
  /**
   * Final per-bar heights in pixels. Indexes beyond `heights.length` fall
   * back to a 2px minimum so the component is safe against short arrays.
   * Callers that have raw audio levels should use
   * `audioLevelsToBarHeights` (or `audioLevelToBarHeightPx`) to convert.
   */
  heights: readonly number[];
  /** Number of bars to render. Defaults to 5 to match the audio hooks. */
  barCount?: number;
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

/**
 * Maps a single raw audio-level value (the `[2, ~16]` range emitted by the
 * audio hooks' analyser) to a clamped pixel height. Lives next to
 * `Waveform` so audio-aware consumers don't have to reinvent the math, but
 * stays separate so `Waveform` itself remains a pure visual primitive.
 */
export function audioLevelToBarHeightPx(
  value: number,
  maxHeightPx = DEFAULT_WAVEFORM_MAX_BAR_HEIGHT_PX,
): number {
  return Math.min(Math.max(value, 2) * 2, maxHeightPx);
}

export function audioLevelsToBarHeights(
  values: readonly number[],
  maxHeightPx = DEFAULT_WAVEFORM_MAX_BAR_HEIGHT_PX,
): number[] {
  return values.map((value) => audioLevelToBarHeightPx(value, maxHeightPx));
}

/**
 * Pure visual primitive: renders N rounded bars at the heights given. Has
 * no audio knowledge — feed it any pre-computed pixel array. Used by
 * `WaveformButton` for live audio levels and by the audio-mode button for
 * its static resting pattern.
 */
export function Waveform({
  heights,
  barCount = DEFAULT_WAVEFORM_BAR_COUNT,
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
        const heightPx = heights[barIndex] ?? 2;
        return (
          <span
            key={barIndex}
            className={clsx(
              "rounded-full bg-current",
              barWidthClassName,
              animated &&
                "motion-safe:transition-[height] motion-safe:duration-75",
            )}
            style={{ height: `${heightPx}px` }}
          />
        );
      })}
    </span>
  );
}
