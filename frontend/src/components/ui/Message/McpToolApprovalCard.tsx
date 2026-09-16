import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useContext, useEffect, useState } from "react";

import { getIdToken } from "@/auth/tokenStore";
import { archivedNoticeText } from "@/components/ui/Chat/chatArchiveActions";
import { ToolCallInput } from "@/components/ui/ToolCall";
import { useConfirmationRegistryStore } from "@/hooks/chat/store/confirmationRegistryStore";
import { useGenerationStatusStore } from "@/hooks/chat/store/generationStatusStore";
import { useChatArchived } from "@/hooks/chat/useChatArchived";
import {
  listMcpServerToolsQuery,
  listUserToolApprovalSettingsQuery,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { ChatContext } from "@/providers/ChatProvider";

import { ResolvedIcon } from "../icons";
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

/**
 * Message-scoped UI for a durable MCP approval request. The decision is
 * handed to the chat's streaming machinery (`continueToolApproval`), which
 * seeds the transcript with the decision at once — this card then reads its
 * resolution off that part and hides — and streams the continuation like any
 * other turn. A host that has not wired the action falls back to consuming
 * the continuation here, which keeps the card up until the answer is done.
 *
 * Layout follows the add-in's client-action grammar — the thing being
 * approved above, the consent card attached below: the pending tool call is
 * rendered as a visible referent (name, server, input) inside an artifact
 * fence, because its tool_use step sits in the thinking trace, which is
 * collapsed exactly when this card appears.
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
  const queryClient = useQueryClient();
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localResolution, setLocalResolution] =
    useState<ToolApprovalStatus | null>(null);

  // While the decision is pending, hold the chat's message-queue auto-send
  // and surface the sidebar "action required" state, exactly like the
  // add-in's client-action cards (ERMAIN-470).
  const isPending = resolution === null && localResolution === null;
  const chatId = chatContext?.currentChatId ?? null;
  // The approval is durable, so it outlives an archive. Continuing it is a
  // write the backend refuses, so the card states that instead of offering it.
  const isArchived = useChatArchived(chatId);
  const [registrationId] = useState(() => globalThis.crypto.randomUUID());
  const registerConfirmation = useConfirmationRegistryStore(
    (state) => state.registerConfirmation,
  );
  const unregisterConfirmation = useConfirmationRegistryStore(
    (state) => state.unregisterConfirmation,
  );
  useEffect(() => {
    // Held while archived is still unknown: releasing it would let a queued
    // send out ahead of a decision the chat may yet take.
    if (!chatId || !isPending || isArchived === true) {
      return;
    }
    registerConfirmation(chatId, registrationId);
    return () => unregisterConfirmation(chatId, registrationId);
  }, [
    chatId,
    isArchived,
    isPending,
    registrationId,
    registerConfirmation,
    unregisterConfirmation,
  ]);

  // Unlike the registry (mount-scoped by design, so it can't wedge the send
  // queue), the status-store entry is durable: it keeps the sidebar's
  // "action required" indicator alive after navigating away, matching the
  // server-side awaiting_approval generation state this card renders.
  const requestedAt = request.requested_at;
  useEffect(() => {
    // Durable and never cleaned up, so it waits until the chat is known.
    if (!chatId || !isPending || isArchived !== false) {
      return;
    }
    useGenerationStatusStore.getState().seedActionRequired(chatId, requestedAt);
  }, [chatId, isArchived, isPending, requestedAt]);

  /**
   * Hand the decision to the chat's own streaming machinery when the host
   * wired it: that resolves as soon as the server ACCEPTS the decision, and
   * the continuation then streams into the transcript like any other turn.
   *
   * The fallback consumes the continuation here instead, which cannot release
   * this card until the whole answer has been generated.
   */
  const submitDecision = async (
    decision: "approve" | "reject" | "approve_always",
  ) => {
    if (chatContext?.continueToolApproval) {
      await chatContext.continueToolApproval({
        messageId,
        decision,
        toolCallId: request.tool_call_id,
        toolName: request.tool_name,
        toolInput: request.input,
        mcpServerId: request.mcp_server_id,
      });
      // Deliberately no local resolution: the seeded decision part is what
      // hides this card, and it is rolled back if the server refuses the
      // decision — a latch here would keep the card hidden over a row that
      // is still parked, with no way left to decide it.
      return;
    }
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
    if (chatId) {
      // Tombstone the durable indicator: the server marker is already
      // cleared, but a stale list row or in-flight poll may still carry it.
      useGenerationStatusStore.getState().markApprovalDecided(chatId);
    }
    await chatContext?.refetchMessages();
  };

  const decide = async (decision: "approve" | "reject" | "approve_always") => {
    setIsBusy(true);
    setError(null);
    try {
      await submitDecision(decision);
      if (chatContext?.continueToolApproval) {
        return;
      }
      setLocalResolution(decision === "reject" ? "denied" : "approved");
      if (decision === "approve_always") {
        // The grant is account-wide, and the settings roster and the tool
        // browser would otherwise keep serving it from their cached listing.
        // (The streamed path drops them itself, once the grant is written.)
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: listMcpServerToolsQuery({
              pathParams: { serverId: request.mcp_server_id },
            }).queryKey,
          }),
          queryClient.invalidateQueries({
            queryKey: listUserToolApprovalSettingsQuery({}).queryKey,
          }),
        ]);
      }
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

  // Resolved decisions are represented beside the matching tool call in the
  // thinking trace. Keep this card solely for the pending decision UI.
  if (!isPending) {
    return null;
  }

  return (
    <div
      data-testid="mcp-tool-approval"
      data-tool-name={request.tool_name}
      className="my-2 rounded-[var(--theme-radius-message)] border border-theme-border bg-theme-bg-secondary p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <ResolvedIcon
          iconId="simpleicons-modelcontextprotocol"
          className="size-4 shrink-0 text-theme-fg-secondary"
        />
        <span className="text-sm font-medium text-theme-fg-primary">
          {request.tool_name}
        </span>
        <span className="text-xs text-theme-fg-muted">
          {request.mcp_server_id}
        </span>
      </div>
      <div className="mt-2 max-h-48 overflow-y-auto">
        <ToolCallInput input={request.input} />
      </div>
      <ActionConfirmationCard
        title={t({
          id: "mcpApproval.title",
          message: "Allow MCP tool call?",
        })}
        description={openWorldDescription ?? undefined}
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
        status={isArchived ? "dismissed" : "pending"}
        resolvedLabel={isArchived ? archivedNoticeText() : undefined}
        // Held while the chat is still settling the park's own completion
        // (its refetch resets the buffer a decision would seed), and while the
        // decision is in flight.
        isBusy={isBusy || (chatContext?.isPendingResponse ?? false)}
        scrollIntoViewOnMount
        data-testid="mcp-tool-approval-card"
      />
      {error && <p className="mt-2 text-sm text-theme-error-fg">{error}</p>}
    </div>
  );
};
