import {
  Button,
  Alert,
  DocumentIcon,
  registerClientToolExecutor,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useRef, useState } from "react";

import { AddinChatInputCore } from "../../core/AddinChatInputCore";
import { useAvailableActionFacetIds } from "../../core/clientActions/useAvailableActionFacets";
import { useWordDocumentSource } from "../hooks/useWordDocumentSource";
import {
  resolveWordActionFacet,
  WORD_COMPOSE_FACET_ID,
  WORD_AUTHORING_FACET_ID,
  WORD_DOCUMENT_REVIEW_FACET_ID,
} from "../utils/wordActionFacet";
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

import type { AddinChatInputRenderProps } from "../../core/AddinChatCore";
import type { AddinChatInputCoreProps } from "../../core/AddinChatInputCore";
import type { WordDocumentPreview } from "../hooks/useWordDocumentSource";
import type { WordDocumentCapture } from "../utils/wordDocumentCapture";

export interface WordChatInputProps {
  chatInputProps: AddinChatInputRenderProps;
  /** Minted once per pane load by the host; the chip resets when it changes. */
  documentIdentity: string;
  /** Hands the send-time capture to the host, which pairs it with the reply. */
  stagePendingCapture: (capture: WordDocumentCapture | null) => void;
}

/**
 * Add a per-chat, opt-in document chip to the shared composer. Its state lives
 * only in React; persisting it through Office document settings would write
 * an application identifier into the DOCX.
 */
export function WordChatInput({
  chatInputProps,
  documentIdentity,
  stagePendingCapture,
}: WordChatInputProps) {
  const { chatId } = chatInputProps;
  const availableFacetIds = useAvailableActionFacetIds();
  // A chip must never promise context the send cannot carry: an unadvertised
  // facet id hard-400s the whole request, so with neither facet configured the
  // chip is not rendered at all.
  const reviewAvailable = availableFacetIds.has(WORD_DOCUMENT_REVIEW_FACET_ID);
  const composeAvailable = availableFacetIds.has(WORD_COMPOSE_FACET_ID);
  const authoringAvailable = availableFacetIds.has(WORD_AUTHORING_FACET_ID);
  const chipAvailable =
    reviewAvailable || composeAvailable || authoringAvailable;

  const [isDocumentIncluded, setIsDocumentIncluded] = useState(false);
  const lastChatIdRef = useRef(chatId);
  if (chatId !== lastChatIdRef.current) {
    // A brand-new chat receiving its id on first send is the same
    // conversation continuing; resetting there would switch the chip off at
    // the exact moment the user had just switched it on.
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
      const send = (
        actionFacet: ReturnType<typeof resolveWordActionFacet>,
        hostContextIdentity: string | null,
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
        );
      };

      if (!chipEnabled) {
        stagePendingCapture(null);
        send(undefined, null);
        return;
      }

      // The read is authoritative and always fresh: the document rides EVERY
      // send while the chip is on. A failure must not block the send.
      preparingRef.current = true;
      setPreparing(true);
      void capture()
        .then(
          async (build) => {
            if (
              build?.authoring &&
              !build.authoring.issue &&
              inputFileIds?.length
            ) {
              const images = await captureWordImageAssets(inputFileIds);
              build.authoring.assets = images.assets;
              build.authoring.imageAssetIssues = images.unavailable;
            }
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
            }
            if (
              sendingContextRef.current.chatId !== chatId ||
              sendingContextRef.current.documentIdentity !== documentIdentity
            )
              return;
            if (!readEnabledRef.current) {
              clearReadSession();
              stagePendingCapture(null);
              send(undefined, null);
              return;
            }
            // Paging can discover an additional size limit. Finalize it before
            // telling the model which operations this exact snapshot permits.
            wordDocumentReadSession.activate(build?.authoring);
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
                    paragraphsSent: build?.coverage.paragraphsSent ?? 0,
                    // What the model actually read, straight from the renderer:
                    // the write path edits this set and nothing else.
                    renderedOrdinals: build?.renderedOrdinals ?? new Set(),
                    partialOrdinal: build?.partialOrdinal ?? null,
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
            send(actionFacet, actionFacet ? documentIdentity : null);
          },
          () => {
            if (
              sendingContextRef.current.chatId !== chatId ||
              sendingContextRef.current.documentIdentity !== documentIdentity
            )
              return;
            stagePendingCapture(null);
            send(undefined, null);
          },
        )
        .finally(() => {
          preparingRef.current = false;
          setPreparing(false);
        });
    },
    [
      availableFacetIds,
      chatId,
      capture,
      chatInputProps,
      chipEnabled,
      clearReadSession,
      documentIdentity,
      stagePendingCapture,
    ],
  );

  return (
    <>
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
        // The action facet rides implicitly with every send from here, so the
        // per-chat write switch pauses the Word actions too.
        pausesHostActionsWhenWritesOff
        disabled={chatInputProps.disabled || preparing}
        onSendMessage={handleSendMessage}
      />
    </>
  );
}

/**
 * The chip states what the send will actually carry. Truncation is normal
 * operation and is reported in paragraph counts, not as an error.
 *
 * Only this copy is localized — the facet arguments are model-facing prompt
 * content and never go through lingui.
 */
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
