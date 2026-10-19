import {
  Button,
  Alert,
  CopyErrorButton,
  DocumentIcon,
  SpinnerIcon,
  registerClientToolExecutor,
  useProfile,
} from "@erato/frontend/library";
import { plural, t } from "@lingui/core/macro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  WORD_COMMENT_LINK_CLASS,
  WordCommentChip,
  wordCommentChipView,
  wordCommentChooseText,
  wordCommentSendWithoutText,
} from "./WordCommentChip";
import {
  WordCommentCoverage,
  wordCommentCoverageInfo,
} from "./WordCommentCoverage";
import { WordCommentPicker, wordCommentReadingText } from "./WordCommentPicker";
import { AddinChatInputCore } from "../../core/AddinChatInputCore";
import {
  useAvailableActionFacetArgs,
  useAvailableActionFacetIds,
} from "../../core/clientActions/useAvailableActionFacets";
import { AddinSelectionChip } from "../../core/selection/AddinSelectionChip";
import { useConversationKey } from "../../core/selection/useConversationKey";
import { useSelectionDismissal } from "../../core/selection/useSelectionDismissal";
import { useWordClientOperations } from "../hooks/useWordClientOperations";
import { useWordComments } from "../hooks/useWordComments";
import { useWordDocumentSource } from "../hooks/useWordDocumentSource";
import { useWordSelection } from "../hooks/useWordSelection";
import { wordCommentGestureStore } from "../hooks/wordCommentGestureStore";
import {
  armWordSelection,
  wordSelectionStore,
} from "../hooks/wordSelectionStore";
import {
  resolveWordActionFacet,
  resolveWordCommentThreadFacet,
  resolveWordSelectionFacet,
  WORD_COMPOSE_FACET_ID,
  WORD_AUTHORING_FACET_ID,
  WORD_DOCUMENT_REVIEW_FACET_ID,
  withWordReviewFallback,
  wordReviewFallbackApplies,
  wordSelectionFacetAvailable,
  wordSelectionForFacets,
} from "../utils/wordActionFacet";
import { renderWordDiagnosticReport } from "../utils/wordApplyDiagnostics";
import { checkWordAuthoringBudget } from "../utils/wordAuthoringBudget";
import { wordAuthoringIssueText } from "../utils/wordAuthoringMessages";
import { wordCommentUserTimeZone } from "../utils/wordCommentEnvelope";
import { wordCommentHeadingsFromBuild } from "../utils/wordCommentMap";
import { wordCommentDeploymentSettings } from "../utils/wordCommentPolicy";
import { wordCommentSelectionCoordinates } from "../utils/wordCommentPositions";
import {
  wordCommentReadSession,
  WORD_READ_COMMENTS_TOOL,
} from "../utils/wordCommentReadTool";
import {
  readWordComments,
  wordCommentInventoryFromCapture,
} from "../utils/wordCommentReader";
import {
  wordCommentIdOfRef,
  wordCommentRefRegistry,
} from "../utils/wordCommentRefs";
import {
  resolveWordCommentSend,
  withWordCommentRefs,
  wordAnchoredCommentsArg,
  wordCommentAdvertised,
  wordCommentsAdvertised,
  wordCommentMapArg,
  wordCommentSendExact,
  wordCommentSendable,
  wordCommentSendRead,
  wordCommentSendSelection,
  wordCommentsDue,
  wordCommentThreadArgs,
} from "../utils/wordCommentSend";
import { showWordComment } from "../utils/wordCommentShow";
import {
  createWordCommentSubmissionExecutor,
  WORD_SUBMIT_COMMENT_CHANGES_TOOL,
} from "../utils/wordCommentSubmission";
import { resolveWordDocumentName } from "../utils/wordDocumentIdentity";
import { bindWordDocumentReadRequest } from "../utils/wordDocumentReadRequest";
import {
  wordDocumentReadSession,
  WORD_READ_TOOL,
} from "../utils/wordDocumentReadTool";
import {
  createWordDocumentSubmissionExecutor,
  WORD_SUBMIT_PLAN_TOOL,
} from "../utils/wordDocumentSubmission";
import { wordHostPlatform } from "../utils/wordHostPlatform";
import { captureWordImageAssets } from "../utils/wordImageAssets";
import { emptySelectionCapture } from "../utils/wordSelectionAnchor";
import {
  captureWordSelection,
  wordSelectionMayRewrite,
} from "../utils/wordSelectionCapture";
import { currentWordSelectionSupport } from "../utils/wordSelectionSupport";
import { previewWordSend } from "../utils/wordSendPreview";
import { markWordSend } from "../utils/wordSendTiming";
import {
  useWordCommentPrecedence,
  useWordIncludeDocumentByDefault,
} from "../wordPreferences";

import type {
  AddinChatInputRenderProps,
  AddinSendPreparation,
} from "../../core/AddinChatCore";
import type { AddinChatInputCoreProps } from "../../core/AddinChatInputCore";
import type { WordDocumentPreview } from "../hooks/useWordDocumentSource";
import type { WordDocumentBuild } from "../utils/buildWordDocumentArgs";
import type { WordCommentSelectionCoordinates } from "../utils/wordCommentPositions";
import type {
  WordCommentReadActivation,
  WordCommentReadGestures,
} from "../utils/wordCommentReadTool";
import type { WordCommentInventory } from "../utils/wordCommentReader";
import type {
  WordCommentBlock,
  WordCommentDecision,
  WordCommentSendInput,
  WordCommentSendPlan,
  WordCommentSendRead,
  WordCommentSendSelection,
} from "../utils/wordCommentSend";
import type { WordDocumentCapture } from "@erato/frontend/word-review";

export interface WordChatInputProps {
  chatInputProps: AddinChatInputRenderProps;
  documentIdentity: string;
  stagePendingCapture: (capture: WordDocumentCapture | null) => void;
  /** Opens the settings on the Word tab, where the comment default lives. */
  onOpenWordSettings?: () => void;
}

export const WORD_SEND_SKIP_OFFER_MS = 8_000;
/** Word for Mac's proofing wait (WORD_PROOFING_DEADLINE_MS) ends before it. */
export const WORD_SEND_CAPTURE_DEADLINE_MS = 30_000;

type CaptureOutcome =
  | { kind: "build"; build: WordDocumentBuild | null }
  | { kind: "aborted" }
  | { kind: "skipped" }
  | { kind: "timeout" };

type CaptureNotice = "previous-capture" | "not-included";

