import React, { useCallback, useMemo } from "react";
import clsx from "clsx";

// Create a type for variants to improve type safety
type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "icon-only"
  | "sidebar-icon"
  | "list-item"
  | "danger";

type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-checked"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  showOnHover?: boolean;
  "aria-label"?: string;
  "aria-pressed"?: boolean;
  "aria-checked"?: boolean | "true" | "false" | "mixed";
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  role?: string;
}

// Extract variant styles to a constant
const VARIANT_STYLES = {
  primary: "bg-neutral-800 text-white hover:bg-neutral-700 theme-transition",
  secondary:
    "bg-theme-bg-secondary border border-theme-border hover:bg-theme-bg-hover text-theme-fg-secondary theme-transition",
  ghost:
    "text-theme-fg-secondary hover:bg-theme-bg-hover hover:text-theme-fg-primary theme-transition",
  danger: "text-theme-error-fg hover:bg-theme-error-bg theme-transition",
  "sidebar-icon":
    "p-2 rounded-lg text-theme-fg-secondary hover:bg-theme-bg-hover hover:text-theme-fg-primary theme-transition",
  "list-item":
    "w-full px-4 py-2 text-sm text-left text-theme-fg-secondary hover:bg-theme-bg-hover hover:text-theme-fg-primary theme-transition",
  "icon-only":
    "p-2 rounded-lg text-theme-fg-secondary hover:bg-theme-bg-hover hover:text-theme-fg-primary theme-transition",
} as const;

const SIZE_STYLES = {
  sm: "p-2 text-sm",
  md: "px-3 py-2",
  lg: "px-4 py-3",
} as const;

const validateProps = (props: ButtonProps) => {
  if (process.env.NODE_ENV === "development") {
    if (props.variant === "icon-only" && !props.icon) {
      console.warn("Icon-only button variant requires an icon prop");
    }
    if (
      (props.variant === "icon-only" || props.variant === "sidebar-icon") &&
      !props["aria-label"] &&
      !props.children
    ) {
      console.warn(
        "Icon-only buttons should have an aria-label for accessibility",
      );
    }
  }
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "secondary",
      size = "md",
      icon,
      children,
      className,
      showOnHover,
      type = "button", // Default to "button" to prevent accidental form submissions
      onClick,
      "aria-pressed": ariaPressed,
      "aria-checked": ariaChecked,
      "aria-label": ariaLabel,
      role: explicitRole,
      ...props
    },
    ref,
  ) => {
    const [isPressed, setIsPressed] = React.useState(false);

    // Memoize the click handler
    const handleClick = useCallback(
      (e: React.MouseEvent<HTMLButtonElement>) => {
        setIsPressed(true);
        setTimeout(() => setIsPressed(false), 200);
        onClick?.(e);
      },
      [onClick],
    );

    // Update aria state memoization to handle both pressed and checked
    const ariaState = useMemo(() => {
      if (explicitRole === "switch" && ariaChecked !== undefined) {
        return { "aria-checked": ariaChecked };
      }
      if (ariaPressed !== undefined) {
        return { "aria-pressed": ariaPressed };
      }
      return {};
    }, [explicitRole, ariaChecked, ariaPressed]);

    // Memoize role determination
    const role = useMemo(
      () => explicitRole || (variant === "list-item" ? "menuitem" : undefined),
      [explicitRole, variant],
    );

    // Validate props in development
    React.useEffect(() => {
      validateProps(props);
    }, [props]);

    const buttonClasses = useMemo(
      () =>
        clsx(
          "flex items-center gap-2 rounded",
          "focus-ring",
          VARIANT_STYLES[variant],
          SIZE_STYLES[size],
          {
            "bg-theme-bg-selected": ariaPressed === true,
          },
          showOnHover && "opacity-0 group-hover:opacity-100 theme-transition",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          className,
        ),
      [variant, size, ariaPressed, showOnHover, className],
    );

    const iconClasses = useMemo(
      () =>
        clsx(
          "flex items-center justify-center",
          variant === "icon-only" || variant === "sidebar-icon"
            ? "w-5 h-5"
            : "w-4 h-4",
        ),
      [variant],
    );

    return (
      <button
        ref={ref}
        type={type}
        onClick={handleClick}
        data-pressed={isPressed}
        {...ariaState}
        aria-label={ariaLabel}
        className={buttonClasses}
        role={role}
        {...props}
      >
        {icon && (
          <span className={iconClasses} aria-hidden="true">
            {icon}
          </span>
        )}
        {children}
      </button>
    );
  },
);

Button.displayName = "Button";
