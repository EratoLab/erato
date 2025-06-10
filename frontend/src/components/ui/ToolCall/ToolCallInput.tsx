import { t } from "@lingui/core/macro";

import { JsonDisplay } from "./JsonDisplay";

import type React from "react";

export interface ToolCallInputProps {
  input: unknown;
  className?: string;
}

/**
 * Component to display tool call input in a readable format
 */
export const ToolCallInput: React.FC<ToolCallInputProps> = ({
  input,
  className,
}) => {
  return (
    <div className={className}>
      <div className="mb-2 text-xs font-medium text-theme-fg-secondary">
        {t`Input Parameters`}
      </div>
      <JsonDisplay data={input} />
    </div>
  );
};
