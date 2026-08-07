import { t } from "@lingui/core/macro";
import { skipToken } from "@tanstack/react-query";
import { useState } from "react";

import {
  useDeactivateUserToolApprovalSetting,
  useListUserToolApprovalSettings,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { Button } from "../Controls/Button";
import { Alert } from "../Feedback/Alert";

/**
 * "Always allow" decisions persisted by the in-chat MCP approval card.
 * Follows the add-in's settings contract for client actions: decisions made
 * inline are visible here and revocable any time. The section hides itself
 * while the user has none, so the MCP tab stays uncluttered for the common
 * case (including deployments where persistent approval is disabled).
 */
export function McpToolApprovalSettings({ isActive }: { isActive: boolean }) {
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const {
    data: approvalsResponse,
    error: loadError,
    refetch,
  } = useListUserToolApprovalSettings(isActive ? {} : skipToken, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const { mutateAsync: deactivateApproval } =
    useDeactivateUserToolApprovalSetting();

  const approvals = approvalsResponse?.settings ?? [];
  if (!loadError && approvals.length === 0) {
    return null;
  }

  const handleRemove = async (settingId: string) => {
    setRemoveError(null);
    setRemovingId(settingId);
    try {
      await deactivateApproval({ pathParams: { settingId } });
      // The row disappearing is the success feedback; no toast.
      await refetch();
    } catch {
      setRemoveError(
        t({
          id: "preferences.dialog.mcpServers.approvals.removeError",
          message: "Could not remove the approval. Please try again.",
        }),
      );
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="space-y-3" data-testid="mcp-tool-approval-settings">
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-theme-fg-primary">
          {t({
            id: "preferences.dialog.mcpServers.approvals.heading",
            message: "Always-allowed tools",
          })}
        </h3>
        <p className="text-sm text-theme-fg-secondary">
          {t({
            id: "preferences.dialog.mcpServers.approvals.description",
            message:
              "Tools you chose to always allow from the in-chat confirmation. Remove an entry to be asked again.",
          })}
        </p>
      </div>

      {loadError ? (
        <Alert type="error">
          {t({
            id: "preferences.dialog.mcpServers.approvals.loadError",
            message: "Could not load always-allowed tools. Please try again.",
          })}
        </Alert>
      ) : null}
      {removeError ? <Alert type="error">{removeError}</Alert> : null}

      {approvals.length > 0 ? (
        <ul className="space-y-2">
          {approvals.map((approval) => (
            <li
              key={approval.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-theme-border bg-theme-bg-primary p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-theme-fg-primary">
                  {approval.tool_name}
                </p>
                <p className="truncate text-xs text-theme-fg-secondary">
                  {approval.mcp_server_id}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={removingId !== null}
                onClick={() => void handleRemove(approval.id)}
              >
                {removingId === approval.id
                  ? t({
                      id: "preferences.dialog.mcpServers.approvals.removing",
                      message: "Removing...",
                    })
                  : t({
                      id: "preferences.dialog.mcpServers.approvals.remove",
                      message: "Remove",
                    })}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
