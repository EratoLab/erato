import clsx from "clsx";
import { memo, useId, useRef } from "react";

import type { KeyboardEvent } from "react";

export interface SegmentedControlAttention {
  /** Read out after the label; the dot carries no meaning on its own. */
  label: string;
  /** Text colour class the dot picks up through `bg-current`. */
  toneClassName?: string;
  /** Whether the dot pulses, for a state that is still moving. */
  pulse?: boolean;
}

export interface SegmentedControlOption<T extends string> {
  /** The value for this option */
  value: T;
  /** The display label */
  label: string;
  /** Optional icon to show before the label */
  icon?: React.ReactNode;
  /**
   * Status dot after the label. Kept apart from `icon`, which is aria-hidden
   * and therefore cannot carry a state a user needs to know about.
   */
  attention?: SegmentedControlAttention;
  /** Whether this option is disabled */
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  /** Array of options to display */
  options: SegmentedControlOption<T>[];
  /** Currently selected value */
  value: T;
  /** Callback when selection changes */
  onChange: (value: T) => void;
  /** Size variant */
  size?: "sm" | "md";
  /** Whether the entire control is disabled */
  disabled?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Accessible label for the control */
  "aria-label"?: string;
}

/**
 * Walk `delta` steps at a time from `from`, wrapping at both ends, until an
 * option that can actually be selected turns up. Disabled segments are stepped
 * over rather than landed on, so an arrow key never parks focus on something
 * that cannot be activated. Returns -1 when no option is selectable.
 *
 * `from` is allowed to sit outside the array so a single walk serves all four
 * keys: Home enters at -1 going forward, End at `length` going backward.
 */
function nextEnabledIndex<T extends string>(
  options: SegmentedControlOption<T>[],
  from: number,
  delta: number,
): number {
  const { length } = options;

  for (let step = 1; step <= length; step++) {
    const index = (((from + delta * step) % length) + length) % length;
    if (!options[index].disabled) {
      return index;
    }
  }

  return -1;
}

/**
 * SegmentedControl component for toggling between a small set of options
 *
 * Use this for switching between 2-4 mutually exclusive views or filters.
 * For more options, consider using a DropdownMenu instead.
 */
function SegmentedControlInner<T extends string>({
  options,
  value,
  onChange,
  size = "sm",
  disabled = false,
  className,
  "aria-label": ariaLabel,
}: SegmentedControlProps<T>) {
  const groupId = useId();
  const segmentRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const sizeStyles = {
    sm: "px-3 py-1.5 text-sm",
    md: "px-4 py-2 text-base",
  };

  /**
   * Automatic activation: selection and focus move together, which is the
   * promise the roving `tabIndex` already makes. Without this the selected
   * segment is the only tab stop in the group and a keyboard user cannot
   * reach the others at all.
   */
  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number;

    switch (event.key) {
      case "ArrowRight":
        nextIndex = nextEnabledIndex(options, index, 1);
        break;
      case "ArrowLeft":
        nextIndex = nextEnabledIndex(options, index, -1);
        break;
      case "Home":
        nextIndex = nextEnabledIndex(options, -1, 1);
        break;
      case "End":
        nextIndex = nextEnabledIndex(options, options.length, -1);
        break;
      default:
        return;
    }

    event.preventDefault();

    if (nextIndex < 0) {
      return;
    }

    onChange(options[nextIndex].value);
    segmentRefs.current[nextIndex]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={clsx(
        // The track and its segments are a concentric pair: the segment radius
        // is the track's minus the 2px (p-0.5) inset. Both must move together,
        // or the selected chip's corners bulge out of the track. (The track's
        // 1px border means true concentricity would be -0.1875rem; the 2px
        // relationship is kept as-is so the default theme is unchanged.)
        "inline-flex rounded-[var(--theme-radius-control)] border border-theme-border bg-theme-bg-secondary p-0.5",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      {options.map((option, index) => {
        const isSelected = value === option.value;
        const isDisabled = disabled || option.disabled;

        return (
          <button
            key={option.value}
            id={`${groupId}-tab-${index}`}
            ref={(element) => {
              segmentRefs.current[index] = element;
            }}
            type="button"
            role="tab"
            aria-selected={isSelected ? "true" : "false"}
            tabIndex={isSelected ? 0 : -1}
            disabled={isDisabled}
            onClick={() => {
              if (!isDisabled) {
                onChange(option.value);
              }
            }}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={clsx(
              "theme-transition flex items-center gap-1.5 rounded-[calc(var(--theme-radius-control)_-_0.125rem)] font-medium",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus",
              sizeStyles[size],
              isSelected
                ? "bg-theme-bg-selected text-theme-fg-primary shadow-sm"
                : "text-theme-fg-secondary hover:text-theme-fg-primary",
              isDisabled && "cursor-not-allowed",
            )}
          >
            {option.icon && (
              <span className="size-4 shrink-0" aria-hidden="true">
                {option.icon}
              </span>
            )}
            {option.label}
            {option.attention && (
              <span
                className={clsx(
                  "flex shrink-0 items-center",
                  option.attention.toneClassName,
                )}
                data-ui="segmented-control-attention"
                data-testid="segmented-control-attention"
              >
                <span
                  aria-hidden="true"
                  className={clsx(
                    "size-2 rounded-full bg-current",
                    option.attention.pulse &&
                      "animate-pulse motion-reduce:animate-none",
                  )}
                />
                <span className="sr-only">{option.attention.label}</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// Wrap with memo for performance - generic components need this pattern
export const SegmentedControl = memo(
  SegmentedControlInner,
) as typeof SegmentedControlInner;

// eslint-disable-next-line lingui/no-unlocalized-strings
(SegmentedControl as React.FC).displayName = "SegmentedControl";