function waitForCapture(
  capture: Promise<WordDocumentBuild | null>,
  signal: AbortSignal,
  onSlow: () => void,
  register: (settle: (outcome: CaptureOutcome) => void) => void,
): Promise<CaptureOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: CaptureOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(slowTimer);
      clearTimeout(deadline);
      signal.removeEventListener("abort", abort);
      resolve(outcome);
    };
    const abort = () => finish({ kind: "aborted" });
    const slowTimer = setTimeout(onSlow, WORD_SEND_SKIP_OFFER_MS);
    const deadline = setTimeout(
      () => finish({ kind: "timeout" }),
      WORD_SEND_CAPTURE_DEADLINE_MS,
    );
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    register(finish);
    capture.then(
      (build) => finish({ kind: "build", build }),
      () => finish({ kind: "build", build: null }),
    );
  });
}

/** Keep the document toggle in memory; Office settings would persist it into the DOCX. */
export function WordChatInput({
  chatInputProps,
  documentIdentity,
  stagePendingCapture,
  onOpenWordSettings,
}: WordChatInputProps) {
  useWordClientOperations(documentIdentity);
  const { chatId } = chatInputProps;
  const availableFacetIds = useAvailableActionFacetIds();
  // An unadvertised facet would reject the entire send with HTTP 400.
  const reviewAvailable = availableFacetIds.has(WORD_DOCUMENT_REVIEW_FACET_ID);
  const composeAvailable = availableFacetIds.has(WORD_COMPOSE_FACET_ID);
  const authoringAvailable = availableFacetIds.has(WORD_AUTHORING_FACET_ID);
  const chipAvailable =
    reviewAvailable || composeAvailable || authoringAvailable;

  const [includeByDefault] = useWordIncludeDocumentByDefault();
  // The setting applies to new chats; a chat keeps the default it started with.
  const [chatDefault, setChatDefault] = useState(includeByDefault);
  const [inclusionOverride, setInclusionOverride] = useState<boolean | null>(
    null,
  );
  const settleCaptureRef = useRef<((outcome: CaptureOutcome) => void) | null>(
    null,
  );
  const [commentPrecedence] = useWordCommentPrecedence();
  const {
    pick: commentPick,
    override: commentOverride,
    withoutComments,
    includeOpenComments,
  } = wordCommentGestureStore.useSnapshot();
  const [commentBlock, setCommentBlock] = useState<WordCommentBlock | null>(
    null,
  );
  const decideCommentsRef = useRef<
    ((decision: WordCommentDecision) => void) | null
  >(null);
  const leftCommentsRef = useRef<"chat" | "document" | null>(null);
  const lastChatIdRef = useRef(chatId);
  if (chatId !== lastChatIdRef.current) {
    // Receiving an ID for a new chat is continuation, not a switch to another conversation.
    const isNewChatGettingItsId =
      lastChatIdRef.current == null && chatId != null;
    lastChatIdRef.current = chatId;
    setChatDefault(includeByDefault);
    if (!isNewChatGettingItsId) {
      setInclusionOverride(null);
      // The send waiting in the chat being left is dropped now, so it cannot hold up this one.
      const settle = settleCaptureRef.current;
      if (settle) globalThis.queueMicrotask(() => settle({ kind: "aborted" }));
      leftCommentsRef.current = "chat";
    }
  }
  const lastIdentityRef = useRef(documentIdentity);
  if (documentIdentity !== lastIdentityRef.current) {
    lastIdentityRef.current = documentIdentity;
    setChatDefault(includeByDefault);
    setInclusionOverride(null);
    leftCommentsRef.current ??= "document";
  }
  // The gestures belong to the chat and the document left; a Send waiting on them is dropped.
  useEffect(() => {
    const left = leftCommentsRef.current;
    if (!left) return;
    leftCommentsRef.current = null;
    wordCommentGestureStore.leave(left);
    decideCommentsRef.current?.({ kind: "abort" });
  }, [chatId, documentIdentity]);

  const isDocumentIncluded =
    inclusionOverride ?? (chatId === null ? includeByDefault : chatDefault);
  const chipEnabled = isDocumentIncluded && chipAvailable;

  const availableFacetArgs = useAvailableActionFacetArgs();
  const commentAdvertised = useMemo(
    () => wordCommentAdvertised(availableFacetIds, availableFacetArgs),
    [availableFacetIds, availableFacetArgs],
  );
  const selectionAvailable = wordSelectionFacetAvailable(
    availableFacetIds,
    availableFacetArgs,
  );
  useWordSelection(documentIdentity, selectionAvailable);
  const liveSelection = wordSelectionStore.useSnapshot();
  // A passage Erato selected, as Show in Word does, is no new selection of the user's.
  const armedSelectionKey = liveSelection.armed
    ? (liveSelection.preview?.key ?? null)
    : null;
  useEffect(() => {
    wordCommentGestureStore.pick({ kind: "selection", key: armedSelectionKey });
    wordCommentGestureStore.set({ override: null, withoutComments: false });
  }, [armedSelectionKey]);
  const selectionDismissal = useSelectionDismissal(
    liveSelection.preview?.key ?? "",
    useConversationKey(chatId, documentIdentity),
  );
  const { rearm: rearmSelection } = selectionDismissal;
  useEffect(
    () =>
      wordSelectionStore.subscribeRefresh(({ rearm }) => {
        if (rearm) rearmSelection();
      }),
    [rearmSelection],
  );
  const selectionShown =
    selectionAvailable &&
    liveSelection.preview !== null &&
    !selectionDismissal.dismissed;
  // A selection the user made is sent instead of the document, as Outlook sends a selection
  // instead of the draft. A selection still being read is read again at Send.
  const selectionDue =
    selectionAvailable &&
    ((liveSelection.preview !== null &&
      liveSelection.armed &&
      !selectionDismissal.dismissed) ||
      liveSelection.pending);

  const commentsShown = wordCommentsAdvertised(commentAdvertised);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [commentProgress, setCommentProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const pickRef = commentPick?.ref ?? null;
  const { list: commentList, refresh: refreshComments } = useWordComments({
    documentIdentity,
    enabled: commentsShown,
    detailed: pickerOpen,
    picked: pickRef,
  });
  const passageGoes = selectionShown && liveSelection.armed;
  const liveCommentSelection: WordCommentSendSelection = passageGoes
    ? {
        kind: "passage",
        threads:
          commentList.selection.kind === "passage"
            ? commentList.selection.threads
            : [],
        rewritable: liveSelection.preview?.mayRewrite ?? false,
      }
    : commentList.selection.kind === "caret"
      ? { kind: "caret", threads: commentList.selection.threads }
      : { kind: "none" };
  const livePickFound =
    pickRef === null ||
    commentList.status !== "ready" ||
    commentList.threads.some((thread) => thread.ref === pickRef);
  // What Send would resolve now; Send reads Word again and decides for itself.
  const livePlan = resolveWordCommentSend({
    advertised: commentAdvertised,
    selection: liveCommentSelection,
    precedence: commentPrecedence,
    pick: pickRef,
    pickFound: livePickFound,
    override: commentOverride,
    withoutComments: false,
    documentIncluded: chipEnabled,
    includeOpenComments,
    readFailed: false,
  });
  const commentView = wordCommentChipView({
    plan: livePlan,
    list: commentList,
    passage: passageGoes,
    pick: pickRef,
    withoutComments,
  });
  const commentCoverage = wordCommentCoverageInfo(livePlan, commentList, {
    // A passage or a thread goes instead of the document, and reads follow what went.
    document: chipEnabled && !passageGoes && livePlan.carrier.kind !== "thread",
    picked: pickRef !== null,
    openComments: includeOpenComments,
  });
  const chipOffersChoose =
    commentView.kind === "choose" ||
    commentView.kind === "picked-gone" ||
    (commentView.kind === "passage" && commentView.offerChoose);
  const pickComment = (ref: string) => {
    wordCommentGestureStore.pick({
      kind: "pick",
      ref,
      selectionKey: armedSelectionKey,
    });
    if (commentBlock === "choose-comment" || commentBlock === "picked-gone")
      decideCommentsRef.current?.({ kind: "pick", ref });
    setPickerOpen(false);
  };
  const [selectionReadFailed, setSelectionReadFailed] = useState(false);
  const { preview, capture, captureExpectedSlow, previousCapture, markSent } =
    useWordDocumentSource({
      enabled: chipEnabled,
      documentIdentity,
      authoringEnabled: authoringAvailable,
    });

  const preparingRef = useRef(false);
  const [slowCapture, setSlowCapture] = useState(false);
  const [captureNotice, setCaptureNotice] = useState<CaptureNotice | null>(
    null,
  );
  const [authoringNotice, setAuthoringNotice] = useState<
    Pick<
      WordDocumentPreview,
      | "authoringIssue"
      | "authoringDetails"
      | "completeReadIssue"
      | "authoringNote"
      | "trackChanges"
    > & {
      readOnly?: boolean;
    }
  >();
  const sendingContextRef = useRef({ chatId, documentIdentity });
  sendingContextRef.current = { chatId, documentIdentity };
  const readEnabledRef = useRef(chipEnabled);
  readEnabledRef.current = chipEnabled;
  const { profile } = useProfile();
  const principalEmail = profile?.email ?? null;
  const commentPeople = useMemo(() => {
    const { label, assistantAuthor } = wordCommentDeploymentSettings();
    return { principalEmail, label, assistantAuthor };
  }, [principalEmail]);
  const stopRequestBindingRef = useRef<(() => void) | undefined>(undefined);
  const clearReadSession = useCallback(() => {
    stopRequestBindingRef.current?.();
    stopRequestBindingRef.current = undefined;
    wordDocumentReadSession.clear();
  }, []);
  // Comment reads also serve a selection sent without the document, so inclusion does not clear them.
  const stopCommentBindingRef = useRef<(() => void) | undefined>(undefined);
  const clearCommentSession = useCallback(() => {
    stopCommentBindingRef.current?.();
    stopCommentBindingRef.current = undefined;
    wordCommentReadSession.clear();
  }, []);
  /** A blocked Send waits here, with its message pending, until the user decides or stops it. */
  const waitForCommentDecision = useCallback(
    (block: WordCommentBlock, signal: AbortSignal) =>
      new Promise<WordCommentDecision>((resolve) => {
        let settled = false;
        const finish = (decision: WordCommentDecision) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", abort);
          if (decideCommentsRef.current === finish)
            decideCommentsRef.current = null;
          setCommentBlock(null);
          resolve(decision);
        };
        const abort = () => finish({ kind: "abort" });
        if (signal.aborted) {
          resolve({ kind: "abort" });
          return;
        }
        signal.addEventListener("abort", abort, { once: true });
        decideCommentsRef.current = finish;
        setCommentBlock(block);
      }),
    [],
  );
  useEffect(() => {
    const unregisterComments = registerClientToolExecutor(
      WORD_READ_COMMENTS_TOOL,
      wordCommentReadSession.execute,
    );
    const unregisterCommentChanges = registerClientToolExecutor(
      WORD_SUBMIT_COMMENT_CHANGES_TOOL,
      createWordCommentSubmissionExecutor(),
    );
    const submit = createWordDocumentSubmissionExecutor(
      wordDocumentReadSession,
    );
    const unregisterSubmit = registerClientToolExecutor(
      WORD_SUBMIT_PLAN_TOOL,
      (input, context) =>
        readEnabledRef.current
          ? submit(input, context)
          : Promise.resolve({ ok: false, error: "Document inclusion is off." }),
    );
    const unregister = registerClientToolExecutor(
      WORD_READ_TOOL,
      (input, context) =>
        readEnabledRef.current
          ? wordDocumentReadSession.execute(input, context)
          : Promise.resolve({ ok: false, error: "Document inclusion is off." }),
    );
    return () => {
      unregister();
      unregisterSubmit();
      unregisterComments();
      unregisterCommentChanges();
      clearReadSession();
      clearCommentSession();
    };
  }, [clearReadSession, clearCommentSession]);
  useEffect(() => clearReadSession, [documentIdentity, clearReadSession]);
  useEffect(() => {
    if (!chipEnabled) {
      settleCaptureRef.current?.({ kind: "skipped" });
      clearReadSession();
      setAuthoringNotice(undefined);
      setCaptureNotice(null);
    }
  }, [chipEnabled, chatId, documentIdentity, clearReadSession]);

  const handleSendMessage = useCallback<
    AddinChatInputCoreProps["onSendMessage"]
  >(
    (
      message,
      inputFileIds,
      modelId,
      selectedFacetIds,
      mentionedAssistants,
      delegationRunMode,
      mcpWriteToolsEnabled,
      disabledMcpServerIds,
      disabledMcpTools,
    ) => {
      if (preparingRef.current) return;
      clearReadSession();
      clearCommentSession();
      setSelectionReadFailed(false);
      setCaptureNotice(null);
      const send = (
        actionFacet: ReturnType<typeof resolveWordActionFacet>,
        hostContextIdentity: string | null,
        prepare?: AddinSendPreparation,
      ) => {
        chatInputProps.onSendMessage(
          message,
          inputFileIds,
          modelId,
          selectedFacetIds,
          actionFacet,
          hostContextIdentity,
          mentionedAssistants,
          delegationRunMode,
          mcpWriteToolsEnabled,
          disabledMcpServerIds,
          disabledMcpTools,
          prepare,
        );
      };

      // Nothing advertised means no comment API call at all.
      const commentsDue = wordCommentsDue({
        advertised: commentAdvertised,
        withoutComments,
        selectionDue,
        documentIncluded: chipEnabled,
      });
      const spentGestures = wordCommentGestureStore.sent();
      if (!chipEnabled && !selectionDue && !commentsDue) {
        stagePendingCapture(null);
        send(undefined, null);
        return;
      }

      const contextChanged = () =>
        sendingContextRef.current.chatId !== chatId ||
        sendingContextRef.current.documentIdentity !== documentIdentity;
      const resolvedModelId =
        modelId ?? chatInputProps.controlledSelectedModel?.chat_provider_id;
      const activateCommentReads = (
        activation: Pick<
          WordCommentReadActivation,
          | "gestures"
          | "selection"
          | "inventory"
          | "headings"
          | "withheld"
          | "capture"
        >,
      ) => {
        const token = wordCommentReadSession.activate({
          ...activation,
          identity: documentIdentity,
          people: commentPeople,
          documentIncluded: () => readEnabledRef.current,
        });
        stopCommentBindingRef.current = bindWordDocumentReadRequest(
          wordCommentReadSession,
          token,
          chatId,
        );
      };
      const pickRef = commentPick?.ref ?? null;
      /** The document gesture holds only when the document went: a passage or a thread replaces it. */
      const gesturesFor = (
        picked: string | null,
        document: boolean,
      ): WordCommentReadGestures => ({
        document,
        picked,
        openComments: includeOpenComments,
      });
      /** Fresh at every Send: paragraph events do not cover comments, so the capture never stands in. */
      const readSendComments = async (
        passage: WordCommentSelectionCoordinates | null,
        options: {
          inventory?: WordCommentInventory;
          replies: "all" | "requested";
        },
      ): Promise<WordCommentSendRead | null> => {
        const registry = wordCommentRefRegistry(documentIdentity);
        const pickedId = pickRef && wordCommentIdOfRef(registry, pickRef);
        const result = await readWordComments({
          ...options,
          legacy: registry.legacy,
          selection: true,
          exact: (records, live) =>
            wordCommentSendExact(records, { passage, live, pickedId }),
          onProgress: (done, total) => setCommentProgress({ done, total }),
        });
        setCommentProgress(null);
        return result.ok
          ? wordCommentSendRead({
              result,
              registry,
              passage,
              people: commentPeople,
              now: new Date(),
              userTz: wordCommentUserTimeZone(),
            })
          : null;
      };
      /** §8 for this message; a block waits for the user, then decides again. */
      const decideComments = async (
        read: WordCommentSendRead | null,
        passage: { rewritable: boolean } | null,
        signal: AbortSignal,
        sent: { document: boolean; due: boolean },
      ): Promise<{
        plan: WordCommentSendPlan;
        pick: string | null;
        withheld: boolean;
      } | null> => {
        let input: WordCommentSendInput = {
          advertised: commentAdvertised,
          selection: wordCommentSendSelection(read, passage),
          precedence: commentPrecedence,
          pick: pickRef,
          pickFound: !!pickRef && wordCommentSendable(read, pickRef),
          override: commentOverride,
          withoutComments,
          documentIncluded: sent.document,
          includeOpenComments,
          readFailed: sent.due && !read,
        };
        for (;;) {
          const plan = resolveWordCommentSend(input);
          if (!plan.block)
            return {
              plan,
              pick: input.pick,
              withheld: input.withoutComments,
            };
          const decision = await waitForCommentDecision(plan.block, signal);
          if (decision.kind === "abort" || signal.aborted || contextChanged())
            return null;
          input =
            decision.kind === "without"
              ? { ...input, withoutComments: true }
              : {
                  ...input,
                  pick: decision.ref,
                  pickFound: wordCommentSendable(read, decision.ref),
                };
        }
      };
      /** A thread facet replaces the passage and the document: one facet per message. */
      const sendThread = (
        read: WordCommentSendRead | null,
        decided: { plan: WordCommentSendPlan; pick: string | null },
        inventory?: WordCommentInventory,
      ) => {
        const { carrier } = decided.plan;
        if (
          !read ||
          (carrier.kind !== "thread" && carrier.kind !== "open-comments")
        )
          return null;
        const { threadJson, commentsJson } = wordCommentThreadArgs(
          read,
          carrier.kind === "thread" ? carrier.ref : null,
          decided.plan.why,
        );
        const actionFacet = resolveWordCommentThreadFacet({
          documentName: resolveWordDocumentName(),
          documentIdentity,
          threadJson,
          commentsJson,
          availableFacetIds,
          availableFacetArgs,
        });
        if (!actionFacet) return null;
        const staged = withWordCommentRefs(
          {
            identity: documentIdentity,
            ordinalMap: new Map(),
            paragraphsSent: 0,
            renderedOrdinals: new Set(),
            partialOrdinal: null,
          },
          read,
          carrier,
        );
        stagePendingCapture(staged);
        activateCommentReads({
          capture: staged,
          gestures: gesturesFor(decided.pick, false),
          selection: read.selection,
          // Later reads number paragraphs as thread_json does.
          ...(inventory ? { inventory } : {}),
          withheld: false,
        });
        return { actionFacet, hostContextIdentity: documentIdentity };
      };
      const finishPreparing = () => {
        preparingRef.current = false;
        setCommentProgress(null);
        settleCaptureRef.current = null;
        setSlowCapture(false);
      };
      /**
       * Neither a passage nor the document: only a pick, the caret's thread or the open threads. A
       * document send that ends up without the document comes here too, so it keeps the pick.
       */
      const prepareComments: AddinSendPreparation["run"] = async (signal) => {
        const comments = await readSendComments(null, {
          replies: includeOpenComments && !pickRef ? "all" : "requested",
        });
        if (signal.aborted || contextChanged()) return null;
        const decided = await decideComments(comments, null, signal, {
          document: false,
          due: true,
        });
        if (!decided) return null;
        const thread = sendThread(comments, decided);
        if (thread) return thread;
        stagePendingCapture(null);
        return { actionFacet: undefined, hostContextIdentity: null };
      };
      /** The document did not go after all; the comments go as they would without it. */
      const withoutDocument = (
        signal: AbortSignal,
        withheld = false,
      ): ReturnType<AddinSendPreparation["run"]> => {
        if (
          !withheld &&
          wordCommentsDue({
            advertised: commentAdvertised,
            withoutComments,
            selectionDue: false,
            documentIncluded: false,
          })
        )
          return prepareComments(signal);
        stagePendingCapture(null);
        return Promise.resolve({
          actionFacet: undefined,
          hostContextIdentity: null,
        });
      };
      const prepareDocument: AddinSendPreparation["run"] = async (signal) => {
        // Neither depends on the document read, so both start alongside it.
        const images =
          authoringAvailable && inputFileIds?.length
            ? captureWordImageAssets(inputFileIds).catch(() => null)
            : null;
        // Cancelled as soon as the capture shows authoring cannot use it.
        const estimate = new AbortController();
        const stopEstimate = () => estimate.abort();
        signal.addEventListener("abort", stopEstimate, { once: true });
        const scopedBudget = authoringAvailable
          ? checkWordAuthoringBudget(null, {
              message,
              chatId,
              assistantId: chatInputProps.assistantId,
              modelId: resolvedModelId,
              fileIds: inputFileIds,
              signal: estimate.signal,
            })
          : null;
        try {
          const outcome = await waitForCapture(
            capture(),
            signal,
            () => setSlowCapture(true),
            (settle) => {
              settleCaptureRef.current = settle;
            },
          );
          markWordSend("capture-end");
          setSlowCapture(false);
          settleCaptureRef.current = null;
          if (outcome.kind === "aborted" || signal.aborted) return null;
          if (contextChanged()) return null;
          let build: WordDocumentBuild | null;
          if (outcome.kind === "skipped") return await withoutDocument(signal);
          if (outcome.kind === "timeout") {
            build = previousCapture();
            setCaptureNotice(build ? "previous-capture" : "not-included");
            if (!build) return await withoutDocument(signal);
          } else build = outcome.build;
          if (!readEnabledRef.current) {
            clearReadSession();
            return await withoutDocument(signal);
          }
          // The capture this message sends numbers the anchors, an earlier one after a timeout too:
          // an anchor its paragraph ids no longer place is counted, never numbered another way.
          const inventory = build
            ? wordCommentInventoryFromCapture(build.ordinalMap)
            : undefined;
          // Read while the images and the budget call are still out; a thread sent instead needs neither.
          const comments = commentsDue
            ? await readSendComments(null, {
                inventory,
                replies:
                  commentAdvertised.map.size > 0 && wordHostPlatform() !== "Mac"
                    ? "all"
                    : "requested",
              })
            : null;
          if (signal.aborted || contextChanged()) return null;
          const decided = await decideComments(comments, null, signal, {
            document: true,
            due: commentsDue,
          });
          if (!decided) return null;
          const thread = sendThread(comments, decided, inventory);
          if (thread) return thread;
          const captured = images && (await images);
          if (build?.authoring && !build.authoring.issue && captured) {
            build.authoring.assets = captured.assets;
            build.authoring.imageAssetIssues = captured.unavailable;
          }
          if (signal.aborted) return null;
          if (build?.authoring && !build.authoring.issue && scopedBudget) {
            const budget = await scopedBudget;
            if (!budget.ok) {
              build.authoring.issue = budget.issue;
              build.authoring.issueDetails = budget.details;
            }
            markWordSend("budget-end");
          }
          if (signal.aborted || contextChanged()) return null;
          if (!readEnabledRef.current) {
            clearReadSession();
            return await withoutDocument(signal, decided.withheld);
          }
          const capturedIssue = build?.authoring?.issue;
          const capturedDetails = build?.authoring?.issueDetails;
          const trackChanges =
            !!build?.trackChanges || capturedIssue === "tracking";
          if (build) build = withWordReviewFallback(build, availableFacetIds);
          // Finalize paging limits before exposing whole-document availability.
          const authoringSnapshot = build?.authoring;
          wordDocumentReadSession.activate(
            authoringSnapshot,
            undefined,
            authoringSnapshot
              ? async () => {
                  const budget = await checkWordAuthoringBudget(
                    authoringSnapshot,
                    {
                      message,
                      chatId,
                      assistantId: chatInputProps.assistantId,
                      modelId: resolvedModelId,
                      fileIds: inputFileIds,
                      mode: "complete",
                    },
                  );
                  return budget.ok ? undefined : budget.issue;
                }
              : undefined,
          );
          setAuthoringNotice({
            authoringIssue: capturedIssue,
            authoringDetails: capturedDetails,
            completeReadIssue: authoringSnapshot?.completeReadIssue,
            authoringNote: build?.readNote,
            trackChanges,
            readOnly: !!capturedIssue && !build?.authoring,
          });
          const actionFacet = resolveWordActionFacet({
            chipEnabled: true,
            documentName: resolveWordDocumentName(),
            documentIdentity,
            documentArgs: build?.args ?? null,
            hasContent: build?.coverage.hasContent ?? false,
            authoring: build?.authoring,
            availableFacetIds,
            availableFacetArgs,
            trackChanges,
            ...(comments && build && decided.plan.carrier.kind === "map"
              ? {
                  commentMap: wordCommentMapArg(
                    comments,
                    wordCommentHeadingsFromBuild(build.headings),
                  ),
                }
              : {}),
          });
          if (actionFacet) markSent(build);
          else clearReadSession();
          const staged = actionFacet
            ? withWordCommentRefs(
                {
                  identity: documentIdentity,
                  authoring: build?.authoring,
                  ordinalMap: build?.ordinalMap ?? new Map(),
                  paragraphsSent: build?.authoring
                    ? 0
                    : (build?.coverage.paragraphsSent ?? 0),
                  renderedOrdinals: build?.authoring
                    ? new Set()
                    : (build?.renderedOrdinals ?? new Set()),
                  partialOrdinal: build?.authoring
                    ? null
                    : (build?.partialOrdinal ?? null),
                  ...(trackChanges ? { trackChanges: true } : {}),
                },
                comments,
                decided.plan.carrier,
              )
            : null;
          stagePendingCapture(staged);
          if (actionFacet && build?.authoring) {
            stopRequestBindingRef.current = bindWordDocumentReadRequest(
              wordDocumentReadSession,
              build.authoring.token,
              chatId,
            );
          }
          if (actionFacet && build)
            activateCommentReads({
              capture: staged,
              gestures: gesturesFor(decided.pick, true),
              selection: comments?.selection ?? null,
              inventory,
              headings: wordCommentHeadingsFromBuild(build.headings),
              withheld: decided.withheld,
            });
          return {
            actionFacet,
            hostContextIdentity: actionFacet ? documentIdentity : null,
          };
        } finally {
          signal.removeEventListener("abort", stopEstimate);
          stopEstimate();
        }
      };

      // The selection captured now wins over what the chip showed (D-9).
      const prepareSelection: AddinSendPreparation["run"] = async (signal) => {
        const read = await captureWordSelection();
        if (signal.aborted || contextChanged()) return null;
        if (read.status === "failed") {
          setSelectionReadFailed(true);
          return null;
        }
        const selection =
          read.value && wordSelectionForFacets(read.value, availableFacetArgs);
        const passageFacet = (anchoredComments?: string) =>
          selection
            ? resolveWordSelectionFacet({
                selection,
                documentName: resolveWordDocumentName(),
                documentIdentity,
                availableFacetIds,
                availableFacetArgs,
                anchoredComments,
              })
            : undefined;
        if (selection && passageFacet()) {
          const passage = wordCommentSelectionCoordinates(selection);
          const comments = commentsDue
            ? await readSendComments(passage, { replies: "requested" })
            : null;
          if (signal.aborted || contextChanged()) return null;
          // The setting is judged as the chip judged it: a hazard in the passage found only now
          // rules out its Replace, not the comment the chip showed.
          const decided = await decideComments(
            comments,
            {
              rewritable:
                selection.role === "rewrite" ||
                wordSelectionMayRewrite(
                  selection,
                  currentWordSelectionSupport(),
                ),
            },
            signal,
            { document: false, due: commentsDue },
          );
          if (!decided) return null;
          const thread = sendThread(comments, decided);
          if (thread) return thread;
          const { carrier } = decided.plan;
          const actionFacet = passageFacet(
            comments && carrier.kind === "selection"
              ? wordAnchoredCommentsArg(comments, carrier.threads)
              : undefined,
          );
          const staged = withWordCommentRefs(
            emptySelectionCapture(documentIdentity, selection),
            comments,
            carrier,
          );
          stagePendingCapture(staged);
          activateCommentReads({
            capture: staged,
            gestures: gesturesFor(decided.pick, false),
            selection: passage,
            withheld: decided.withheld,
          });
          return { actionFacet, hostContextIdentity: documentIdentity };
        }
        if (chipEnabled) return prepareDocument(signal);
        if (commentsDue) return prepareComments(signal);
        stagePendingCapture(null);
        return { actionFacet: undefined, hostContextIdentity: null };
      };

      preparingRef.current = true;
      send(undefined, null, {
        label: selectionDue
          ? t({
              id: "officeAddin.word.send.readingSelection",
              message: "Reading selection…",
            })
          : chipEnabled && captureExpectedSlow()
            ? t({
                id: "officeAddin.word.send.readingDocument",
                message: "Reading document…",
              })
            : commentsDue
              ? t({
                  id: "officeAddin.word.send.readingComments",
                  message: "Reading comments…",
                })
              : undefined,
        run: async (signal) => {
          markWordSend("prepare-start");
          try {
            return await (selectionDue
              ? prepareSelection(signal)
              : chipEnabled
                ? prepareDocument(signal)
                : prepareComments(signal));
          } finally {
            markWordSend("prepare-end");
            finishPreparing();
          }
        },
        onAbandoned: () => {
          wordCommentGestureStore.unspend(spentGestures);
          decideCommentsRef.current?.({ kind: "abort" });
          clearReadSession();
          clearCommentSession();
          stagePendingCapture(null);
          finishPreparing();
        },
      });
    },
    [
      authoringAvailable,
      availableFacetArgs,
      availableFacetIds,
      chatId,
      capture,
      captureExpectedSlow,
      chatInputProps,
      chipEnabled,
      clearCommentSession,
      clearReadSession,
      commentAdvertised,
      commentOverride,
      commentPick,
      commentPrecedence,
      documentIdentity,
      includeOpenComments,
      markSent,
      previousCapture,
      commentPeople,
      waitForCommentDecision,
      withoutComments,
      selectionDue,
      stagePendingCapture,
    ],
  );

  const readReport = useMemo(
    () =>
      preview.status === "unreadable" && preview.readError
        ? renderWordDiagnosticReport(
            "document read",
            "unreadable",
            undefined,
            preview.readError,
          )
        : undefined,
    [preview.status, preview.readError],
  );
  const reportOptions = useMemo(() => ({ chatId }), [chatId]);
  const notice = authoringNotice ?? preview;
  const readOnly = authoringNotice
    ? !!authoringNotice.readOnly
    : wordReviewFallbackApplies(
        preview.authoringIssue,
        preview.coverage?.hasContent ?? false,
        availableFacetIds,
      );
  // Authoring reads the document through its tools; the review excerpt's counts do not apply.
  const authoringRoute = authoringAvailable && !readOnly;
  // The document row states what the Send would carry, in the Send's order.
  const sendPreview = previewWordSend({
    advertised: commentAdvertised,
    precedence: commentPrecedence,
    pick: pickRef,
    pickFound: livePickFound,
    override: commentOverride,
    withoutComments,
    includeOpenComments,
    documentIncluded: chipEnabled,
    passageGoes,
    commentSelection: liveCommentSelection,
    authoring: authoringRoute,
    hasContent: preview.coverage?.hasContent ?? false,
    unreadable: preview.status === "unreadable",
    availableFacetIds,
  });
  const selectionReplacesDocument =
    sendPreview.document === "replaced-by-selection";
  const commentReplacesDocument =
    sendPreview.document === "replaced-by-comment";
  // An archived chat or a delegated run that is writing locks the composer,
  // and the document's inclusion with it.
  const composerLocked = !!chatInputProps.disabled;
  const readInParts =
    authoringRoute && !!notice.completeReadIssue && !notice.authoringIssue;
  const documentRowLabel = chipLabel(
    preview,
    resolveWordDocumentName(),
    authoringRoute,
    readInParts,
  );
  const coverageHint = readInParts
    ? wordAuthoringIssueText("too-large")
    : !authoringRoute &&
        (preview.coverage?.truncated || preview.coverage?.partialParagraph)
      ? t({
          id: "officeAddin.word.chip.selectLaterPart",
          message:
            "Only the beginning is sent. To work on a later part, select it in Word.",
        })
      : undefined;

  return (
    <>
      {selectionShown && liveSelection.preview && (
        <AddinSelectionChip
          preview={liveSelection.preview.text}
          metaLabel={selectionMetaLabel(liveSelection.preview.paragraphCount)}
          note={
            passageGoes && livePlan.carrier.kind === "thread"
              ? t({
                  id: "officeAddin.word.selection.commentInstead",
                  message: "The comment below is sent instead of this passage.",
                })
              : liveSelection.preview.truncated
                ? t({
                    id: "officeAddin.word.selection.truncated",
                    message:
                      "Too long to send in full. Only the beginning is sent.",
                  })
                : chipEnabled && liveSelection.armed
                  ? t({
                      id: "officeAddin.word.selection.sentInsteadOfDocument",
                      message: "Sent instead of the document.",
                    })
                  : undefined
          }
          armed={liveSelection.armed}
          onUse={armWordSelection}
          onDismiss={selectionDismissal.dismiss}
          testId="word-selection-chip"
        />
      )}
      {commentsShown && (
        <WordCommentChip
          view={commentView}
          coverage={commentCoverage}
          canChangeDefault={commentAdvertised.thread && !!onOpenWordSettings}
          onWithoutComments={() =>
            wordCommentGestureStore.set({ withoutComments: true })
          }
          onWithComments={() =>
            wordCommentGestureStore.set({ withoutComments: false })
          }
          onSwitch={(override) => wordCommentGestureStore.set({ override })}
          onDismissPick={() =>
            wordCommentGestureStore.pick({ kind: "dismiss" })
          }
          onChoose={() => setPickerOpen(true)}
          onChangeDefault={() => onOpenWordSettings?.()}
          onShowInWord={showWordComment}
        />
      )}
      {selectionReadFailed && (
        <div className="mx-auto w-full max-w-[var(--theme-layout-chat-input-max-width)] px-2 pb-1 sm:px-4">
          <Alert type="error">
            {t({
              id: "officeAddin.word.selection.readFailed",
              message:
                "Erato could not read your selection in Word, so your message was not sent. Send it again, or dismiss the selection to send without it.",
            })}
          </Alert>
        </div>
      )}
      {commentBlock && (
        <div
          className="mx-auto w-full max-w-[var(--theme-layout-chat-input-max-width)] px-2 pb-1 sm:px-4"
          data-testid="word-comment-block"
        >
          <Alert type="warning">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1">
                {commentBlockText(commentBlock)}
              </span>
              {commentBlock !== "read-failed" && commentAdvertised.thread && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setPickerOpen(true)}
                >
                  {wordCommentChooseText()}
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => decideCommentsRef.current?.({ kind: "without" })}
              >
                {wordCommentSendWithoutText()}
              </Button>
            </div>
          </Alert>
        </div>
      )}
      {chipAvailable && (
        <div className="mx-auto w-full max-w-[var(--theme-layout-chat-input-max-width)] px-2 pb-1 sm:px-4">
          {chipEnabled ? (
            <div
              className="flex items-center gap-2 rounded-[var(--theme-radius-message)] border border-theme-border bg-theme-bg-secondary px-3 py-1.5 text-xs text-theme-fg-secondary"
              data-testid="word-include-document-chip"
            >
              {preview.reading ? (
                <SpinnerIcon
                  size="sm"
                  srText={t({
                    id: "officeAddin.word.chip.reading",
                    message: "Reading document…",
                  })}
                />
              ) : (
                <DocumentIcon className="size-4 shrink-0" />
              )}
              {selectionReplacesDocument || commentReplacesDocument ? (
                // A sentence, not a name: cut short it can lose "instead".
                <span className="min-w-0 break-words">
                  {selectionReplacesDocument
                    ? t({
                        id: "officeAddin.word.chip.selectionInstead",
                        message:
                          "Your selection is sent instead of the document",
                      })
                    : t({
                        id: "officeAddin.word.chip.commentInstead",
                        message: "A comment is sent instead of the document",
                      })}
                </span>
              ) : (
                <span className="min-w-0 truncate" title={documentRowLabel}>
                  {documentRowLabel}
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  if (!composerLocked) setInclusionOverride(false);
                }}
                disabled={composerLocked}
                className="ml-auto shrink-0 rounded-[var(--theme-radius-control)] p-0.5 hover:bg-theme-bg-tertiary disabled:cursor-not-allowed disabled:opacity-50"
                aria-label={t({
                  id: "officeAddin.word.chip.dismiss",
                  message: "Don't include this document",
                })}
                data-testid="word-exclude-document"
              >
                &#x2715;
              </button>
            </div>
          ) : (
            <Button
              type="button"
              onClick={() => {
                if (!composerLocked) setInclusionOverride(true);
              }}
              disabled={composerLocked}
              data-testid="word-include-document-chip"
              variant="secondary"
              className="w-full justify-start text-left"
              icon={<DocumentIcon className="size-4" />}
            >
              <span className="min-w-0 truncate">
                {t({
                  id: "officeAddin.word.chip.include",
                  message: "Include this document",
                })}
              </span>
            </Button>
          )}
          {chipEnabled &&
            !selectionReplacesDocument &&
            !commentReplacesDocument &&
            coverageHint && (
              <p
                className="mt-1 text-xs text-theme-fg-secondary"
                data-testid="word-document-coverage-hint"
              >
                {coverageHint}
              </p>
            )}
          {chipEnabled && readReport && (
            <CopyErrorButton
              error={readReport}
              reportOptions={reportOptions}
              className="mt-1"
            />
          )}
          {chipEnabled && slowCapture && (
            <div
              className="mt-1 flex items-center gap-2 text-xs text-theme-fg-secondary"
              data-testid="word-slow-capture"
            >
              <span className="min-w-0 flex-1">
                {t({
                  id: "officeAddin.word.send.stillReading",
                  message: "Word is still handing over the document.",
                })}
              </span>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => settleCaptureRef.current?.({ kind: "skipped" })}
              >
                {t({
                  id: "officeAddin.word.send.withoutDocument",
                  message: "Send without document",
                })}
              </Button>
            </div>
          )}
          {chipEnabled && captureNotice && (
            <Alert type="warning">
              {captureNotice === "previous-capture"
                ? t({
                    id: "officeAddin.word.send.previousCapture",
                    message:
                      "Reading the document took too long, so Erato used an earlier copy. Recent edits may be missing.",
                  })
                : t({
                    id: "officeAddin.word.send.notIncluded",
                    message:
                      "Reading the document took too long, so this message was sent without it.",
                  })}
            </Alert>
          )}
          {chipEnabled &&
            (notice.trackChanges || notice.authoringIssue === "tracking") &&
            !authoringRoute && (
              <Alert type="warning">{trackingReadOnlyText()}</Alert>
            )}
          {chipEnabled &&
            notice.authoringIssue &&
            !(readOnly && notice.authoringIssue === "tracking") &&
            (readOnly ? (
              <Alert type="warning">
                {readOnlyText(
                  notice.authoringIssue,
                  notice.authoringDetails,
                  notice.trackChanges,
                )}
              </Alert>
            ) : (
              <Alert type="warning">
                {wordAuthoringIssueText(
                  notice.authoringIssue,
                  notice.authoringDetails,
                )}
              </Alert>
            ))}
          {chipEnabled &&
            authoringRoute &&
            !notice.authoringIssue &&
            notice.authoringNote === "package-blocked" && (
              <p
                className="mt-1 text-xs text-theme-fg-secondary"
                data-testid="word-document-read-note"
              >
                {t({
                  id: "officeAddin.word.authoring.packageBlocked",
                  message:
                    "Word for the web didn't hand over the complete file, for example because the document has a sensitivity label. Erato read the body only, so it can't change headers, footers or page layout, and any change replaces the whole body instead of editing passages in place.",
                })}
              </p>
            )}
        </div>
      )}

      {commentsShown &&
        commentAdvertised.thread &&
        commentList.threads.length > 0 && (
          <div
            className="mx-auto flex w-full max-w-[var(--theme-layout-chat-input-max-width)] flex-wrap items-center gap-x-3 gap-y-1 px-2 pb-1 text-xs text-theme-fg-secondary sm:px-4"
            data-testid="word-comment-options"
          >
            {!chipEnabled && (
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={includeOpenComments}
                  onChange={(event) =>
                    wordCommentGestureStore.set({
                      includeOpenComments: event.target.checked,
                    })
                  }
                  className="size-3.5 accent-[var(--theme-fg-accent)]"
                />
                <span>
                  {t({
                    id: "officeAddin.word.comments.includeOpen",
                    message: "Include open comments",
                  })}
                </span>
              </label>
            )}
            {livePlan.carrier.kind === "open-comments" &&
              !withoutComments &&
              commentCoverage && <WordCommentCoverage info={commentCoverage} />}
            {!chipOffersChoose && (
              <button
                type="button"
                className={WORD_COMMENT_LINK_CLASS}
                onClick={() => setPickerOpen(true)}
              >
                {wordCommentChooseText()}
              </button>
            )}
          </div>
        )}
      {commentProgress && (
        <p
          className="mx-auto w-full max-w-[var(--theme-layout-chat-input-max-width)] px-2 pb-1 text-xs text-theme-fg-secondary sm:px-4"
          role="status"
          data-testid="word-comment-progress"
        >
          {wordCommentReadingText(commentProgress)}
        </p>
      )}
      {commentAdvertised.thread && (
        <WordCommentPicker
          isOpen={pickerOpen}
          onClose={() => setPickerOpen(false)}
          list={commentList}
          onRefresh={refreshComments}
          onPick={pickComment}
          onShowInWord={showWordComment}
          picked={pickRef}
          web={wordHostPlatform() === "OfficeOnline"}
        />
      )}

      <AddinChatInputCore
        {...chatInputProps}
        pausesHostActionsWhenWritesOff
        onSendMessage={handleSendMessage}
      />
    </>
  );
}

