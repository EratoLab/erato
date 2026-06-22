// Strings in this file are canvas/CSS identifiers and hex color fallbacks
// (e.g. "2d", "--theme-fg-muted", "#9ca3af") — programmatic, not
// user-facing, so they are intentionally not localized.
/* eslint-disable lingui/no-unlocalized-strings */
import { useEffect, useRef } from "react";

import type { ClipEvent } from "@/hooks/audio/micQualityAnalysis";

interface ClipWaveformProps {
  /** Captured PCM in [-1, 1] to render as a peak waveform. */
  samples: Float32Array;
  /** Clip events (sample indices into `samples`) drawn as point markers. */
  clipEvents: readonly ClipEvent[];
  /** Playback position in [0, 1], or null when not playing. */
  progress?: number | null;
  heightPx?: number;
  className?: string;
}

function readThemeColor(variable: string, fallback: string): string {
  if (typeof window === "undefined") {
    return fallback;
  }
  const value = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(variable)
    .trim();
  return value || fallback;
}

/**
 * Canvas peak-waveform of a captured clip with clipping moments marked as
 * point events on the timeline (ERMAIN-380, check #1). Pure presentation —
 * it knows nothing about capture or analysis; feed it the speech-phase
 * samples and the detected clip runs. Redraws on data, size, or progress
 * change; markers are positioned by sample fraction so they stay aligned at
 * any width.
 */
export function ClipWaveform({
  samples,
  clipEvents,
  progress = null,
  heightPx = 56,
  className,
}: ClipWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const draw = () => {
      const context = canvas.getContext("2d");
      const parent = canvas.parentElement;
      if (!context || !parent) {
        return;
      }
      const dpr = window.devicePixelRatio || 1;
      const cssWidth = parent.clientWidth;
      const cssHeight = heightPx;
      canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
      canvas.height = Math.max(1, Math.floor(cssHeight * dpr));
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, cssWidth, cssHeight);

      const midY = cssHeight / 2;
      const waveColor = readThemeColor("--theme-fg-muted", "#9ca3af");
      const clipColor = readThemeColor("--theme-error-fg", "#dc2626");
      const playedColor = readThemeColor("--theme-fg-accent", "#2563eb");

      // Peak-per-column waveform.
      const columns = Math.max(1, Math.floor(cssWidth));
      const samplesPerColumn = Math.max(1, Math.floor(samples.length / columns));
      context.strokeStyle = waveColor;
      context.lineWidth = 1;
      context.beginPath();
      for (let column = 0; column < columns; column += 1) {
        const start = column * samplesPerColumn;
        const end = Math.min(samples.length, start + samplesPerColumn);
        let peak = 0;
        for (let index = start; index < end; index += 1) {
          const magnitude = Math.abs(samples[index]);
          if (magnitude > peak) {
            peak = magnitude;
          }
        }
        const barHeight = Math.max(1, peak * (cssHeight - 2));
        context.moveTo(column + 0.5, midY - barHeight / 2);
        context.lineTo(column + 0.5, midY + barHeight / 2);
      }
      context.stroke();

      // Clip markers as point events.
      if (samples.length > 0) {
        context.fillStyle = clipColor;
        for (const event of clipEvents) {
          const center = (event.startSample + event.endSample) / 2;
          const x = (center / samples.length) * cssWidth;
          context.fillRect(Math.max(0, x - 1), 0, 2, cssHeight);
        }
      }

      // Playback head.
      if (progress !== null && progress >= 0) {
        const x = Math.min(1, progress) * cssWidth;
        context.fillStyle = playedColor;
        context.fillRect(Math.max(0, x - 1), 0, 2, cssHeight);
      }
    };

    draw();

    const observer = new ResizeObserver(() => draw());
    if (canvas.parentElement) {
      observer.observe(canvas.parentElement);
    }
    return () => observer.disconnect();
  }, [samples, clipEvents, progress, heightPx]);

  return (
    <div className={className} data-testid="mic-check-waveform">
      <canvas ref={canvasRef} />
    </div>
  );
}
