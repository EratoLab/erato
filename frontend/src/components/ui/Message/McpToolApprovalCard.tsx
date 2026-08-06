import { t } from "@lingui/core/macro";
import { useContext, useEffect, useState } from "react";

import { getIdToken } from "@/auth/tokenStore";
import { useConfirmationRegistryStore } from "@/hooks/chat/store/confirmationRegistryStore";
import { ChatContext } from "@/providers/ChatProvider";

import { ActionConfirmationCard } from "./ActionConfirmationCard";

import type { ToolApprovalStatus } from "../Trace/Trace";
import type { ContentPartToolApprovalRequest } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * The generated schema collapses `serde_json::Value` to `void`, which would
 * make `input` unusable; track every other field from the generated type and
 * override just that one.
 */
export type McpToolApprovalRequestPart = Omit<
  ContentPartToolApprovalRequest,
  "input"
> & {
  input: unknown;
};

const formatInputPreview = (input: unknown): string => {
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    // Tool inputs arrive as JSON, but retain a readable fallback if a caller
    // supplies a non-serializable value in a story or extension.
    return String(input);
  }
};

/**
 * Message-scoped UI for a durable MCP approval request. The continuation is
 * an SSE response; consuming it to completion before refetching the current
 * chat lets the regular message query render the rehydrated transcript
 * without duplicating the chat streaming state machine here.
 */
export const McpToolApprovalCard = ({
  messageId,
  request,
  resolution,
}: {
  messageId: string;
  request: McpToolApprovalRequestPart;
  resolution: ToolApprovalStatus | null;
}) => {
  // This component is also rendered in isolated stories/tests, where the chat
  // provider is deliberately absent. The in-app path always has it.
  const chatContext = useContext(ChatContext);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localResolution, setLocalResolution] =
    useState<ToolApprovalStatus | null>(null);

  // While the decision is pending, hold the chat's message-queue auto-send
  // and surface the sidebar "action required" state, exactly like the
  // add-in's client-action cards (ERMAIN-470).
  const isPending = resolution === null && localResolution === null;
  const chatId = chatContext?.currentChatId ?? null;
  const [registrationId] = useState(() => globalThis.crypto.randomUUID());
  const registerConfirmation = useConfirmationRegistryStore(
    (state) => state.registerConfirmation,
  );
  const unregisterConfirmation = useConfirmationRegistryStore(
    (state) => state.unregisterConfirmation,
  );
  useEffect(() => {
    if (!chatId || !isPending) {
      return;
    }
    registerConfirmation(chatId, registrationId);
    return () => unregisterConfirmation(chatId, registrationId);
  }, [
    chatId,
    isPending,
    registrationId,
    registerConfirmation,
    unregisterConfirmation,
  ]);

  const decide = async (decision: "approve" | "reject" | "approve_always") => {
    setIsBusy(true);
    setError(null);
    try {
      const token = getIdToken();
      // eslint-disable-next-line lingui/no-unlocalized-strings -- API route
      const response = await fetch("/api/v1beta/me/messages/continuestream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // eslint-disable-next-line lingui/no-unlocalized-strings -- HTTP auth header
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ message_id: messageId, decision }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      await response.text();
      setLocalResolution(decision === "reject" ? "denied" : "approved");
      // Keep the user in the current chat. This refreshes the persisted
      // decision and the resumed assistant output without a document reload.
      await chatContext?.refetchMessages();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsBusy(false);
    }
  };

  const openWorldDescription = request.annotations.openWorldHint
    ? t({
        id: "mcpApproval.openWorldWarning",
        message: "This tool may send data to an external service.",
      })
    : null;
  const inputPreview = formatInputPreview(request.input);

  // Resolved decisions are represented beside the matching tool call in the
  // thinking trace. Keep this card solely for the pending decision UI.
  if (!isPending) {
    return null;
  }

  return (
    <div data-testid="mcp-tool-approval" data-tool-name={request.tool_name}>
      <ActionConfirmationCard
        title={t({
          id: "mcpApproval.title",
          message: "Allow MCP tool call?",
        })}
        description={
          <div className="space-y-1 text-sm text-theme-fg-secondary">
            <p>{request.tool_name}</p>
            <p>{request.mcp_server_id}</p>
            {openWorldDescription && <p>{openWorldDescription}</p>}
            <details className="rounded border border-theme-border bg-theme-bg-secondary px-2 py-1.5">
              <summary className="cursor-pointer text-sm font-medium text-theme-fg-primary">
                {t({
                  id: "mcpApproval.inputPreview",
                  message: "View input parameters",
                })}
              </summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-theme-fg-secondary">
                {inputPreview}
              </pre>
            </details>
          </div>
        }
        onAllowOnce={() => void decide("approve")}
        // Keep "Always allow" discoverable when the deployment enforces
        // per-use confirmation: greyed out with the reason, like the add-in's
        // locked client-action decisions, instead of silently missing.
        // eslint-disable-next-line lingui/no-unlocalized-strings -- API decision value
        onAlwaysAllow={() => void decide("approve_always")}
        alwaysAllowDisabledReason={
          request.allow_always
            ? undefined
            : t({
                id: "mcpApproval.alwaysAllowDisabled",
                message:
                  "Locked: your organization requires confirmation each time this tool runs.",
              })
        }
        onDeny={() => void decide("reject")}
        status="pending"
        isBusy={isBusy}
        scrollIntoViewOnMount
        data-testid="mcp-tool-approval-card"
      />
      {error && <p className="mt-2 text-sm text-theme-error-fg">{error}</p>}
    </div>
  );
};
