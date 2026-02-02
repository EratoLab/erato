import { t } from "@lingui/core/macro";
import clsx from "clsx";

import { useThemedIcon } from "@/hooks/ui/useThemedIcon";

import { Button } from "../Controls/Button";
import { CloseIcon, ResolvedIcon } from "../icons";

import type React from "react";
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
  /** Test ID for e2e testing */
  "data-testid"?: string;
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
  "data-testid": dataTestId,
}) => {
  // Get themed icon IDs for each alert type
  const errorIconId = useThemedIcon("status", "error");
  const warningIconId = useThemedIcon("status", "warning");
  const infoIconId = useThemedIcon("status", "info");
  const successIconId = useThemedIcon("status", "success");

  // Define styles for different alert types
  const styles = {
    error: {
      container:
        "bg-theme-error-bg text-theme-error-fg border-theme-error-border",
      iconId: errorIconId,
    },
    warning: {
      container:
        "bg-theme-warning-bg text-theme-warning-fg border-theme-warning-border",
      iconId: warningIconId,
    },
    info: {
      container: "bg-theme-info-bg text-theme-info-fg border-theme-info-border",
      iconId: infoIconId,
    },
    success: {
      container:
        "bg-theme-success-bg text-theme-success-fg border-theme-success-border",
      iconId: successIconId,
    },
  };

  // Use provided icon or default for the alert type
  const alertIcon = icon ?? (
    <ResolvedIcon iconId={styles[type].iconId} className="size-5" />
  );

  return (
    <div
      className={clsx(
        "flex items-start gap-3 rounded-md border p-3",
        styles[type].container,
        className,
      )}
      role="alert"
      data-testid={dataTestId}
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
          icon={<CloseIcon className="size-4" />}
          aria-label={t`Dismiss`}
        />
      )}
    </div>
  );
};
