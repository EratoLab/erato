import clsx from "clsx";
import { forwardRef, useId, useRef } from "react";

import { useMergedRef } from "@/hooks/ui/useMergedRef";

import { Checkbox } from "./Checkbox";

import type React from "react";

/** The row checkboxes a list roves over. */
export const SELECTABLE_ROW_CHECKBOX_SELECTOR =
  // eslint-disable-next-line lingui/no-unlocalized-strings -- CSS selector, not user-facing
  '[data-selectable-row] input[type="checkbox"]:not(:disabled)';

// Clicks on these inside the row belong to them, not to the row body.
// eslint-disable-next-line lingui/no-unlocalized-strings -- CSS selector, not user-facing
const OWN_CONTROLS = "a, button, input, label, select, textarea";

export type SelectableRowTone = "neutral" | "warning" | "error";

export type SelectableRowLayout = "columns" | "stacked";

export interface SelectableRowProps {
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
  /** Accessible name of the checkbox; include a flag ("…, policy concern"). */
  selectLabel: string;
  /** Ids for the checkbox's `aria-describedby` (meta, date, check status). */
  describedBy?: string;
  /** The checkbox's `tabIndex`, for a list that roves over its rows. */
  tabIndex?: number;
  disabled?: boolean;
  /** Decorative kind glyph; the row hides it from assistive tech. */
  icon?: React.ReactNode;
  title: React.ReactNode;
  /** Kept in view after the truncating title (a badge). */
  titleEnd?: React.ReactNode;
  meta?: React.ReactNode;
  /** Right-aligned and never wrapped (a date). */
  end?: React.ReactNode;
  /** Fixed status column (chevron, spinner, check mark). */
  trailing?: React.ReactNode;
  tone?: SelectableRowTone;
  /** Drill-in: the title becomes a button and a click on the row body opens too. */
  onOpen?: () => void;
  openLabel?: string;
  /** This row's detail is shown. */
  current?: boolean;
  /** `aria-controls` of the open button. */
  detailId?: string;
  busy?: boolean;
  layout?: SelectableRowLayout;
  as?: "li" | "div";
  className?: string;
  /** Theme hook on the frame. Defaults to `selectable-row`. */
  "data-ui"?: string;
}

/**
 * A row that frames a checkbox. The checkbox owns selection and Space; the
 * title owns drill-in. The open button is out of the tab order so a list of
 * rows stays one tab stop: keyboard users open from the list (→), the button
 * is there for the pointer and for screen-reader browse mode.
 *
 * The forwarded ref is the checkbox.
 */
export const SelectableRow = forwardRef<HTMLInputElement, SelectableRowProps>(
  function SelectableRow(
    {
      selected,
      onSelectedChange,
      selectLabel,
      describedBy,
      tabIndex,
      disabled = false,
      icon,
      title,
      titleEnd,
      meta,
      end,
      trailing,
      tone = "neutral",
      onOpen,
      openLabel,
      current = false,
      detailId,
      busy = false,
      layout = "columns",
      as: Tag = "li",
      className,
      "data-ui": dataUi,
    },
    ref,
  ) {
    const checkboxId = useId();
    const checkboxRef = useRef<HTMLInputElement | null>(null);
    const setRef = useMergedRef(checkboxRef, ref);

    const open = () => {
      checkboxRef.current?.focus();
      onOpen?.();
    };

    const handleBodyClick = (event: React.MouseEvent<HTMLElement>) => {
      if (disabled) {
        return;
      }
      const control = (event.target as Element).closest(OWN_CONTROLS);
      if (control && event.currentTarget.contains(control)) {
        return;
      }
      open();
    };

    const titleText = (
      <span dir="auto" className="min-w-0 truncate [unicode-bidi:isolate]">
        {title}
      </span>
    );

    // The checkbox and the list's arrow keys are the keyboard path; a body
    // click is a pointer shortcut to the same two actions.
    return (
      <Tag
        data-selectable-row=""
        data-ui={dataUi ?? "selectable-row"}
        data-layout={layout}
        data-selected={selected || undefined}
        data-tone={tone === "neutral" ? undefined : tone}
        data-current={current || undefined}
        data-disabled={disabled || undefined}
        aria-busy={busy || undefined}
        onClick={handleBodyClick}
        className={clsx(
          "selectable-row-geometry selectable-row-skin theme-transition text-sm",
          onOpen && !disabled && "cursor-pointer",
          className,
        )}
      >
        <label
          htmlFor={checkboxId}
          data-ui="selectable-row-check"
          className="flex min-w-6 cursor-pointer items-center justify-start self-stretch has-[:disabled]:cursor-not-allowed"
        >
          <Checkbox
            ref={setRef}
            id={checkboxId}
            checked={selected}
            onCheckedChange={(next) => onSelectedChange(next)}
            disabled={disabled}
            tabIndex={tabIndex}
            aria-label={selectLabel}
            aria-describedby={describedBy}
          />
        </label>
        <span
          data-ui="selectable-row-icon"
          aria-hidden="true"
          className="flex items-center justify-center"
        >
          {icon}
        </span>
        <span
          data-ui="selectable-row-title"
          className="flex min-w-0 items-center gap-2"
        >
          {onOpen ? (
            <button
              type="button"
              data-ui="selectable-row-open"
              tabIndex={-1}
              disabled={disabled}
              aria-label={openLabel}
              aria-expanded={current}
              aria-controls={detailId}
              onClick={open}
              className="flex min-w-0 text-left enabled:hover:underline"
            >
              {titleText}
            </button>
          ) : (
            titleText
          )}
          {titleEnd == null ? null : (
            <span className="flex shrink-0 items-center">{titleEnd}</span>
          )}
        </span>
        <span data-ui="selectable-row-meta" className="min-w-0 truncate">
          {meta}
        </span>
        <span
          data-ui="selectable-row-end"
          className="min-w-0 truncate text-end"
        >
          {end}
        </span>
        <span
          data-ui="selectable-row-trailing"
          className="flex items-center justify-center"
        >
          {trailing}
        </span>
      </Tag>
    );
  },
);
