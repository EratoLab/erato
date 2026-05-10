import { useEffect, useState } from "react";

interface UseSyntheticBarsOptions {
  /** Number of bars to synthesize. */
  barCount?: number;
  /** Update interval in ms. */
  intervalMs?: number;
  /** Frequency multiplier — higher values move faster. */
  speed?: number;
  /** Amplitude added on top of the 2-unit minimum. */
  amplitude?: number;
}

/**
 * Storybook-only hook that drives a deterministic, sine-based fake audio
 * level for the `Waveform` / `WaveformButton` stories. Lets us inspect the
 * recording UI without microphone access.
 */
export function useSyntheticBars({
  barCount = 5,
  intervalMs = 90,
  speed = 0.6,
  amplitude = 6,
}: UseSyntheticBarsOptions = {}): number[] {
  const [bars, setBars] = useState<number[]>(() =>
    Array.from({ length: barCount }, () => 2),
  );

  useEffect(() => {
    let tick = 0;
    const intervalId = window.setInterval(() => {
      tick += 1;
      setBars(
        Array.from({ length: barCount }, (_, barIndex) => {
          const phase = barIndex * 0.6;
          return (
            2 +
            Math.round(Math.abs(Math.sin(tick * speed + phase)) * amplitude)
          );
        }),
      );
    }, intervalMs);
    return () => window.clearInterval(intervalId);
  }, [barCount, intervalMs, speed, amplitude]);

  return bars;
}
