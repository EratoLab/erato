import { t } from "@lingui/core/macro";
import clsx from "clsx";

import {
  ToolsIcon,
  SettingsIcon,
  CheckCircleIcon,
  ErrorIcon,
  TimerIcon,
  BrainIcon,
} from "@/components/ui/icons";

import type { ToolCall } from "@/hooks/chat/store/messagingStore";
import type { ReactNode } from "react";

// Define loading state types locally
export type LoadingState =
  | "tool-calling"
  | "reasoning"
  | "typing"
  | "thinking"
  | "done"
  | "error";

interface LoadingIndicatorProps {
  state: LoadingState;
  context?: string;
  className?: string;
  // New props for tool call display
  toolCalls?: Record<string, ToolCall>;
}

type LoadingStateConfig = {
  shouldPulse: boolean;
  getLabel: () => string;
  renderIcon: () => ReactNode;
};

type ToolCallStatusConfig = {
  colorClass: string;
  shouldPulse: boolean;
  renderIcon: () => ReactNode;
};

const LOADING_STATE_CONFIG = {
  "tool-calling": {
    shouldPulse: true,
    getLabel: () => t`Using tools`,
    renderIcon: () => <ToolsIcon className="size-4" />,
  },
  reasoning: {
    shouldPulse: true,
    getLabel: () => t`Thinking`,
    renderIcon: () => <BrainIcon className="size-4" />,
  },
  typing: {
    shouldPulse: true,
    getLabel: () => t`Loading`,
    renderIcon: () => <TimerIcon className="size-4" />,
  },
  thinking: {
    shouldPulse: true,
    getLabel: () => t`Loading`,
    renderIcon: () => <TimerIcon className="size-4" />,
  },
  done: {
    shouldPulse: false,
    getLabel: () => t`Loading`,
    renderIcon: () => <TimerIcon className="size-4" />,
  },
  error: {
    shouldPulse: false,
    getLabel: () => t`Loading`,
    renderIcon: () => <TimerIcon className="size-4" />,
  },
} satisfies Record<LoadingState, LoadingStateConfig>;

const TOOL_CALL_STATUS_CONFIG = {
  proposed: {
    colorClass: "text-theme-fg-secondary",
    shouldPulse: true,
    renderIcon: () => <ToolsIcon className="size-4" />,
  },
  in_progress: {
    colorClass: "text-theme-info-fg",
    shouldPulse: true,
    renderIcon: () => <SettingsIcon className="size-4" />,
  },
  success: {
    colorClass: "text-theme-success-fg",
    shouldPulse: false,
    renderIcon: () => <CheckCircleIcon className="size-4" />,
  },
  error: {
    colorClass: "text-theme-error-fg",
    shouldPulse: false,
    renderIcon: () => <ErrorIcon className="size-4" />,
  },
} satisfies Record<ToolCall["status"], ToolCallStatusConfig>;

// Tool call status indicator component
const ToolCallIndicator = ({ toolCall }: { toolCall: ToolCall }) => {
  const statusConfig = TOOL_CALL_STATUS_CONFIG[toolCall.status];

  return (
    <div
      className={clsx(
        "flex items-center gap-2 text-sm",
        statusConfig.shouldPulse && "animate-pulse",
        statusConfig.colorClass,
      )}
    >
      <span aria-hidden="true">{statusConfig.renderIcon()}</span>
      <span className="font-medium">{toolCall.name}</span>
      {toolCall.progressMessage && (
        <div className="text-xs text-theme-fg-muted">
          - {toolCall.progressMessage}
        </div>
      )}
    </div>
  );
};

export const LoadingIndicator = ({
  state,
  context,
  className,
  toolCalls,
}: LoadingIndicatorProps) => {
  const stateConfig = LOADING_STATE_CONFIG[state];

  // If we have tool calls to display, show them
  if (toolCalls && Object.keys(toolCalls).length > 0) {
    return (
      <div className={clsx("space-y-2", className)}>
        <div className="text-xs font-medium text-theme-fg-muted">
          {t`Tool usage:`}
        </div>
        <div className="space-y-1">
          {Object.values(toolCalls).map((toolCall) => (
            <ToolCallIndicator key={toolCall.id} toolCall={toolCall} />
          ))}
        </div>
      </div>
    );
  }

  // Default loading indicator
  return (
    <div
      className={clsx(
        "flex items-center gap-2 text-sm text-theme-fg-secondary",
        stateConfig.shouldPulse && "animate-pulse",
        className,
      )}
    >
      <span aria-hidden="true">{stateConfig.renderIcon()}</span>
      <span>{stateConfig.getLabel()}</span>
      {context && <span className="text-theme-fg-muted">{context}</span>}
    </div>
  );
};
