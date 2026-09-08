import clsx from "clsx";
import { forwardRef } from "react";

import type React from "react";

type ContainerTag = "button" | "div" | "a" | "label";

type ContainerElement =
  | HTMLButtonElement
  | HTMLDivElement
  | HTMLAnchorElement
  | HTMLLabelElement;

type BaseProps = {
  children: React.ReactNode;
  className?: string;
  interactive?: boolean; // Optional prop to control hover/focus states
  /**
   * The element to render. `useDiv` is the older spelling of `as="div"` and
   * stays as its alias, so the existing call sites keep working.
   */
  as?: ContainerTag;
  useDiv?: boolean; // Use div instead of button to prevent nesting buttons
  fullWidth?: boolean;
  showFocusRing?: boolean;
  onClick?: (e: React.MouseEvent<ContainerElement>) => void;
};

type ButtonProps = BaseProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof BaseProps> & {
    as?: "button";
    useDiv?: false;
  };

type DivProps = BaseProps &
  Omit<React.HTMLAttributes<HTMLDivElement>, keyof BaseProps> &
  ({ as?: "div"; useDiv: true } | { as: "div"; useDiv?: boolean });

type AnchorProps = BaseProps &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof BaseProps> & {
    as: "a";
    useDiv?: false;
  };

type LabelProps = BaseProps &
  Omit<React.LabelHTMLAttributes<HTMLLabelElement>, keyof BaseProps> & {
    as: "label";
    useDiv?: false;
  };

type InteractiveContainerProps =
  | ButtonProps
  | DivProps
  | AnchorProps
  | LabelProps;

export const InteractiveContainer = forwardRef<
  ContainerElement,
  InteractiveContainerProps
>(function InteractiveContainer(
  {
    children,
    className,
    interactive = true,
    as,
    useDiv = false,
    fullWidth = true,
    showFocusRing = true,
    onClick,
    ...props
  },
  ref,
) {
  const tag: ContainerTag = as ?? (useDiv ? "div" : "button");
  const isClickable = typeof onClick === "function";
  const commonClassNames = clsx(
    fullWidth && "w-full",
    interactive && showFocusRing && "focus-ring-tight",
    "disabled:cursor-not-allowed disabled:opacity-50",
    className,
  );

  // Use a div when explicitly requested
  if (tag === "div") {
    const {
      onKeyDown: userOnKeyDown,
      role: explicitRole,
      tabIndex: explicitTabIndex,
      ...divProps
    } = props as Omit<React.HTMLAttributes<HTMLDivElement>, "onClick">;

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      userOnKeyDown?.(e);

      if (e.defaultPrevented) {
        return;
      }

      // Only the container's own key presses activate it. A keydown bubbling up
      // from a control inside — a chip's remove button, say — belongs to that
      // control, and handling it here both fires the wrong action and cancels
      // the right one.
      if (e.target !== e.currentTarget) {
        return;
      }

      if (isClickable && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        onClick(e as unknown as React.MouseEvent<HTMLDivElement>);
      }
    };

    if (!isClickable) {
      return (
        <div
          ref={ref as React.Ref<HTMLDivElement>}
          className={commonClassNames}
          role={explicitRole}
          tabIndex={explicitTabIndex}
          {...divProps}
        >
          {children}
        </div>
      );
    }

    return (
      <div
        ref={ref as React.Ref<HTMLDivElement>}
        className={commonClassNames}
        // A clickable div still announces itself as a button by default, but a
        // caller that names its own role — a menu row, say — keeps it.
        role={explicitRole ?? "button"}
        tabIndex={explicitTabIndex ?? 0}
        onClick={onClick}
        onKeyDown={handleKeyDown}
        {...divProps}
      >
        {children}
      </div>
    );
  }

  // An anchor and a label both activate natively, so neither needs the div
  // branch's synthesized keyboard handling, and neither takes the button's
  // `type` or its appearance reset.
  if (tag === "a") {
    return (
      // The caller spreads the `href`, so the a11y rules cannot see that this
      // anchor is keyboard-operable natively.
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
      <a
        ref={ref as React.Ref<HTMLAnchorElement>}
        className={commonClassNames}
        onClick={onClick}
        {...(props as Omit<
          React.AnchorHTMLAttributes<HTMLAnchorElement>,
          "onClick"
        >)}
      >
        {children}
      </a>
    );
  }

  if (tag === "label") {
    return (
      // A label activates the control it wraps, so it needs no key handling of
      // its own either.
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
      <label
        ref={ref as React.Ref<HTMLLabelElement>}
        className={commonClassNames}
        onClick={onClick}
        {...(props as Omit<
          React.LabelHTMLAttributes<HTMLLabelElement>,
          "onClick"
        >)}
      >
        {children}
      </label>
    );
  }

  // Otherwise, use a button (default)
  return (
    <button
      ref={ref as React.Ref<HTMLButtonElement>}
      className={clsx(
        "appearance-none border-0 bg-transparent p-0 text-inherit",
        commonClassNames,
      )}
      type="button"
      onClick={onClick}
      {...(props as Omit<
        React.ButtonHTMLAttributes<HTMLButtonElement>,
        "onClick"
      >)}
    >
      {children}
    </button>
  );
});
