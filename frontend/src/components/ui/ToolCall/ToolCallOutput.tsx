import { t } from "@lingui/core/macro";
import clsx from "clsx";
import React from "react";

import { JsonDisplay } from "./JsonDisplay";

export interface ToolCallOutputProps {
  output: unknown;
  isError?: boolean;
  className?: string;
}

/**
 * Component to display tool call output in a readable format
 */
export const ToolCallOutput: React.FC<ToolCallOutputProps> = ({
  output,
  isError = false,
  className,
}) => {
  return (
    <div className={className}>
      <div
        className={clsx(
          "mb-2 text-xs font-medium",
          isError ? "text-red-600" : "text-theme-fg-secondary",
        )}
      >
        {isError ? t`Error Output` : t`Output`}
      </div>
      <div className={clsx({ "opacity-75": isError })}>
        <JsonDisplay data={output} />
      </div>
    </div>
  );
};
