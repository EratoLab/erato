import {
  Button,
  Alert,
  CopyErrorButton,
  DocumentIcon,
  registerClientToolExecutor,
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
  wordSelectionFacetAvailable,
  wordSelectionForFacets,
  wordSelectionTakesSlot,
} from "../utils/wordActionFacet";
import { renderWordDiagnosticReport } from "../utils/wordApplyDiagnostics";
import { checkWordAuthoringBudget } from "../utils/wordAuthoringBudget";
import { wordAuthoringIssueText } from "../utils/wordAuthoringMessages";
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

import type {
  AddinChatInputRenderProps,
  AddinSendPreparation,
} from "../../core/AddinChatCore";
import type { AddinChatInputCoreProps } from "../../core/AddinChatInputCore";
import type { WordDocumentPreview } from "../hooks/useWordDocumentSource";
import type { WordDocumentCapture } from "@erato/frontend/word-review";

export interface WordChatInputProps {
  chatInputProps: AddinChatInputRenderProps;
  documentIdentity: string;
  stagePendingCapture: (capture: WordDocumentCapture | null) => void;
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

  const [isDocumentIncluded, setIsDocumentIncluded] = useState(false);
  const lastChatIdRef = useRef(chatId);
  if (chatId !== lastChatIdRef.current) {
    // Receiving an ID for a new chat is continuation, not a switch to another conversation.
    const isNewChatGettingItsId =
      lastChatIdRef.current == null && chatId != null;
    lastChatIdRef.current = chatId;
    if (!isNewChatGettingItsId) setIsDocumentIncluded(false);
  }
  const lastIdentityRef = useRef(documentIdentity);
  if (documentIdentity !== lastIdentityRef.current) {
    lastIdentityRef.current = documentIdentity;
    setIsDocumentIncluded(false);
  }

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
  const previewMayRewrite = liveSelection.preview?.mayRewrite ?? false;
  // A context-only selection never displaces an included document, so with the document included
  // only a selection that may be rewritten, or one still being read, is read again at Send.
  const selectionMayTakeSlot =
    !chipEnabled || previewMayRewrite || liveSelection.pending;
  // A selection the user changed but whose read is still pending is read at Send as well; the
  // dismissal still refers to the previous one then.
  const selectionDue =
    selectionAvailable &&
    selectionMayTakeSlot &&
    ((liveSelection.preview !== null &&
      liveSelection.armed &&
      !selectionDismissal.dismissed) ||
      liveSelection.pending);
  const [selectionReadFailed, setSelectionReadFailed] = useState(false);
  const { preview, capture } = useWordDocumentSource({
    enabled: chipEnabled,
    documentIdentity,
    authoringEnabled: authoringAvailable,
  });

