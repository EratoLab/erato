import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  fetchUpdateProfilePreferences,
  profileQuery,
  useProfile,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { McpToolDecisionControl } from "./McpToolDecisionControl";

import type { McpToolDecision } from "./mcpToolDecisions";

export function ClientToolFileApprovalSetting() {
  const { data: profile } = useProfile({});
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const save = async (decision: McpToolDecision) => {
    /* eslint-disable lingui/no-unlocalized-strings -- API enum values. */
    const value =
      decision === "never"
        ? "never_allow"
        : decision === "allow"
          ? "always_allow"
          : "ask";
    /* eslint-enable lingui/no-unlocalized-strings */
    setSaving(true);
    setFailed(false);
    try {
      await fetchUpdateProfilePreferences({
        body: { client_tool_file_approval: value },
      });
      await queryClient.invalidateQueries({
        queryKey: profileQuery({}).queryKey,
      });
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm">
          {t({
            id: "preferences.dialog.desktopSidecar.fileApproval",
            message: "How to handle uploads for files retrieved by sidecar?",
          })}
        </span>
        <McpToolDecisionControl
          aria-label={t({
            id: "preferences.dialog.desktopSidecar.fileApproval",
            message: "How to handle uploads for files retrieved by sidecar?",
          })}
          value={
            profile?.client_tool_file_approval === "never_allow"
              ? "never"
              : profile?.client_tool_file_approval === "always_allow"
                ? "allow"
                : "ask"
          }
          policy="ask"
          availability={{ allowAlways: true, askAvailable: true }}
          disabled={!profile || saving}
          onChange={(decision) => {
            void save(decision);
          }}
        />
      </div>
      {failed && (
        <p role="alert">
          {t({
            id: "preferences.dialog.save.error",
            message: "Could not save preferences. Please try again.",
          })}
        </p>
      )}
    </div>
  );
}
