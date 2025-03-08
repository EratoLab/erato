import {
  XMarkIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  ExclamationCircleIcon,
  CheckCircleIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import React from "react";

import { Button } from "../Controls/Button";

import type { ReactNode } from "react";

export type AlertType = "error" | "warning" | "info" | "success";

interface AlertProps {
  /** The type of alert to display */
  type: AlertType;
  /** Alert content */
  children: ReactNode;
  /** Title of the alert (optional) */
  title?: string;
  /** Whether the alert can be dismissed */
  dismissible?: boolean;
  /** Callback when the alert is dismissed */
  onDismiss?: () => void;
  /** Additional CSS classes */
  className?: string;
  /** Icon to display (if not provided, uses default for type) */
  icon?: ReactNode;
}

/**
 * Alert component for displaying various types of messages
 */
export const Alert: React.FC<AlertProps> = ({
  type = "info",
  children,
  title,
  dismissible = false,
  onDismiss,
  className = "",
  icon,
}) => {
  // Define styles for different alert types
  const styles = {
    error: {
      container:
        "bg-theme-error-bg text-theme-error-fg border-theme-error-border",
      icon: <ExclamationCircleIcon className="size-5" />,
    },
    warning: {
      container:
        "bg-theme-warning-bg text-theme-warning-fg border-theme-warning-border",
      icon: <ExclamationTriangleIcon className="size-5" />,
    },
    info: {
      container: "bg-theme-info-bg text-theme-info-fg border-theme-info-border",
      icon: <InformationCircleIcon className="size-5" />,
    },
    success: {
      container:
        "bg-theme-success-bg text-theme-success-fg border-theme-success-border",
      icon: <CheckCircleIcon className="size-5" />,
    },
  };

  // Use provided icon or default for the alert type
  const alertIcon = icon ?? styles[type].icon;

  return (
    <div
      className={clsx(
        "flex items-start gap-3 rounded-md border p-3",
        styles[type].container,
        className,
      )}
      role="alert"
    >
      <div className="mt-0.5 shrink-0">{alertIcon}</div>

      <div className="min-w-0 flex-1">
        {title && <h4 className="mb-1 font-medium">{title}</h4>}
        <div className="text-sm">{children}</div>
      </div>

      {dismissible && onDismiss && (
        <Button
          variant="icon-only"
          size="sm"
          className="-mr-1 -mt-1 shrink-0"
          onClick={onDismiss}
          icon={<XMarkIcon className="size-4" />}
          aria-label="Dismiss"
        />
      )}
    </div>
  );
};
