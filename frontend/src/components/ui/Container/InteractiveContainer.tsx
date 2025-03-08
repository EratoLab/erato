import clsx from "clsx";
import React from "react";

type ContainerElement = HTMLButtonElement | HTMLDivElement;

type BaseProps = {
  children: React.ReactNode;
  className?: string;
  interactive?: boolean; // Optional prop to control hover/focus states
  useDiv?: boolean; // Use div instead of button to prevent nesting buttons
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
  onClick,
  ...props
}: InteractiveContainerProps) => {
  const commonClassNames = clsx(
    "w-full",
    interactive && "hover:bg-theme-bg-accent focus:outline-none focus:ring-2",
    "disabled:opacity-50 disabled:cursor-not-allowed",
    className,
  );

  // Handle keyboard events for the div version (for accessibility)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.key === "Enter" || e.key === " ") && onClick) {
      e.preventDefault();
      onClick(e as unknown as React.MouseEvent<HTMLDivElement>);
    }

    // Call the original onKeyDown if provided
    if (props.onKeyDown) {
      (props as DivProps).onKeyDown?.(e);
    }
  };

  // Use a div when explicitly requested
  if (useDiv) {
    return (
      <div
        className={commonClassNames}
        role="button"
        tabIndex={0}
        onClick={onClick as React.MouseEventHandler<HTMLDivElement>}
        onKeyDown={handleKeyDown}
        {...(props as Omit<
          React.HTMLAttributes<HTMLDivElement>,
          "onClick" | "onKeyDown"
        >)}
      >
        {children}
      </div>
    );
  }

  // Otherwise, use a button (default)
  return (
    <button
      className={commonClassNames}
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
