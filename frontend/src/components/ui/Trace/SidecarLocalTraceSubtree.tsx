import { useSyncExternalStore } from "react";

import {
  getSidecarLocalTrace,
  isSidecarTraceResultTool,
  persistedSidecarLocalTrace,
  subscribeSidecarLocalTraces,
} from "@/lib/desktopSidecar/localTraceStore";

import { SidecarLocalTraceView } from "./SidecarLocalTraceView";

export interface SidecarLocalTraceSubtreeProps {
  toolCallId: string;
  /**
   * Tool name of the call. Persisted outputs are only trusted to carry a
   * trace for known sidecar tools; without the gate, any tool's output could
   * impersonate an on-device trace.
   */
  toolName?: string;
  /** The persisted `{status, result}` envelope of the tool call, if any. */
  output?: unknown;
}

/**
 * The nested on-device trace of a sidecar-backed tool call, rendered under
 * its tool step in the trace the way a subagent's steps render inside an
 * agent step.
 *
 * The session store is tool-agnostic: it renders whatever our own executors
 * recorded for this tool call. Persisted results are gated by tool name and
 * sanitized, because that payload is whatever the tool returned. Resolution
 * order is persisted result first (survives reloads once the user consented
 * to sharing), then this session's store (covers the in-flight and declined
 * cases, where no result reached the backend).
 */
export const SidecarLocalTraceSubtree = ({
  toolCallId,
  toolName,
  output,
}: SidecarLocalTraceSubtreeProps) => {
  const ephemeral = useSyncExternalStore(subscribeSidecarLocalTraces, () =>
    getSidecarLocalTrace(toolCallId),
  );
  const persisted = isSidecarTraceResultTool(toolName)
    ? persistedSidecarLocalTrace(output)
    : undefined;
  const trace = persisted ?? ephemeral;
  if (!trace) {
    return null;
  }
  return (
    <div className="py-0.5">
      <SidecarLocalTraceView trace={trace} />
    </div>
  );
};
