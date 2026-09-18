import { t } from "@lingui/core/macro";
import { useEffect } from "react";

import {
  clearMcpAuthorization,
  isMcpAuthorizationPending,
  useMcpAuthorizationStore,
} from "@/lib/mcpAuthorization";

import { Button } from "../Controls/Button";
import { Alert } from "../Feedback/Alert";
import { SpinnerIcon } from "../Feedback/SpinnerIcon";

import type { McpAuthorizationPhase } from "@/lib/mcpAuthorization";

export function mcpAuthorizationMessage(phase: McpAuthorizationPhase): string {
  switch (phase) {
    case "starting":
      return t({
        id: "mcp.authorization.starting",
        message: "Opening authorization…",
      });
    case "waiting":
      return t({
        id: "mcp.authorization.waiting",
        message:
          "Waiting for authorization. Complete the steps in your browser using the same account.",
      });
    case "finishing":
      return t({
        id: "mcp.authorization.finishing",
        message: "Finishing connection…",
      });
    case "connected":
      return t({
        id: "preferences.dialog.mcpServers.oauth.success",
        message: "Authorization complete. The server is ready to use.",
      });
    case "denied":
      return t({
        id: "mcp.authorization.denied",
        message:
          "Authorization was not granted. You can try again when you are ready.",
      });
    case "unavailable":
      return t({
        id: "mcp.authorization.unavailable",
        message:
          "Could not confirm the server connection. Check the connection again after completing authorization.",
      });
    case "timeout":
      return t({
        id: "mcp.authorization.timeout",
        message:
          "The connection has not been confirmed yet. Check again before starting another authorization.",
      });
    default:
      return t({
        id: "mcp.authorization.error",
        message:
          "Could not complete authorization. Check the connection or try authorizing again.",
      });
  }
}

export function McpAuthorizationNotice({
  serverId,
  onCheck,
}: {
  serverId: string;
  onCheck: () => void;
}) {
  const phase = useMcpAuthorizationStore((state) => state.phases[serverId]);
  const browserUrl = useMcpAuthorizationStore(
    (state) => state.browserUrls[serverId],
  );
  useEffect(() => {
    if (phase !== "connected") return;
    // The row retains its connection status after this transient confirmation.
    const timer = window.setTimeout(() => {
      if (useMcpAuthorizationStore.getState().phases[serverId] === "connected")
        clearMcpAuthorization(serverId);
    }, 10_000);
    return () => window.clearTimeout(timer);
  }, [phase, serverId]);
  if (!phase) return null;
  const pending = isMcpAuthorizationPending(phase);
  return (
    <Alert
      type={pending ? "info" : phase === "connected" ? "success" : "warning"}
      role="status"
      title={serverId}
      icon={pending ? <SpinnerIcon size="sm" aria-hidden="true" /> : undefined}
    >
      <p>{mcpAuthorizationMessage(phase)}</p>
      {phase === "waiting" || !pending ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {phase === "waiting" && browserUrl ? (
            <a
              href={browserUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="focus-ring-tight underline"
            >
              {t({
                id: "mcp.authorization.reopen",
                message: "Open authorization page again",
              })}
            </a>
          ) : null}
          {!pending && phase !== "connected" && phase !== "denied" ? (
            <Button size="sm" variant="secondary" onClick={onCheck}>
              {t({
                id: "mcp.authorization.check",
                message: "Check connection",
              })}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => clearMcpAuthorization(serverId)}
          >
            {pending
              ? t({
                  id: "mcp.authorization.stopWaiting",
                  message: "Stop waiting",
                })
              : t({ id: "mcp.authorization.dismiss", message: "Dismiss" })}
          </Button>
        </div>
      ) : null}
    </Alert>
  );
}
