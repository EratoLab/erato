import {
  useConversationDropzone,
  useFileUploadStore,
  usePersistedState,
  useUploadFeature,
  type FileUploadItem,
  type PersistedStateOptions,
} from "@erato/frontend/library";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AddinChatInput } from "./components/AddinChatInput";
import { AddinPinHintBanner } from "./components/AddinPinHintBanner";
import { AddinSettingsDialog } from "./components/AddinSettingsDialog";
import { dismissSessionToasts } from "./components/sessionAskToast";
import {
  AddinChatCore,
  AddinChatCoreView,
  type AddinChatHostProps,
} from "../core/AddinChatCore";
import { useActionFacetClientActions } from "./hooks/useAvailableActionFacets";
import { useEmailDedupSet } from "./hooks/useEmailDedupSet";
import { useOfficeDragAndDrop } from "../hooks/useOfficeDragAndDrop";
import { useOutlookClientTools } from "./hooks/useOutlookClientTools";
import { useOutlookMailListDrag } from "./hooks/useOutlookMailListDrag";
import { useOutlookMessageFetcher } from "./hooks/useOutlookMessageFetcher";
import { useOffice } from "../providers/OfficeProvider";
import { useOutlookEmailSource } from "./providers/OutlookEmailSourceProvider";
import { useOutlookMailItem } from "./providers/OutlookMailItemProvider";
import { holdSessionPolicy, releaseSessionPolicy } from "./sessionPolicy";
import { resolveEditExchangeItemIdentity } from "./utils/exchangeItemIdentity";
import { FreshCompletionTracker } from "./utils/freshCompletionTracker";
import {
  OUTLOOK_GRAPH_MESSAGE_TIMEOUT_MS,
  runWithGraphTimeout,
} from "./utils/graphRequestTimeout";
import { buildOutlookArtifact } from "./utils/outlookClientActions";
import { newestSchedulingSignalAt } from "./utils/outlookScheduleTool";
import { parseDroppedFiles } from "./utils/parseDroppedFiles";
import { parseEmlBytes } from "./utils/parsedEmail";

import type { FetchOutlookMessageBytesResult } from "./utils/fetchOutlookMessage";
import type { OutlookMailListDragItem } from "./utils/outlookMailListDragParse";

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

export function OutlookAddinChat({
  assistantId,
}: { assistantId?: string } = {}) {
  return (
    <AddinChatCore
      assistantId={assistantId}
      maxFiles={50}
      Host={OutlookAddinChatHost}
    />
  );
}

