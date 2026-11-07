import clsx from "clsx";
import { forwardRef } from "react";

import type React from "react";

export type ProgressBarTone = "neutral" | "warning";

export type ProgressBarSize = "sm" | "md";

export interface ProgressBarProps
  extends Omit<React.ComponentPropsWithoutRef<"div">, "role" | "children"> {
  /** Clamped to `[0, max]`. */
  value: number;
  max?: number;
  /** Accessible name. */
  label: string;
  /** `aria-valuetext`, e.g. "1 of 2 items checked". */
  valueText?: string;
  tone?: ProgressBarTone;
  size?: ProgressBarSize;
  /** Theme hook. Defaults to `progress`. */
  "data-ui"?: string;
}

/** A determinate progress bar: a track and a fill, no text of its own. */
export const ProgressBar = forwardRef<HTMLDivElement, ProgressBarProps>(
  function ProgressBar(
    {
      value,
      max = 100,
      label,
      valueText,
      tone = "neutral",
      size = "md",
      className,
      "data-ui": dataUi,
      ...rest
    },
    ref,
  ) {
    const bound = Number.isFinite(max) && max > 0 ? max : 0;
    const now = Number.isFinite(value)
      ? Math.min(Math.max(value, 0), bound)
      : 0;
    const percent = bound === 0 ? 0 : (now / bound) * 100;

    return (
      <div
        {...rest}
        ref={ref}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={bound}
        aria-valuenow={now}
        aria-valuetext={valueText}
        data-ui={dataUi ?? "progress"}
        data-tone={tone === "neutral" ? undefined : tone}
        data-size={size}
        className={clsx("progress-geometry progress-skin", className)}
      >
        <span
          data-ui="progress-fill"
          className="progress-fill-skin block h-full"
          style={{ inlineSize: `${percent}%` }}
        />
      </div>
    );
  },
);
