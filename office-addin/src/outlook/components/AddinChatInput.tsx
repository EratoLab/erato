import {
  Button,
  DEFAULT_MAX_FILES_PER_MESSAGE,
  GroupedFileAttachmentsPreview,
  SpinnerIcon,
  UploadTooLargeError,
  UploadUnknownError,
  fetchUploadFile,
  formatFileSize,
  getIdToken,
  isUploadTooLarge,
  useChatInputControls,
  useChatInputFeature,
  useFileCapabilitiesContext,
  useFileUploadStore,
  useUploadFeature,
  validateFileSizes,
  type ChatInputControlsHandle,
  type ChatModel,
  type ComposerSizeLimit,
  type FileAttachmentGroup,
  type FileAttachmentGroupItem,
  type ActionFacetRequest,
  type AssistantMention,
  type DelegationRunMode,
  type FileType,
  type FileUploadItem,
} from "@erato/frontend/library";
import { plural, t } from "@lingui/core/macro";
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { AddinChatInputCore } from "../../core/AddinChatInputCore";
import { useOffice } from "../../providers/OfficeProvider";
import { useAvailableActionFacetIds } from "../hooks/useAvailableActionFacets";
import { useOutlookCalendarFetcher } from "../hooks/useOutlookCalendarFetcher";
import { useOutlookComposeSelection } from "../hooks/useOutlookComposeSelection";
import { useOutlookEmailSource } from "../providers/OutlookEmailSourceProvider";
import {
  NO_ITEM_SEND_IDENTITY,
  readAppointmentComposeSnapshot,
  useOutlookMailItem,
} from "../providers/OutlookMailItemProvider";
import {
  isAppointmentCompose as isAppointmentComposeItem,
  resolveSupportedMailboxItem,
} from "../sessionPolicy";
import { resolveOutlookActionFacet } from "../utils/outlookActionFacet";
import { OUTLOOK_REPLY_FROM_READ_FACET_ID } from "../utils/outlookClientActions";
import {
  getComposeBodyType,
  type BodyFormat,
} from "../utils/outlookComposeWrite";
import {
  OUTLOOK_SCHEDULE_FACET_ID,
  isSchedulingThreadFresh,
  toLocalOffsetIso,
} from "../utils/outlookScheduleTool";
import { restoreComposerDraft } from "../utils/restoreComposerDraft";
import { findStagedSendLimit } from "../utils/stagedSendLimit";
import { EmailTrimError } from "../utils/trimRawEmlBytes";
import {
  isPolicyExcluded,
  validateStagedPart,
  type StagedPartValidation,
} from "../utils/validateStagedPart";

import type { DropPipelineState } from "../hooks/useDropPipeline";

/** Verdicts keyed like the dismissals: thread message id or drop key, then attachment id. */
type StagedPartVerdicts = ReadonlyMap<
  string,
  ReadonlyMap<string, StagedPartValidation>
>;

interface AddinChatInputProps {
  onSendMessage: (
    message: string,
    inputFileIds?: string[],
    modelId?: string,
    selectedFacetIds?: string[],
    actionFacet?: ActionFacetRequest,
    /**
     * Identity of the Outlook item open at the moment the user pressed send
     * — the wrong-item guard's baseline for the resulting completion. `null`
     * when no item identity was available; the owner then fails closed
     * (the completion's artifact is treated as stale, never unguarded).
     */
    sendItemIdentity?: string | null,
    mentionedAssistants?: AssistantMention[],
    delegationRunMode?: DelegationRunMode,
  ) => void;
  handleFileAttachments?: (files: FileUploadItem[]) => void;
  isLoading?: boolean;
  disabled?: boolean;
  className?: string;
  acceptedFileTypes?: FileType[];
  onFilePreview?: (file: FileUploadItem) => void;
  chatId?: string | null;
  assistantId?: string;
  initialModel?: ChatModel | null;
  initialSelectedFacetIds?: string[];
  onFacetSelectionChange?: (selectedFacetIds: string[]) => void;
  showSuggestedEmailSource?: boolean;
  /**
   * Called with the dropped emails a send attached, and with a single drop
   * when the user removes it from its card. The owner clears the drop from
   * BOTH the provider drop-state and the AddinChat-owned dedup set (the two
   * live in different layers, so neither can release the other alone). A
   * failed upload sends nothing, so the chips stay for a retry.
   */
  onEmailSourceDropsSent?: (
    drops: { key: string; messageId: string | null }[],
  ) => void;
  uploadFiles?: (files: File[]) => Promise<FileUploadItem[] | undefined>;
  uploadError?: Error | string | null;
  /** Overrides the limit check this component derives from its staged parts. */
  sizeLimitExceeded?: ComposerSizeLimit | null;
  /**
   * `true` while one or more dropped emails are being expanded or
   * deduplicated. Gates the send button and renders a non-blocking inline
   * indicator so the user knows attachments are still materializing.
   */
  isExpandingDroppedEmails?: boolean;
  /** Which step the dropped items are in; refines the indicator's copy. */
  dropPipeline?: DropPipelineState;
  /**
   * Forwarded to `ChatInput.virtualFiles`. The add-in passes its previewed
   * email body here so the token estimate covers it without polluting
   * `attachedFilesState`. Pass a memoized array.
   */
  virtualFiles?: File[];
  /**
   * Forwarded to `ChatInput.maxFiles`. The add-in lifts the cap above the
   * web default (5) because Outlook drops expand one email into body + N
   * attachments — a single multi-attachment email saturates 5 quickly.
   */
  maxFiles?: number;
  controlledAvailableModels?: ChatModel[];
  controlledSelectedModel?: ChatModel | null;
  onControlledSelectedModelChange?: (model: ChatModel) => void;
  controlledIsModelSelectionReady?: boolean;
  /**
   * `createdAt` of the NEWEST assistant message that read the calendar via
   * the `fetch_availability` client tool or emitted an `erato-appointment`
   * fence, else null (computed in `AddinChat`, which owns the message
   * stream). Deliberately not latest-message-only — prose negotiation turns
   * in between (clarifications, subject/location gathering) must not drop
   * the facet. When fresh at send time, the send carries the
   * `outlook_schedule` facet so the model can handle the user's slot pick.
   */
  lastSchedulingSignalAt?: string | null;
}

