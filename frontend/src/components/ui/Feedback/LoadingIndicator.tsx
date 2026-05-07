import { t } from "@lingui/core/macro";
import clsx from "clsx";

import {
  ToolsIcon,
  TimerIcon,
  BrainIcon,
} from "@/components/ui/icons";

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
}

type LoadingStateConfig = {
  shouldPulse: boolean;
  getLabel: () => string;
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

export const LoadingIndicator = ({
  state,
  context,
  className,
}: LoadingIndicatorProps) => {
  const stateConfig = LOADING_STATE_CONFIG[state];

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
