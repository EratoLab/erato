import clsx from "clsx";
import React, { useState } from "react";

import { ToolCallInput } from "./ToolCallInput";
import { ToolCallOutput } from "./ToolCallOutput";

import type { UiToolCall } from "@/utils/adapters/toolCallAdapter";

export interface ToolCallItemProps {
  toolCall: UiToolCall;
  className?: string;
}

/**
 * Component to display a single tool call with its input and output
 */
export const ToolCallItem: React.FC<ToolCallItemProps> = ({
  toolCall,
  className,
}) => {
  const [showDetails, setShowDetails] = useState(false);

  const statusConfig = {
    success: {
      icon: "✓",
      color: "text-green-600",
      bgColor: "bg-green-50",
      label: "Success",
    },
    error: {
      icon: "✗",
      color: "text-red-600",
      bgColor: "bg-red-50",
      label: "Error",
    },
    in_progress: {
      icon: "⏳",
      color: "text-yellow-600",
      bgColor: "bg-yellow-50",
      label: "In Progress",
    },
  };

  const config = statusConfig[toolCall.status];

  return (
    <div className={clsx("p-3", className)}>
      {/* Tool Call Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className={clsx(
              "rounded-full px-2 py-1 text-xs font-medium",
              config.bgColor,
              config.color,
            )}
          >
            {config.icon} {config.label}
          </div>
          <span className="font-mono text-sm font-medium text-theme-fg-primary">
            {toolCall.name}
          </span>
        </div>
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="text-xs text-theme-fg-muted hover:text-theme-fg-secondary"
          type="button"
          aria-expanded={showDetails}
          aria-label={`${showDetails ? "Hide" : "Show"} details for ${toolCall.name}`}
        >
          {showDetails ? "Hide details" : "Show details"}
        </button>
      </div>

      {/* Progress Message */}
      {toolCall.progressMessage && (
        <div className="mt-2 text-xs text-theme-fg-muted">
          {toolCall.progressMessage}
        </div>
      )}

      {/* Tool Call Details */}
      {showDetails && (
        <div className="mt-3 space-y-3">
          {/* Input */}
          {toolCall.input != null && <ToolCallInput input={toolCall.input} />}

          {/* Output */}
          {toolCall.output != null && (
            <ToolCallOutput
              output={toolCall.output}
              isError={toolCall.status === "error"}
            />
          )}
        </div>
      )}
    </div>
  );
};
