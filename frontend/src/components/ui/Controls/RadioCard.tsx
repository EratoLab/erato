import clsx from "clsx";

import type { ReactNode } from "react";

interface RadioCardProps {
  id?: string;
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  label: ReactNode;
  helper?: ReactNode;
  /**
   * Optional icon shown as a 36px tile on the left. When provided, the radio
   * input is visually hidden (still keyboard-focusable) and selection is shown
   * via the card border / icon-tile styling.
   */
  icon?: ReactNode;
  /** Optional element rendered to the right of the label (e.g. status badge). */
  trailing?: ReactNode;
  /** Optional content rendered beneath the radio row when this card is checked. */
  children?: ReactNode;
  /**
   * Visual size:
   * - `"sm"` (default): compact form-row look (p-3, text-sm/xs, visible radio dot).
   * - `"md"`: tile-style card (p-4, larger text). Use with `icon` for a
   *   selectable-card layout.
   */
  size?: "sm" | "md";
}

/**
 * One row of a radio group rendered as a clickable card.
 *
 * Native `<input type="radio">` underneath, so browsers handle arrow-key
 * navigation and form semantics for free. Group the cards inside a
 * `role="radiogroup"` container or a `<fieldset>` with `<legend>`.
 */
export function RadioCard({
  id,
  name,
  value,
  checked,
  onChange,
  label,
  helper,
  icon,
  trailing,
  children,
  size = "sm",
}: RadioCardProps) {
  const inputId = id ?? `radiocard-${name}-${value}`;
  const hideRadio = Boolean(icon);

  const cardClasses = clsx(
    "theme-transition border",
    // eslint-disable-next-line lingui/no-unlocalized-strings -- Tailwind has-selector for keyboard focus
    "[&:has(input:focus-visible)]:ring-2 [&:has(input:focus-visible)]:ring-theme-focus",
    size === "md" ? "rounded-lg" : "rounded-md",
    checked
      ? "border-theme-border-focus bg-theme-bg-hover"
      : "border-theme-border bg-theme-bg-primary",
  );

  const rowClasses = clsx(
    "flex cursor-pointer items-start gap-3 hover:bg-theme-bg-hover",
    size === "md" ? "p-4" : "p-3",
  );

  const labelClasses = clsx(
    "font-medium text-theme-fg-primary",
    size === "md" ? "" : "text-sm",
  );

  const helperClasses = clsx(
    "mt-1 text-theme-fg-muted",
    size === "md" ? "text-sm" : "text-xs",
  );

  return (
    <div className={cardClasses}>
      <label htmlFor={inputId} className={rowClasses}>
        <input
          id={inputId}
          type="radio"
          name={name}
          value={value}
          checked={checked}
          onChange={onChange}
          className={
            hideRadio
              ? "sr-only"
              : "mt-1 size-4 cursor-pointer accent-theme-bg-accent"
          }
        />
        {icon ? (
          <span
            aria-hidden="true"
            className={clsx(
              "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border bg-theme-bg-secondary",
              checked
                ? "border-theme-border-focus text-theme-fg-primary"
                : "border-theme-border text-theme-fg-secondary",
            )}
          >
            {icon}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className={labelClasses}>{label}</p>
            {trailing}
          </div>
          {helper ? <p className={helperClasses}>{helper}</p> : null}
        </div>
      </label>
      {checked && children ? (
        <div className="border-t border-theme-border">{children}</div>
      ) : null}
    </div>
  );
}
