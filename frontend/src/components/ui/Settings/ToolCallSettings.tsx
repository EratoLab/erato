import clsx from "clsx";
import React from "react";

import { useToolCallSettings } from "@/hooks/useToolCallSettings";

export interface ToolCallSettingsProps {
  className?: string;
  /**
   * Layout style for the settings
   * @default "inline"
   */
  layout?: "inline" | "vertical";
}

/**
 * Component to allow users to configure tool call display preferences
 */
export const ToolCallSettings: React.FC<ToolCallSettingsProps> = ({
  className,
  layout = "inline",
}) => {
  const { settings, toggleShowToolCalls, toggleDefaultExpanded } =
    useToolCallSettings();

  return (
    <div
      className={clsx(
        "space-y-3 rounded-lg border border-theme-border-primary p-3",
        "bg-theme-bg-tertiary",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-theme-fg-primary">
          Tool Call Display
        </h3>
      </div>

      <div
        className={clsx(
          layout === "inline"
            ? "flex items-center justify-between gap-4"
            : "space-y-3",
        )}
      >
        {/* Show Tool Calls Toggle */}
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={settings.showToolCalls}
              onChange={toggleShowToolCalls}
              className={clsx(
                "size-4 rounded border-theme-border-primary",
                "text-theme-fg-accent focus:ring-theme-fg-accent focus:ring-offset-0",
                "bg-theme-bg-primary",
              )}
            />
            <span className="text-sm text-theme-fg-secondary">
              Show tool calls
            </span>
          </label>
        </div>

        {/* Default Expanded Toggle */}
        <div
          className={clsx(
            "flex items-center gap-3",
            !settings.showToolCalls && "pointer-events-none opacity-50",
          )}
        >
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={settings.defaultExpanded}
              onChange={toggleDefaultExpanded}
              disabled={!settings.showToolCalls}
              className={clsx(
                "size-4 rounded border-theme-border-primary",
                "text-theme-fg-accent focus:ring-theme-fg-accent focus:ring-offset-0",
                "bg-theme-bg-primary",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            />
            <span className="text-sm text-theme-fg-secondary">
              Expand by default
            </span>
          </label>
        </div>
      </div>

      {/* Help Text */}
      <div className="text-xs text-theme-fg-muted">
        Tool calls show how the assistant used external tools to generate
        responses.
      </div>
    </div>
  );
};
