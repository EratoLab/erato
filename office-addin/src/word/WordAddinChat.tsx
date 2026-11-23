import {
  useConversationDropzone,
  useUploadFeature,
} from "@erato/frontend/library";
import { useCallback, useMemo, useRef, useState } from "react";

import { WordChatInput } from "./components/WordChatInput";
import { WordSettingsDialog } from "./components/WordSettingsDialog";
import { useWordDocumentCaptures } from "./hooks/useWordDocumentCaptures";
import { WordWriteProvider } from "./providers/WordWriteProvider";
import { buildWordArtifact } from "./utils/buildWordArtifact";
import { getWordDocumentIdentity } from "./utils/wordDocumentIdentity";
import { AddinChatCore, AddinChatCoreView } from "../core/AddinChatCore";
import { useActionFacetClientActions } from "../core/clientActions/useAvailableActionFacets";
import { stampHostArtifact } from "../core/hostArtifactStamp";

import type {
  AddinChatController,
  AddinChatHostProps,
} from "../core/AddinChatCore";
import type { HostArtifactStamp } from "../core/hostArtifactStamp";
import type { HostArtifact, Message } from "@erato/frontend/library";

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

  return (
    <WordWriteProvider
      documentIdentity={documentIdentity}
      capturesByAssistantMessageId={capturesByAssistantMessageId}
      restoreRequest={restoreRequest}
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