function dropPipelineLabel(pipeline: DropPipelineState | undefined): string {
  const index = pipeline?.done ?? 0;
  const total = pipeline?.total ?? 0;
  switch (pipeline?.phase) {
    case "receiving": {
      const count = total;
      return t({
        id: "officeAddin.chatInput.dropPipeline.receiving",
        message: plural(count, {
          one: "Receiving # email…",
          other: "Receiving # emails…",
        }),
      });
    }
    case "reading":
      return t({
        id: "officeAddin.chatInput.dropPipeline.reading",
        message: `Reading email ${index} of ${total}…`,
      });
    case "resolving":
      return t({
        id: "officeAddin.chatInput.dropPipeline.resolving",
        message: `Finding ${index} of ${total} in your mailbox…`,
      });
    case "staging":
      return t({
        id: "officeAddin.chatInput.dropPipeline.staging",
        message: "Adding to the chat…",
      });
    default:
      return t({
        id: "officeAddin.chatInput.expandingDroppedEmails",
        message: "Processing dropped emails…",
      });
  }
}

export const AddinChatInput = forwardRef<
  ChatInputControlsHandle,
  AddinChatInputProps
>(function AddinChatInput(
  {
    chatId,
    className,
    showSuggestedEmailSource = false,
    isExpandingDroppedEmails = false,
    dropPipeline,
    onEmailSourceDropsSent,
    lastSchedulingSignalAt = null,
    handleFileAttachments: ownerHandleFileAttachments,
    sizeLimitExceeded: ownerSizeLimitExceeded = null,
    uploadError: ownerUploadError = null,
    ...chatInputProps
  },
  ref,
) {
  const { host } = useOffice();
  const availableFacetIds = useAvailableActionFacetIds();
  const composeEmailAvailable = availableFacetIds.has("compose_email");
  const appointmentRewriteAvailable = availableFacetIds.has(
    "outlook_rewrite_appointment_selection",
  );
  const appointmentContextAvailable = availableFacetIds.has(
    "outlook_review_appointment",
  );
  const replyFromReadAvailable = availableFacetIds.has(
    OUTLOOK_REPLY_FROM_READ_FACET_ID,
  );
  const scheduleFacetAvailable = availableFacetIds.has(
    OUTLOOK_SCHEDULE_FACET_ID,
  );
  const { fetcher: calendarFetcher } = useOutlookCalendarFetcher();
  const [isUploadingEmail, setIsUploadingEmail] = useState(false);
  const composeSelection = useOutlookComposeSelection();
  const { mailItem, itemIdentity } = useOutlookMailItem();
  const isAppointmentCompose = mailItem?.itemKind === "appointment";
  const [isSelectionDismissed, setIsSelectionDismissed] = useState(false);
  // Appointment facets are config-defined (subscription content, not
  // builtins): when the backend doesn't advertise them, the resolver would
  // drop the facet — so the selection/draft context must not count as
  // included, or the chips would promise context the send doesn't carry.
  const hasActiveSelection =
    composeSelection.data.length > 0 &&
    !isSelectionDismissed &&
    (!isAppointmentCompose || appointmentRewriteAvailable);

  // Draft-as-context (#1): a non-empty compose body is eligible to ride along
  // as `outlook_review_draft`, but the user can switch it off via the draft
  // chip. Default on; reset to on when the Outlook item changes (a new draft).
  const draftBodyText = mailItem?.bodyText ?? mailItem?.bodyHtml ?? "";
  const [isDraftDismissed, setIsDraftDismissed] = useState(false);
  const lastDraftItemIdentityRef = useRef(itemIdentity);
  if (itemIdentity !== lastDraftItemIdentityRef.current) {
    lastDraftItemIdentityRef.current = itemIdentity;
    setIsDraftDismissed(false);
    // A dismissal must not outlive the item it suppressed (ERMAIN-431).
    setIsSelectionDismissed(false);
  }
  const isDraftContextIncluded =
    !!mailItem?.isComposeMode &&
    (draftBodyText.length > 0 || isAppointmentCompose) &&
    !isDraftDismissed &&
    (!isAppointmentCompose || appointmentContextAvailable);
  // Show the draft chip only when it's actually what we'd send: a live
  // selection takes priority (rewrite wins over review), so hide it then.
  const hasDraftContextChip =
    host === "Outlook" && isDraftContextIncluded && !hasActiveSelection;

  // Draft de-dup marker (#4): the fingerprint of the draft context we last
  // sent in this chat (raw body for message drafts, metadata fingerprint for
  // appointments). Client-side by design — the backend is action-facet
  // toggle-stateless. Reset when the chat changes so a fresh chat re-sends
  // the draft.
  const lastSentDraftFingerprintRef = useRef<string | null>(null);
  const lastDraftChatIdRef = useRef(chatId);
  if (chatId !== lastDraftChatIdRef.current) {
    // Reset the dedup marker when the chat genuinely changes — but NOT when a
    // brand-new chat just received its id on first send (null → id is the same
    // conversation continuing). Otherwise the second message would needlessly
    // re-send the unchanged draft.
    const isNewChatGettingItsId =
      lastDraftChatIdRef.current == null && chatId != null;
    lastDraftChatIdRef.current = chatId;
    if (!isNewChatGettingItsId) {
      lastSentDraftFingerprintRef.current = null;
    }
  }

  // Reset dismiss when the selection changes (user selects new text). The ref
  // tracks the previous render's value UNCONDITIONALLY: updating it only
  // inside the reset branch made a dismiss permanent for a same-text
  // re-selection (dismiss → deselect → select the same passage again read as
  // "unchanged" because the ref still held that passage; ERMAIN-431). A
  // deselect-then-reselect gesture now always passes through "" and re-arms.
  const lastSelectionDataRef = useRef(composeSelection.data);
  const previousSelectionData = lastSelectionDataRef.current;
  lastSelectionDataRef.current = composeSelection.data;
  if (
    composeSelection.data !== previousSelectionData &&
    composeSelection.data.length > 0
  ) {
    setIsSelectionDismissed(false);
  }
  const {
    hasSelectedEmailSource,
    isEmailBodyIncluded,
    emailBodyFile,
    emailSubject,
    isLoadingEmailBody,
    emailThreadLoadError,
    selectedAttachmentItems,
    isLoadingAttachments,
    removeEmailBody,
    removeAttachment,
    resolveSelectedFilesForSend,
    parentReplyContext,
    isLoadingParentReplyContext,
    stagedEmails,
    dismissStagedEmailAttachment,
    restoreStagedEmailAttachment,
    dismissStagedEmailBody,
    restoreStagedEmailBody,
    setPolicyExcludedAttachmentIds,
    isThreadEmlStale,
    isDropResolutionStale,
    resolvedDrops,
    resolvedParts,
    resolvedTotalBytes,
  } = useOutlookEmailSource();
  const { maxSizeBytes: globalMaxSizeBytes, maxSizeFormatted } =
    useUploadFeature();
  const { maxFiles: maxFilesPerMessage } = useChatInputFeature();
  const { capabilities, isLoading: isLoadingCapabilities } =
    useFileCapabilitiesContext();
  // A declined send's error and the drops staged at that moment. The composer
  // hides the banner on dismiss but only a new Error instance re-shows it, so
  // each failure mints its own; it clears on the next send attempt and when
  // one of those drops is removed.
  const [sendFailure, setSendFailure] = useState<{
    error: Error;
    dropKeys: string[];
  } | null>(null);
  useEffect(() => {
    if (!sendFailure) return;
    const stagedKeys = new Set(stagedEmails.map((staged) => staged.key));
    if (sendFailure.dropKeys.some((key) => !stagedKeys.has(key))) {
      setSendFailure(null);
    }
  }, [sendFailure, stagedEmails]);
  // The composer clears itself on handoff, before this handler can size-check;
  // a declined send has to put the draft back.
  const chatInputControls = useChatInputControls();
  const restoreDraft = useCallback(
    (message: string, inputFileIds?: string[]) =>
      restoreComposerDraft(
        chatInputControls,
        useFileUploadStore.getState().uploadedFiles,
        message,
        inputFileIds,
      ),
    [chatInputControls],
  );
  // Drop-staged emails are always user-driven, so they bypass the
  // `showSuggestedEmailSource` gate (which is for the auto-suggest of the
  // currently-open email when the chat is still fresh). Without this the
  // preview region stays hidden after a drop into a chat that already has
  // messages.
  const hasDroppedStagedEmails = stagedEmails.some(
    (staged) => staged.source === "drop",
  );
  const shouldUseSuggestedEmailSource =
    (showSuggestedEmailSource && hasSelectedEmailSource) ||
    hasDroppedStagedEmails;
  const isWaitingForSuggestedEmail =
    showSuggestedEmailSource &&
    !hasDroppedStagedEmails &&
    isLoadingEmailBody &&
    !emailThreadLoadError;
  // Render the email-source preview whenever there is *something* to show:
  // a real attachment, an in-flight attachment fetch, or the reply-context
  // chip (resolved or still loading). Without this gate the preview region
  // would render an empty card whenever the host is Outlook in compose
  // mode but Graph hasn't yet returned a parent message.
  const shouldShowEmailSourcePreview =
    host === "Outlook" &&
    (hasDroppedStagedEmails ||
      (showSuggestedEmailSource &&
        (hasSelectedEmailSource ||
          isLoadingEmailBody ||
          emailThreadLoadError ||
          isLoadingAttachments ||
          parentReplyContext !== null ||
          isLoadingParentReplyContext)));
  // One verdict per rendered attachment row, shared by the rows and the
  // exclusions handed to the provider so the two can never disagree.
  const stagedPartVerdicts = useMemo<StagedPartVerdicts>(() => {
    const limits = {
      maxBytes: globalMaxSizeBytes,
      maxFormatted: maxSizeFormatted,
    };
    const typePolicy = { capabilities, isLoading: isLoadingCapabilities };
    const verdicts = new Map<string, Map<string, StagedPartValidation>>();
    for (const staged of stagedEmails) {
      if (staged.source === "current-thread") {
        for (const message of staged.thread.messages) {
          const perMessage = new Map<string, StagedPartValidation>();
          for (const attachment of message.attachments) {
            if (attachment.isInline) continue;
            perMessage.set(
              attachment.id,
              validateStagedPart(attachment, limits, typePolicy),
            );
          }
          verdicts.set(message.id, perMessage);
        }
        continue;
      }
      const perDrop = new Map<string, StagedPartValidation>();
      for (const attachment of staged.parsed.attachments) {
        if (attachment.disposition === "inline" || attachment.related) continue;
        perDrop.set(
          attachment.id,
          validateStagedPart(attachment, limits, typePolicy),
        );
      }
      verdicts.set(staged.key, perDrop);
    }
    return verdicts;
  }, [
    capabilities,
    globalMaxSizeBytes,
    isLoadingCapabilities,
    maxSizeFormatted,
    stagedEmails,
  ]);

  useEffect(() => {
    for (const [key, perKey] of stagedPartVerdicts) {
      const excluded: string[] = [];
      for (const [attachmentId, verdict] of perKey) {
        if (isPolicyExcluded(verdict)) excluded.push(attachmentId);
      }
      setPolicyExcludedAttachmentIds(key, excluded);
    }
  }, [setPolicyExcludedAttachmentIds, stagedPartVerdicts]);

  // The composer's own attachments, mirrored here so the limit check can
  // count them next to the staged emails it will upload alongside.
  const [composerFiles, setComposerFiles] = useState<FileUploadItem[]>([]);
  const handleFileAttachments = useCallback(
    (files: FileUploadItem[]) => {
      ownerHandleFileAttachments?.(files);
      // The composer reports from inside a state updater.
      void Promise.resolve().then(() => setComposerFiles(files));
    },
    [ownerHandleFileAttachments],
  );
  // The server caps a message at its own per-message count, whatever the
  // composer was told.
  const maxFiles = Math.min(
    chatInputProps.maxFiles ?? DEFAULT_MAX_FILES_PER_MESSAGE,
    maxFilesPerMessage,
  );
  const stagedLimitExceeded = useMemo<ComposerSizeLimit | null>(
    () =>
      findStagedSendLimit(
        // The send only uploads the staged emails on this path.
        shouldUseSuggestedEmailSource ? resolvedParts : [],
        composerFiles,
        {
          maxBytes: globalMaxSizeBytes,
          maxFormatted: maxSizeFormatted,
          maxFiles,
        },
      ),
    [
      composerFiles,
      globalMaxSizeBytes,
      maxFiles,
      maxSizeFormatted,
      resolvedParts,
      shouldUseSuggestedEmailSource,
    ],
  );
  const sizeLimitExceeded = ownerSizeLimitExceeded ?? stagedLimitExceeded;

  const emailSourceGroups = useMemo<FileAttachmentGroup[]>(() => {
    const groups: FileAttachmentGroup[] = [];
    const updatingLabel = t({
      id: "officeAddin.fileSource.updatingThread",
      message: "Updating…",
    });
    // What the send would upload right now, against the upload limit.
    const used = formatFileSize(resolvedTotalBytes);
    const limit = maxSizeFormatted;
    const usedOfLimitLabel =
      isThreadEmlStale || isDropResolutionStale
        ? updatingLabel
        : t({
            id: "officeAddin.chatInput.stagedSize",
            message: `${used} of ${limit}`,
          });

    if (
      showSuggestedEmailSource &&
      !hasDroppedStagedEmails &&
      stagedEmails.every((staged) => staged.source !== "current-thread") &&
      (isLoadingEmailBody || emailThreadLoadError)
    ) {
      groups.push({
        id: "current-email-thread-status",
        label:
          emailSubject ||
          t({
            id: "officeAddin.chatInput.emailFallback",
            message: "Email",
          }),
        metaLabel: "",
        items: isLoadingEmailBody
          ? [
              {
                kind: "loading",
                id: "current-email-thread-loading",
                label: t({
                  id: "officeAddin.chatInput.loadingEmailThread",
                  message: "Loading email thread...",
                }),
                description: t({
                  id: "officeAddin.chatInput.loadingEmailThreadDescription",
                  message: "Preparing the email context",
                }),
              },
            ]
          : [
              {
                kind: "status",
                id: "current-email-thread-error",
                tone: "error",
                label: t({
                  id: "officeAddin.chatInput.emailThreadLoadError",
                  message: "Couldn't load the email thread",
                }),
                description: t({
                  id: "officeAddin.chatInput.emailThreadLoadErrorDescription",
                  message: "You can still send without this email context.",
                }),
              },
            ],
      });
    }

    // Reply-context chip (compose mode) — read-only, not threaded into
    // `resolveSelectedFilesForSend` (the parent body reaches the LLM via
    // the `outlook_review_draft.full_body` action facet).
    if (parentReplyContext || isLoadingParentReplyContext) {
      const items: FileAttachmentGroupItem[] = [];
      if (parentReplyContext) {
        const senderLabel =
          parentReplyContext.fromName?.trim() ||
          parentReplyContext.fromAddress?.trim() ||
          "";
        const subjectLabel =
          parentReplyContext.subject.trim() ||
          t({
            id: "officeAddin.chatInput.replyContext.untitled",
            message: "(no subject)",
          });
        items.push({
          kind: "context",
          id: "reply-context",
          file: {
            id: "reply-context",
            filename: subjectLabel,
            displayName: senderLabel
              ? `${subjectLabel} — ${senderLabel}`
              : subjectLabel,
          },
          labelOverride: t({
            id: "officeAddin.chatInput.replyContext.label",
            message: "Reply context",
          }),
        });
      } else {
        items.push({ kind: "loading", id: "reply-context-loading" });
      }
      groups.push({
        id: "reply-context",
        label: t({
          id: "officeAddin.chatInput.replyContext.groupLabel",
          message: "Reply context",
        }),
        metaLabel: "",
        items,
      });
    }

    // Staged emails: the currently-open Outlook conversation renders as one
    // card with each thread message nested inside (threadMessageGroup items);
    // drag-dropped .eml files render as flat cards (one per drop).
    for (const staged of stagedEmails) {
      if (staged.source === "current-thread") {
        const messageCount = staged.thread.messages.length;
        const items: FileAttachmentGroupItem[] = staged.thread.messages.map(
          (message) => {
            const senderLabel =
              message.from?.name?.trim() ||
              message.from?.address?.trim() ||
              t({
                id: "officeAddin.chatInput.unknownSender",
                message: "Unknown sender",
              });
            const dateLabel = message.date
              ? new Date(message.date).toLocaleString()
              : "";
            const sublabel = [dateLabel, message.subject]
              .filter((part) => part.trim().length > 0)
              .join(" · ");

            const attachmentItems = message.attachments
              .filter((attachment) => !attachment.isInline)
              .map((attachment) => {
                const dismissed = staged.dismissedAttachmentIds.has(
                  attachment.id,
                );
                const validation = stagedPartVerdicts
                  .get(message.id)
                  ?.get(attachment.id);
                const excluded = !!validation && isPolicyExcluded(validation);
                return {
                  id: attachment.id,
                  file: {
                    id: attachment.id,
                    filename: attachment.filename,
                    size: attachment.size,
                  },
                  selected: !dismissed,
                  onToggle: excluded
                    ? undefined
                    : () => {
                        if (dismissed) {
                          restoreStagedEmailAttachment(
                            message.id,
                            attachment.id,
                          );
                        } else {
                          dismissStagedEmailAttachment(
                            message.id,
                            attachment.id,
                          );
                        }
                      },
                  validation,
                };
              });

            const messageDismissed = staged.dismissedMessageIds.has(message.id);
            return {
              kind: "threadMessageGroup" as const,
              id: message.id,
              label: senderLabel,
              sublabel,
              selected: !messageDismissed,
              onToggle: () => {
                if (messageDismissed) {
                  restoreStagedEmailBody(message.id);
                } else {
                  dismissStagedEmailBody(message.id);
                }
              },
              defaultCollapsed: true,
              attachments: attachmentItems,
            };
          },
        );

        groups.push({
          id: `staged-email:${staged.key}`,
          label:
            staged.thread.subject ||
            emailSubject ||
            t({
              id: "officeAddin.chatInput.emailFallback",
              message: "Email",
            }),
          metaLabel: `${
            messageCount === 1 ? t`1 message` : t`${messageCount} messages`
          } · ${usedOfLimitLabel}`,
          items,
          collapsible: true,
          defaultCollapsed: true,
        });
        continue;
      }

      // source === "drop" — one .eml dragged onto the chat, flat layout.
      const items: FileAttachmentGroupItem[] = [];
      // The trimmed file is what gets sent, so its size is the one to show;
      // a dismissed or failed drop has none and falls back to the original.
      const resolvedDrop = resolvedDrops.find(
        (drop) => drop.key === staged.key,
      );
      items.push({
        kind: "selectableAttachment",
        id: `${staged.key}:body`,
        file: {
          id: `${staged.key}:body`,
          filename: staged.parsed.rawEmlFile.name,
          displayName: t({
            id: "officeAddin.chatInput.emailBody",
            message: "Email body",
          }),
          size: resolvedDrop?.file?.size ?? staged.parsed.rawEmlFile.size,
        },
        metaLabel: isDropResolutionStale ? updatingLabel : undefined,
        selected: !staged.bodyDismissed,
        onToggle: () => {
          if (staged.bodyDismissed) {
            restoreStagedEmailBody(staged.key);
          } else {
            dismissStagedEmailBody(staged.key);
          }
        },
        labelOverride: t({
          id: "officeAddin.chatInput.emailLabel",
          message: "Email",
        }),
      });

      for (const attachment of staged.parsed.attachments) {
        if (attachment.disposition === "inline" || attachment.related) {
          // Part of the body rather than attached to it: always sent, so the
          // row is read-only and counts toward the size like any other.
          items.push({
            kind: "selectableAttachment",
            id: `${staged.key}:${attachment.id}`,
            file: {
              id: `${staged.key}:${attachment.id}`,
              filename: attachment.filename,
              size: attachment.size,
            },
            selected: true,
          });
          continue;
        }
        const isDismissed = staged.dismissedAttachmentIds.has(attachment.id);
        const validation = stagedPartVerdicts
          .get(staged.key)
          ?.get(attachment.id);
        const excluded = !!validation && isPolicyExcluded(validation);
        items.push({
          kind: "selectableAttachment",
          id: `${staged.key}:${attachment.id}`,
          file: {
            id: `${staged.key}:${attachment.id}`,
            filename: attachment.filename,
            size: attachment.size,
          },
          selected: !isDismissed,
          onToggle: excluded
            ? undefined
            : () => {
                if (isDismissed) {
                  restoreStagedEmailAttachment(staged.key, attachment.id);
                } else {
                  dismissStagedEmailAttachment(staged.key, attachment.id);
                }
              },
          validation,
        });
      }

      const fromLabel = staged.parsed.from
        ? staged.parsed.from.name || staged.parsed.from.address
        : "";
      const dateLabel = staged.parsed.date
        ? new Date(staged.parsed.date).toLocaleDateString()
        : "";
      const metaParts = [fromLabel, dateLabel].filter(
        (part) => part.length > 0,
      );

      groups.push({
        id: `staged-email:${staged.key}`,
        label:
          staged.parsed.subject ||
          emailSubject ||
          t({
            id: "officeAddin.chatInput.emailFallback",
            message: "Email",
          }),
        metaLabel: metaParts.join(" • "),
        items,
        collapsible: true,
        defaultCollapsed: true,
      });
    }

    // Office.js compose-mode attachments fallback. These are only relevant
    // when no `.eml` is staged (compose mode); in read mode they would be
    // redundant copies of the in-eml attachments shown in the staged group.
    if (stagedEmails.length === 0) {
      const items: FileAttachmentGroupItem[] = [];

      if (isEmailBodyIncluded && emailBodyFile) {
        items.push({
          kind: "attachment",
          id: "email-body",
          file: {
            id: "email-body",
            filename: emailBodyFile.name,
            displayName: "Email thread",
            size: emailBodyFile.size,
          },
          labelOverride: t({
            id: "officeAddin.chatInput.emailLabel",
            message: "Email",
          }),
        });
      }

      for (const attachmentItem of selectedAttachmentItems) {
        items.push({
          kind: "attachment",
          id: attachmentItem.id,
          file: attachmentItem,
        });
      }

      if (isLoadingAttachments) {
        items.push({ kind: "loading", id: "attachments-loading" });
      }

      if (items.length > 0) {
        groups.push({
          id: "current-email-fallback",
          label:
            emailSubject ||
            t({
              id: "officeAddin.chatInput.emailFallback",
              message: "Email",
            }),
          metaLabel: "",
          items,
        });
      }
    }

    return groups;
  }, [
    dismissStagedEmailAttachment,
    dismissStagedEmailBody,
    emailBodyFile,
    emailThreadLoadError,
    emailSubject,
    hasDroppedStagedEmails,
    isDropResolutionStale,
    isEmailBodyIncluded,
    isLoadingAttachments,
    isLoadingEmailBody,
    isLoadingParentReplyContext,
    isThreadEmlStale,
    maxSizeFormatted,
    parentReplyContext,
    resolvedDrops,
    resolvedTotalBytes,
    restoreStagedEmailAttachment,
    restoreStagedEmailBody,
    selectedAttachmentItems,
    showSuggestedEmailSource,
    stagedEmails,
    stagedPartVerdicts,
  ]);

  // A dropped email leaves through the same door a sent one does, so the
  // owner releases its dedup claim too. The card shows it only when expanded.
  const emailSourceGroupActions = useMemo(() => {
    const actions: Partial<Record<string, ReactNode>> = {};
    for (const staged of stagedEmails) {
      if (staged.source !== "drop") continue;
      const drop = {
        key: staged.key,
        messageId: staged.parsed.messageId ?? null,
      };
      actions[`staged-email:${staged.key}`] = (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start px-0 text-xs"
          disabled={isUploadingEmail}
          onClick={() => onEmailSourceDropsSent?.([drop])}
          data-testid={`addin-staged-email-remove-${staged.key}`}
        >
          {t({
            id: "officeAddin.chatInput.removeDroppedEmail",
            message: "Remove",
          })}
        </Button>
      );
    }
    return actions;
  }, [isUploadingEmail, onEmailSourceDropsSent, stagedEmails]);

  const handleRemoveEmailSourceFile = useCallback(
    (fileId: string) => {
      if (fileId === "email-body") {
        removeEmailBody();
        return;
      }

      removeAttachment(fileId);
    },
    [removeAttachment, removeEmailBody],
  );

  const wrappedOnSendMessage = useCallback(
    async (
      message: string,
      inputFileIds?: string[],
      modelId?: string,
      selectedFacetIds?: string[],
      mentionedAssistants?: AssistantMention[],
      delegationRunMode?: DelegationRunMode,
    ) => {
      // Capture the item identity BEFORE any await: the uploads below can
      // take long enough for the user to switch emails, and the wrong-item
      // guard must be anchored to the item the user actually sent from. A
      // send with NO item open records the no-item sentinel — a real value,
      // so neutral-context completions still count as fresh (item-independent
      // actions like create-appointment can auto-prompt) while item-bound
      // executors treat it as a mismatch and fail closed.
      const sendItemIdentity = itemIdentity ?? NO_ITEM_SEND_IDENTITY;
      setSendFailure(null);

      // Appointment fields are re-read from the LIVE item at send time:
      // editing an appointment form fires no ItemChanged, so the provider's
      // bind-time state is frozen at pane-open and would ship a stale (often
      // empty) snapshot — and poison the de-dup fingerprint with it. Reads
      // are bounded and fall back per-field to the provider state, so a
      // wedged host degrades to the old behavior instead of losing the send.
      const liveItem = resolveSupportedMailboxItem(Office.context.mailbox.item);
      const appointmentSnapshot =
        isAppointmentCompose && liveItem && isAppointmentComposeItem(liveItem)
          ? await readAppointmentComposeSnapshot(liveItem, {
              subject: mailItem?.subject ?? "",
              organizer: mailItem?.organizer ?? null,
              requiredAttendees: mailItem?.requiredAttendees ?? [],
              optionalAttendees: mailItem?.optionalAttendees ?? [],
              location: mailItem?.location ?? "",
              start: mailItem?.start ?? null,
              end: mailItem?.end ?? null,
              bodyText: mailItem?.bodyText ?? null,
              bodyHtml: mailItem?.bodyHtml ?? null,
            })
          : null;

      // Build the action facet (selection rewrite vs. draft review) via a pure
      // resolver so the selection-priority and draft de-dup rules stay testable.
      //
      // `outlook_review_draft` only ever carries the user's OWN draft: compose
      // mode is required (`isDraftContextIncluded`), so a read-mode email body
      // can never leak in. The body is sent as plain text — Outlook compose
      // HTML is bloated with MS tags, inline styles, and base64 images that add
      // no value to a writing-review prompt and blow the backend's per-arg size
      // cap; text coercion still preserves quoted history (`>` lines), bullet
      // lists, and link URLs, so the model keeps the full conversation context.
      let bodyFormat: BodyFormat | undefined;
      if (mailItem?.isComposeMode) {
        try {
          bodyFormat = await getComposeBodyType();
        } catch {
          // The live item can race away from compose (pinned pane, the user
          // clicked a received email mid-send). The message must still go
          // out — just without a compose body format.
          bodyFormat = undefined;
        }
      }
      const draftBody = appointmentSnapshot
        ? (appointmentSnapshot.bodyText ?? appointmentSnapshot.bodyHtml ?? "")
        : draftBodyText;
      const draftContextFingerprint = appointmentSnapshot
        ? JSON.stringify({
            subject: appointmentSnapshot.subject,
            body: draftBody,
            requiredAttendees: appointmentSnapshot.requiredAttendees,
            optionalAttendees: appointmentSnapshot.optionalAttendees,
            location: appointmentSnapshot.location,
            start: appointmentSnapshot.start?.toISOString() ?? "",
            end: appointmentSnapshot.end?.toISOString() ?? "",
          })
        : undefined;
      const formatAttendees = (
        attendees: { displayName: string; emailAddress: string }[] | undefined,
      ) =>
        attendees
          ?.map((attendee) => attendee.emailAddress || attendee.displayName)
          .join(", ");
      const { facet: actionFacet, sentDraftFingerprint } =
        resolveOutlookActionFacet({
          itemKind: mailItem?.itemKind ?? null,
          hasActiveSelection,
          selectionData: composeSelection.data,
          selectionSource: composeSelection.sourceProperty,
          draftContextIncluded: isDraftContextIncluded,
          draftBody,
          lastSentDraftFingerprint: lastSentDraftFingerprintRef.current,
          draftContextFingerprint,
          bodyFormat,
          isComposeMode: !!mailItem?.isComposeMode,
          composeEmailAvailable,
          appointmentRewriteAvailable,
          appointmentContextAvailable,
          appointmentSubject: appointmentSnapshot?.subject,
          appointmentRequiredAttendees: formatAttendees(
            appointmentSnapshot?.requiredAttendees,
          ),
          appointmentOptionalAttendees: formatAttendees(
            appointmentSnapshot?.optionalAttendees,
          ),
          appointmentLocation: appointmentSnapshot?.location,
          // Local wall time with offset — the template tells the model these
          // are the user's local times; raw UTC would misreport the meeting
          // time for every non-UTC user.
          appointmentStart: appointmentSnapshot?.start
            ? toLocalOffsetIso(appointmentSnapshot.start.toISOString())
            : undefined,
          appointmentEnd: appointmentSnapshot?.end
            ? toLocalOffsetIso(appointmentSnapshot.end.toISOString())
            : undefined,
          isReadMode:
            !!mailItem &&
            mailItem.itemKind === "message" &&
            !mailItem.isComposeMode,
          replyFromReadAvailable,
          scheduleFacetAvailable,
          calendarAvailable: calendarFetcher !== null,
          schedulingThreadActive: isSchedulingThreadFresh(
            lastSchedulingSignalAt,
            Date.now(),
          ),
          nowIso: toLocalOffsetIso(new Date().toISOString()),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
      // Rolled back on a declined send: the marker means "already sent".
      const previousDraftFingerprint = lastSentDraftFingerprintRef.current;
      if (sentDraftFingerprint !== null) {
        // Remember what we sent so an unchanged follow-up de-dupes (#4).
        lastSentDraftFingerprintRef.current = sentDraftFingerprint;
      }

      // Snapshot the dropped emails staged for this send. They are cleared only
      // once we know their files were actually attached (the awaited upload
      // succeeded) — the chat-message dispatch itself is fire-and-forget, so the
      // upload is the meaningful "were these attached?" boundary. Clearing
      // releases both the provider drop-state and the dedup claim via the owner.
      const sentDrops = stagedEmails.flatMap((staged) =>
        staged.source === "drop"
          ? [{ key: staged.key, messageId: staged.parsed.messageId ?? null }]
          : [],
      );
      const clearSentDrops = () => {
        if (sentDrops.length > 0) {
          onEmailSourceDropsSent?.(sentDrops);
        }
      };

      if (!shouldUseSuggestedEmailSource) {
        chatInputProps.onSendMessage(
          message,
          inputFileIds,
          modelId,
          selectedFacetIds,
          actionFacet,
          sendItemIdentity,
          mentionedAssistants,
          delegationRunMode,
        );
        return;
      }

      setIsUploadingEmail(true);
      // Every refused send ends the same way: nothing is dispatched, the
      // draft comes back, and the dedup marker forgets the draft it never sent.
      const declineSend = (error: Error) => {
        setSendFailure({ error, dropKeys: sentDrops.map((drop) => drop.key) });
        lastSentDraftFingerprintRef.current = previousDraftFingerprint;
        restoreDraft(message, inputFileIds);
      };
      let resolvedFileIds: string[] = [];
      // Outside the try so the catch can name the files.
      let attemptedFileNames: string[] = [];

      try {
        const filesToUpload = await resolveSelectedFilesForSend();
        if (filesToUpload.length === 0) {
          // No files resolved (e.g. only dismissed drops remain), but the
          // action facet must still ride along: the dedup marker was already
          // advanced above, so omitting the facet here would send without it
          // AND then suppress the same unchanged draft on the next send.
          chatInputProps.onSendMessage(
            message,
            inputFileIds,
            modelId,
            selectedFacetIds,
            actionFacet,
            sendItemIdentity,
            mentionedAssistants,
            delegationRunMode,
          );
          // No upload was attempted (e.g. only dismissed drops remain) and
          // nothing failed, so the staged drops are safe to clear.
          clearSentDrops();
          return;
        }

        // The composer gate normally refuses this earlier; it reads the
        // resolution one deferred pass behind, so the files are checked again.
        const sizeValidation = validateFileSizes(
          filesToUpload,
          globalMaxSizeBytes,
        );
        if (!sizeValidation.valid) {
          declineSend(
            new UploadTooLargeError(
              maxSizeFormatted,
              sizeValidation.oversizedFiles.map((file) => file.name),
            ),
          );
          return;
        }

        attemptedFileNames = filesToUpload.map((file) => file.name);

        const formData = new FormData();
        filesToUpload.forEach((file) => {
          formData.append("file", file, file.name);
        });

        const idToken = getIdToken();
        const result = await fetchUploadFile({
          queryParams: chatId ? { chat_id: chatId } : {},
          body: formData as never,
          headers: {
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
        });

        resolvedFileIds = result.files.map((file) => file.id);
      } catch (error) {
        if (error instanceof EmailTrimError) {
          // The untrimmed original would ship what the user removed.
          declineSend(
            new UploadUnknownError(
              t({
                id: "officeAddin.chatInput.emailTrimFailed",
                message: `Couldn't leave out the unchecked attachments of ${error.filename}. The message was not sent.`,
              }),
            ),
          );
          return;
        }
        if (isUploadTooLarge(error)) {
          declineSend(
            new UploadTooLargeError(maxSizeFormatted, attemptedFileNames),
          );
          return;
        }
        console.warn("Failed to upload Outlook email source files:", error);
        const names = (
          attemptedFileNames.length > 0
            ? attemptedFileNames
            : resolvedParts.map((part) => part.name)
        ).join(", ");
        declineSend(
          new UploadUnknownError(
            t({
              id: "officeAddin.chatInput.uploadFailed",
              message: `Couldn't upload ${names}. The message was not sent.`,
            }),
          ),
        );
        return;
      } finally {
        setIsUploadingEmail(false);
      }

      const mergedFileIds = [...(inputFileIds ?? []), ...resolvedFileIds];
      chatInputProps.onSendMessage(
        message,
        mergedFileIds.length > 0 ? mergedFileIds : undefined,
        modelId,
        selectedFacetIds,
        actionFacet,
        sendItemIdentity,
        mentionedAssistants,
        delegationRunMode,
      );

      clearSentDrops();
    },
    [
      calendarFetcher,
      chatId,
      chatInputProps,
      composeEmailAvailable,
      appointmentContextAvailable,
      appointmentRewriteAvailable,
      composeSelection.data,
      composeSelection.sourceProperty,
      draftBodyText,
      globalMaxSizeBytes,
      hasActiveSelection,
      isAppointmentCompose,
      isDraftContextIncluded,
      itemIdentity,
      lastSchedulingSignalAt,
      mailItem,
      maxSizeFormatted,
      onEmailSourceDropsSent,
      replyFromReadAvailable,
      resolvedParts,
      resolveSelectedFilesForSend,
      restoreDraft,
      scheduleFacetAvailable,
      shouldUseSuggestedEmailSource,
      stagedEmails,
    ],
  );

  return (
    <div
      className={
        className
          ? `flex min-w-0 flex-col ${className}`
          : "flex min-w-0 flex-col"
      }
    >
      {shouldShowEmailSourcePreview && (
        <div className="mx-auto w-full max-w-[var(--theme-layout-chat-input-max-width)] overflow-hidden overscroll-none px-2 pb-1 sm:px-4">
          <div
            className="max-h-[40vh] overflow-y-auto overscroll-none pr-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus"
            role="region"
            // The attachment preview is a bounded scroll area in the task pane;
            // keyboard users need a focus target before arrow/page scrolling.
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
            aria-label={t({
              id: "officeAddin.chatInput.emailSourcePreviewRegion",
              message: "Email context preview",
            })}
          >
            <GroupedFileAttachmentsPreview
              groups={emailSourceGroups}
              groupActions={emailSourceGroupActions}
              onRemoveFile={handleRemoveEmailSourceFile}
              disabled={isUploadingEmail}
              showFileTypes={true}
              showFileSizes={true}
              defaultVisibleItems={10}
              stickyGroupHeaders={true}
            />
          </div>
        </div>
      )}

      {isExpandingDroppedEmails && (
        <div className="mx-auto w-full max-w-[var(--theme-layout-chat-input-max-width)] px-2 pb-1 sm:px-4">
          <div
            className="flex items-center gap-2 rounded-[var(--theme-radius-message)] border border-theme-border bg-theme-bg-secondary px-3 py-1.5 text-xs text-theme-fg-secondary"
            role="status"
            aria-live="polite"
            data-testid="addin-chat-email-expansion-indicator"
          >
            <SpinnerIcon size="sm" aria-hidden />
            <span className="min-w-0 truncate">
              {dropPipelineLabel(dropPipeline)}
            </span>
          </div>
        </div>
      )}

      {host === "Outlook" && hasActiveSelection && (
        <div className="mx-auto w-full max-w-[var(--theme-layout-chat-input-max-width)] px-2 pb-1 sm:px-4">
          <div className="flex items-center gap-2 rounded-[var(--theme-radius-message)] border border-theme-border bg-theme-bg-secondary px-3 py-1.5 text-xs text-theme-fg-secondary">
            <span className="shrink-0">&#x2702;</span>
            <span className="min-w-0 truncate">
              &ldquo;{composeSelection.data.slice(0, 80)}
              {composeSelection.data.length > 80 ? "..." : ""}&rdquo;
            </span>
            <button
              type="button"
              onClick={() => setIsSelectionDismissed(true)}
              className="ml-auto shrink-0 rounded-[var(--theme-radius-control)] p-0.5 hover:bg-theme-bg-tertiary"
              aria-label={t({
                id: "officeAddin.chatInput.dismissSelection",
                message: "Dismiss selection",
              })}
            >
              &#x2715;
            </button>
          </div>
        </div>
      )}

      {hasDraftContextChip && (
        <div className="mx-auto w-full max-w-[var(--theme-layout-chat-input-max-width)] px-2 pb-1 sm:px-4">
          <div className="flex items-center gap-2 rounded-[var(--theme-radius-message)] border border-theme-border bg-theme-bg-secondary px-3 py-1.5 text-xs text-theme-fg-secondary">
            <span className="shrink-0">&#x1F4DD;</span>
            <span className="min-w-0 truncate">
              {isAppointmentCompose
                ? t({
                    id: "officeAddin.chatInput.appointmentContext",
                    message: "Appointment details are included as context",
                  })
                : t({
                    id: "officeAddin.chatInput.draftContext",
                    message: "Your draft is included as context",
                  })}
            </span>
            <button
              type="button"
              onClick={() => setIsDraftDismissed(true)}
              className="ml-auto shrink-0 rounded-[var(--theme-radius-control)] p-0.5 hover:bg-theme-bg-tertiary"
              aria-label={
                isAppointmentCompose
                  ? t({
                      id: "officeAddin.chatInput.dismissAppointmentContext",
                      message: "Don't include appointment details",
                    })
                  : t({
                      id: "officeAddin.chatInput.dismissDraftContext",
                      message: "Don't include draft",
                    })
              }
            >
              &#x2715;
            </button>
          </div>
        </div>
      )}

      <AddinChatInputCore
        ref={ref}
        chatId={chatId}
        {...chatInputProps}
        handleFileAttachments={handleFileAttachments}
        sizeLimitExceeded={sizeLimitExceeded}
        uploadError={sendFailure?.error ?? ownerUploadError}
        onSendMessage={(
          message,
          inputFileIds,
          modelId,
          selectedFacetIds,
          mentionedAssistants,
          delegationRunMode,
        ) => {
          void wrappedOnSendMessage(
            message,
            inputFileIds,
            modelId,
            selectedFacetIds,
            mentionedAssistants,
            delegationRunMode,
          );
        }}
        disabled={
          isUploadingEmail ||
          isExpandingDroppedEmails ||
          isWaitingForSuggestedEmail ||
          chatInputProps.disabled
        }
      />
    </div>
  );
});
