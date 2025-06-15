import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useState } from "react";

import { ToolsIcon, CheckIcon, ErrorIcon } from "@/components/ui/icons";

import { ToolCallItem } from ".";

import type { UiToolCall } from "@/utils/adapters/toolCallAdapter";
import type React from "react";

export interface ToolCallDisplayProps {
  toolCalls?: UiToolCall[];
  className?: string;
  /**
   * Whether to show tool calls by default
   * @default false
   */
  defaultExpanded?: boolean;
  /**
   * Whether to allow toggling the display
   * @default true
   */
  allowToggle?: boolean;
}

/**
 * Component to display completed tool calls with optional expand/collapse functionality
 */
export const ToolCallDisplay: React.FC<ToolCallDisplayProps> = ({
  toolCalls,
  className,
  defaultExpanded = false,
  allowToggle = true,
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  if (!toolCalls || toolCalls.length === 0) {
    return null;
  }

  const toggleExpanded = () => {
    if (allowToggle) {
      setIsExpanded(!isExpanded);
    }
  };

  const successCount = toolCalls.filter(
    (call) => call.status === "success",
  ).length;
  const errorCount = toolCalls.filter((call) => call.status === "error").length;

  return (
    <div className={clsx("mt-3 rounded-lg bg-theme-bg-hover", className)}>
      {/* Header */}
      <div
        className={clsx(
          "flex items-center justify-between px-3 py-2",
          "bg-theme-bg-accent",
          {
            "cursor-pointer hover:bg-theme-bg-selected": allowToggle,
            "rounded-t-lg": true,
            "rounded-b-lg": !isExpanded,
          },
        )}
        onClick={toggleExpanded}
        role={allowToggle ? "button" : undefined}
        tabIndex={allowToggle ? 0 : undefined}
        onKeyDown={
          allowToggle
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleExpanded();
                }
              }
            : undefined
        }
        aria-expanded={allowToggle ? isExpanded : undefined}
        aria-label={`${t`Tool calls`} (${toolCalls.length} ${t`total`}, ${successCount} ${t`successful`}, ${errorCount} ${t`failed`})`}
      >
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <span className="flex items-center gap-1 text-xs font-medium text-theme-fg-secondary">
              <ToolsIcon className="size-3" />
              {t`Tool Calls`}
            </span>
            <span className="rounded-full bg-theme-bg-secondary px-2 py-0.5 text-xs font-medium text-theme-fg-accent">
              {toolCalls.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {successCount > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-theme-success-bg px-1.5 py-0.5 text-xs font-medium text-theme-success-fg">
                <CheckIcon className="size-3" />
                {successCount}
              </span>
            )}
            {errorCount > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-theme-error-bg px-1.5 py-0.5 text-xs font-medium text-theme-error-fg">
                <ErrorIcon className="size-3" />
                {errorCount}
              </span>
            )}
          </div>
        </div>
        {allowToggle && (
          <div className="flex items-center">
            <span
              className={clsx(
                "text-theme-fg-muted transition-transform",
                isExpanded ? "rotate-180" : "rotate-0",
              )}
            >
              ▼
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="divide-y divide-theme-border">
          {toolCalls.map((toolCall) => (
            <ToolCallItem key={toolCall.id} toolCall={toolCall} />
          ))}
        </div>
      )}
    </div>
  );
};
