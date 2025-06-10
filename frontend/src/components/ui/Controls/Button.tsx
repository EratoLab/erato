import { t } from "@lingui/core/macro";
import clsx from "clsx";
import React, { useCallback, useMemo } from "react";

import { ConfirmationDialog } from "../Modal/ConfirmationDialog";

// Create a type for variants to improve type safety
export type ButtonVariant =
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
  confirmAction?: boolean;
  confirmTitle?: string;
  confirmMessage?: string;
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

// Update size styles to ensure mobile-friendly touch targets
const SIZE_STYLES = {
  sm: "p-2 min-h-[36px] min-w-[36px] text-sm",
  md: "px-3 py-2 min-h-[40px] min-w-[40px]",
  lg: "px-4 py-3 min-h-[44px] min-w-[44px]",
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
      confirmAction,
      confirmTitle = t`Confirm Action`,
      confirmMessage = t`Are you sure you want to proceed?`,
      ...props
    },
    ref,
  ) => {
    const [isPressed, setIsPressed] = React.useState(false);
    const [showConfirmDialog, setShowConfirmDialog] = React.useState(false);

    // Memoize the click handler
    const handleClick = useCallback(
      (e: React.MouseEvent<HTMLButtonElement>) => {
        setIsPressed(true);
        setTimeout(() => setIsPressed(false), 200);

        if (confirmAction) {
          e.stopPropagation();
          setShowConfirmDialog(true);
        } else {
          onClick?.(e);
        }
      },
      [onClick, confirmAction],
    );

    const handleConfirm = useCallback(
      (e: React.MouseEvent<HTMLButtonElement>) => {
        setShowConfirmDialog(false);
        onClick?.(e);
      },
      [onClick],
    );

    const handleCancel = useCallback(() => {
      setShowConfirmDialog(false);
    }, []);

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
      () => explicitRole ?? (variant === "list-item" ? "menuitem" : undefined),
      [explicitRole, variant],
    );

    // Validate props in development
    React.useEffect(() => {
      validateProps(props);
    }, [props]);

    const buttonClasses = useMemo(
      () =>
        clsx(
          "flex touch-manipulation items-center gap-2 rounded",
          "focus-ring",
          VARIANT_STYLES[variant],
          SIZE_STYLES[size],
          {
            "bg-theme-bg-selected": ariaPressed === true,
          },
          showOnHover && "theme-transition opacity-0 group-hover:opacity-100",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        ),
      [variant, size, ariaPressed, showOnHover, className],
    );

    const iconClasses = useMemo(
      () =>
        clsx(
          "flex items-center justify-center",
          variant === "icon-only" || variant === "sidebar-icon"
            ? "size-5"
            : "size-4",
        ),
      [variant],
    );

    return (
      <>
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

        {/* Confirmation Dialog Triggered by Button */}
        {confirmAction && (
          <ConfirmationDialog
            isOpen={showConfirmDialog}
            onClose={handleCancel}
            onConfirm={handleConfirm}
            title={confirmTitle}
            message={confirmMessage}
            confirmButtonVariant={variant === "danger" ? "danger" : "primary"}
          />
        )}
      </>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
Button.displayName = "Button";
