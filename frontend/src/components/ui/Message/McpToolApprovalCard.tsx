import { plural, t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useContext, useEffect, useRef, useState } from "react";

import { getIdToken } from "@/auth/tokenStore";
import { archivedNoticeText } from "@/components/ui/Chat/chatArchiveActions";
import { standingAnswerTargets } from "@/hooks/chat/approvalSeeding";
import {
  clientToolApprovalScopeAnchor,
  getClientToolHeaders,
} from "@/hooks/chat/clientToolExecutors";
import { readConflictRefusal } from "@/hooks/chat/conflictRefusal";
import { useConfirmationRegistryStore } from "@/hooks/chat/store/confirmationRegistryStore";
import { useGenerationStatusStore } from "@/hooks/chat/store/generationStatusStore";
import { useChatArchived } from "@/hooks/chat/useChatArchived";
import {
  listMcpServerToolsQuery,
  listUserToolApprovalSettingsQuery,
  profileQuery,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import {
  buildContinueStreamBody,
  isApprovalDecision,
} from "@/lib/toolApprovalDecisions";
import { ChatContext } from "@/providers/ChatProvider";
import { FrontendRequestError } from "@/utils/errorReport";

import { ActionConfirmationCard } from "./ActionConfirmationCard";
import { APPROVAL_CARD_SHELL_CLASS } from "./ApprovalDecisionActions";
import { ApprovalQueueCard } from "./ApprovalQueueCard";
import { OriginApprovalLink } from "./OriginApprovalLink";
import { OwnCallApprovalItem } from "./OwnCallApprovalItem";
import { TaskPlanApprovalCard } from "./TaskPlanApprovalCard";
import {
  approvalItemsOf,
  isWaitingItem,
  sameScope,
  scopeGroup,
  scopeOf,
} from "./approvalItems";

import type {
  ApprovalItemPart,
  ApprovalScopeOffer,
  StagedDecisions,
} from "./approvalItems";
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
 * `409`s that only say the row moved on without this card: another turn holds
 * the chat, or nothing is left to decide while tasks wait. The refetched row
 * says what is left.
 */
const SILENT_REFUSALS: ReadonlySet<string | undefined> = new Set([
  ALREADY_CONTINUED,
  // eslint-disable-next-line lingui/no-unlocalized-strings -- API refusal code
  "generation_running",
  // eslint-disable-next-line lingui/no-unlocalized-strings -- API refusal code
  "children_waiting",
]);

// eslint-disable-next-line lingui/no-unlocalized-strings -- API refusal code
const DECISIONS_MISMATCH = "decisions_mismatch";

// eslint-disable-next-line lingui/no-unlocalized-strings -- API decision value
const APPROVE_CONTEXT: ToolApprovalDecision = "approve_context";

/** How often a card that shows waiting tasks reads the row again. */
const WAITING_REFRESH_MS = 5_000;

/** The `missing` ids of a `400 decisions_mismatch`, or none for anything else. */
const mismatchedIds = (
  cause: unknown,
): { missing: string[]; unknown: string[] } | null => {
  if (
    !(cause instanceof FrontendRequestError) ||
    cause.response?.status !== 400
  )
    return null;
  try {
    const body = JSON.parse(cause.response.body ?? "") as {
      code?: unknown;
      missing?: unknown;
      unknown?: unknown;
    };
    if (body.code !== DECISIONS_MISMATCH) return null;
    const ids = (value: unknown) =>
      Array.isArray(value)
        ? value.filter((id): id is string => typeof id === "string")
        : [];
    return { missing: ids(body.missing), unknown: ids(body.unknown) };
  } catch {
    return null;
  }
};

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
  waitingItems,
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
  /**
   * The stop's task children that still wait for a call on the device. They
   * are shown, never decided, and keep the stop open until they finish.
   */
  waitingItems?: ApprovalItemPart[];
  resolution: ToolApprovalStatus | null;
}) => {
  // Read before anything else on the part: for every kind but `mcp_tool` the
  // flat `tool_name`/`mcp_server_id` fields describe no MCP tool (the server
  // writes an empty server id), so they must not reach the MCP layout.
  // eslint-disable-next-line lingui/no-unlocalized-strings -- API kind value
  const kind = request.kind ?? "mcp_tool";
  const approvalItems =
    openItems ??
    approvalItemsOf(request).filter((item) => !isWaitingItem(item));
  const waiting =
    waitingItems ?? approvalItemsOf(request).filter(isWaitingItem);
  const approvalIds = approvalItems.map((item) => item.approval_id);
  const openItemCount = approvalItems.length;
  // Nothing to decide: the stop waits for its tasks alone.
  const waitingOnly = openItemCount === 0 && waiting.length > 0;

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
  // The host's position taken when an item was allowed for its document, by
  // `approval_id`; sent with the held `approve_context` answers.
  const [stagedPositions, setStagedPositions] = useState<
    Record<string, unknown>
  >({});
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
    registerConfirmation(chatId, registrationId, { waitingOnly });
    return () => unregisterConfirmation(chatId, registrationId);
  }, [
    chatId,
    isArchived,
    isPending,
    registrationId,
    registerConfirmation,
    unregisterConfirmation,
    waitingOnly,
  ]);

  // Unlike the registry (mount-scoped by design, so it can't wedge the send
  // queue), the status-store entry is durable: it keeps the sidebar's
  // "action required" indicator alive after navigating away, matching the
  // server-side awaiting_approval generation state this card renders.
  const requestedAt = request.requested_at;
  useEffect(() => {
    // Durable and never cleaned up, so it waits until the chat is known. A
    // stop that only waits for its tasks asks nothing of the user.
    if (!chatId || !isPending || waitingOnly || isArchived !== false) {
      return;
    }
    useGenerationStatusStore.getState().seedActionRequired(chatId, requestedAt);
  }, [chatId, isArchived, isPending, requestedAt, waitingOnly]);

  // A waiting task settles on the server, not here: the row is read again
  // until it does, and never while this chat streams or a decision is in
  // flight, whose own refetch would race this one.
  const refetchMessages = chatContext?.refetchMessages;
  const holdRefresh = useRef(false);
  holdRefresh.current = isBusy || (chatContext?.isPendingResponse ?? false);
  const watchesTasks = isPending && waiting.length > 0 && isArchived === false;
  useEffect(() => {
    if (!watchesTasks || !refetchMessages) {
      return;
    }
    const timer = setInterval(() => {
      if (!holdRefresh.current) void refetchMessages();
    }, WAITING_REFRESH_MS);
    return () => clearInterval(timer);
  }, [refetchMessages, watchesTasks]);

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
        enumerate: waiting.length > 0,
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
        ...getClientToolHeaders(),
      },
      body: JSON.stringify(
        buildContinueStreamBody({
          messageId,
          decision,
          approvalIds,
          itemDecisions,
          enumerate: waiting.length > 0,
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

  const decide = async (
    decision: ToolApprovalDecision,
    itemDecisions?: DecidedApproval[],
  ) => {
    const answers: DecidedApproval[] =
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
      // clicked last; a parked child's answer lands on the child's own server.
      const targets = standingAnswerTargets(
        answers.map((answer) => ({
          item: approvalItems.find(
            (item) => item.approval_id === answer.approvalId,
          ),
          decision: answer.decision,
        })),
        kind,
        request.mcp_server_id,
      );

      if (targets.clientPreference) {
        // Saved in the user's preferences, which the settings list reads
        // from the profile.
        await queryClient.invalidateQueries({
          queryKey: profileQuery({}).queryKey,
        });
      }
      if (targets.mcpStanding) {
        // A standing decision is account-wide, and the settings roster and
        // the tool browser would otherwise keep serving the old state from
        // their cached listing. (The streamed path drops them itself, once
        // the decision is written.)
        await Promise.all([
          ...targets.rosters.map((serverId) =>
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
      // A task that waited stopped on a question meanwhile, and the answers
      // given so far did not cover it. They are kept, and the refetched row
      // asks only the new question.
      const mismatch = mismatchedIds(cause);
      const waitingIds = new Set(waiting.map((item) => item.approval_id));
      if (
        mismatch?.unknown.length === 0 &&
        mismatch.missing.length > 0 &&
        mismatch.missing.every((id) => waitingIds.has(id))
      ) {
        setError(null);
        setStaged(
          Object.fromEntries(
            answers.map((answer) => [answer.approvalId, answer.decision]),
          ),
        );
        setStagedPositions(
          Object.fromEntries(
            answers
              .filter((answer) => answer.scopePosition !== undefined)
              .map((answer) => [answer.approvalId, answer.scopePosition]),
          ),
        );
        await chatContext?.refetchMessages();
        return;
      }
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
        refusal?.status === 409 && SILENT_REFUSALS.has(refusal.code);
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
      setStagedPositions({});
      if (alreadyContinued) {
        await chatContext?.refetchMessages();
      }
    } finally {
      setIsBusy(false);
    }
  };

  /**
   * Decide every item still open. A denial wins: allowing all keeps the
   * answers already given, which a queue no longer shows, while denying or
   * withdrawing all overrides them, so nothing the user can no longer see
   * still runs.
   */
  /** Every open item's answer, a held document approval with its position. */
  const itemAnswers = (
    answers: StagedDecisions,
    positions: Record<string, unknown>,
    fallback: ToolApprovalDecision,
  ): DecidedApproval[] =>
    approvalItems.map((item) => {
      const decision = answers[item.approval_id] ?? fallback;
      const scopePosition = positions[item.approval_id];
      return decision === "approve_context" && scopePosition !== undefined
        ? { approvalId: item.approval_id, decision, scopePosition }
        : { approvalId: item.approval_id, decision };
    });

  const decideAll = (decision: ToolApprovalDecision) => {
    const held = isApprovalDecision(decision) ? staged : {};
    setStaged({});
    setStagedPositions({});
    void decide(decision, itemAnswers(held, stagedPositions, decision));
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
    void decide(decision, itemAnswers(answers, stagedPositions, decision));
  };

  /** The position-taker for a document scope, where this client holds it. */
  const scopeAnchor = (item: ApprovalItemPart) => {
    const scope = scopeOf(item);
    return scope?.ref.covers === "document"
      ? clientToolApprovalScopeAnchor(scope.toolName, scope.ref)
      : undefined;
  };

  const scopeOffer = (
    item: ApprovalItemPart,
  ): ApprovalScopeOffer | undefined => {
    const scope = scopeOf(item);
    if (!scope) return undefined;
    return {
      covers: scope.ref.covers,
      others: scopeGroup(approvalItems, item, staged).length - 1,
      anchorable:
        scope.ref.covers !== "document" || scopeAnchor(item) !== undefined,
      changed: scope.changed,
    };
  };

  /**
   * Allow an item for its whole document or response, together with every
   * open item of the same tool and scope: one decision for all of them. A
   * document's position is taken once, at the first click, so every item
   * carries the same: an item that joins later, such as a waiting task that
   * started asking, keeps the position already held for its scope.
   */
  const decideScope = (item: ApprovalItemPart) => {
    const scope = scopeOf(item);
    if (!scope) return;
    const anchor = scopeAnchor(item);
    if (scope.ref.covers === "document" && !anchor) return;
    const held = approvalItems.find(
      (other) =>
        staged[other.approval_id] === APPROVE_CONTEXT &&
        stagedPositions[other.approval_id] !== undefined &&
        sameScope(item, other),
    );
    const position = held ? stagedPositions[held.approval_id] : anchor?.();
    const answers: StagedDecisions = { ...staged };
    const positions = { ...stagedPositions };
    for (const member of scopeGroup(approvalItems, item, staged)) {
      answers[member.approval_id] = APPROVE_CONTEXT;
      if (position === undefined) delete positions[member.approval_id];
      else positions[member.approval_id] = position;
    }
    setStaged(answers);
    setStagedPositions(positions);
    if (
      approvalItems.some((other) => answers[other.approval_id] === undefined)
    ) {
      return;
    }
    void decide(
      APPROVE_CONTEXT,
      itemAnswers(answers, positions, APPROVE_CONTEXT),
    );
  };

  const isClientTool = kind === "client_tool";
  // The turn's own gated call carries its parked tasks on the same stop, and a
  // `delegated_task` stop is nothing but them: both are decided one item at a
  // time. A task plan reviews one plan rather than the turn's approvals, so it
  // keeps its list.
  const isQueue =
    kind === "delegated_task" ||
    ((kind === "mcp_tool" || isClientTool) &&
      (waiting.length > 0 || approvalItems.some((item) => item.child != null)));

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

  if (kind === "tool_call_limit") {
    return (
      <div
        className={APPROVAL_CARD_SHELL_CLASS}
        data-testid="tool-call-limit-approval"
      >
        <ActionConfirmationCard
          title={t({
            id: "toolCallLimit.title",
            message: "Tool-call limit reached",
          })}
          description={t({
            id: "toolCallLimit.description",
            message:
              "Continue with twice the tool-call budget, generate an answer using the information collected so far, or stop this response.",
          })}
          allowOnceLabel={t({
            id: "toolCallLimit.continue",
            message: "Continue tool calls",
          })}
          alwaysAllowLabel={t({
            id: "toolCallLimit.answer",
            message: "Generate answer now",
          })}
          denyLabel={t({ id: "toolCallLimit.stop", message: "Stop" })}
          onAllowOnce={() => decideAll("approve")}
          onAlwaysAllow={() => decideAll("reject")}
          onDeny={() => decideAll("withdraw")}
          status={isArchived ? "dismissed" : "pending"}
          resolvedLabel={isArchived ? archivedNoticeText() : undefined}
          isBusy={cardIsBusy}
          scrollIntoViewOnMount
          data-testid="tool-call-limit-card"
        />
        {refusal}
      </div>
    );
  }

  if (isQueue) {
    return (
      <>
        <ApprovalQueueCard
          request={request}
          items={approvalItems}
          waiting={waiting}
          staged={staged}
          isArchived={isArchived === true}
          isBusy={cardIsBusy}
          onDecideItem={decideItem}
          onDecideAll={decideAll}
          scopeOffer={scopeOffer}
          onDecideScope={decideScope}
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
  if ((kind as string) !== "mcp_tool" && !isClientTool) {
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
      data-approval-kind={kind}
      className={APPROVAL_CARD_SHELL_CLASS}
    >
      <OwnCallApprovalItem
        toolName={request.tool_name}
        display={request.display}
        input={request.input}
        serverId={request.mcp_server_id}
        isClientTool={isClientTool}
        openWorld={request.annotations.openWorldHint}
        allowAlways={request.allow_always}
        status={isArchived ? "dismissed" : "pending"}
        resolvedLabel={isArchived ? archivedNoticeText() : undefined}
        isBusy={cardIsBusy}
        scrollIntoViewOnMount
        onDecide={(decision) => void decide(decision)}
      />
      {refusal}
    </div>
  );
};
