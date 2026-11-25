import { i18n } from "@lingui/core";
import { plural, t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchWithAuthRecovery } from "@/auth/authRecovery";
import { getIdToken } from "@/auth/tokenStore";
import { archivedNoticeText } from "@/components/ui/Chat/chatArchiveActions";
import {
  quietApprovalListening,
  useApprovalListening,
} from "@/hooks/audio/approvalListening";
import {
  stopApprovalSpeech,
  useApprovalSpeech,
} from "@/hooks/audio/approvalSpeech";
import { deploymentConfirmationPhrase } from "@/hooks/audio/confirmationPhrases";
import { userTurnsBefore } from "@/hooks/audio/dictatedTurns";
import { useSpokenApprovalCard } from "@/hooks/audio/useSpokenApprovalCard";
import { standingAnswerTargets } from "@/hooks/chat/approvalSeeding";
import {
  clientToolApprovalScopeAnchor,
  getClientToolHeaders,
  useClientToolRegistry,
} from "@/hooks/chat/clientToolExecutors";
import { readConflictRefusal } from "@/hooks/chat/conflictRefusal";
import { useComposeSessionStore } from "@/hooks/chat/store/composeSessionStore";
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
import { approvalDisplayOf } from "@/lib/toolCallGist/approvalCard";
import { spokenApprovalFor } from "@/lib/toolCallGist/spokenCard";
import {
  useChatTranscriptSelector,
  useOptionalChatSession,
} from "@/providers/ChatProvider";
import { useOptionalFeatureConfig } from "@/providers/FeatureConfigProvider";
import { FrontendRequestError } from "@/utils/errorReport";

import { ActionConfirmationCard } from "./ActionConfirmationCard";
import { APPROVAL_CARD_SHELL_CLASS } from "./ApprovalDecisionActions";
import { ApprovalQueueCard } from "./ApprovalQueueCard";
import { BuiltinToolApprovalItem } from "./BuiltinToolApprovalItem";
import { OriginApprovalLink } from "./OriginApprovalLink";
import { OwnCallApprovalItem } from "./OwnCallApprovalItem";
import {
  onlyItsCardApproves,
  OwnClientToolApprovalItem,
} from "./OwnClientToolApprovalItem";
import { TaskPlanApprovalCard } from "./TaskPlanApprovalCard";
import { ToolCallLimitItem } from "./ToolCallLimitItem";
import {
  approvalItemsOf,
  approvalQueueOf,
  isChildItem,
  isWaitingItem,
  sameScope,
  scopeGroup,
  scopeOf,
} from "./approvalItems";
import { DecisionPlaceContext } from "./decisionPlace";

