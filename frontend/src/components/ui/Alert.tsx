import React, { ReactNode } from "react";
import clsx from "clsx";
import { XMarkIcon } from "@heroicons/react/24/outline";
import {
  ExclamationTriangleIcon,
  InformationCircleIcon,
  ExclamationCircleIcon,
  CheckCircleIcon,
} from "@heroicons/react/24/outline";
import { Button } from "./Button";

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
      container: "bg-theme-error-bg text-theme-error border-theme-error-border",
      icon: <ExclamationCircleIcon className="h-5 w-5" />,
    },
    warning: {
      container:
        "bg-theme-warning-bg text-theme-warning border-theme-warning-border",
      icon: <ExclamationTriangleIcon className="h-5 w-5" />,
    },
    info: {
      container: "bg-theme-info-bg text-theme-info border-theme-info-border",
      icon: <InformationCircleIcon className="h-5 w-5" />,
    },
    success: {
      container:
        "bg-theme-success-bg text-theme-success border-theme-success-border",
      icon: <CheckCircleIcon className="h-5 w-5" />,
    },
  };

  // Use provided icon or default for the alert type
  const alertIcon = icon || styles[type].icon;

  return (
    <div
      className={clsx(
        "flex items-start gap-3 p-3 border rounded-md",
        styles[type].container,
        className,
      )}
      role="alert"
    >
      <div className="flex-shrink-0 mt-0.5">{alertIcon}</div>

      <div className="flex-1 min-w-0">
        {title && <h4 className="font-medium mb-1">{title}</h4>}
        <div className="text-sm">{children}</div>
      </div>

      {dismissible && onDismiss && (
        <Button
          variant="icon-only"
          size="sm"
          className="flex-shrink-0 -mt-1 -mr-1"
          onClick={onDismiss}
          icon={<XMarkIcon className="h-4 w-4" />}
          aria-label="Dismiss"
        />
      )}
    </div>
  );
};
