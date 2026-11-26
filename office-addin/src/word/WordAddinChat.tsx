import {
  addUnsetClientToolDecisions,
  useApprovalTools,
  useConversationDropzone,
  useUploadFeature,
} from "@erato/frontend/library";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { WordChatInput } from "./components/WordChatInput";
import { WordSettingsDialog } from "./components/WordSettingsDialog";
import { useWordDocumentCaptures } from "./hooks/useWordDocumentCaptures";
import { WordWriteProvider } from "./providers/WordWriteProvider";
import { buildWordArtifact } from "./utils/buildWordArtifact";
import { WORD_CLIENT_ACTION_DECISIONS_KEY } from "./utils/clientActionPolicy";
import {
  WORD_APPLY_COMMENTS_TOOL,
  WORD_APPLY_PLAN_TOOL,
} from "./utils/wordApplyCall";
import { setWordChainedApply } from "./utils/wordAuthoringContract";
import { getWordDocumentIdentity } from "./utils/wordDocumentIdentity";
import { wordMessageContext } from "./utils/wordMessageContext";
import { AddinChatCore, AddinChatCoreView } from "../core/AddinChatCore";
import { carryOverClientDecisions } from "../core/clientActions/carryOverDecisions";
import { carryOverMappingsFor } from "../core/clientActions/proposalApply";
import { useActionFacetClientActions } from "../core/clientActions/useAvailableActionFacets";
import { stampHostArtifact } from "../core/hostArtifactStamp";

import type {
  AddinChatController,
  AddinChatHostProps,
} from "../core/AddinChatCore";
import type { HostArtifactStamp } from "../core/hostArtifactStamp";
import type { WordMessageContext } from "./utils/wordWriteBridge";
import type { HostArtifact, Message } from "@erato/frontend/library";

/** The namespace of the Word tools the server calls. */
const WORD_NAMESPACE = "word";

type PaneMessage = AddinChatController["messages"][string];

const withHostArtifact = <M extends Message>(
  message: M,
  hostArtifact: HostArtifact,
): M => ({
  ...message,
  hostArtifact,
});

export function WordAddinChat({ assistantId }: { assistantId?: string } = {}) {
  return <AddinChatCore assistantId={assistantId} Host={WordAddinChatHost} />;
}

function WordAddinChatHost({ controller }: AddinChatHostProps) {
  const { maxSizeBytes, maxSizeFormatted } = useUploadFeature();
  const dropzone = useConversationDropzone({
    uploadFiles: controller.uploadFiles,
    onUploaded: (files) => controller.chatInputControls.addUploadedFiles(files),
    acceptedFileTypes: controller.acceptedFileTypes,
    isUploading: controller.isUploading,
    disabled: controller.composerLocked,
    maxSize: maxSizeBytes,
    maxSizeFormatted,
  });

  const [documentIdentity] = useState(getWordDocumentIdentity);

  const captures = useWordDocumentCaptures(controller);
  controller.hostCallbacksRef.current = captures.hostCallbacks;

  const clientActionsByFacetId = useActionFacetClientActions();
  const { messages, messageOrder, setIsSettingsOpen } = controller;
  const { setDraftMessage } = controller.chatInputControls;
  // The composer's "Change default" opens the Word tab; the drawer keeps the first tab.
  const [settingsTab, setSettingsTab] = useState<"host" | undefined>();
  const openWordSettings = useCallback(() => {
    setSettingsTab("host");
    setIsSettingsOpen(true);
  }, [setIsSettingsOpen]);
  const restoreRequest = useCallback(
    (message: string) => setDraftMessage(message, { focus: true }),
    [setDraftMessage],
  );
  const { capturesByAssistantMessageId } = captures;
  const stampsRef = useRef(new Map<string, HostArtifactStamp<PaneMessage>>());
  const messagesWithArtifact = useMemo(() => {
    const stamps = new Map<string, HostArtifactStamp<PaneMessage>>();
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
      const facetId = messages[message.previous_message_id]?.action_facet_id;
      const clientActionInfo = facetId
        ? clientActionsByFacetId.get(facetId)
        : undefined;
      const capture = capturesByAssistantMessageId.get(id);
      const stamp = stampHostArtifact(
        stampsRef.current.get(id),
        message,
        [facetId, clientActionInfo, capture],
        () =>
          buildWordArtifact({
            facetId,
            clientActionInfo,
            content: message.content,
            messageId: id,
            capture,
            generating: message.status === "sending",
          }),
        withHostArtifact,
      );
      stamps.set(id, stamp);
      if (stamp.message === message) continue;
      if (next === messages) next = { ...messages };
      next[id] = stamp.message;
    }
    stampsRef.current = stamps;
    return next;
  }, [
    capturesByAssistantMessageId,
    clientActionsByFacetId,
    messageOrder,
    messages,
  ]);

  const approvalTools = useApprovalTools();
  const wordMappings = useMemo(
    () => carryOverMappingsFor(approvalTools, WORD_NAMESPACE),
    [approvalTools],
  );
  const offeredApplyTools = useMemo(
    () => new Set(wordMappings.map((mapping) => mapping.serverKey)),
    [wordMappings],
  );
  const chainedApply =
    offeredApplyTools.has(`${WORD_NAMESPACE}/${WORD_APPLY_PLAN_TOOL}`) ||
    offeredApplyTools.has(`${WORD_NAMESPACE}/${WORD_APPLY_COMMENTS_TOOL}`);
  useEffect(() => setWordChainedApply(chainedApply), [chainedApply]);
  // Once the server decides an action, the pane's own Ask, Always and Never for it move there once.
  useEffect(() => {
    if (wordMappings.length === 0) return;
    void carryOverClientDecisions({
      host: "word",
      storageKey: WORD_CLIENT_ACTION_DECISIONS_KEY,
      mappings: wordMappings,
      offered: offeredApplyTools,
      sessionOnly: (facetId, action) =>
        clientActionsByFacetId.get(facetId)?.grantScope[action] ===
        "session_document",
      save: addUnsetClientToolDecisions,
    });
  }, [wordMappings, offeredApplyTools, clientActionsByFacetId]);
  // Read when an apply runs without its copy, as after a reload: the request and its document.
  const messagesRef = useRef({ messages: messagesWithArtifact, messageOrder });
  messagesRef.current = { messages: messagesWithArtifact, messageOrder };
  const messageContext = useCallback(
    (messageId: string): WordMessageContext =>
      wordMessageContext(
        messagesRef.current.messages,
        messagesRef.current.messageOrder,
        messageId,
      ),
    [],
  );

  return (
    <WordWriteProvider
      documentIdentity={documentIdentity}
      capturesByAssistantMessageId={capturesByAssistantMessageId}
      captureFor={captures.captureFor}
      restoreRequest={restoreRequest}
      messageContext={messageContext}
    >
      <AddinChatCoreView
        controller={controller}
        dropzone={dropzone}
        showDropOverlay={dropzone.isDragActive && dropzone.isDragAccept}
        messages={messagesWithArtifact}
        renderInput={(props) => (
          <WordChatInput
            chatInputProps={props}
            documentIdentity={documentIdentity}
            stagePendingCapture={captures.stagePendingCapture}
            onOpenWordSettings={openWordSettings}
          />
        )}
        renderSettings={(props) => (
          <WordSettingsDialog
            {...props}
            openTab={settingsTab ?? props.openTab}
            onClose={() => {
              setSettingsTab(undefined);
              props.onClose();
            }}
          />
        )}
      />
    </WordWriteProvider>
  );
}
