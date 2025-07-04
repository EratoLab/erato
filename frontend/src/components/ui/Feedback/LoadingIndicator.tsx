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

// Tool call status indicator component
const ToolCallIndicator = ({ toolCall }: { toolCall: ToolCall }) => {
  const getStatusIcon = () => {
    switch (toolCall.status) {
      case "proposed":
        return <ToolsIcon className="size-4" />;
      case "in_progress":
        return <SettingsIcon className="size-4" />;
      case "success":
        return <CheckCircleIcon className="size-4" />;
      case "error":
        return <ErrorIcon className="size-4" />;
      default:
        return <ToolsIcon className="size-4" />;
    }
  };

  const getStatusColor = () => {
    switch (toolCall.status) {
      case "success":
        return "text-green-600";
      case "error":
        return "text-red-600";
      case "in_progress":
        return "text-blue-600";
      default:
        return "text-theme-fg-secondary";
    }
  };

  return (
    <div className={clsx("flex items-center gap-2 text-sm", getStatusColor())}>
      <span aria-hidden="true">{getStatusIcon()}</span>
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
  const getStateIcon = () => {
    switch (state) {
      case "tool-calling":
        return <ToolsIcon className="size-4" />;
      case "reasoning":
        return <BrainIcon className="size-4" />;
      default:
        return <TimerIcon className="size-4" />;
    }
  };

  const getStateLabel = () => {
    switch (state) {
      case "tool-calling":
        return t`Using tools`;
      case "reasoning":
        return t`Thinking`;
      default:
        return t`Loading`;
    }
  };

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
        "animate-pulse",
        className,
      )}
    >
      <span aria-hidden="true">{getStateIcon()}</span>
      <span>{getStateLabel()}</span>
      {context && <span className="text-theme-fg-muted">{context}</span>}
    </div>
  );
};
