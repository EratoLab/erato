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

import { AddinChatInputCore } from "../../core/AddinChatInputCore";
import {
  useAvailableActionFacetArgs,
  useAvailableActionFacetIds,
} from "../../core/clientActions/useAvailableActionFacets";
import { AddinSelectionChip } from "../../core/selection/AddinSelectionChip";
import { useConversationKey } from "../../core/selection/useConversationKey";
import { useSelectionDismissal } from "../../core/selection/useSelectionDismissal";
import { useWordDocumentSource } from "../hooks/useWordDocumentSource";
import { useWordSelection } from "../hooks/useWordSelection";
import {
  armWordSelection,
  wordSelectionStore,
} from "../hooks/wordSelectionStore";
import {
  resolveWordActionFacet,
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
import { wordCommentHeadingsFromBuild } from "../utils/wordCommentMap";
import { wordCommentSelectionCoordinates } from "../utils/wordCommentPositions";
import {
  wordCommentReadSession,
  WORD_READ_COMMENTS_TOOL,
} from "../utils/wordCommentReadTool";
import { wordCommentInventoryFromCapture } from "../utils/wordCommentReader";
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
import { captureWordImageAssets } from "../utils/wordImageAssets";
import { emptySelectionCapture } from "../utils/wordSelectionAnchor";
import { captureWordSelection } from "../utils/wordSelectionCapture";
import { markWordSend } from "../utils/wordSendTiming";
import { useWordIncludeDocumentByDefault } from "../wordPreferences";

import type {
  AddinChatInputRenderProps,
  AddinSendPreparation,
} from "../../core/AddinChatCore";
import type { AddinChatInputCoreProps } from "../../core/AddinChatInputCore";
import type { WordDocumentPreview } from "../hooks/useWordDocumentSource";
import type { WordDocumentBuild } from "../utils/buildWordDocumentArgs";
import type { WordCommentReadActivation } from "../utils/wordCommentReadTool";
import type { WordDocumentCapture } from "@erato/frontend/word-review";

export interface WordChatInputProps {
  chatInputProps: AddinChatInputRenderProps;
  documentIdentity: string;
  stagePendingCapture: (capture: WordDocumentCapture | null) => void;
}

export const WORD_SEND_SKIP_OFFER_MS = 8_000;
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
}: WordChatInputProps) {
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
    }
  }
  const lastIdentityRef = useRef(documentIdentity);
  if (documentIdentity !== lastIdentityRef.current) {
    lastIdentityRef.current = documentIdentity;
    setChatDefault(includeByDefault);
    setInclusionOverride(null);
  }

  const isDocumentIncluded =
    inclusionOverride ?? (chatId === null ? includeByDefault : chatDefault);
  const chipEnabled = isDocumentIncluded && chipAvailable;

  const availableFacetArgs = useAvailableActionFacetArgs();
  const selectionAvailable = wordSelectionFacetAvailable(
    availableFacetIds,
    availableFacetArgs,
  );
  useWordSelection(documentIdentity, selectionAvailable);
  const liveSelection = wordSelectionStore.useSnapshot();
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
  const selectionReplacesDocument =
    chipEnabled && selectionShown && liveSelection.armed;
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
      "authoringIssue" | "authoringDetails" | "completeReadIssue"
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
  useEffect(() => {
    const unregisterComments = registerClientToolExecutor(
      WORD_READ_COMMENTS_TOOL,
      wordCommentReadSession.execute,
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
      clearReadSession();
      clearCommentSession();
    };
  }, [clearReadSession, clearCommentSession]);
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

      if (!chipEnabled && !selectionDue) {
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
          "gestures" | "selection" | "inventory" | "headings"
        >,
      ) => {
        const token = wordCommentReadSession.activate({
          ...activation,
          identity: documentIdentity,
          people: { principalEmail },
          documentIncluded: () => readEnabledRef.current,
        });
        stopCommentBindingRef.current = bindWordDocumentReadRequest(
          wordCommentReadSession,
          token,
          chatId,
        );
      };
      const finishPreparing = () => {
        preparingRef.current = false;
        settleCaptureRef.current = null;
        setSlowCapture(false);
      };
      const prepareDocument: AddinSendPreparation["run"] = async (signal) => {
        const withoutDocument = () => {
          stagePendingCapture(null);
          return { actionFacet: undefined, hostContextIdentity: null };
        };
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
          if (outcome.kind === "skipped") return withoutDocument();
          if (outcome.kind === "timeout") {
            build = previousCapture();
            setCaptureNotice(build ? "previous-capture" : "not-included");
            if (!build) return withoutDocument();
          } else build = outcome.build;
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
            return withoutDocument();
          }
          const capturedIssue = build?.authoring?.issue;
          const capturedDetails = build?.authoring?.issueDetails;
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
          });
          if (actionFacet) markSent(build);
          else clearReadSession();
          stagePendingCapture(
            actionFacet
              ? {
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
                }
              : null,
          );
          if (actionFacet && build?.authoring) {
            stopRequestBindingRef.current = bindWordDocumentReadRequest(
              wordDocumentReadSession,
              build.authoring.token,
              chatId,
            );
          }
          if (actionFacet && build)
            activateCommentReads({
              gestures: { document: true },
              inventory: wordCommentInventoryFromCapture(build.ordinalMap),
              headings: wordCommentHeadingsFromBuild(build.headings),
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
        const actionFacet = selection
          ? resolveWordSelectionFacet({
              selection,
              documentName: resolveWordDocumentName(),
              documentIdentity,
              availableFacetIds,
              availableFacetArgs,
            })
          : undefined;
        if (selection && actionFacet) {
          stagePendingCapture(
            emptySelectionCapture(documentIdentity, selection),
          );
          activateCommentReads({
            gestures: { document: chipEnabled },
            selection: wordCommentSelectionCoordinates(selection),
          });
          return { actionFacet, hostContextIdentity: documentIdentity };
        }
        if (chipEnabled) return prepareDocument(signal);
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
          : captureExpectedSlow()
            ? t({
                id: "officeAddin.word.send.readingDocument",
                message: "Reading document…",
              })
            : undefined,
        run: async (signal) => {
          markWordSend("prepare-start");
          try {
            return await (selectionDue
              ? prepareSelection(signal)
              : prepareDocument(signal));
          } finally {
            markWordSend("prepare-end");
            finishPreparing();
          }
        },
        onAbandoned: () => {
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
      documentIdentity,
      markSent,
      previousCapture,
      principalEmail,
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
  const readInParts =
    authoringRoute && !!notice.completeReadIssue && !notice.authoringIssue;
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
            liveSelection.preview.truncated
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
              <span className="min-w-0 truncate">
                {selectionReplacesDocument
                  ? t({
                      id: "officeAddin.word.chip.selectionInstead",
                      message: "Your selection is sent instead of the document",
                    })
                  : chipLabel(
                      preview,
                      resolveWordDocumentName(),
                      authoringRoute,
                      readInParts,
                    )}
              </span>
              <button
                type="button"
                onClick={() => setInclusionOverride(false)}
                className="ml-auto shrink-0 rounded-[var(--theme-radius-control)] p-0.5 hover:bg-theme-bg-tertiary"
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
              onClick={() => setInclusionOverride(true)}
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
          {chipEnabled && !selectionReplacesDocument && coverageHint && (
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
            notice.authoringIssue &&
            (readOnly ? (
              <Alert type="warning">
                {readOnlyText(notice.authoringIssue, notice.authoringDetails)}
              </Alert>
            ) : (
              <Alert type="warning">
                {wordAuthoringIssueText(
                  notice.authoringIssue,
                  notice.authoringDetails,
                )}
              </Alert>
            ))}
        </div>
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

function readOnlyText(issue: string, details: string[] = []): string {
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
