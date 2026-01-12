import clsx from "clsx";
import { memo, useId } from "react";

export interface SegmentedControlOption<T extends string> {
  /** The value for this option */
  value: T;
  /** The display label */
  label: string;
  /** Optional icon to show before the label */
  icon?: React.ReactNode;
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

  const sizeStyles = {
    sm: "px-3 py-1.5 text-sm",
    md: "px-4 py-2 text-base",
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={clsx(
        "inline-flex rounded-lg border border-theme-border bg-theme-bg-secondary p-0.5",
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
            type="button"
            role="tab"
            aria-selected={isSelected ? "true" : "false"}
            aria-controls={`${groupId}-panel-${index}`}
            tabIndex={isSelected ? 0 : -1}
            disabled={isDisabled}
            onClick={() => {
              if (!isDisabled) {
                onChange(option.value);
              }
            }}
            className={clsx(
              "theme-transition flex items-center gap-1.5 rounded-md font-medium",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus",
              sizeStyles[size],
              isSelected
                ? "bg-theme-bg-primary text-theme-fg-primary shadow-sm"
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
