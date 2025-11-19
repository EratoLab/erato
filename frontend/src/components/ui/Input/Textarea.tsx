import clsx from "clsx";
import { forwardRef, useEffect, useRef } from "react";

import type React from "react";

export interface TextareaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "size"> {
  /**
   * Current value of the textarea
   */
  value?: string;
  /**
   * Callback fired when the value changes
   */
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  /**
   * Placeholder text
   */
  placeholder?: string;
  /**
   * Error message to display below the textarea
   */
  error?: string;
  /**
   * Whether the textarea is disabled
   */
  disabled?: boolean;
  /**
   * Number of visible text rows
   * @default 3
   */
  rows?: number;
  /**
   * Whether to use monospace font (useful for code/prompts)
   * @default false
   */
  monospace?: boolean;
  /**
   * Whether to auto-resize based on content
   * @default false
   */
  autoResize?: boolean;
  /**
   * Maximum number of rows when auto-resizing
   * @default 20
   */
  maxRows?: number;
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
 * Textarea component with theme-aware styling
 *
 * A reusable textarea component that follows the application's design system.
 * Supports monospace font for code/prompts and optional auto-resize functionality.
 * Use with FormField component for proper label and error display.
 *
 * @example
 * ```tsx
 * <Textarea
 *   value={description}
 *   onChange={(e) => setDescription(e.target.value)}
 *   placeholder="Enter description..."
 *   rows={4}
 * />
 * ```
 *
 * @example
 * ```tsx
 * // Monospace for code/prompts
 * <Textarea
 *   value={prompt}
 *   onChange={(e) => setPrompt(e.target.value)}
 *   monospace
 *   rows={8}
 * />
 * ```
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      value,
      onChange,
      placeholder,
      error,
      disabled = false,
      rows = 3,
      monospace = false,
      autoResize = false,
      maxRows = 20,
      className,
      "aria-label": ariaLabel,
      "aria-describedby": ariaDescribedBy,
      ...props
    },
    forwardedRef,
  ) => {
    const internalRef = useRef<HTMLTextAreaElement>(null);
    const textareaRef =
      (forwardedRef as React.RefObject<HTMLTextAreaElement>) || internalRef;

    const textareaId = props.id;
    const errorId = error && textareaId ? `${textareaId}-error` : undefined;

    // Combine aria-describedby with error id if present
    const describedBy = [ariaDescribedBy, errorId].filter(Boolean).join(" ") || undefined;

    // Auto-resize functionality
    useEffect(() => {
      if (!autoResize) return;
      const textarea = textareaRef.current;
      if (!textarea) return;

      const minHeight = rows * 24; // Approximate line height
      const maxHeight = maxRows * 24;

      // Reset height to recalculate
      textarea.style.height = "auto";
      const newHeight = Math.min(
        Math.max(textarea.scrollHeight, minHeight),
        maxHeight,
      );
      textarea.style.height = `${newHeight}px`;
    }, [value, autoResize, rows, maxRows, textareaRef]);

    return (
      <div className="w-full">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          rows={autoResize ? undefined : rows}
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
            // Monospace font
            monospace && "font-mono text-sm",
            // Resize behavior
            autoResize ? "resize-none overflow-hidden" : "resize-y",
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
Textarea.displayName = "Textarea";

