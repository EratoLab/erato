import clsx from "clsx";
import { forwardRef, useLayoutEffect, useRef } from "react";

import { useMergedRef } from "@/hooks/ui/useMergedRef";

import type React from "react";

export interface CheckboxProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "type" | "children" | "checked" | "defaultChecked" | "onChange"
  > {
  checked: boolean;
  /** Drawn and announced as mixed while `!checked`; set on the DOM property only. */
  indeterminate?: boolean;
  onCheckedChange: (
    next: boolean,
    event: React.ChangeEvent<HTMLInputElement>,
  ) => void;
  /** Visible inline label; the input is then wrapped in `<label data-ui="checkbox-field">`. */
  label?: React.ReactNode;
  /**
   * `switch` is for an on/off setting that is a row of its own in a settings
   * list, as Apple asks: WebKit then draws its own switch and gives a light
   * haptic on iPhone. Elsewhere the same input shows as a checkbox. The label
   * leads and the control trails, as in a phone's settings.
   */
  appearance?: "checkbox" | "switch";
  /** Theme hook on the input. Defaults to `checkbox`. */
  "data-ui"?: string;
}

// An outline rather than a ring: box-shadow does not paint on native controls
// in WKWebView and WebView2, and forced colors drop it. Disabled adds no
// opacity of its own, so it does not compound with a dimmed parent.
const INPUT_CLASS =
  "shrink-0 cursor-pointer disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--theme-focus-ring)]";

/** A native checkbox. `indeterminate` has no markup, so it is set on the element. */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox(
    {
      checked,
      indeterminate = false,
      onCheckedChange,
      label,
      appearance = "checkbox",
      className,
      "data-ui": dataUi,
      ...rest
    },
    ref,
  ) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const setRef = useMergedRef(inputRef, ref);

    useLayoutEffect(() => {
      if (inputRef.current) {
        inputRef.current.indeterminate = indeterminate && !checked;
      }
    }, [indeterminate, checked]);

    const isSwitch = appearance === "switch";
    const input = (
      <input
        {...rest}
        {...(isSwitch ? { switch: "", role: "switch" } : {})}
        ref={setRef}
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          onCheckedChange(event.target.checked, event);
          // A click clears the property natively; a parent that keeps its
          // props does not re-render, so restore it here.
          event.currentTarget.indeterminate = indeterminate && !checked;
        }}
        data-ui={dataUi ?? "checkbox"}
        // A switch takes WebKit's own size; a fixed box would clip it.
        className={clsx(INPUT_CLASS, !isSwitch && "size-4", className)}
      />
    );

    if (label == null) {
      return input;
    }

    return (
      <label
        data-ui="checkbox-field"
        className={clsx(
          "cursor-pointer items-center text-sm text-theme-fg-secondary has-[:disabled]:cursor-not-allowed has-[:disabled]:text-theme-fg-muted",
          isSwitch ? "flex w-full justify-between gap-3" : "inline-flex gap-2",
        )}
      >
        {isSwitch ? (
          <>
            <span>{label}</span>
            {input}
          </>
        ) : (
          <>
            {input}
            <span>{label}</span>
          </>
        )}
      </label>
    );
  },
);
