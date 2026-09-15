import { t } from "@lingui/core/macro";
import { skipToken, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  listMcpServerToolsQuery,
  listUserToolApprovalSettingsQuery,
  useApplyUserToolApprovalSettingsBatch,
  useListMcpServerTools,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { McpToolPermissionsRoster } from "./McpToolPermissionsRoster";
import { planDecisionChanges } from "./mcpToolDecisions";
import { Alert } from "../Feedback/Alert";

import type {
  McpToolDecisionAvailability,
  McpToolDecisionChange,
} from "./mcpToolDecisions";
import type { ListMcpServerToolsResponse } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ReactNode } from "react";

export {
  offeredDecisions,
  type McpToolDecision,
  type McpToolDecisionAvailability,
} from "./mcpToolDecisions";

// A listed roster only moves on a redeploy, and the backend serves a repeat
// expand from its own session cache within this window anyway. Anything
// short of a listing is retried on the next expand instead of being cached.
const TOOLS_STALE_TIME_MS = 5 * 60 * 1000;

/**
 * One MCP server's tools as the user's generations see them, each with the
 * user's persistent decision for it. The roster carries the policy default,
 * the stored decision and the effective state per tool, so the rows render
 * what the backend decided and never derive it. Every decision — one row or
 * a whole group — goes through the batch endpoint as one transaction; the
 * cached roster is moved ahead of the answer and put back if it fails, then
 * read back from the backend so the effective state stays its word.
 * Mounted inside the server's entity row, whose details unmount on collapse,
 * so mounting IS the expand and the enumeration happens once per expand —
 * repeat expands inside the stale window come from the query cache.
 */
export function McpToolApprovalSettings({
  serverId,
  isActive,
}: {
  serverId: string;
  /** Gates the fetches to the tab actually being shown. */
  isActive: boolean;
}) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const toolsQueryKey = listMcpServerToolsQuery({
    pathParams: { serverId },
  }).queryKey;
  const {
    data: toolsResponse,
    error: toolsError,
    isLoading: isToolsLoading,
  } = useListMcpServerTools(
    isActive ? { pathParams: { serverId } } : skipToken,
    {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: (query) =>
        query.state.data?.status === "SUCCESS" ? TOOLS_STALE_TIME_MS : 0,
    },
  );
  const { mutateAsync: applyBatch } = useApplyUserToolApprovalSettingsBatch();

  const apply = async (
    changes: McpToolDecisionChange[],
    availability: McpToolDecisionAvailability,
  ) => {
    const plan = planDecisionChanges(changes, availability);
    if (plan.entries.length === 0) {
      return;
    }
    setMutationError(null);
    setPending(true);
    const previous =
      queryClient.getQueryData<ListMcpServerToolsResponse>(toolsQueryKey);
    queryClient.setQueryData<ListMcpServerToolsResponse>(
      toolsQueryKey,
      (current) =>
        current === undefined
          ? current
          : {
              ...current,
              tools: current.tools.map(
                (tool) => plan.projected.get(tool.name) ?? tool,
              ),
            },
    );
    try {
      await applyBatch({
        body: { mcp_server_id: serverId, decisions: plan.entries },
      });
      // The effective state is the backend's to say, so the roster is read
      // back rather than kept as projected; the approval card and the tool
      // browser share these caches.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: toolsQueryKey }),
        queryClient.invalidateQueries({
          queryKey: listUserToolApprovalSettingsQuery({}).queryKey,
        }),
      ]);
    } catch {
      queryClient.setQueryData(toolsQueryKey, previous);
      setMutationError(
        t({
          id: "preferences.dialog.mcpServers.approvals.updateError",
          message: "Could not update the decision. Please try again.",
        }),
      );
    } finally {
      setPending(false);
    }
  };

  let body: ReactNode = null;
  if (toolsError) {
    body = (
      <Alert type="error">
        {t({
          id: "preferences.dialog.mcpServers.tools.loadError",
          message: "Could not load the tools of this server. Please try again.",
        })}
      </Alert>
    );
  } else if (isToolsLoading || !toolsResponse) {
    body = (
      <p className="text-xs text-theme-fg-secondary">
        {t({
          id: "preferences.dialog.mcpServers.tools.loading",
          message: "Loading tools...",
        })}
      </p>
    );
  } else if (toolsResponse.status === "NEEDS_AUTHENTICATION") {
    body = (
      <p className="text-xs text-theme-fg-secondary">
        {t({
          id: "preferences.dialog.mcpServers.tools.needsAuthentication",
          message: "Connect to see tools.",
        })}
      </p>
    );
  } else if (toolsResponse.status !== "SUCCESS") {
    body = (
      <p className="text-xs text-theme-fg-secondary">
        {t({
          id: "preferences.dialog.mcpServers.tools.failure",
          message:
            "The tools could not be listed because the server is unreachable.",
        })}
      </p>
    );
  } else if (toolsResponse.tools.length === 0) {
    body = (
      <p className="text-sm italic text-theme-fg-muted">
        {t({
          id: "preferences.dialog.mcpServers.tools.empty",
          message: "This server exposes no tools to you.",
        })}
      </p>
    );
  } else {
    const availability: McpToolDecisionAvailability = {
      allowAlways: toolsResponse.allow_always,
      askAvailable: toolsResponse.ask_available,
    };
    body = (
      <McpToolPermissionsRoster
        tools={toolsResponse.tools}
        availability={availability}
        pending={pending}
        onApply={(changes) => void apply(changes, availability)}
      />
    );
  }

  return (
    <div className="space-y-3" data-testid="mcp-tool-approval-settings">
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-theme-fg-primary">
          {t({
            id: "preferences.dialog.mcpServers.tools.permissions.heading",
            message: "Tool permissions",
          })}
        </h3>
        <p className="text-xs text-theme-fg-secondary">
          {t({
            id: "preferences.dialog.mcpServers.tools.permissions.description",
            message: "Choose when the assistant may use these tools.",
          })}
        </p>
      </div>

      {mutationError ? <Alert type="error">{mutationError}</Alert> : null}

      {body}
    </div>
  );
}
