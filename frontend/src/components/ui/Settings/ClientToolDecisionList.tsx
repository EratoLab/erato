import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  clientToolDecisionOf,
  controlDecisionOf,
  saveClientToolDecision,
} from "@/lib/clientToolDecisions";
import {
  profileQuery,
  useProfile,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { McpToolDecisionControl } from "./McpToolDecisionControl";
import { SettingsDisclosure } from "./SettingsDisclosure";

import type { McpToolDecision } from "./mcpToolDecisions";

/** One tool of the list and how the server asks for it. */
export interface ClientToolDecisionListTool {
  /** `namespace/name`, the key of the stored decision. */
  qualifiedName: string;
  label: string;
  /** The server asks on every call, so Always allow cannot be stored. */
  asksEveryTime?: boolean;
  "data-testid"?: string;
}

/**
 * Client tools with the user's standing decision for each, saved to the
 * profile's `client_tool_decisions`, which every device reads. A tool with no
 * stored decision shows `defaultDecision`, what the server does without one.
 */
export function ClientToolDecisionList({
  tools,
  defaultDecision,
  heading,
  "data-testid": dataTestId,
}: {
  tools: readonly ClientToolDecisionListTool[];
  defaultDecision: "allow" | "ask";
  heading: string;
  "data-testid"?: string;
}) {
  const { data: profile } = useProfile({});
  const queryClient = useQueryClient();
  // The choice being saved shows at once, so the control does not sit on the
  // old value until the profile has refetched.
  const [saving, setSaving] = useState<{
    qualifiedName: string;
    decision: McpToolDecision;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  if (tools.length === 0) return null;
  const save = async (qualifiedName: string, decision: McpToolDecision) => {
    setSaving({ qualifiedName, decision });
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
    <div className="space-y-2" data-testid={dataTestId}>
      <SettingsDisclosure title={heading} count={tools.length}>
        <ul className="divide-y divide-theme-border">
          {tools.map((tool) => {
            const { qualifiedName, label } = tool;
            return (
              <li
                key={qualifiedName}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <span className="text-sm text-theme-fg-secondary">{label}</span>
                <McpToolDecisionControl
                  value={
                    saving?.qualifiedName === qualifiedName
                      ? saving.decision
                      : controlDecisionOf(
                          profile?.client_tool_decisions?.[qualifiedName],
                          defaultDecision,
                        )
                  }
                  policy={defaultDecision === "ask" ? "ask" : "auto"}
                  availability={{
                    allowAlways: tool.asksEveryTime !== true,
                    askAvailable: true,
                  }}
                  onChange={(decision) => void save(qualifiedName, decision)}
                  disabled={!profile || saving !== null}
                  aria-label={label}
                  data-testid={tool["data-testid"]}
                />
              </li>
            );
          })}
        </ul>
      </SettingsDisclosure>
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