function selectionMetaLabel(paragraphCount: number): string {
  return t({
    id: "officeAddin.word.selection.meta",
    message: plural(paragraphCount, {
      one: "Selected passage · # paragraph",
      other: "Selected passage · # paragraphs",
    }),
  });
}

/** Your message waits until you choose; stopping the reply drops it. */
function commentBlockText(block: WordCommentBlock): string {
  if (block === "choose-comment")
    return t({
      id: "officeAddin.word.comments.blocked.chooseComment",
      message:
        "Your cursor is in more than one comment, so Erato does not know which one you mean.",
    });
  if (block === "picked-gone")
    return t({
      id: "officeAddin.word.comments.blocked.pickedGone",
      message: "The comment you chose is no longer in the document.",
    });
  return t({
    id: "officeAddin.word.comments.blocked.readFailed",
    message: "Erato could not read the comments in Word.",
  });
}

function trackingReadOnlyText(): string {
  return t({
    id: "officeAddin.word.authoring.readOnlyTracking",
    message:
      "Track Changes is on, so Erato reads this document as if every tracked change were accepted, without seeing who changed what, and doesn't edit it.",
  });
}

/** Why the complete file could not be read; with Track Changes on it shows below that notice. */
function readOnlyText(
  issue: string,
  details: string[] = [],
  trackChanges = false,
): string {
  if (issue === "too-large" && trackChanges)
    return t({
      id: "officeAddin.word.authoring.readOnlyTooLargeTracking",
      message:
        "The file is also too large for Erato to open completely, so Erato receives only the included text.",
    });
  if (issue === "too-large")
    return t({
      id: "officeAddin.word.authoring.readOnlyTooLarge",
      message:
        "This file is too large for Erato to open completely. Erato receives only the included text and can reword it, but not change its structure or formatting.",
    });
  if (details.includes("package-unsupported"))
    return t({
      id: "officeAddin.word.authoring.readOnlyUnsupported",
      message:
        "Erato cannot edit this document's file structure, so it can only read its text.",
    });
  return t({
    id: "officeAddin.word.authoring.readOnlyUnavailable",
    message:
      "Word did not hand over the complete document, so Erato can read its text but not edit it. Send again to retry.",
  });
}

