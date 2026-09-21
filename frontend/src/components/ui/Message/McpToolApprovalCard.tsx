import { plural, t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useContext, useEffect, useState } from "react";

import { getIdToken } from "@/auth/tokenStore";
import { archivedNoticeText } from "@/components/ui/Chat/chatArchiveActions";
import { ToolCallInput } from "@/components/ui/ToolCall";
import { readConflictRefusal } from "@/hooks/chat/conflictRefusal";
import { useConfirmationRegistryStore } from "@/hooks/chat/store/confirmationRegistryStore";
import { useGenerationStatusStore } from "@/hooks/chat/store/generationStatusStore";
import { useChatArchived } from "@/hooks/chat/useChatArchived";
import {
  listMcpServerToolsQuery,
  listUserToolApprovalSettingsQuery,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import {
  buildContinueStreamBody,
  isApprovalDecision,
} from "@/lib/toolApprovalDecisions";
import { ChatContext } from "@/providers/ChatProvider";
import { FrontendRequestError } from "@/utils/errorReport";

import { ResolvedIcon } from "../icons";
import { ActionConfirmationCard } from "./ActionConfirmationCard";
import { APPROVAL_CARD_SHELL_CLASS } from "./ApprovalDecisionActions";
import { DelegatedTaskApprovalCard } from "./DelegatedTaskApprovalCard";
import { OriginApprovalLink } from "./OriginApprovalLink";
import { TaskPlanApprovalCard } from "./TaskPlanApprovalCard";
import { approvalItemsOf } from "./approvalItems";

import type { ApprovalItemPart, StagedDecisions } from "./approvalItems";
import type { ToolApprovalStatus } from "../Trace/Trace";
import type {
  ContentPartToolApprovalRequest,
  ToolApprovalDecision,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { DecidedApproval } from "@/lib/toolApprovalDecisions";

/** The `409` a child card gets while its origin is asking the same question. */
// eslint-disable-next-line lingui/no-unlocalized-strings -- API refusal code
const COVERED_BY_PARENT = "covered_by_parent";

/** The `409` for a stop every item of which is already decided. */
// eslint-disable-next-line lingui/no-unlocalized-strings -- API refusal code
const ALREADY_CONTINUED = "already_continued";

/**
 * The generated schema collapses `serde_json::Value` to `void`, which would
 * make `input` unusable; track every other field from the generated type and
 * override just those.
 */
export type McpToolApprovalRequestPart = Omit<
  ContentPartToolApprovalRequest,
  "input" | "approvals"
> & {
  input: unknown;
  approvals?: ApprovalItemPart[];
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
  openItems,
  resolution,
}: {
  messageId: string;
  request: McpToolApprovalRequestPart;
  /**
   * The items of the stop still waiting on the user, scoped to the parts below
   * the request. A decision has to cover exactly these, and a chained re-park
   * re-asks under ids its predecessor already settled — so the part alone
   * cannot say what is open. Defaulted for a host that renders the card without
   * the row around it.
   */
  openItems?: ApprovalItemPart[];
  resolution: ToolApprovalStatus | null;
}) => {
  // Read before anything else on the part: for every kind but `mcp_tool` the
  // flat `tool_name`/`mcp_server_id` fields describe no MCP tool (the server
  // writes an empty server id), so they must not reach the MCP layout.
  // eslint-disable-next-line lingui/no-unlocalized-strings -- API kind value
  const kind = request.kind ?? "mcp_tool";
  const approvalItems = openItems ?? approvalItemsOf(request);
  const approvalIds = approvalItems.map((item) => item.approval_id);
  const openItemCount = approvalItems.length;

  // This component is also rendered in isolated stories/tests, where the chat
  // provider is deliberately absent. The in-app path always has it.
  const chatContext = useContext(ChatContext);
  const queryClient = useQueryClient();
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localResolution, setLocalResolution] =
    useState<ToolApprovalStatus | null>(null);
  // Answers taken on individual items while others are still open; the server
  // settles the whole stop in one request, so they are held until it is fully
  // answered.
  const [staged, setStaged] = useState<StagedDecisions>({});
  const [isCoveredByParent, setIsCoveredByParent] = useState(false);

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
    decision: ToolApprovalDecision,
    itemDecisions: DecidedApproval[] | undefined,
  ) => {
    if (chatContext?.continueToolApproval) {
      await chatContext.continueToolApproval({
        messageId,
        decision,
        toolCallId: request.tool_call_id,
        toolName: request.tool_name,
        toolInput: request.input,
        // The fallback for an item that names no child of its own; a parked
        // child's grant is keyed on the child's server, which the items carry.
        mcpServerId: request.mcp_server_id,
        approvalIds,
        itemDecisions,
        items: approvalItems,
        kind,
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
      body: JSON.stringify(
        buildContinueStreamBody({
          messageId,
          decision,
          approvalIds,
          itemDecisions,
        }),
      ),
    });
    if (!response.ok) {
      const body = await response.text();
      // A request error rather than a bare one, so a refusal envelope — the
      // `409` that points at the origin chat — is readable on this path too.
      throw new FrontendRequestError(
        body,
        // eslint-disable-next-line lingui/no-unlocalized-strings -- HTTP method and route
        { method: "POST", url: "/api/v1beta/me/messages/continuestream" },
        { status: response.status, statusText: response.statusText, body },
      );
    }
    await response.text();
    if (chatId) {
      // Tombstone the durable indicator: the server marker is already
      // cleared, but a stale list row or in-flight poll may still carry it.
      useGenerationStatusStore.getState().markApprovalDecided(chatId);
    }
    await chatContext?.refetchMessages();
  };

  /**
   * The rosters a set of answers is written against. A standing answer on a
   * parked child lands on the CHILD's server, and a stop can carry children of
   * several servers — one roster would leave the others serving the pre-grant
   * state. A kind that names no server at all, a task plan, has none to drop.
   */
  const rostersOf = (answers: DecidedApproval[]): string[] =>
    answers
      .map(
        (answer) =>
          approvalItems.find((item) => item.approval_id === answer.approvalId)
            ?.child?.mcp_server_id ?? request.mcp_server_id,
      )
      .filter(
        (serverId, index, ids) =>
          serverId !== "" && ids.indexOf(serverId) === index,
      );

  const decide = async (
    decision: ToolApprovalDecision,
    itemDecisions?: DecidedApproval[],
  ) => {
    const answers =
      itemDecisions ??
      approvalItems.map((item) => ({
        approvalId: item.approval_id,
        decision,
      }));
    setIsBusy(true);
    setError(null);
    setIsCoveredByParent(false);
    try {
      await submitDecision(decision, itemDecisions);
      if (chatContext?.continueToolApproval) {
        return;
      }
      setLocalResolution(isApprovalDecision(decision) ? "approved" : "denied");
      // Standing wherever it was given, not only on the row that happened to be
      // clicked last.
      const standing = answers.filter(
        (answer) =>
          answer.decision === "approve_always" ||
          answer.decision === "reject_always",
      );
      if (standing.length > 0) {
        // A standing decision is account-wide, and the settings roster and
        // the tool browser would otherwise keep serving the old state from
        // their cached listing. (The streamed path drops them itself, once
        // the decision is written.)
        await Promise.all([
          ...rostersOf(standing).map((serverId) =>
            queryClient.invalidateQueries({
              queryKey: listMcpServerToolsQuery({
                pathParams: { serverId },
              }).queryKey,
            }),
          ),
          queryClient.invalidateQueries({
            queryKey: listUserToolApprovalSettingsQuery({}).queryKey,
          }),
        ]);
      }
    } catch (cause) {
      const refusal = readConflictRefusal(cause);
      // Nothing is wrong with this card: the same question is open in the chat
      // that dispatched the run, and only that one can act on the answer. The
      // next decision retries, because the refusal lifts by itself once the
      // origin settles.
      const covered =
        refusal?.status === 409 && refusal.code === COVERED_BY_PARENT;
      setIsCoveredByParent(covered);
      // Not a failure either: the stop was already answered — a second tab, a
      // double decision, a row this client had gone stale on. The user's answer
      // landed, so say nothing and let the settled row resolve the card.
      const alreadyContinued =
        refusal?.status === 409 && refusal.code === ALREADY_CONTINUED;
      // The refusal envelope is API wire text; printed beside the link that
      // says where to go instead, it reads as a second, unexplained failure.
      setError(
        covered || alreadyContinued
          ? null
          : cause instanceof Error
            ? cause.message
            : String(cause),
      );
      // Held answers would otherwise leave every row looking decided with no
      // way to send them again.
      setStaged({});
      if (alreadyContinued) {
        await chatContext?.refetchMessages();
      }
    } finally {
      setIsBusy(false);
    }
  };

  const decideAll = (decision: ToolApprovalDecision) => {
    setStaged({});
    void decide(
      decision,
      approvalItems.map((item) => ({
        approvalId: item.approval_id,
        decision,
      })),
    );
  };

  /**
   * Take one item's answer, and send the stop once every item has one: a
   * request that does not cover the open set exactly is refused, so a card
   * that asks per item cannot send per item.
   */
  const decideItem = (approvalId: string, decision: ToolApprovalDecision) => {
    const answers: StagedDecisions = { ...staged, [approvalId]: decision };
    setStaged(answers);
    if (approvalItems.some((item) => answers[item.approval_id] === undefined)) {
      return;
    }
    void decide(
      decision,
      approvalItems.map((item) => ({
        approvalId: item.approval_id,
        decision: answers[item.approval_id] ?? decision,
      })),
    );
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

  // Held while the chat is still settling the park's own completion (its
  // refetch resets the buffer a decision would seed), and while the decision is
  // in flight.
  const cardIsBusy = isBusy || (chatContext?.isPendingResponse ?? false);

  // Shown under whichever card renders: a refusal, and where the decision can
  // be taken instead when this chat is not the surface that owns it.
  const refusal = (
    <>
      {error && <p className="mt-2 text-sm text-theme-error-fg">{error}</p>}
      {isCoveredByParent && <OriginApprovalLink chatId={chatId} />}
    </>
  );

  if (kind === "delegated_task") {
    return (
      <>
        <DelegatedTaskApprovalCard
          items={approvalItems}
          staged={staged}
          allowAlways={request.allow_always}
          isArchived={isArchived === true}
          isBusy={cardIsBusy}
          onDecideItem={decideItem}
          onDecideAll={decideAll}
        />
        {refusal}
      </>
    );
  }

  if (kind === "task_plan") {
    return (
      <>
        <TaskPlanApprovalCard
          items={approvalItems}
          staged={staged}
          isArchived={isArchived === true}
          isBusy={cardIsBusy}
          onDecideItem={decideItem}
          onDecideAll={decideAll}
        />
        {refusal}
      </>
    );
  }

  // Compared as a string because the value comes off the wire: a kind a newer
  // server added reaches this client although the generated union says it
  // cannot, and the turn cannot go on until it is answered either way.
  if ((kind as string) !== "mcp_tool") {
    return (
      <div
        data-testid="tool-approval-generic"
        data-approval-kind={kind}
        className={APPROVAL_CARD_SHELL_CLASS}
      >
        <ActionConfirmationCard
          title={t({
            id: "toolApproval.genericTitle",
            message: "A decision is needed in this chat",
          })}
          description={t({
            id: "toolApproval.genericDescription",
            message: plural(openItemCount, {
              one: "This response is waiting on your decision to continue.",
              other:
                "This response is waiting on several decisions. Allowing or denying applies to all of them.",
            }),
          })}
          onAllowOnce={() => decideAll("approve")}
          onDeny={() => decideAll("reject")}
          status={isArchived ? "dismissed" : "pending"}
          resolvedLabel={isArchived ? archivedNoticeText() : undefined}
          isBusy={cardIsBusy}
          scrollIntoViewOnMount
          data-testid="tool-approval-generic-card"
        />
        {refusal}
      </div>
    );
  }

  return (
    <div
      data-testid="mcp-tool-approval"
      data-tool-name={request.tool_name}
      className={APPROVAL_CARD_SHELL_CLASS}
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
        // eslint-disable-next-line lingui/no-unlocalized-strings -- API decision value
        onNeverAllow={() => void decide("reject_always")}
        status={isArchived ? "dismissed" : "pending"}
        resolvedLabel={isArchived ? archivedNoticeText() : undefined}
        isBusy={cardIsBusy}
        scrollIntoViewOnMount
        data-testid="mcp-tool-approval-card"
      />
      {refusal}
    </div>
  );
};
