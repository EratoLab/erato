import clsx from "clsx";

import { McpToolDescription } from "@/components/ui/ToolCall";

import type { ToolDisplayMetadata } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ReactNode } from "react";

/**
 * The tool an approval asks about, from the descriptor saved when the call
 * parked: its title and where it runs, the executable name where the two
 * differ, and the description. The vendor-authored parts are shown as inert,
 * direction-isolated text; requests saved without a descriptor show the name.
 * The description stays open, because it bears on the decision.
 */
export const ApprovalToolHeading = ({
  toolName,
  display,
  icon,
  source,
  titleClassName = "font-medium",
  className,
}: {
  toolName: string;
  display?: ToolDisplayMetadata | null;
  icon: ReactNode;
  source: ReactNode;
  titleClassName?: string;
  className?: string;
}) => {
  const title = display?.title ?? toolName;
  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        {icon}
        <span
          dir="auto"
          className={clsx(
            "text-sm text-theme-fg-primary [unicode-bidi:isolate]",
            titleClassName,
          )}
        >
          {title}
        </span>
        <span className="text-xs text-theme-fg-muted">{source}</span>
      </div>
      {title !== toolName ? (
        <p
          dir="auto"
          className="mt-1 break-words font-mono text-xs text-theme-fg-muted [unicode-bidi:isolate]"
        >
          {toolName}
        </p>
      ) : null}
      {display?.description ? (
        <McpToolDescription
          className="mt-2"
          description={display.description}
          truncated={display.description_truncated}
        />
      ) : null}
    </div>
  );
};
