import React from "react";
import { LoadingState } from "@/types/chat";
import clsx from "clsx";

interface LoadingIndicatorProps {
  state: LoadingState;
  context?: string;
  className?: string;
}

export const LoadingIndicator = ({
  state,
  context,
  className,
}: LoadingIndicatorProps) => {
  const getStateIcon = () => {
    switch (state) {
      case "tool-calling":
        return "🔧";
      case "reasoning":
        return "💭";
      default:
        return "⏳";
    }
  };

  const getStateLabel = () => {
    switch (state) {
      case "tool-calling":
        return "Using tools";
      case "reasoning":
        return "Thinking";
      default:
        return "Loading";
    }
  };

  return (
    <div
      className={clsx(
        "flex items-center gap-2 text-sm text-theme-fg-secondary",
        "animate-pulse",
        className,
      )}
    >
      <span role="img" aria-hidden="true">
        {getStateIcon()}
      </span>
      <span>{getStateLabel()}</span>
      {context && <span className="text-theme-fg-muted">{context}</span>}
    </div>
  );
};