function chipLabel(
  preview: WordDocumentPreview,
  documentName: string,
  authoringRoute: boolean,
  readInParts: boolean,
): string {
  if (preview.status === "unreadable") {
    return t({
      id: "officeAddin.word.chip.notIncluded",
      message: "Document not included",
    });
  }
  if (preview.status === "empty") {
    return t({
      id: "officeAddin.word.chip.newDocument",
      message: "New document",
    });
  }
  if (preview.changedSinceLastSend) {
    return t({
      id: "officeAddin.word.chip.changed",
      message: "Document included - changed since last send",
    });
  }
  if (readInParts) {
    return t({
      id: "officeAddin.word.chip.includedInParts",
      message: "Document included · read in parts",
    });
  }
  const coverage = authoringRoute ? null : preview.coverage;
  if (coverage?.partialParagraph) {
    return t({
      id: "officeAddin.word.chip.includedPartial",
      message: "Document included (partial)",
    });
  }
  if (coverage?.truncated) {
    return t({
      id: "officeAddin.word.chip.includedTruncated",
      message: `Document included (first ${coverage.paragraphsSent} of ${coverage.paragraphsTotal} paragraphs)`,
    });
  }
  if (documentName) {
    return t({
      id: "officeAddin.word.chip.includedNamed",
      message: `${documentName} is included`,
    });
  }
  return t({
    id: "officeAddin.word.chip.included",
    message: "Document included",
  });
}
