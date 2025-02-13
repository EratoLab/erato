import React from "react";
import clsx from "clsx";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:
    | "primary"
    | "secondary"
    | "ghost"
    | "icon-only"
    | "sidebar-icon"
    | "list-item"
    | "danger";
  size?: "sm" | "md" | "lg";
  icon?: React.ReactNode;
  children?: React.ReactNode;
  showOnHover?: boolean;
}

export const Button = ({
  variant = "secondary",
  size = "md",
  icon,
  children,
  className,
  showOnHover,
  ...props
}: ButtonProps) => {
  return (
    <button
      className={clsx(
        "flex items-center gap-2 rounded transition-colors",
        {
          // Base variants
          "bg-theme-fg-primary text-theme-bg-primary hover:bg-theme-fg-secondary":
            variant === "primary",
          "bg-theme-bg-primary hover:bg-theme-bg-secondary text-theme-fg-secondary":
            variant === "secondary",
          "hover:bg-theme-bg-secondary text-theme-fg-secondary":
            variant === "ghost",
          "text-theme-danger hover:text-theme-danger-hover hover:bg-theme-danger-bg":
            variant === "danger",

          // Special variants
          "p-2 rounded-lg text-theme-fg-secondary hover:text-theme-fg-primary":
            variant === "sidebar-icon",
          "w-full px-4 py-2 text-sm text-left hover:bg-theme-bg-accent":
            variant === "list-item",
          "p-2 rounded-lg": variant === "icon-only",
        },
        {
          "p-2 text-sm": size === "sm",
          "px-3 py-2": size === "md",
          "px-4 py-3": size === "lg",
        },
        showOnHover && "opacity-0 group-hover:opacity-100 transition-opacity",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    >
      {icon && (
        <span
          className={clsx(
            "flex items-center justify-center",
            variant === "icon-only" || variant === "sidebar-icon"
              ? "w-5 h-5"
              : "w-4 h-4",
          )}
        >
          {icon}
        </span>
      )}
      {children}
    </button>
  );
};
