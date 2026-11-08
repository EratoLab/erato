import { t } from "@lingui/core/macro";
import clsx from "clsx";

import { SCROLL_BOX_CLASS, scrollBoxProps } from "@/lib/toolCallGist/scrollBox";

export interface McpToolDescriptionProps {
  description: string;
  /** Whether the backend cut the description at its display cap. */
  truncated: boolean;
  id?: string;
  className?: string;
  "data-testid"?: string;
}

/**
 * A vendor-authored MCP tool description, already bounded and cleaned by the
 * backend: inert text in a direction-isolated box whose height is capped,
 * because vendors write tutorials into it, plus a note when Erato shortened it.
 */
export const McpToolDescription = ({
  description,
  truncated,
  id,
  className,
  "data-testid": dataTestId,
}: McpToolDescriptionProps) => (
  <div id={id} className={clsx("space-y-1", className)}>
    <div
      dir="auto"
      data-testid={dataTestId}
      {...scrollBoxProps("description")}
      className={clsx(
        SCROLL_BOX_CLASS,
        "max-h-48 whitespace-pre-wrap text-xs text-theme-fg-secondary [overflow-wrap:anywhere] [unicode-bidi:isolate]",
      )}
    >
      {description}
    </div>
    {truncated ? (
      <p className="text-xs italic text-theme-fg-muted">
        {t({
          id: "preferences.dialog.tools.descriptionShortened",
          message: "Description shortened by Erato",
        })}
      </p>
    ) : null}
  </div>
);
