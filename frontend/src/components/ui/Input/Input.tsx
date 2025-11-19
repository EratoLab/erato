import clsx from "clsx";
import { forwardRef } from "react";

import type React from "react";

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  /**
   * Current value of the input
   */
  value?: string;
  /**
   * Callback fired when the value changes
   */
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /**
   * Placeholder text
   */
  placeholder?: string;
  /**
   * Error message to display below the input
   */
  error?: string;
  /**
   * Whether the input is disabled
   */
  disabled?: boolean;
  /**
   * Input type
   * @default "text"
   */
  type?: "text" | "email" | "url" | "password" | "search" | "tel";
  /**
   * Additional CSS classes
   */
  className?: string;
  /**
   * Accessible label for screen readers (if not using FormField wrapper)
   */
  "aria-label"?: string;
}

/**
 * Input component with theme-aware styling
 *
 * A reusable text input component that follows the application's design system.
 * Use with FormField component for proper label and error display.
 *
 * @example
 * ```tsx
 * <Input
 *   value={name}
 *   onChange={(e) => setName(e.target.value)}
 *   placeholder="Enter your name"
 *   error={errors.name}
 * />
 * ```
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      value,
      onChange,
      placeholder,
      error,
      disabled = false,
      type = "text",
      className,
      "aria-label": ariaLabel,
      "aria-describedby": ariaDescribedBy,
      ...props
    },
    ref,
  ) => {
    const inputId = props.id;
    const errorId = error && inputId ? `${inputId}-error` : undefined;

    // Combine aria-describedby with error id if present
    const describedBy = [ariaDescribedBy, errorId].filter(Boolean).join(" ") || undefined;

    return (
      <div className="w-full">
        <input
          ref={ref}
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-describedby={describedBy || undefined}
          aria-invalid={!!error}
          className={clsx(
            // Base styles
            "w-full rounded-lg px-4 py-2.5",
            "text-base text-theme-fg-primary placeholder:text-theme-fg-muted",
            "theme-transition",
            // Background and border
            "border bg-theme-bg-secondary",
            error
              ? "border-theme-error-border focus:border-theme-error-border focus:ring-2 focus:ring-red-500/20"
              : "border-theme-border focus:border-theme-border-focus focus:ring-theme-focus",
            // Focus styles
            "focus:outline-none focus:ring-2",
            // Disabled styles
            disabled &&
              "cursor-not-allowed bg-theme-bg-primary text-theme-fg-muted opacity-50",
            // Custom classes
            className,
          )}
          {...props}
        />
        {error && errorId && (
          <p
            id={errorId}
            className="mt-1.5 text-sm text-theme-error-fg"
            role="alert"
          >
            {error}
          </p>
        )}
      </div>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
Input.displayName = "Input";

