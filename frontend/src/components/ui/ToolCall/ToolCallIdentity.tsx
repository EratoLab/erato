import { t } from "@lingui/core/macro";
import clsx from "clsx";

/**
 * The tool a call ran and where, as the call names them, for the technical
 * details of a card or a trace row that leads with what the call does.
 */
export const ToolCallIdentity = ({
  toolName,
  server,
  className,
}: {
  toolName: string;
  server?: string;
  className?: string;
}) => (
  <dl
    className={clsx(
      "grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs",
      className,
    )}
    data-testid="tool-call-identity"
  >
    <dt className="text-theme-fg-muted">
      {t({ id: "toolCall.technicalDetails.tool", message: "Tool" })}
    </dt>
    <dd
      dir="auto"
      className="break-words font-mono text-theme-fg-primary [unicode-bidi:isolate]"
    >
      {toolName}
    </dd>
    {server && (
      <>
        <dt className="text-theme-fg-muted">
          {t({ id: "toolCall.technicalDetails.server", message: "Server" })}
        </dt>
        <dd
          dir="auto"
          className="break-words font-mono text-theme-fg-primary [unicode-bidi:isolate]"
        >
          {server}
        </dd>
      </>
    )}
  </dl>
);
