import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useCallback, useMemo } from "react";

import { Button } from "@/components/ui/Controls/Button";
import { useOpenMcpServersSettings } from "@/hooks/ui/useOpenMcpServersSettings";

import { CheckCircleIcon, ErrorIcon, WarningCircleIcon } from "../icons";

import type { McpServerStatus } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

interface McpServerSelectorProps {
  /** Policy-authorized servers with the EDITING user's connection status. */
  servers: McpServerStatus[];
  selectedServerIds: string[];
  onSelectionChange: (selectedServerIds: string[]) => void;
  disabled?: boolean;
}

/**
 * Checkbox list attaching MCP servers to an assistant.
 *
 * An empty selection means the assistant may use every server available to
 * whoever chats with it — that is what the backend enforces — so the control
 * states it explicitly instead of pretending empty means "none".
 *
 * Connection status is per-user: the editor not having authorized a server
 * must not block attaching it (another user chatting with the assistant may
 * be connected), so NEEDS_AUTHENTICATION stays selectable and only offers a
 * shortcut into the settings dialog. FAILURE means the backend itself cannot
 * reach the server, so it cannot be newly attached — but an already-attached
 * broken server stays deselectable so the assistant can be repaired.
 */
export const McpServerSelector = ({
  servers,
  selectedServerIds,
  onSelectionChange,
  disabled = false,
}: McpServerSelectorProps) => {
  const selectedServerIdsSet = useMemo(
    () => new Set(selectedServerIds),
    [selectedServerIds],
  );

  const openServerSettings = useOpenMcpServersSettings();

  const toggleServerSelection = useCallback(
    (serverId: string) => {
      if (disabled) {
        return;
      }

      if (selectedServerIdsSet.has(serverId)) {
        onSelectionChange(selectedServerIds.filter((id) => id !== serverId));
        return;
      }

      const nextSelectedServerIdsSet = new Set(selectedServerIds);
      nextSelectedServerIdsSet.add(serverId);

      // Keep output in backend-provided server order.
      onSelectionChange(
        servers
          .map((server) => server.id)
          .filter((id) => nextSelectedServerIdsSet.has(id)),
      );
    },
    [
      disabled,
      onSelectionChange,
      selectedServerIds,
      selectedServerIdsSet,
      servers,
    ],
  );

  return (
    <div className="space-y-2">
      <p
        className="text-sm text-theme-fg-secondary"
        data-testid="mcp-server-selector-summary"
      >
        {selectedServerIds.length === 0
          ? t({
              id: "assistant.form.mcpServers.allServers",
              message:
                "No servers selected — this assistant can use every server available to the person chatting with it.",
            })
          : t({
              id: "assistant.form.mcpServers.restricted",
              message: "This assistant can only use the selected servers.",
            })}
      </p>
      <ul className="divide-y divide-theme-border rounded-md border border-theme-border">
        {servers.map((server) => {
          const isSelected = selectedServerIdsSet.has(server.id);
          const needsAuthentication =
            server.connection_status === "NEEDS_AUTHENTICATION";
          const isUnavailable = server.connection_status === "FAILURE";
          const isCheckboxDisabled = disabled || (isUnavailable && !isSelected);

          return (
            <li
              key={server.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 p-3"
              data-testid={`mcp-server-option-${server.id}`}
            >
              <label
                className={clsx(
                  "flex min-w-0 items-center gap-2",
                  isCheckboxDisabled ? "cursor-not-allowed" : "cursor-pointer",
                )}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  disabled={isCheckboxDisabled}
                  onChange={() => toggleServerSelection(server.id)}
                  className="size-4 rounded border-theme-border-primary bg-theme-bg-primary text-theme-fg-accent focus:ring-theme-fg-accent focus:ring-offset-0 disabled:opacity-50"
                />
                <span
                  className={clsx(
                    "truncate text-sm",
                    isUnavailable
                      ? "text-theme-fg-muted"
                      : "text-theme-fg-primary",
                  )}
                >
                  {server.id}
                </span>
              </label>
              <span className="flex shrink-0 items-center gap-2">
                {server.connection_status === "SUCCESS" && (
                  <span className="inline-flex items-center gap-1 text-xs text-theme-success-fg">
                    <CheckCircleIcon
                      className="size-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    {t({
                      id: "assistant.form.mcpServers.status.connected",
                      message: "Connected",
                    })}
                  </span>
                )}
                {needsAuthentication && (
                  <>
                    <span className="inline-flex items-center gap-1 text-xs text-theme-warning-fg">
                      <WarningCircleIcon
                        className="size-3.5 shrink-0"
                        aria-hidden="true"
                      />
                      {t({
                        id: "assistant.form.mcpServers.status.needsConnection",
                        message: "Requires connection",
                      })}
                    </span>
                    {/* A null callback means no Router-mounted settings
                        chrome exists on this host, so the shortcut would be
                        a dead button — the status label alone stands. */}
                    {openServerSettings && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={disabled}
                        onClick={openServerSettings}
                        data-testid={`mcp-server-connect-${server.id}`}
                      >
                        {t({
                          id: "assistant.form.mcpServers.connectAction",
                          message: "Connect in Settings",
                        })}
                      </Button>
                    )}
                  </>
                )}
                {isUnavailable && (
                  <span className="inline-flex items-center gap-1 text-xs text-theme-error-fg">
                    <ErrorIcon
                      className="size-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    {t({
                      id: "assistant.form.mcpServers.status.unavailable",
                      message: "Unavailable",
                    })}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