import type {
  ApprovalItemPart,
  ApprovalScopeOffer,
  StagedDecisions,
} from "./approvalItems";
import type { ToolApprovalStatus } from "../Trace/Trace";
import type { ApprovalItemDecisionExtras } from "@/config/componentRegistry";
import type {
  VoiceChange,
  VoiceChangeOutcome,
  VoiceDecision,
} from "@/hooks/audio/approvalChanges";
import type {
  ContentPartToolApprovalRequest,
  ToolApprovalDecision,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { DecidedApproval } from "@/lib/toolApprovalDecisions";
import type { UserTurn } from "@/lib/toolCallGist/spokenDictation";
import type { ChatTranscriptValue } from "@/providers/ChatProvider";
import type { ReactNode } from "react";

/** The `409` a child card gets while its origin is asking the same question. */
// eslint-disable-next-line lingui/no-unlocalized-strings -- API refusal code
const COVERED_BY_PARENT = "covered_by_parent";

/** The `409` for a stop every item of which is already decided. */
// eslint-disable-next-line lingui/no-unlocalized-strings -- API refusal code
const ALREADY_CONTINUED = "already_continued";

/**
 * `409`s that only say the row moved on without this card: another turn holds
 * the chat, nothing is left to decide while tasks wait, or the card was
 * changed on another device. The refetched row says what is left.
 */
const SILENT_REFUSALS: ReadonlySet<string | undefined> = new Set([
  ALREADY_CONTINUED,
  // eslint-disable-next-line lingui/no-unlocalized-strings -- API refusal code
  "card_changed",
  // eslint-disable-next-line lingui/no-unlocalized-strings -- API refusal code
  "generation_running",
  // eslint-disable-next-line lingui/no-unlocalized-strings -- API refusal code
  "children_waiting",
]);

// eslint-disable-next-line lingui/no-unlocalized-strings -- API refusal code
const DECISIONS_MISMATCH = "decisions_mismatch";

/**
 * The `409` for a decision by voice the server would not take: the card
 * still waits, and the voice says so; no server text is shown.
 */
// eslint-disable-next-line lingui/no-unlocalized-strings -- API refusal code
const VOICE_RECEIPT_REFUSED = "voice_receipt_refused";

// eslint-disable-next-line lingui/no-unlocalized-strings -- API decision value
const APPROVE_CONTEXT: ToolApprovalDecision = "approve_context";

// eslint-disable-next-line lingui/no-unlocalized-strings -- API decision value
const REQUEST_CHANGE: ToolApprovalDecision = "request_change";

/**
 * One item's answer with what a host card sent beside it: its ticks go only
 * with an approval, the user's words only with a change request.
 */
const answerWith = (
  approvalId: string,
  decision: ToolApprovalDecision,
  extras: ApprovalItemDecisionExtras | undefined,
): DecidedApproval => ({
  approvalId,
  decision,
  ...(extras?.clientConfirmation !== undefined && isApprovalDecision(decision)
    ? { clientConfirmation: extras.clientConfirmation }
    : {}),
  ...(decision === REQUEST_CHANGE && extras?.changeRequest
    ? { changeRequest: extras.changeRequest }
    : {}),
});

/** How often a card that shows waiting tasks reads the row again. */
const WAITING_REFRESH_MS = 5_000;

/**
 * Whether the user wrote a later turn below `messageId`: its stop no longer
 * waits for its tasks, whose calls that turn withdrew (ERMAIN-1165), so it
 * neither shows them nor holds the chat's queued messages. Read off the
 * transcript on screen; a card rendered without one keeps waiting.
 */
const answeredByLaterTurn = (
  transcript: ChatTranscriptValue | null,
  messageId: string,
): boolean => {
  const order: readonly string[] | undefined = transcript?.messageOrder;
  if (!transcript || !order) return false;
  const index = order.indexOf(messageId);
  return (
    index !== -1 &&
    order
      .slice(index + 1)
      .some(
        (id) =>
          (transcript.messages[id] as { role?: string } | undefined)?.role ===
          "user",
      )
  );
};

const NO_USER_TURNS: UserTurn[] = [];

// A typed message's turn is rebuilt on every read, so turns are compared by
// what they say.
const sameUserTurns = (
  previous: readonly UserTurn[],
  next: readonly UserTurn[],
): boolean =>
  previous.length === next.length &&
  previous.every(
    (turn, index) =>
      turn.text === next[index].text &&
      turn.whole === next[index].whole &&
      turn.passages.length === next[index].passages.length &&
      turn.passages.every(
        (passage, passageIndex) =>
          passage === next[index].passages[passageIndex],
      ),
  );

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
const inDecisionPlace = (card: ReactNode) => (
  <DecisionPlaceContext.Provider value>{card}</DecisionPlaceContext.Provider>
);

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
  awaitsOwnCall = false,
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
  /**
   * The stop sits right behind the response's own client tool call, which
   * still waits: a decision lets the tasks go on, and the response continues
   * once that call has finished.
   */
  awaitsOwnCall?: boolean;
  resolution: ToolApprovalStatus | null;
}) => {
  // Read before anything else on the part: for every kind but `mcp_tool` the
  // flat `tool_name`/`mcp_server_id` fields describe no MCP tool (the server
  // writes an empty server id), so they must not reach the MCP layout.
  // eslint-disable-next-line lingui/no-unlocalized-strings -- API kind value
  const kind = request.kind ?? "mcp_tool";
  // This component is also rendered in isolated stories/tests, where the chat
  // provider is deliberately absent. The in-app path always has it.
  const chatSession = useOptionalChatSession();
  const superseded = useChatTranscriptSelector((transcript) =>
    answeredByLaterTurn(transcript, messageId),
  );
  const approvalItems =
    openItems ??
    approvalItemsOf(request).filter((item) => !isWaitingItem(item));
  const waiting: ApprovalItemPart[] = superseded
    ? []
    : (waitingItems ?? approvalItemsOf(request).filter(isWaitingItem));
  const approvalIds = approvalItems.map((item) => item.approval_id);
  const openItemCount = approvalItems.length;
  // Nothing to decide: the stop waits for its tasks alone.
  const waitingOnly = openItemCount === 0 && waiting.length > 0;
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
  // What a host card sent beside an item's held answer, by `approval_id`.
  const [stagedExtras, setStagedExtras] = useState<
    Record<string, ApprovalItemDecisionExtras>
  >({});
  const [isCoveredByParent, setIsCoveredByParent] = useState(false);

  // While the decision is pending, hold the chat's message-queue auto-send
  // and surface the sidebar "action required" state, exactly like the
  // add-in's client-action cards (ERMAIN-470).
  const isPending =
    resolution === null &&
    localResolution === null &&
    // A stop that only waited is over once a later turn withdrew its waits.
    (!superseded || openItemCount > 0);
  const chatId = chatSession?.currentChatId ?? null;
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
  const refetchMessages = chatSession?.refetchMessages;
  const holdRefresh = useRef(false);
  holdRefresh.current = isBusy || (chatSession?.isPendingResponse ?? false);
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
    if (chatSession?.continueToolApproval) {
      await chatSession.continueToolApproval({
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

    const response = await fetchWithAuthRecovery(() => {
      const token = getIdToken();
      // eslint-disable-next-line lingui/no-unlocalized-strings -- API route
      return fetch("/api/v1beta/me/messages/continuestream", {
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
            items: approvalItems,
          }),
        ),
      });
    }, "continue-stream");
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
    await chatSession?.refetchMessages();
  };

  const decide = async (
    decision: ToolApprovalDecision,
    itemDecisions?: DecidedApproval[],
  ): Promise<VoiceChangeOutcome> => {
    // The decision is on its way: the card stops listening before its voice
    // stops, or the microphone would open in the moment before it closes.
    const { key: spokenKey } = useApprovalSpeech.getState();
    if (spokenKey !== null) quietApprovalListening(spokenKey);
    stopApprovalSpeech();
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
      if (chatSession?.continueToolApproval) {
        return "sent";
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
      return "sent";
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
        // A change request is not held: its words would be lost, and the
        // voice says that it did not go out.
        setStaged(
          Object.fromEntries(
            answers
              .filter((answer) => answer.decision !== REQUEST_CHANGE)
              .map((answer) => [answer.approvalId, answer.decision]),
          ),
        );
        setStagedPositions(
          Object.fromEntries(
            answers
              .filter((answer) => answer.scopePosition !== undefined)
              .map((answer) => [answer.approvalId, answer.scopePosition]),
          ),
        );
        setStagedExtras(
          Object.fromEntries(
            answers
              .filter((answer) => answer.clientConfirmation !== undefined)
              .map((answer) => [
                answer.approvalId,
                { clientConfirmation: answer.clientConfirmation },
              ]),
          ),
        );
        await chatSession?.refetchMessages();
        return "conflict";
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
      const receiptRefused =
        refusal?.status === 409 && refusal.code === VOICE_RECEIPT_REFUSED;
      // The refusal envelope is API wire text; printed beside the link that
      // says where to go instead, it reads as a second, unexplained failure.
      setError(
        covered || alreadyContinued || receiptRefused
          ? null
          : cause instanceof Error
            ? cause.message
            : String(cause),
      );
      // Held answers would otherwise leave every row looking decided with no
      // way to send them again.
      setStaged({});
      setStagedPositions({});
      setStagedExtras({});
      if (alreadyContinued) {
        await chatSession?.refetchMessages();
      }
      return covered || alreadyContinued ? "conflict" : "failed";
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
    extras: Record<string, ApprovalItemDecisionExtras> = {},
  ): DecidedApproval[] =>
    approvalItems.map((item) => {
      const decision = answers[item.approval_id] ?? fallback;
      const scopePosition = positions[item.approval_id];
      return decision === "approve_context" && scopePosition !== undefined
        ? { approvalId: item.approval_id, decision, scopePosition }
        : answerWith(
            item.approval_id,
            decision,
            answers[item.approval_id] === undefined
              ? undefined
              : extras[item.approval_id],
          );
    });

  const decideAll = (decision: ToolApprovalDecision) => {
    const approves = isApprovalDecision(decision);
    const held = approves ? staged : {};
    // An item only its own card can approve stays open, and the queue moves
    // on to it with every other item allowed.
    const leftOpen = approves
      ? approvalItems.filter(
          (item) =>
            held[item.approval_id] === undefined && onlyItsCardApproves(item),
        )
      : [];
    if (leftOpen.length > 0) {
      stopApprovalSpeech();
      setStaged({
        ...Object.fromEntries(
          approvalItems
            .filter((item) => !leftOpen.includes(item))
            .map((item) => [item.approval_id, decision]),
        ),
        ...held,
      });
      return;
    }
    setStaged({});
    setStagedPositions({});
    setStagedExtras({});
    void decide(
      decision,
      itemAnswers(
        held,
        stagedPositions,
        decision,
        approves ? stagedExtras : {},
      ),
    );
  };

  /**
   * Take one item's answer, and send the stop once every item has one: a
   * request that does not cover the open set exactly is refused, so a card
   * that asks per item cannot send per item.
   */
  const decideItem = (
    approvalId: string,
    decision: ToolApprovalDecision,
    extras?: ApprovalItemDecisionExtras,
  ) => {
    stopApprovalSpeech();
    const answers: StagedDecisions = { ...staged, [approvalId]: decision };
    const heldExtras = { ...stagedExtras };
    if (extras) heldExtras[approvalId] = extras;
    else delete heldExtras[approvalId];
    setStaged(answers);
    setStagedExtras(heldExtras);
    if (approvalItems.some((item) => answers[item.approval_id] === undefined)) {
      return;
    }
    void decide(
      decision,
      itemAnswers(answers, stagedPositions, decision, heldExtras),
    );
  };
  // Stable, so a host's own card is not drawn again on every render here.
  const decideItemRef = useRef(decideItem);
  decideItemRef.current = decideItem;
  const decideQueuedItem = useCallback(
    (
      approvalId: string,
      decision: ToolApprovalDecision,
      extras?: ApprovalItemDecisionExtras,
    ) => decideItemRef.current(approvalId, decision, extras),
    [],
  );

  /**
   * The turn's own single call decided on its card. A host card's ticks or
   * words go with that call's answer; every other open item gets the same
   * decision, as the card answers the whole stop.
   */
  const decideOwnRef =
    useRef<
      (
        approvalId: string,
        decision: ToolApprovalDecision,
        extras?: ApprovalItemDecisionExtras,
      ) => void
    >(null);
  decideOwnRef.current = (approvalId, decision, extras) => {
    if (
      extras?.clientConfirmation === undefined &&
      extras?.changeRequest === undefined
    ) {
      void decide(decision);
      return;
    }
    void decide(
      decision,
      approvalItems.map((item) =>
        item.approval_id === approvalId
          ? answerWith(approvalId, decision, extras)
          : { approvalId: item.approval_id, decision },
      ),
    );
  };
  const decideOwn = useCallback(
    (
      approvalId: string,
      decision: ToolApprovalDecision,
      extras?: ApprovalItemDecisionExtras,
    ) => decideOwnRef.current?.(approvalId, decision, extras),
    [],
  );

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
    stopApprovalSpeech();
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
      itemAnswers(answers, positions, APPROVE_CONTEXT, stagedExtras),
    );
  };

  /**
   * A change asked for by voice, for the turn's own call: sent like a
   * decision on screen, together with the answers held for the stop's other
   * items, which have to be given first. Never an approval or a rejection.
   */
  const voiceChange = useRef<{
    ready: (approvalId: string) => boolean;
    send: (approvalId: string, words: string) => Promise<VoiceChangeOutcome>;
  }>(null);
  voiceChange.current = {
    ready: (approvalId) =>
      approvalItems.some((item) => item.approval_id === approvalId) &&
      approvalItems.every(
        (item) =>
          item.approval_id === approvalId ||
          staged[item.approval_id] !== undefined,
      ),
    send: (approvalId, words) => {
      if (!voiceChange.current?.ready(approvalId))
        return Promise.resolve("conflict");
      const answers = itemAnswers(
        { ...staged, [approvalId]: REQUEST_CHANGE },
        stagedPositions,
        REQUEST_CHANGE,
        stagedExtras,
      ).map((answer) =>
        answer.approvalId === approvalId
          ? { approvalId, decision: REQUEST_CHANGE, changeRequest: words }
          : answer,
      );
      setStaged({});
      setStagedPositions({});
      setStagedExtras({});
      return decide(REQUEST_CHANGE, answers);
    },
  };
  /** The turn's own call of a stop the voice may act on, not a task's. */
  const ownVoiceItem = (approvalId: string) => {
    const item = approvalItems.find(
      (entry) => entry.approval_id === approvalId,
    );
    return item &&
      !isChildItem(item, kind) &&
      (kind === "mcp_tool" || kind === "client_tool")
      ? item
      : undefined;
  };
  const changeByVoice = useCallback(
    (approvalId: string): VoiceChange | undefined => {
      if (!ownVoiceItem(approvalId)) return undefined;
      return {
        approvalId,
        ready: () => voiceChange.current?.ready(approvalId) ?? false,
        send: (words) =>
          voiceChange.current?.send(approvalId, words) ??
          Promise.resolve("failed"),
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the items are read through the ref; their ids and kind decide
    [approvalIds.join("\n"), kind],
  );

  /**
   * A decision said by voice: only on the turn's own single call, and only
   * while deciding by voice is on. The decision goes out with the receipt the
   * voice command endpoint gave for the words; the server checks a receipt
   * against the card and keeps how the decision was given. Only this client
   * holds back an approval said without the phrase: to the server, an
   * approval without a receipt is a tap.
   */
  const voiceDecisionsOn =
    useOptionalFeatureConfig()?.audioConversational.voiceDecisionsEnabled ===
    true;
  const voiceDecide =
    useRef<
      (
        approvalId: string,
        decision: "approve" | "reject",
        receipt: string | undefined,
      ) => Promise<VoiceChangeOutcome>
    >(null);
  voiceDecide.current = (approvalId, decision, receipt) => {
    const [only] = approvalItems;
    if (approvalItems.length !== 1 || only.approval_id !== approvalId)
      return Promise.resolve("conflict");
    return decide(decision, [
      {
        approvalId,
        decision,
        ...(receipt ? { voiceReceipt: receipt } : {}),
      },
    ]);
  };
  // A card that needs a choice on screen, or a change only another device can
  // make, is never decided by voice.
  const screenOnlyKey = useClientToolRegistry(() =>
    approvalItems
      .map((item) => `${item.approval_id}:${onlyItsCardApproves(item)}`)
      .join("\n"),
  );
  const decideByVoice = useCallback(
    (approvalId: string): Omit<VoiceDecision, "approves"> | undefined => {
      const item = ownVoiceItem(approvalId);
      if (
        !voiceDecisionsOn ||
        approvalItems.length !== 1 ||
        !item ||
        onlyItsCardApproves(item)
      )
        return undefined;
      return {
        approvalId,
        send: (decision, receipt) =>
          voiceDecide.current?.(approvalId, decision, receipt) ??
          Promise.resolve("failed"),
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the items are read through the ref; their ids, kind and screen-only flags decide
    [screenOnlyKey, kind, voiceDecisionsOn],
  );

  const composeSessionId = useComposeSessionStore((state) =>
    chatId === null ? undefined : state.sessionIdByChatKey[chatId],
  );
  const userTurns = useChatTranscriptSelector(
    (transcript) =>
      composeSessionId !== undefined && transcript
        ? userTurnsBefore(
            composeSessionId,
            transcript.messages,
            transcript.messageOrder,
            messageId,
          )
        : NO_USER_TURNS,
    sameUserTurns,
  );

  const isClientTool = kind === "client_tool";
  const isBuiltinTool = kind === "builtin_tool";
  // The turn's own gated call, and its tool-call limit, carry its parked tasks
  // on the same stop, and a `delegated_task` stop is nothing but them: both are
  // decided one item at a time. A task plan reviews one plan rather than the
  // turn's approvals, so it keeps its list.
  const isQueue =
    kind === "delegated_task" ||
    ((kind === "mcp_tool" ||
      isClientTool ||
      isBuiltinTool ||
      kind === "tool_call_limit") &&
      (waiting.length > 0 || approvalItems.some((item) => item.child != null)));

  // Spoken in the order the screen shows them: a queue one item at a time.
  const spokenItems = isQueue
    ? approvalQueueOf(request, approvalItems)
    : approvalItems.slice(0, 1);
  const spokenApprovals = (
    isQueue
      ? spokenItems
      : [{ ...request, follows: approvalItems.at(0)?.follows }]
  ).map((call) =>
    spokenApprovalFor(kind, {
      ...call,
      display: approvalDisplayOf(call.display, call.tool_name),
    }),
  );
  // A stop is told apart by when it was asked and its approval's id: a turn
  // that goes on after a decision asks again in the same message.
  const spokenKeys = (isQueue ? spokenItems : approvalItems.slice(0, 1)).map(
    (item) => `${request.requested_at}:${item.approval_id}`,
  );
  const unanswered = spokenItems.findIndex(
    (item) => staged[item.approval_id] === undefined,
  );
  const spokenCard = useSpokenApprovalCard({
    chatId,
    messageId,
    approvals: spokenApprovals,
    keys: spokenKeys,
    items: (isQueue ? spokenItems : approvalItems.slice(0, 1)).map((item) => ({
      approvalId: item.approval_id,
      replaces: item.replaces_approval_id ?? null,
    })),
    change: changeByVoice,
    decide: decideByVoice,
    index: isQueue && unanswered > 0 ? unanswered : 0,
    active:
      isPending &&
      !waitingOnly &&
      isArchived === false &&
      !isBusy &&
      !isCoveredByParent,
    responding: chatSession?.isPendingResponse ?? false,
    userTurns,
  });

  // The single call as the host card takes it, kept while the row is the same.
  const firstItem = approvalItems.at(0);
  const ownItem = useMemo<ApprovalItemPart>(
    () =>
      firstItem
        ? firstItem.display != null
          ? firstItem
          : { ...firstItem, display: request.display }
        : {
            approval_id: request.tool_call_id,
            tool_call_id: request.tool_call_id,
            tool_name: request.tool_name,
            input: request.input,
            display: request.display,
            child: null,
          },
    [
      firstItem,
      request.display,
      request.input,
      request.tool_call_id,
      request.tool_name,
    ],
  );

  const phraseShown =
    useApprovalListening((state) => state.listening === spokenCard.key) &&
    spokenCard.approves;
  const phrase = deploymentConfirmationPhrase(i18n.locale) ?? "";

  // Resolved decisions are represented beside the matching tool call in the
  // thinking trace. Keep this card solely for the pending decision UI.
  if (!isPending) {
    return null;
  }

  // Held while the chat is still settling the park's own completion (its
  // refetch resets the buffer a decision would seed), and while the decision is
  // in flight.
  const cardIsBusy = isBusy || (chatSession?.isPendingResponse ?? false);

  // Shown under whichever card renders: a refusal, and where the decision can
  // be taken instead when this chat is not the surface that owns it.
  const refusal = (
    <>
      {error && <p className="mt-2 text-sm text-theme-error-fg">{error}</p>}
      {isCoveredByParent && <OriginApprovalLink chatId={chatId} />}
    </>
  );

  if (kind === "tool_call_limit" && !isQueue) {
    return inDecisionPlace(
      <div
        className={APPROVAL_CARD_SHELL_CLASS}
        data-testid="tool-call-limit-approval"
        data-waiting-card=""
      >
        <ToolCallLimitItem
          status={isArchived ? "dismissed" : "pending"}
          resolvedLabel={isArchived ? archivedNoticeText() : undefined}
          isBusy={cardIsBusy}
          scrollIntoViewOnMount
          onDecide={decideAll}
        />
        {refusal}
      </div>,
    );
  }

  if (isQueue) {
    return inDecisionPlace(
      <>
        <ApprovalQueueCard
          messageId={messageId}
          chatId={chatId}
          request={request}
          items={approvalItems}
          waiting={waiting}
          awaitsOwnCall={awaitsOwnCall}
          staged={staged}
          isArchived={isArchived === true}
          isBusy={cardIsBusy}
          onDecideItem={decideQueuedItem}
          onDecideAll={decideAll}
          scopeOffer={scopeOffer}
          onDecideScope={decideScope}
        />
        {refusal}
      </>,
    );
  }

  if (kind === "task_plan") {
    return inDecisionPlace(
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
      </>,
    );
  }

  if (isBuiltinTool) {
    return inDecisionPlace(
      <div
        data-testid="builtin-tool-approval"
        data-waiting-card=""
        data-tool-name={request.tool_name}
        data-approval-kind={kind}
        className={APPROVAL_CARD_SHELL_CLASS}
      >
        <BuiltinToolApprovalItem
          toolName={request.tool_name}
          display={approvalItems[0]?.display ?? request.display}
          input={request.input}
          status={isArchived ? "dismissed" : "pending"}
          resolvedLabel={isArchived ? archivedNoticeText() : undefined}
          isBusy={cardIsBusy}
          scrollIntoViewOnMount
          onDecide={(decision) => void decide(decision)}
        />
        {refusal}
      </div>,
    );
  }

  // Compared as a string because the value comes off the wire: a kind a newer
  // server added reaches this client although the generated union says it
  // cannot, and the turn cannot go on until it is answered either way.
  if ((kind as string) !== "mcp_tool" && !isClientTool) {
    return inDecisionPlace(
      <div
        data-testid="tool-approval-generic"
        data-waiting-card=""
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
      </div>,
    );
  }

  return inDecisionPlace(
    <div
      data-testid="mcp-tool-approval"
      data-waiting-card=""
      data-tool-name={request.tool_name}
      data-approval-kind={kind}
      className={APPROVAL_CARD_SHELL_CLASS}
    >
      {isClientTool ? (
        <OwnClientToolApprovalItem
          item={ownItem}
          serverId={request.mcp_server_id}
          messageId={messageId}
          chatId={chatId}
          allowAlways={request.allow_always}
          status={isArchived ? "dismissed" : "pending"}
          resolvedLabel={isArchived ? archivedNoticeText() : undefined}
          isBusy={cardIsBusy}
          scrollIntoViewOnMount
          onDecide={decideOwn}
        />
      ) : (
        <OwnCallApprovalItem
          toolName={request.tool_name}
          display={request.display}
          input={request.input}
          serverId={request.mcp_server_id}
          isClientTool={false}
          openWorld={request.annotations.openWorldHint}
          allowAlways={request.allow_always}
          status={isArchived ? "dismissed" : "pending"}
          resolvedLabel={isArchived ? archivedNoticeText() : undefined}
          isBusy={cardIsBusy}
          scrollIntoViewOnMount
          onDecide={(decision) => void decide(decision)}
        />
      )}
      {phraseShown && (
        <p
          className="mt-2 text-sm text-theme-fg-secondary"
          data-testid="approval-voice-phrase"
        >
          {t({
            id: "toolApproval.voicePhrase",
            message: `By voice: “${phrase}”`,
          })}
        </p>
      )}
      {refusal}
    </div>,
  );
};
