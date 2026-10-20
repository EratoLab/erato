import {
  DEFAULT_MAX_FILES_PER_MESSAGE,
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
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";

import { AddinChatInputCore } from "../../core/AddinChatInputCore";
import {
  useAvailableActionFacetArgs,
  useAvailableActionFacetIds,
} from "../../core/clientActions/useAvailableActionFacets";
import { useConversationKey } from "../../core/selection/useConversationKey";
import { useOffice } from "../../providers/OfficeProvider";
import { outlookContextStore } from "../hooks/outlookContextStore";
import { useLiveComposeFields } from "../hooks/useLiveComposeFields";
import { useOutlookCalendarFetcher } from "../hooks/useOutlookCalendarFetcher";
import { useOutlookComposeSelection } from "../hooks/useOutlookComposeSelection";
import { useOutlookContextItems } from "../hooks/useOutlookContextItems";
import { useSchedulingThreadActive } from "../hooks/useSchedulingThreadActive";
import {
  useOutlookEmailSource,
  type StagedEmail,
} from "../providers/OutlookEmailSourceProvider";
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
import { OutlookComposerMenuContext } from "./OutlookComposerMenuContext";
import {
  dropAttachmentCounts,
  judgeDropEmailParts,
  senderAndDate,
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
  appointmentFields,
  outlookContextChips,
  type OutlookAppointmentDisplay,
  type OutlookContextDisplay,
} from "../utils/outlookContextChips";
import {
  formatAppointmentWhen,
  formatClockTime,
} from "../utils/outlookContextFormat";
import {
  OUTLOOK_SCHEDULE_FACET_ID,
  SCHEDULING_THREAD_MAX_AGE_MS,
  isStickySchedulingOn,
  toLocalOffsetIso,
} from "../utils/outlookScheduleTool";
import { planOutlookFiles } from "../utils/outlookSendFiles";
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
import type {
  OutlookContextDetailData,
  OutlookContextHandlers,
} from "../hooks/useOutlookContextItems";
import type { StagedThread } from "../utils/buildThreadGroup";

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
  /**
   * No message has been sent in this chat yet: the open email and the item's
   * attachments go by default. On a follow-up they are offered, never sent
   * unasked.
   */
  freshChat?: boolean;
  /** The open email is staged as a drop (or being read as one): its drop chip stands for it. */
  openEmailStagedAsDrop?: boolean;
  /**
   * Set to the open email's Message-ID while its thread goes with the next
   * send, so the owner refuses a drop of the same email.
   */
  includedEmailMessageIdRef?: MutableRefObject<string | null>;
  /**
   * Called with the dropped emails a send attached, and with a single drop
   * when the user removes its chip. The owner clears the drop from
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
   * deduplicated. Gates the send button and draws a progress chip so the
   * user knows attachments are still materializing.
   */
  isExpandingDroppedEmails?: boolean;
  /** Which step the dropped items are in; refines the progress chip's copy. */
  dropPipeline?: DropPipelineState;
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

function attendeeNames(
  attendees: readonly { displayName: string; emailAddress: string }[],
): string[] {
  return attendees.map(
    (attendee) => attendee.displayName || attendee.emailAddress,
  );
}

function appointmentDisplay(
  snapshot: AppointmentComposeSnapshot,
): OutlookAppointmentDisplay {
  return {
    subject: snapshot.subject,
    when: formatAppointmentWhen(snapshot.start, snapshot.end),
    whenLong: formatAppointmentWhen(snapshot.start, snapshot.end, {
      long: true,
    }),
    location: snapshot.location,
    attendees: attendeeNames([
      ...snapshot.requiredAttendees,
      ...snapshot.optionalAttendees,
    ]),
  };
}

/** A polite region for what no chip says: drops being read and added, a thread added from "+". */
function useHostAnnouncer(): [string, (text: string) => void] {
  const [text, setText] = useState("");
  const announce = useCallback((next: string) => {
    setText((current) => (current === next ? `${next}\u200b` : next));
  }, []);
  return [text, announce];
}

export const AddinChatInput = forwardRef<
  ChatInputControlsHandle,
  AddinChatInputProps
>(function AddinChatInput(
  {
    chatId,
    className,
    freshChat = false,
    openEmailStagedAsDrop = false,
    includedEmailMessageIdRef,
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
  const { host, mailboxUser } = useOffice();
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

  // Every (x)/(+) choice lives in memory, per conversation, and the
  // item-scoped ones end with the mail item (ERMAIN-431 for the selection).
  const conversationKey = useConversationKey(
    chatId,
    mailboxUser?.emailAddress ?? "",
  );
  const itemKey = itemIdentity ?? "";
  const selectionKey = composeSelection.data
    ? `${composeSelection.sourceProperty}:${composeSelection.data}`
    : "";
  const choices = outlookContextStore.useChoices(conversationKey, {
    itemKey,
    selectionKey,
  });
  // Appointment facets are config-defined (subscription content, not
  // builtins): when the backend doesn't advertise them, the resolver would
  // drop the facet, so the selection and draft must not count as included.
  const selectionCarriable =
    composeSelection.data.length > 0 &&
    (!isAppointmentCompose || appointmentRewriteAvailable);
  const hasActiveSelection = selectionCarriable && !choices.selectionDismissed;

  // A non-empty compose body (or an appointment) can ride along as
  // `outlook_review_draft`; its chip switches it off until the item changes.
  const draftBodyText = mailItem?.bodyText ?? mailItem?.bodyHtml ?? "";
  const draftAvailable =
    !!mailItem?.isComposeMode &&
    (draftBodyText.length > 0 || isAppointmentCompose) &&
    (!isAppointmentCompose || appointmentContextAvailable);
  const isDraftContextIncluded = draftAvailable && !choices.draftOff;

  // Draft de-dup marker (#4): what the last send of the draft context left in
  // this chat (see `OutlookSentDraft`). Client-side by design — the backend is
  // action-facet toggle-stateless. Reset when the chat changes so a fresh
  // chat re-sends the draft. The send reads the ref; the draft chip reads the
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

  // Ending scheduling holds for the signal the user ended; Erato reading the
  // calendar again turns it back on.
  const schedulingFresh = useSchedulingThreadActive(lastSchedulingSignalAt);
  const schedulingThreadActive =
    schedulingFresh && lastSchedulingSignalAt !== choices.schedulingEndedAt;
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
  const reviewCarriesRecipients = !!availableFacetArgs
    .get("outlook_review_draft")
    ?.has("recipients");
  const liveComposeFields = useLiveComposeFields({
    watch:
      host !== "Outlook" || !mailItem?.isComposeMode
        ? null
        : isAppointmentCompose
          ? "appointment"
          : reviewCarriesRecipients
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
  // The chips say what the send would do with the draft and selection, from
  // the same resolver, so they never claim context the send leaves out.
  const sendPreview = previewOutlookSend({
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
  const {
    emailSubject,
    stagedEmails,
    currentThread,
    threadFile,
    threadStatus,
    threadTrimError,
    emailThreadSignIn,
    signingIn,
    retryEmailThread,
    signInForEmail,
    restoreEmailBody,
    itemAttachments,
    dismissedAttachmentIds,
    isLoadingAttachments,
    removeAttachment,
    restoreAttachment,
    resolveSelectedFilesForSend,
    getFileProvenance,
    parentReplyContext,
    dismissStagedEmailAttachment,
    restoreStagedEmailAttachment,
    dismissStagedEmailBody,
    restoreStagedEmailBody,
    setPolicyExcludedAttachmentIds,
    isThreadEmlStale,
    isDropResolutionStale,
    resolvedDrops,
    resolvedParts,
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
  const threadStaged = useMemo(
    () =>
      stagedEmails.find(
        (staged): staged is StagedThread => staged.source === "current-thread",
      ) ?? null,
    [stagedEmails],
  );
  const stagedDrops = useMemo(
    () =>
      stagedEmails.filter(
        (staged): staged is Extract<StagedEmail, { source: "drop" }> =>
          staged.source === "drop",
      ),
    [stagedEmails],
  );
  // One verdict per checklist row, shared by the rows and the exclusions
  // handed to the provider so the two can never disagree.
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

  // The thread's conversation, known while it loads too, so an email already
  // sent in this chat stays hidden when the user comes back to it.
  const threadConversationId =
    currentThread?.conversationId ?? mailItem?.conversationId ?? null;
  const attachmentMode: "compose" | "read" = mailItem?.isComposeMode
    ? "compose"
    : "read";
  const resolvedDropByKey = useMemo(
    () => new Map(resolvedDrops.map((drop) => [drop.key, drop])),
    [resolvedDrops],
  );
  // Which files the send uploads, one decision per file; the chips render
  // this plan and the send uploads exactly it.
  const plan = useMemo(
    () =>
      planOutlookFiles({
        freshChat,
        thread: {
          status: threadStatus,
          signIn: emailThreadSignIn,
          messageCount: threadStaged?.thread.messages.length ?? 0,
          includedMessageCount: threadStaged
            ? threadStaged.thread.messages.filter(
                (message) => !threadStaged.dismissedMessageIds.has(message.id),
              ).length
            : 0,
          file: threadFile,
          partKey: threadStaged?.key ?? null,
          trimError: threadTrimError !== null,
          conversationId: threadConversationId,
          choice: choices.threadChoice,
          sentInChat:
            threadConversationId !== null &&
            choices.threadsSentInChat.has(threadConversationId),
          stagedAsDrop: openEmailStagedAsDrop,
        },
        attachments: {
          mode: attachmentMode,
          items: itemAttachments.map((attachment) => ({
            id: attachment.id,
            cloud: attachment.cloud,
            ticked: !dismissedAttachmentIds.includes(attachment.id),
          })),
          loading: isLoadingAttachments,
          groupOff: choices.attachmentsGroupOff,
          includeOnFollowUpIds: choices.includeOnFollowUpIds,
          sentIds: choices.sentAttachmentIds,
        },
        drops: stagedDrops.map((staged) => {
          const resolved = resolvedDropByKey.get(staged.key);
          return {
            key: staged.key,
            file: resolved?.file ?? null,
            size: resolved?.size ?? 0,
            error: !!resolved?.error,
          };
        }),
      }),
    [
      attachmentMode,
      choices,
      dismissedAttachmentIds,
      emailThreadSignIn,
      freshChat,
      isLoadingAttachments,
      itemAttachments,
      openEmailStagedAsDrop,
      resolvedDropByKey,
      stagedDrops,
      threadConversationId,
      threadFile,
      threadStaged,
      threadStatus,
      threadTrimError,
    ],
  );

  // The owner refuses a drop of the email the next send already carries. Set
  // after the commit: a drop is handled asynchronously, never mid-render.
  useLayoutEffect(() => {
    if (!includedEmailMessageIdRef) return;
    includedEmailMessageIdRef.current = plan.uploadThread
      ? (mailItem?.internetMessageId ?? null)
      : null;
  }, [
    includedEmailMessageIdRef,
    mailItem?.internetMessageId,
    plan.uploadThread,
  ]);

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
      findStagedSendLimit(plan.parts, composerFiles, {
        maxBytes: globalMaxSizeBytes,
        maxFormatted: maxSizeFormatted,
        maxFiles,
      }),
    [composerFiles, globalMaxSizeBytes, maxFiles, maxSizeFormatted, plan.parts],
  );
  const sizeLimitExceeded = ownerSizeLimitExceeded ?? stagedLimitExceeded;

  const [hostAnnouncement, announce] = useHostAnnouncer();
  // The lane says nothing of chips that appear, so the drop pipeline's start
  // and outcome are said here.
  const dropCount = stagedDrops.length;
  const dropsBeforeRef = useRef<number | null>(null);
  const dropTotal = dropPipeline?.total ?? 0;
  useEffect(() => {
    if (isExpandingDroppedEmails && dropsBeforeRef.current === null) {
      dropsBeforeRef.current = dropCount;
      const count = Math.max(1, dropTotal);
      announce(
        t({
          id: "officeAddin.outlook.context.drop.announce.reading",
          message: plural(count, {
            one: "Reading # dropped email.",
            other: "Reading # dropped emails.",
          }),
        }),
      );
    } else if (!isExpandingDroppedEmails && dropsBeforeRef.current !== null) {
      const count = dropCount - dropsBeforeRef.current;
      dropsBeforeRef.current = null;
      if (count > 0) {
        announce(
          t({
            id: "officeAddin.outlook.context.drop.announce.added",
            message: plural(count, {
              one: "# email added.",
              other: "# emails added.",
            }),
          }),
        );
      }
    }
  }, [announce, dropCount, dropTotal, isExpandingDroppedEmails]);

  const recipientNames = (
    recipients: readonly { displayName: string; emailAddress: string }[] = [],
  ) => attendeeNames(recipients);
  const liveRecipientList = liveComposeFields.recipientList;
  const display: OutlookContextDisplay = {
    freshChat,
    itemKind: mailItem?.itemKind ?? null,
    selection:
      host === "Outlook" && selectionCarriable
        ? { text: composeSelection.data, dismissed: choices.selectionDismissed }
        : null,
    draft:
      host === "Outlook" && draftAvailable
        ? {
            kind: isAppointmentCompose ? "appointment" : "message",
            off: choices.draftOff,
            body: draftBodyText,
            parent: parentReplyContext
              ? {
                  subject: parentReplyContext.subject,
                  sender:
                    parentReplyContext.fromName?.trim() ||
                    parentReplyContext.fromAddress?.trim() ||
                    "",
                }
              : null,
            recipients:
              !isAppointmentCompose && reviewCarriesRecipients
                ? {
                    to: recipientNames(liveRecipientList?.to ?? mailItem?.to),
                    cc: recipientNames(liveRecipientList?.cc ?? mailItem?.cc),
                  }
                : null,
            appointment: isAppointmentCompose
              ? appointmentDisplay(
                  liveComposeFields.appointment ?? appointmentFallback,
                )
              : null,
          }
        : null,
    thread: {
      subject: threadStaged?.thread.subject || emailSubject,
      sizeLabel: threadFile ? formatFileSize(threadFile.size) : null,
      stale: isThreadEmlStale,
      signingIn,
    },
    maxSizeFormatted,
    attachments: {
      mode: attachmentMode,
      rows: itemAttachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        size: attachment.size,
        sizeLabel: formatFileSize(attachment.size),
        type: attachment.contentType,
        ticked: !dismissedAttachmentIds.includes(attachment.id),
        cloud: attachment.cloud,
      })),
      groupOff: choices.attachmentsGroupOff,
    },
    drops: stagedDrops.map((staged) => ({
      key: staged.key,
      subject: staged.parsed.subject ?? "",
      senderAndDate: senderAndDate(staged.parsed),
      ...dropAttachmentCounts(staged, stagedPartVerdicts.get(staged.key)),
    })),
    dropProgress: isExpandingDroppedEmails
      ? dropPipelineLabel(dropPipeline)
      : null,
    schedulingUntil:
      sendPreview.mode === "scheduling" && lastSchedulingSignalAt
        ? formatClockTime(
            new Date(
              Date.parse(lastSchedulingSignalAt) + SCHEDULING_THREAD_MAX_AGE_MS,
            ),
          )
        : null,
    formatSize: formatFileSize,
  };
  const models = outlookContextChips(sendPreview, plan, display);

  const handlers = useMemo<OutlookContextHandlers>(
    () => ({
      dismissSelection: () =>
        outlookContextStore.dismissSelection(
          conversationKey,
          itemKey,
          selectionKey,
        ),
      rearmSelection: () =>
        outlookContextStore.rearmSelection(
          conversationKey,
          itemKey,
          selectionKey,
        ),
      sendDraftInstead: () =>
        outlookContextStore.dismissSelection(
          conversationKey,
          itemKey,
          selectionKey,
        ),
      setDraftOff: (off) =>
        outlookContextStore.setDraftOff(conversationKey, itemKey, off),
      excludeThread: () =>
        outlookContextStore.setThreadChoice(
          conversationKey,
          itemKey,
          "excluded",
        ),
      includeThread: () =>
        outlookContextStore.setThreadChoice(
          conversationKey,
          itemKey,
          "included",
        ),
      retryThread: retryEmailThread,
      signInForEmail: () => void signInForEmail(),
      restoreEveryMessage: restoreEmailBody,
      dismissAttachment: removeAttachment,
      restoreAttachment,
      includeAttachmentsOnFollowUp: (ids) =>
        outlookContextStore.includeAttachmentsOnFollowUp(
          conversationKey,
          itemKey,
          ids,
        ),
      setAttachmentsGroupOff: (off) =>
        outlookContextStore.setAttachmentsGroupOff(
          conversationKey,
          itemKey,
          off,
        ),
      // A dropped email leaves through the same door a sent one does, so the
      // owner releases its dedup claim too.
      removeDrop: (key) => {
        const staged = stagedDrops.find((drop) => drop.key === key);
        onEmailSourceDropsSent?.([
          { key, messageId: staged?.parsed.messageId ?? null },
        ]);
      },
      endScheduling: () => {
        if (lastSchedulingSignalAt === null) return;
        outlookContextStore.endScheduling(
          conversationKey,
          itemKey,
          lastSchedulingSignalAt,
        );
      },
      thread: {
        dismissMessage: dismissStagedEmailBody,
        restoreMessage: restoreStagedEmailBody,
        dismissAttachment: dismissStagedEmailAttachment,
        restoreAttachment: restoreStagedEmailAttachment,
      },
      dismissDropAttachment: dismissStagedEmailAttachment,
      restoreDropAttachment: restoreStagedEmailAttachment,
    }),
    [
      conversationKey,
      dismissStagedEmailAttachment,
      dismissStagedEmailBody,
      itemKey,
      lastSchedulingSignalAt,
      onEmailSourceDropsSent,
      removeAttachment,
      restoreAttachment,
      restoreEmailBody,
      restoreStagedEmailAttachment,
      restoreStagedEmailBody,
      retryEmailThread,
      selectionKey,
      signInForEmail,
      stagedDrops,
    ],
  );

  // The appointment detail re-reads the live form once it opens, as the send
  // does: editing it fires no event the bound item sees.
  const readAppointmentFields = useCallback(async () => {
    const live = resolveSupportedMailboxItem(Office.context.mailbox?.item);
    if (!live || !isAppointmentComposeItem(live)) return null;
    const snapshot = await readAppointmentComposeSnapshot(
      live,
      liveComposeFields.appointment ?? appointmentFallback,
    );
    return appointmentFields(appointmentDisplay(snapshot));
  }, [appointmentFallback, liveComposeFields.appointment]);

  const updatingLabel = t({
    id: "officeAddin.fileSource.updatingThread",
    message: "Updating…",
  });
  const detail = useMemo<OutlookContextDetailData>(
    () => ({
      threadStaged,
      threadVerdicts: stagedPartVerdicts,
      threadExcluded: choices.threadChoice === "excluded",
      threadFile,
      drops: stagedDrops,
      dropVerdicts: stagedPartVerdicts,
      dropFiles: new Map(
        stagedDrops.map((staged) => [
          staged.key,
          resolvedDropByKey.get(staged.key)?.file ?? null,
        ]),
      ),
      dropSizeLabels: new Map(
        stagedDrops.map((staged) => [
          staged.key,
          isDropResolutionStale
            ? updatingLabel
            : formatFileSize(
                resolvedDropByKey.get(staged.key)?.file?.size ??
                  staged.parsed.rawEmlFile.size,
              ),
        ]),
      ),
      fallbackSubject: emailSubject,
      readAppointmentFields: isAppointmentCompose
        ? readAppointmentFields
        : undefined,
    }),
    [
      choices.threadChoice,
      emailSubject,
      isAppointmentCompose,
      isDropResolutionStale,
      readAppointmentFields,
      resolvedDropByKey,
      stagedDrops,
      stagedPartVerdicts,
      threadFile,
      threadStaged,
      updatingLabel,
    ],
  );
  const { items: contextItems, modes: composerModes } = useOutlookContextItems({
    models,
    handlers,
    detail,
    sending: isUploadingEmail,
  });

  const menuState = useMemo(() => {
    const disposition = plan.thread;
    const row =
      disposition.kind === "none"
        ? ("none" as const)
        : disposition.kind === "hidden"
          ? disposition.why === "dropped"
            ? ("dropped" as const)
            : ("add-again" as const)
          : ("in-composer" as const);
    return {
      thread: {
        row,
        fileName:
          threadFile?.name ??
          (threadStaged?.thread.subject ||
            emailSubject ||
            t({ id: "officeAddin.chatInput.emailFallback", message: "Email" })),
        size: threadFile?.size ?? null,
        addAgain: () => {
          if (threadConversationId === null) return;
          outlookContextStore.includeThreadAgain(
            conversationKey,
            itemKey,
            threadConversationId,
          );
        },
      },
      attachments:
        disposition.kind === "hidden" && disposition.why === "sent-in-chat"
          ? ("upload" as const)
          : ("in-composer" as const),
      announce,
    };
  }, [
    announce,
    conversationKey,
    emailSubject,
    itemKey,
    plan.thread,
    threadConversationId,
    threadFile,
    threadStaged,
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
      const sendConversationKey = conversationKey;
      const sendItemKey = itemKey;
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
          schedulingThreadActive: isStickySchedulingOn(
            lastSchedulingSignalAt,
            choices.schedulingEndedAt,
            Date.now(),
          ),
          nowIso: toLocalOffsetIso(new Date().toISOString()),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
      // Rolled back on a declined send: the marker means "already sent".
      const previousSentDraft = lastSentDraftRef.current;
      if (sentDraftFingerprint !== null) {
        // Remember what we sent so an unchanged follow-up de-dupes (#4). The
        // draft chip sees the appointment as last read at render time, which
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
      const sentDrops = stagedDrops.map((staged) => ({
        key: staged.key,
        messageId: staged.parsed.messageId ?? null,
      }));
      const clearSentDrops = () => {
        if (sentDrops.length > 0) {
          onEmailSourceDropsSent?.(sentDrops);
        }
      };
      // What a dispatched send carried, so the chips can say "sent earlier"
      // and one-message choices end; a declined send records nothing.
      const recordSent = (sent: {
        threadSent: boolean;
        attachmentIdsSent: string[];
      }) =>
        outlookContextStore.afterSend(sendConversationKey, {
          itemKey: sendItemKey,
          threadSent: sent.threadSent ? threadConversationId : null,
          attachmentIdsSent: sent.attachmentIdsSent,
        });

      if (!plan.uploads) {
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
        recordSent({ threadSent: false, attachmentIdsSent: [] });
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
      const resolvedFileIds: string[] = [];
      // Outside the try so the catch can name the files.
      let attemptedFileNames: string[] = [];
      let sent = { threadSent: false, attachmentIdsSent: [] as string[] };

      try {
        const { files: filesToUpload, sentAttachmentIds } =
          await resolveSelectedFilesForSend(plan);
        sent = {
          threadSent: threadFile !== null && filesToUpload.includes(threadFile),
          attachmentIdsSent: sentAttachmentIds,
        };
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
          recordSent(sent);
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
      recordSent(sent);
    },
    [
      availableFacetArgs,
      calendarFetcher,
      chatId,
      chatInputProps,
      choices.schedulingEndedAt,
      composeEmailAvailable,
      appointmentContextAvailable,
      appointmentFallback,
      appointmentRewriteAvailable,
      composeSelection.data,
      composeSelection.sourceProperty,
      conversationKey,
      draftBodyText,
      globalMaxSizeBytes,
      hasActiveSelection,
      isAppointmentCompose,
      isDraftContextIncluded,
      itemIdentity,
      itemKey,
      lastSchedulingSignalAt,
      mailItem,
      maxSizeFormatted,
      onEmailSourceDropsSent,
      plan,
      rememberSentDraft,
      replyFromReadAvailable,
      resolvedParts,
      resolveSelectedFilesForSend,
      getFileProvenance,
      restoreDraft,
      scheduleFacetAvailable,
      seenAppointmentFingerprint,
      stagedDrops,
      threadConversationId,
      threadFile,
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
      <div
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
        data-testid="outlook-drop-announcer"
      >
        {hostAnnouncement}
      </div>
      <OutlookComposerMenuContext.Provider value={menuState}>
        <AddinChatInputCore
          ref={ref}
          chatId={chatId}
          {...chatInputProps}
          handleFileAttachments={handleFileAttachments}
          sizeLimitExceeded={sizeLimitExceeded}
          uploadError={sendFailure?.error ?? ownerUploadError}
          contextItems={contextItems}
          composerModes={composerModes}
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
            plan.waitingForThread ||
            chatInputProps.disabled
          }
        />
      </OutlookComposerMenuContext.Provider>
    </div>
  );
});
