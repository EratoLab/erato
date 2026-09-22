import clsx from "clsx";
import { forwardRef, useId } from "react";

import type { SelectHTMLAttributes } from "react";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  description?: string;
  error?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select(
    {
      label,
      description,
      error,
      id: suppliedId,
      className,
      children,
      ...props
    },
    ref,
  ) {
    const generatedId = useId();
    const id = suppliedId ?? generatedId;
    const message = error ?? description;
    // eslint-disable-next-line lingui/no-unlocalized-strings -- DOM relationship, not copy
    const descriptionId = `${id}-description`;
    const describedBy =
      [props["aria-describedby"], message && descriptionId]
        .filter(Boolean)
        .join(" ") || undefined;
    return (
      <div className="min-w-0" data-ui="select-field">
        {label && (
          <label
            htmlFor={id}
            className="mb-1 block text-sm font-medium text-theme-fg-secondary"
          >
            {label}
          </label>
        )}
        <select
          {...props}
          ref={ref}
          id={id}
          aria-invalid={error ? true : props["aria-invalid"]}
          aria-describedby={describedBy}
          data-ui="select"
          className={clsx(
            "theme-transition w-full min-w-0 border bg-theme-bg-secondary text-sm text-theme-fg-primary",
            "[border-radius:var(--theme-radius-control)] [min-height:var(--theme-spacing-control-min-height)] [padding:var(--theme-spacing-control-padding-y)_var(--theme-spacing-control-padding-x)]",
            "focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
            error
              ? "border-theme-error-border focus:ring-theme-focus-error"
              : "border-[var(--theme-border-field)] focus:border-[var(--theme-border-field-focus)] focus:ring-theme-focus",
            className,
          )}
        >
          {children}
        </select>
        {message && (
          <p
            id={descriptionId}
            role={error ? "alert" : undefined}
            className={clsx(
              "mt-1 text-sm",
              error ? "text-theme-error-fg" : "text-theme-fg-muted",
            )}
          >
            {message}
          </p>
        )}
      </div>
    );
  },
);
