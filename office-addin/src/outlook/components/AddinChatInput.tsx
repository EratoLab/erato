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
import {
  useAvailableActionFacetArgs,
  useAvailableActionFacetIds,
} from "../../core/clientActions/useAvailableActionFacets";
import { AddinSelectionChip } from "../../core/selection/AddinSelectionChip";
import { useSelectionDismissal } from "../../core/selection/useSelectionDismissal";
import { useOffice } from "../../providers/OfficeProvider";
import { useLiveComposeFields } from "../hooks/useLiveComposeFields";
import { useOutlookCalendarFetcher } from "../hooks/useOutlookCalendarFetcher";
import { useOutlookComposeSelection } from "../hooks/useOutlookComposeSelection";
import { useSchedulingThreadActive } from "../hooks/useSchedulingThreadActive";
import { useOutlookEmailSource } from "../providers/OutlookEmailSourceProvider";
import {
  NO_ITEM_SEND_IDENTITY,
  readAppointmentComposeSnapshot,
  useOutlookMailItem,
  type AppointmentComposeSnapshot,
} from "../providers/OutlookMailItemProvider";
import {
  isAppointmentCompose as isAppointmentComposeItem,
  isMessageRead,
  resolveSupportedMailboxItem,
} from "../sessionPolicy";
import {
  buildDropEmailGroup,
  judgeDropEmailParts,
} from "../utils/buildDropEmailGroup";
import {
  outlookAppointmentFingerprint,
  previewOutlookSend,
  resolveOutlookActionFacet,
  type OutlookSentDraft,
} from "../utils/outlookActionFacet";
import { OUTLOOK_REPLY_FROM_READ_FACET_ID } from "../utils/outlookClientActions";
import {
  readComposeRecipients,
  serializeComposeRecipients,
} from "../utils/outlookComposeRecipients";
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
  type StagedPartMetadata,
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
    mcpWriteToolsEnabled?: boolean,
    disabledMcpServerIds?: string[],
    disabledMcpTools?: string[],
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

function formatAttendees(
  attendees: { displayName: string; emailAddress: string }[] | undefined,
): string | undefined {
  return attendees
    ?.map((attendee) => attendee.emailAddress || attendee.displayName)
    .join(", ");
}

// The placeholder stays `count` so the catalog entry reads {count, plural, …}.
function threadMessageCountLabel(count: number): string {
  return t({
    id: "officeAddin.chatInput.threadMessageCount",
    message: plural(count, { one: "# message", other: "# messages" }),
  });
}

