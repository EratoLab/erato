import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  SIDECAR_CHAT_TOOL_METHODS,
  sidecarQualifiedToolName,
} from "@/lib/desktopSidecar/chatTools";
import {
  clientToolDecisionOf,
  controlDecisionOf,
  saveClientToolDecision,
} from "@/lib/desktopSidecar/toolDecisions";
import { sidecarToolLabel } from "@/lib/desktopSidecar/toolLabels";
import {
  profileQuery,
  useProfile,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { McpToolDecisionControl } from "./McpToolDecisionControl";

import type { McpToolDecision } from "./mcpToolDecisions";
import type { DesktopSidecarClient } from "@erato/desktop-sidecar-protocol";

/** Tools the connected sidecar can run, each with the user's standing decision. */
export function SidecarToolDecisions({
  client,
}: {
  client: DesktopSidecarClient;
}) {
  const { data: profile } = useProfile({});
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const tools = SIDECAR_CHAT_TOOL_METHODS.filter(({ method }) =>
    client.supports(method),
  );
  if (tools.length === 0) return null;
  const save = async (qualifiedName: string, decision: McpToolDecision) => {
    setSaving(qualifiedName);
    setFailed(false);
    try {
      await saveClientToolDecision(
        qualifiedName,
        clientToolDecisionOf(decision),
      );
      await queryClient.invalidateQueries({
        queryKey: profileQuery({}).queryKey,
      });
    } catch {
      setFailed(true);
    } finally {
      setSaving(null);
    }
  };
  return (
    <div className="space-y-2" data-testid="sidecar-tool-decisions">
      <span className="text-sm">
        {t({
          id: "preferences.dialog.desktopSidecar.tools.heading",
          message: "Tools the assistant may use on this device",
        })}
      </span>
      <ul className="divide-y divide-theme-border">
        {tools.map(({ name }) => {
          const qualifiedName = sidecarQualifiedToolName(name);
          const label = sidecarToolLabel(name);
          return (
            <li
              key={name}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <span className="text-sm text-theme-fg-secondary">{label}</span>
              <McpToolDecisionControl
                value={controlDecisionOf(
                  profile?.client_tool_decisions?.[qualifiedName],
                )}
                policy="auto"
                availability={{ allowAlways: true, askAvailable: true }}
                onChange={(decision) => void save(qualifiedName, decision)}
                disabled={!profile || saving !== null}
                aria-label={label}
                data-testid={`sidecar-tool-decision-${name}`}
              />
            </li>
          );
        })}
      </ul>
      {failed ? (
        <p role="alert" className="text-sm text-theme-error-fg">
          {t({
            id: "preferences.dialog.desktopSidecar.tools.saveFailed",
            message: "Could not save this choice. Try again.",
          })}
        </p>
      ) : null}
    </div>
  );
}