  const preparingRef = useRef(false);
  const [preparing, setPreparing] = useState(false);
  const [authoringNotice, setAuthoringNotice] =
    useState<
      Pick<WordDocumentPreview, "authoringIssue" | "authoringDetails">
    >();
  const sendingContextRef = useRef({ chatId, documentIdentity });
  sendingContextRef.current = { chatId, documentIdentity };
  const readEnabledRef = useRef(chipEnabled);
  readEnabledRef.current = chipEnabled;
  const stopRequestBindingRef = useRef<(() => void) | undefined>(undefined);
  const clearReadSession = useCallback(() => {
    stopRequestBindingRef.current?.();
    stopRequestBindingRef.current = undefined;
    wordDocumentReadSession.clear();
  }, []);
  useEffect(() => {
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
      clearReadSession();
    };
  }, [clearReadSession]);
  useEffect(() => {
    if (!chipEnabled) {
      clearReadSession();
      setAuthoringNotice(undefined);
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
      setSelectionReadFailed(false);
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
      const finishPreparing = () => {
        preparingRef.current = false;
        setPreparing(false);
      };
      const prepareDocument: AddinSendPreparation["run"] = async (signal) => {
        const withoutDocument = () => {
          stagePendingCapture(null);
          return { actionFacet: undefined, hostContextIdentity: null };
        };
        // Images are independent of the document read and are only kept when
        // authoring is available, so both start together.
        const images =
          authoringAvailable && inputFileIds?.length
            ? captureWordImageAssets(inputFileIds).catch(() => null)
            : null;
        let build: Awaited<ReturnType<typeof capture>>;
        try {
          build = await capture();
          markWordSend("capture-end");
        } catch {
          return signal.aborted || contextChanged() ? null : withoutDocument();
        }
        const captured = images && (await images);
        if (build?.authoring && !build.authoring.issue && captured) {
          build.authoring.assets = captured.assets;
          build.authoring.imageAssetIssues = captured.unavailable;
        }
        if (signal.aborted) return null;
        if (build?.authoring && !build.authoring.issue) {
          const budget = await checkWordAuthoringBudget(build.authoring, {
            message,
            chatId,
            assistantId: chatInputProps.assistantId,
            modelId:
              modelId ??
              chatInputProps.controlledSelectedModel?.chat_provider_id,
            fileIds: inputFileIds,
          });
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
                    modelId:
                      modelId ??
                      chatInputProps.controlledSelectedModel?.chat_provider_id,
                    fileIds: inputFileIds,
                    mode: "complete",
                  },
                );
                return budget.ok ? undefined : budget.issue;
              }
            : undefined,
        );
        setAuthoringNotice({
          authoringIssue: build?.authoring?.issue,
          authoringDetails: build?.authoring?.issueDetails,
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
        if (!actionFacet) {
          clearReadSession();
        }
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
        return {
          actionFacet,
          hostContextIdentity: actionFacet ? documentIdentity : null,
        };
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
        const actionFacet =
          selection && wordSelectionTakesSlot(selection, chipEnabled)
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
          return { actionFacet, hostContextIdentity: documentIdentity };
        }
        if (chipEnabled) return prepareDocument(signal);
        stagePendingCapture(null);
        return { actionFacet: undefined, hostContextIdentity: null };
      };

      preparingRef.current = true;
      setPreparing(true);
      send(undefined, null, {
        label:
          selectionDue && !chipEnabled
            ? t({
                id: "officeAddin.word.send.readingSelection",
                message: "Reading selection…",
              })
            : t({
                id: "officeAddin.word.send.preparingDocument",
                message: "Preparing document…",
              }),
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
      chatInputProps,
      chipEnabled,
      clearReadSession,
      documentIdentity,
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

  return (
    <>
      {selectionShown && liveSelection.preview && (
        <AddinSelectionChip
          preview={liveSelection.preview.text}
          metaLabel={selectionMetaLabel(liveSelection.preview.paragraphCount)}
          note={
            chipEnabled && !previewMayRewrite
              ? t({
                  id: "officeAddin.word.selection.notSentWithDocument",
                  message: "Not sent while the document is included.",
                })
              : chipEnabled
                ? t({
                    id: "officeAddin.word.selection.insteadOfDocument",
                    message:
                      "If this passage can be replaced, it is sent instead of the document.",
                  })
                : liveSelection.preview.truncated
                  ? t({
                      id: "officeAddin.word.selection.truncated",
                      message:
                        "Too long to send in full. Only the beginning is sent.",
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
          <Button
            type="button"
            onClick={() => setIsDocumentIncluded((included) => !included)}
            aria-pressed={chipEnabled}
            data-testid="word-include-document-chip"
            variant="secondary"
            className="w-full justify-start text-left"
            icon={<DocumentIcon className="size-4" />}
          >
            <span className="min-w-0 truncate">
              {chipLabel(chipEnabled, preview)}
            </span>
          </Button>
          {chipEnabled && readReport && (
            <CopyErrorButton
              error={readReport}
              reportOptions={reportOptions}
              className="mt-1"
            />
          )}
          {chipEnabled && (authoringNotice ?? preview).authoringIssue && (
            <Alert type="warning">
              {wordAuthoringIssueText(
                (authoringNotice ?? preview).authoringIssue!,
                (authoringNotice ?? preview).authoringDetails,
              )}
            </Alert>
          )}
        </div>
      )}

      <AddinChatInputCore
        {...chatInputProps}
        pausesHostActionsWhenWritesOff
        disabled={chatInputProps.disabled || preparing}
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

function chipLabel(enabled: boolean, preview: WordDocumentPreview): string {
  if (!enabled) {
    return t({
      id: "officeAddin.word.chip.include",
      message: "Include this document",
    });
  }
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
  const coverage = preview.coverage;
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
  return t({
    id: "officeAddin.word.chip.included",
    message: "Document included",
  });
}
