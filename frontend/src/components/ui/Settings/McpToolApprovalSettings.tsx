import { t } from "@lingui/core/macro";
import { skipToken } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useState } from "react";

import {
  useCreateUserToolApprovalSetting,
  useDeactivateUserToolApprovalSetting,
  useListUserToolApprovalSettings,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { RadioCard } from "../Controls/RadioCard";
import { Alert } from "../Feedback/Alert";

interface ApprovalRow {
  mcpServerId: string;
  toolName: string;
}

const rowKey = (row: ApprovalRow) => `${row.mcpServerId}/${row.toolName}`;

/**
 * Per-tool approval decisions, mirroring the add-in's client-action settings
 * idiom (BehaviorTabContent): one radiogroup per tool with the two decisions
 * the backend can honor — ask per use (no stored grant) or always allow (a
 * persisted grant). Rows exist only for tools the user has granted at some
 * point: no endpoint enumerates MCP tools, so the roster grows with use. A
 * row flipped back to "ask" stays visible for the rest of the settings
 * session so the flip feels stable and reversible; it drops off on the next
 * visit.
 */
export function McpToolApprovalSettings({ isActive }: { isActive: boolean }) {
  const radioGroupName = useId();
  const [knownRows, setKnownRows] = useState<Map<string, ApprovalRow>>(
    () => new Map(),
  );
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const {
    data: approvalsResponse,
    error: loadError,
    refetch,
  } = useListUserToolApprovalSettings(isActive ? {} : skipToken, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const { mutateAsync: createApproval } = useCreateUserToolApprovalSetting();
  const { mutateAsync: deactivateApproval } =
    useDeactivateUserToolApprovalSetting();

  // Grow the session roster from every fetch; never shrink, so a row whose
  // grant was just deactivated keeps rendering (now at "ask").
  useEffect(() => {
    if (!approvalsResponse) {
      return;
    }
    setKnownRows((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const setting of approvalsResponse.settings) {
        const key = `${setting.mcp_server_id}/${setting.tool_name}`;
        if (!next.has(key)) {
          next.set(key, {
            mcpServerId: setting.mcp_server_id,
            toolName: setting.tool_name,
          });
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [approvalsResponse]);

  const grantIdByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const setting of approvalsResponse?.settings ?? []) {
      map.set(`${setting.mcp_server_id}/${setting.tool_name}`, setting.id);
    }
    return map;
  }, [approvalsResponse]);

  const serverGroups = useMemo(() => {
    const groups = new Map<string, ApprovalRow[]>();
    for (const row of knownRows.values()) {
      const rows = groups.get(row.mcpServerId) ?? [];
      rows.push(row);
      groups.set(row.mcpServerId, rows);
    }
    for (const rows of groups.values()) {
      rows.sort((a, b) => a.toolName.localeCompare(b.toolName));
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [knownRows]);

  const setDecision = async (row: ApprovalRow, decision: "ask" | "always") => {
    const key = rowKey(row);
    const grantId = grantIdByKey.get(key);
    if ((decision === "always") === (grantId !== undefined)) {
      return;
    }
    setMutationError(null);
    setPendingKey(key);
    try {
      if (decision === "ask" && grantId !== undefined) {
        await deactivateApproval({ pathParams: { settingId: grantId } });
      } else {
        await createApproval({
          body: { mcp_server_id: row.mcpServerId, tool_name: row.toolName },
        });
      }
      await refetch();
    } catch {
      setMutationError(
        t({
          id: "preferences.dialog.mcpServers.approvals.updateError",
          message: "Could not update the decision. Please try again.",
        }),
      );
    } finally {
      setPendingKey(null);
    }
  };

  return (
    <div className="space-y-3" data-testid="mcp-tool-approval-settings">
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-theme-fg-primary">
          {t({
            id: "preferences.dialog.mcpServers.approvals.heading",
            message: "Tool approvals",
          })}
        </h3>
        <p className="text-sm text-theme-fg-secondary">
          {t({
            id: "preferences.dialog.mcpServers.approvals.description",
            message:
              "Your decisions from the in-chat confirmation are stored here and can be changed any time. They apply to your account on every device.",
          })}
        </p>
      </div>

      {loadError ? (
        <Alert type="error">
          {t({
            id: "preferences.dialog.mcpServers.approvals.loadError",
            message: "Could not load tool approvals. Please try again.",
          })}
        </Alert>
      ) : null}
      {mutationError ? <Alert type="error">{mutationError}</Alert> : null}

      {!loadError && serverGroups.length === 0 ? (
        <p className="text-sm italic text-theme-fg-muted">
          {t({
            id: "preferences.dialog.mcpServers.approvals.empty",
            message:
              'No decisions yet. When you choose "Always allow" in a chat, the tool appears here.',
          })}
        </p>
      ) : null}

      {serverGroups.map(([serverId, rows]) => (
        <div key={serverId} className="space-y-3">
          <p className="text-xs font-medium text-theme-fg-primary">
            {serverId}
          </p>
          {rows.map((row) => {
            const key = rowKey(row);
            const decision =
              grantIdByKey.get(key) !== undefined ? "always" : "ask";
            return (
              <div
                key={key}
                role="radiogroup"
                aria-label={row.toolName}
                className="space-y-2"
                data-testid="mcp-tool-approval-row"
                data-tool-name={row.toolName}
              >
                <p className="text-xs text-theme-fg-secondary">
                  {row.toolName}
                </p>
                <RadioCard
                  size="sm"
                  name={`${radioGroupName}-${key}`}
                  value="ask"
                  checked={decision === "ask"}
                  disabled={pendingKey !== null}
                  onChange={() => void setDecision(row, "ask")}
                  label={t({
                    id: "preferences.dialog.mcpServers.approvals.ask.label",
                    message: "Ask before running",
                  })}
                  helper={t({
                    id: "preferences.dialog.mcpServers.approvals.ask.helper",
                    message:
                      "Shows the in-chat confirmation each time this tool wants to run.",
                  })}
                />
                <RadioCard
                  size="sm"
                  name={`${radioGroupName}-${key}`}
                  value="always"
                  checked={decision === "always"}
                  disabled={pendingKey !== null}
                  onChange={() => void setDecision(row, "always")}
                  label={t({
                    id: "preferences.dialog.mcpServers.approvals.always.label",
                    message: "Always allow",
                  })}
                  helper={t({
                    id: "preferences.dialog.mcpServers.approvals.always.helper",
                    message: "Runs this tool without asking.",
                  })}
                />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
