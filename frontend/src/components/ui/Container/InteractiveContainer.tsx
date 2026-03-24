import clsx from "clsx";

import type React from "react";

type ContainerElement = HTMLButtonElement | HTMLDivElement;

type BaseProps = {
  children: React.ReactNode;
  className?: string;
  interactive?: boolean; // Optional prop to control hover/focus states
  useDiv?: boolean; // Use div instead of button to prevent nesting buttons
  fullWidth?: boolean;
  showFocusRing?: boolean;
  onClick?: (e: React.MouseEvent<ContainerElement>) => void;
};

type ButtonProps = BaseProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof BaseProps> & {
    useDiv?: false;
  };

type DivProps = BaseProps &
  Omit<React.HTMLAttributes<HTMLDivElement>, keyof BaseProps> & {
    useDiv: true;
  };

type InteractiveContainerProps = ButtonProps | DivProps;

export const InteractiveContainer = ({
  children,
  className,
  interactive = true,
  useDiv = false,
  fullWidth = true,
  showFocusRing = true,
  onClick,
  ...props
}: InteractiveContainerProps) => {
  const isClickable = typeof onClick === "function";
  const commonClassNames = clsx(
    fullWidth && "w-full",
    interactive && showFocusRing && "focus-ring-tight",
    "disabled:cursor-not-allowed disabled:opacity-50",
    className,
  );

  // Use a div when explicitly requested
  if (useDiv) {
    const {
      onKeyDown: userOnKeyDown,
      role: _explicitRole,
      tabIndex: explicitTabIndex,
      ...divProps
    } = props as Omit<React.HTMLAttributes<HTMLDivElement>, "onClick">;

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      userOnKeyDown?.(e);

      if (e.defaultPrevented) {
        return;
      }

      if (isClickable && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        onClick(e as unknown as React.MouseEvent<HTMLDivElement>);
      }
    };

    if (!isClickable) {
      return (
        <div className={commonClassNames} {...divProps}>
          {children}
        </div>
      );
    }

    return (
      <div
        className={commonClassNames}
        role="button"
        tabIndex={explicitTabIndex ?? 0}
        onClick={onClick as React.MouseEventHandler<HTMLDivElement>}
        onKeyDown={handleKeyDown}
        {...divProps}
      >
        {children}
      </div>
    );
  }

  // Otherwise, use a button (default)
  return (
    <button
      className={clsx(
        "appearance-none border-0 bg-transparent p-0 text-inherit",
        commonClassNames,
      )}
      type="button"
      onClick={onClick as React.MouseEventHandler<HTMLButtonElement>}
      {...(props as Omit<
        React.ButtonHTMLAttributes<HTMLButtonElement>,
        "onClick"
      >)}
    >
      {children}
    </button>
  );
};
