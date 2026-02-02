import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useState } from "react";

import { ResolvedIcon } from "@/components/ui/icons";
import { useThemedIcon } from "@/hooks/ui/useThemedIcon";

import { ToolCallInput } from "./ToolCallInput";
import { ToolCallOutput } from "./ToolCallOutput";

import type { UiToolCall } from "@/utils/adapters/toolCallAdapter";
import type React from "react";

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

  // Get themed icons for tool call status
  const successIconId = useThemedIcon("status", "success");
  const errorIconId = useThemedIcon("status", "error");
  // Use a timer/hourglass icon for in_progress - fallback to "Timer" if no theme override
  // eslint-disable-next-line lingui/no-unlocalized-strings
  const inProgressIconId = useThemedIcon("status", "in_progress") ?? "Timer";

  const statusConfig = {
    success: {
      icon: <ResolvedIcon iconId={successIconId} className="size-3" />,
      color: "text-green-600",
      bgColor: "bg-green-50",
      label: t`Success`,
    },
    error: {
      icon: <ResolvedIcon iconId={errorIconId} className="size-3" />,
      color: "text-red-600",
      bgColor: "bg-red-50",
      label: t`Error`,
    },
    in_progress: {
      icon: <ResolvedIcon iconId={inProgressIconId} className="size-3" />,
      color: "text-yellow-600",
      bgColor: "bg-yellow-50",
      label: t`In Progress`,
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
              "flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium",
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
          aria-label={`${showDetails ? t`Hide` : t`Show`} ${t`details for`} ${toolCall.name}`}
        >
          {showDetails ? t`Hide details` : t`Show details`}
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