function OutlookAddinChatHost({ controller }: AddinChatHostProps) {
  useOutlookClientTools();
  const { chatInputControls, uploadFiles } = controller;

  // While the history drawer is open, mail-item switches must not interleave
  // a session toast underneath it; the gate defers the anchor policy until
  // the drawer closes (or this host unmounts).
  const isHistoryMenuOpen = controller.isHistoryMenuOpen;
  useEffect(() => {
    if (!isHistoryMenuOpen) return;
    holdSessionPolicy();
    // A pending ask toast would float interactive above the modal drawer yet
    // sit outside its focus trap, and the drawer subsumes its choices anyway.
    // Dismissing is safe: closing without picking releases the gate, which
    // re-evaluates the anchor policy and re-shows a still-unanswered ask.
    dismissSessionToasts();
    return () => releaseSessionPolicy();
  }, [isHistoryMenuOpen]);
  const lastSchedulingSignalAt = useMemo(
    () =>
      newestSchedulingSignalAt(
        controller.messageOrder
          .map((id) => controller.messages[id])
          .filter((message) => message !== undefined),
      ),
    [controller.messageOrder, controller.messages],
  );

  const { fetcher: messageFetcher } = useOutlookMessageFetcher();
  const { mailItem, hasItemChangedFired } = useOutlookMailItem();
  const { itemTrackingRequiresPin } = useOffice();
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
  const dedup = useEmailDedupSet();
  const tryClaimEmailAttachment = useCallback(
    (messageId: string): boolean => {
      if (previewEmailMessageIdRef.current === messageId) return false;
      return dedup.tryAdd(messageId);
    },
    [dedup],
  );
  const handleEmailSourceDropsSent = useCallback(
    (drops: { key: string; messageId: string | null }[]) => {
      for (const { key, messageId } of drops) {
        removeDroppedEmail(key);
        if (messageId) dedup.remove(messageId);
      }
    },
    [dedup, removeDroppedEmail],
  );

  const pendingOutlookFetchesRef = useRef<
    Map<string, Promise<FetchOutlookMessageBytesResult>>
  >(new Map());
  const fetchOutlookMessageBytesCoalesced = useCallback(
    (itemId: string): Promise<FetchOutlookMessageBytesResult> => {
      if (!messageFetcher) {
        return Promise.reject(
          new Error("Outlook message fetch is not available on this host"),
        );
      }
      const existing = pendingOutlookFetchesRef.current.get(itemId);
      if (existing) return existing;
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

  const [pendingExpansionCount, setPendingExpansionCount] = useState(0);
  const isExpandingDroppedEmails = pendingExpansionCount > 0;
  const trackExpansion = useCallback(
    async <T,>(work: () => Promise<T>): Promise<T> => {
      setPendingExpansionCount((value) => value + 1);
      try {
        return await work();
      } finally {
        setPendingExpansionCount((value) => value - 1);
      }
    },
    [],
  );
  const uploadFilesWithEmailExpansion = useCallback(
    async (files: File[]) =>
      trackExpansion(async () => {
        const claimedIds: string[] = [];
        const { emails, nonEmail } = await parseDroppedFiles(files, {
          fetcher: messageFetcher ?? undefined,
          tryAttachEmail: (messageId) => {
            if (!tryClaimEmailAttachment(messageId)) return false;
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
        if (nonEmail.length === 0) return undefined;
        const uploaded = await uploadFiles(nonEmail);
        if (uploaded === undefined) {
          claimedIds.forEach((id) => dedup.remove(id));
        }
        return uploaded;
      }),
    [
      addDroppedEmail,
      dedup,
      messageFetcher,
      trackExpansion,
      tryClaimEmailAttachment,
      uploadFiles,
    ],
  );
  const emailDropMimeTypes = messageFetcher ? EMAIL_MIME_TYPES : EML_MIME_TYPES;
  const { maxSizeBytes, maxSizeFormatted } = useUploadFeature();
  const { setError: setUploadError } = useFileUploadStore();
  const dropzone = useConversationDropzone({
    uploadFiles: uploadFilesWithEmailExpansion,
    onUploaded: (uploaded: FileUploadItem[]) =>
      chatInputControls.addUploadedFiles(uploaded),
    acceptedFileTypes: controller.acceptedFileTypes,
    extraAcceptMimeTypes: emailDropMimeTypes,
    isUploading: controller.isUploading,
    maxSize: maxSizeBytes,
    maxSizeFormatted,
    onError: setUploadError,
  });

  const handleOutlookMailListDrop = useCallback(
    async (items: OutlookMailListDragItem[]) =>
      trackExpansion(async () => {
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
            const parsed = await parseEmlBytes(bytes);
            if (!parsed) {
              if (internetMessageId) dedup.remove(internetMessageId);
              continue;
            }
            if (addDroppedEmail(parsed) === null && internetMessageId) {
              dedup.remove(internetMessageId);
            }
          } catch (error) {
            console.warn(
              "Failed to fetch dropped Outlook email, skipping:",
              item.subject || item.itemId,
              error,
            );
          }
        }
      }),
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
    disabled: !messageFetcher,
  });

  const handleOfficeDragAndDrop = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      return trackExpansion(async () => {
        const claimedIds: string[] = [];
        const { emails, nonEmail } = await parseDroppedFiles(files, {
          fetcher: messageFetcher ?? undefined,
          tryAttachEmail: (messageId) => {
            if (!tryClaimEmailAttachment(messageId)) return false;
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
        if (nonEmail.length === 0) return;
        const uploaded = await uploadFiles(nonEmail);
        if (uploaded === undefined) {
          claimedIds.forEach((id) => dedup.remove(id));
        } else if (uploaded.length > 0) {
          chatInputControls.addUploadedFiles(uploaded);
        }
      });
    },
    [
      addDroppedEmail,
      chatInputControls,
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
    (dropzone.isDragActive && dropzone.isDragAccept) ||
    isOutlookMailDragActive ||
    isOfficeDragActive;

  const currentEmailMessageId = mailItem?.internetMessageId ?? null;
  const currentEmailAlreadyAttached =
    currentEmailMessageId !== null && dedup.ids.has(currentEmailMessageId);
  const shouldSuggestCurrentEmail =
    controller.currentChatId === null &&
    controller.messageOrder.length === 0 &&
    !controller.isPendingResponse &&
    controller.editingMessageId === null &&
    !currentEmailAlreadyAttached;
  previewEmailMessageIdRef.current =
    shouldSuggestCurrentEmail && hasSelectedEmailSource && isEmailBodyIncluded
      ? currentEmailMessageId
      : null;
  const isPreviewBodyIncluded =
    shouldSuggestCurrentEmail && hasSelectedEmailSource && isEmailBodyIncluded;
  const previewVirtualFiles = useMemo(
    () =>
      isPreviewBodyIncluded && emailBodyFile ? [emailBodyFile] : undefined,
    [emailBodyFile, isPreviewBodyIncluded],
  );

  const pendingSendItemIdentityRef = useRef<string | null>(null);
  const freshTrackerRef = useRef(new FreshCompletionTracker());
  const freshItemIdentityRef = useRef(new Map<string, string>());
  const freshTrackerChatIdRef = useRef(controller.currentChatId);
  const [freshMessageIds, setFreshMessageIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  useEffect(() => {
    if (freshTrackerChatIdRef.current !== controller.currentChatId) {
      const isNewChatGettingItsId =
        freshTrackerChatIdRef.current == null &&
        controller.currentChatId != null;
      freshTrackerChatIdRef.current = controller.currentChatId;
      if (!isNewChatGettingItsId) {
        freshTrackerRef.current = new FreshCompletionTracker();
        pendingSendItemIdentityRef.current = null;
      }
    }
    const newlyFresh = freshTrackerRef.current.observe(
      controller.messages,
      controller.messageOrder,
    );
    if (newlyFresh.length > 0) {
      const sendItemIdentity =
        newlyFresh.length === 1 ? pendingSendItemIdentityRef.current : null;
      pendingSendItemIdentityRef.current = null;
      if (sendItemIdentity) {
        const completedId = newlyFresh[0];
        freshItemIdentityRef.current.set(completedId, sendItemIdentity);
        setFreshMessageIds((previous) => new Set([...previous, completedId]));
      }
    }
  }, [controller.currentChatId, controller.messageOrder, controller.messages]);
  controller.hostCallbacksRef.current = {
    beforeSend: (identity) => {
      pendingSendItemIdentityRef.current = identity ?? null;
    },
    beforeEdit: (messageId) => {
      pendingSendItemIdentityRef.current = resolveEditExchangeItemIdentity(
        controller.messages,
        controller.messageOrder,
        messageId,
        freshItemIdentityRef.current,
      );
    },
    beforeRegenerate: (assistantMessageId) => {
      pendingSendItemIdentityRef.current =
        freshItemIdentityRef.current.get(assistantMessageId) ?? null;
    },
  };

  const clientActionsByFacetId = useActionFacetClientActions();
  const messagesWithArtifact = useMemo(() => {
    let next = controller.messages;
    for (const id of controller.messageOrder) {
      const message = controller.messages[id];
      if (
        !message ||
        message.role !== "assistant" ||
        !message.previous_message_id
      ) {
        continue;
      }
      const previous = controller.messages[message.previous_message_id];
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
      if (!outlookArtifact) continue;
      if (next === controller.messages) next = { ...controller.messages };
      next[id] = { ...message, outlookArtifact };
    }
    return next;
  }, [
    clientActionsByFacetId,
    controller.messageOrder,
    controller.messages,
    freshMessageIds,
  ]);

  return (
    <AddinChatCoreView
      controller={controller}
      dropzone={dropzone}
      showDropOverlay={showDropOverlay}
      messages={messagesWithArtifact}
      beforeMessages={
        showPinHint ? (
          <AddinPinHintBanner onDismiss={() => setPinHintDismissed(true)} />
        ) : undefined
      }
      renderInput={(props) => (
        <AddinChatInput
          {...props}
          showSuggestedEmailSource={shouldSuggestCurrentEmail}
          onEmailSourceDropsSent={handleEmailSourceDropsSent}
          isExpandingDroppedEmails={isExpandingDroppedEmails}
          virtualFiles={previewVirtualFiles}
          lastSchedulingSignalAt={lastSchedulingSignalAt}
        />
      )}
      renderSettings={(props) => <AddinSettingsDialog {...props} />}
    />
  );
}