function draftRowText(
  state: "sent" | "unchanged" | "scheduling",
  isAppointment: boolean,
): string {
  if (state === "scheduling") {
    return t({
      id: "officeAddin.chatInput.draftContextScheduling",
      message: "Your draft is not sent while scheduling",
    });
  }
  if (state === "unchanged") {
    return isAppointment
      ? t({
          id: "officeAddin.chatInput.appointmentContextUnchanged",
          message: "Appointment details unchanged, not re-sent",
        })
      : t({
          id: "officeAddin.chatInput.draftContextUnchanged",
          message: "Your draft is unchanged, not re-sent",
        });
  }
  return isAppointment
    ? t({
        id: "officeAddin.chatInput.appointmentContext",
        message: "Appointment details are included as context",
      })
    : t({
        id: "officeAddin.chatInput.draftContext",
        message: "Your draft is included as context",
      });
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
  const availableFacetArgs = useAvailableActionFacetArgs();
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
  // A dismissal lasts until the selection changes or another item opens
  // (ERMAIN-431).
  const selectionDismissal = useSelectionDismissal(
    composeSelection.data
      ? `${composeSelection.sourceProperty}:${composeSelection.data}`
      : "",
    itemIdentity ?? "",
  );
  // Appointment facets are config-defined (subscription content, not
  // builtins): when the backend doesn't advertise them, the resolver would
  // drop the facet — so the selection/draft context must not count as
  // included, or the chips would promise context the send doesn't carry.
  const hasActiveSelection =
    composeSelection.data.length > 0 &&
    !selectionDismissal.dismissed &&
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
  }
  const isDraftContextIncluded =
    !!mailItem?.isComposeMode &&
    (draftBodyText.length > 0 || isAppointmentCompose) &&
    !isDraftDismissed &&
    (!isAppointmentCompose || appointmentContextAvailable);

  // Draft de-dup marker (#4): what the last send of the draft context left in
  // this chat (see `OutlookSentDraft`). Client-side by design — the backend is
  // action-facet toggle-stateless. Reset when the chat changes so a fresh
  // chat re-sends the draft. The send reads the ref; the draft row reads the
  // state, so it re-renders when the marker moves.
  const lastSentDraftRef = useRef<OutlookSentDraft | null>(null);
  const [lastSentDraft, setLastSentDraft] = useState<OutlookSentDraft | null>(
    null,
  );
  const rememberSentDraft = useCallback((next: OutlookSentDraft | null) => {
    lastSentDraftRef.current = next;
    setLastSentDraft(next);
  }, []);
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
      lastSentDraftRef.current = null;
      if (lastSentDraft !== null) setLastSentDraft(null);
    }
  }

  const schedulingThreadActive = useSchedulingThreadActive(
    lastSchedulingSignalAt,
  );
  // What the send falls back to per field when a live appointment read fails.
  const appointmentFallback = useMemo<AppointmentComposeSnapshot>(
    () => ({
      subject: mailItem?.subject ?? "",
      organizer: mailItem?.organizer ?? null,
      requiredAttendees: mailItem?.requiredAttendees ?? [],
      optionalAttendees: mailItem?.optionalAttendees ?? [],
      location: mailItem?.location ?? "",
      start: mailItem?.start ?? null,
      end: mailItem?.end ?? null,
      bodyText: mailItem?.bodyText ?? null,
      bodyHtml: mailItem?.bodyHtml ?? null,
    }),
    [mailItem],
  );
  const liveComposeFields = useLiveComposeFields({
    watch:
      host !== "Outlook" || !mailItem?.isComposeMode
        ? null
        : isAppointmentCompose
          ? "appointment"
          : availableFacetArgs.get("outlook_review_draft")?.has("recipients")
            ? "recipients"
            : null,
    itemIdentity,
    appointmentFallback,
  });
  // The appointment as render time last saw it; the send compares against it.
  const seenAppointmentFingerprint =
    isAppointmentCompose && mailItem
      ? (liveComposeFields.appointmentFingerprint ??
        outlookAppointmentFingerprint(mailItem))
      : undefined;
  // The draft row says what the send would do with the draft, from the same
  // resolver, so it never claims context the send leaves out.
  const draftPreview = previewOutlookSend({
    itemKind: mailItem?.itemKind ?? null,
    hasActiveSelection,
    selectionData: composeSelection.data,
    selectionSource: composeSelection.sourceProperty,
    draftContextIncluded: isDraftContextIncluded,
    draftBody: draftBodyText,
    draftContextFingerprint: seenAppointmentFingerprint,
    availableFacetArgs,
    isComposeMode: !!mailItem?.isComposeMode,
    composeEmailAvailable,
    appointmentRewriteAvailable,
    appointmentContextAvailable,
    isReadMode:
      !!mailItem && mailItem.itemKind === "message" && !mailItem.isComposeMode,
    replyFromReadAvailable,
    scheduleFacetAvailable,
    calendarAvailable: calendarFetcher !== null,
    schedulingThreadActive,
    lastSentDraft,
    liveRecipients: liveComposeFields.recipients,
  });
  // A live selection replaces the draft; that row stays hidden as before.
  const draftRowState =
    host === "Outlook" &&
    (draftPreview.draft === "sent" ||
      draftPreview.draft === "unchanged" ||
      draftPreview.draft === "scheduling")
      ? draftPreview.draft
      : null;
  const {
    hasSelectedEmailSource,
    emailSubject,
    isLoadingEmailBody,
    emailThreadLoadError,
    selectedAttachmentItems,
    isLoadingAttachments,
    removeAttachment,
    resolveSelectedFilesForSend,
    getFileProvenance,
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
  // A fresh owner error (a refused drop) outranks the held failure.
  useEffect(() => {
    if (ownerUploadError) setSendFailure(null);
  }, [ownerUploadError]);
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
  const { stagedPartVerdicts, policyExclusions } = useMemo<{
    stagedPartVerdicts: StagedPartVerdicts;
    policyExclusions: ReadonlyMap<string, string[]>;
  }>(() => {
    const limits = {
      maxBytes: globalMaxSizeBytes,
      maxFormatted: maxSizeFormatted,
    };
    const typePolicy = { capabilities, isLoading: isLoadingCapabilities };
    const validate = (part: StagedPartMetadata) =>
      validateStagedPart(part, limits, typePolicy);
    const verdicts = new Map<string, Map<string, StagedPartValidation>>();
    const exclusions = new Map<string, string[]>();
    for (const staged of stagedEmails) {
      if (staged.source === "current-thread") {
        for (const message of staged.thread.messages) {
          const perMessage = new Map<string, StagedPartValidation>();
          const excluded: string[] = [];
          for (const attachment of message.attachments) {
            if (attachment.isInline) continue;
            const verdict = validate(attachment);
            perMessage.set(attachment.id, verdict);
            if (isPolicyExcluded(verdict)) excluded.push(attachment.id);
          }
          verdicts.set(message.id, perMessage);
          exclusions.set(message.id, excluded);
        }
        continue;
      }
      const perDrop = judgeDropEmailParts(staged.parsed, validate);
      verdicts.set(staged.key, perDrop.verdicts);
      exclusions.set(staged.key, perDrop.excluded);
    }
    return { stagedPartVerdicts: verdicts, policyExclusions: exclusions };
  }, [
    capabilities,
    globalMaxSizeBytes,
    isLoadingCapabilities,
    maxSizeFormatted,
    stagedEmails,
  ]);

  useEffect(() => {
    for (const [key, excluded] of policyExclusions) {
      setPolicyExcludedAttachmentIds(key, excluded);
    }
  }, [policyExclusions, setPolicyExcludedAttachmentIds]);

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

            const messageDismissed = staged.dismissedMessageIds.has(message.id);
            const messageVerdicts = stagedPartVerdicts.get(message.id);
            const sendable = message.attachments.filter((attachment) => {
              if (attachment.isInline) return false;
              const verdict = messageVerdicts?.get(attachment.id);
              return !verdict || !isPolicyExcluded(verdict);
            });
            const attachmentItems = message.attachments
              .filter((attachment) => !attachment.isInline)
              .map((attachment) => {
                const dismissed = staged.dismissedAttachmentIds.has(
                  attachment.id,
                );
                const validation = messageVerdicts?.get(attachment.id);
                const excluded = !!validation && isPolicyExcluded(validation);
                return {
                  id: attachment.id,
                  file: {
                    id: attachment.id,
                    filename: attachment.filename,
                    size: attachment.size,
                  },
                  // Nothing of an unticked message is sent.
                  selected: !messageDismissed && !dismissed,
                  onToggle: excluded
                    ? undefined
                    : () => {
                        if (messageDismissed) {
                          // Bringing the message back would bring every
                          // sibling with it; only the ticked one should come.
                          for (const sibling of sendable) {
                            if (
                              sibling.id !== attachment.id &&
                              !staged.dismissedAttachmentIds.has(sibling.id)
                            ) {
                              dismissStagedEmailAttachment(
                                message.id,
                                sibling.id,
                              );
                            }
                          }
                          restoreStagedEmailBody(message.id);
                          if (dismissed) {
                            restoreStagedEmailAttachment(
                              message.id,
                              attachment.id,
                            );
                          }
                        } else if (dismissed) {
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
          metaLabel: `${threadMessageCountLabel(messageCount)} · ${usedOfLimitLabel}`,
          items,
          collapsible: true,
          defaultCollapsed: true,
        });
        continue;
      }

      // source === "drop" — one .eml dragged onto the chat.
      // The trimmed file is what gets sent, so its size is the one to show;
      // a dismissed or failed drop has none and falls back to the original.
      const resolvedDrop = resolvedDrops.find(
        (drop) => drop.key === staged.key,
      );
      groups.push({
        ...buildDropEmailGroup(staged, {
          resolvedSize: resolvedDrop?.file?.size,
          bodyMetaLabel: isDropResolutionStale ? updatingLabel : undefined,
          verdicts: stagedPartVerdicts.get(staged.key),
          fallbackSubject: emailSubject,
          dismissBody: () => dismissStagedEmailBody(staged.key),
          restoreBody: () => restoreStagedEmailBody(staged.key),
          dismissAttachment: (attachmentId) =>
            dismissStagedEmailAttachment(staged.key, attachmentId),
          restoreAttachment: (attachmentId) =>
            restoreStagedEmailAttachment(staged.key, attachmentId),
        }),
        // Removing a drop must not need the card opened first.
        pinActions: true,
      });
    }

    // Office.js compose-mode attachments fallback. These are only relevant
    // when no `.eml` is staged (compose mode); in read mode they would be
    // redundant copies of the in-eml attachments shown in the staged group.
    if (stagedEmails.length === 0) {
      const items: FileAttachmentGroupItem[] = [];

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
    emailThreadLoadError,
    emailSubject,
    hasDroppedStagedEmails,
    isDropResolutionStale,
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
  // owner releases its dedup claim too. The card pins it to its header.
  const emailSourceGroupActions = useMemo(() => {
    const actions: Partial<Record<string, ReactNode>> = {};
    for (const staged of stagedEmails) {
      if (staged.source !== "drop") continue;
      const drop = {
        key: staged.key,
        messageId: staged.parsed.messageId ?? null,
      };
      const groupId = `staged-email:${staged.key}`;
      const subject =
        emailSourceGroups.find((group) => group.id === groupId)?.label ?? "";
      actions[groupId] = (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start px-0 text-xs"
          disabled={isUploadingEmail}
          onClick={() => {
            onEmailSourceDropsSent?.([drop]);
            // The card goes with the button, which would drop focus to the
            // page outside the task pane's composer.
            chatInputControls.focusInput();
          }}
          data-testid={`addin-staged-email-remove-${staged.key}`}
          aria-label={t({
            id: "officeAddin.chatInput.removeDroppedEmailNamed",
            message: `Remove ${subject}`,
          })}
        >
          {t({
            id: "officeAddin.chatInput.removeDroppedEmail",
            message: "Remove",
          })}
        </Button>
      );
    }
    return actions;
  }, [
    chatInputControls,
    emailSourceGroups,
    isUploadingEmail,
    onEmailSourceDropsSent,
    stagedEmails,
  ]);

  const wrappedOnSendMessage = useCallback(
    async (
      message: string,
      inputFileIds?: string[],
      modelId?: string,
      selectedFacetIds?: string[],
      mentionedAssistants?: AssistantMention[],
      delegationRunMode?: DelegationRunMode,
      mcpWriteToolsEnabled?: boolean,
      disabledMcpServerIds?: string[],
      disabledMcpTools?: string[],
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

      // Recipient edits do not fire ItemChanged. Read the live fields at send
      // time, and only when an email facet accepts the optional context.
      const liveItem = resolveSupportedMailboxItem(Office.context.mailbox.item);

      const recipients =
        mailItem?.itemKind === "message" &&
        mailItem.isComposeMode &&
        liveItem &&
        !isMessageRead(liveItem) &&
        !isAppointmentComposeItem(liveItem) &&
        [
          "outlook_rewrite_selection",
          "outlook_review_draft",
          "compose_email",
        ].some((id) => availableFacetArgs.get(id)?.has("recipients"))
          ? serializeComposeRecipients(await readComposeRecipients(liveItem))
          : undefined;
      // Appointment fields are re-read from the LIVE item at send time:
      // editing an appointment form fires no ItemChanged, so the provider's
      // bind-time state is frozen at pane-open and would ship a stale (often
      // empty) snapshot — and poison the de-dup fingerprint with it. Reads
      // are bounded and fall back per-field to the provider state, so a
      // wedged host degrades to the old behavior instead of losing the send.
      const appointmentSnapshot =
        isAppointmentCompose && liveItem && isAppointmentComposeItem(liveItem)
          ? await readAppointmentComposeSnapshot(liveItem, appointmentFallback)
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
        ? outlookAppointmentFingerprint(appointmentSnapshot)
        : undefined;
      const { facet: actionFacet, sentDraftFingerprint } =
        resolveOutlookActionFacet({
          itemKind: mailItem?.itemKind ?? null,
          hasActiveSelection,
          selectionData: composeSelection.data,
          selectionSource: composeSelection.sourceProperty,
          draftContextIncluded: isDraftContextIncluded,
          draftBody,
          lastSentDraftFingerprint: lastSentDraftRef.current?.sent ?? null,
          draftContextFingerprint,
          bodyFormat,
          recipients,
          availableFacetArgs,
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
          // Judged again here rather than read from render: the send can
          // come after the window closed and before the re-render.
          schedulingThreadActive: isSchedulingThreadFresh(
            lastSchedulingSignalAt,
            Date.now(),
          ),
          nowIso: toLocalOffsetIso(new Date().toISOString()),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
      // Rolled back on a declined send: the marker means "already sent".
      const previousSentDraft = lastSentDraftRef.current;
      if (sentDraftFingerprint !== null) {
        // Remember what we sent so an unchanged follow-up de-dupes (#4). The
        // draft row sees the appointment as last read at render time, which
        // can lag the live form, so it compares against that as well.
        rememberSentDraft({
          sent: sentDraftFingerprint,
          seen:
            appointmentSnapshot && seenAppointmentFingerprint !== undefined
              ? seenAppointmentFingerprint
              : sentDraftFingerprint,
          recipients,
        });
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
          mcpWriteToolsEnabled,
          disabledMcpServerIds,
          disabledMcpTools,
        );
        return;
      }

      setIsUploadingEmail(true);
      // Every refused send ends the same way: nothing is dispatched, the
      // draft comes back, and the dedup marker forgets the draft it never sent.
      const declineSend = (error: Error) => {
        setSendFailure({ error, dropKeys: sentDrops.map((drop) => drop.key) });
        rememberSentDraft(previousSentDraft);
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
            mcpWriteToolsEnabled,
            disabledMcpServerIds,
            disabledMcpTools,
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

        const idToken = getIdToken();
        // Multipart provenance applies to the whole request. Keep each source
        // separate so dropped mail never inherits the open thread's identity.
        for (const file of filesToUpload) {
          const formData = new FormData();
          const provenance = getFileProvenance(file);
          if (provenance)
            formData.append("outlook_provenance", JSON.stringify(provenance));
          formData.append("file", file, file.name);
          const result = await fetchUploadFile({
            queryParams: chatId ? { chat_id: chatId } : {},
            body: formData as never,
            headers: {
              ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
            },
          });
          resolvedFileIds.push(...result.files.map((uploaded) => uploaded.id));
        }
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
        mcpWriteToolsEnabled,
        disabledMcpServerIds,
        disabledMcpTools,
      );

      clearSentDrops();
    },
    [
      availableFacetArgs,
      calendarFetcher,
      chatId,
      chatInputProps,
      composeEmailAvailable,
      appointmentContextAvailable,
      appointmentFallback,
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
      rememberSentDraft,
      replyFromReadAvailable,
      resolvedParts,
      resolveSelectedFilesForSend,
      getFileProvenance,
      restoreDraft,
      scheduleFacetAvailable,
      seenAppointmentFingerprint,
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
              onRemoveFile={removeAttachment}
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
        <AddinSelectionChip
          preview={composeSelection.data}
          armed
          onDismiss={selectionDismissal.dismiss}
          testId="outlook-selection-chip"
        />
      )}

      {draftRowState && (
        <div className="mx-auto w-full max-w-[var(--theme-layout-chat-input-max-width)] px-2 pb-1 sm:px-4">
          <div
            // Muted text on the secondary fill misses 4.5:1, so a superseded
            // row sits on the primary fill instead.
            className={`flex items-center gap-2 rounded-[var(--theme-radius-message)] border border-theme-border px-3 py-1.5 text-xs ${
              draftRowState === "sent"
                ? "bg-theme-bg-secondary text-theme-fg-secondary"
                : "bg-theme-bg-primary text-theme-fg-muted"
            }`}
            data-testid="outlook-draft-chip"
            data-state={draftRowState === "sent" ? "included" : "superseded"}
          >
            <span
              className={`shrink-0 ${draftRowState === "sent" ? "" : "opacity-60"}`}
              aria-hidden="true"
            >
              &#x1F4DD;
            </span>
            {/* Wraps rather than truncates: several locales put "not sent" last. */}
            <span className="min-w-0 break-words">
              {draftRowText(draftRowState, isAppointmentCompose)}
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
        // The action facet rides along implicitly with every send from
        // here, so the write switch pauses Reply and Send as well.
        pausesHostActionsWhenWritesOff
        onSendMessage={(
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
          void wrappedOnSendMessage(
            message,
            inputFileIds,
            modelId,
            selectedFacetIds,
            mentionedAssistants,
            delegationRunMode,
            mcpWriteToolsEnabled,
            disabledMcpServerIds,
            disabledMcpTools,
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
