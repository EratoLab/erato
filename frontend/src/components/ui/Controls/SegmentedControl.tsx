import { memo } from "react";

import { TabRail } from "./TabRail";

import type { TabRailAttention, TabRailOption } from "./TabRail";

export type SegmentedControlAttention = TabRailAttention;

export type SegmentedControlOption<T extends string> = TabRailOption<T>;

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

// Literal padding per size, on purpose: these utilities are emitted after
// `@layer components` and so beat the item geometry's token padding, which
// keeps every segmented control at the size it shipped with.
const sizeStyles = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-base",
};

/**
 * SegmentedControl component for toggling between a small set of options
 *
 * Use this for switching between 2-4 mutually exclusive views or filters.
 * For more options, consider using a DropdownMenu instead. It is the
 * `segmented` variant of `TabRail` with a size prop in front.
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
  return (
    <TabRail
      variant="segmented"
      orientation="horizontal"
      options={options}
      value={value}
      onChange={onChange}
      disabled={disabled}
      className={className}
      tabClassName={sizeStyles[size]}
      aria-label={ariaLabel}
    />
  );
}

// Wrap with memo for performance - generic components need this pattern
export const SegmentedControl = memo(
  SegmentedControlInner,
) as typeof SegmentedControlInner;

// eslint-disable-next-line lingui/no-unlocalized-strings
(SegmentedControl as React.FC).displayName = "SegmentedControl";
