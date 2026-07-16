import {
  ChatErrorBoundary,
  ChatInputControlsProvider,
  ChatMessage,
  DefaultMessageControls,
  DocumentIcon,
  DropdownMenu,
  FeedbackCommentDialog,
  FeedbackViewDialog,
  FilePreviewModal,
  MessageList,
  chatMessagesQuery,
  componentRegistry,
  extractTextFromContent,
  getSupportedFileTypes,
  resolveComponentOverride,
  transformEmailFencesForCopy,
  useActiveModelSelection,
  useChatContext,
  useConversationDropzone,
  useFileCapabilitiesContext,
  useFilePreviewModal,
  useFileUploadWithTokenCheck,
  useMessageFeedback,
  usePersistedState,
  useProfile,
  useStandardMessageActions,
  type ActionFacetRequest,
  type ChatInputControlsHandle,
  type DropdownMenuItem,
  type EditMessageState,
  type FileUploadItem,
  type MessageAction,
  type MessageControlsComponent,
  type MessageControlsContext,
  type PersistedStateOptions,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AddinChatInput } from "./AddinChatInput";
import { AddinPinHintBanner } from "./AddinPinHintBanner";
import { AddinSettingsDialog } from "./AddinSettingsDialog";
import { useActionFacetClientActions } from "../hooks/useAvailableActionFacets";
import { useEmailDedupSet } from "../hooks/useEmailDedupSet";
import { useOfficeDragAndDrop } from "../hooks/useOfficeDragAndDrop";
import { useOutlookClientTools } from "../hooks/useOutlookClientTools";
import { useOutlookMailListDrag } from "../hooks/useOutlookMailListDrag";
import { useOutlookMessageFetcher } from "../hooks/useOutlookMessageFetcher";
import { useOffice } from "../providers/OfficeProvider";
import { useOutlookEmailSource } from "../providers/OutlookEmailSourceProvider";
import { useOutlookMailItem } from "../providers/OutlookMailItemProvider";
import { FreshCompletionTracker } from "../utils/freshCompletionTracker";
import {
  OUTLOOK_GRAPH_MESSAGE_TIMEOUT_MS,
  runWithGraphTimeout,
} from "../utils/graphRequestTimeout";
import { buildOutlookArtifact } from "../utils/outlookClientActions";
import { newestSchedulingSignalAt } from "../utils/outlookScheduleTool";
import { parseDroppedFiles } from "../utils/parseDroppedFiles";
import { parseEmlBytes } from "../utils/parsedEmail";

import type { FetchOutlookMessageBytesResult } from "../utils/fetchOutlookMessage";
import type { OutlookMailListDragItem } from "../utils/outlookMailListDragParse";

// Accept real `.eml` / `.msg` files dropped by Outlook clients that expose
// emails as native file drags (Outlook Mac, Classic Outlook on Windows). OWA
// and New Outlook use the custom `maillistrow` path handled separately via
// `useOutlookMailListDrag`.
const EML_MIME_TYPES: Record<string, string[]> = {
  "message/rfc822": [".eml"],
};
const EMAIL_MIME_TYPES: Record<string, string[]> = {
  ...EML_MIME_TYPES,
  "application/vnd.ms-outlook": [".msg"],
};

const PIN_HINT_DISMISSED_KEY = "erato.outlookAddin.pinHintDismissed";
const pinHintDismissedPersistedOptions: PersistedStateOptions<boolean> = {
  parse: (value) => (typeof value === "boolean" ? value : null),
};

interface AddinChatProps {
  assistantId?: string;
}

