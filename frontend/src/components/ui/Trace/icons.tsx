import {
  BrainIcon,
  CheckCircleIcon,
  ErrorIcon,
  HourglassIcon,
  ToolsIcon,
} from "@/components/ui/icons";

import type { TraceStepStatus } from "./types";
import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const ICON_CLASS = "size-4";

/**
 * Pick the rail icon for a step, given its content type and current status.
 * `done` and `error` render generic terminal icons; the running state shows
 * the type-specific glyph.
 */
export const railIconFor = (
  contentType: ContentPart["content_type"],
  status: TraceStepStatus,
): React.ReactNode => {
  if (status === "error") {
    return <ErrorIcon className={ICON_CLASS} />;
  }
  if (status === "done") {
    return <CheckCircleIcon className={ICON_CLASS} />;
  }

  switch (contentType) {
    case "reasoning":
      return <BrainIcon className={ICON_CLASS} />;
    case "tool_use":
      return <ToolsIcon className={ICON_CLASS} />;
    default:
      return <HourglassIcon className={ICON_CLASS} />;
  }
};
