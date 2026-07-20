import { t } from "@lingui/core/macro";
import clsx from "clsx";
import React, { useCallback, useMemo } from "react";

import { SpinnerIcon } from "../Feedback/SpinnerIcon";
import { ConfirmationDialog } from "../Modal/ConfirmationDialog";

// Create a type for variants to improve type safety
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "icon-only"
  | "sidebar-icon"
  | "list-item"
  | "link"
  | "danger";

type ButtonSize = "sm" | "md" | "lg";

// Shape controls the corner geometry. "pill" yields a fully rounded button;
// it replaces the ad-hoc `className="rounded-full"` overrides callers used to
// pass. Utilities still win over this since geometry lives in @layer components.
type ButtonShape = "default" | "pill";

// Geometry is the size/padding/radius axis, independent of the colour `variant`.
// A button that renders only an icon should use "icon" (square, no inline
// padding) whatever its colour is — before this existed, the only way to get
// icon geometry was `variant="icon-only"`, which also forces a transparent
// ghost look, so filled icon buttons were stuck with text-button geometry.
type ButtonGeometry = "control" | "icon";

interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-checked"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  shape?: ButtonShape;
  /**
   * Opt a non-`icon-only` button into square icon geometry. Defaults to
   * "control" (text-button padding); `variant="icon-only"` implies "icon".
   */
  geometry?: ButtonGeometry;
  icon?: React.ReactNode;
  iconClassName?: string;
  children?: React.ReactNode;
  showOnHover?: boolean;
  /**
   * When true, the button shows a spinner in place of its icon, is disabled,
   * and is marked aria-busy. Replaces the manual "spinner-as-icon + disabled"
   * pattern callers previously hand-rolled.
   */
  loading?: boolean;
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
  primary:
    "bg-theme-action-primary-bg text-theme-action-primary-fg hover:bg-theme-action-primary-hover theme-transition",
  secondary:
    "bg-theme-bg-secondary border border-theme-border hover:bg-theme-bg-hover text-theme-fg-secondary theme-transition",
  ghost:
    "text-theme-fg-secondary hover:bg-theme-bg-hover hover:text-theme-fg-primary theme-transition",
  danger:
    "border border-theme-error-border bg-theme-error-bg text-theme-error-fg hover:brightness-95 theme-transition",
  "sidebar-icon":
    "text-theme-fg-secondary hover:bg-theme-bg-hover hover:text-theme-fg-primary theme-transition",
  "list-item":
    "w-full text-sm text-left text-theme-fg-secondary hover:bg-theme-bg-hover hover:text-theme-fg-primary theme-transition",
  "icon-only":
    "text-theme-fg-secondary hover:bg-theme-bg-hover hover:text-theme-fg-primary theme-transition",
  // Text-only, inline link affordance — no background or control geometry.
  link: "text-theme-fg-muted hover:text-theme-fg-primary hover:underline theme-transition",
} as const;

// Size geometry classes defined in globals.css @layer components
// so consumer Tailwind utilities (e.g. p-0) can override them.
// Each size pins its own type scale. Leaving md/lg unset made a button's font
// size depend on whatever container it happened to land in rather than on its
// own size prop, so a default-size button next to a size="sm" one disagreed —
// visible wherever the two sit together, e.g. dialog footers.
const CONTROL_SIZE_STYLES = {
  sm: "btn-geometry-sm text-sm",
  md: "btn-geometry-md text-base",
  lg: "btn-geometry-lg text-lg",
} as const;

const ICON_SIZE_STYLES = {
  sm: "btn-geometry-icon-sm",
  md: "btn-geometry-icon-md",
  lg: "btn-geometry-icon-lg",
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
      shape = "default",
      geometry = "control",
      icon,
      iconClassName,
      children,
      className,
      showOnHover,
      loading = false,
      disabled,
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
    const pressTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
      null,
    );

    React.useEffect(() => {
      return () => {
        if (pressTimerRef.current !== null) {
          clearTimeout(pressTimerRef.current);
        }
      };
    }, []);

    // Memoize the click handler
    const handleClick = useCallback(
      (e: React.MouseEvent<HTMLButtonElement>) => {
        setIsPressed(true);
        pressTimerRef.current = setTimeout(() => setIsPressed(false), 200);

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

    const usesIconGeometry = variant === "icon-only" || geometry === "icon";

    const buttonClasses = useMemo(
      () =>
        clsx(
          "flex touch-manipulation items-center gap-2",
          "focus-ring",
          VARIANT_STYLES[variant],
          variant === "list-item"
            ? "btn-geometry-list-item"
            : usesIconGeometry
              ? ICON_SIZE_STYLES[size]
              : // Link is a text affordance — it intentionally carries no control
                // geometry (no padding, min-height, or radius).
                variant === "link"
                ? ""
                : CONTROL_SIZE_STYLES[size],
          // Reads the token rather than Tailwind's hardcoded 9999px, so
          // `radius.pill` in theme.json actually reaches pill buttons.
          shape === "pill" && "rounded-[var(--theme-radius-pill)]",
          {
            "bg-theme-bg-selected": ariaPressed === true,
            "justify-center": usesIconGeometry,
          },
          showOnHover && "theme-transition opacity-0 group-hover:opacity-100",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        ),
      [
        variant,
        size,
        shape,
        usesIconGeometry,
        ariaPressed,
        showOnHover,
        className,
      ],
    );

    const iconClasses = useMemo(
      () =>
        clsx(
          "flex items-center justify-center",
          variant === "icon-only" || variant === "sidebar-icon"
            ? "size-5"
            : "size-4",
          iconClassName,
        ),
      [iconClassName, variant],
    );

    const isDisabled = loading || Boolean(disabled);

    return (
      <>
        <button
          ref={ref}
          type={type}
          onClick={handleClick}
          data-pressed={isPressed}
          // Stable theming hooks: `data-geometry` is the resolved geometry
          // (not the raw props), so theme.css can target "every icon control
          // in this surface" without naming private btn-geometry-* classes.
          data-geometry={
            variant === "list-item"
              ? "list-item"
              : variant === "link"
                ? "link"
                : usesIconGeometry
                  ? `icon-${size}`
                  : size
          }
          data-variant={variant}
          {...ariaState}
          aria-label={ariaLabel}
          className={buttonClasses}
          role={role}
          {...props}
          disabled={isDisabled}
          aria-busy={loading || undefined}
        >
          {(loading || icon) && (
            <span className={iconClasses} aria-hidden="true">
              {loading ? <SpinnerIcon size="sm" /> : icon}
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