export function AddinChat({ assistantId }: AddinChatProps = {}) {
  const chatInputControlsRef = useRef<ChatInputControlsHandle | null>(null);
  const chatInputControls = useMemo(
    () => ({
      setDraftMessage: (message: string, options?: { focus?: boolean }) => {
        chatInputControlsRef.current?.setDraftMessage(message, options);
      },
      focusInput: () => {
        chatInputControlsRef.current?.focusInput();
      },
      setSelectedFacetIds: (facetIds: string[]) => {
        chatInputControlsRef.current?.setSelectedFacetIds(facetIds);
      },
      toggleFacetId: (facetId: string) => {
        chatInputControlsRef.current?.toggleFacetId(facetId);
      },
      setSelectedChatProviderId: (chatProviderId: string) => {
        chatInputControlsRef.current?.setSelectedChatProviderId(chatProviderId);
      },
      addUploadedFiles: (files: FileUploadItem[]) => {
        chatInputControlsRef.current?.addUploadedFiles(files);
      },
    }),
    [],
  );

  const {
    messages,
    messageOrder,
    sendMessage,
    editMessage,
    regenerateMessage,
    isMessagingLoading,
    isPendingResponse,
    chats,
    currentChatId,
    createNewChat,
    refetchHistory,
    currentChatLastModel,
  } = useChatContext();
  const { profile } = useProfile();
  const { capabilities } = useFileCapabilitiesContext();

  // Register this add-in's client-tool executors (e.g. `fetch_availability`)
  // with the shared streaming loop for the lifetime of the chat surface.
  useOutlookClientTools();

  // A scheduling exchange is in flight when a RECENT assistant message read
  // the calendar OR proposed an appointment (erato-appointment fence) — the
  // next send then carries the `outlook_schedule` facet (sticky rung in
  // `resolveOutlookActionFacet`) so the model can handle the user's slot pick
  // or adjust the proposal. Deliberately NOT latest-message-only: negotiation
  // turns without a tool call or fence (clarifying an ambiguous pick,
  // gathering subject/location) must not drop the facet mid-flow — the
  // misclassification costs are asymmetric (a facet riding an off-topic turn
  // self-neutralizes via its own "for anything else respond normally" rule,
  // while a dropped facet strands the pick turn without instructions or
  // tools). This memo yields the newest signal-bearing assistant message's
  // TIMESTAMP (not a verdict): recency is judged at send time against
  // SCHEDULING_THREAD_MAX_AGE_MS, and a memo only recomputes when messages
  // change, so a boolean would freeze while idle.
  const lastSchedulingSignalAt = useMemo(
    () =>
      newestSchedulingSignalAt(
        messageOrder
          .map((id) => messages[id])
          .filter((message) => message !== undefined),
      ),
    [messages, messageOrder],
  );

  const { availableModels, selectedModel, setSelectedModel, isSelectionReady } =
    useActiveModelSelection({ initialModel: currentChatLastModel });

  const acceptedFileTypes = useMemo(
    () => getSupportedFileTypes(capabilities),
    [capabilities],
  );

  const { uploadFiles, uploadError, isUploading } = useFileUploadWithTokenCheck(
    {
      message: "",
      chatId: currentChatId,
      assistantId,
      chatProviderId: selectedModel?.chat_provider_id ?? undefined,
      acceptedFileTypes,
      multiple: true,
      // Match the ChatInput cap. Without this, useFileDropzone's default
      // (5) silently truncates each upload batch before files reach the
      // input — the chip row shows "5/50" while later drops disappear.
      maxFiles: 50,
    },
  );

  const handleDropUploaded = useCallback((uploaded: FileUploadItem[]) => {
    chatInputControlsRef.current?.addUploadedFiles(uploaded);
  }, []);

  // Environment-dispatched message fetch (Graph on Exchange Online, EWS SOAP
  // on Exchange SE). Null when no backend is available — the email
  // fetch paths below then skip-and-log instead of crashing; local `.eml`
  // drops keep working since they parse without a backend.
  const { fetcher: messageFetcher } = useOutlookMessageFetcher();

  const { mailItem, hasItemChangedFired } = useOutlookMailItem();
  const { itemTrackingRequiresPin } = useOffice();

  // "Pin this add-in" hint (office-js #1691 heuristic): nudge until the host
  // delivers its first real item change (proof the pane is tracking) or the
  // user dismisses for good. Compose panes are excluded — pinning doesn't
  // carry across modes, so pinning there can't fix the read-mode freeze, and
  // dismissing there would permanently burn the hint where it matters.
  const [pinHintDismissed, setPinHintDismissed] = usePersistedState<boolean>(
    PIN_HINT_DISMISSED_KEY,
    false,
    pinHintDismissedPersistedOptions,
  );
  const showPinHint =
    itemTrackingRequiresPin &&
    !mailItem?.isComposeMode &&
    !hasItemChangedFired &&
    !pinHintDismissed;

  const {
    hasSelectedEmailSource,
    isEmailBodyIncluded,
    emailBodyFile,
    addDroppedEmail,
    removeDroppedEmail,
  } = useOutlookEmailSource();
  const previewEmailMessageIdRef = useRef<string | null>(null);

  // Tracks the RFC 5322 Message-IDs of emails already attached via any drop
  // path in this session. The hook keeps a ref as the synchronous source of
  // truth (safe across awaits in concurrent drop handlers) plus a mirrored
  // state so render-time predicates — e.g. the current-email preview
  // suppression below — still see updates.
  const dedup = useEmailDedupSet();

  // Atomic claim across the preview-dup check + the session dedup. Returns
  // false when the email is already represented by the preview or was
  // previously claimed by another drop; callers must treat a `false` result
  // as "skip this email, do not upload". The combined claim closes a race
  // where two concurrent drops both saw an empty state.
  const tryClaimEmailAttachment = useCallback(
    (messageId: string): boolean => {
      if (previewEmailMessageIdRef.current === messageId) {
        return false;
      }
      return dedup.tryAdd(messageId);
    },
    [dedup],
  );

  // After a send actually attached its dropped emails, drop them from both
  // layers: the provider's staged-drop state (clears the chip) AND the dedup
  // set (releases the claim so the same email can be dropped again later).
  // `removeDroppedEmail` only owns the former; the dedup set lives here, so the
  // release has to be coordinated from this component.
  const handleEmailSourceDropsSent = useCallback(
    (drops: { key: string; messageId: string | null }[]) => {
      for (const { key, messageId } of drops) {
        removeDroppedEmail(key);
        if (messageId) {
          dedup.remove(messageId);
        }
      }
    },
    [dedup, removeDroppedEmail],
  );

  // Coalesce duplicate Outlook message fetches for the same item id. Two
  // rapid drops of the same mail-list row now share a single backend call
  // instead of burning quota on both. A timeout keeps a hung fetch
  // from locking the send button indefinitely — the coalesced promise
  // rejects and its entry is cleared so a later retry can start fresh.
  const pendingOutlookFetchesRef = useRef<
    Map<string, Promise<FetchOutlookMessageBytesResult>>
  >(new Map());
  const fetchOutlookMessageBytesCoalesced = useCallback(
    (itemId: string): Promise<FetchOutlookMessageBytesResult> => {
      if (!messageFetcher) {
        // Rejected (not thrown) so the caller's per-item catch logs and
        // skips it — the same degradation as any other failed email fetch.
        return Promise.reject(
          new Error("Outlook message fetch is not available on this host"),
        );
      }
      const existing = pendingOutlookFetchesRef.current.get(itemId);
      if (existing) {
        return existing;
      }
      const fetchPromise = (async () => {
        try {
          return await runWithGraphTimeout(
            OUTLOOK_GRAPH_MESSAGE_TIMEOUT_MS,
            `Outlook fetch timed out after ${OUTLOOK_GRAPH_MESSAGE_TIMEOUT_MS}ms`,
            undefined,
            (signal) => messageFetcher.fetchMessageBytes(itemId, { signal }),
          );
        } finally {
          pendingOutlookFetchesRef.current.delete(itemId);
        }
      })();
      pendingOutlookFetchesRef.current.set(itemId, fetchPromise);
      return fetchPromise;
    },
    [messageFetcher],
  );

  // Counter for in-flight drop batches. Drives the "processing dropped
  // emails" indicator and disables send while the user is still seeing
  // files appear. Incremented on drop entry and decremented in a finally
  // so timeouts and failures always release the gate.
  const [pendingExpansionCount, setPendingExpansionCount] = useState(0);
  const isExpandingDroppedEmails = pendingExpansionCount > 0;
  const trackExpansion = useCallback(
    async <T,>(work: () => Promise<T>): Promise<T> => {
      setPendingExpansionCount((n) => n + 1);
      try {
        return await work();
      } finally {
        setPendingExpansionCount((n) => n - 1);
      }
    },
    [],
  );

  const uploadFilesWithEmailExpansion = useCallback(
    async (files: File[]) => {
      return trackExpansion(async () => {
        const claimedIds: string[] = [];
        const { emails, nonEmail } = await parseDroppedFiles(files, {
          fetcher: messageFetcher ?? undefined,
          tryAttachEmail: (messageId) => {
            if (!tryClaimEmailAttachment(messageId)) {
              return false;
            }
            claimedIds.push(messageId);
            return true;
          },
        });
        for (const parsed of emails) {
          if (addDroppedEmail(parsed) === null && parsed.messageId) {
            dedup.remove(parsed.messageId);
            claimedIds.splice(claimedIds.indexOf(parsed.messageId), 1);
          }
        }
        if (nonEmail.length === 0) {
          return undefined;
        }
        const uploaded = await uploadFiles(nonEmail);
        if (uploaded === undefined) {
          claimedIds.forEach((id) => dedup.remove(id));
        }
        return uploaded;
      });
    },
    [
      addDroppedEmail,
      dedup,
      messageFetcher,
      trackExpansion,
      tryClaimEmailAttachment,
      uploadFiles,
    ],
  );

  // `.eml` drops parse locally, but `.msg` resolution requires a backend
  // message lookup (`parseMsgFile` extracts only the Message-ID); without a
  // fetcher a dropped `.msg` would show "Drop to upload", be accepted, and
  // then be silently discarded by `parseDroppedFiles`. Mirror the mail-list
  // drag gating below: only advertise `.msg` when the backend exists, so a
  // fetcherless drop gets the normal unsupported-file feedback instead.
  const emailDropMimeTypes = messageFetcher ? EMAIL_MIME_TYPES : EML_MIME_TYPES;

  const {
    getRootProps: getConversationDropzoneRootProps,
    getInputProps: getConversationDropzoneInputProps,
    isDragActive,
    isDragAccept,
  } = useConversationDropzone({
    uploadFiles: uploadFilesWithEmailExpansion,
    onUploaded: handleDropUploaded,
    acceptedFileTypes,
    extraAcceptMimeTypes: emailDropMimeTypes,
    isUploading,
  });

  const handleOutlookMailListDrop = useCallback(
    async (items: OutlookMailListDragItem[]) => {
      return trackExpansion(async () => {
        const claimedIds: string[] = [];
        for (const item of items) {
          try {
            const { bytes, internetMessageId } =
              await fetchOutlookMessageBytesCoalesced(item.itemId);
            if (
              internetMessageId &&
              !tryClaimEmailAttachment(internetMessageId)
            ) {
              console.log(
                "[AddinChat] skipping dropped Outlook email already claimed:",
                item.subject || item.itemId,
                internetMessageId,
              );
              continue;
            }
            if (internetMessageId) {
              claimedIds.push(internetMessageId);
            }
            const parsed = await parseEmlBytes(bytes);
            if (!parsed) {
              if (internetMessageId) {
                dedup.remove(internetMessageId);
                claimedIds.splice(claimedIds.indexOf(internetMessageId), 1);
              }
              continue;
            }
            if (addDroppedEmail(parsed) === null && internetMessageId) {
              dedup.remove(internetMessageId);
              claimedIds.splice(claimedIds.indexOf(internetMessageId), 1);
            }
          } catch (error) {
            console.warn(
              "Failed to fetch dropped Outlook email, skipping:",
              item.subject || item.itemId,
              error,
            );
          }
        }
      });
    },
    [
      addDroppedEmail,
      dedup,
      fetchOutlookMessageBytesCoalesced,
      trackExpansion,
      tryClaimEmailAttachment,
    ],
  );

  const { isDragActive: isOutlookMailDragActive } = useOutlookMailListDrag({
    onDrop: handleOutlookMailListDrop,
    // Mail-list rows carry only an item id; without a backend fetch the drop
    // could never materialize, so don't advertise the target at all.
    disabled: !messageFetcher,
  });

  const handleOfficeDragAndDrop = useCallback(
    async (files: File[]) => {
      if (files.length === 0) {
        return;
      }
      return trackExpansion(async () => {
        const claimedIds: string[] = [];
        const { emails, nonEmail } = await parseDroppedFiles(files, {
          fetcher: messageFetcher ?? undefined,
          tryAttachEmail: (messageId) => {
            if (!tryClaimEmailAttachment(messageId)) {
              return false;
            }
            claimedIds.push(messageId);
            return true;
          },
        });
        for (const parsed of emails) {
          if (addDroppedEmail(parsed) === null && parsed.messageId) {
            dedup.remove(parsed.messageId);
            claimedIds.splice(claimedIds.indexOf(parsed.messageId), 1);
          }
        }
        if (nonEmail.length === 0) {
          return;
        }
        const uploaded = await uploadFiles(nonEmail);
        if (uploaded === undefined) {
          claimedIds.forEach((id) => dedup.remove(id));
          return;
        }
        if (uploaded.length > 0) {
          chatInputControlsRef.current?.addUploadedFiles(uploaded);
        }
      });
    },
    [
      addDroppedEmail,
      dedup,
      messageFetcher,
      trackExpansion,
      tryClaimEmailAttachment,
      uploadFiles,
    ],
  );

  const { isDragActive: isOfficeDragActive } = useOfficeDragAndDrop({
    onDrop: handleOfficeDragAndDrop,
  });

  const showDropOverlay =
    (isDragActive && isDragAccept) ||
    isOutlookMailDragActive ||
    isOfficeDragActive;

  const TopLeftAccessory = componentRegistry.ChatTopLeftAccessory;

  const canEditForCurrentChat = Array.isArray(chats)
    ? !!chats.find((chat) => chat.id === (currentChatId ?? ""))?.can_edit
    : false;

  const currentChatLastSelectedFacets = useMemo(() => {
    if (!Array.isArray(chats)) {
      return undefined;
    }

    return chats.find((chat) => chat.id === (currentChatId ?? ""))
      ?.last_selected_facets;
  }, [chats, currentChatId]);

  const [activeSelectedFacetIds, setActiveSelectedFacetIds] = useState<
    string[]
  >(currentChatLastSelectedFacets ?? []);
  const [editState, setEditState] = useState<EditMessageState>({
    mode: "compose",
  });
  const currentEmailMessageId = mailItem?.internetMessageId ?? null;
  const currentEmailAlreadyAttached =
    currentEmailMessageId !== null && dedup.ids.has(currentEmailMessageId);
  const shouldSuggestCurrentEmail =
    currentChatId === null &&
    messageOrder.length === 0 &&
    !isPendingResponse &&
    editState.mode === "compose" &&
    !currentEmailAlreadyAttached;

  // Keep the preview's Message-ID fresh for the drop-dedup predicate. The
  // ref is read by `tryClaimEmailAttachment` at drop time, so we write here
  // on every render once `shouldSuggestCurrentEmail` is known.
  previewEmailMessageIdRef.current =
    shouldSuggestCurrentEmail && hasSelectedEmailSource && isEmailBodyIncluded
      ? currentEmailMessageId
      : null;

  // Feed the previewed email body into the token estimator without
  // persisting it as an upload. The estimator hook digests the file's
  // metadata for cache stability, so we only re-allocate the array when
  // the underlying File reference changes.
  const isPreviewBodyIncluded =
    shouldSuggestCurrentEmail && hasSelectedEmailSource && isEmailBodyIncluded;
  const previewVirtualFiles = useMemo(
    () =>
      isPreviewBodyIncluded && emailBodyFile ? [emailBodyFile] : undefined,
    [isPreviewBodyIncluded, emailBodyFile],
  );

  // Outlook item identity captured by AddinChatInput when the user pressed
  // send, held until the completion of that exchange is observed (there is
  // one in-flight generation per chat). Edits and regenerations replay the
  // ORIGINAL email (it rides in the stored user message / facet args), so
  // they re-seed this ref with the original exchange's send-time identity
  // when this session still knows it; otherwise it stays null and the
  // completion is not stamped fresh at all (degrading to a history-like
  // draft — see the tracking effect below).
  const pendingSendItemIdentityRef = useRef<string | null>(null);

  // Track which assistant messages finished streaming during THIS session.
  // Auto-prompt (presentation = "auto_prompt") may only fire for those —
  // history loads, refetches, and chat switches never auto-open anything.
  // The SEND-time Outlook item identity is recorded alongside (the user can
  // switch emails mid-stream, so the item at completion time is the wrong
  // baseline), so executors can refuse to open a reply on a different email
  // than the draft was requested for.
  const freshTrackerRef = useRef(new FreshCompletionTracker());
  const freshItemIdentityRef = useRef(new Map<string, string>());
  const freshTrackerChatIdRef = useRef(currentChatId);
  const [freshMessageIds, setFreshMessageIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  useEffect(() => {
    // A chat switch replaces the whole message list — discard the tracker so
    // the next snapshot is treated as history and nothing in the switched-to
    // chat can be considered "just completed". The pending send identity
    // belongs to the abandoned chat's in-flight exchange, so drop it too.
    // Exception: a brand-new chat receiving its id on first send (null → id)
    // is the same conversation continuing — resetting here would drop the
    // in-flight exchange's identity and silently disable the consent prompt
    // for the very first reply draft.
    if (freshTrackerChatIdRef.current !== currentChatId) {
      const isNewChatGettingItsId =
        freshTrackerChatIdRef.current == null && currentChatId != null;
      freshTrackerChatIdRef.current = currentChatId;
      if (!isNewChatGettingItsId) {
        freshTrackerRef.current = new FreshCompletionTracker();
        pendingSendItemIdentityRef.current = null;
      }
    }
    const newlyFresh = freshTrackerRef.current.observe(messages, messageOrder);
    if (newlyFresh.length > 0) {
      // Consume the send-time identity: one send maps to one completion
      // (several ids completing at once would make the mapping ambiguous, so
      // none of them gets the identity). A completion whose identity is
      // unknown is NOT stamped fresh at all: it renders exactly like a
      // history draft — buttons usable, re-guarded at confirmation time,
      // auto-prompt impossible — instead of being bricked behind the
      // stale-item error. Only a KNOWN identity that mismatches the open
      // item may block a reply.
      const sendItemIdentity =
        newlyFresh.length === 1 ? pendingSendItemIdentityRef.current : null;
      pendingSendItemIdentityRef.current = null;
      if (sendItemIdentity) {
        const completedId = newlyFresh[0];
        freshItemIdentityRef.current.set(completedId, sendItemIdentity);
        setFreshMessageIds((previous) => new Set([...previous, completedId]));
      }
    }
  }, [messages, messageOrder, currentChatId]);

  const handleSendMessage = useCallback(
    (
      message: string,
      inputFileIds?: string[],
      modelId?: string,
      selectedFacetIds?: string[],
      actionFacet?: ActionFacetRequest,
      sendItemIdentity?: string | null,
    ) => {
      pendingSendItemIdentityRef.current = sendItemIdentity ?? null;
      void sendMessage(
        message,
        inputFileIds,
        modelId,
        assistantId,
        selectedFacetIds,
        actionFacet,
      ).then(() => refetchHistory());
    },
    [assistantId, refetchHistory, sendMessage],
  );

  const cancelEdit = useCallback(() => setEditState({ mode: "compose" }), []);

  const handleEditSubmit = useCallback(
    (
      messageId: string,
      newContent: string,
      replaceInputFileIds?: string[],
      selectedFacetIds?: string[],
    ) => {
      // The edited exchange replays the ORIGINAL email (it rides in the
      // stored user message / facet args), so the wrong-item guard must
      // anchor on the original exchange's send-time identity — never the
      // item open right now, which may be a different email entirely. That
      // identity is the one stamped as `outlookArtifact.itemIdentity` on
      // the exchange's assistant message; when this session no longer knows
      // it (e.g. after a reload — the map is in-memory only) the ref stays
      // null and the new completion degrades to a history-like draft.
      const exchangeAssistantId = messageOrder.find(
        (id) =>
          messages[id]?.role === "assistant" &&
          messages[id]?.previous_message_id === messageId,
      );
      pendingSendItemIdentityRef.current = exchangeAssistantId
        ? (freshItemIdentityRef.current.get(exchangeAssistantId) ?? null)
        : null;
      void editMessage(
        messageId,
        newContent,
        replaceInputFileIds,
        selectedFacetIds,
      ).finally(() => setEditState({ mode: "compose" }));
    },
    [editMessage, messages, messageOrder],
  );

  const handleRegenerate = useCallback(
    (assistantMessageId: string) => {
      // Same anchor rule as handleEditSubmit: the regenerated exchange
      // replays the original email, so reuse the regenerated message's own
      // send-time identity when this session still knows it (null after a
      // reload — the completion then degrades to a history-like draft
      // instead of stale-bricking the reply buttons).
      pendingSendItemIdentityRef.current =
        freshItemIdentityRef.current.get(assistantMessageId) ?? null;
      void regenerateMessage(assistantMessageId, activeSelectedFacetIds);
    },
    [activeSelectedFacetIds, regenerateMessage],
  );

  const {
    isPreviewModalOpen,
    fileToPreview,
    openPreviewModal,
    closePreviewModal,
  } = useFilePreviewModal();

  const queryClient = useQueryClient();
  const handleFeedbackSuccess = useCallback(() => {
    if (!currentChatId) {
      return;
    }

    void queryClient.invalidateQueries({
      queryKey: chatMessagesQuery({ pathParams: { chatId: currentChatId } })
        .queryKey,
    });
  }, [currentChatId, queryClient]);

  const {
    feedbackDialogState,
    feedbackViewDialogState,
    feedbackConfig,
    handleFeedbackSubmit,
    closeFeedbackDialog,
    closeFeedbackViewDialog,
    handleFeedbackDialogSubmit,
    openFeedbackDialog,
    openFeedbackViewDialog,
    switchToEditMode,
    canEditFeedback,
  } = useMessageFeedback({ onFeedbackSuccess: handleFeedbackSuccess });

  const handleCopyAction = useCallback(
    async (action: MessageAction): Promise<boolean> => {
      if (action.type !== "copy") {
        return false;
      }
      const messageToCopy = messages[action.messageId];
      const textContent = transformEmailFencesForCopy(
        extractTextFromContent(messageToCopy?.content),
      );
      if (!textContent) {
        return false;
      }

      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(textContent);
        } else {
          throw new Error("clipboard API unavailable");
        }
        return true;
      } catch {
        try {
          const textarea = document.createElement("textarea");
          textarea.value = textContent;
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand("copy");
          document.body.removeChild(textarea);
          return true;
        } catch (fallbackError) {
          console.warn("Failed to copy message content:", fallbackError);
          return false;
        }
      }
    },
    [messages],
  );

  const standardMessageActionHandler = useStandardMessageActions({
    messages,
    setEditState,
    handleRegenerate,
    handleFeedbackSubmit,
    feedbackConfig,
    openFeedbackDialog,
    onUnhandledAction: handleCopyAction,
  });

  const controlsContext: MessageControlsContext = useMemo(
    () => ({
      currentUserId: profile?.id,
      canEdit: canEditForCurrentChat,
    }),
    [canEditForCurrentChat, profile?.id],
  );

  const resolvedMessageControls = useMemo(
    () =>
      resolveComponentOverride(
        componentRegistry.MessageControls,
        DefaultMessageControls,
      ) as MessageControlsComponent,
    [],
  );

  const resolvedMessageRenderer = useMemo(
    () =>
      resolveComponentOverride(
        componentRegistry.ChatMessageRenderer,
        ChatMessage,
      ),
    [],
  );

  // Stamp an `outlookArtifact` hint onto assistant messages whose triggering
  // user message carried an Outlook action facet (resolved via
  // `previous_message_id`). The shared renderer uses it to show the
  // insert/replace email UI even when the model drifted or omitted the
  // `erato-email` fence tag, and the fence renderers use it for client-action
  // proposals.
  //
  // Convention-driven, NOT an id allowlist: an email-bodied facet qualifies
  // by its `body_format` arg, an action facet by its backend-advertised
  // `client_actions` — so a facet added only in erato.toml (e.g.
  // `compose_email`, `outlook_schedule`) renders here with no add-in change.
  // The full decision lives in `buildOutlookArtifact`; `itemIdentity` is the
  // SEND-time identity, and fresh implies it is known: completions whose
  // identity is unknown (capture failed, edit/regenerate of an exchange this
  // session no longer knows, ambiguous multi-id completion) were never added
  // to `freshMessageIds`, so they render as history-like drafts.
  const clientActionsByFacetId = useActionFacetClientActions();

  const messagesWithArtifact = useMemo(() => {
    let next = messages;
    for (const id of messageOrder) {
      const message = messages[id];
      if (
        !message ||
        message.role !== "assistant" ||
        !message.previous_message_id
      ) {
        continue;
      }
      const previous = messages[message.previous_message_id];
      const facetId = previous?.action_facet_id;
      const outlookArtifact = buildOutlookArtifact({
        facetId,
        facetArgs: previous?.action_facet_args,
        clientActionInfo: facetId
          ? clientActionsByFacetId.get(facetId)
          : undefined,
        content: message.content,
        messageId: id,
        freshItemIdentity: freshMessageIds.has(id)
          ? freshItemIdentityRef.current.get(id)!
          : undefined,
      });
      if (!outlookArtifact) {
        continue;
      }
      if (next === messages) {
        next = { ...messages };
      }
      next[id] = { ...message, outlookArtifact };
    }
    return next;
  }, [messages, messageOrder, clientActionsByFacetId, freshMessageIds]);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const headerMenuItems = useMemo<DropdownMenuItem[]>(
    () => [
      {
        id: "settings",
        label: t({
          id: "officeAddin.headerMenu.settings",
          message: "Settings",
        }),
        onClick: () => setIsSettingsOpen(true),
      },
    ],
    [],
  );

  return (
    <ChatInputControlsProvider value={chatInputControls}>
      <div className="flex size-full min-w-0 flex-col">
        <div className="flex items-center justify-between border-b border-theme-border px-4 py-2">
          <DropdownMenu
            id="addin-header-menu"
            align="left"
            items={headerMenuItems}
          />
          <button
            type="button"
            onClick={() => void createNewChat()}
            className="rounded-[var(--theme-radius-control)] bg-theme-bg-tertiary px-3 py-1 text-xs font-medium text-theme-fg-secondary transition-colors hover:bg-theme-bg-hover"
          >
            {t({
              id: "officeAddin.chat.newChat",
              message: "New Chat",
            })}
          </button>
        </div>

        <ChatErrorBoundary onReset={() => void refetchHistory()}>
          <div
            {...getConversationDropzoneRootProps()}
            className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-theme-bg-secondary"
            role="region"
            aria-label={t({
              id: "officeAddin.chat.conversation.aria",
              message: "Chat conversation",
            })}
            data-ui="addin-chat-conversation-dropzone"
          >
            <input
              {...getConversationDropzoneInputProps()}
              aria-label={t({
                id: "officeAddin.chat.conversation.dropzone.ariaLabel",
                message: "Drop files anywhere in the conversation to upload",
              })}
            />
            {showDropOverlay && (
              <div
                className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center overflow-hidden bg-[color:color-mix(in_srgb,var(--theme-shell-chat-body)_75%,transparent)]"
                data-testid="addin-chat-drop-overlay"
              >
                <div className="relative flex flex-col items-center gap-2 px-6 py-5 text-center">
                  <DocumentIcon className="size-10 text-[var(--theme-fg-primary)] drop-shadow-[0_8px_24px_rgba(0,0,0,0.18)]" />
                  <p className="text-sm font-medium text-[var(--theme-fg-primary)]">
                    {t({
                      id: "officeAddin.chat.fileDrop.overlay.label",
                      message: "Drop to upload",
                    })}
                  </p>
                </div>
              </div>
            )}
            {showPinHint ? (
              <AddinPinHintBanner onDismiss={() => setPinHintDismissed(true)} />
            ) : null}
            {TopLeftAccessory ? (
              <TopLeftAccessory
                availableModels={availableModels}
                selectedModel={selectedModel}
                onModelChange={setSelectedModel}
                isModelSelectionReady={isSelectionReady}
              />
            ) : null}
            <MessageList
              messages={messagesWithArtifact}
              messageOrder={messageOrder}
              loadOlderMessages={() => {}}
              hasOlderMessages={false}
              isPending={isMessagingLoading}
              currentSessionId={currentChatId ?? ""}
              pageSize={6}
              maxWidth={768}
              showTimestamps={true}
              showAvatars={false}
              userProfile={profile ?? undefined}
              controls={resolvedMessageControls}
              messageRenderer={resolvedMessageRenderer}
              controlsContext={controlsContext}
              onMessageAction={standardMessageActionHandler}
              useVirtualization={messageOrder.length > 30}
              virtualizationThreshold={30}
              onFilePreview={openPreviewModal}
              onViewFeedback={openFeedbackViewDialog}
              className="overscroll-none"
            />

            <AddinChatInput
              ref={chatInputControlsRef}
              onSendMessage={handleSendMessage}
              onEditMessage={handleEditSubmit}
              onCancelEdit={editState.mode === "edit" ? cancelEdit : undefined}
              onFilePreview={openPreviewModal}
              handleFileAttachments={(_files: FileUploadItem[]) => {}}
              chatId={currentChatId}
              assistantId={assistantId}
              isLoading={isMessagingLoading}
              mode={editState.mode}
              editMessageId={
                editState.mode === "edit" ? editState.messageId : undefined
              }
              editInitialContent={
                editState.mode === "edit" ? editState.initialContent : undefined
              }
              editInitialFiles={
                editState.mode === "edit" ? editState.initialFiles : undefined
              }
              controlledAvailableModels={availableModels}
              controlledSelectedModel={selectedModel}
              onControlledSelectedModelChange={setSelectedModel}
              controlledIsModelSelectionReady={isSelectionReady}
              initialSelectedFacetIds={currentChatLastSelectedFacets}
              onFacetSelectionChange={setActiveSelectedFacetIds}
              showSuggestedEmailSource={shouldSuggestCurrentEmail}
              onEmailSourceDropsSent={handleEmailSourceDropsSent}
              uploadFiles={uploadFiles}
              uploadError={uploadError}
              isExpandingDroppedEmails={isExpandingDroppedEmails}
              virtualFiles={previewVirtualFiles}
              // Outlook drag-drop expands one email into body + N attachments,
              // so the web default of 5 fills up after a single multi-attachment
              // drop. The add-in lifts the cap; web stays at 5.
              maxFiles={50}
              lastSchedulingSignalAt={lastSchedulingSignalAt}
            />
          </div>
        </ChatErrorBoundary>

        <FilePreviewModal
          isOpen={isPreviewModalOpen}
          onClose={closePreviewModal}
          file={fileToPreview}
        />
        <FeedbackViewDialog
          isOpen={feedbackViewDialogState.isOpen}
          onClose={closeFeedbackViewDialog}
          onEdit={switchToEditMode}
          feedback={feedbackViewDialogState.feedback}
          canEdit={
            feedbackViewDialogState.feedback
              ? canEditFeedback(feedbackViewDialogState.feedback)
              : false
          }
        />
        <FeedbackCommentDialog
          isOpen={feedbackDialogState.isOpen}
          onClose={closeFeedbackDialog}
          onSubmit={handleFeedbackDialogSubmit}
          sentiment={feedbackDialogState.sentiment}
          mode={feedbackDialogState.mode}
          initialComment={feedbackDialogState.initialComment}
          error={feedbackDialogState.error}
        />
        <AddinSettingsDialog
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
        />
      </div>
    </ChatInputControlsProvider>
  );
}
