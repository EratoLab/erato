import {
  registerClientToolExecutor,
  useLiveAnnouncement,
  useProfile,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { WordCommentPicker } from "./WordCommentPicker";
import { AddinChatInputCore } from "../../core/AddinChatInputCore";
import {
  useAvailableActionFacetArgs,
  useAvailableActionFacetIds,
} from "../../core/clientActions/useAvailableActionFacets";
import { useConversationKey } from "../../core/selection/useConversationKey";
import { useWordClientOperations } from "../hooks/useWordClientOperations";
import { useWordComments } from "../hooks/useWordComments";
import { useWordContextItems } from "../hooks/useWordContextItems";
import { useWordDocumentSource } from "../hooks/useWordDocumentSource";
import { useWordSelection } from "../hooks/useWordSelection";
import { wordCommentGestureStore } from "../hooks/wordCommentGestureStore";
import { wordContextStore } from "../hooks/wordContextStore";
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
import {
  readOnlyText,
  wordAuthoringIssueText,
} from "../utils/wordAuthoringMessages";
import {
  wordCommentChip,
  wordDocumentComments,
  wordOpenCommentsChip,
  wordPassageComments,
} from "../utils/wordCommentChips";
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
import { wordComposerNotice } from "../utils/wordComposerNotice";
import { wordDocumentChip, wordSelectionChip } from "../utils/wordContextChips";
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
import type { WordCommentListThread } from "../hooks/useWordComments";
import type { WordContextHandlers } from "../hooks/useWordContextItems";
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
import type { WordCaptureNotice } from "../utils/wordComposerNotice";
import type { ChatInputControlsHandle } from "@erato/frontend/library";
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

type CaptureNotice = WordCaptureNotice;

const NO_DISMISSED_NOTICES: ReadonlySet<string> = new Set();

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
  const conversationKey = useConversationKey(chatId, documentIdentity);
  // The setting applies to new chats; a chat keeps the default it started with.
  const isDocumentIncluded = wordContextStore.useDocumentIncluded(
    conversationKey,
    { chatStarted: chatId !== null, includeByDefault },
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
    openCommentsDismissed,
  } = wordCommentGestureStore.useSnapshot();
  const [commentBlock, setCommentBlock] = useState<WordCommentBlock | null>(
    null,
  );
  const commentBlockRef = useRef(commentBlock);
  commentBlockRef.current = commentBlock;
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
    if (!isNewChatGettingItsId) {
      // The send waiting in the chat being left is dropped now, so it cannot hold up this one.
      const settle = settleCaptureRef.current;
      if (settle) globalThis.queueMicrotask(() => settle({ kind: "aborted" }));
      leftCommentsRef.current = "chat";
    }
  }
  const lastIdentityRef = useRef(documentIdentity);
  if (documentIdentity !== lastIdentityRef.current) {
    lastIdentityRef.current = documentIdentity;
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
  const armedSelectionKeyRef = useRef(armedSelectionKey);
  armedSelectionKeyRef.current = armedSelectionKey;
  useEffect(() => {
    wordCommentGestureStore.pick({ kind: "selection", key: armedSelectionKey });
    wordCommentGestureStore.set({ override: null, withoutComments: false });
  }, [armedSelectionKey]);
  const selectionKey = liveSelection.preview?.key ?? "";
  const selectionDismissed = wordContextStore.useSelectionDismissed(
    conversationKey,
    selectionKey,
  );
  const contextKeysRef = useRef({ conversationKey, selectionKey });
  contextKeysRef.current = { conversationKey, selectionKey };
  const composerLocked = !!chatInputProps.disabled;
  const lockedRef = useRef(composerLocked);
  lockedRef.current = composerLocked;
  const [selectionReadFailed, setSelectionReadFailed] = useState(false);
  // The chip's error holds for the selection that failed; a new selection is read afresh.
  const [selectionFailedKey, setSelectionFailedKey] = useState<string | null>(
    null,
  );
  const dismissSelection = useCallback(() => {
    const keys = contextKeysRef.current;
    wordContextStore.dismissSelection(keys.conversationKey, keys.selectionKey);
    setSelectionFailedKey(null);
  }, []);
  const rearmSelection = useCallback(() => {
    const keys = contextKeysRef.current;
    wordContextStore.rearmSelection(keys.conversationKey, keys.selectionKey);
  }, []);
  // An archived chat or a delegated run that is writing locks the composer,
  // and the document's inclusion with it.
  const setDocumentIncluded = useCallback((included: boolean) => {
    if (lockedRef.current) return;
    wordContextStore.setDocumentIncluded(
      contextKeysRef.current.conversationKey,
      included,
    );
  }, []);
  const excludeDocument = useCallback(
    () => setDocumentIncluded(false),
    [setDocumentIncluded],
  );
  const includeDocument = useCallback(
    () => setDocumentIncluded(true),
    [setDocumentIncluded],
  );
  useEffect(
    () =>
      wordSelectionStore.subscribeRefresh(({ rearm }) => {
        if (rearm) rearmSelection();
      }),
    [rearmSelection],
  );
  const selectionShown =
    selectionAvailable && liveSelection.preview !== null && !selectionDismissed;
  // A selection the user made is sent instead of the document, as Outlook sends a selection
  // instead of the draft. A selection still being read is read again at Send.
  const selectionDue =
    selectionAvailable &&
    ((liveSelection.preview !== null &&
      liveSelection.armed &&
      !selectionDismissed) ||
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
  const passageGoesRef = useRef(passageGoes);
  passageGoesRef.current = passageGoes;
  const commentListRef = useRef(commentList);
  commentListRef.current = commentList;
  const pickRefRef = useRef(pickRef);
  pickRefRef.current = pickRef;
  const onOpenWordSettingsRef = useRef(onOpenWordSettings);
  onOpenWordSettingsRef.current = onOpenWordSettings;
  const composerRef = useRef<ChatInputControlsHandle>(null);
  // Picks made outside the lane (the picker, Show in Word) are said here; the lane says its own.
  const [pickAnnouncement, announcePick] = useLiveAnnouncement();
  /** A pick also answers a Send waiting on a choice, and is never left off for the message. */
  const pickComment = useCallback(
    (ref: string, options: { announce?: boolean } = {}) => {
      wordCommentGestureStore.pick({
        kind: "pick",
        ref,
        selectionKey: armedSelectionKeyRef.current,
      });
      wordCommentGestureStore.set({ withoutComments: false });
      const block = commentBlockRef.current;
      if (block === "choose-comment" || block === "picked-gone")
        decideCommentsRef.current?.({ kind: "pick", ref });
      setPickerOpen(false);
      const thread = commentListRef.current.threads.find(
        (entry) => entry.ref === ref,
      );
      if (options.announce && thread) {
        const { author } = thread;
        announcePick(
          t({
            id: "officeAddin.word.context.comment.announce.chosen",
            message: `Comment by ${author} chosen.`,
          }),
        );
      }
    },
    [announcePick],
  );
  const pickFromLane = useCallback(
    (ref: string) => pickComment(ref),
    [pickComment],
  );
  const pickFromPicker = useCallback(
    (ref: string) => pickComment(ref, { announce: true }),
    [pickComment],
  );
  /** Word's own select is Erato's, which ends nothing; picking first keeps the thread the target. */
  const showComment = useCallback(
    (thread: WordCommentListThread) => {
      if (pickRefRef.current !== thread.ref)
        pickComment(thread.ref, { announce: true });
      return showWordComment(thread.commentId, thread.para);
    },
    [pickComment],
  );
  /** A Send waiting on a choice is answered; otherwise the next message goes without comments. */
  const sendWithoutCommentsGesture = useCallback(() => {
    const block = commentBlockRef.current;
    if (block === "choose-comment" || block === "picked-gone") {
      if (block === "picked-gone")
        wordCommentGestureStore.pick({ kind: "dismiss" });
      decideCommentsRef.current?.({ kind: "without" });
      return;
    }
    wordCommentGestureStore.set({ withoutComments: true });
  }, []);
  const endPick = useCallback(() => {
    wordCommentGestureStore.pick({ kind: "dismiss" });
    if (commentBlockRef.current === "picked-gone")
      decideCommentsRef.current?.({ kind: "without" });
  }, []);
  const restoreComments = useCallback(() => {
    const { override } = wordCommentGestureStore.getSnapshot();
    wordCommentGestureStore.set({
      withoutComments: false,
      ...(override === "passage" ? { override: null } : {}),
    });
  }, []);
  const sendPassageInstead = useCallback(() => {
    wordCommentGestureStore.pick({ kind: "dismiss" });
    wordCommentGestureStore.set({ override: "passage" });
  }, []);
  const sendCommentInstead = useCallback(() => {
    wordCommentGestureStore.set({ override: "comment" });
  }, []);
  const openPicker = useCallback(() => setPickerOpen(true), []);
  const closePicker = useCallback(() => setPickerOpen(false), []);
  const changeDefault = useCallback(
    () => onOpenWordSettingsRef.current?.(),
    [],
  );
  // "Include open comments" lasts for the chat, as the document's inclusion does, so it locks too.
  const includeOpenCommentsGesture = useCallback(() => {
    if (lockedRef.current) return;
    wordCommentGestureStore.set({
      includeOpenComments: true,
      openCommentsDismissed: false,
    });
  }, []);
  const excludeOpenComments = useCallback(() => {
    if (lockedRef.current) return;
    wordCommentGestureStore.set({
      includeOpenComments: false,
      openCommentsDismissed: true,
    });
  }, []);
  const setPassageComments = useCallback(
    (on: boolean) => wordCommentGestureStore.set({ withoutComments: !on }),
    [],
  );
  /** The document or the open comments instead of the thread, and of a passage that would win. */
  const sendInsteadOfComment = useCallback(() => {
    wordCommentGestureStore.pick({ kind: "dismiss" });
    wordCommentGestureStore.set({ override: "passage" });
    if (passageGoesRef.current) dismissSelection();
  }, [dismissSelection]);
  // A pick from the picker resolves after the notice that opened it is gone, so focus has no opener.
  const pickerWasOpenRef = useRef(false);
  useEffect(() => {
    if (pickerOpen) {
      pickerWasOpenRef.current = true;
      return;
    }
    if (!pickerWasOpenRef.current) return;
    pickerWasOpenRef.current = false;
    const active = document.activeElement;
    if (active === null || active === document.body)
      composerRef.current?.focusInput();
  }, [pickerOpen]);
  const {
    preview,
    capture,
    captureExpectedSlow,
    previousCapture,
    markSent,
    retry: retryDocument,
  } = useWordDocumentSource({
    enabled: chipEnabled,
    documentIdentity,
    authoringEnabled: authoringAvailable,
  });

  const preparingRef = useRef(false);
  const [dismissedNotices, setDismissedNotices] =
    useState<ReadonlySet<string>>(NO_DISMISSED_NOTICES);
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
      setSelectionFailedKey(null);
      setCaptureNotice(null);
      setDismissedNotices(NO_DISMISSED_NOTICES);
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
          setSelectionFailedKey(contextKeysRef.current.selectionKey || null);
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
  // The chips state what the Send would carry, in the Send's order.
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
  const readInParts =
    authoringRoute && !!notice.completeReadIssue && !notice.authoringIssue;
  const issue = notice.authoringIssue;
  // The Send's own budget check, not a fact about the document: it says to send again.
  const budgetIssue =
    issue === "model-budget" || issue === "budget-unavailable"
      ? issue
      : undefined;
  const trackChanges =
    (!!notice.trackChanges || issue === "tracking") && !authoringRoute;
  const lastingIssue =
    issue && !budgetIssue && !(readOnly && issue === "tracking")
      ? {
          readOnly,
          text: readOnly
            ? readOnlyText(issue, notice.authoringDetails, notice.trackChanges)
            : wordAuthoringIssueText(issue, notice.authoringDetails),
        }
      : null;
  // The same resolver with this message's "off" gestures undone: what (+) on a comment chip brings back.
  const asIfPreview = previewWordSend({
    advertised: commentAdvertised,
    precedence: commentPrecedence,
    pick: pickRef,
    pickFound: livePickFound,
    override: commentOverride === "passage" ? null : commentOverride,
    withoutComments: false,
    includeOpenComments,
    documentIncluded: chipEnabled,
    passageGoes,
    commentSelection: liveCommentSelection,
    authoring: authoringRoute,
    hasContent: preview.coverage?.hasContent ?? false,
    unreadable: preview.status === "unreadable",
    availableFacetIds,
  });
  const commentChipsInput = {
    preview: sendPreview,
    asIf: asIfPreview,
    list: commentList,
    pick: pickRef,
    gestures: {
      withoutComments,
      override: commentOverride,
      includeOpenComments,
      openCommentsDismissed,
    },
    documentOn: chipEnabled,
    threadAdvertised: commentAdvertised.thread,
    mapAdvertised: commentAdvertised.map.size > 0,
    canChangeDefault: commentAdvertised.thread && !!onOpenWordSettings,
    passageGoes,
  };
  const chipInput = {
    preview: sendPreview,
    selection:
      selectionAvailable && liveSelection.preview
        ? {
            text: liveSelection.preview.text,
            paragraphCount: liveSelection.preview.paragraphCount,
            truncated: liveSelection.preview.truncated,
            armed: liveSelection.armed,
            dismissed: selectionDismissed,
            readFailed: selectionFailedKey === liveSelection.preview.key,
            comments: wordPassageComments(commentChipsInput),
          }
        : null,
    document: {
      available: chipAvailable,
      included: isDocumentIncluded,
      status: preview.status,
      reading: preview.reading,
      coverage: preview.coverage,
      changed: preview.changedSinceLastSend,
      authoringRoute,
      readInParts,
      trackChanges,
      lastingIssue,
      bodyOnly:
        authoringRoute && !issue && notice.authoringNote === "package-blocked",
      comments: wordDocumentComments(commentChipsInput),
      readReport,
    },
  };
  const handlers = useMemo(
    (): WordContextHandlers => ({
      dismissSelection,
      rearmSelection,
      armSelection: armWordSelection,
      excludeDocument,
      includeDocument,
      retryDocument,
      sendDocumentInstead: dismissSelection,
      withoutComments: sendWithoutCommentsGesture,
      restoreComments,
      endPick,
      sendPassageInstead,
      sendCommentInstead,
      sendInsteadOfComment,
      pickComment: pickFromLane,
      openPicker,
      changeDefault,
      includeOpenComments: includeOpenCommentsGesture,
      excludeOpenComments,
      setPassageComments,
      showComment,
    }),
    [
      dismissSelection,
      rearmSelection,
      excludeDocument,
      includeDocument,
      retryDocument,
      sendWithoutCommentsGesture,
      restoreComments,
      endPick,
      sendPassageInstead,
      sendCommentInstead,
      sendInsteadOfComment,
      pickFromLane,
      openPicker,
      changeDefault,
      includeOpenCommentsGesture,
      excludeOpenComments,
      setPassageComments,
      showComment,
    ],
  );
  const contextItems = useWordContextItems({
    selection: wordSelectionChip(chipInput),
    document: wordDocumentChip(chipInput),
    comment: commentsShown ? wordCommentChip(commentChipsInput) : null,
    openComments: commentsShown
      ? wordOpenCommentsChip(commentChipsInput)
      : null,
    documentName: resolveWordDocumentName(),
    locked: composerLocked,
    reportOptions,
    handlers,
  });
  const noticeHandlers = useMemo(
    () => ({
      openPicker,
      sendWithoutComments: () =>
        decideCommentsRef.current?.({ kind: "without" }),
      sendWithoutDocument: () =>
        settleCaptureRef.current?.({ kind: "skipped" }),
      dismissSelectionReadFailed: () => setSelectionReadFailed(false),
      dismiss: (id: string) =>
        setDismissedNotices((current) => new Set(current).add(id)),
    }),
    [openPicker],
  );
  const budgetDetails = notice.authoringDetails;
  const composerNotice = useMemo(
    () =>
      wordComposerNotice(
        {
          commentBlock,
          threadAdvertised: commentAdvertised.thread,
          chipEnabled,
          slowCapture,
          commentProgress,
          selectionReadFailed,
          captureNotice,
          budgetIssue,
          budgetDetails,
          dismissed: dismissedNotices,
        },
        noticeHandlers,
      ),
    [
      commentBlock,
      commentAdvertised.thread,
      chipEnabled,
      slowCapture,
      commentProgress,
      selectionReadFailed,
      captureNotice,
      budgetIssue,
      budgetDetails,
      dismissedNotices,
      noticeHandlers,
    ],
  );

  return (
    <>
      {commentAdvertised.thread && (
        <WordCommentPicker
          isOpen={pickerOpen}
          onClose={closePicker}
          list={commentList}
          onRefresh={refreshComments}
          onPick={pickFromPicker}
          onShowInWord={showWordComment}
          picked={pickRef}
          web={wordHostPlatform() === "OfficeOnline"}
        />
      )}
      <div
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
        data-testid="word-composer-announcer"
      >
        {pickAnnouncement}
      </div>

      <AddinChatInputCore
        {...chatInputProps}
        ref={composerRef}
        contextItems={contextItems}
        composerNotice={composerNotice}
        pausesHostActionsWhenWritesOff
        onSendMessage={handleSendMessage}
      />
    </>
  );
}
